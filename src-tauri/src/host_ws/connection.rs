//! One native pipe: handshake, reconnect scheduler, multiplexing and flow control.
use super::{
    bulk,
    demand::{DemandUnion, Effects, MemberId, Notice, Operation, OperationKind},
    permits::ResourceScope,
    Contracts, NativeEvent, Request, Shared, WsFailure, WsReply,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{net::TcpStream, sync::mpsc as channel, time};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        client::IntoClientRequest,
        http::{header, HeaderValue},
        protocol::WebSocketConfig,
        Error, Message,
    },
    MaybeTlsStream, WebSocketStream,
};
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Connected {
    socket: Socket,
    methods: HashSet<String>,
    capabilities: HashSet<String>,
}
impl Connected {
    fn supports(&self, contracts: &Contracts, method: &str) -> bool {
        self.methods.contains(method)
            && contracts.methods.get(method).is_some_and(|definition| {
                definition
                    .required_capability
                    .as_ref()
                    .is_none_or(|capability| self.capabilities.contains(capability))
            })
    }
}

fn socket_error(error: &Error) -> (&'static str, bool) {
    match error {
        Error::Http(response) if matches!(response.status().as_u16(), 401 | 403) => {
            ("authentication", true)
        }
        Error::Http(response) if matches!(response.status().as_u16(), 404 | 405 | 426) => {
            ("unsupported", true)
        }
        Error::Tls(_) => ("authentication", true),
        _ => ("unavailable", false),
    }
}

// A Host that is restarting, or that answers an internal failure with 401, can
// refuse one upgrade after this lane already authenticated. Only a short streak
// of such refusals is temporary; after that the credentials are treated as
// invalid and the lane blocks until a manual reconnect.
const REAUTHENTICATION_RETRY_ATTEMPTS: u32 = 3;

// Upgrade-only: a 401 is kept apart from other authentication failures so the
// worker can decide whether it is temporary for this lane.
fn upgrade_error(error: &Error) -> (&'static str, bool) {
    match error {
        Error::Http(response) if response.status().as_u16() == 401 => ("unauthorized", true),
        _ => socket_error(error),
    }
}

// Returns (category, permanent) for the Nth consecutive upgrade 401.
pub(super) fn unauthorized_disposition(
    authenticated_before: bool,
    streak: u32,
) -> (&'static str, bool) {
    let temporary = authenticated_before && streak <= REAUTHENTICATION_RETRY_ATTEMPTS;
    ("authentication", !temporary)
}

// A well-formed error response is not itself a protocol error. Older Hosts may
// omit category; only explicit identity/authentication/schema evidence blocks.
pub(super) fn remote_error_class(value: &Value) -> (&'static str, bool) {
    match value["error"]["data"]["category"].as_str() {
        Some("authentication") => ("authentication", true),
        Some("identity") => ("identity", true),
        Some("schema") => ("schema", true),
        Some("unsupported") => ("unsupported", true),
        Some("overload") => ("overload", false),
        _ => match value["error"]["code"].as_i64() {
            Some(-32700 | -32600) => ("schema", true),
            Some(-32601) => ("unsupported", true),
            Some(-32001) => ("authentication", true),
            Some(-32002) => ("identity", true),
            Some(-32004) => ("overload", false),
            _ => ("unavailable", false),
        },
    }
}

async fn connect(
    shared: &Shared,
    contracts: &Contracts,
    generation: u64,
) -> Result<Connected, (&'static str, bool)> {
    let mut request = shared
        .route
        .endpoint
        .as_str()
        .into_client_request()
        .map_err(|_| ("identity", true))?;
    let mut authorization =
        HeaderValue::from_str(&format!("Bearer {}", shared.route.token.as_str()))
            .map_err(|_| ("authentication", true))?;
    authorization.set_sensitive(true);
    request
        .headers_mut()
        .insert(header::AUTHORIZATION, authorization);
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_str(contracts.protocol()).map_err(|_| ("schema", true))?,
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(contracts.limit("maxMessageBytes")))
        .max_frame_size(Some(contracts.limit("maxMessageBytes")))
        .max_write_buffer_size(contracts.limit("maxSocketQueuedBytes"));
    let (mut socket, response) = connect_async_with_config(request, Some(config), true)
        .await
        .map_err(|error| upgrade_error(&error))?;
    if response
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        != Some(contracts.protocol())
    {
        let _ = socket.close(None).await;
        // A Host that speaks another subprotocol still serves HTTP.
        return Err(("unsupported", true));
    }
    let id = format!("hello.{generation}.{}", uuid::Uuid::new_v4());
    let hello = json!({"jsonrpc":"2.0","id":id,"method":"connection.hello","params":{
        "environmentId":shared.route.environment_id,"clientId":format!("desktop.{}", uuid::Uuid::new_v4()),
        "clientKind":"desktop", "supportedWireVersions":[contracts.manifest["wireVersion"]],
        "supportedSchemaVersions":[contracts.manifest["schemaVersion"]]}});
    if !contracts.methods["connection.hello"]
        .params
        .is_valid(&hello["params"])
    {
        return Err(("identity", true));
    }
    socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .map_err(|error| socket_error(&error))?;
    while let Some(message) = socket.next().await {
        match message.map_err(|error| socket_error(&error))? {
            Message::Text(text) => {
                let value: Value = serde_json::from_str(&text).map_err(|_| ("schema", true))?;
                if !contracts.response.is_valid(&value) || value["id"] != id {
                    return Err(("schema", true));
                }
                if value.get("error").is_some() {
                    return Err(remote_error_class(&value));
                }
                let result = &value["result"];
                if !contracts.methods["connection.hello"]
                    .result
                    .is_valid(result)
                {
                    return Err(("schema", true));
                }
                if result["environmentId"] != shared.route.environment_id {
                    return Err(("identity", true));
                }
                if result["wireVersion"] != contracts.manifest["wireVersion"]
                    || result["schemaVersion"] != contracts.manifest["schemaVersion"]
                {
                    // App/Host version skew: the WebSocket lane is unusable, HTTP is not.
                    return Err(("unsupported", true));
                }
                let methods = result["methods"]
                    .as_array()
                    .ok_or(("schema", true))?
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|name| contracts.methods.contains_key(*name))
                    .map(str::to_owned)
                    .collect();
                let capabilities = result["capabilities"]
                    .as_array()
                    .ok_or(("schema", true))?
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect();
                return Ok(Connected {
                    socket,
                    methods,
                    capabilities,
                });
            }
            Message::Ping(data) => socket
                .send(Message::Pong(data))
                .await
                .map_err(|error| socket_error(&error))?,
            Message::Pong(_) => {}
            _ => return Err(("schema", true)),
        }
    }
    Err(("unavailable", false))
}

fn settle(request: Request, generation: u64, sent: bool, code: &str, message: &str) {
    let error = WsFailure::local(code, message).for_request(&request, generation, sent);
    deliver(request, Err(error));
}

fn deliver(mut request: Request, mut response: Result<WsReply, WsFailure>) {
    if let Ok(output) = &mut response {
        output.disclosure = Some(Arc::new(super::ReplyDisclosure {
            resource: request.resource_scope.clone(),
            failure: WsFailure::local(
                "RPC_WS_RESOURCE_RETIRED",
                "Host resource changed before native IPC disclosure",
            )
            .for_request(&request, output.generation, true),
        }));
        if output.bulk.is_some() {
            request.download_grant.take();
        }
    }
    let reply = request.reply.clone();
    // Release the ID and both byte/slot credits before waking a native caller.
    // Otherwise an immediate next attempt can race the previous Request's Drop.
    drop(request);
    let _ = reply.send(response);
}

pub(super) fn prune_reconnect_queue(
    shared: &Shared,
    queue: &mut VecDeque<Request>,
    generation: u64,
    now: Instant,
) {
    for _ in 0..queue.len() {
        let request = queue.pop_front().expect("queue length checked");
        let reason = if !shared.active(&request.consumer)
            || shared.cancelled(&request.id)
            || request
                .issuer
                .as_ref()
                .is_some_and(|issuer| !issuer.is_live())
        {
            Some((
                "RPC_WS_CANCELLED",
                "Host request was cancelled before dispatch",
            ))
        } else if !request.resource_scope.live() {
            Some((
                "RPC_WS_RESOURCE_RETIRED",
                "Host resource changed before request dispatch",
            ))
        } else if now >= request.admission_deadline || now >= request.deadline {
            Some((
                "RPC_WS_DEADLINE",
                "Host request deadline elapsed before dispatch",
            ))
        } else {
            None
        };
        if let Some((code, message)) = reason {
            settle(request, generation, false, code, message);
        } else {
            queue.push_back(request);
        }
    }
}

fn reconnect_queue_wait(queue: &VecDeque<Request>, now: Instant) -> Duration {
    queue
        .iter()
        .map(|request| request.admission_deadline.min(request.deadline))
        .min()
        .map(|deadline| deadline.saturating_duration_since(now))
        .unwrap_or(Duration::from_secs(60))
}

pub(super) async fn worker(
    shared: Arc<Shared>,
    contracts: Arc<Contracts>,
    mut rx: channel::Receiver<Request>,
) {
    let mut generation = 0u64;
    let mut attempts = 0u32;
    let mut authenticated = false;
    let mut unauthorized_streak = 0u32;
    let mut blocked: Option<(&str, bool)> = None;
    let mut queued = VecDeque::<Request>::new();
    'worker: while !shared.stopped() {
        if let Some((category, unsupported)) = blocked {
            tokio::select! {
                _ = shared.changed.notified() => {},
                request = rx.recv() => match request {
                    Some(request) => {
                        let mut error = if unsupported { WsFailure::unsupported() }
                            else { WsFailure::local("RPC_WS_BLOCKED", "Native Host connection requires updated authentication, identity or protocol") };
                        error = error.for_request(&request, generation, false);
                        deliver(request, Err(error));
                    }, None => break,
                },
            }
            shared.state(generation, "blocked", Some(category));
            continue;
        }
        generation = match super::generation(&shared.next_generation) {
            Some(value) => value,
            None => break,
        };
        shared.state(generation, "connecting", None);
        let handshake = time::timeout(
            contracts.duration("handshakeTimeoutMs"),
            connect(&shared, &contracts, generation),
        );
        tokio::pin!(handshake);
        let result = loop {
            prune_reconnect_queue(&shared, &mut queued, generation, Instant::now());
            let wait = reconnect_queue_wait(&queued, Instant::now());
            tokio::select! {
                _ = shared.changed.notified() => { if shared.stopped() { break 'worker; } },
                _ = time::sleep(wait) => {},
                request = rx.recv() => match request { Some(request) => queued.push_back(request), None => break 'worker },
                result = &mut handshake => break result.unwrap_or(Err(("unavailable", false))),
            }
        };
        let (category, permanent) = match result {
            Ok(connection) => {
                authenticated = true;
                unauthorized_streak = 0;
                shared.state(generation, "ready", None);
                let ready_at = Instant::now();
                let failure = serve(
                    &shared,
                    &contracts,
                    generation,
                    connection,
                    &mut rx,
                    &mut queued,
                )
                .await;
                if ready_at.elapsed()
                    >= Duration::from_millis(
                        contracts.manifest["retryPolicy"]["stableReadyMs"]
                            .as_u64()
                            .unwrap_or(30_000),
                    )
                {
                    attempts = 0;
                }
                failure
            }
            Err(("unauthorized", _)) => {
                unauthorized_streak = unauthorized_streak.saturating_add(1);
                unauthorized_disposition(authenticated, unauthorized_streak)
            }
            Err(failure) => {
                unauthorized_streak = 0;
                failure
            }
        };
        if permanent {
            while let Some(request) = queued.pop_front().or_else(|| rx.try_recv().ok()) {
                let error = if category == "unsupported" {
                    WsFailure::unsupported()
                } else if permanent {
                    WsFailure::local(
                        "RPC_WS_BLOCKED",
                        "Native Host authentication, identity or protocol is invalid",
                    )
                } else {
                    WsFailure::local(
                        "RPC_WS_UNAVAILABLE",
                        "Host connection is unavailable before dispatch",
                    )
                };
                let error = error.for_request(&request, generation, false);
                deliver(request, Err(error));
            }
        }
        if shared.stopped() {
            break;
        }
        if permanent {
            blocked = Some((category, category == "unsupported"));
            shared.state(generation, "blocked", Some(category));
            continue;
        }
        shared.state(generation, "retry-wait", Some(category));
        let initial = contracts.manifest["retryPolicy"]["initialDelayMs"]
            .as_u64()
            .unwrap_or(250);
        let maximum = contracts.manifest["retryPolicy"]["maxDelayMs"]
            .as_u64()
            .unwrap_or(30_000);
        let cap = initial
            .saturating_mul(1u64.checked_shl(attempts.min(20)).unwrap_or(u64::MAX))
            .min(maximum);
        attempts = attempts.saturating_add(1);
        let random = uuid::Uuid::new_v4().as_u128() as u64;
        let delay = time::sleep(Duration::from_millis(random % (cap + 1)));
        tokio::pin!(delay);
        loop {
            prune_reconnect_queue(&shared, &mut queued, generation, Instant::now());
            let wait = reconnect_queue_wait(&queued, Instant::now());
            tokio::select! {
                _ = &mut delay => break,
                _ = shared.changed.notified() => { if shared.stopped() { break; } },
                _ = time::sleep(wait) => {},
                request = rx.recv() => match request {
                    Some(request) => queued.push_back(request),
                    None => break 'worker,
                }
            }
            if shared.stopped() {
                break;
            }
        }
    }
    while let Some(request) = queued.pop_front() {
        settle(
            request,
            generation,
            false,
            "RPC_WS_DETACHED",
            "Native consumer detached before dispatch",
        );
    }
    while let Ok(request) = rx.try_recv() {
        settle(
            request,
            generation,
            false,
            "RPC_WS_DETACHED",
            "Native consumer detached before dispatch",
        );
    }
    shared.state(generation, "closed", None);
}

async fn send(socket: &mut Socket, contracts: &Contracts, value: Value) -> bool {
    let text = value.to_string();
    if text.len() > contracts.limit("maxMessageBytes") {
        return false;
    }
    matches!(
        time::timeout(
            contracts.duration("handshakeTimeoutMs"),
            socket.send(Message::Text(text.into()))
        )
        .await,
        Ok(Ok(()))
    )
}

fn complete_result(
    shared: &Shared,
    contracts: &Contracts,
    generation: u64,
    request: Request,
    result: Value,
    held: Option<Arc<bulk::Held>>,
) -> Result<(), (&'static str, bool)> {
    if request.method == "connection.probe"
        && result["environmentId"] != shared.route.environment_id
    {
        settle(
            request,
            generation,
            true,
            "RPC_WS_IDENTITY",
            "Host probe identity changed",
        );
        return Err(("identity", true));
    }
    if !contracts.methods[&request.method].result.is_valid(&result) {
        settle(
            request,
            generation,
            true,
            "RPC_WS_SCHEMA",
            "Host result does not match its canonical contract",
        );
        return Err(("schema", true));
    }
    if !request.resource_scope.live() {
        settle(
            request,
            generation,
            true,
            "RPC_WS_RESOURCE_RETIRED",
            "Host resource changed before native result disclosure",
        );
        return Ok(());
    }
    let mut reply = WsReply::new(generation, result);
    reply.bulk = held;
    deliver(request, Ok(reply));
    Ok(())
}

struct InternalOperation {
    operation: Operation,
    deadline: Instant,
}
type SubscriptionBinding = (
    String,
    Value,
    Arc<ResourceScope>,
    Option<Arc<crate::control::receipts::WindowIssuer>>,
);
struct SubscriptionWork {
    union: DemandUnion,
    waiters: HashMap<MemberId, Request>,
    pending: HashMap<String, InternalOperation>,
    queued: VecDeque<Operation>,
    retired_opens: HashMap<String, String>,
    cohort_witnesses: HashMap<MemberId, super::ResumeProof>,
    bindings: HashMap<MemberId, SubscriptionBinding>,
}
impl SubscriptionWork {
    fn new(contracts: &Contracts) -> Self {
        Self {
            union: DemandUnion::new(
                contracts.limit("maxSubscriptionsPerSocket"),
                contracts.limit("maxSubscriptionsPerSocket"),
                contracts.limit("maxSubscriptionsPerHost"),
                contracts.limit("maxUnacknowledgedEvents"),
                contracts.limit("maxSubscriptionWindowBytes"),
                contracts.limit("maxSocketQueuedBytes"),
            ),
            waiters: HashMap::new(),
            pending: HashMap::new(),
            queued: VecDeque::new(),
            retired_opens: HashMap::new(),
            cohort_witnesses: HashMap::new(),
            bindings: HashMap::new(),
        }
    }
    fn effects(
        &mut self,
        shared: &Shared,
        contracts: &Contracts,
        generation: u64,
        effects: Effects,
    ) -> Result<(), (&'static str, bool)> {
        self.union.prune_missing();
        self.cohort_witnesses
            .retain(|id, _| self.union.is_ghost(id));
        let mut batches = VecDeque::from([effects]);
        while let Some(effects) = batches.pop_front() {
            for id in effects.retired {
                if let Some(retired) = self.pending.remove(&id) {
                    if retired.operation.kind == OperationKind::Open {
                        if self.retired_opens.len() >= contracts.limit("maxPendingRpc") {
                            return Err(("schema", true));
                        }
                        self.retired_opens.insert(
                            id,
                            retired.operation.params["subscriptionId"]
                                .as_str()
                                .unwrap_or("")
                                .into(),
                        );
                    }
                }
            }
            self.queued
                .retain(|operation| self.union.operation_current(operation));
            self.queued.extend(effects.operations);
            if self.queued.len() > contracts.limit("maxSubscriptionsPerSocket") {
                return Err(("schema", true));
            }
            for notice in effects.notices {
                match notice {
                    Notice::Opened { member, stream } => {
                        if let Some(request) = self.waiters.remove(&member) {
                            if !shared.active(&member.owner)
                                || shared.cancelled(&request.id)
                                || request
                                    .issuer
                                    .as_ref()
                                    .is_some_and(|issuer| !issuer.is_live())
                                || Instant::now() >= request.deadline
                                || !request.resource_scope.live()
                                || !request.subscription_epoch.as_deref().is_some_and(|token| {
                                    shared.permits.opened(
                                        &member.owner,
                                        &member.logical_id,
                                        token,
                                        &stream,
                                    )
                                })
                            {
                                settle(
                                    request,
                                    generation,
                                    false,
                                    "RPC_WS_CANCELLED",
                                    "Native subscription consumer detached before registration",
                                );
                                if let Ok(effects) = self.union.close(&member) {
                                    self.bindings.remove(&member);
                                    batches.push_back(effects);
                                }
                            } else {
                                deliver(
                                    request,
                                    Ok(WsReply::new(
                                        generation,
                                        json!({"subscriptionId":member.logical_id,"streamId":stream}),
                                    )),
                                );
                            }
                        }
                    }
                    Notice::Event { member, event } => {
                        let Some((token, target, _, issuer)) = self.bindings.get(&member) else {
                            continue;
                        };
                        if shared
                            .stream_grant(
                                contracts,
                                generation,
                                &member.owner,
                                &event,
                                token,
                                target,
                            )
                            .map_err(|category| (category, category != "overload"))?
                        {
                            let emit = || {
                                shared.emit(
                                    NativeEvent::Subscription {
                                        environment_id: shared.route.environment_id.clone(),
                                        generation,
                                        event,
                                    },
                                    Some(&member.owner),
                                );
                                Ok(())
                            };
                            if let Some(issuer) = issuer {
                                let _ = issuer.with_live(emit);
                            } else {
                                let _ = emit();
                            }
                        }
                    }
                    Notice::Rejected { member } => {
                        shared.remove_resume(&member);
                        if let Some((token, _, _, _)) = self.bindings.remove(&member) {
                            shared.permits.revoke_attempt(
                                &member.owner,
                                &member.logical_id,
                                &token,
                            );
                        }
                        if let Some(request) = self.waiters.remove(&member) {
                            settle(
                                request,
                                generation,
                                false,
                                "RPC_WS_SUBSCRIPTION",
                                "Host subscription resource is unavailable",
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    }
    fn request(
        &mut self,
        shared: &Shared,
        contracts: &Contracts,
        generation: u64,
        mut request: Request,
    ) -> Result<Option<Request>, (&'static str, bool)> {
        let logical_id = request.params["subscriptionId"]
            .as_str()
            .unwrap_or("")
            .to_owned();
        let member = MemberId::new(&request.consumer, &logical_id);
        if request.method != "subscriptions.open" {
            if let Some((_, _, _, original)) = self.bindings.get(&member) {
                let current = request.issuer.as_ref();
                let same = match (original.as_ref(), current) {
                    (Some(a), Some(b)) => Arc::ptr_eq(a, b) && a.is_live(),
                    (None, None) => true,
                    _ => false,
                };
                if !same {
                    settle(
                        request,
                        generation,
                        false,
                        "RPC_WS_DETACHED",
                        "Subscription belongs to a retired page",
                    );
                    return Ok(None);
                }
            }
        }
        let effects = match request.method.as_str() {
            "subscriptions.open" => {
                let shape = DemandUnion::shape(&request.params);
                let witness_matches = |proof: &super::ResumeProof| {
                    proof.shape == shape
                        && proof.cursor.as_ref() == request.params.get("cursor")
                        && proof.cursor.is_some()
                        && proof.resource.as_ref().is_some_and(|scope| scope.live())
                        && proof
                            .issuer
                            .as_ref()
                            .zip(request.issuer.as_ref())
                            .is_some_and(|(old, current)| {
                                Arc::ptr_eq(old, current) && current.is_live()
                            })
                };
                let rejoin = self
                    .cohort_witnesses
                    .get(&member)
                    .filter(|proof| witness_matches(proof))
                    .cloned();
                let conflicts = self
                    .cohort_witnesses
                    .iter()
                    .any(|(id, proof)| proof.shape == shape && (id != &member || rejoin.is_none()));
                if rejoin.is_none() && conflicts {
                    let effects = self.union.expire_cohorts(Instant::now(), |id| {
                        self.cohort_witnesses
                            .get(id)
                            .is_none_or(|proof| proof.shape != shape)
                    });
                    self.cohort_witnesses
                        .retain(|_, proof| proof.shape != shape);
                    self.effects(shared, contracts, generation, effects)?;
                }
                let mut adopted = rejoin.clone();
                let raw_cut = if rejoin.is_none() {
                    shared.take_resume_cut(&shape)
                } else {
                    None
                };
                let safe_single = raw_cut.as_ref().is_some_and(|cut| {
                    cut.len() == 1
                        && cut[0].0 == member
                        && witness_matches(&cut[0].1)
                        && shared.active(&member.owner)
                });
                let cut = if rejoin.is_none() {
                    raw_cut.filter(|cut| {
                        cut.len() > 1
                            && cut.iter().all(|(id, proof)| {
                                shared.active(&id.owner)
                                    && proof.resource.as_ref().is_some_and(|scope| scope.live())
                                    && proof.issuer.as_ref().is_some_and(|issuer| issuer.is_live())
                            })
                            && cut
                                .iter()
                                .any(|(id, proof)| *id == member && witness_matches(proof))
                    })
                } else {
                    None
                };
                let resume = if rejoin.is_none() && cut.is_none() {
                    shared.register_resume(
                        &member,
                        shape.clone(),
                        if safe_single {
                            request.params.get("cursor")
                        } else {
                            None
                        },
                        generation,
                        request.issuer.as_ref(),
                    )
                } else {
                    None
                };
                let opened = if let Some(proof) = rejoin {
                    self.cohort_witnesses.remove(&member);
                    self.union
                        .rejoin_cohort(&member, &request.params, proof.cursor.as_ref().unwrap())
                        .map(|effects| (member.clone(), effects))
                } else if let Some(cut) = cut {
                    let members: Vec<_> = cut
                        .iter()
                        .map(|(id, proof)| (id.clone(), proof.cursor.clone().unwrap()))
                        .collect();
                    let result = self.union.open_cohort(
                        &request.consumer,
                        &request.params,
                        &members,
                        Instant::now() + Duration::from_secs(10),
                    );
                    if result.is_ok() {
                        for (id, proof) in cut {
                            if id == member {
                                adopted = Some(proof);
                            } else {
                                self.cohort_witnesses.insert(id, proof);
                            }
                        }
                    }
                    match result {
                        Ok(opened) => Ok(opened),
                        Err(_) => {
                            shared.register_resume(
                                &member,
                                shape.clone(),
                                None,
                                generation,
                                request.issuer.as_ref(),
                            );
                            self.union
                                .open_resumable(&request.consumer, &request.params, None)
                        }
                    }
                } else {
                    self.union
                        .open_resumable(&request.consumer, &request.params, resume.as_ref())
                };
                match opened {
                    Ok((member, effects)) => {
                        request.deadline = (Instant::now() + request.timeout).min(request.deadline);
                        if self.bindings.len() >= contracts.limit("maxSubscriptionsPerHost")
                            && !self.bindings.contains_key(&member)
                        {
                            settle(
                                request,
                                generation,
                                false,
                                "RPC_WS_OVERLOAD",
                                "Native logical subscription binding limit reached",
                            );
                            return Err(("overload", false));
                        }
                        self.bindings.insert(
                            member.clone(),
                            (
                                request.subscription_epoch.clone().unwrap_or_default(),
                                request.params["target"].clone(),
                                request.resource_scope.clone(),
                                request.issuer.clone(),
                            ),
                        );
                        if let Some(proof) = adopted {
                            shared.adopt_resume(
                                &member,
                                &proof,
                                generation,
                                request.resource_scope.clone(),
                            );
                        }
                        self.waiters.insert(member, request);
                        effects
                    }
                    Err(_) => {
                        shared.remove_resume(&member);
                        settle(
                            request,
                            generation,
                            false,
                            "RPC_WS_SUBSCRIPTION",
                            "Subscription identity, ownership or capacity is unavailable",
                        );
                        return Ok(None);
                    }
                }
            }
            "subscriptions.ack" => {
                match self.union.acknowledge(&member, &request.params["cursor"]) {
                    Ok(effects) => {
                        if let Some((_, _, resource, issuer)) = self.bindings.get(&member) {
                            let same_issuer = issuer
                                .as_ref()
                                .zip(request.issuer.as_ref())
                                .is_some_and(|(a, b)| Arc::ptr_eq(a, b));
                            if same_issuer {
                                shared.record_resume(
                                    &member,
                                    generation,
                                    request.params["cursor"].clone(),
                                    resource.clone(),
                                    request.issuer.as_ref(),
                                );
                            }
                        }
                        deliver(
                            request,
                            Ok(WsReply::new(generation, json!({"accepted":true}))),
                        );
                        effects
                    }
                    Err(_) => {
                        settle(request, generation, false, "RPC_WS_SUBSCRIPTION", "Subscription acknowledgement is outside this consumer's applied window");
                        return Ok(None);
                    }
                }
            }
            "subscriptions.close" => match self.union.close(&member) {
                Ok(effects) => {
                    shared.remove_resume(&member);
                    self.bindings.remove(&member);
                    if let Some(waiting) = self.waiters.remove(&member) {
                        settle(
                            waiting,
                            generation,
                            false,
                            "RPC_WS_CANCELLED",
                            "Subscription consumer released its pending registration",
                        );
                    }
                    deliver(
                        request,
                        Ok(WsReply::new(generation, json!({"accepted":true}))),
                    );
                    effects
                }
                Err(_) => {
                    settle(
                        request,
                        generation,
                        false,
                        "RPC_WS_SUBSCRIPTION",
                        "Subscription belongs to a different consumer or generation",
                    );
                    return Ok(None);
                }
            },
            _ => return Ok(Some(request)),
        };
        self.effects(shared, contracts, generation, effects)?;
        Ok(None)
    }
    fn maintenance(
        &mut self,
        shared: &Shared,
        contracts: &Contracts,
        generation: u64,
    ) -> Result<(), (&'static str, bool)> {
        let cohort_expiry = self.union.expire_cohorts(Instant::now(), |id| {
            self.cohort_witnesses.get(id).is_some_and(|proof| {
                shared.active(&id.owner)
                    && proof.resource.as_ref().is_some_and(|scope| scope.live())
                    && proof.issuer.as_ref().is_some_and(|issuer| issuer.is_live())
            })
        });
        self.effects(shared, contracts, generation, cohort_expiry)?;
        let expired: Vec<_> = self
            .waiters
            .iter()
            .filter(|(_, request)| {
                Instant::now() >= request.deadline
                    || !shared.active(&request.consumer)
                    || shared.cancelled(&request.id)
            })
            .map(|(member, _)| member.clone())
            .collect();
        for member in expired {
            self.bindings.remove(&member);
            if let Some(request) = self.waiters.remove(&member) {
                settle(
                    request,
                    generation,
                    false,
                    "RPC_WS_DEADLINE",
                    "Subscription registration deadline elapsed or consumer detached",
                );
                if let Ok(effects) = self.union.close(&member) {
                    self.effects(shared, contracts, generation, effects)?;
                }
            }
        }
        let detached = self.union.detach(|owner| shared.active(owner));
        self.bindings
            .retain(|member, _| shared.active(&member.owner));
        self.effects(shared, contracts, generation, detached)?;
        if let Some(id) = self
            .pending
            .iter()
            .find(|(_, operation)| Instant::now() >= operation.deadline)
            .map(|(id, _)| id.clone())
        {
            let operation = self.pending.remove(&id).unwrap();
            let effects = self.union.failed(&operation.operation);
            self.effects(shared, contracts, generation, effects)?;
            // Never claim an upstream close or cumulative ACK that timed out.
            return Err(("schema", true));
        }
        Ok(())
    }
    async fn flush(
        &mut self,
        shared: &Shared,
        contracts: &Contracts,
        generation: u64,
        connection: &mut Connected,
        ordinary_controls: usize,
    ) -> Result<(), (&'static str, bool)> {
        while self.pending.len() + ordinary_controls < contracts.limit("maxControlJobsPerDevice") {
            let Some(operation) = self.queued.pop_front() else {
                break;
            };
            if !self.union.operation_current(&operation) {
                continue;
            }
            if !self.union.requires_wire(&operation) {
                let effects = self
                    .union
                    .complete(&operation, &json!({"accepted":true}))
                    .map_err(|_| ("schema", true))?;
                self.effects(shared, contracts, generation, effects)?;
                continue;
            }
            if !connection.supports(contracts, operation.method) {
                return Err(("schema", true));
            }
            let timeout = contracts.methods[operation.method].timeout;
            let value = json!({"jsonrpc":"2.0","id":operation.id,"method":operation.method,"params":operation.params});
            if !time::timeout(timeout, send(&mut connection.socket, contracts, value))
                .await
                .unwrap_or(false)
            {
                return Err(("unavailable", false));
            }
            self.union.sent(&operation);
            self.pending.insert(
                operation.id.clone(),
                InternalOperation {
                    operation,
                    deadline: Instant::now() + timeout,
                },
            );
        }
        // A window can close while a queued open is waiting for wire capacity.
        let detached = self.union.detach(|owner| shared.active(owner));
        self.effects(shared, contracts, generation, detached)
    }
    fn response(
        &mut self,
        shared: &Shared,
        contracts: &Contracts,
        generation: u64,
        id: &str,
        value: &Value,
    ) -> Result<bool, (&'static str, bool)> {
        let Some(pending) = self.pending.remove(id) else {
            return Ok(false);
        };
        if !self.union.operation_current(&pending.operation) {
            return Ok(true);
        }
        if value.get("error").is_some() {
            let effects = self.union.failed(&pending.operation);
            self.effects(shared, contracts, generation, effects)?;
            return Err(remote_error_class(value));
        }
        if !contracts.methods[pending.operation.method]
            .result
            .is_valid(&value["result"])
        {
            let effects = self.union.failed(&pending.operation);
            self.effects(shared, contracts, generation, effects)?;
            return Err(("schema", true));
        }
        let effects = self
            .union
            .complete(&pending.operation, &value["result"])
            .map_err(|_| ("schema", true))?;
        self.effects(shared, contracts, generation, effects)?;
        Ok(true)
    }
    fn event(
        &mut self,
        shared: &Shared,
        contracts: &Contracts,
        generation: u64,
        value: &Value,
    ) -> Result<(), (&'static str, bool)> {
        let wire = value["params"]["subscriptionId"].as_str().unwrap_or("");
        if !self.union.knows_wire(wire) {
            return Ok(());
        }
        let effects = self.union.event(value).map_err(|_| ("schema", true))?;
        if matches!(
            value["params"]["kind"].as_str(),
            Some("closed" | "resync-required")
        ) {
            for notice in &effects.notices {
                let member = match notice {
                    Notice::Opened { member, .. }
                    | Notice::Event { member, .. }
                    | Notice::Rejected { member } => member,
                };
                if let Some((_, target, _, _)) = self.bindings.get(member) {
                    shared
                        .permits
                        .retire_resource(target, value["params"]["kind"] == "closed");
                }
            }
        }
        self.effects(shared, contracts, generation, effects)
    }
}

fn ordinary_control_count(contracts: &Contracts, pending: &HashMap<String, Request>) -> usize {
    pending
        .values()
        .filter(|request| contracts.methods[&request.method].control(&request.params))
        .count()
}

async fn serve(
    shared: &Shared,
    contracts: &Contracts,
    generation: u64,
    mut connection: Connected,
    rx: &mut channel::Receiver<Request>,
    queued: &mut VecDeque<Request>,
) -> (&'static str, bool) {
    let mut pending: HashMap<String, Request> = HashMap::new();
    let mut subscriptions = SubscriptionWork::new(contracts);
    let mut parked_controls = VecDeque::<Request>::new();
    let (bulk_tx, mut bulk_rx) =
        channel::channel::<(String, Result<bulk::Resolved, &'static str>)>(2);
    // At most two 32 MiB decoded transfers occupy memory concurrently. Waiting
    // references are bounded by the same 64 RPC slots as ordinary requests.
    let bulk_slots = Arc::new(tokio::sync::Semaphore::new(2));
    let mut heartbeat = Instant::now() + contracts.duration("heartbeatIntervalMs");
    let mut ping: Option<(Vec<u8>, Instant)> = None;
    let failure = 'serve: loop {
        // Run maintenance before waiting: subscription handling can continue the
        // loop after queuing an open, close or acknowledgement.
        if shared.stopped() {
            break ("unavailable", false);
        }
        let expired: Vec<_> = pending
            .iter()
            .filter(|(_, request)| {
                Instant::now() >= request.deadline
                    || !shared.active(&request.consumer)
                    || shared.cancelled(&request.id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(request) = pending.remove(&id) {
                // Best-effort query cancellation is a separate control attempt. No
                // mutation is undone and no durable command is replayed here.
                if !request.mutating
                    && request.method != "requests.cancel"
                    && connection.methods.contains("requests.cancel")
                {
                    let _ = send(
                        &mut connection.socket,
                        contracts,
                        json!({"jsonrpc":"2.0", "id":uuid::Uuid::new_v4().to_string(),
                        "method":"requests.cancel","params":{"requestId":id}}),
                    )
                    .await;
                }
                settle(
                    request,
                    generation,
                    true,
                    "RPC_WS_DEADLINE",
                    "Host request deadline elapsed or native consumer detached",
                );
            }
        }
        if let Err(failure) = subscriptions.maintenance(shared, contracts, generation) {
            break failure;
        }
        for _ in 0..parked_controls.len() {
            let request = parked_controls.pop_front().unwrap();
            if Instant::now() >= request.admission_deadline
                || !shared.active(&request.consumer)
                || shared.cancelled(&request.id)
                || request
                    .issuer
                    .as_ref()
                    .is_some_and(|issuer| !issuer.is_live())
            {
                settle(
                    request,
                    generation,
                    false,
                    "RPC_WS_CANCELLED",
                    "Native control request expired before wire admission",
                );
            } else {
                parked_controls.push_back(request);
            }
        }
        while ordinary_control_count(contracts, &pending) + subscriptions.pending.len()
            < contracts.limit("maxControlJobsPerDevice")
        {
            let Some(mut request) = parked_controls.pop_front() else {
                break;
            };
            if !shared.active(&request.consumer)
                || shared.cancelled(&request.id)
                || request
                    .issuer
                    .as_ref()
                    .is_some_and(|issuer| !issuer.is_live())
                || Instant::now() >= request.admission_deadline
            {
                settle(
                    request,
                    generation,
                    false,
                    "RPC_WS_CANCELLED",
                    "Native control request expired before wire admission",
                );
                continue;
            }
            request.deadline = (Instant::now() + request.timeout).min(request.deadline);
            let envelope = json!({"jsonrpc":"2.0","id":request.wire_id,"method":request.method,"params":request.params});
            if !time::timeout(
                request.deadline.saturating_duration_since(Instant::now()),
                send(&mut connection.socket, contracts, envelope),
            )
            .await
            .unwrap_or(false)
            {
                settle(
                    request,
                    generation,
                    true,
                    "RPC_WS_INTERRUPTED",
                    "Native control request could not be sent",
                );
                break 'serve ("unavailable", false);
            }
            pending.insert(request.wire_id.clone(), request);
        }
        if let Err(failure) = subscriptions
            .flush(
                shared,
                contracts,
                generation,
                &mut connection,
                ordinary_control_count(contracts, &pending),
            )
            .await
        {
            break failure;
        }
        if ping
            .as_ref()
            .is_some_and(|(_, deadline)| Instant::now() >= *deadline)
        {
            break ("unavailable", false);
        }
        if Instant::now() >= heartbeat && ping.is_none() {
            let payload = uuid::Uuid::new_v4().as_bytes().to_vec();
            if !matches!(
                time::timeout(
                    contracts.duration("heartbeatResponseTimeoutMs"),
                    connection
                        .socket
                        .send(Message::Ping(payload.clone().into()))
                )
                .await,
                Ok(Ok(()))
            ) {
                break ("unavailable", false);
            }
            ping = Some((
                payload,
                Instant::now() + contracts.duration("heartbeatResponseTimeoutMs"),
            ));
            heartbeat = Instant::now() + contracts.duration("heartbeatIntervalMs");
        }
        let wake = pending
            .values()
            .map(|request| request.deadline)
            .chain(
                subscriptions
                    .waiters
                    .values()
                    .map(|request| request.deadline),
            )
            .chain(
                subscriptions
                    .pending
                    .values()
                    .map(|operation| operation.deadline),
            )
            .chain(
                parked_controls
                    .iter()
                    .map(|request| request.admission_deadline),
            )
            .chain(subscriptions.union.next_cohort_deadline())
            .chain(std::iter::once(
                ping.as_ref()
                    .map(|(_, deadline)| *deadline)
                    .unwrap_or(heartbeat),
            ))
            .min()
            .unwrap_or(heartbeat);
        tokio::select! {
            _ = shared.changed.notified() => {},
            _ = time::sleep_until(wake.into()) => {},
            completion = bulk_rx.recv() => {
                let Some((id, result)) = completion else { continue; };
                let Some(request) = pending.remove(&id) else { continue; };
                if Instant::now() >= request.deadline || !shared.active(&request.consumer) || shared.cancelled(&request.id) {
                    settle(request, generation, true, "RPC_WS_DEADLINE", "Host bulk result arrived after cancellation or deadline");
                    continue;
                }
                match result.and_then(bulk::Resolved::parts) {
                    Ok((value,held)) => {
                        if let Err(failure) = complete_result(shared, contracts, generation, request, value,Some(held)) { break failure; }
                    },
                    Err(category) => {
                        settle(request, generation, true, "RPC_WS_BULK", "Authenticated Host bulk result could not be verified or completed");
                        if matches!(category, "schema" | "identity") { break (category, true); }
                    }
                }
            },
            request = async { match queued.pop_front() { Some(request) => Some(request), None => rx.recv().await } } => {
                let Some(mut request) = request else { break ("unavailable", false); };
                if shared.stopped() {
                    settle(request, generation, false, "RPC_WS_DETACHED", "Native connection detached before dispatch");
                    break ("unavailable", false);
                }
                if !shared.active(&request.consumer) || shared.cancelled(&request.id) || request.issuer.as_ref().is_some_and(|issuer| !issuer.is_live()) {
                    settle(request, generation, false, "RPC_WS_CANCELLED", "Host request was cancelled before dispatch"); continue;
                }
                if !request.resource_scope.live() {
                    settle(request,generation,false,"RPC_WS_RESOURCE_RETIRED","Host resource changed before request dispatch");continue;
                }
                if Instant::now() >= request.admission_deadline {
                    settle(request, generation, false, "RPC_WS_DEADLINE", "Host request admission deadline elapsed"); continue;
                }
                if !connection.supports(contracts, &request.method) {
                    let error = WsFailure::unsupported().for_request(&request, generation, false);
                    deliver(request, Err(error)); continue;
                }
                if pending.contains_key(&request.wire_id) {
                    settle(request, generation, false, "RPC_WS_DUPLICATE_ID", "Host request identity is already pending"); continue;
                }
                request = match subscriptions.request(shared, contracts, generation, request) {
                    Ok(Some(request)) => request, Ok(None) => continue, Err(failure) => break failure,
                };
                if contracts.methods[&request.method].control(&request.params)
                    && ordinary_control_count(contracts, &pending) + subscriptions.pending.len() >= contracts.limit("maxControlJobsPerDevice") {
                    parked_controls.push_back(request); continue;
                }
                request.deadline = (Instant::now() + request.timeout).min(request.deadline);
                let value = json!({"jsonrpc":"2.0", "id":request.wire_id,"method":request.method,"params":request.params});
                let Some(send_budget) = request.deadline.checked_duration_since(Instant::now()).filter(|budget| !budget.is_zero()) else {
                    settle(request, generation, false, "RPC_WS_DEADLINE", "Native operation deadline elapsed before socket send"); continue;
                };
                if !time::timeout(send_budget, send(&mut connection.socket, contracts, value)).await.unwrap_or(false) {
                    settle(request, generation, true, "RPC_WS_INTERRUPTED", "Host connection was interrupted while sending a request");
                    break ("unavailable", false);
                }
                pending.insert(request.wire_id.clone(), request);
            },
            message = connection.socket.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(value) = serde_json::from_str::<Value>(&text) else { break ("schema", true); };
                        if value.get("method").is_some() {
                            if !contracts.event.is_valid(&value) { break ("schema", true); }
                            if let Err(failure) = subscriptions.event(shared, contracts, generation, &value) { break failure; }
                            continue;
                        }
                        if !contracts.response.is_valid(&value) { break ("schema", true); }
                        let Some(id) = value["id"].as_str() else { break ("schema", true); };
                        match subscriptions.response(shared, contracts, generation, id, &value) {
                            Ok(true) => continue, Ok(false) => {}, Err(failure) => break failure,
                        }
                        let Some(mut request) = pending.remove(id) else {
                            if let Some(subscription) = subscriptions.retired_opens.remove(id) {
                                // An open can finish after its original wait was cancelled.
                                let _ = send(&mut connection.socket, contracts, json!({"jsonrpc":"2.0", "id":uuid::Uuid::new_v4().to_string(),
                                    "method":"subscriptions.close","params":{"subscriptionId":subscription}})).await;
                            }
                            continue;
                        }; // Late/cancelled replies never enter a newer attempt.
                        if Instant::now() >= request.deadline || !shared.active(&request.consumer) || shared.cancelled(&request.id) {
                            settle(request, generation, true, "RPC_WS_DEADLINE", "Host result arrived after the request deadline or cancellation"); continue;
                        }
                        if value.get("error").is_some() {
                            let category = value["error"]["data"]["category"].as_str().unwrap_or("internal");
                            let message:String = value["error"]["message"].as_str().unwrap_or("Host rejected the request")
                                .chars().filter(|character| !character.is_control()).take(1000).collect();
                            let message = message.replace(shared.route.token.as_str(), "[redacted]");
                            let mut error = WsFailure::local("RPC_WS_REMOTE", &message).for_request(&request, generation, true);
                            error.uncertain = request.mutating && !matches!(category, "validation" | "authentication" | "identity" | "schema" | "overload");
                            let delivery = value["error"]["data"]["delivery"].as_str();
                            if matches!(delivery, Some("unknown" | "accepted")) { error.uncertain = true; }
                            else if delivery == Some("not-sent") { error.uncertain = false; }
                            if let Some(command_id) = value["error"]["data"]["commandId"].as_str() {
                                if request.command_id.as_deref().is_some_and(|original| original != command_id) {
                                    settle(request, generation, true, "RPC_WS_SCHEMA", "Host error changed the durable command identity");
                                    break ("schema", true);
                                }
                                error.command_id = Some(command_id.into());
                            }
                            deliver(request, Err(error));
                            if matches!(category, "authentication" | "identity" | "schema") {
                                break (match category {"authentication"=>"authentication","identity"=>"identity",_=>"schema"}, true);
                            }
                            continue;
                        }
                        match bulk::reference(contracts, &value["result"]) {
                            Err(()) => {
                                settle(request, generation, true, "RPC_WS_SCHEMA", "Host bulk result reference is invalid"); break ("schema", true);
                            },
                            Ok(Some(descriptor)) => {
                                if request.download_cancel.is_some() { pending.insert(id.into(), request); continue; }
                                let descriptor = descriptor.clone();
                                let disclosure=match shared.permits.unary(contracts,&request.consumer,generation,&request.id,&descriptor,request.resource_scope.clone()) {
                                    Ok(grant)=>grant,
                                    Err(category)=>{
                                        settle(request,generation,true,"RPC_WS_BULK_GRANT","Host bulk reference could not be admitted for its native request");
                                        if matches!(category,"schema"|"identity") {break (category,true);}
                                        continue;
                                    },
                                };
                                request.download_grant=Some(disclosure.grant());
                                let route = shared.route.clone();
                                let cancel = Arc::new(AtomicBool::new(false));
                                request.download_cancel = Some(cancel.clone());
                                let deadline = request.deadline;
                                let sender = bulk_tx.clone();
                                let slots = bulk_slots.clone();
                                let id = id.to_owned();
                                pending.insert(id.clone(), request);
                                tokio::spawn(async move {
                                    let Ok(permit) = slots.acquire_owned().await else { return; };
                                    if cancel.load(Ordering::Acquire) { return; }
                                    let output = tokio::task::spawn_blocking(move || bulk::resolve(&route, &descriptor, deadline, &cancel,disclosure)).await.unwrap_or(Err("unavailable"));
                                    let _ = sender.send((id, output)).await;
                                    drop(permit);
                                });
                            },
                            Ok(None) => {
                                if let Err(failure) = complete_result(shared, contracts, generation, request, value["result"].clone(),None) { break failure; }
                            },
                        }
                    },
                    Some(Ok(Message::Ping(data))) => {
                        if !matches!(time::timeout(contracts.duration("heartbeatResponseTimeoutMs"), connection.socket.send(Message::Pong(data))).await, Ok(Ok(()))) { break ("unavailable", false); }
                    },
                    Some(Ok(Message::Pong(data))) => { if ping.as_ref().is_some_and(|(expected, _)| expected.as_slice() == data.as_ref()) { ping = None; } },
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break ("unavailable", false),
                    _ => break ("schema", true),
                }
            },
        }
    };
    // Physical retirement invalidates every bulk grant. An inline reply already
    // delivered before the disconnect remains a completed RPC; explicit route,
    // owner and validated resource revocation still fence its retained scope.
    shared.capture_resume_cuts(generation, subscriptions.union.retirement_cut());
    shared.permits.phase(generation, false);
    for (_, request) in pending {
        settle(
            request,
            generation,
            true,
            "RPC_WS_INTERRUPTED",
            "Host connection ended before the result was known",
        );
    }
    for (_, request) in subscriptions.waiters {
        settle(
            request,
            generation,
            false,
            "RPC_WS_INTERRUPTED",
            "Host subscription connection ended before registration",
        );
    }
    for request in parked_controls {
        settle(
            request,
            generation,
            false,
            "RPC_WS_INTERRUPTED",
            "Native control connection ended before wire admission",
        );
    }
    let _ = time::timeout(Duration::from_millis(100), connection.socket.close(None)).await;
    failure
}

#[cfg(test)]
mod reauthentication_tests {
    use super::*;
    use crate::host_ws::tests::{accept, hello, next, result, Server};
    use crate::host_ws::{NativeEvent, NativeRoute, RequestOptions};
    use std::sync::{mpsc as std_mpsc, Arc};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn upgrade_401_is_permanent_only_without_an_earlier_success_or_after_the_streak() {
        assert_eq!(
            unauthorized_disposition(false, 1),
            ("authentication", true),
            "a lane that never authenticated keeps the immediate block"
        );
        for streak in 1..=REAUTHENTICATION_RETRY_ATTEMPTS {
            assert_eq!(
                unauthorized_disposition(true, streak),
                ("authentication", false),
                "401 #{streak} after a success is a temporary refusal"
            );
        }
        assert_eq!(
            unauthorized_disposition(true, REAUTHENTICATION_RETRY_ATTEMPTS + 1),
            ("authentication", true),
            "the fourth consecutive 401 blocks the lane"
        );
    }

    // Answers the next upgrade with a plain HTTP 401, which tungstenite reports
    // as an HTTP error rather than a WebSocket handshake.
    async fn refuse_upgrade(listener: &tokio::net::TcpListener) {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            match stream.read_u8().await {
                Ok(byte) => head.push(byte),
                Err(_) => break,
            }
        }
        stream
            .write_all(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        let _ = stream.shutdown().await;
    }

    fn project_list(id: &str) -> Value {
        json!([{"id":id,"cwd":"/fixture","name":"fixture"}])
    }

    fn route(server: &Server) -> NativeRoute {
        NativeRoute::new(
            "machine.1",
            "host.1",
            &server.endpoint,
            "secret-native-token",
            "principal.1",
        )
        .unwrap()
    }

    fn wait_for_phase(events: &std_mpsc::Receiver<NativeEvent>, wanted: &str) {
        loop {
            match events
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
            {
                NativeEvent::State { phase, .. } if phase == wanted => return,
                _ => {}
            }
        }
    }

    #[test]
    fn upgrade_401_after_success_is_retried_and_the_lane_recovers() {
        let server = Server::spawn(|listener| async move {
            let mut first = accept(&listener).await;
            hello(&mut first, &["projects.list"], "host.1").await;
            let request = next(&mut first).await;
            result(&mut first, &request, project_list("before-restart")).await;
            drop(first);
            // A restarting Host refuses three upgrades, then accepts again.
            for _ in 0..3 {
                refuse_upgrade(&listener).await;
            }
            let mut recovered = accept(&listener).await;
            hello(&mut recovered, &["projects.list"], "host.1").await;
            let request = next(&mut recovered).await;
            result(&mut recovered, &request, project_list("after-restart")).await;
        });
        let broker = super::super::HostWsBroker::default();
        let route = route(&server);
        let (events_tx, events) = std_mpsc::channel();
        broker
            .attach(
                &route,
                "window.a",
                Arc::new(move |event| {
                    let _ = events_tx.send(event);
                }),
            )
            .unwrap();
        let first = broker
            .request(
                &route,
                "window.a",
                "projects.list",
                json!({}),
                RequestOptions::default(),
            )
            .unwrap();
        assert_eq!(first.result, project_list("before-restart"));
        wait_for_phase(&events, "retry-wait");
        let second = broker
            .request(
                &route,
                "window.a",
                "projects.list",
                json!({}),
                RequestOptions::default(),
            )
            .unwrap();
        assert_eq!(second.result, project_list("after-restart"));
        drop(server);
        broker.shutdown();
    }

    #[test]
    fn a_fourth_consecutive_upgrade_401_after_success_blocks_the_lane() {
        let server = Server::spawn(|listener| async move {
            let mut first = accept(&listener).await;
            hello(&mut first, &["projects.list"], "host.1").await;
            drop(first);
            for _ in 0..4 {
                refuse_upgrade(&listener).await;
            }
        });
        let broker = super::super::HostWsBroker::default();
        let route = route(&server);
        let (events_tx, events) = std_mpsc::channel();
        broker
            .attach(
                &route,
                "window.a",
                Arc::new(move |event| {
                    let _ = events_tx.send(event);
                }),
            )
            .unwrap();
        wait_for_phase(&events, "blocked");
        let failure = broker
            .request(
                &route,
                "window.a",
                "projects.list",
                json!({}),
                RequestOptions::default(),
            )
            .unwrap_err();
        assert_eq!(failure.code, "RPC_WS_BLOCKED");
        drop(server);
        broker.shutdown();
    }
}
