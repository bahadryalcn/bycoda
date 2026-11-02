use super::*;

#[test]
fn generic_ws_cannot_bypass_private_native_or_raw_development_gateway_ingress() {
    let broker = HostWsBroker::default();
    let route = NativeRoute::new(
        "machine",
        "host.1",
        "http://127.0.0.1:9",
        "fake-device-token",
        "private-boundary",
    )
    .unwrap();
    for method in [
        "native.turn.begin",
        "native.buffers.upload.start",
        "native.buffers.recovery.list",
        "devServers.bridgeCheck",
        "devServers.bridgeOpen",
        "devServers.bridgeRead",
        "devServers.bridgeWrite",
        "devServers.bridgeClose",
    ] {
        assert!(Contracts::get().unwrap().methods.contains_key(method));
        assert!(!HostWsBroker::supports_method(method));
        assert!(!HostWsBroker::supports_params(method, &json!({})));
        assert!(
            broker
                .begin_request(
                    &route,
                    "window",
                    method,
                    json!({}),
                    RequestOptions::default()
                )
                .err()
                .unwrap()
                .unsupported
        );
    }
    for method in [
        "workspaces.cleanup.plan",
        "workspaces.cleanup.apply",
        "workspaces.cleanup.status",
    ] {
        assert!(HostWsBroker::supports_method(method));
    }
}

#[test]
fn absolute_operation_deadline_includes_handshake_admission_without_dispatch() {
    Contracts::get().unwrap();
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        tokio::task::spawn_blocking(move || release_rx.recv().unwrap())
            .await
            .unwrap();
        hello(&mut socket, &["projects.list"], "host.1").await;
        match time::timeout(Duration::from_millis(150), socket.next()).await {
            Err(_) | Ok(None) | Ok(Some(Ok(Message::Close(_)))) => {}
            Ok(Some(Err(tokio_tungstenite::tungstenite::Error::Io(error))))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::UnexpectedEof
                ) => {}
            // The expired client drops its TCP stream without a close frame;
            // Linux reports that as a reset rather than an I/O error.
            Ok(Some(Err(tokio_tungstenite::tungstenite::Error::Protocol(
                tokio_tungstenite::tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
            )))) => {}
            observed => {
                panic!("Expired operation must not dispatch a domain request: {observed:?}")
            }
        }
    });
    let broker = HostWsBroker::default();
    let started = Instant::now();
    let pending = broker
        .begin_request(
            &server.route(),
            "absolute-native",
            "projects.list",
            json!({}),
            RequestOptions {
                response_timeout: Some(Duration::from_secs(2)),
                absolute_deadline: Some(started + Duration::from_millis(150)),
                ..RequestOptions::default()
            },
        )
        .unwrap();
    let failure = pending.wait().unwrap_err();
    assert!(!failure.uncertain && !failure.unsupported);
    assert!(started.elapsed() < Duration::from_secs(2));
    release_tx.send(()).unwrap();
    drop(server);
    broker.shutdown();
}

#[test]
fn absolute_deadline_detaches_dispatched_effect_and_status_keeps_original_identity() {
    Contracts::get().unwrap();
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["commands.dispatch", "commands.status"],
            "host.1",
        )
        .await;
        let command = next(&mut socket).await;
        assert_eq!(command["params"]["commandId"], "absolute-original");
        started_tx.send(()).unwrap();
        loop {
            let request = next(&mut socket).await;
            assert_ne!(request["method"], "commands.dispatch");
            if request["method"] == "commands.status" {
                assert_eq!(request["params"]["commandId"], "absolute-original");
                result(&mut socket, &request, Value::Null).await;
                break;
            }
            assert_eq!(request["method"], "requests.cancel");
            result(&mut socket, &request, Value::Null).await;
        }
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let pending = broker
        .begin_request(
            &route,
            "absolute-native",
            "commands.dispatch",
            json!({"type":"compact","commandId":"absolute-original","sessionId":"session.1"}),
            RequestOptions {
                absolute_deadline: Some(Instant::now() + Duration::from_millis(500)),
                ..RequestOptions::default()
            },
        )
        .unwrap();
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let failure = pending.wait().unwrap_err();
    assert!(failure.uncertain && !failure.unsupported);
    assert_eq!(failure.command_id.as_deref(), Some("absolute-original"));
    assert_eq!(
        broker
            .request(
                &route,
                "absolute-native",
                "commands.status",
                json!({"commandId":"absolute-original"}),
                RequestOptions::default()
            )
            .unwrap()
            .result,
        Value::Null
    );
    broker.shutdown();
}

fn native_recovery_source() -> Value {
    json!({"reportId":"a".repeat(64),"reportVersion":1,"ownerId":"native-owner","ownerVersion":1,"snapshotDigest":"b".repeat(64)})
}
fn native_recovery_page() -> Value {
    json!({"version":1,"qualified":false,"records":[],"next":null,"incomplete":false,"duplicatesPossible":false})
}
fn native_recovery_status() -> Value {
    json!({"version":1,"qualified":false,"source":native_recovery_source(),"found":false,"inspectable":false,"resolution":"unsupported"})
}

#[test]
fn native_profile_callers_keep_actual_pending_work_independent_of_window_detach() {
    use super::native_profile::NativeProfileBroker;
    let (started, waiting) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.buffers.recovery.list",
                "native.buffers.recovery.status",
            ],
            "host.1",
        )
        .await;
        let first = next(&mut socket).await;
        assert_eq!(first["method"], "native.buffers.recovery.list");
        started.send(()).unwrap();
        tokio::task::spawn_blocking(move || released.recv().unwrap())
            .await
            .unwrap();
        result(&mut socket, &first, native_recovery_page()).await;
        let second = next(&mut socket).await;
        assert_eq!(second["method"], "native.buffers.recovery.status");
        result(&mut socket, &second, native_recovery_status()).await;
        tokio::task::spawn_blocking(move || finished.recv().unwrap())
            .await
            .unwrap();
    });
    let profile = NativeProfileBroker::default();
    let caller = profile.capture(server.route()).unwrap();
    assert!(
        caller
            .begin("projects.list", json!({}), RequestOptions::default())
            .err()
            .unwrap()
            .unsupported
    );
    let pending = caller
        .begin(
            "native.buffers.recovery.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    // Even a window label equal to the private anchor cannot address its pool.
    let windows = HostWsBroker::default();
    windows.detach("native-profile-owner");
    drop(caller); // the actual pending call retains its private caller scope
    release.send(()).unwrap();
    let (value, guard) = pending.wait().unwrap().into_guarded();
    assert_eq!(value, native_recovery_page());
    guard.check().unwrap();
    // A fresh caller reuses this context's same physical connection.
    let second = profile.capture(server.route()).unwrap();
    let (value, second_guard) = second
        .begin(
            "native.buffers.recovery.status",
            native_recovery_source(),
            RequestOptions::default(),
        )
        .unwrap()
        .wait()
        .unwrap()
        .into_guarded();
    assert_eq!(value, native_recovery_status());
    second_guard.check().unwrap();
    profile.invalidate_machine("machine.1");
    assert!(guard.check().is_err() && second_guard.check().is_err());
    assert!(second
        .begin(
            "native.buffers.recovery.list",
            json!({}),
            RequestOptions::default()
        )
        .is_err());
    done.send(()).unwrap();
}

#[test]
fn native_profile_context_is_bounded_loopback_only_and_cannot_reopen_after_shutdown() {
    use super::native_profile::NativeProfileBroker;
    let profile = NativeProfileBroker::default();
    let remote = NativeRoute::new(
        "machine",
        "environment",
        "https://example.invalid",
        "fixture-token",
        "native-selected",
    )
    .unwrap();
    assert!(profile.capture(remote).is_err());
    assert!(!NativeProfileBroker::supports_params(
        "projects.list",
        &json!({})
    ));
    assert!(!NativeProfileBroker::supports_params(
        "native.buffers.recovery.status",
        &json!({})
    ));
    let route = NativeRoute::new(
        "machine",
        "environment",
        "http://127.0.0.1:1",
        "fixture-token",
        "native-selected",
    )
    .unwrap();
    let callers = (0..128)
        .map(|_| profile.capture(route.clone()).unwrap())
        .collect::<Vec<_>>();
    assert!(profile.capture(route.clone()).is_err());
    drop(callers);
    let caller = profile.capture(route.clone()).unwrap();
    profile.shutdown();
    assert!(profile.capture(route).is_err());
    assert!(caller
        .begin(
            "native.buffers.recovery.list",
            json!({}),
            RequestOptions::default()
        )
        .is_err());
}

#[test]
fn native_profile_bulk_keeps_caller_and_disclosure_guard_through_real_download() {
    use super::native_profile::NativeProfileBroker;
    let _serial = BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let value = json!({"version":1,"qualified":false,"source":native_recovery_source(),
        "rawReport":"x".repeat(1_200_000),"owner":{"ownerId":"native-owner","updatedAt":1,"unknown":false,"buffers":[]},"resolution":"unsupported"});
    let bytes = Arc::new(serde_json::to_vec(&value).unwrap());
    let data = bytes.clone();
    let (started, waiting) = mpsc::sync_channel(1);
    let (done, finished) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.buffers.recovery.read",
                "native.buffers.recovery.status",
            ],
            "host.1",
        )
        .await;
        let read = next(&mut socket).await;
        result(&mut socket, &read, json!({"$bulk":descriptor(&data)})).await;
        let (stream, _) = listener.accept().await.unwrap();
        let (release, released) = mpsc::sync_channel(1);
        let first_bytes = data.clone();
        let first = tokio::task::spawn_blocking(move || {
            http_chunk(
                stream.into_std().unwrap(),
                &first_bytes,
                0,
                Some(started),
                Some(released),
            )
        });
        let other = next(&mut socket).await;
        assert_eq!(other["method"], "native.buffers.recovery.status");
        result(&mut socket, &other, native_recovery_status()).await;
        release.send(()).unwrap();
        first.await.unwrap();
        for offset in (65536..data.len()).step_by(65536) {
            let (stream, _) = listener.accept().await.unwrap();
            let data = data.clone();
            tokio::task::spawn_blocking(move || {
                http_chunk(stream.into_std().unwrap(), &data, offset, None, None)
            })
            .await
            .unwrap();
        }
        tokio::task::spawn_blocking(move || finished.recv().unwrap())
            .await
            .unwrap();
    });
    let profile = NativeProfileBroker::default();
    let caller = profile.capture(server.route()).unwrap();
    let pending = caller
        .begin(
            "native.buffers.recovery.read",
            native_recovery_source(),
            RequestOptions::default(),
        )
        .unwrap();
    drop(caller);
    let call = thread::spawn(move || pending.wait());
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(bulk::in_flight(), (1, bytes.len()));
    let other = profile.capture(server.route()).unwrap();
    other
        .begin(
            "native.buffers.recovery.status",
            native_recovery_source(),
            RequestOptions::default(),
        )
        .unwrap()
        .wait()
        .unwrap();
    let (actual, guard) = call.join().unwrap().unwrap().into_guarded();
    assert_eq!(actual, value);
    assert_eq!(bulk::in_flight(), (1, bytes.len()));
    guard.check().unwrap();
    profile.invalidate_environment("host.1");
    assert!(guard.check().is_err());
    drop(guard);
    assert_eq!(bulk::in_flight(), (0, 0));
    done.send(()).unwrap();
}

#[test]
fn native_profile_recovery_cannot_use_a_renderer_selected_generic_ws_route() {
    let broker = HostWsBroker::default();
    let route = NativeRoute::new(
        "machine",
        "environment",
        "http://127.0.0.1:1",
        "fixture-token",
        "fixture-native-binding",
    )
    .unwrap();
    for method in [
        "native.buffers.recovery.list",
        "native.buffers.recovery.read",
        "native.buffers.recovery.status",
    ] {
        assert!(!HostWsBroker::supports_method(method));
        assert!(!HostWsBroker::supports_params(method, &json!({})));
        let error = broker
            .begin_request(
                &route,
                "window",
                method,
                json!({}),
                RequestOptions::default(),
            )
            .err()
            .unwrap();
        assert!(error.unsupported);
        assert!(!error.uncertain);
    }
    assert!(broker.connections.lock().unwrap().is_empty());
}
use futures_util::{SinkExt, StreamExt};
use std::io::{Read, Write};
use std::{future::Future, sync::atomic::AtomicUsize};
use tokio::{
    net::{TcpListener, TcpStream},
    time,
};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::handshake::server::{Request as Upgrade, Response as UpgradeResponse},
};
use tokio_tungstenite::{
    tungstenite::{
        http::{header, HeaderValue},
        Message,
    },
    WebSocketStream,
};

pub(crate) struct Server {
    pub(crate) endpoint: String,
    task: Option<thread::JoinHandle<()>>,
}
impl Server {
    pub(crate) fn spawn<F, Fut>(run: F) -> Self
    where
        F: FnOnce(TcpListener) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + 'static,
    {
        Self::spawn_with_watchdog(Duration::from_secs(8), run)
    }
    /// The watchdog only turns a hung fixture into a failure. Volume-bound
    /// fixtures (tens of MiB through hundreds of round trips in a debug build)
    /// use the product's own RPC budget so slow shared CI runners do not trip it.
    pub(crate) fn spawn_with_watchdog<F, Fut>(watchdog: Duration, run: F) -> Self
    where
        F: FnOnce(TcpListener) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + 'static,
    {
        let (tx, rx) = mpsc::sync_channel(1);
        let task = thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async {
                let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
                tx.send(format!("http://{}", listener.local_addr().unwrap()))
                    .unwrap();
                time::timeout(watchdog, run(listener))
                    .await
                    .expect("fixture server timed out");
            });
        });
        Self {
            endpoint: rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            task: Some(task),
        }
    }
    fn route(&self) -> NativeRoute {
        NativeRoute::new(
            "machine.1",
            "host.1",
            &self.endpoint,
            "secret-native-token",
            "principal.1",
        )
        .unwrap()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            if !thread::panicking() {
                task.join().unwrap();
            }
        }
    }
}

type ServerSocket = WebSocketStream<TcpStream>;
pub(crate) async fn accept(listener: &TcpListener) -> ServerSocket {
    try_accept(listener)
        .await
        .expect("fixture websocket handshake")
}
/// Like `accept`, but a peer that disconnects during the upgrade yields `None`.
/// Restart fixtures use it to skip a superseded broker's reconnect attempt.
// Tungstenite fixes this callback's error type to its HTTP upgrade response.
#[allow(clippy::result_large_err)]
pub(crate) async fn try_accept(listener: &TcpListener) -> Option<ServerSocket> {
    let (stream, _) = listener.accept().await.unwrap();
    accept_hdr_async(
        stream,
        |request: &Upgrade, mut response: UpgradeResponse| {
            assert_eq!(request.uri().path(), "/ws");
            assert_eq!(
                request.headers()[header::AUTHORIZATION],
                "Bearer secret-native-token"
            );
            assert_eq!(
                request.headers()[header::SEC_WEBSOCKET_PROTOCOL],
                "bycoda.rpc.v2"
            );
            response.headers_mut().insert(
                header::SEC_WEBSOCKET_PROTOCOL,
                HeaderValue::from_static("bycoda.rpc.v2"),
            );
            Ok(response)
        },
    )
    .await
    .ok()
}

pub(crate) async fn next(socket: &mut ServerSocket) -> Value {
    loop {
        match socket.next().await.unwrap().unwrap() {
            Message::Text(text) => return serde_json::from_str(&text).unwrap(),
            Message::Ping(data) => socket.send(Message::Pong(data)).await.unwrap(),
            Message::Pong(_) => {}
            message => panic!("unexpected fixture message {message:?}"),
        }
    }
}
/// Like `next`, but a peer close or reset yields `None` instead of panicking.
pub(crate) async fn try_next(socket: &mut ServerSocket) -> Option<Value> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => return Some(serde_json::from_str(&text).unwrap()),
            Some(Ok(Message::Ping(data))) => socket.send(Message::Pong(data)).await.ok()?,
            Some(Ok(Message::Pong(_))) => {}
            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return None,
            Some(Ok(message)) => panic!("unexpected fixture message {message:?}"),
        }
    }
}
/// After the fixture drops a socket, the pre-restart broker's reconnect
/// scheduler may reach the listener before the fixture's restart/reopen shuts
/// it down.
/// That superseded connection never issues a request and closes on shutdown,
/// so the restored connection is the first one that sends a request.
pub(crate) async fn restored_connection(
    listener: &TcpListener,
    methods: &[&str],
) -> (ServerSocket, Value) {
    loop {
        let Some(mut socket) = try_accept(listener).await else {
            continue;
        };
        if !try_hello(&mut socket, methods, "host.1").await {
            continue;
        }
        if let Some(request) = try_next(&mut socket).await {
            return (socket, request);
        }
    }
}
pub(crate) async fn result(socket: &mut ServerSocket, request: &Value, result: Value) {
    socket
        .send(Message::Text(
            json!({"jsonrpc":"2.0", "id":request["id"], "result":result})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
}
pub(crate) async fn hello(socket: &mut ServerSocket, methods: &[&str], environment: &str) {
    let request = next(socket).await;
    answer_hello(socket, &request, methods, environment).await;
}
/// Like `hello`, but returns false when the peer closes before its hello.
pub(crate) async fn try_hello(
    socket: &mut ServerSocket,
    methods: &[&str],
    environment: &str,
) -> bool {
    let Some(request) = try_next(socket).await else {
        return false;
    };
    answer_hello(socket, &request, methods, environment).await;
    true
}
async fn answer_hello(
    socket: &mut ServerSocket,
    request: &Value,
    methods: &[&str],
    environment: &str,
) {
    let contracts = Contracts::get().unwrap();
    let mut capabilities = std::collections::BTreeSet::from(["transport.ws.read.v2".to_owned()]);
    for method in methods {
        if let Some(capability) = contracts
            .methods
            .get(*method)
            .and_then(|method| method.required_capability.as_ref())
        {
            capabilities.insert(capability.clone());
        }
    }
    answer_hello_capabilities(
        socket,
        request,
        methods,
        environment,
        capabilities.into_iter().collect(),
    )
    .await;
}
async fn hello_capabilities(
    socket: &mut ServerSocket,
    methods: &[&str],
    environment: &str,
    capabilities: Vec<String>,
) {
    let request = next(socket).await;
    answer_hello_capabilities(socket, &request, methods, environment, capabilities).await;
}
async fn answer_hello_capabilities(
    socket: &mut ServerSocket,
    request: &Value,
    methods: &[&str],
    environment: &str,
    capabilities: Vec<String>,
) {
    assert_eq!(request["method"], "connection.hello");
    assert_eq!(request["params"]["environmentId"], "host.1");
    result(
        socket,
        request,
        json!({"environmentId":environment, "wireVersion":2,"schemaVersion":1,
        "connectionId":"connection.fixture", "capabilities":capabilities, "methods":methods}),
    )
    .await;
}
fn short(id: &str) -> RequestOptions {
    RequestOptions {
        request_id: Some(id.into()),
        response_timeout: Some(Duration::from_millis(100)),
        ..Default::default()
    }
}

fn project_list(id: &str) -> Value {
    json!([{"id":id,"cwd":"/fixture","name":"fixture"}])
}

#[test]
fn goal_alias_emits_one_canonical_wire_frame_with_original_request_identity() {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["goals.finalReview.recheck"], "host.1").await;
        let request = next(&mut socket).await;
        assert_eq!(request["method"], "goals.finalReview.recheck");
        // Physical IDs are fresh per attempt so a late reply cannot hit a reused caller ID.
        assert!(request["id"].as_str().is_some());
        assert_ne!(request["id"], "original.goal.request");
        assert_eq!(
            request["params"],
            json!({"goalId":"goal.1","expectedUpdatedAt":1})
        );
        result(&mut socket, &request, json!({"id":"goal.1","title":"Fixture","prompt":"Review",
            "projectIds":["project.1"],"leadProjectId":"project.1","harness":"codex","model":"model.1",
            "modelSettings":{},"runtimeMode":"supervised","maxRunMinutes":10,"verifyDefaults":{"review":true},
            "approvePlan":false,"status":"blocked","taskIds":[],"createdAt":1,"updatedAt":1})).await;
        assert!(time::timeout(Duration::from_millis(150), socket.next())
            .await
            .is_err());
        done_tx.send(()).unwrap();
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let params = json!({"goalId":"goal.1","expectedUpdatedAt":1});
    for unknown in [
        "goals.final--review.recheck",
        "goals.finalReview.unknown",
        "constructor",
    ] {
        assert!(!HostWsBroker::supports_method(unknown));
        assert!(!HostWsBroker::supports_params(unknown, &params));
        let failure = broker
            .request(
                &route,
                "window.alias",
                unknown,
                params.clone(),
                RequestOptions::default(),
            )
            .unwrap_err();
        assert!(failure.unsupported);
        assert!(!failure.uncertain);
    }
    assert!(HostWsBroker::supports_method("goals.final-review.recheck"));
    assert!(HostWsBroker::supports_params(
        "goals.final-review.recheck",
        &params
    ));
    assert!(HostWsBroker::method_has_effect(
        "goals.final-review.recheck"
    ));
    let pending = broker
        .begin_request(
            &route,
            "window.alias",
            "goals.final-review.recheck",
            params,
            RequestOptions {
                request_id: Some("original.goal.request".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(pending.id, "original.goal.request");
    let reply = pending.wait().unwrap();
    assert_eq!(reply.result["id"], "goal.1");
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    broker.shutdown();
}

#[test]
fn negotiated_method_inventory_cannot_bypass_its_required_capability() {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello_capabilities(
            &mut socket,
            &["sessions.list"],
            "host.1",
            vec!["transport.ws.read.v2".into()],
        )
        .await;
        assert!(time::timeout(Duration::from_millis(150), socket.next())
            .await
            .is_err());
        done_tx.send(()).unwrap();
    });
    let broker = HostWsBroker::default();
    let failure = broker
        .request(
            &server.route(),
            "window-a",
            "sessions.list",
            json!({"projectId":"p"}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert!(failure.unsupported);
    assert!(!failure.uncertain);
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    broker.shutdown();
}

#[test]
fn a_family_only_host_negotiates_without_a_generic_read_capability() {
    for (capability, method, params, expected) in [
        (
            "transport.ws.sessions.v2",
            "sessions.list",
            json!({"projectId":"project.1"}),
            json!([]),
        ),
        (
            "transport.ws.stewards.v2",
            "stewards.list",
            json!({}),
            json!([]),
        ),
        (
            "transport.ws.crews.v2",
            "crews.list",
            json!({"projectId":"project.1"}),
            json!({"agents":[],"definitions":[],"runs":[]}),
        ),
    ] {
        assert!(HostWsBroker::supports_ws_capability(capability));
        assert!(HostWsBroker::supports_params(method, &params));
        let server_result = expected.clone();
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello_capabilities(&mut socket, &[method], "host.1", vec![capability.into()]).await;
            let request = next(&mut socket).await;
            assert_eq!(request["method"], method);
            result(&mut socket, &request, server_result).await;
        });
        let broker = HostWsBroker::default();
        let reply = broker
            .request(
                &server.route(),
                "window.subset",
                method,
                params,
                RequestOptions::default(),
            )
            .unwrap();
        assert_eq!(reply.result, expected);
        broker.shutdown();
    }
}

fn union_snapshot(receiver: &mpsc::Receiver<NativeEvent>, logical: &str, sequence: u64) -> Value {
    loop {
        if let NativeEvent::Subscription { event, .. } =
            receiver.recv_timeout(Duration::from_secs(2)).unwrap()
        {
            assert_eq!(event["params"]["subscriptionId"], logical);
            if event["params"]["kind"] == "snapshot"
                && event["params"]["cursor"]["sequence"] == sequence
            {
                return event;
            }
        }
    }
}

#[test]
fn shared_host_demand_waits_for_both_windows_and_releases_only_the_last_owner() {
    let (ack_tx, ack_rx) = mpsc::sync_channel(1);
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "subscriptions.open",
                "subscriptions.ack",
                "subscriptions.close",
                "connection.probe",
            ],
            "host.1",
        )
        .await;
        let initial = next(&mut socket).await;
        assert_eq!(initial["method"], "subscriptions.open");
        result(
            &mut socket,
            &initial,
            json!({"subscriptionId":initial["params"]["subscriptionId"],"streamId":"host-stream"}),
        )
        .await;
        socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"subscription.event","params":{
            "subscriptionId":initial["params"]["subscriptionId"],"streamId":"host-stream","cursor":{"epoch":"union-epoch","sequence":1},"kind":"snapshot","data":{"version":1}}}).to_string().into())).await.unwrap();
        // Late B reuses the target, closes its previous Host demand, then opens
        // one fresh baseline. A keeps its logical registration and projection.
        let close = next(&mut socket).await;
        assert_eq!(close["method"], "subscriptions.close");
        assert_eq!(
            close["params"]["subscriptionId"],
            initial["params"]["subscriptionId"]
        );
        result(&mut socket, &close, json!({"accepted":true})).await;
        let fresh = next(&mut socket).await;
        assert_eq!(fresh["method"], "subscriptions.open");
        assert_eq!(fresh["params"]["target"], initial["params"]["target"]);
        assert_ne!(
            fresh["params"]["subscriptionId"],
            initial["params"]["subscriptionId"]
        );
        assert!(fresh["params"].get("cursor").is_none());
        result(&mut socket, &fresh, json!({"subscriptionId":fresh["params"]["subscriptionId"],"streamId":"host-stream-new"})).await;
        socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"subscription.event","params":{
            "subscriptionId":fresh["params"]["subscriptionId"],"streamId":"host-stream-new","cursor":{"epoch":"union-epoch","sequence":2},"kind":"snapshot","data":{"version":2}}}).to_string().into())).await.unwrap();
        // A has applied cursor 2. The next wire packet must still be the probe,
        // because B has not acknowledged its own baseline.
        let probe = next(&mut socket).await;
        assert_eq!(probe["method"], "connection.probe");
        result(
            &mut socket,
            &probe,
            json!({"environmentId":"host.1","connectionId":"union-connection"}),
        )
        .await;
        let ack = next(&mut socket).await;
        assert_eq!(ack["method"], "subscriptions.ack");
        assert_eq!(
            ack["params"]["cursor"],
            json!({"epoch":"union-epoch","sequence":2})
        );
        assert_eq!(
            ack["params"]["subscriptionId"],
            fresh["params"]["subscriptionId"]
        );
        result(&mut socket, &ack, json!({"accepted":true})).await;
        ack_tx.send(()).unwrap();
        let remaining_probe = next(&mut socket).await;
        assert_eq!(remaining_probe["method"], "connection.probe");
        result(
            &mut socket,
            &remaining_probe,
            json!({"environmentId":"host.1","connectionId":"union-connection"}),
        )
        .await;
        let last_close = next(&mut socket).await;
        assert_eq!(last_close["method"], "subscriptions.close");
        assert_eq!(
            last_close["params"]["subscriptionId"],
            fresh["params"]["subscriptionId"]
        );
        result(&mut socket, &last_close, json!({"accepted":true})).await;
        done_tx.send(()).unwrap();
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let (a_tx, a_rx) = mpsc::channel();
    let (b_tx, b_rx) = mpsc::channel();
    broker
        .attach(
            &route,
            "window-a",
            Arc::new(move |event| {
                let _ = a_tx.send(event);
            }),
        )
        .unwrap();
    broker
        .attach(
            &route,
            "window-b",
            Arc::new(move |event| {
                let _ = b_tx.send(event);
            }),
        )
        .unwrap();
    let first = broker
        .request(
            &route,
            "window-a",
            "subscriptions.open",
            json!({"subscriptionId":"logical-a","target":{"kind":"session","sessionId":"session"}}),
            RequestOptions::default(),
        )
        .unwrap();
    union_snapshot(&a_rx, "logical-a", 1);
    let second = broker
        .request(
            &route,
            "window-b",
            "subscriptions.open",
            json!({"subscriptionId":"logical-b","target":{"kind":"session","sessionId":"session"}}),
            RequestOptions::default(),
        )
        .unwrap();
    let a_snapshot = union_snapshot(&a_rx, "logical-a", 2);
    let b_snapshot = union_snapshot(&b_rx, "logical-b", 2);
    assert_eq!(first.result["streamId"], second.result["streamId"]);
    assert_eq!(a_snapshot["params"]["streamId"], first.result["streamId"]);
    assert_eq!(b_snapshot["params"]["streamId"], second.result["streamId"]);
    let ack = json!({"epoch":"union-epoch","sequence":2});
    broker
        .request(
            &route,
            "window-a",
            "subscriptions.ack",
            json!({"subscriptionId":"logical-a","cursor":ack}),
            RequestOptions::default(),
        )
        .unwrap();
    broker
        .request(
            &route,
            "window-a",
            "connection.probe",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    broker
        .request(
            &route,
            "window-b",
            "subscriptions.ack",
            json!({"subscriptionId":"logical-b","cursor":ack}),
            RequestOptions::default(),
        )
        .unwrap();
    ack_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    broker.detach("window-a");
    broker
        .request(
            &route,
            "window-b",
            "connection.probe",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    broker
        .request(
            &route,
            "window-b",
            "subscriptions.close",
            json!({"subscriptionId":"logical-b"}),
            RequestOptions::default(),
        )
        .unwrap();
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    broker.shutdown();
}

#[test]
fn route_requires_native_tls_and_keeps_secrets_out_of_errors() {
    for endpoint in [
        "http://192.168.1.20:4000",
        "ws://example.org",
        "https://user:password@example.org",
        "https://example.org?token=private",
        "https://example.org/rpc",
    ] {
        let error = NativeRoute::new("m", "e", endpoint, "secret-native-token", "p")
            .err()
            .unwrap();
        assert!(!error.to_string().contains(endpoint));
        assert!(!error.to_string().contains("secret-native-token"));
    }
    for endpoint in [
        "http://127.0.0.1:4000",
        "ws://[::1]:4000",
        "https://example.org",
        "wss://example.org/ws",
    ] {
        assert!(NativeRoute::new("m", "e", endpoint, "token", "p").is_ok());
    }
}

#[test]
fn legacy_parameter_compatibility_is_decided_before_opening_a_socket() {
    let canonical = json!({"type":"compact","commandId":"command.1","sessionId":"session.1"});
    assert!(HostWsBroker::supports_params(
        "commands.dispatch",
        &canonical
    ));
    let mut legacy = canonical;
    legacy["projectId"] = json!("legacy.extra");
    assert!(!HostWsBroker::supports_params("commands.dispatch", &legacy));
    assert!(!HostWsBroker::supports_params(
        "unregistered.method",
        &json!({})
    ));
}

#[test]
fn legacy_frame_preflight_counts_large_valid_cas_utf8_and_json_escaping() {
    let contracts = Contracts::get().unwrap();
    for content in [
        "a".repeat(600 * 1024),
        "🧠".repeat(150 * 1024),
        "\n\\\"".repeat(100 * 1024),
    ] {
        // Each text fits the existing filesystem owner's unchanged 1 MiB
        // limit. The pair/escaping can still exceed one WS frame.
        assert!(content.len() <= 1024 * 1024);
        assert!(!content.contains('\0'));
        let params = json!({
            "projectId":"project.1", "path":"file.txt",
            "expected":content, "content":content,
        });
        assert!(contracts.methods["files.write"].params.is_valid(&params));
        assert!(!HostWsBroker::supports_params("files.write", &params));
    }
    assert!(HostWsBroker::supports_params(
        "files.write",
        &json!({
            "projectId":"project.1", "path":"file.txt", "expected":"é\n\\\"", "content":"小さな変更",
        })
    ));
}

#[test]
fn compatibility_budget_reserves_the_complete_largest_canonical_request_id() {
    let contracts = Contracts::get().unwrap();
    let limit = contracts.limit("maxMessageBytes");
    let id = "i".repeat(MAX_REQUEST_ID_BYTES);
    let mut params =
        json!({"projectId":"project.1", "path":"file.txt", "expected":"", "content":""});
    let mut envelope = json!({"jsonrpc":"2.0", "id":id, "method":"files.write", "params":params});
    assert!(contracts.request_valid(&envelope));
    envelope["id"] = json!("i".repeat(MAX_REQUEST_ID_BYTES + 1));
    assert!(!contracts.request_valid(&envelope));
    envelope["id"] = json!("é".repeat(MAX_REQUEST_ID_BYTES));
    assert!(!contracts.request_valid(&envelope));
    let overhead = request_message_bytes("files.write", &id, &params, limit).unwrap();
    params["content"] = json!("a".repeat(limit - overhead));
    assert_eq!(
        request_message_bytes("files.write", &id, &params, limit),
        Some(limit)
    );
    // Independent serde_json serialization confirms the whole wire frame,
    // rather than relying on the counter to verify its own overhead.
    assert_eq!(
        serde_json::to_vec(&json!({"jsonrpc":"2.0", "id":id,
        "method":"files.write", "params":params}))
        .unwrap()
        .len(),
        limit
    );
    assert!(HostWsBroker::supports_params("files.write", &params));
    params["content"] = json!("a".repeat(limit - overhead + 1));
    assert!(!HostWsBroker::supports_params("files.write", &params));
    // The compatibility decision deliberately leaves room beyond a default
    // UUID. The strict typed call still uses its own exact ID/budget.
    assert!(request_message_bytes("files.write", "uuid-sized", &params, limit).is_some());
}

#[test]
fn compatibility_aliases_use_the_canonical_wire_envelope_budget() {
    let limit = Contracts::get().unwrap().limit("maxMessageBytes");
    let id = "i".repeat(MAX_REQUEST_ID_BYTES);
    let mut params = json!({"goalId":"", "expectedUpdatedAt":1});
    let overhead = request_message_bytes("goals.finalReview.recheck", &id, &params, limit).unwrap();
    params["goalId"] = json!("a".repeat(limit - overhead));
    assert!(HostWsBroker::supports_params(
        "goals.finalReview.recheck",
        &params
    ));
    assert!(HostWsBroker::supports_params(
        "goals.final-review.recheck",
        &params
    ));
    params["goalId"] = json!("a".repeat(limit - overhead + 1));
    assert!(!HostWsBroker::supports_params(
        "goals.finalReview.recheck",
        &params
    ));
    assert!(!HostWsBroker::supports_params(
        "goals.final-review.recheck",
        &params
    ));
}

#[test]
fn oversized_compatibility_and_strict_requests_open_no_native_socket() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let route = NativeRoute::new(
        "machine.1",
        "host.1",
        &format!("http://{}", listener.local_addr().unwrap()),
        "native-secret",
        "principal.1",
    )
    .unwrap();
    let broker = HostWsBroker::default();
    let params = json!({"projectId":"project.1", "path":"file.txt", "expected":"a".repeat(600 * 1024), "content":"b".repeat(600 * 1024)});
    assert!(!HostWsBroker::supports_params("files.write", &params));
    assert!(broker.connections.lock().unwrap().is_empty());
    let failure = broker
        .begin_request(
            &route,
            "window.1",
            "files.write",
            params,
            RequestOptions::default(),
        )
        .err()
        .unwrap();
    assert_eq!(failure.code, "RPC_WS_OVERLOAD");
    assert!(!failure.uncertain);
    assert!(!failure.unsupported);
    assert!(broker.connections.lock().unwrap().is_empty());
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

#[test]
fn one_native_pipe_multiplexes_two_windows_and_out_of_order_replies() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        let first = next(&mut socket).await;
        let second = next(&mut socket).await;
        result(
            &mut socket,
            &second,
            project_list(second["id"].as_str().unwrap()),
        )
        .await;
        result(
            &mut socket,
            &first,
            project_list(first["id"].as_str().unwrap()),
        )
        .await;
        assert!(time::timeout(Duration::from_millis(150), listener.accept())
            .await
            .is_err());
    });
    let broker = Arc::new(HostWsBroker::default());
    let route = server.route();
    let a = {
        let broker = broker.clone();
        let route = route.clone();
        thread::spawn(move || {
            broker
                .request(
                    &route,
                    "window.a",
                    "projects.list",
                    json!({}),
                    RequestOptions {
                        request_id: Some("request.a".into()),
                        ..Default::default()
                    },
                )
                .unwrap()
        })
    };
    let b = broker
        .request(
            &route,
            "window.b",
            "projects.list",
            json!({}),
            RequestOptions {
                request_id: Some("request.b".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let a = a.join().unwrap();
    assert_eq!(a.generation, b.generation);
    assert_ne!(a.result[0]["id"], b.result[0]["id"]);
    broker.shutdown();
}

#[test]
fn attaching_another_window_replays_current_native_ready_state() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        let request = next(&mut socket).await;
        result(&mut socket, &request, json!([])).await;
        while let Some(Ok(message)) = socket.next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let reply = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    let (tx, rx) = mpsc::channel();
    broker
        .attach(
            &route,
            "window.b",
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    match rx.recv_timeout(Duration::from_secs(1)).unwrap() {
        NativeEvent::State {
            environment_id,
            generation,
            phase,
            category,
        } => {
            assert_eq!(environment_id, "host.1");
            assert_eq!(generation, reply.generation);
            assert_eq!(phase, "ready");
            assert!(category.is_none());
        }
        _ => panic!("expected cached native state"),
    }
    broker.shutdown();
}

#[test]
fn healthy_socket_does_not_hide_stuck_rpc_and_late_reply_is_ignored() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list", "requests.cancel"], "host.1").await;
        let stuck = next(&mut socket).await;
        let cancel = next(&mut socket).await;
        assert_eq!(cancel["method"], "requests.cancel");
        assert_eq!(cancel["params"]["requestId"], stuck["id"]);
        result(&mut socket, &stuck, project_list("late")).await;
        let fresh = next(&mut socket).await;
        result(&mut socket, &fresh, project_list("fresh")).await;
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let start = Instant::now();
    let failure = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            short("stuck.1"),
        )
        .unwrap_err();
    assert_eq!(failure.code, "RPC_WS_DEADLINE");
    assert!(!failure.uncertain);
    assert!(start.elapsed() < Duration::from_secs(2));
    let reply = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    assert_eq!(reply.result, project_list("fresh"));
    assert_eq!(Some(reply.generation), failure.generation);
    broker.shutdown();
}

#[test]
fn hello_identity_mismatch_blocks_reconnect_and_dispatch() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "different.host").await;
        assert!(time::timeout(Duration::from_millis(300), listener.accept())
            .await
            .is_err());
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let first = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(first.code, "RPC_WS_BLOCKED");
    assert!(!first.uncertain && !first.unsupported);
    let second = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(first.generation, second.generation);
    broker.shutdown();
}

#[test]
fn explicit_retry_reopens_only_the_blocked_machine_without_replaying_requests() {
    let server = Server::spawn(|listener| async move {
        let mut stale = accept(&listener).await;
        hello(&mut stale, &["projects.list"], "different.host").await;
        drop(stale);
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        for expected_id in ["recovered.read", "healthy.read"] {
            let request = next(&mut socket).await;
            // The broker deliberately uses private wire IDs. Distinct results
            // prove that only these new callers, in order, reached the Host.
            assert_eq!(request["method"], "projects.list");
            result(&mut socket, &request, project_list(expected_id)).await;
        }
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let (tx, rx) = mpsc::channel();
    broker
        .attach(
            &route,
            "window.a",
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    let first = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions {
                request_id: Some("blocked.read".into()),
                ..RequestOptions::default()
            },
        )
        .unwrap_err();
    assert_eq!(first.code, "RPC_WS_BLOCKED");
    loop {
        if matches!(rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            NativeEvent::State { phase, .. } if phase == "blocked")
        {
            break;
        }
    }
    broker.retry_blocked_machine("another.machine");
    let still_blocked = broker
        .request(
            &route,
            "window.b",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(still_blocked.code, "RPC_WS_BLOCKED");
    assert_eq!(still_blocked.generation, first.generation);
    broker.retry_blocked_machine("machine.1");
    let recovered = broker
        .request(
            &route,
            "window.b",
            "projects.list",
            json!({}),
            RequestOptions {
                request_id: Some("recovered.read".into()),
                ..RequestOptions::default()
            },
        )
        .unwrap();
    assert_ne!(Some(recovered.generation), first.generation);
    assert_eq!(recovered.result, project_list("recovered.read"));
    broker.retry_blocked_machine("machine.1");
    let healthy = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions {
                request_id: Some("healthy.read".into()),
                ..RequestOptions::default()
            },
        )
        .unwrap();
    assert_eq!(healthy.generation, recovered.generation);
    assert_eq!(healthy.result, project_list("healthy.read"));
    broker.shutdown();
}

#[test]
fn missing_hello_capability_allows_only_predispatch_negotiation() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["environment.describe"], "host.1").await;
        assert!(time::timeout(Duration::from_millis(120), socket.next())
            .await
            .is_err());
    });
    let broker = HostWsBroker::default();
    let failure = broker
        .request(
            &server.route(),
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert!(failure.unsupported && !failure.uncertain);
    // Keep the pipe open until the fixture verifies that no request was sent.
    thread::sleep(Duration::from_millis(150));
    broker.shutdown();
}

#[test]
fn reconnect_uses_new_generation_without_replaying_old_query() {
    let (tx, rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut first = accept(&listener).await;
        hello(&mut first, &["projects.list"], "host.1").await;
        let request = next(&mut first).await;
        let old_id = request["id"].clone();
        drop(first);
        let mut second = accept(&listener).await;
        hello(&mut second, &["projects.list"], "host.1").await;
        tx.send(()).unwrap();
        let request = next(&mut second).await;
        assert_ne!(request["id"], old_id);
        result(&mut second, &request, project_list("new")).await;
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let failure = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions {
                request_id: Some("old.request".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(failure.code, "RPC_WS_INTERRUPTED");
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let reply = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    assert!(reply.generation > failure.generation.unwrap());
    broker.shutdown();
}

#[test]
fn same_environment_different_principal_never_shares_connection() {
    let accepts = Arc::new(AtomicUsize::new(0));
    let count = accepts.clone();
    let server = Server::spawn(move |listener| async move {
        for _ in 0..2 {
            let mut socket = accept(&listener).await;
            count.fetch_add(1, Ordering::SeqCst);
            hello(&mut socket, &["projects.list"], "host.1").await;
            let request = next(&mut socket).await;
            result(&mut socket, &request, json!([])).await;
        }
    });
    let broker = HostWsBroker::default();
    let first = server.route();
    let second = NativeRoute::new(
        "machine.1",
        "host.1",
        &server.endpoint,
        "secret-native-token",
        "principal.2",
    )
    .unwrap();
    assert_ne!(first.key, second.key);
    broker
        .request(
            &first,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    broker
        .request(
            &second,
            "window.b",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    assert_eq!(accepts.load(Ordering::SeqCst), 2);
    broker.shutdown();
}

#[test]
fn detach_cancels_pending_without_stopping_host_work() {
    let (sent, received) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list", "requests.cancel"], "host.1").await;
        let _ = next(&mut socket).await;
        sent.send(()).unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(value["method"], "requests.cancel");
            }
        }
    });
    let broker = Arc::new(HostWsBroker::default());
    let route = server.route();
    let call = {
        let broker = broker.clone();
        thread::spawn(move || {
            broker.request(
                &route,
                "window.a",
                "projects.list",
                json!({}),
                RequestOptions::default(),
            )
        })
    };
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    broker.detach("window.a");
    let failure = call.join().unwrap().unwrap_err();
    assert!(!failure.uncertain);
    assert_eq!(broker.connections.lock().unwrap().len(), 0);
}

#[test]
fn cancelled_registration_is_closed_even_when_open_result_arrives_late() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["subscriptions.open", "subscriptions.close"],
            "host.1",
        )
        .await;
        let open = next(&mut socket).await;
        let close = next(&mut socket).await;
        assert_eq!(close["method"], "subscriptions.close");
        result(
            &mut socket,
            &open,
            json!({"subscriptionId":open["params"]["subscriptionId"],"streamId":"stream.1"}),
        )
        .await;
        let close_again = next(&mut socket).await;
        assert_eq!(close_again["method"], "subscriptions.close");
        assert_eq!(
            close_again["params"]["subscriptionId"],
            open["params"]["subscriptionId"]
        );
    });
    let broker = HostWsBroker::default();
    let failure = broker
        .request(
            &server.route(),
            "window.a",
            "subscriptions.open",
            json!({"subscriptionId":"subscription.1","target":{"kind":"environment"}}),
            short("open.1"),
        )
        .unwrap_err();
    assert!(!failure.uncertain);
    // Let the late registration cleanup round trip before tearing down the pipe.
    thread::sleep(Duration::from_millis(100));
    broker.shutdown();
}

#[test]
fn reused_caller_id_cannot_receive_a_late_previous_attempt() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        let old = next(&mut socket).await;
        let current = next(&mut socket).await;
        assert_ne!(old["id"], current["id"]);
        result(&mut socket, &old, project_list("old")).await;
        result(&mut socket, &current, project_list("current")).await;
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            short("same.caller.id"),
        )
        .unwrap_err();
    let reply = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions {
                request_id: Some("same.caller.id".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(reply.result, project_list("current"));
    broker.shutdown();
}

#[test]
fn lost_mutation_retains_durable_identity_and_is_never_replayed() {
    let (tx, rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut first = accept(&listener).await;
        hello(
            &mut first,
            &["commands.dispatch", "commands.status"],
            "host.1",
        )
        .await;
        let command = next(&mut first).await;
        assert_eq!(command["params"]["commandId"], "durable.command.1");
        drop(first);
        let mut second = accept(&listener).await;
        hello(
            &mut second,
            &["commands.dispatch", "commands.status"],
            "host.1",
        )
        .await;
        tx.send(()).unwrap();
        let status = next(&mut second).await;
        assert_eq!(status["method"], "commands.status");
        result(&mut second, &status, Value::Null).await;
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let failure = broker
        .request(
            &route,
            "window.a",
            "commands.dispatch",
            json!({"type":"compact","commandId":"durable.command.1","sessionId":"session.1"}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert!(failure.uncertain && !failure.unsupported);
    assert_eq!(failure.command_id.as_deref(), Some("durable.command.1"));
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let status = broker
        .request(
            &route,
            "window.a",
            "commands.status",
            json!({"commandId":"durable.command.1"}),
            RequestOptions::default(),
        )
        .unwrap();
    assert!(status.result.is_null());
    assert!(status.generation > failure.generation.unwrap());
    broker.shutdown();
}

#[test]
fn healthy_socket_remote_deadline_preserves_unknown_mutation_delivery() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["commands.dispatch", "commands.status"],
            "host.1",
        )
        .await;
        let command = next(&mut socket).await;
        socket.send(Message::Text(json!({"jsonrpc":"2.0","id":command["id"],"error":{
            "code":-32001,"message":"Host request deadline elapsed","data":{
                "category":"deadline","retryable":false,"commandId":"durable.deadline","delivery":"unknown"}}}).to_string().into())).await.unwrap();
        let status = next(&mut socket).await;
        assert_eq!(status["method"], "commands.status");
        result(&mut socket, &status, Value::Null).await;
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let error = broker
        .request(
            &route,
            "window.a",
            "commands.dispatch",
            json!({"type":"compact","commandId":"durable.deadline","sessionId":"session.1"}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(error.code, "RPC_WS_REMOTE");
    assert!(error.uncertain);
    assert_eq!(error.command_id.as_deref(), Some("durable.deadline"));
    let reply = broker
        .request(
            &route,
            "window.a",
            "commands.status",
            json!({"commandId":"durable.deadline"}),
            RequestOptions::default(),
        )
        .unwrap();
    assert_eq!(error.generation, Some(reply.generation));
    broker.shutdown();
}

#[test]
fn query_flood_preserves_reserved_command_status_capacity() {
    let contracts = Contracts::get().unwrap();
    let normal_limit = contracts.limit("maxPendingRpc");
    let (tx, rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list", "commands.status"], "host.1").await;
        for _ in 0..normal_limit {
            assert_eq!(next(&mut socket).await["method"], "projects.list");
        }
        tx.send(()).unwrap();
        let status = next(&mut socket).await;
        assert_eq!(status["method"], "commands.status");
        result(&mut socket, &status, Value::Null).await;
        while let Some(Ok(message)) = socket.next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
    });
    let broker = Arc::new(HostWsBroker::default());
    let route = server.route();
    let calls: Vec<_> = (0..normal_limit)
        .map(|_| {
            let broker = broker.clone();
            let route = route.clone();
            thread::spawn(move || {
                broker.request(
                    &route,
                    "window.a",
                    "projects.list",
                    json!({}),
                    RequestOptions::default(),
                )
            })
        })
        .collect();
    rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let error = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(error.code, "RPC_WS_OVERLOAD");
    assert!(!error.uncertain);
    broker
        .request(
            &route,
            "window.a",
            "commands.status",
            json!({"commandId":"command.1"}),
            RequestOptions::default(),
        )
        .unwrap();
    broker.detach("window.a");
    for call in calls {
        assert!(call.join().unwrap().is_err());
    }
}

#[test]
fn early_stream_snapshot_is_delivered_after_registration_without_implicit_ack() {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["subscriptions.open", "subscriptions.ack"],
            "host.1",
        )
        .await;
        let open = next(&mut socket).await;
        let event = json!({"jsonrpc":"2.0","method":"subscription.event","params":{
            "subscriptionId":open["params"]["subscriptionId"],"streamId":"stream.early","cursor":{"epoch":"epoch.1","sequence":0},"kind":"snapshot","data":{"items":[]}}});
        socket
            .send(Message::Text(event.to_string().into()))
            .await
            .unwrap();
        result(
            &mut socket,
            &open,
            json!({"subscriptionId":open["params"]["subscriptionId"],"streamId":"stream.early"}),
        )
        .await;
        assert!(time::timeout(Duration::from_millis(150), socket.next())
            .await
            .is_err());
        done_tx.send(()).unwrap();
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let (tx, rx) = mpsc::channel();
    broker
        .attach(
            &route,
            "window.a",
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    broker
        .request(
            &route,
            "window.a",
            "subscriptions.open",
            json!({"subscriptionId":"sub.early","target":{"kind":"environment"}}),
            RequestOptions::default(),
        )
        .unwrap();
    loop {
        if let NativeEvent::Subscription { event, .. } =
            rx.recv_timeout(Duration::from_secs(2)).unwrap()
        {
            assert_eq!(event["params"]["cursor"]["sequence"], 0);
            assert_eq!(event["params"]["subscriptionId"], "sub.early");
            break;
        }
    }
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    broker.shutdown();
}

pub(crate) static BULK_TEST: Mutex<()> = Mutex::new(());

pub(crate) fn bulk_in_flight() -> (usize, usize) {
    bulk::in_flight()
}

pub(crate) fn descriptor(bytes: &[u8]) -> Value {
    let expires = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000;
    json!({"kind":"bulk","transferId":"transfer.fixture","environmentId":"host.1",
        "totalBytes":bytes.len(),"chunkBytes":65536,"sha256":format!("{:x}",Sha256::digest(bytes)),"expiresAt":expires})
}
pub(crate) fn http_chunk(
    mut stream: std::net::TcpStream,
    bytes: &[u8],
    offset: usize,
    started: Option<mpsc::SyncSender<()>>,
    gate: Option<mpsc::Receiver<()>>,
) {
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut headers = Vec::new();
    while !headers.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        headers.push(byte[0]);
        assert!(headers.len() < 8192);
    }
    let headers = String::from_utf8(headers).unwrap();
    assert!(headers.starts_with(&format!(
        "GET /ws-bulk/transfer.fixture?offset={offset} HTTP/1.1"
    )));
    assert!(headers
        .to_ascii_lowercase()
        .contains("authorization: bearer secret-native-token"));
    if let Some(started) = started {
        started.send(()).unwrap();
    }
    if let Some(gate) = gate {
        gate.recv_timeout(Duration::from_secs(2)).unwrap();
    }
    let end = (offset + 65536).min(bytes.len());
    write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",end-offset).unwrap();
    stream.write_all(&bytes[offset..end]).unwrap();
}

#[test]
fn bulk_unary_download_keeps_other_rpc_and_socket_read_loop_available() {
    let _serial = BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let bytes = Arc::new(
        serde_json::to_vec(
            &json!([{"id":"project.bulk","cwd":"/fixture","name":"x".repeat(1_200_000)}]),
        )
        .unwrap(),
    );
    let data = bytes.clone();
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["projects.list", "environment.describe"],
            "host.1",
        )
        .await;
        let request = next(&mut socket).await;
        result(&mut socket, &request, json!({"$bulk":descriptor(&data)})).await;
        let (stream, _) = listener.accept().await.unwrap();
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let first_bytes = data.clone();
        let first = tokio::task::spawn_blocking(move || {
            http_chunk(
                stream.into_std().unwrap(),
                &first_bytes,
                0,
                Some(started_tx),
                Some(release_rx),
            )
        });
        let other = next(&mut socket).await;
        assert_eq!(other["method"], "environment.describe");
        result(&mut socket, &other, json!({"environmentId":"host.1"})).await;
        release_tx.send(()).unwrap();
        first.await.unwrap();
        for offset in (65536..data.len()).step_by(65536) {
            let (stream, _) = listener.accept().await.unwrap();
            let data = data.clone();
            tokio::task::spawn_blocking(move || {
                http_chunk(stream.into_std().unwrap(), &data, offset, None, None)
            })
            .await
            .unwrap();
        }
        // Keep WS alive until the native completion callback validates the body.
        let _ = time::timeout(Duration::from_millis(150), socket.next()).await;
    });
    let broker = Arc::new(HostWsBroker::default());
    let route = server.route();
    let call = {
        let broker = broker.clone();
        let route = route.clone();
        thread::spawn(move || {
            broker.request(
                &route,
                "window.a",
                "projects.list",
                json!({}),
                RequestOptions::default(),
            )
        })
    };
    started_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    broker
        .request(
            &route,
            "window.b",
            "environment.describe",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    let reply = call.join().unwrap().unwrap();
    assert_eq!(reply.result[0]["name"].as_str().unwrap().len(), 1_200_000);
    broker.shutdown();
}

#[test]
fn bulk_hash_and_environment_mismatch_are_rejected() {
    let _serial = BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let bytes = Arc::new(serde_json::to_vec(&json!({"value":"fixture"})).unwrap());
    let data = bytes.clone();
    let mut host_descriptor = descriptor(&bytes);
    host_descriptor["sha256"] = json!("0".repeat(64));
    let reference = host_descriptor.clone();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["subscriptions.open"], "host.1").await;
        let open = next(&mut socket).await;
        result(
            &mut socket,
            &open,
            json!({"subscriptionId":open["params"]["subscriptionId"],"streamId":"stream.bulk"}),
        )
        .await;
        socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"subscription.event","params":{
            "subscriptionId":open["params"]["subscriptionId"],"streamId":"stream.bulk","cursor":{"epoch":"epoch.1","sequence":0},"kind":"snapshot","data":reference}}).to_string().into())).await.unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        tokio::task::spawn_blocking(move || {
            http_chunk(stream.into_std().unwrap(), &data, 0, None, None)
        })
        .await
        .unwrap();
        let _ = time::timeout(Duration::from_millis(100), socket.next()).await;
    });
    let route = server.route();
    let broker = HostWsBroker::default();
    let (tx, rx) = mpsc::channel();
    broker
        .attach(
            &route,
            "window.a",
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    broker
        .request(
            &route,
            "window.a",
            "subscriptions.open",
            json!({"subscriptionId":"logical.bulk","target":{"kind":"environment"}}),
            RequestOptions::default(),
        )
        .unwrap();
    loop {
        if matches!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            NativeEvent::Subscription { .. }
        ) {
            break;
        }
    }
    let mut wrong = host_descriptor.clone();
    wrong["environmentId"] = json!("other.host");
    assert!(broker.fetch_bulk(&route, "window.a", &wrong, None).is_err());
    assert!(broker
        .fetch_bulk(&route, "window.a", &host_descriptor, None)
        .is_err());
    broker.shutdown();
}

#[test]
fn deferred_bulk_never_discloses_after_tombstone_resync_detach_or_logical_close() {
    let _serial = BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for action in [
        "closed",
        "resync-required",
        "window-detach",
        "logical-close",
        "route-invalidate",
        "post-download-tombstone",
    ] {
        let bytes =
            Arc::new(serde_json::to_vec(&json!({"private":"retired stream bytes"})).unwrap());
        let reference = descriptor(&bytes);
        let host_reference = reference.clone();
        let data = bytes.clone();
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let (retire_tx, retire_rx) = tokio::sync::oneshot::channel();
        let (done_tx, mut done_rx) = tokio::sync::oneshot::channel();
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &["subscriptions.open", "subscriptions.close"],
                "host.1",
            )
            .await;
            let open = next(&mut socket).await;
            let wire = open["params"]["subscriptionId"].clone();
            result(
                &mut socket,
                &open,
                json!({"subscriptionId":wire,"streamId":"stream.bulk"}),
            )
            .await;
            socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"subscription.event","params":{
                "subscriptionId":wire,"streamId":"stream.bulk","cursor":{"epoch":"epoch.1","sequence":0},"kind":"snapshot","data":host_reference}}).to_string().into())).await.unwrap();
            let (stream, _) = listener.accept().await.unwrap();
            let http = tokio::task::spawn_blocking(move || {
                http_chunk(
                    stream.into_std().unwrap(),
                    &data,
                    0,
                    Some(started_tx),
                    Some(release_rx),
                )
            });
            let kind = retire_rx.await.unwrap();
            if matches!(kind, "closed" | "resync-required") {
                socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"subscription.event","params":{
                    "subscriptionId":wire,"streamId":"stream.bulk","cursor":{"epoch":"epoch.1","sequence":1},"kind":kind}}).to_string().into())).await.unwrap();
            }
            loop {
                tokio::select! {
                    _=&mut done_rx=>break,
                    frame=socket.next()=>{
                        let Some(Ok(Message::Text(text)))=frame else {break;};
                        let request:Value=serde_json::from_str(&text).unwrap();
                        let value=if request["method"]=="subscriptions.open" {json!({"subscriptionId":request["params"]["subscriptionId"],"streamId":"stream.refreshed"})}else{json!({"accepted":true})};
                        result(&mut socket,&request,value).await;
                    }
                }
            }
            http.await.unwrap();
        });
        let broker = Arc::new(HostWsBroker::default());
        let route = server.route();
        let (tx, rx) = mpsc::channel();
        broker
            .attach(
                &route,
                "window.a",
                Arc::new(move |event| {
                    let _ = tx.send(event);
                }),
            )
            .unwrap();
        broker.attach(&route, "window.b", Arc::new(|_| {})).unwrap();
        broker
            .request(
                &route,
                "window.a",
                "subscriptions.open",
                json!({"subscriptionId":"logical.bulk","target":{"kind":"environment"}}),
                RequestOptions::default(),
            )
            .unwrap();
        loop {
            if matches!(
                rx.recv_timeout(Duration::from_secs(2)).unwrap(),
                NativeEvent::Subscription { .. }
            ) {
                break;
            }
        }
        assert!(broker
            .fetch_bulk(&route, "window.b", &reference, None)
            .is_err());
        let mut changed = reference.clone();
        changed["totalBytes"] = json!(bytes.len() + 1);
        assert!(broker
            .fetch_bulk(&route, "window.a", &changed, None)
            .is_err());
        let other_route = NativeRoute::new(
            "machine.1",
            "host.1",
            &server.endpoint,
            "replacement-token",
            "principal.2",
        )
        .unwrap();
        assert!(broker
            .fetch_bulk(&other_route, "window.a", &reference, None)
            .is_err());
        let pending = {
            let broker = broker.clone();
            let route = route.clone();
            let reference = reference.clone();
            thread::spawn(move || broker.fetch_bulk(&route, "window.a", &reference, None))
        };
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(bulk::in_flight(), (1, bytes.len()));
        if action == "post-download-tombstone" {
            release_tx.send(()).unwrap();
            let completed = pending.join().unwrap().unwrap();
            assert_eq!(
                bulk::in_flight(),
                (1, bytes.len()),
                "decoded result must retain its disclosure budget"
            );
            retire_tx.send("closed").unwrap();
            loop {
                if let NativeEvent::Subscription { event, .. } =
                    rx.recv_timeout(Duration::from_secs(2)).unwrap()
                {
                    if event["params"]["kind"] == "closed" {
                        break;
                    }
                }
            }
            assert!(completed.disclose().is_err());
            assert_eq!(bulk::in_flight(), (0, 0));
            let _ = done_tx.send(());
            broker.shutdown();
            continue;
        }
        retire_tx.send(action).unwrap();
        match action {
            "closed" | "resync-required" => loop {
                if let NativeEvent::Subscription { event, .. } =
                    rx.recv_timeout(Duration::from_secs(2)).unwrap()
                {
                    if event["params"]["kind"] == action {
                        break;
                    }
                }
            },
            "window-detach" => broker.detach("window.a"),
            "logical-close" => {
                broker
                    .request(
                        &route,
                        "window.a",
                        "subscriptions.close",
                        json!({"subscriptionId":"logical.bulk"}),
                        RequestOptions::default(),
                    )
                    .unwrap();
            }
            _ => broker.invalidate_machine("machine.1"),
        }
        assert_eq!(
            bulk::in_flight(),
            (1, bytes.len()),
            "revocation released a still-running I/O budget: {action}"
        );
        release_tx.send(()).unwrap();
        assert!(
            pending
                .join()
                .unwrap()
                .and_then(PendingBulk::disclose)
                .is_err(),
            "{action}"
        );
        assert_eq!(bulk::in_flight(), (0, 0));
        let _ = done_tx.send(());
        broker.shutdown();
    }
}

#[test]
fn resource_retirement_fences_cross_window_stateful_unary_without_claiming_not_sent() {
    let _serial = BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for mode in 0..4 {
        let before_descriptor = mode == 0;
        let bytes = Arc::new(serde_json::to_vec(&json!({"messages":[],"revision":1})).unwrap());
        let reference = descriptor(&bytes);
        let data = bytes.clone();
        let (retire_tx, retire_rx) = tokio::sync::oneshot::channel();
        let (done_tx, mut done_rx) = tokio::sync::oneshot::channel();
        let (request_tx, request_rx) = mpsc::sync_channel(1);
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "subscriptions.open",
                    "subscriptions.close",
                    "sessions.queue.get",
                ],
                "host.1",
            )
            .await;
            let open = next(&mut socket).await;
            let wire = open["params"]["subscriptionId"].clone();
            result(
                &mut socket,
                &open,
                json!({"subscriptionId":wire,"streamId":"stream.resource"}),
            )
            .await;
            let request = next(&mut socket).await;
            assert_eq!(request["method"], "sessions.queue.get");
            request_tx.send(()).unwrap();
            let http = if before_descriptor {
                None
            } else {
                result(&mut socket, &request, json!({"$bulk":reference.clone()})).await;
                let (stream, _) = listener.accept().await.unwrap();
                Some(tokio::task::spawn_blocking(move || {
                    http_chunk(
                        stream.into_std().unwrap(),
                        &data,
                        0,
                        Some(started_tx),
                        Some(release_rx),
                    )
                }))
            };
            retire_rx.await.unwrap();
            socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"subscription.event","params":{
                "subscriptionId":wire,"streamId":"stream.resource","cursor":{"epoch":"epoch.1","sequence":0},"kind":"closed"}}).to_string().into())).await.unwrap();
            if before_descriptor {
                result(&mut socket, &request, json!({"$bulk":reference})).await;
            }
            loop {
                tokio::select! {
                    _=&mut done_rx=>break,
                    incoming=listener.accept()=>{let _=incoming;panic!("retired unary descriptor started a new HTTP transfer");},
                    frame=socket.next()=>{
                        let Some(Ok(Message::Text(text)))=frame else {break;};let request:Value=serde_json::from_str(&text).unwrap();
                        result(&mut socket,&request,json!({"accepted":true})).await;
                    }
                }
            }
            if let Some(http) = http {
                http.await.unwrap();
            }
        });
        let broker = Arc::new(HostWsBroker::default());
        let route = server.route();
        let (tx, rx) = mpsc::channel();
        broker
            .attach(
                &route,
                "observer.window",
                Arc::new(move |event| {
                    let _ = tx.send(event);
                }),
            )
            .unwrap();
        broker.request(&route,"observer.window","subscriptions.open",json!({"subscriptionId":"logical.resource","target":{"kind":"session","sessionId":"session.a"}}),RequestOptions::default()).unwrap();
        let call = {
            let broker = broker.clone();
            let route = route.clone();
            thread::spawn(move || {
                broker.request(
                    &route,
                    "writer.window",
                    "sessions.queue.get",
                    json!({"sessionId":"session.a","clientId":"client.a"}),
                    RequestOptions {
                        request_id: Some("queue.resource".into()),
                        ..RequestOptions::default()
                    },
                )
            })
        };
        request_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        if !before_descriptor {
            started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        }
        if mode >= 2 {
            release_tx.send(()).unwrap();
            let downloaded = call.join().unwrap().unwrap();
            assert_eq!(bulk::in_flight(), (1, bytes.len()));
            assert_eq!(
                serde_json::to_value(&downloaded)
                    .unwrap()
                    .as_object()
                    .unwrap()
                    .len(),
                2,
                "private disclosure metadata leaked into the wire reply"
            );
            let projected = if mode == 3 {
                Some(downloaded.clone().into_guarded_result())
            } else {
                None
            };
            retire_tx.send(()).unwrap();
            loop {
                if let NativeEvent::Subscription { event, .. } =
                    rx.recv_timeout(Duration::from_secs(2)).unwrap()
                {
                    if event["params"]["kind"] == "closed" {
                        break;
                    }
                }
            }
            let failure = if let Some((value, guard)) = projected {
                drop(downloaded);
                assert!(value["messages"].is_array());
                let failure = guard.check().unwrap_err();
                drop(guard);
                failure
            } else {
                downloaded.disclose().unwrap_err()
            };
            assert!(failure.uncertain);
            assert!(!failure.unsupported);
            assert_eq!(failure.request_id.as_deref(), Some("queue.resource"));
            assert_eq!(bulk::in_flight(), (0, 0));
            let _ = done_tx.send(());
            broker.shutdown();
            continue;
        }
        retire_tx.send(()).unwrap();
        loop {
            if let NativeEvent::Subscription { event, .. } =
                rx.recv_timeout(Duration::from_secs(2)).unwrap()
            {
                if event["params"]["kind"] == "closed" {
                    break;
                }
            }
        }
        if !before_descriptor {
            assert_eq!(bulk::in_flight(), (1, bytes.len()));
            release_tx.send(()).unwrap();
        }
        let failure = call.join().unwrap().unwrap_err();
        assert!(failure.uncertain);
        assert!(!failure.unsupported);
        assert_eq!(failure.request_id.as_deref(), Some("queue.resource"));
        assert_eq!(bulk::in_flight(), (0, 0));
        let _ = done_tx.send(());
        broker.shutdown();
    }
}
