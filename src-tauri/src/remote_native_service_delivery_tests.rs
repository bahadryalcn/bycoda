use super::*;
use crate::host_ws::native_profile::NativeProfileBroker;
use crate::host_ws::tests::{accept, hello, next, restored_connection, result, Server};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use std::sync::mpsc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;

struct Fixture {
    root: PathBuf,
    machine: StoredMachine,
    broker: NativeProfileBroker,
    channel: Option<Arc<NativeServiceChannel>>,
    store: Option<Arc<SessionStore>>,
    modern: bool,
    acks: bool,
    epochs: bool,
}

impl Fixture {
    fn new(endpoint: &str, modern: bool) -> Self {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("bycoda-service-delivery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let machine = StoredMachine {
            id: "service.machine".into(),
            name: "Local fixture".into(),
            endpoint: endpoint.into(),
            environment_id: "host.1".into(),
            token: "secret-native-token".into(),
            ssh: None,
            local_host: true,
        };
        write(
            &root.join("connections.json"),
            std::slice::from_ref(&machine),
        )
        .unwrap();
        let mut fixture = Self {
            root,
            machine,
            broker: NativeProfileBroker::default(),
            channel: None,
            store: None,
            modern,
            acks: false,
            epochs: false,
        };
        fixture.attach();
        fixture
    }

    fn attach(&mut self) {
        let store = Arc::new(SessionStore::open(self.root.join("native.db")).unwrap());
        let caller = self
            .broker
            .capture_service(
                NativeRoute::new(
                    &self.machine.id,
                    &self.machine.environment_id,
                    &self.machine.endpoint,
                    &self.machine.token,
                    &ws_fingerprint(&self.machine),
                )
                .unwrap(),
            )
            .unwrap();
        self.channel = Some(Arc::new(NativeServiceChannel {
            selection: Some(Selection {
                store: Arc::default(),
                path: self.root.join("connections.json"),
                machine: self.machine.clone(),
                endpoint: self.machine.endpoint.clone(),
                tunnel: None,
            }),
            caller,
            websocket: true,
            peer: false,
            delivery_supported: self.modern,
            delivery_ack_supported: self.acks,
            delivery_epochs_supported: self.epochs,
            journal: Some(JournalAccess::fixture(store.clone())),
            delivery_cursor: Mutex::new(None),
            delivery_ack_cursor: Mutex::new(None),
        }));
        self.store = Some(store);
    }

    fn reopen(&mut self) {
        self.broker.shutdown();
        drop(self.channel.take());
        drop(self.store.take());
        self.broker = NativeProfileBroker::default();
        self.attach();
    }

    fn enable_acks(&mut self) {
        self.acks = true;
        Arc::get_mut(self.channel.as_mut().unwrap())
            .unwrap()
            .delivery_ack_supported = true;
    }

    fn enable_epochs(&mut self) {
        self.enable_acks();
        self.epochs = true;
        Arc::get_mut(self.channel.as_mut().unwrap())
            .unwrap()
            .delivery_epochs_supported = true;
    }

    fn remote_acks(&self) -> Vec<Original> {
        journal::pending_remote_acks(self.store(), &ws_fingerprint(&self.machine), None, 32)
            .unwrap()
            .originals
    }

    fn channel(&self) -> &Arc<NativeServiceChannel> {
        self.channel.as_ref().unwrap()
    }
    fn store(&self) -> &SessionStore {
        self.store.as_deref().unwrap()
    }
    fn pending(&self) -> Vec<Original> {
        journal::pending(self.store(), &ws_fingerprint(&self.machine), None, 32)
            .unwrap()
            .originals
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.broker.shutdown();
        drop(self.channel.take());
        drop(self.store.take());
        assert_eq!(
            self.root.canonicalize().unwrap().parent(),
            Some(std::env::temp_dir().canonicalize().unwrap().as_path())
        );
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

fn recorded(params: &Value, value: Value) -> Value {
    json!({"state":"recorded","originalId":params["originalId"],"sha256":params["sha256"],
        "byteLength":params["byteLength"],"target":params["target"],"result":value})
}

fn retired_receipt(params: &Value) -> Value {
    let mut value = params.clone();
    value["state"] = json!("retired");
    value
}

const EPOCH_OPEN: &str = "native.delivery.epochs.open";
const EPOCH_STATUS: &str = "native.delivery.epochs.status";
const EPOCH_COMPACT: &str = "native.delivery.epochs.compact";
const EPOCH_CLOSE: &str = "native.delivery.epochs.close";
const EPOCH_OWNER: &str = "22222222-2222-4222-8222-222222222222";

fn epoch_description(open_id: &Value, through: u64, high_water: u64) -> Value {
    json!({"version":2,"openId":open_id,"ownerId":EPOCH_OWNER,"generation":1,
        "through":through,"highWater":high_water,"closed":false})
}

fn retained_count(store: &SessionStore, table: &str) -> i64 {
    assert!([
        "native_delivery_originals",
        "native_delivery_semantic_retirements",
        "native_delivery_epochs"
    ]
    .contains(&table));
    store
        .lock_conn()
        .unwrap()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

/// Every fixture here is a handful of round trips, but a busy shared CI runner
/// can stall the whole test process (store migrations, journal writes and the
/// broker handshake) for several seconds. The watchdog, the fixture rendezvous
/// waits and the reconciliation deadlines that must cover a whole exchange only
/// turn a hung exchange into a failure, so they use the product's RPC budget
/// instead of a fixed few seconds. Deadlines a test expects to expire stay short.
const FIXTURE_WAIT: Duration = DEFAULT_RPC_TIMEOUT;

/// Mid-page deadline for the two fairness tests: long enough to connect and
/// attempt the first row on a busy runner, short enough to keep them quick.
const MIDPAGE_DEADLINE: Duration = Duration::from_secs(3);

/// Unfinished originals charge the process-wide helper result budget (at most
/// four deliveries), so fixtures running on every test thread at once starve
/// each other with "capacity is held by unfinished original deliveries". Each
/// fixture server holds this lock until it is dropped after its `Fixture`.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct Served {
    server: Server,
    _serial: std::sync::MutexGuard<'static, ()>,
}
impl std::ops::Deref for Served {
    type Target = Server;
    fn deref(&self) -> &Server {
        &self.server
    }
}

fn serve<F, Fut>(run: F) -> Served
where
    F: FnOnce(tokio::net::TcpListener) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + 'static,
{
    let serial = SERIAL
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Served {
        server: Server::spawn_with_watchdog(FIXTURE_WAIT, run),
        _serial: serial,
    }
}

#[test]
fn v2_staged_finish_compacts_only_after_guarded_local_and_remote_ack() {
    let params = json!({"id":"v2-staged-relay","result":{"text":"ç😀".repeat(300_000)}});
    let expected = serde_json::to_vec(&params).unwrap();
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
                "native.services.delivery.ack",
                "native.services.upload.begin",
                "native.services.upload.append",
                "native.services.upload.commit",
                EPOCH_OPEN,
                EPOCH_STATUS,
                EPOCH_COMPACT,
                EPOCH_CLOSE,
            ],
            "host.1",
        )
        .await;
        let open = next(&mut socket).await;
        assert_eq!(open["method"], EPOCH_OPEN);
        let open_id = open["params"]["openId"].clone();
        result(&mut socket, &open, epoch_description(&open_id, 0, 0)).await;
        let begin = next(&mut socket).await;
        assert_eq!(begin["method"], "native.services.upload.begin");
        let original = begin["params"]["delivery"].clone();
        assert_eq!(original["originalId"], format!("nd2:{EPOCH_OWNER}:1:1"));
        assert_eq!(begin["params"]["uploadId"], original["originalId"]);
        let mut upload = begin["params"].clone();
        upload["receivedBytes"] = json!(0);
        upload["state"] = json!("receiving");
        upload["expiresAt"] = json!(1_000_000);
        result(&mut socket, &begin, upload.clone()).await;
        let mut bytes = Vec::new();
        while bytes.len() < expected.len() {
            let chunk = next(&mut socket).await;
            assert_eq!(chunk["method"], "native.services.upload.append");
            assert_eq!(chunk["params"]["offset"], bytes.len());
            bytes.extend(
                base64::engine::general_purpose::STANDARD
                    .decode(chunk["params"]["data"].as_str().unwrap())
                    .unwrap(),
            );
            upload["receivedBytes"] = json!(bytes.len());
            result(&mut socket, &chunk, upload.clone()).await;
        }
        assert_eq!(bytes, expected);
        let commit = next(&mut socket).await;
        assert_eq!(commit["method"], "native.services.upload.commit");
        let mut binding = original.clone();
        binding["target"] = begin["params"]["target"].clone();
        upload["state"] = json!("completed");
        upload["result"] = recorded(&binding, json!({"accepted":true}));
        result(&mut socket, &commit, upload).await;
        let ack_request = next(&mut socket).await;
        assert_eq!(ack_request["method"], "native.services.delivery.ack");
        assert_eq!(ack_request["params"]["originalId"], original["originalId"]);
        result(
            &mut socket,
            &ack_request,
            retired_receipt(&ack_request["params"]),
        )
        .await;
        let compact = next(&mut socket).await;
        assert_eq!(compact["method"], EPOCH_COMPACT);
        assert_eq!(
            compact["params"],
            json!({"ownerId":EPOCH_OWNER,"generation":1,"expectedThrough":0,"through":1})
        );
        result(&mut socket, &compact, epoch_description(&open_id, 1, 1)).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_epochs();
    let reply = fixture
        .channel()
        .request("conversation.desktop.finish", params.clone())
        .unwrap();
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        1
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        0
    );
    reply
        .project(|value| {
            assert_eq!(value, &json!({"accepted":true}));
            assert!(fixture.remote_acks().is_empty());
            Ok(())
        })
        .unwrap();
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        0
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        1
    );
    assert!(fixture.remote_acks().is_empty());
    assert!(reply
        .project::<()>(|_| panic!("consumed reply cannot run twice"))
        .is_err());
    done.send(()).unwrap();
}

#[test]
fn v2_http_finish_commits_semantic_retirement_without_inventing_ws_guards() {
    async fn respond(stream: &mut tokio::net::TcpStream, request: &Value, value: Value) {
        let body = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":request["id"],"result":value}))
            .unwrap();
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
        stream.write_all(&body).await.unwrap();
    }
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let open = read_http_rpc(&mut stream).await;
        assert_eq!(open["method"], EPOCH_OPEN);
        let open_id = open["params"]["openId"].clone();
        respond(&mut stream, &open, epoch_description(&open_id, 0, 0)).await;
        drop(stream);
        let (mut stream, _) = listener.accept().await.unwrap();
        let apply = read_http_rpc(&mut stream).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        assert_eq!(
            apply["params"]["originalId"],
            format!("nd2:{EPOCH_OWNER}:1:1")
        );
        respond(
            &mut stream,
            &apply,
            recorded(&apply["params"], json!({"accepted":true})),
        )
        .await;
        drop(stream);
        let (mut stream, _) = listener.accept().await.unwrap();
        let ack_request = read_http_rpc(&mut stream).await;
        assert_eq!(ack_request["method"], "native.services.delivery.ack");
        respond(
            &mut stream,
            &ack_request,
            retired_receipt(&ack_request["params"]),
        )
        .await;
        drop(stream);
        let (mut stream, _) = listener.accept().await.unwrap();
        let compact = read_http_rpc(&mut stream).await;
        assert_eq!(compact["method"], EPOCH_COMPACT);
        respond(&mut stream, &compact, epoch_description(&open_id, 1, 1)).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_epochs();
    Arc::get_mut(fixture.channel.as_mut().unwrap())
        .unwrap()
        .websocket = false;
    let reply = fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"v2-http-relay","result":null}),
        )
        .unwrap();
    assert!(reply.guard.is_none());
    reply
        .project(|value| {
            assert_eq!(value, &json!({"accepted":true}));
            Ok(())
        })
        .unwrap();
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        0
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        1
    );
    done.send(()).unwrap();
}

#[test]
fn v2_open_reply_cannot_bind_epoch_after_actual_saved_route_replacement() {
    let (observed, open_seen) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[EPOCH_OPEN, EPOCH_STATUS, EPOCH_COMPACT, EPOCH_CLOSE],
            "host.1",
        )
        .await;
        let open = next(&mut socket).await;
        assert_eq!(open["method"], EPOCH_OPEN);
        observed.send(()).unwrap();
        tokio::task::spawn_blocking(move || released.recv_timeout(FIXTURE_WAIT).unwrap())
            .await
            .unwrap();
        result(
            &mut socket,
            &open,
            epoch_description(&open["params"]["openId"], 0, 0),
        )
        .await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_epochs();
    let channel = fixture.channel().clone();
    let request = std::thread::spawn(move || {
        channel
            .request(
                "conversation.desktop.finish",
                json!({"id":"v2-old-route","result":null}),
            )
            .err()
            .unwrap()
    });
    open_seen.recv_timeout(FIXTURE_WAIT).unwrap();
    let mut changed = fixture.machine.clone();
    changed.token = "replacement-token".into();
    write(&fixture.root.join("connections.json"), &[changed]).unwrap();
    release.send(()).unwrap();
    let error = request.join().unwrap();
    assert!(
        error.contains("changed") || error.contains("retired"),
        "{error}"
    );
    assert_eq!(retained_count(fixture.store(), "native_delivery_epochs"), 0);
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        0
    );
    done.send(()).unwrap();
}

#[test]
fn v2_restored_finish_fenced_status_retains_original_without_consume_or_resend() {
    let (done, finished) = mpsc::channel();
    let (fenced_sent, fenced_seen) = mpsc::channel();
    let server = serve(move |listener| async move {
        let methods = [
            "native.services.delivery.apply",
            "native.services.delivery.status",
            "native.services.delivery.ack",
            EPOCH_OPEN,
            EPOCH_STATUS,
            EPOCH_COMPACT,
            EPOCH_CLOSE,
        ];
        let mut socket = accept(&listener).await;
        hello(&mut socket, &methods, "host.1").await;
        let open = next(&mut socket).await;
        assert_eq!(open["method"], EPOCH_OPEN);
        result(
            &mut socket,
            &open,
            epoch_description(&open["params"]["openId"], 0, 0),
        )
        .await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        let mut binding = apply["params"].clone();
        binding.as_object_mut().unwrap().remove("paramsJson");
        let mut unknown = binding.clone();
        unknown["state"] = json!("unknown");
        result(&mut socket, &apply, unknown).await;
        // This is an explicit unknown result, not a disconnected transport.
        // Keep the anchored old broker connected until reopen actually retires
        // it; otherwise its automatic reconnect can win the restored accept.
        loop {
            match socket.next().await {
                Some(Ok(Message::Ping(data))) => socket.send(Message::Pong(data)).await.unwrap(),
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => break,
                message => panic!("unexpected request before old-broker shutdown: {message:?}"),
            }
        }
        drop(socket);
        let mut restored = accept(&listener).await;
        hello(&mut restored, &methods, "host.1").await;
        let status = next(&mut restored).await;
        assert_eq!(status["method"], "native.services.delivery.status");
        assert_eq!(status["params"], binding);
        let mut fenced = binding;
        fenced["state"] = json!("fenced");
        fenced["epoch"] = json!({"ownerId":EPOCH_OWNER,"generation":1,"through":1,"closed":false});
        result(&mut restored, &status, fenced).await;
        fenced_sent.send(()).unwrap();
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_epochs();
    assert!(fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"v2-fenced-finish","result":null})
        )
        .is_err());
    let original_id = fixture.pending()[0].id().to_owned();
    fixture.reopen();
    assert_eq!(
        reconcile_pending(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
        0
    );
    // A zero reconciliation count alone could also mean transport failure.
    // Require the exact restored status/fence exchange before its assertions.
    fenced_seen.recv_timeout(FIXTURE_WAIT).unwrap();
    let retained = fixture.pending();
    assert_eq!(retained.len(), 1);
    assert_eq!(retained[0].id(), original_id);
    assert_eq!(retained[0].phase(), Phase::Possible);
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        0
    );
    assert!(fixture.remote_acks().is_empty());
    done.send(()).unwrap();
}

async fn finish_after(done: mpsc::Receiver<()>) {
    tokio::task::spawn_blocking(move || done.recv_timeout(FIXTURE_WAIT).unwrap())
        .await
        .unwrap();
}

async fn read_http_rpc(stream: &mut tokio::net::TcpStream) -> Value {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        let mut byte = [0u8];
        stream.read_exact(&mut byte).await.unwrap();
        header.push(byte[0]);
        assert!(header.len() <= 16 * 1024);
    }
    let header = std::str::from_utf8(&header).unwrap();
    assert!(header.starts_with("POST /rpc HTTP/1.1\r\n"));
    let length: usize = header
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|value| value.trim().parse().unwrap())
        })
        .unwrap();
    assert!(length < 128 * 1024);
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[test]
fn lost_finish_reply_reopens_same_original_status_only_and_acknowledges_after_consume() {
    let params = json!({"id":"original-relay","result":{"value":"original result"}});
    let exact = bounded_params(&params).unwrap();
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut first = accept(&listener).await;
        hello(
            &mut first,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut first).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        assert_eq!(
            apply["params"]["paramsJson"].as_str().unwrap().as_bytes(),
            exact
        );
        let identity = apply["params"].clone();
        first.close(None).await.unwrap();
        drop(first);
        let (mut second, status) = restored_connection(
            &listener,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
        )
        .await;
        assert_eq!(status["method"], "native.services.delivery.status");
        for field in ["originalId", "sha256", "byteLength", "target"] {
            assert_eq!(status["params"][field], identity[field]);
        }
        result(
            &mut second,
            &status,
            recorded(&status["params"], json!({"accepted":true})),
        )
        .await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    assert!(fixture
        .channel()
        .request("conversation.desktop.finish", params.clone())
        .is_err());
    let pending = fixture.pending();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].phase(), Phase::Possible);
    let id = pending[0].id().to_owned();
    fixture.reopen();
    assert!(!fixture.pending()[0].can_dispatch());
    let reply = fixture
        .channel()
        .request("conversation.desktop.finish", params)
        .unwrap();
    assert_eq!(fixture.pending()[0].id(), id);
    reply.check().unwrap();
    assert_eq!(
        fixture.pending()[0].phase(),
        Phase::Recorded,
        "authority check is not consumption"
    );
    assert!(reply
        .project::<()>(|_| Err("consumer not ready".into()))
        .is_err());
    assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
    reply
        .project(|value| {
            assert_eq!(value, &json!({"accepted":true}));
            Ok(())
        })
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn restored_prepared_and_possible_absence_never_redispatch_finish() {
    for possible in [false, true] {
        let (done, finished) = mpsc::channel();
        let server = serve(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.delivery.apply",
                    "native.services.delivery.status",
                ],
                "host.1",
            )
            .await;
            let status = next(&mut socket).await;
            assert_eq!(status["method"], "native.services.delivery.status");
            result(&mut socket, &status, json!({"state":"absent"})).await;
            finish_after(finished).await;
            assert!(
                tokio::time::timeout(Duration::from_millis(75), socket.next())
                    .await
                    .is_err(),
                "absence allowed another request"
            );
        });
        let mut fixture = Fixture::new(&server.endpoint, true);
        let params = json!({"id":"absent-original","error":"original failure"});
        let fingerprint = ws_fingerprint(&fixture.machine);
        let key = format!(
            "service.finish:{fingerprint}:{:x}",
            Sha256::digest(b"absent-original")
        );
        let text = serde_json::to_string(&params).unwrap();
        let original = journal::prepare(
            fixture.store(),
            &key,
            &fingerprint,
            "native.services.conversation.desktop.finish",
            &text,
        )
        .unwrap();
        if possible {
            journal::mark_possible(fixture.store(), &original).unwrap();
        }
        fixture.reopen();
        assert!(fixture
            .channel()
            .request("conversation.desktop.finish", params)
            .err()
            .unwrap()
            .contains("Do not repeat"));
        assert_eq!(
            fixture.pending()[0].phase(),
            if possible {
                Phase::Possible
            } else {
                Phase::Prepared
            }
        );
        assert!(!fixture.pending()[0].can_dispatch());
        done.send(()).unwrap();
        drop(server);
    }
}

#[test]
fn large_finish_preserves_original_bytes_binding_and_known_staging_offset() {
    let params = json!({"id":"large-original","result":"🙂\\\"".repeat(150_000)});
    let exact = bounded_params(&params).unwrap();
    assert!(exact.len() > 1024 * 1024);
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
                "native.services.upload.begin",
                "native.services.upload.append",
                "native.services.upload.commit",
            ],
            "host.1",
        )
        .await;
        let begin = next(&mut socket).await;
        assert_eq!(begin["method"], "native.services.upload.begin");
        assert_eq!(
            begin["params"]["uploadId"],
            begin["params"]["delivery"]["originalId"]
        );
        assert_eq!(begin["params"]["byteLength"], exact.len());
        assert_eq!(
            begin["params"]["sha256"],
            format!("{:x}", Sha256::digest(&exact))
        );
        let mut progress = begin["params"].clone();
        let offset = 777;
        let mut received = exact[..offset].to_vec();
        progress["receivedBytes"] = json!(offset);
        progress["state"] = json!("receiving");
        progress["expiresAt"] = json!(1_000_000);
        result(&mut socket, &begin, progress.clone()).await;
        while received.len() < exact.len() {
            let append = next(&mut socket).await;
            assert_eq!(append["method"], "native.services.upload.append");
            assert_eq!(append["params"]["offset"], received.len());
            received.extend(
                base64::engine::general_purpose::STANDARD
                    .decode(append["params"]["data"].as_str().unwrap())
                    .unwrap(),
            );
            progress["receivedBytes"] = json!(received.len());
            result(&mut socket, &append, progress.clone()).await;
        }
        assert_eq!(received.len(), exact.len());
        assert_eq!(Sha256::digest(&received), Sha256::digest(&exact));
        let commit = next(&mut socket).await;
        assert_eq!(commit["method"], "native.services.upload.commit");
        let mut identity = progress["delivery"].clone();
        identity["target"] = progress["target"].clone();
        progress["state"] = json!("completed");
        progress["result"] = recorded(&identity, json!({"accepted":true}));
        result(&mut socket, &commit, progress).await;
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    let reply = fixture
        .channel()
        .request("conversation.desktop.finish", params)
        .unwrap();
    assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
    reply
        .project(|value| {
            assert_eq!(value, &json!({"accepted":true}));
            Ok(())
        })
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn legacy_unknown_finish_is_not_sent_again_across_invocation_or_reopen() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["native.services.conversation.desktop.finish"],
            "host.1",
        )
        .await;
        let request = next(&mut socket).await;
        assert_eq!(
            request["method"],
            "native.services.conversation.desktop.finish"
        );
        socket.send(Message::Text(json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":"RPC_HOST_UNAVAILABLE","message":"reply was lost","data":{"category":"unavailable","retryable":false,"delivery":"unknown"}}}).to_string().into())).await.unwrap();
        finish_after(finished).await;
        drop(socket);
        assert!(
            tokio::time::timeout(Duration::from_millis(75), listener.accept())
                .await
                .is_err()
        );
    });
    let mut fixture = Fixture::new(&server.endpoint, false);
    let params = json!({"id":"legacy-original","result":"done"});
    assert!(fixture
        .channel()
        .request("conversation.desktop.finish", params.clone())
        .is_err());
    let id = fixture.pending()[0].id().to_owned();
    assert!(fixture
        .channel()
        .request("conversation.desktop.finish", params.clone())
        .err()
        .unwrap()
        .contains("Do not repeat"));
    assert_eq!(fixture.pending()[0].id(), id);
    assert_eq!(fixture.pending()[0].phase(), Phase::Possible);
    fixture.reopen();
    assert!(fixture
        .channel()
        .request("conversation.desktop.finish", params)
        .is_err());
    assert_eq!(fixture.pending()[0].id(), id);
    done.send(()).unwrap();
    drop(server);
}

#[test]
fn saved_issuer_change_blocks_consumption_and_changed_finish_bytes_conflict() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut socket).await;
        result(
            &mut socket,
            &apply,
            recorded(&apply["params"], json!({"accepted":true})),
        )
        .await;
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    let params = json!({"id":"pinned-job","result":"first outcome"});
    let reply = fixture
        .channel()
        .request("conversation.desktop.finish", params)
        .unwrap();
    let original = fixture.pending().remove(0);
    assert!(fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"pinned-job","error":"changed outcome"})
        )
        .err()
        .unwrap()
        .contains("CONFLICT"));
    assert!(journal::params_json(fixture.store(), &original)
        .unwrap()
        .contains("first outcome"));
    let mut replacement = fixture.machine.clone();
    replacement.token = "replacement-token".into();
    write(&fixture.root.join("connections.json"), &[replacement]).unwrap();
    assert!(reply.project(|_| Ok(())).is_err());
    assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
    assert!(fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"pinned-job","result":"first outcome"})
        )
        .is_err());
    done.send(()).unwrap();
}

#[test]
fn restored_format_reconciliation_records_result_without_recreating_consumer() {
    let params = json!({"command":"format_text_file","args":{"path":"file.ts","source":"const x=1","cursorOffset":3}});
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut first = accept(&listener).await;
        hello(
            &mut first,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut first).await;
        let identity = apply["params"].clone();
        result(
            &mut first,
            &apply,
            recorded(
                &identity,
                json!({"formatted":"const x = 1;","cursorOffset":4}),
            ),
        )
        .await;
        let mut second = accept(&listener).await;
        hello(
            &mut second,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let status = next(&mut second).await;
        assert_eq!(status["method"], "native.services.delivery.status");
        assert_eq!(status["params"]["originalId"], identity["originalId"]);
        result(
            &mut second,
            &status,
            recorded(
                &status["params"],
                json!({"formatted":"const x = 1;","cursorOffset":4}),
            ),
        )
        .await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    let reply = fixture.channel().request("workspace.run", params).unwrap();
    assert!(reply
        .project::<()>(|_| Err("old editor retired".into()))
        .is_err());
    drop(reply);
    fixture.reopen();
    assert_eq!(
        reconcile_pending(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
        1
    );
    let original = fixture.pending().remove(0);
    assert_eq!(original.phase(), Phase::Recorded);
    assert!(journal::result_json(fixture.store(), &original)
        .unwrap()
        .unwrap()
        .contains("const x = 1;"));
    done.send(()).unwrap();
}

#[test]
fn http_lost_finish_reply_reconciles_without_second_effect() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let (mut first, _) = listener.accept().await.unwrap();
        let apply = read_http_rpc(&mut first).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        first
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\n{")
            .await
            .unwrap();
        first.shutdown().await.unwrap();
        drop(first);
        let (mut second, _) = listener.accept().await.unwrap();
        let status = read_http_rpc(&mut second).await;
        assert_eq!(status["method"], "native.services.delivery.status");
        for field in ["originalId", "sha256", "byteLength", "target"] {
            assert_eq!(status["params"][field], apply["params"][field]);
        }
        let body =
            json!({"result":recorded(&status["params"],json!({"accepted":true}))}).to_string();
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        second.write_all(header.as_bytes()).await.unwrap();
        second.write_all(body.as_bytes()).await.unwrap();
        second.shutdown().await.unwrap();
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    Arc::get_mut(fixture.channel.as_mut().unwrap())
        .unwrap()
        .websocket = false;
    let params = json!({"id":"http-original","result":"original"});
    assert!(fixture
        .channel()
        .request("conversation.desktop.finish", params.clone())
        .is_err());
    assert_eq!(fixture.pending()[0].phase(), Phase::Possible);
    let reply = fixture
        .channel()
        .request("conversation.desktop.finish", params)
        .unwrap();
    reply
        .project(|value| {
            assert_eq!(value, &json!({"accepted":true}));
            Ok(())
        })
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn consumer_success_with_failed_local_ack_retains_original_and_reports_uncertainty() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut socket).await;
        result(
            &mut socket,
            &apply,
            recorded(&apply["params"], json!({"accepted":true})),
        )
        .await;
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    let reply = fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"ack-failure","result":"done"}),
        )
        .unwrap();
    let original = fixture.pending().remove(0);
    fixture.store().lock_conn().unwrap().execute_batch("CREATE TRIGGER refuse_delivery_ack BEFORE UPDATE OF phase ON native_delivery_originals WHEN NEW.phase='acknowledged' BEGIN SELECT RAISE(ABORT,'fixture receipt unavailable'); END;").unwrap();
    let consumed = std::cell::Cell::new(false);
    let error = reply
        .project(|_| {
            consumed.set(true);
            Ok(())
        })
        .err()
        .unwrap();
    assert!(consumed.get());
    assert!(error.contains("may already have been consumed"));
    assert!(error.contains("Do not repeat"));
    assert!(error.contains(original.id()));
    assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
    assert!(journal::params_json(fixture.store(), &original)
        .unwrap()
        .contains("ack-failure"));
    done.send(()).unwrap();
}

#[test]
fn exact_32mib_format_result_uses_chunks_and_retains_all_guards_and_reservation() {
    let mut target = json!({"formatted":"","cursorOffset":0});
    let overhead = serde_json::to_vec(&target).unwrap().len();
    target["formatted"] = json!("x".repeat(RESULT_BYTES - overhead));
    let bytes = serde_json::to_vec(&target).unwrap();
    assert_eq!(bytes.len(), RESULT_BYTES);
    drop(target);
    let source = json!({"sha256":format!("{:x}",Sha256::digest(&bytes)),"byteLength":bytes.len()});
    let (done, finished) = mpsc::channel();
    // 512 chunk round trips carry 32 MiB in a debug build; `workspace.run`
    // keeps the default RPC budget, so the fixture watchdog matches it.
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
                "native.services.delivery.result.read",
                "native.services.delivery.ack",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        let mut status = recorded(&apply["params"], Value::Null);
        status.as_object_mut().unwrap().remove("result");
        status["resultSource"] = source.clone();
        result(&mut socket, &apply, status).await;
        let mut offset = 0;
        while offset < bytes.len() {
            let read = next(&mut socket).await;
            assert_eq!(read["method"], "native.services.delivery.result.read");
            assert_eq!(read["params"]["offset"], offset);
            assert_eq!(read["params"]["resultSource"], source);
            let limit = read["params"]["limit"].as_u64().unwrap() as usize;
            assert!(limit > 0 && limit <= 65_536 && offset + limit <= bytes.len());
            let mut chunk = read["params"].clone();
            chunk.as_object_mut().unwrap().remove("limit");
            chunk["data"] =
                json!(base64::engine::general_purpose::STANDARD
                    .encode(&bytes[offset..offset + limit]));
            result(&mut socket, &read, chunk).await;
            offset += limit;
        }
        let ack = next(&mut socket).await;
        assert_eq!(ack["method"], "native.services.delivery.ack");
        assert_eq!(ack["params"]["consumedResult"], source);
        assert_eq!(ack["params"]["originalId"], apply["params"]["originalId"]);
        result(&mut socket, &ack, retired_receipt(&ack["params"])).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_acks();
    let params = json!({"command":"format_text_file","args":{"path":"file.ts","source":"x","cursorOffset":0}});
    let reply = fixture.channel().request("workspace.run", params).unwrap();
    assert_eq!(reply.related_guards.len(), RESULT_BYTES.div_ceil(65_536));
    assert_eq!(reply.result_charge.as_ref().unwrap().bytes, RESULT_BYTES);
    reply.check().unwrap();
    assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
    reply
        .project(|value| {
            assert_eq!(
                value["formatted"].as_str().unwrap().len(),
                RESULT_BYTES - overhead
            );
            Ok(())
        })
        .unwrap();
    assert!(fixture.pending().is_empty());
    assert!(fixture.remote_acks().is_empty());
    assert_eq!(
        reply.result_charge.as_ref().unwrap().bytes,
        RESULT_BYTES,
        "byte ownership survives journal ACK until the actual reply is dropped"
    );
    done.send(()).unwrap();
}

#[test]
fn source_hash_or_chunk_echo_mismatch_retains_uncertain_original_without_output() {
    for bad_hash in [false, true] {
        let bytes =
            serde_json::to_vec(&json!({"formatted":"x".repeat(1_100_000),"cursorOffset":0}))
                .unwrap();
        let hash = if bad_hash {
            "f".repeat(64)
        } else {
            format!("{:x}", Sha256::digest(&bytes))
        };
        let source = json!({"sha256":hash,"byteLength":bytes.len()});
        let (done, finished) = mpsc::channel();
        let server = serve(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.delivery.apply",
                    "native.services.delivery.status",
                    "native.services.delivery.result.read",
                ],
                "host.1",
            )
            .await;
            let apply = next(&mut socket).await;
            let mut status = recorded(&apply["params"], Value::Null);
            status.as_object_mut().unwrap().remove("result");
            status["resultSource"] = source.clone();
            result(&mut socket, &apply, status).await;
            let mut offset = 0;
            while offset < bytes.len() {
                let read = next(&mut socket).await;
                assert_eq!(read["method"], "native.services.delivery.result.read");
                let limit = read["params"]["limit"].as_u64().unwrap() as usize;
                let mut chunk = read["params"].clone();
                chunk.as_object_mut().unwrap().remove("limit");
                chunk["data"] = json!(base64::engine::general_purpose::STANDARD
                    .encode(&bytes[offset..offset + limit]));
                if !bad_hash {
                    chunk["offset"] = json!(offset + 1);
                }
                result(&mut socket, &read, chunk).await;
                offset += limit;
                if !bad_hash {
                    break;
                }
            }
            finish_after(finished).await;
        });
        let fixture = Fixture::new(&server.endpoint, true);
        let params = json!({"command":"format_text_file","args":{"path":"file.ts","source":"x","cursorOffset":0}});
        assert!(fixture.channel().request("workspace.run", params).is_err());
        let original = fixture.pending().remove(0);
        assert_eq!(original.phase(), Phase::Possible);
        assert!(journal::result_json(fixture.store(), &original)
            .unwrap()
            .is_none());
        done.send(()).unwrap();
    }
}

#[test]
fn delivery_preflight_requires_full_capacity_capability_and_routes() {
    let methods = [
        "native.services.delivery.apply",
        "native.services.delivery.status",
        "native.services.delivery.result.read",
        "native.services.upload.begin",
        "native.services.upload.append",
        "native.services.upload.commit",
    ];
    let descriptor = json!({"capabilities":["native.services.delivery.v1","native.services.v1"],"methods":methods});
    assert!(supports_host(&descriptor));
    for (missing, method) in methods.iter().enumerate() {
        let mut incomplete = descriptor.clone();
        incomplete["methods"]
            .as_array_mut()
            .unwrap()
            .remove(missing);
        assert!(
            !supports_host(&incomplete),
            "partial delivery support accepted {}",
            method
        );
    }
    let mut no_upload = descriptor.clone();
    no_upload["capabilities"] = json!(["native.services.delivery.v1"]);
    assert!(!supports_host(&no_upload));
    no_upload.as_object_mut().unwrap().remove("methods");
    assert!(!supports_host(&no_upload));
}

#[test]
fn large_original_http_staging_avoids_inflated_params_json_envelope() {
    async fn respond(stream: &mut tokio::net::TcpStream, value: Value) {
        let body = json!({"result":value}).to_string();
        stream
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        stream.write_all(body.as_bytes()).await.unwrap();
        stream.shutdown().await.unwrap();
    }
    let params = json!({"id":"raw-http-large","result":"🙂\\\"".repeat(150_000)});
    let exact = bounded_params(&params).unwrap();
    assert!(exact.len() > 1024 * 1024);
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let begin = read_http_rpc(&mut stream).await;
        assert_eq!(begin["method"], "native.services.upload.begin");
        assert_eq!(begin["params"]["byteLength"], exact.len());
        assert_eq!(
            begin["params"]["delivery"]["originalId"],
            begin["params"]["uploadId"]
        );
        let mut progress = begin["params"].clone();
        progress["receivedBytes"] = json!(0);
        progress["state"] = json!("receiving");
        progress["expiresAt"] = json!(1_000_000);
        respond(&mut stream, progress.clone()).await;
        drop(stream);
        let mut bytes = Vec::new();
        while bytes.len() < exact.len() {
            let (mut stream, _) = listener.accept().await.unwrap();
            let append = read_http_rpc(&mut stream).await;
            assert_eq!(append["method"], "native.services.upload.append");
            assert_eq!(append["params"]["offset"], bytes.len());
            bytes.extend(
                base64::engine::general_purpose::STANDARD
                    .decode(append["params"]["data"].as_str().unwrap())
                    .unwrap(),
            );
            progress["receivedBytes"] = json!(bytes.len());
            respond(&mut stream, progress.clone()).await;
        }
        assert_eq!(bytes.len(), exact.len());
        assert_eq!(Sha256::digest(&bytes), Sha256::digest(&exact));
        let (mut stream, _) = listener.accept().await.unwrap();
        let commit = read_http_rpc(&mut stream).await;
        assert_eq!(commit["method"], "native.services.upload.commit");
        let mut identity = progress["delivery"].clone();
        identity["target"] = progress["target"].clone();
        progress["state"] = json!("completed");
        progress["result"] = recorded(&identity, json!({"accepted":true}));
        respond(&mut stream, progress).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    Arc::get_mut(fixture.channel.as_mut().unwrap())
        .unwrap()
        .websocket = false;
    fixture
        .channel()
        .project("conversation.desktop.finish", params, |value| {
            assert_eq!(value, &json!({"accepted":true}));
            Ok(())
        })
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn related_actual_reply_guard_is_required_in_both_projection_branches() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut first = accept(&listener).await;
        hello(
            &mut first,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut first).await;
        result(
            &mut first,
            &apply,
            recorded(&apply["params"], json!({"accepted":true})),
        )
        .await;
        let mut second = accept(&listener).await;
        hello(
            &mut second,
            &["native.services.conversation.desktop.authorize"],
            "host.1",
        )
        .await;
        let authorize = next(&mut second).await;
        result(&mut second, &authorize, json!({"authorized":true})).await;
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    let mut reply = fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"guard-original","result":"done"}),
        )
        .unwrap();
    let other = Fixture::new(&server.endpoint, true);
    let mut foreign = other
        .channel()
        .wire(
            "native.services.conversation.desktop.authorize",
            json!({"id":"foreign","action":"ptyMobile.attach"}),
            Instant::now() + FIXTURE_WAIT,
        )
        .unwrap();
    reply.related_guards.push(foreign.guard.take().unwrap());
    let consumed = std::cell::Cell::new(false);
    assert!(reply.check().is_err());
    assert!(reply
        .project(|_| {
            consumed.set(true);
            Ok(())
        })
        .is_err());
    assert!(!consumed.get());
    reply.delivery = None;
    assert!(reply
        .project(|_| {
            consumed.set(true);
            Ok(())
        })
        .is_err());
    assert!(!consumed.get());
    assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
    done.send(()).unwrap();
}

#[test]
fn deadline_midpage_recovery_continues_with_unattempted_originals() {
    let (ids_tx, ids_rx) = mpsc::channel::<Vec<String>>();
    let (hold, held) = mpsc::channel();
    let (locked, wait_locked) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let ids = tokio::task::spawn_blocking(move || ids_rx.recv_timeout(FIXTURE_WAIT).unwrap())
            .await
            .unwrap();
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.services.delivery.status"], "host.1").await;
        let first = next(&mut socket).await;
        assert_eq!(first["params"]["originalId"], ids[0]);
        hold.send(()).unwrap();
        tokio::task::spawn_blocking(move || wait_locked.recv_timeout(FIXTURE_WAIT).unwrap())
            .await
            .unwrap();
        result(
            &mut socket,
            &first,
            recorded(&first["params"], json!({"accepted":true})),
        )
        .await;
        for id in ids.into_iter().skip(1) {
            let next_status = next(&mut socket).await;
            assert_eq!(next_status["method"], "native.services.delivery.status");
            assert_eq!(
                next_status["params"]["originalId"], id,
                "unattempted page row was skipped"
            );
            result(
                &mut socket,
                &next_status,
                recorded(&next_status["params"], json!({"accepted":true})),
            )
            .await;
        }
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    let fingerprint = ws_fingerprint(&fixture.machine);
    for index in 0..4 {
        let params =
            serde_json::to_string(&json!({"id":format!("page-{index}"),"result":"done"})).unwrap();
        let original = journal::prepare(
            fixture.store(),
            &format!("fairness-{index}"),
            &fingerprint,
            "native.services.conversation.desktop.finish",
            &params,
        )
        .unwrap();
        journal::mark_possible(fixture.store(), &original).unwrap();
    }
    let ids = fixture
        .pending()
        .into_iter()
        .map(|o| o.id().to_owned())
        .collect::<Vec<_>>();
    ids_tx.send(ids.clone()).unwrap();
    let store = fixture.store.as_ref().unwrap().clone();
    // The first row must be attempted before the deadline and the deadline
    // must pass while its journal write waits on the store lock. A fixed 300 ms
    // budget could expire during the first connection on a loaded runner, so
    // the lock is held until the (roomier) deadline has actually passed.
    let deadline = Instant::now() + MIDPAGE_DEADLINE;
    let blocker = std::thread::spawn(move || {
        held.recv_timeout(FIXTURE_WAIT).unwrap();
        let _guard = store.lock_conn().unwrap();
        locked.send(()).unwrap();
        std::thread::sleep(
            deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(200),
        );
    });
    assert_eq!(reconcile_pending(fixture.channel(), deadline).unwrap(), 1);
    blocker.join().unwrap();
    assert_eq!(
        fixture.channel().delivery_cursor.lock().unwrap().as_deref(),
        Some(ids[0].as_str())
    );
    assert_eq!(
        reconcile_pending(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
        3
    );
    assert!(fixture
        .pending()
        .iter()
        .all(|o| o.phase() == Phase::Recorded));
    done.send(()).unwrap();
}

#[test]
fn equal_format_inputs_are_distinct_actual_invocations() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let first = next(&mut socket).await;
        assert_eq!(first["method"], "native.services.delivery.apply");
        result(&mut socket, &first, recorded(&first["params"], Value::Null)).await;
        let second = next(&mut socket).await;
        assert_eq!(second["method"], "native.services.delivery.apply");
        assert_ne!(
            first["params"]["originalId"],
            second["params"]["originalId"]
        );
        assert_eq!(first["params"]["sha256"], second["params"]["sha256"]);
        result(
            &mut socket,
            &second,
            recorded(&second["params"], Value::Null),
        )
        .await;
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    let params = json!({"command":"format_text_file","args":{"path":"file.ts","source":"same","cursorOffset":0}});
    for _ in 0..2 {
        fixture
            .channel()
            .project("workspace.run", params.clone(), |value| {
                assert!(value.is_null());
                Ok(())
            })
            .unwrap();
    }
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn consumed_finish_lost_remote_ack_reopens_ack_only_and_retired_is_terminal() {
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let methods = [
            "native.services.delivery.apply",
            "native.services.delivery.status",
            "native.services.delivery.ack",
        ];
        let mut first = accept(&listener).await;
        hello(&mut first, &methods, "host.1").await;
        let apply = next(&mut first).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        result(
            &mut first,
            &apply,
            recorded(&apply["params"], json!({"accepted":true})),
        )
        .await;
        let ack = next(&mut first).await;
        assert_eq!(ack["method"], "native.services.delivery.ack");
        for field in ["originalId", "sha256", "byteLength", "target"] {
            assert_eq!(ack["params"][field], apply["params"][field]);
        }
        let accepted = serde_json::to_vec(&json!({"accepted":true})).unwrap();
        assert_eq!(
            ack["params"]["consumedResult"],
            json!({
                "sha256":format!("{:x}",Sha256::digest(&accepted)),"byteLength":accepted.len()
            })
        );
        first.close(None).await.unwrap();
        drop(first);

        let (mut second, retry) = restored_connection(&listener, &methods).await;
        assert_eq!(retry["method"], "native.services.delivery.ack");
        assert_eq!(retry["params"], ack["params"]);
        result(&mut second, &retry, retired_receipt(&retry["params"])).await;
        let status = next(&mut second).await;
        assert_eq!(status["method"], "native.services.delivery.status");
        assert_eq!(status["params"]["originalId"], ack["params"]["originalId"]);
        result(&mut second, &status, retired_receipt(&ack["params"])).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_acks();
    let params = json!({"id":"consumed-relay","result":"done"});
    let reply = fixture
        .channel()
        .request("conversation.desktop.finish", params.clone())
        .unwrap();
    let original = fixture.pending().remove(0);
    reply.check().unwrap();
    assert!(
        fixture.remote_acks().is_empty(),
        "checking is not consumption"
    );
    assert_eq!(
        reply.project(|_| Ok(42)).unwrap(),
        42,
        "lost cleanup ACK cannot fail completed consumption"
    );
    let attempted_again = std::cell::Cell::new(false);
    assert!(reply
        .project(|_| {
            attempted_again.set(true);
            Ok(())
        })
        .is_err());
    assert!(!attempted_again.get());
    let held = fixture.remote_acks().remove(0);
    assert_eq!(held.id(), original.id());
    assert_eq!(held.phase(), Phase::Acknowledged);
    assert!(journal::params_json(fixture.store(), &held).is_err());
    assert!(journal::result_json(fixture.store(), &held)
        .unwrap()
        .is_none());
    drop(reply);
    fixture.reopen();
    assert_eq!(
        reconcile_remote_acks(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
        1
    );
    assert!(fixture.remote_acks().is_empty());
    let error = fixture
        .channel()
        .request("conversation.desktop.finish", params)
        .err()
        .unwrap();
    assert!(error.contains("NATIVE_SERVICE_DELIVERY_RETIRED"));
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn remote_ack_mismatched_echo_stays_pending_without_failing_success() {
    for mismatch in ["consumedResult", "originalId"] {
        let (done, finished) = mpsc::channel();
        let server = serve(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.delivery.apply",
                    "native.services.delivery.ack",
                ],
                "host.1",
            )
            .await;
            let apply = next(&mut socket).await;
            result(&mut socket, &apply, recorded(&apply["params"], Value::Null)).await;
            let first = next(&mut socket).await;
            assert_eq!(first["method"], "native.services.delivery.ack");
            let mut wrong = retired_receipt(&first["params"]);
            if mismatch == "consumedResult" {
                wrong["consumedResult"]["sha256"] = json!("f".repeat(64));
            } else {
                wrong["originalId"] = json!(uuid::Uuid::new_v4().to_string());
            }
            result(&mut socket, &first, wrong).await;
            let retry = next(&mut socket).await;
            assert_eq!(retry["method"], "native.services.delivery.ack");
            assert_eq!(retry["params"], first["params"]);
            result(&mut socket, &retry, retired_receipt(&retry["params"])).await;
            finish_after(finished).await;
        });
        let mut fixture = Fixture::new(&server.endpoint, true);
        fixture.enable_acks();
        let reply = fixture.channel().request("workspace.run", json!({"command":"format_text_file","args":{"path":"x.ts","source":"x","cursorOffset":0}})).unwrap();
        reply
            .project(|value| {
                assert!(value.is_null());
                Ok(())
            })
            .unwrap();
        assert_eq!(
            fixture.remote_acks().len(),
            1,
            "mismatched echo cannot retire the local outbox"
        );
        assert_eq!(
            reconcile_remote_acks(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
            1
        );
        assert!(fixture.remote_acks().is_empty());
        done.send(()).unwrap();
    }
}

#[test]
fn failed_consumer_or_local_ack_never_sends_remote_ack() {
    for fail_sql in [false, true] {
        let (inspect, inspecting) = mpsc::channel();
        let (verified, verification) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        let server = serve(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.delivery.apply",
                    "native.services.delivery.ack",
                ],
                "host.1",
            )
            .await;
            let apply = next(&mut socket).await;
            result(
                &mut socket,
                &apply,
                recorded(&apply["params"], json!({"accepted":true})),
            )
            .await;
            finish_after(inspecting).await;
            assert!(
                tokio::time::timeout(Duration::from_millis(100), socket.next())
                    .await
                    .is_err(),
                "remote ACK was sent before successful local consumption and durable ACK"
            );
            verified.send(()).unwrap();
            finish_after(finished).await;
        });
        let mut fixture = Fixture::new(&server.endpoint, true);
        fixture.enable_acks();
        let reply = fixture
            .channel()
            .request(
                "conversation.desktop.finish",
                json!({"id":"failed-consume","result":"done"}),
            )
            .unwrap();
        if fail_sql {
            fixture.store().lock_conn().unwrap().execute_batch("CREATE TRIGGER reject_local_ack BEFORE UPDATE OF phase ON native_delivery_originals WHEN NEW.phase='acknowledged' BEGIN SELECT RAISE(ABORT, 'local ACK unavailable'); END;").unwrap();
            let error = reply.project(|_| Ok(())).unwrap_err();
            assert!(error.contains("may already have been consumed"));
            assert!(reply
                .project::<()>(|_| panic!(
                    "successful consumer must never be retried on this reply"
                ))
                .is_err());
        } else {
            assert!(reply
                .project::<()>(|_| Err("consumer unavailable".into()))
                .is_err());
        }
        assert_eq!(fixture.pending()[0].phase(), Phase::Recorded);
        assert!(fixture.remote_acks().is_empty());
        inspect.send(()).unwrap();
        verification.recv_timeout(FIXTURE_WAIT).unwrap();
        done.send(()).unwrap();
    }
}

#[test]
fn ack_capability_requires_explicit_method_and_preserves_old_host_outbox() {
    let methods = [
        "native.services.delivery.apply",
        "native.services.delivery.status",
        "native.services.delivery.result.read",
        "native.services.upload.begin",
        "native.services.upload.append",
        "native.services.upload.commit",
        "native.services.delivery.ack",
    ];
    let descriptor = json!({"capabilities":["native.services.v1","native.services.delivery.v1","native.services.delivery.ack.v1"],"methods":methods});
    assert!(supports_ack_host(&descriptor));
    let mut missing_cap = descriptor.clone();
    missing_cap["capabilities"] = json!(["native.services.v1", "native.services.delivery.v1"]);
    assert!(!supports_ack_host(&missing_cap));
    let mut missing_method = descriptor;
    missing_method["methods"].as_array_mut().unwrap().pop();
    assert!(!supports_ack_host(&missing_method));
    assert!(supports_host(&missing_method));
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.status",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut socket).await;
        result(
            &mut socket,
            &apply,
            recorded(&apply["params"], json!({"accepted":true})),
        )
        .await;
        let status = next(&mut socket).await;
        assert_eq!(status["method"], "native.services.delivery.status");
        result(
            &mut socket,
            &status,
            recorded(&status["params"], json!({"accepted":true})),
        )
        .await;
        finish_after(finished).await;
    });
    let fixture = Fixture::new(&server.endpoint, true);
    fixture
        .channel()
        .project(
            "conversation.desktop.finish",
            json!({"id":"old-host","result":"done"}),
            |_| Ok(()),
        )
        .unwrap();
    assert_eq!(fixture.remote_acks().len(), 1);
    assert_eq!(
        reconcile_remote_acks(fixture.channel(), Instant::now() + Duration::from_secs(1)).unwrap(),
        0
    );
    assert_eq!(fixture.remote_acks().len(), 1);
    let repeated = fixture
        .channel()
        .request(
            "conversation.desktop.finish",
            json!({"id":"old-host","result":"done"}),
        )
        .err()
        .unwrap();
    assert!(repeated.contains("NATIVE_SERVICE_DELIVERY_RETIRED"));
    done.send(()).unwrap();
}

#[test]
fn chunked_result_ack_uses_consumed_canonical_json_not_raw_source_digest() {
    let raw = br#"{"formatted":"let x = 1;","cursorOffset":5}"#.to_vec();
    let value: Value = serde_json::from_slice(&raw).unwrap();
    let canonical = serde_json::to_vec(&value).unwrap();
    assert_ne!(raw, canonical);
    let source = json!({"sha256":format!("{:x}",Sha256::digest(&raw)),"byteLength":raw.len()});
    let consumed =
        json!({"sha256":format!("{:x}",Sha256::digest(&canonical)),"byteLength":canonical.len()});
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "native.services.delivery.apply",
                "native.services.delivery.result.read",
                "native.services.delivery.ack",
            ],
            "host.1",
        )
        .await;
        let apply = next(&mut socket).await;
        let mut status = recorded(&apply["params"], Value::Null);
        status.as_object_mut().unwrap().remove("result");
        status["resultSource"] = source.clone();
        result(&mut socket, &apply, status).await;
        let read = next(&mut socket).await;
        assert_eq!(read["method"], "native.services.delivery.result.read");
        let mut chunk = read["params"].clone();
        chunk.as_object_mut().unwrap().remove("limit");
        chunk["data"] = json!(base64::engine::general_purpose::STANDARD.encode(&raw));
        result(&mut socket, &read, chunk).await;
        let ack = next(&mut socket).await;
        assert_eq!(ack["method"], "native.services.delivery.ack");
        assert_eq!(ack["params"]["consumedResult"], consumed);
        assert_ne!(ack["params"]["consumedResult"], source);
        result(&mut socket, &ack, retired_receipt(&ack["params"])).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_acks();
    let reply = fixture.channel().request("workspace.run", json!({"command":"format_text_file","args":{"path":"x.ts","source":"x","cursorOffset":0}})).unwrap();
    assert_eq!(reply.related_guards.len(), 1);
    let charge = reply.result_charge.as_ref().unwrap().bytes;
    reply
        .project(|result| {
            assert_eq!(result, &value);
            Ok(())
        })
        .unwrap();
    assert!(fixture.remote_acks().is_empty());
    assert_eq!(reply.result_charge.as_ref().unwrap().bytes, charge);
    reply.check().unwrap();
    done.send(()).unwrap();
}

fn seed_consumed(fixture: &Fixture, index: usize, method: &str) -> Original {
    let prepared = journal::prepare(
        fixture.store(),
        &format!("consumed-{index}"),
        &ws_fingerprint(&fixture.machine),
        method,
        &format!(r#"{{"id":"consumed-{index}"}}"#),
    )
    .unwrap();
    let possible = journal::mark_possible(fixture.store(), &prepared).unwrap();
    let result = if method == "native.buffers.update" {
        json!({"acknowledged":true})
    } else {
        json!({"accepted":true})
    };
    let recorded = journal::record_result(
        fixture.store(),
        &possible,
        &serde_json::to_string(&result).unwrap(),
    )
    .unwrap();
    journal::acknowledge(fixture.store(), &recorded).unwrap();
    journal::remote_ack_candidate(fixture.store(), &recorded)
        .unwrap()
        .unwrap()
}

#[test]
fn ack_deadline_midpage_advances_only_attempted_rows_and_skips_buffer_kind() {
    let (ids_tx, ids_rx) = mpsc::channel::<Vec<String>>();
    let (hold, held) = mpsc::channel();
    let (locked, wait_locked) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let ids = tokio::task::spawn_blocking(move || ids_rx.recv_timeout(FIXTURE_WAIT).unwrap())
            .await
            .unwrap();
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.services.delivery.ack"], "host.1").await;
        let first = next(&mut socket).await;
        assert_eq!(first["method"], "native.services.delivery.ack");
        assert_eq!(first["params"]["originalId"], ids[0]);
        hold.send(()).unwrap();
        tokio::task::spawn_blocking(move || wait_locked.recv_timeout(FIXTURE_WAIT).unwrap())
            .await
            .unwrap();
        result(&mut socket, &first, retired_receipt(&first["params"])).await;
        for id in ids.into_iter().skip(1) {
            let ack = next(&mut socket).await;
            assert_eq!(ack["method"], "native.services.delivery.ack");
            assert_eq!(ack["params"]["originalId"], id);
            result(&mut socket, &ack, retired_receipt(&ack["params"])).await;
        }
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_acks();
    for index in 0..5 {
        seed_consumed(
            &fixture,
            index,
            if index == 4 {
                "native.buffers.update"
            } else {
                "native.services.conversation.desktop.finish"
            },
        );
    }
    let all = fixture.remote_acks();
    let ids = all
        .iter()
        .filter(|original| original.method() != "native.buffers.update")
        .map(|original| original.id().to_owned())
        .collect::<Vec<_>>();
    let second_service = all
        .iter()
        .position(|original| original.id() == ids[1])
        .unwrap();
    let first_cursor = all[second_service - 1].ack_cursor();
    ids_tx.send(ids.clone()).unwrap();
    let store = fixture.store.as_ref().unwrap().clone();
    // The first row must be attempted before the deadline and the deadline
    // must pass while its journal write waits on the store lock. A fixed 300 ms
    // budget could expire during the first connection on a loaded runner, so
    // the lock is held until the (roomier) deadline has actually passed.
    let deadline = Instant::now() + MIDPAGE_DEADLINE;
    let blocker = std::thread::spawn(move || {
        held.recv_timeout(FIXTURE_WAIT).unwrap();
        let _guard = store.lock_conn().unwrap();
        locked.send(()).unwrap();
        std::thread::sleep(
            deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(200),
        );
    });
    assert_eq!(
        reconcile_remote_acks(fixture.channel(), deadline).unwrap(),
        1
    );
    blocker.join().unwrap();
    assert_eq!(
        fixture
            .channel()
            .delivery_ack_cursor
            .lock()
            .unwrap()
            .as_deref(),
        Some(first_cursor.as_str())
    );
    assert_eq!(
        reconcile_remote_acks(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
        3
    );
    let remaining = fixture.remote_acks();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].method(), "native.buffers.update");
    done.send(()).unwrap();
}

#[test]
fn remote_ack_rejects_retired_caller_and_replaced_saved_issuer_before_dispatch() {
    for change_saved in [false, true] {
        let (inspect, inspecting) = mpsc::channel();
        let (verified, verification) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        let server = serve(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.delivery.status",
                    "native.services.delivery.ack",
                ],
                "host.1",
            )
            .await;
            let status = next(&mut socket).await;
            assert_eq!(status["method"], "native.services.delivery.status");
            result(
                &mut socket,
                &status,
                recorded(&status["params"], json!({"accepted":true})),
            )
            .await;
            finish_after(inspecting).await;
            if let Ok(Some(Ok(message))) =
                tokio::time::timeout(Duration::from_millis(100), socket.next()).await
            {
                assert!(
                    matches!(message, Message::Close(_)),
                    "retired or replaced issuer sent another request"
                );
            }
            verified.send(()).unwrap();
            finish_after(finished).await;
        });
        let mut fixture = Fixture::new(&server.endpoint, true);
        fixture.enable_acks();
        let original = seed_consumed(&fixture, 0, "native.services.conversation.desktop.finish");
        let reply = fixture
            .channel()
            .wire(
                "native.services.delivery.status",
                status_params(&original),
                Instant::now() + FIXTURE_WAIT,
            )
            .unwrap();
        reply.check().unwrap();
        if change_saved {
            let mut replacement = fixture.machine.clone();
            replacement.token = "replacement-fixture-token".into();
            write(&fixture.root.join("connections.json"), &[replacement]).unwrap();
        } else {
            fixture.broker.invalidate_machine(&fixture.machine.id);
        }
        assert!(acknowledge_remote(
            fixture.channel(),
            &original,
            &reply.guards(),
            Instant::now() + Duration::from_secs(1)
        )
        .is_err());
        assert_eq!(fixture.remote_acks().len(), 1);
        inspect.send(()).unwrap();
        verification.recv_timeout(FIXTURE_WAIT).unwrap();
        done.send(()).unwrap();
    }
}

#[test]
fn http_ack_loss_preserves_success_and_reopens_cleanup_only() {
    async fn respond(stream: &mut tokio::net::TcpStream, request: &Value, value: Value) {
        let body = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":request["id"],"result":value}))
            .unwrap();
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
        stream.write_all(&body).await.unwrap();
    }
    let (done, finished) = mpsc::channel();
    let server = serve(move |listener| async move {
        let (mut apply_socket, _) = listener.accept().await.unwrap();
        let apply = read_http_rpc(&mut apply_socket).await;
        assert_eq!(apply["method"], "native.services.delivery.apply");
        respond(
            &mut apply_socket,
            &apply,
            recorded(&apply["params"], Value::Null),
        )
        .await;
        drop(apply_socket);
        let (mut ack_socket, _) = listener.accept().await.unwrap();
        let ack = read_http_rpc(&mut ack_socket).await;
        assert_eq!(ack["method"], "native.services.delivery.ack");
        ack_socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{\"jsonrpc\":").await.unwrap();
        ack_socket.shutdown().await.unwrap();
        drop(ack_socket);
        let (mut retry_socket, _) = listener.accept().await.unwrap();
        let retry = read_http_rpc(&mut retry_socket).await;
        assert_eq!(retry["method"], "native.services.delivery.ack");
        assert_eq!(retry["params"], ack["params"]);
        respond(&mut retry_socket, &retry, retired_receipt(&retry["params"])).await;
        finish_after(finished).await;
    });
    let mut fixture = Fixture::new(&server.endpoint, true);
    fixture.enable_acks();
    Arc::get_mut(fixture.channel.as_mut().unwrap())
        .unwrap()
        .websocket = false;
    fixture.channel().project("workspace.run", json!({"command":"format_text_file","args":{"path":"x.ts","source":"x","cursorOffset":0}}), |value| {assert!(value.is_null()); Ok(())}).unwrap();
    assert_eq!(fixture.remote_acks().len(), 1);
    fixture.reopen();
    Arc::get_mut(fixture.channel.as_mut().unwrap())
        .unwrap()
        .websocket = false;
    assert_eq!(
        reconcile_remote_acks(fixture.channel(), Instant::now() + FIXTURE_WAIT).unwrap(),
        1
    );
    assert!(fixture.remote_acks().is_empty());
    done.send(()).unwrap();
}

#[test]
fn restored_original_retired_status_is_terminal_without_recording_or_consuming() {
    for mismatch in [false, true] {
        let (done, finished) = mpsc::channel();
        let server = serve(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.delivery.status",
                    "native.services.delivery.ack",
                ],
                "host.1",
            )
            .await;
            let status = next(&mut socket).await;
            assert_eq!(status["method"], "native.services.delivery.status");
            let accepted = serde_json::to_vec(&json!({"accepted":true})).unwrap();
            let mut receipt = status["params"].clone();
            receipt["consumedResult"] = json!({"sha256":format!("{:x}",Sha256::digest(&accepted)),"byteLength":accepted.len()});
            if mismatch {
                receipt["originalId"] = json!(uuid::Uuid::new_v4().to_string());
            }
            result(&mut socket, &status, retired_receipt(&receipt)).await;
            finish_after(finished).await;
        });
        let mut fixture = Fixture::new(&server.endpoint, true);
        fixture.enable_acks();
        let params = json!({"id":"already-retired","result":"done"});
        let fingerprint = ws_fingerprint(&fixture.machine);
        let key = format!(
            "service.finish:{fingerprint}:{:x}",
            Sha256::digest(b"already-retired")
        );
        let prepared = journal::prepare(
            fixture.store(),
            &key,
            &fingerprint,
            "native.services.conversation.desktop.finish",
            &serde_json::to_string(&params).unwrap(),
        )
        .unwrap();
        journal::mark_possible(fixture.store(), &prepared).unwrap();
        fixture.reopen();
        let error = fixture
            .channel()
            .request("conversation.desktop.finish", params)
            .err()
            .unwrap();
        assert!(error.contains(if mismatch {
            "NATIVE_SERVICE_DELIVERY_UNCONFIRMED"
        } else {
            "NATIVE_SERVICE_DELIVERY_RETIRED"
        }));
        assert_eq!(fixture.pending()[0].phase(), Phase::Possible);
        assert!(fixture.remote_acks().is_empty());
        done.send(()).unwrap();
    }
}
