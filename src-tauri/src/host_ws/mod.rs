//! Process-owned native WebSocket JSON-RPC broker.
//!
//! Callers resolve saved credentials and any verified SSH tunnel before constructing
//! a route. Only loopback WS or webpki-verified WSS is accepted. This module never
//! returns credentials, replays a request, stops Host work, or acknowledges
//! beyond the minimum cursor actually committed by its retained windows.
//! The blocking request API belongs on Tauri's blocking command thread, not the UI.
mod bulk;
mod commit;
mod connection;
mod demand;
pub(crate) mod native_profile;
mod permits;
mod schema;

use schema::Contracts;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc as channel, Notify};
use url::Url;
use zeroize::Zeroizing;

pub type EventSink = Arc<dyn Fn(NativeEvent) + Send + Sync>;

// Canonical IdentifierSchema permits at most 200 ASCII bytes. Keep the
// compatibility decision conservative for every legal caller request ID;
// generated-envelope boundary tests prevent this reservation drifting silently.
const MAX_REQUEST_ID_BYTES: usize = 200;
fn native_profile_recovery(method: &str) -> bool {
    matches!(
        method,
        "native.buffers.recovery.list"
            | "native.buffers.recovery.read"
            | "native.buffers.recovery.status"
    )
}

fn private_native_method(method: &str) -> bool {
    method.starts_with("native.") || method.starts_with("devServers.bridge")
}

fn native_gateway_method(method: &str) -> bool {
    matches!(
        method,
        "devServers.bridgeOpen"
            | "devServers.bridgeWrite"
            | "devServers.bridgeRead"
            | "devServers.bridgeCheck"
            | "devServers.bridgeClose"
    )
}

fn native_device_method(method: &str) -> bool {
    matches!(
        method,
        "devices.status"
            | "devices.preflight"
            | "devices.preview"
            | "devices.preview.status"
            | "devices.list"
            | "devices.start"
            | "devices.boot"
            | "devices.capture"
            | "devices.control.status"
            | "devices.control.claim"
            | "devices.control.release"
            | "devices.control.renew"
            | "devices.inspect"
            | "devices.action"
    )
}

fn native_delivery_epoch_method(method: &str) -> bool {
    matches!(
        method,
        "native.delivery.epochs.open"
            | "native.delivery.epochs.status"
            | "native.delivery.epochs.compact"
            | "native.delivery.epochs.close"
    )
}

fn native_service_method(method: &str) -> bool {
    matches!(
        method,
        "native.services.runtimeLogs.bridge.describe"
            | "native.services.desktop.stop"
            | "native.services.desktop.status"
            | "native.services.desktop.status.wait"
            | "native.services.assistant.presence.get"
            | "native.services.assistant.presence.set"
            | "native.services.assistant.visibility.epoch"
            | "native.services.assistant.delegation.publicKey"
            | "native.services.assistant.delegation.origin"
            | "native.services.assistant.delegation.nativeChallenge"
            | "native.services.assistant.delegation.attest"
            | "native.services.assistant.delegation.issue"
            | "native.services.assistant.delegation.issue.status"
            | "native.services.assistant.delegation.challenge"
            | "native.services.assistant.delegation.call"
            | "native.services.assistant.delegation.revoke"
            | "native.services.assistant.visibility.revoke"
            | "native.services.assistant.visibility.reopen"
            | "native.services.runtimeLogs.access.issue"
            | "native.services.runtimeLogs.terminals.append"
            | "native.services.conversation.bridge.describe"
            | "native.services.conversation.access.issue"
            | "native.services.conversation.desktop.take"
            | "native.services.conversation.desktop.finish"
            | "native.services.conversation.desktop.authorize"
            | "native.services.social.bridge.describe"
            | "native.services.social.access.issue"
            | "native.services.social.native.status"
            | "native.services.social.native.enroll"
            | "native.services.social.native.register"
            | "native.services.social.native.authority"
            | "native.services.social.native.reset"
            | "native.services.workspace.format"
            | "native.services.upload.begin"
            | "native.services.upload.append"
            | "native.services.upload.commit"
            | "native.services.upload.status"
            | "native.services.upload.cancel"
            | "native.services.delivery.apply"
            | "native.services.delivery.status"
            | "native.services.delivery.ack"
            | "native.services.delivery.result.read"
    ) || native_delivery_epoch_method(method)
}

#[cfg(test)]
mod desktop_stop_scope_tests {
    use super::*;
    #[test]
    fn emergency_stop_is_a_local_native_service_only() {
        // Room browser panel disclosure is fenced by the HTTP response owner;
        // WebSocket must reject before dispatch so only authenticated fallback runs.
        assert!(!native_service_method("native.services.assistant.browser.panel"));
        assert!(native_service_method("native.services.desktop.stop"));
        assert!(native_service_method("native.services.desktop.status"));
        assert!(!native_peer_service_method(
            "native.services.desktop.status"
        ));
        assert!(!native_peer_service_method("native.services.desktop.stop"));
        assert!(!native_service_method("native.services.desktop.act"));
        assert!(!native_service_method("native.services.desktop.resume"));
        assert!(!native_service_method("desktop.request"));
        for method in [
            "native.services.assistant.presence.get",
            "native.services.assistant.presence.set",
        ] {
            assert!(native_service_method(method));
            assert!(!native_peer_service_method(method));
        }
        assert!(!native_service_method("native.services.assistant.request"));
    }
}

pub(crate) fn native_peer_service_method(method: &str) -> bool {
    matches!(
        method,
        "native.services.social.native.status"
            | "native.services.assistant.delegation.nativeChallenge"
            | "native.services.assistant.delegation.issue"
            | "native.services.assistant.delegation.issue.status"
            | "native.services.assistant.delegation.challenge"
            | "native.services.assistant.delegation.call"
            | "native.services.assistant.delegation.revoke"
            | "native.services.social.native.enroll"
            | "native.services.social.native.register"
            | "native.services.social.native.authority"
            | "native.services.social.native.reset"
    )
}

fn native_workspace_method(method: &str) -> bool {
    matches!(
        method,
        "native.turn.begin"
            | "native.turn.end"
            | "native.activity.start"
            | "native.activity.end"
            | "native.buffers.update"
            | "native.buffers.retire"
            | "native.buffers.reconcile"
            | "native.buffers.recovery.list"
            | "native.buffers.recovery.read"
            | "native.buffers.recovery.status"
            | "native.rewind.plan"
            | "native.rewind.prepare"
            | "native.rewind.apply"
            | "native.rewind.status"
            | "native.rewind.lookup"
            | "native.rewind.cancelPreparation"
            | "native.rewind.ack"
            | "workspaces.cleanup.plan"
            | "workspaces.cleanup.apply"
            | "workspaces.cleanup.status"
            | "native.buffers.upload.start"
            | "native.buffers.upload.write"
            | "native.buffers.upload.commit"
            | "native.buffers.upload.status"
            | "native.buffers.upload.abort"
            | "native.buffers.delivery.apply"
            | "native.buffers.delivery.status"
            | "native.buffers.delivery.ack"
    ) || native_delivery_epoch_method(method)
}

#[derive(Serialize)]
struct BorrowedRequestEnvelope<'a> {
    jsonrpc: &'static str,
    id: &'a str,
    method: &'a str,
    params: &'a Value,
}

/// Counts actual UTF-8/JSON escaping without copying params or creating a full
/// serialized String. Serialization stops as soon as the frame budget is spent.
fn request_message_bytes(method: &str, id: &str, params: &Value, limit: usize) -> Option<usize> {
    struct BoundedSize {
        count: usize,
        limit: usize,
    }
    impl std::io::Write for BoundedSize {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.limit.saturating_sub(self.count) {
                return Err(std::io::Error::other(
                    "Host request exceeds its message size limit",
                ));
            }
            self.count += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut size = BoundedSize { count: 0, limit };
    serde_json::to_writer(
        &mut size,
        &BorrowedRequestEnvelope {
            jsonrpc: "2.0",
            id,
            method,
            params,
        },
    )
    .ok()?;
    Some(size.count)
}

/// Native-only input: deliberately has neither Debug nor Serialize.
#[derive(Clone)]
pub struct NativeRoute {
    machine_id: String,
    environment_id: String,
    endpoint: String,
    token: Arc<Zeroizing<String>>,
    key: String,
}

impl NativeRoute {
    /// `authorization_context` is a native credential/principal revision, never a
    /// renderer-provided scope. A credential or route change creates a new pipe.
    pub fn new(
        machine_id: &str,
        environment_id: &str,
        endpoint: &str,
        bearer: &str,
        authorization_context: &str,
    ) -> Result<Self, WsFailure> {
        if machine_id.is_empty()
            || environment_id.is_empty()
            || authorization_context.is_empty()
            || bearer.is_empty()
            || bearer.chars().any(char::is_control)
        {
            return Err(WsFailure::local(
                "RPC_WS_ROUTE",
                "Native Host route is invalid",
            ));
        }
        let mut url = Url::parse(endpoint)
            .map_err(|_| WsFailure::local("RPC_WS_ROUTE", "Native Host endpoint is invalid"))?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !matches!(url.path(), "" | "/" | "/ws")
        {
            return Err(WsFailure::local(
                "RPC_WS_ROUTE",
                "Native Host endpoint is invalid",
            ));
        }
        let secure = matches!(url.scheme(), "https" | "wss");
        if !secure && !(matches!(url.scheme(), "http" | "ws") && loopback(&url)) {
            return Err(WsFailure::local(
                "RPC_WS_TLS",
                "Remote Host requires verified TLS or a native SSH tunnel",
            ));
        }
        url.set_scheme(if secure { "wss" } else { "ws" })
            .map_err(|_| WsFailure::local("RPC_WS_ROUTE", "Native Host endpoint is invalid"))?;
        url.set_path("/ws");
        let endpoint = url.to_string();
        let mut digest = Sha256::new();
        for part in [
            machine_id,
            environment_id,
            endpoint.as_str(),
            authorization_context,
            bearer,
        ] {
            digest.update((part.len() as u64).to_be_bytes());
            digest.update(part.as_bytes());
        }
        let key = format!("{:x}", digest.finalize());
        Ok(Self {
            machine_id: machine_id.into(),
            environment_id: environment_id.into(),
            endpoint,
            token: Arc::new(Zeroizing::new(bearer.into())),
            key,
        })
    }
}

fn loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

#[derive(Clone, Default)]
pub struct RequestOptions {
    /// Optional native cancellation handle. Defaults to a new UUID.
    pub request_id: Option<String>,
    /// Durable identity supplied by the domain admission layer; never generated here.
    pub command_id: Option<String>,
    /// May shorten, but cannot extend, the canonical method deadline.
    pub response_timeout: Option<Duration>,
    /// Optional operation budget, including queue admission and socket send.
    /// A relative response timeout must never extend this absolute deadline.
    pub absolute_deadline: Option<Instant>,
    pub(crate) issuer: Option<Arc<crate::control::receipts::WindowIssuer>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsReply {
    pub generation: u64,
    pub result: Value,
    #[serde(skip)]
    disclosure: Option<Arc<ReplyDisclosure>>,
    #[serde(skip)]
    bulk: Option<Arc<bulk::Held>>,
}
struct ReplyDisclosure {
    resource: Arc<permits::ResourceScope>,
    failure: WsFailure,
}
impl std::fmt::Debug for ReplyDisclosure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("NativeReplyDisclosure")
    }
}
impl WsReply {
    fn new(generation: u64, result: Value) -> Self {
        Self {
            generation,
            result,
            disclosure: None,
            bulk: None,
        }
    }
    /// Native IPC adapters recheck after saved-route authorization, immediately
    /// before exposing the reply. Private fields never change the wire shape.
    pub fn disclose(self) -> Result<Self, WsFailure> {
        if let Some(disclosure) = &self.disclosure {
            if !disclosure.resource.live()
                || self.bulk.as_ref().is_some_and(|bulk| bulk.check().is_err())
            {
                return Err(disclosure.failure.clone());
            }
        }
        Ok(self)
    }
    /// Legacy Value IPC keeps this opaque native guard beside its projection
    /// through its final saved-route and disclosure check.
    pub fn into_guarded_result(self) -> (Value, ReplyGuard) {
        (
            self.result,
            ReplyGuard {
                disclosure: self.disclosure,
                bulk: self.bulk,
            },
        )
    }
}
pub struct ReplyGuard {
    disclosure: Option<Arc<ReplyDisclosure>>,
    bulk: Option<Arc<bulk::Held>>,
}
impl ReplyGuard {
    pub fn check(&self) -> Result<(), WsFailure> {
        if let Some(disclosure) = &self.disclosure {
            if !disclosure.resource.live()
                || self.bulk.as_ref().is_some_and(|bulk| bulk.check().is_err())
            {
                return Err(disclosure.failure.clone());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsFailure {
    pub code: String,
    pub message: String,
    pub generation: Option<u64>,
    pub request_id: Option<String>,
    pub command_id: Option<String>,
    /// True only when a mutating request may have reached the Host.
    pub uncertain: bool,
    /// Before dispatch only. Callers may negotiate a compatibility transport here.
    pub unsupported: bool,
}

impl WsFailure {
    pub(crate) fn local(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            generation: None,
            request_id: None,
            command_id: None,
            uncertain: false,
            unsupported: false,
        }
    }
    pub(crate) fn unsupported() -> Self {
        let mut value = Self::local(
            "RPC_WS_UNSUPPORTED",
            "Host does not advertise this WebSocket method",
        );
        value.unsupported = true;
        value
    }
    fn for_request(mut self, request: &Request, generation: u64, sent: bool) -> Self {
        self.generation = Some(generation);
        self.request_id = Some(request.id.clone());
        self.command_id = request.command_id.clone();
        self.uncertain = sent && request.mutating;
        self
    }
}

impl std::fmt::Display for WsFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for WsFailure {}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NativeEvent {
    State {
        environment_id: String,
        generation: u64,
        phase: String,
        category: Option<String>,
    },
    /// The caller advances/acknowledges a cursor only after its reducer commits.
    Subscription {
        environment_id: String,
        generation: u64,
        event: Value,
    },
}

struct Request {
    id: String,
    wire_id: String,
    consumer: String,
    issuer: Option<Arc<crate::control::receipts::WindowIssuer>>,
    method: String,
    params: Value,
    command_id: Option<String>,
    mutating: bool,
    deadline: Instant,
    admission_deadline: Instant,
    timeout: Duration,
    reply: mpsc::SyncSender<Result<WsReply, WsFailure>>,
    download_cancel: Option<Arc<AtomicBool>>,
    download_grant: Option<Arc<permits::Grant>>,
    subscription_epoch: Option<String>,
    resource_scope: Arc<permits::ResourceScope>,
    // A queued, writing, or pending request occupies exactly one bounded slot.
    _slot: Slot,
}
impl Drop for Request {
    fn drop(&mut self) {
        if let Some(cancel) = &self.download_cancel {
            cancel.store(true, Ordering::Release);
        }
        if let Some(grant) = &self.download_grant {
            grant.revoke();
        }
    }
}

struct Slot {
    pending: Arc<AtomicUsize>,
    bytes: Arc<AtomicUsize>,
    count: usize,
    ids: Arc<Mutex<HashMap<String, String>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
    id: String,
}
impl Drop for Slot {
    fn drop(&mut self) {
        self.pending.fetch_sub(1, Ordering::AcqRel);
        self.bytes.fetch_sub(self.count, Ordering::AcqRel);
        self.ids
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
        self.cancelled
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
    }
}

struct Shared {
    route: NativeRoute,
    consumers: Mutex<HashMap<String, Option<EventSink>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
    ids: Arc<Mutex<HashMap<String, String>>>,
    stop: AtomicBool,
    pending: Arc<AtomicUsize>,
    control_pending: Arc<AtomicUsize>,
    bytes: Arc<AtomicUsize>,
    control_bytes: Arc<AtomicUsize>,
    next_generation: Arc<AtomicU64>,
    last_state: Mutex<Option<NativeEvent>>,
    permits: Arc<permits::Permits>,
    resume: Mutex<HashMap<demand::MemberId, ResumeProof>>,
    resume_cuts: Mutex<HashMap<String, Vec<(demand::MemberId, ResumeProof)>>>,
    resume_disabled: AtomicBool,
    changed: Notify,
}

#[derive(Clone)]
struct ResumeProof {
    shape: Value,
    cursor: Option<Value>,
    generation: u64,
    resource: Option<Arc<permits::ResourceScope>>,
    issuer: Option<Arc<crate::control::receipts::WindowIssuer>>,
}

impl Shared {
    fn capture_resume_cuts(
        &self,
        generation: u64,
        cuts: Vec<(Value, Vec<(demand::MemberId, Value)>)>,
    ) {
        let active: HashSet<String> = self.consumers().keys().cloned().collect();
        let proofs = self
            .resume
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut captured = self
            .resume_cuts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        captured.clear();
        for (shape, members) in cuts {
            let witnesses: Option<Vec<_>> = members
                .into_iter()
                .map(|(id, cursor)| {
                    let proof = proofs.get(&id)?;
                    if proof.generation != generation
                        || proof.shape != shape
                        || proof.cursor.as_ref() != Some(&cursor)
                        || !active.contains(&id.owner)
                        || !proof.resource.as_ref().is_some_and(|scope| scope.live())
                        || !proof.issuer.as_ref().is_some_and(|issuer| issuer.is_live())
                    {
                        return None;
                    }
                    Some((id, proof.clone()))
                })
                .collect();
            captured.insert(shape.to_string(), witnesses.unwrap_or_default());
        }
    }

    fn take_resume_cut(&self, shape: &Value) -> Option<Vec<(demand::MemberId, ResumeProof)>> {
        self.resume_cuts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&shape.to_string())
    }

    fn adopt_resume(
        &self,
        member: &demand::MemberId,
        proof: &ResumeProof,
        generation: u64,
        resource: Arc<permits::ResourceScope>,
    ) {
        let mut adopted = proof.clone();
        adopted.generation = generation;
        adopted.resource = Some(resource);
        self.resume
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(member.clone(), adopted);
    }
    fn register_resume(
        &self,
        member: &demand::MemberId,
        shape: Value,
        requested: Option<&Value>,
        generation: u64,
        issuer: Option<&Arc<crate::control::receipts::WindowIssuer>>,
    ) -> Option<Value> {
        if self.resume_disabled.load(Ordering::Acquire) {
            return None;
        }
        let active: HashSet<String> = self.consumers().keys().cloned().collect();
        let mut proofs = self
            .resume
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        proofs.retain(|id, proof| {
            active.contains(&id.owner)
                && proof.issuer.as_ref().is_none_or(|issuer| issuer.is_live())
        });
        let unique = proofs
            .iter()
            .filter(|(_, proof)| proof.shape == shape)
            .count()
            == 1;
        let previous = proofs.remove(member);
        let candidate = previous
            .as_ref()
            .filter(|proof| {
                unique
                    && proof.shape == shape
                    && proof.generation < generation
                    && proof.cursor.as_ref() == requested
                    && requested.is_some()
                    && proof.resource.as_ref().is_some_and(|scope| scope.live())
                    && proof
                        .issuer
                        .as_ref()
                        .zip(issuer)
                        .is_some_and(|(prior, current)| {
                            Arc::ptr_eq(prior, current) && current.is_live()
                        })
            })
            .and_then(|proof| proof.cursor.clone());
        if proofs.len() >= 512 {
            proofs.clear();
            self.resume_disabled.store(true, Ordering::Release);
            return None;
        }
        proofs.insert(
            member.clone(),
            ResumeProof {
                shape,
                cursor: candidate.clone(),
                generation,
                resource: previous.and_then(|proof| {
                    if candidate.is_some() {
                        proof.resource
                    } else {
                        None
                    }
                }),
                issuer: issuer.cloned(),
            },
        );
        candidate
    }
    fn record_resume(
        &self,
        member: &demand::MemberId,
        generation: u64,
        cursor: Value,
        resource: Arc<permits::ResourceScope>,
        issuer: Option<&Arc<crate::control::receipts::WindowIssuer>>,
    ) {
        if !resource.live() || !self.active(&member.owner) {
            return;
        }
        if let Some(proof) = self
            .resume
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get_mut(member)
        {
            if proof.generation == generation
                && proof
                    .issuer
                    .as_ref()
                    .zip(issuer)
                    .is_some_and(|(prior, current)| {
                        Arc::ptr_eq(prior, current) && current.is_live()
                    })
            {
                proof.cursor = Some(cursor);
                proof.resource = Some(resource);
            }
        }
    }
    fn remove_resume(&self, member: &demand::MemberId) {
        self.resume
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(member);
    }
    fn consumers(&self) -> std::sync::MutexGuard<'_, HashMap<String, Option<EventSink>>> {
        self.consumers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    fn active(&self, consumer: &str) -> bool {
        self.consumers().contains_key(consumer)
    }
    fn stream_grant(
        &self,
        contracts: &Contracts,
        generation: u64,
        owner: &str,
        event: &Value,
        token: &str,
        target: &Value,
    ) -> Result<bool, &'static str> {
        let consumers = self.consumers();
        if self.stop.load(Ordering::Acquire) || !consumers.contains_key(owner) {
            return Ok(false);
        }
        match self
            .permits
            .stream_bound(contracts, owner, generation, event, token, target)
        {
            Ok(()) => Ok(true),
            Err("retired") => Ok(false),
            Err(error) => Err(error),
        }
    }
    fn bulk_lease(
        &self,
        consumer: &str,
        descriptor: &Value,
    ) -> Result<permits::Lease, &'static str> {
        let consumers = self.consumers();
        if self.stop.load(Ordering::Acquire) || !consumers.contains_key(consumer) {
            return Err("retired");
        }
        self.permits.fetch(consumer, descriptor)
    }
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Acquire) || self.consumers().is_empty()
    }
    fn cancelled(&self, id: &str) -> bool {
        self.cancelled
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(id)
    }
    fn emit(&self, event: NativeEvent, owner: Option<&str>) {
        if self.stop.load(Ordering::Acquire) && matches!(event, NativeEvent::Subscription { .. }) {
            return;
        }
        // No native locks are held while entering the shell's event adapter.
        let sinks: Vec<_> = self
            .consumers()
            .iter()
            .filter(|(id, _)| owner.is_none_or(|owner| owner == id.as_str()))
            .filter_map(|(_, sink)| sink.clone())
            .collect();
        for sink in sinks {
            sink(event.clone());
        }
    }
    fn state(&self, generation: u64, phase: &str, category: Option<&str>) {
        self.permits.phase(generation, phase == "ready");
        let event = NativeEvent::State {
            environment_id: self.route.environment_id.clone(),
            generation,
            phase: phase.into(),
            category: category.map(str::to_owned),
        };
        let mut state = self
            .last_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *state = Some(event.clone());
        self.emit(event, None);
    }
}

struct Handle {
    shared: Arc<Shared>,
    tx: channel::Sender<Request>,
}

/// Admission is nonblocking so a native credential-store lock can fence route
/// changes through enqueueing and be released before waiting on network work.
pub struct PendingRequest {
    rx: mpsc::Receiver<Result<WsReply, WsFailure>>,
    shared: Arc<Shared>,
    id: String,
    command_id: Option<String>,
    mutating: bool,
    wait: Duration,
    absolute_deadline: Option<Instant>,
}

/// Allocation and disclosure accounting are complete before any retained reply
/// gates are borrowed. Failed enqueue keeps the Request/Slot owned here so its
/// cleanup runs only after those gates have been released by the caller.
struct PreparedRequest {
    request: Option<Request>,
    pending: Option<PendingRequest>,
    handle: Arc<Handle>,
}

impl PreparedRequest {
    fn enqueue(&mut self) -> Result<PendingRequest, WsFailure> {
        let request = self.request.as_ref().ok_or_else(|| {
            WsFailure::local("RPC_WS_ADMISSION", "Native request was already enqueued")
        })?;
        if Instant::now() >= request.deadline {
            return Err(WsFailure::local(
                "RPC_WS_DEADLINE",
                "Native operation deadline elapsed before enqueue",
            ));
        }
        let request = self.request.take().expect("prepared request checked");
        if let Err(error) = self.handle.tx.try_send(request) {
            self.request = Some(error.into_inner());
            return Err(WsFailure::local(
                "RPC_WS_OVERLOAD",
                "Native Host request queue is unavailable",
            ));
        }
        Ok(self.pending.take().expect("prepared request owns its wait"))
    }
}

/// Holds the transfer budget and native disclosure grant until the IPC adapter
/// completes its final saved-credential check. It is never serialized itself.
pub struct PendingBulk {
    resolved: bulk::Resolved,
}
impl PendingBulk {
    pub fn disclose(self) -> Result<Value, WsFailure> {
        self.resolved
            .disclose()
            .map_err(|_| WsFailure::local("RPC_WS_BULK_GRANT", "Host bulk disclosure was revoked"))
    }
}

impl PendingRequest {
    fn wait_budget_at(&self, now: Instant) -> Duration {
        self.absolute_deadline.map_or(self.wait, |deadline| {
            deadline.saturating_duration_since(now)
        })
    }

    pub fn wait(self) -> Result<WsReply, WsFailure> {
        match self.rx.recv_timeout(self.wait_budget_at(Instant::now())) {
            Ok(result) => result.and_then(WsReply::disclose),
            Err(_) => {
                let ids = self
                    .shared
                    .ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if ids.contains_key(&self.id) {
                    self.shared
                        .cancelled
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .insert(self.id.clone());
                    self.shared.changed.notify_one();
                }
                let mut error = WsFailure::local(
                    "RPC_WS_INTERRUPTED",
                    "Native Host connection did not return a result",
                );
                error.request_id = Some(self.id);
                error.command_id = self.command_id;
                error.uncertain = self.mutating;
                Err(error)
            }
        }
    }
}
#[derive(Default)]
pub struct HostWsBroker {
    connections: Mutex<HashMap<String, Arc<Handle>>>,
    next_generation: Arc<AtomicU64>,
}

#[derive(Clone, Copy)]
enum RequestScope {
    Window,
    NativeProfile,
    NativeWorkspace,
    NativeGateway,
    NativeService,
    NativePeerService,
    NativeDevice,
}

impl HostWsBroker {
    fn connection(&self, route: &NativeRoute, consumer: &str) -> Result<Arc<Handle>, WsFailure> {
        if consumer.is_empty() {
            return Err(WsFailure::local(
                "RPC_WS_CONSUMER",
                "A native consumer identity is required",
            ));
        }
        let contracts = Contracts::get().map_err(|_| {
            WsFailure::local("RPC_WS_SCHEMA", "Native Host contracts are unavailable")
        })?;
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        connections.retain(|_, handle| !handle.shared.stop.load(Ordering::Acquire));
        if let Some(handle) = connections.get(&route.key) {
            handle
                .shared
                .consumers()
                .entry(consumer.into())
                .or_insert(None);
            return Ok(handle.clone());
        }
        if connections.len() >= contracts.limit("maxAuthenticatedSockets") {
            return Err(WsFailure::local(
                "RPC_WS_OVERLOAD",
                "Native Host connection limit reached",
            ));
        }
        let (tx, rx) = channel::channel(
            contracts.limit("maxPendingRpc") + contracts.limit("maxControlJobsPerDevice"),
        );
        let shared = Arc::new(Shared {
            route: route.clone(),
            consumers: Mutex::new(HashMap::from([(consumer.into(), None)])),
            cancelled: Arc::new(Mutex::new(HashSet::new())),
            resume: Mutex::new(HashMap::new()),
            resume_cuts: Mutex::new(HashMap::new()),
            resume_disabled: AtomicBool::new(false),
            ids: Arc::new(Mutex::new(HashMap::new())),
            stop: AtomicBool::new(false),
            pending: Arc::new(AtomicUsize::new(0)),
            bytes: Arc::new(AtomicUsize::new(0)),
            control_pending: Arc::new(AtomicUsize::new(0)),
            control_bytes: Arc::new(AtomicUsize::new(0)),
            next_generation: self.next_generation.clone(),
            last_state: Mutex::new(None),
            permits: Arc::new(permits::Permits::new(&route.environment_id)),
            changed: Notify::new(),
        });
        let handle = Arc::new(Handle {
            shared: shared.clone(),
            tx,
        });
        thread::Builder::new()
            .name("host-ws".into())
            .spawn(move || {
                // Retire the handle even if the runtime or worker panics.
                struct RetireWorker(Arc<Shared>);
                impl Drop for RetireWorker {
                    fn drop(&mut self) {
                        self.0.stop.store(true, Ordering::Release);
                    }
                }
                let _retire = RetireWorker(shared.clone());
                match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => {
                        runtime.block_on(connection::worker(shared.clone(), contracts, rx))
                    }
                    Err(_) => {
                        shared.state(0, "blocked", Some("internal"));
                    }
                }
            })
            .map_err(|_| {
                WsFailure::local(
                    "RPC_WS_UNAVAILABLE",
                    "Native Host connection could not start",
                )
            })?;
        connections.insert(route.key.clone(), handle.clone());
        Ok(handle)
    }

    /// Sink implementations must enqueue/emit promptly and must not block on an RPC.
    pub fn attach(
        &self,
        route: &NativeRoute,
        consumer: &str,
        sink: EventSink,
    ) -> Result<(), WsFailure> {
        let handle = self.connection(route, consumer)?;
        handle
            .shared
            .consumers()
            .insert(consumer.into(), Some(sink));
        // Replay while holding the state ordering lock, so a newly attached window
        // cannot observe a cached ready state after a newer retry/blocked state.
        let state = handle
            .shared
            .last_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(event) = state.as_ref() {
            handle.shared.emit(event.clone(), Some(consumer));
        }
        Ok(())
    }

    pub fn supports_method(method: &str) -> bool {
        Contracts::get().is_ok_and(|contracts| {
            let method = contracts.wire_method(method);
            method != "connection.hello"
                && !private_native_method(method)
                && contracts.methods.contains_key(method)
        })
    }

    /// Authenticated discovery may advertise a subset of the generated WS
    /// method families. This only permits negotiation; hello still gates every
    /// method by its inventory and exact required capability before dispatch.
    pub fn supports_ws_capability(capability: &str) -> bool {
        matches!(capability, "transport.ws.read.v2" | "transport.ws.v2")
            || Contracts::get().is_ok_and(|contracts| {
                contracts
                    .methods
                    .values()
                    .any(|method| method.required_capability.as_deref() == Some(capability))
            })
    }

    pub fn supports_params(method: &str, params: &Value) -> bool {
        Contracts::get().is_ok_and(|contracts| {
            let method = contracts.wire_method(method);
            method != "connection.hello"
                && !private_native_method(method)
                && contracts
                    .methods
                    .get(method)
                    .is_some_and(|descriptor| descriptor.params.is_valid(params))
                && request_message_bytes(
                    method,
                    &"i".repeat(MAX_REQUEST_ID_BYTES),
                    params,
                    contracts.limit("maxMessageBytes"),
                )
                .is_some()
        })
    }

    pub fn method_has_effect(method: &str) -> bool {
        Contracts::get().is_ok_and(|contracts| {
            let method = contracts.wire_method(method);
            contracts
                .methods
                .get(method)
                .is_some_and(|method| method.mutating)
        })
    }

    /// Resolves a stream event's data reference. It does not commit or ACK a cursor.
    pub fn fetch_bulk(
        &self,
        route: &NativeRoute,
        consumer: &str,
        descriptor: &Value,
        timeout: Option<Duration>,
    ) -> Result<PendingBulk, WsFailure> {
        let contracts = Contracts::get().map_err(|_| {
            WsFailure::local("RPC_WS_SCHEMA", "Native Host contracts are unavailable")
        })?;
        if !contracts
            .bulk_descriptor
            .as_ref()
            .is_some_and(|validator| validator.is_valid(descriptor))
        {
            return Err(WsFailure::local(
                "RPC_WS_SCHEMA",
                "Host bulk reference does not match its canonical contract",
            ));
        }
        let timeout = timeout
            .unwrap_or(contracts.duration("defaultResponseTimeoutMs"))
            .min(contracts.duration("maxResponseTimeoutMs"));
        // Never create a route, attach a new consumer, or accept authority from
        // renderer fields while resolving a stream descriptor.
        let shared = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&route.key)
            .map(|handle| handle.shared.clone())
            .filter(|shared| !shared.stop.load(Ordering::Acquire) && shared.active(consumer))
            .ok_or_else(|| {
                WsFailure::local(
                    "RPC_WS_BULK_GRANT",
                    "Host bulk reference is not owned by this window",
                )
            })?;
        let disclosure = shared.bulk_lease(consumer, descriptor).map_err(|_| {
            WsFailure::local(
                "RPC_WS_BULK_GRANT",
                "Host bulk reference is no longer owned by this window",
            )
        })?;
        bulk::resolve(
            route,
            descriptor,
            Instant::now() + timeout,
            &AtomicBool::new(false),
            disclosure,
        )
        .map(|resolved| PendingBulk { resolved })
        .map_err(|_| {
            WsFailure::local(
                "RPC_WS_BULK",
                "Authenticated Host bulk result could not be verified or completed",
            )
        })
    }

    #[cfg(test)]
    pub fn request(
        &self,
        route: &NativeRoute,
        consumer: &str,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<WsReply, WsFailure> {
        self.begin_request(route, consumer, method, params, options)?
            .wait()
    }

    pub fn begin_request(
        &self,
        route: &NativeRoute,
        consumer: &str,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<PendingRequest, WsFailure> {
        self.begin_request_scoped(
            route,
            consumer,
            method,
            params,
            options,
            RequestScope::Window,
        )
    }

    fn begin_request_scoped(
        &self,
        route: &NativeRoute,
        consumer: &str,
        method: &str,
        params: Value,
        options: RequestOptions,
        scope: RequestScope,
    ) -> Result<PendingRequest, WsFailure> {
        let mut prepared =
            self.prepare_request_scoped(route, consumer, method, params, options, scope)?;
        prepared.enqueue()
    }

    fn prepare_request_scoped(
        &self,
        route: &NativeRoute,
        consumer: &str,
        method: &str,
        params: Value,
        options: RequestOptions,
        scope: RequestScope,
    ) -> Result<PreparedRequest, WsFailure> {
        let contracts = Contracts::get().map_err(|_| {
            WsFailure::local("RPC_WS_SCHEMA", "Native Host contracts are unavailable")
        })?;
        let method = contracts.wire_method(method);
        if match scope {
            RequestScope::Window => private_native_method(method),
            RequestScope::NativeProfile => !native_profile_recovery(method),
            RequestScope::NativeWorkspace => !native_workspace_method(method),
            RequestScope::NativeGateway => !native_gateway_method(method),
            RequestScope::NativeService => !native_service_method(method),
            RequestScope::NativePeerService => !native_peer_service_method(method),
            RequestScope::NativeDevice => !native_device_method(method),
        } {
            return Err(WsFailure::unsupported());
        }
        let Some(descriptor) = contracts.methods.get(method) else {
            return Err(WsFailure::unsupported());
        };
        if method == "connection.hello" || !descriptor.params.is_valid(&params) {
            return Err(WsFailure::local(
                "RPC_WS_VALIDATION",
                "Host request does not match its canonical contract",
            ));
        }
        let id = options
            .request_id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        // Validate the request ID using the generated request envelope as well.
        let envelope = json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params});
        // The compiled request validator is cached separately with the manifest.
        if !contracts.request_valid(&envelope) {
            return Err(WsFailure::local(
                "RPC_WS_VALIDATION",
                "Host request does not match its canonical contract",
            ));
        }
        let byte_count =
            request_message_bytes(method, &id, &params, contracts.limit("maxMessageBytes"))
                .ok_or_else(|| {
                    WsFailure::local(
                        "RPC_WS_OVERLOAD",
                        "Host request exceeds its message size limit",
                    )
                })?;
        let param_command = params.get("commandId").and_then(Value::as_str);
        if options
            .command_id
            .as_deref()
            .zip(param_command)
            .is_some_and(|(option, param)| option != param)
        {
            return Err(WsFailure::local(
                "RPC_WS_COMMAND_ID",
                "Durable command identities disagree",
            ));
        }
        let command_id = options
            .command_id
            .or_else(|| param_command.map(str::to_owned));
        if descriptor.requires_command_id && command_id.is_none() {
            return Err(WsFailure::local(
                "RPC_WS_COMMAND_ID",
                "A durable command identity is required",
            ));
        }
        let handle = self.connection(route, consumer)?;
        if method == "subscriptions.close" {
            if let Some(logical) = params["subscriptionId"].as_str() {
                handle.shared.permits.revoke_member(consumer, logical);
            }
        }
        let priority = descriptor.control(&params);
        let (counter, bytes, limit) = if priority {
            (
                &handle.shared.control_pending,
                &handle.shared.control_bytes,
                contracts.limit("maxControlJobsPerDevice"),
            )
        } else {
            (
                &handle.shared.pending,
                &handle.shared.bytes,
                contracts.limit("maxPendingRpc"),
            )
        };
        if !reserve(counter, 1, limit) {
            return Err(WsFailure::local(
                "RPC_WS_OVERLOAD",
                "Native Host pending request limit reached",
            ));
        }
        let mut slot = Slot {
            pending: counter.clone(),
            bytes: bytes.clone(),
            count: 0,
            ids: handle.shared.ids.clone(),
            cancelled: handle.shared.cancelled.clone(),
            id: id.clone(),
        };
        {
            let mut ids = handle
                .shared
                .ids
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if ids.contains_key(&id) {
                // Do not let this rejected duplicate release the original ID.
                slot.id.clear();
                return Err(WsFailure::local(
                    "RPC_WS_DUPLICATE_ID",
                    "Host request identity is already pending",
                ));
            }
            ids.insert(id.clone(), consumer.into());
        }
        if !reserve(bytes, byte_count, contracts.limit("maxSocketQueuedBytes")) {
            return Err(WsFailure::local(
                "RPC_WS_OVERLOAD",
                "Native Host buffered byte limit reached",
            ));
        }
        slot.count = byte_count;
        let timeout = options
            .response_timeout
            .unwrap_or(descriptor.timeout)
            .min(descriptor.timeout);
        let now = Instant::now();
        if options
            .absolute_deadline
            .is_some_and(|deadline| deadline <= now)
        {
            return Err(WsFailure::local(
                "RPC_WS_DEADLINE",
                "Native operation deadline elapsed before admission",
            ));
        }
        let admission = contracts.duration("defaultAdmissionTimeoutMs");
        let deadline = options
            .absolute_deadline
            .map_or(now + admission + timeout, |deadline| {
                deadline.min(now + admission + timeout)
            });
        let admission_deadline = (now + admission).min(deadline);
        let (tx, rx) = mpsc::sync_channel(1);
        let wire_id = uuid::Uuid::new_v4().to_string();
        let permits = &handle.shared.permits;
        let resource_scope = if matches!(scope, RequestScope::NativeService)
            && method == "native.services.delivery.result.read"
        {
            permits.service_result_scope(consumer, &id, &params)
        } else {
            permits.scope(consumer, &id, &params)
        }
        .map_err(|_| {
            WsFailure::local(
                "RPC_WS_OVERLOAD",
                "Native resource disclosure scope limit reached",
            )
        })?;
        let subscription_epoch = if method == "subscriptions.open" {
            handle
                .shared
                .permits
                .begin_open(
                    consumer,
                    params["subscriptionId"].as_str().unwrap_or(""),
                    &wire_id,
                    &params["target"],
                )
                .map_err(|_| {
                    WsFailure::local(
                        "RPC_WS_OVERLOAD",
                        "Native logical subscription grant limit reached",
                    )
                })?;
            Some(wire_id.clone())
        } else {
            None
        };
        let request = Request {
            id: id.clone(),
            wire_id,
            consumer: consumer.into(),
            issuer: options.issuer.clone(),
            method: method.into(),
            params,
            command_id: command_id.clone(),
            mutating: descriptor.mutating,
            deadline,
            admission_deadline,
            timeout,
            reply: tx,
            download_cancel: None,
            download_grant: None,
            subscription_epoch,
            resource_scope,
            _slot: slot,
        };
        let pending = PendingRequest {
            rx,
            shared: handle.shared.clone(),
            id,
            command_id,
            mutating: descriptor.mutating,
            absolute_deadline: options.absolute_deadline.map(|_| deadline),
            wait: if options.absolute_deadline.is_some() {
                deadline.saturating_duration_since(Instant::now())
            } else {
                admission + timeout + Duration::from_millis(100)
            },
        };
        Ok(PreparedRequest {
            request: Some(request),
            pending: Some(pending),
            handle,
        })
    }

    pub fn cancel_request(&self, route: &NativeRoute, consumer: &str, request_id: &str) {
        let connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(handle) = connections.get(&route.key) {
            let ids = handle
                .shared
                .ids
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if ids.get(request_id).map(String::as_str) != Some(consumer) {
                return;
            }
            handle.shared.permits.revoke_unary(consumer, request_id);
            handle
                .shared
                .cancelled
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(request_id.into());
            handle.shared.changed.notify_one();
        }
    }

    /// Detaching a window cancels its waits and releases its subscriptions. It is
    /// deliberately independent of session/task stop operations on the Host.
    pub fn detach(&self, consumer: &str) {
        self.detach_matching(consumer, None);
    }

    pub fn detach_machine(&self, machine_id: &str, consumer: &str) {
        self.detach_matching(consumer, Some(machine_id));
    }

    fn detach_matching(&self, consumer: &str, machine_id: Option<&str>) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        connections.retain(|_, handle| {
            if machine_id.is_some_and(|machine| machine != handle.shared.route.machine_id) {
                return true;
            }
            handle.shared.consumers().remove(consumer);
            handle.shared.permits.revoke_owner(consumer);
            handle
                .shared
                .resume
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .retain(|member, _| member.owner != consumer);
            let keep = !handle.shared.consumers().is_empty();
            if !keep {
                handle.shared.stop.store(true, Ordering::Release);
            }
            handle.shared.changed.notify_one();
            keep
        });
    }

    /// A successful owner-requested identity probe may retry a blocked lane.
    /// Healthy sockets and unrelated native authority lanes keep their lifetimes.
    /// Requests from the retired lane are never replayed.
    pub fn retry_blocked_machine(&self, machine_id: &str) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        connections.retain(|_, handle| {
            if handle.shared.route.machine_id != machine_id {
                return true;
            }
            let blocked = matches!(
                handle.shared.last_state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .as_ref(),
                Some(NativeEvent::State { phase, .. }) if phase == "blocked"
            );
            if !blocked {
                return true;
            }
            handle.shared.stop.store(true, Ordering::Release);
            handle.shared.permits.revoke_all();
            handle.shared.changed.notify_one();
            false
        });
    }

    pub fn invalidate_machine(&self, machine_id: &str) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        connections.retain(|_, handle| {
            if handle.shared.route.machine_id != machine_id {
                return true;
            }
            handle.shared.stop.store(true, Ordering::Release);
            handle.shared.permits.revoke_all();
            handle.shared.changed.notify_one();
            false
        });
    }

    pub fn invalidate_environment(&self, environment_id: &str) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        connections.retain(|_, handle| {
            if handle.shared.route.environment_id != environment_id {
                return true;
            }
            handle.shared.stop.store(true, Ordering::Release);
            handle.shared.permits.revoke_all();
            handle.shared.changed.notify_one();
            false
        });
    }

    pub fn shutdown(&self) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (_, handle) in connections.drain() {
            handle.shared.stop.store(true, Ordering::Release);
            handle.shared.permits.revoke_all();
            handle.shared.changed.notify_one();
        }
    }
}
impl Drop for HostWsBroker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn reserve(counter: &AtomicUsize, amount: usize, limit: usize) -> bool {
    let mut current = counter.load(Ordering::Acquire);
    loop {
        let Some(next) = current.checked_add(amount).filter(|total| *total <= limit) else {
            return false;
        };
        match counter.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return true,
            Err(actual) => current = actual,
        }
    }
}

fn generation(counter: &AtomicU64) -> Option<u64> {
    let mut current = counter.load(Ordering::Acquire);
    loop {
        let next = current
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)?;
        match counter.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return Some(next),
            Err(actual) => current = actual,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests;
