use super::native_workspace_transport::NativeWorkspaceChannel;
use super::*;
use crate::host_ws::native_profile::NativeProfileBroker;
use crate::host_ws::tests::{accept, hello, next, result, try_accept, try_hello, try_next, Server};
use crate::session_store::{authority, native_delivery as journal, SessionStore};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::mpsc, time::Duration};
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};

const APPLY: &str = "native.buffers.delivery.apply";
const STATUS: &str = "native.buffers.delivery.status";
const UPLOAD: &[&str] = &[
    "native.buffers.upload.start",
    "native.buffers.upload.write",
    "native.buffers.upload.commit",
    "native.buffers.upload.status",
    APPLY,
    STATUS,
];

struct Fixture {
    root: PathBuf,
    path: PathBuf,
    database_path: PathBuf,
    store: Option<SessionStore>,
    state: Arc<RemoteConnections>,
    machine: StoredMachine,
}
impl Fixture {
    fn new(endpoint: &str) -> Self {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "bycoda-buffer-delivery-wire-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("connections.json");
        let database_path = root.join("sessions.sqlite");
        let machine = StoredMachine {
            id: "machine.1".into(),
            name: "Native original fixture".into(),
            endpoint: endpoint.into(),
            environment_id: "host.1".into(),
            token: "secret-native-token".into(),
            ssh: None,
            local_host: true,
        };
        write(&path, std::slice::from_ref(&machine)).unwrap();
        let store = Some(SessionStore::open(database_path.clone()).unwrap());
        Self {
            root,
            path,
            database_path,
            store,
            state: Arc::new(RemoteConnections::default()),
            machine,
        }
    }
    fn store(&self) -> &SessionStore {
        self.store.as_ref().unwrap()
    }
    fn transport(&self, delivery: bool, uploads: bool) -> NativeWorkspaceTransport {
        self.transport_kind(delivery, uploads, true)
    }
    fn transport_kind(
        &self,
        delivery: bool,
        uploads: bool,
        websocket: bool,
    ) -> NativeWorkspaceTransport {
        let selection = NativeRecoverySelection {
            store: self.state.store.clone(),
            routes: self.state.recovery_routes.clone(),
            path: self.path.clone(),
            machine: self.machine.clone(),
            pin: RecoveryRoute {
                revision: self.state.recovery_routes.capture().unwrap(),
                selected_endpoint: self.machine.endpoint.clone(),
            },
        };
        selection.with_current(|| Ok(())).unwrap();
        let caller = if websocket {
            Some(
                self.state
                    .native_profile_ws
                    .capture_workspace(
                        NativeRoute::new(
                            &self.machine.id,
                            &self.machine.environment_id,
                            &self.machine.endpoint,
                            &self.machine.token,
                            &ws_fingerprint(&self.machine),
                        )
                        .unwrap(),
                    )
                    .unwrap(),
            )
        } else {
            None
        };
        NativeWorkspaceTransport {
            machine: self.machine.clone(),
            recovery: None,
            workspace: Some(Arc::new(NativeWorkspaceChannel {
                selection,
                caller,
                pending: self.state.native_workspace_uploads.clone(),
                uploads,
                delivery,
                delivery_ack: false,
                delivery_epochs: false,
                delivery_cursors: self.state.native_buffer_delivery_cursors.clone(),
                delivery_ack_cursors: self.state.native_buffer_delivery_ack_cursors.clone(),
            })),
        }
    }
    fn restart(&mut self) {
        self.state.native_profile_ws.shutdown();
        drop(self.store.take());
        self.state = Arc::new(RemoteConnections::default());
        self.store = Some(SessionStore::open(self.database_path.clone()).unwrap());
    }
    fn http_transport(&self) -> NativeWorkspaceTransport {
        self.transport_kind(true, true, false)
    }

    fn ack_transport(&self) -> NativeWorkspaceTransport {
        let mut transport = self.transport(true, true);
        Arc::get_mut(transport.workspace.as_mut().unwrap())
            .unwrap()
            .delivery_ack = true;
        transport
    }

    fn epoch_transport(&self) -> NativeWorkspaceTransport {
        let mut transport = self.ack_transport();
        Arc::get_mut(transport.workspace.as_mut().unwrap())
            .unwrap()
            .delivery_epochs = true;
        transport
    }

    fn remote_ack_outbox(&self) -> Vec<journal::Original> {
        journal::pending_remote_acks(self.store(), &ws_fingerprint(&self.machine), None, 32)
            .unwrap()
            .originals
    }
    fn pending(&self) -> Vec<journal::Original> {
        journal::pending(self.store(), &ws_fingerprint(&self.machine), None, 32)
            .unwrap()
            .originals
    }
    fn replace_saved_token(&self) {
        let _saved = self.state.store.lock().unwrap();
        let mut changed = self.machine.clone();
        changed.token = "retired-original-token".into();
        write(&self.path, &[changed]).unwrap();
    }
    fn seed_legacy_current(&self) {
        let conn = self.store().lock_conn().unwrap();
        conn.execute_batch("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce) VALUES('current-owner','[{\"path\":\"G:/current-draft.rs\",\"dirty\":true}]',99,1,'current-physical-nonce');").unwrap();
        crate::native_workspace::ensure_schema(&conn).unwrap();
    }
    fn current_raw(&self) -> (String, i64, i64, String) {
        let conn = self.store().lock_conn().unwrap();
        conn.query_row("SELECT snapshot_json,updated_at,confirmed,report_nonce FROM native_workspace_buffers WHERE owner_id='current-owner'",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.native_profile_ws.shutdown();
        drop(self.store.take());
        if let (Ok(root), Ok(target)) = (
            std::env::temp_dir().canonicalize(),
            self.root.canonicalize(),
        ) {
            if target.parent() == Some(root.as_path())
                && target.file_name().is_some_and(|n| {
                    n.to_string_lossy()
                        .starts_with("bycoda-buffer-delivery-wire-")
                })
            {
                let _ = std::fs::remove_dir_all(target);
            }
        }
    }
}

fn params() -> Value {
    json!({"clientId":"native-client","instanceId":"native-instance","processId":1,
        "owners":[{"ownerId":"original-window","updatedAt":1,"unknown":true,
            "buffers":[{"path":"G:/çalışma/文件.rs","dirty":true}]}]})
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn identity(value: &Value) -> Value {
    json!({"originalId":value["originalId"],"sha256":value["sha256"],"byteLength":value["byteLength"]})
}
fn recorded(value: &Value) -> Value {
    let mut result = identity(value);
    result["state"] = json!("recorded");
    result["result"] = json!({"acknowledged":true});
    result
}
fn ack(
    store: &SessionStore,
    projection: &NativeProjection<'_>,
    original: &journal::Original,
) -> Result<(), String> {
    let admission = journal::completion_admission(store)?;
    admission.finish(NativeProjection::commit(&[projection], || {
        authority::with_full_projection_transaction(store, |tx| {
            journal::acknowledge_tx(tx.connection(), original)
        })
    }))
}

async fn await_done(socket: &mut WebSocketStream<tokio::net::TcpStream>, done: mpsc::Receiver<()>) {
    let mut wait =
        tokio::task::spawn_blocking(move || done.recv_timeout(Duration::from_secs(5)).unwrap());
    loop {
        tokio::select! {
            result=&mut wait => { result.unwrap();return; }
            frame=socket.next() => match frame {
                Some(Ok(Message::Text(text))) => panic!("unexpected request or replay while original was held: {}",serde_json::from_str::<Value>(&text).unwrap()["method"]),
                Some(Ok(Message::Ping(data))) => socket.send(Message::Pong(data)).await.unwrap(),
                Some(Ok(Message::Pong(_))) => {},
                Some(Ok(Message::Close(_)))|Some(Err(_))|None => { wait.await.unwrap();return; },
                other => panic!("unexpected fixture frame: {other:?}"),
            }
        }
    }
}

/// After the fixture drops a socket, the pre-restart broker's reconnect
/// scheduler may reach the listener before `fixture.restart()` shuts it down.
/// That superseded connection never issues a request and closes on shutdown,
/// so the restored connection is the first one that sends a request.
async fn restored_connection(
    listener: &tokio::net::TcpListener,
    methods: &[&str],
) -> (WebSocketStream<tokio::net::TcpStream>, Value) {
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

fn retired(params: &Value) -> Value {
    let mut value = params.clone();
    value["state"] = json!("retired");
    value
}

const EPOCH_OPEN: &str = "native.delivery.epochs.open";
const EPOCH_STATUS: &str = "native.delivery.epochs.status";
const EPOCH_COMPACT: &str = "native.delivery.epochs.compact";
const EPOCH_CLOSE: &str = "native.delivery.epochs.close";
const EPOCH_OWNER: &str = "11111111-1111-4111-8111-111111111111";

fn epoch_description(open_id: &Value, through: u64, high_water: u64) -> Value {
    json!({"version":2,"openId":open_id,"ownerId":EPOCH_OWNER,"generation":1,
        "through":through,"highWater":high_water,"closed":false})
}

fn retained_count(store: &SessionStore, table: &str) -> i64 {
    assert!([
        "native_delivery_originals",
        "native_delivery_epoch_allocations",
        "native_delivery_semantic_retirements",
        "native_delivery_remote_acks"
    ]
    .contains(&table));
    store
        .lock_conn()
        .unwrap()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn v2_buffer_compaction_keeps_exact_semantic_barrier_after_reopen_and_downgrade() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let methods = [
            APPLY,
            STATUS,
            ACK,
            EPOCH_OPEN,
            EPOCH_STATUS,
            EPOCH_COMPACT,
            EPOCH_CLOSE,
        ];
        let mut socket = accept(&listener).await;
        hello(&mut socket, &methods, "host.1").await;
        let open = next(&mut socket).await;
        assert_eq!(open["method"], EPOCH_OPEN);
        let open_id = open["params"]["openId"].clone();
        result(&mut socket, &open, epoch_description(&open_id, 0, 0)).await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], APPLY);
        assert_eq!(
            apply["params"]["originalId"],
            format!("nd2:{EPOCH_OWNER}:1:1")
        );
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        let ack_request = next(&mut socket).await;
        assert_eq!(ack_request["method"], ACK);
        result(&mut socket, &ack_request, retired(&ack_request["params"])).await;
        let compact = next(&mut socket).await;
        assert_eq!(compact["method"], EPOCH_COMPACT);
        assert_eq!(
            compact["params"],
            json!({"ownerId":EPOCH_OWNER,"generation":1,"expectedThrough":0,"through":1})
        );
        result(&mut socket, &compact, epoch_description(&open_id, 1, 1)).await;
        drop(socket);
        let (mut restored, reopen) = restored_connection(&listener, &methods).await;
        assert_eq!(reopen["method"], EPOCH_OPEN);
        assert_eq!(reopen["params"]["openId"], open_id);
        result(&mut restored, &reopen, epoch_description(&open_id, 1, 1)).await;
        await_done(&mut restored, wait).await;
    });
    let mut fixture = Fixture::new(&server.endpoint);
    let transport = fixture.epoch_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "v2:physical:1",
            params(),
            |_, projection, original| {
                assert_eq!(
                    retained_count(fixture.store(), "native_delivery_semantic_retirements"),
                    0
                );
                ack(fixture.store(), projection, original)
            },
        )
        .unwrap();
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        0
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_epoch_allocations"),
        0
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_remote_acks"),
        0
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        1
    );
    drop(transport);
    fixture.restart();
    let transport = fixture.epoch_transport();
    let error = transport
        .project_buffer_original::<()>(fixture.store(), "v2:physical:1", params(), |_, _, _| {
            panic!("retired original cannot consume")
        })
        .unwrap_err();
    assert!(error.contains("NATIVE_DELIVERY_RETIRED"), "{error}");
    let old_protocol = fixture.ack_transport();
    let error = old_protocol
        .project_buffer_original::<()>(fixture.store(), "v2:new:legacy", params(), |_, _, _| {
            panic!("bound route cannot downgrade")
        })
        .unwrap_err();
    assert!(error.contains("V2_REQUIRED"), "{error}");
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
fn v2_buffer_lost_compaction_reply_reopens_to_floor_only_without_effect_or_consumer() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let methods = [
            APPLY,
            STATUS,
            ACK,
            EPOCH_OPEN,
            EPOCH_STATUS,
            EPOCH_COMPACT,
            EPOCH_CLOSE,
        ];
        let mut socket = accept(&listener).await;
        hello(&mut socket, &methods, "host.1").await;
        let open = next(&mut socket).await;
        let open_id = open["params"]["openId"].clone();
        result(&mut socket, &open, epoch_description(&open_id, 0, 0)).await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], APPLY);
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        let ack_request = next(&mut socket).await;
        assert_eq!(ack_request["method"], ACK);
        result(&mut socket, &ack_request, retired(&ack_request["params"])).await;
        let compact = next(&mut socket).await;
        assert_eq!(compact["method"], EPOCH_COMPACT);
        socket.close(None).await.unwrap();
        drop(socket);
        let (mut restored, reopen) = restored_connection(&listener, &methods).await;
        assert_eq!(reopen["method"], EPOCH_OPEN);
        assert_eq!(reopen["params"]["openId"], open_id);
        result(&mut restored, &reopen, epoch_description(&open_id, 1, 1)).await;
        await_done(&mut restored, wait).await;
    });
    let mut fixture = Fixture::new(&server.endpoint);
    let transport = fixture.epoch_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "v2:lostcompact:1",
            params(),
            |_, projection, original| ack(fixture.store(), projection, original),
        )
        .unwrap();
    assert!(
        fixture.remote_ack_outbox().is_empty(),
        "remote ACK persisted before compaction reply loss"
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        1
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        0
    );
    drop(transport);
    fixture.restart();
    let error = fixture
        .epoch_transport()
        .project_buffer_original::<()>(fixture.store(), "v2:lostcompact:1", params(), |_, _, _| {
            panic!("old consumer cannot recur")
        })
        .unwrap_err();
    assert!(error.contains("NATIVE_DELIVERY_RETIRED"), "{error}");
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
fn v2_buffer_restored_original_cannot_use_a_downgraded_catalog_for_status_or_apply() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                APPLY,
                STATUS,
                ACK,
                EPOCH_OPEN,
                EPOCH_STATUS,
                EPOCH_COMPACT,
                EPOCH_CLOSE,
            ],
            "host.1",
        )
        .await;
        let open = next(&mut socket).await;
        result(
            &mut socket,
            &open,
            epoch_description(&open["params"]["openId"], 0, 0),
        )
        .await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], APPLY);
        assert!(apply["params"]["originalId"]
            .as_str()
            .unwrap()
            .starts_with("nd2:"));
        // A retained old producer may observe a compacted Host original. Its
        // fence is not local consumption evidence or downgrade permission.
        let mut fenced = identity(&apply["params"]);
        fenced["state"] = json!("fenced");
        fenced["epoch"] = json!({"ownerId":EPOCH_OWNER,"generation":1,"through":1,"closed":false});
        result(&mut socket, &apply, fenced).await;
        await_done(&mut socket, wait).await;
    });
    let mut fixture = Fixture::new(&server.endpoint);
    let transport = fixture.epoch_transport();
    assert!(transport
        .project_buffer_original::<()>(fixture.store(), "v2:held:1", params(), |_, _, _| panic!(
            "unknown cannot consume"
        ))
        .is_err());
    let held = fixture.pending();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].phase(), journal::Phase::Possible);
    drop(transport);
    fixture.restart();
    let old_protocol = fixture.ack_transport();
    assert!(old_protocol
        .reconcile_buffer_deliveries(fixture.store())
        .is_err());
    assert!(old_protocol
        .project_buffer_original::<()>(fixture.store(), "v2:held:1", params(), |_, _, _| panic!(
            "held cannot consume"
        ))
        .is_err());
    assert_eq!(fixture.pending()[0].id(), held[0].id());
    done.send(()).unwrap();
}

#[test]
#[ignore = "requires isolated real Host fixture"]
fn real_host_epoch_buffer_roundtrip() {
    let configuration: Value = serde_json::from_str(
        &std::env::var("BYCODA_EPOCH_HOST_FIXTURE")
            .expect("isolated Host fixture configuration must be supplied"),
    )
    .expect("isolated Host fixture configuration must be valid JSON");
    let endpoint = configuration["endpoint"]
        .as_str()
        .expect("fixture endpoint");
    let mut fixture = Fixture::new(endpoint);
    fixture.machine.environment_id = configuration["environmentId"]
        .as_str()
        .expect("fixture environment")
        .into();
    fixture.machine.token = configuration["token"]
        .as_str()
        .expect("fixture credential")
        .into();
    write(&fixture.path, std::slice::from_ref(&fixture.machine)).unwrap();
    let descriptor = rpc(
        endpoint,
        &fixture.machine.token,
        Some(&fixture.machine.environment_id),
        "environment.describe",
        json!({}),
    )
    .expect("actual isolated Host must describe its authenticated catalog");
    assert!(super::epoch_wire::supports(&descriptor));
    let source = json!({"clientId":"real-native-epoch-fixture",
        "instanceId":uuid::Uuid::new_v4().to_string(),"processId":std::process::id(),"owners":[]});
    let transport = fixture.epoch_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "real:epoch:physical:1",
            source.clone(),
            |_, projection, original| {
                assert!(original.id().starts_with("nd2:"));
                ack(fixture.store(), projection, original)
            },
        )
        .expect("actual Native buffer apply, guarded consume and remote ACK must succeed");
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        1
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        0
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_epoch_allocations"),
        0
    );
    drop(transport);
    fixture.restart();
    let transport = fixture.epoch_transport();
    let error = transport
        .project_buffer_original::<()>(
            fixture.store(),
            "real:epoch:physical:1",
            source.clone(),
            |_, _, _| panic!("retired physical report cannot consume again"),
        )
        .unwrap_err();
    assert!(error.contains("NATIVE_DELIVERY_RETIRED"));
    transport
        .project_buffer_original(
            fixture.store(),
            "real:epoch:physical:2",
            source,
            |_, projection, original| {
                assert!(original.id().ends_with(":2"));
                ack(fixture.store(), projection, original)
            },
        )
        .expect("a new physical report must continue the same actual Host epoch");
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_semantic_retirements"),
        2
    );
    assert_eq!(
        retained_count(fixture.store(), "native_delivery_originals"),
        0
    );
    let (local, host): (i64, i64) = fixture
        .store()
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT local_through,host_through FROM native_delivery_epochs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((local, host), (2, 2));
}

#[test]
fn remote_retirement_follows_local_full_ack_and_keeps_original_terminal() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS, ACK], "host.1").await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], APPLY);
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        let retirement = next(&mut socket).await;
        assert_eq!(retirement["method"], ACK);
        assert_eq!(identity(&retirement["params"]), identity(&apply["params"]));
        assert_eq!(
            retirement["params"]["consumedResult"],
            json!({
                "sha256":hash(br#"{"acknowledged":true}"#),"byteLength":21
            })
        );
        result(&mut socket, &retirement, retired(&retirement["params"])).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.ack_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "ack:buffer:1",
            params(),
            |_, projection, original| {
                assert!(
                    fixture.remote_ack_outbox().is_empty(),
                    "recorded is not consumed"
                );
                ack(fixture.store(), projection, original)
            },
        )
        .unwrap();
    assert!(fixture.pending().is_empty());
    assert!(fixture.remote_ack_outbox().is_empty());
    let terminal = journal::prepare(
        fixture.store(),
        "ack:buffer:1",
        &ws_fingerprint(&fixture.machine),
        "native.buffers.update",
        &serde_json::to_string(&params()).unwrap(),
    )
    .unwrap();
    assert_eq!(terminal.phase(), journal::Phase::Acknowledged);
    assert!(transport
        .project_buffer_original::<()>(fixture.store(), "ack:buffer:1", params(), |_, _, _| panic!(
            "terminal cannot consume again"
        ))
        .is_err());
    done.send(()).unwrap();
}

#[test]
fn lost_remote_ack_reopens_to_ack_only_without_replaying_original_or_consumer() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS, ACK], "host.1").await;
        let apply = next(&mut socket).await;
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        let first_ack = next(&mut socket).await;
        assert_eq!(first_ack["method"], ACK);
        socket.close(None).await.unwrap();
        drop(socket);
        let (mut restored, retry) = restored_connection(&listener, &[APPLY, STATUS, ACK]).await;
        assert_eq!(
            retry["method"], ACK,
            "restart must not apply/status/consume the old report"
        );
        assert_eq!(retry["params"], first_ack["params"]);
        result(&mut restored, &retry, retired(&retry["params"])).await;
        await_done(&mut restored, wait).await;
    });
    let mut fixture = Fixture::new(&server.endpoint);
    let transport = fixture.ack_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "ack:lost",
            params(),
            |_, projection, original| ack(fixture.store(), projection, original),
        )
        .unwrap();
    assert_eq!(fixture.remote_ack_outbox().len(), 1);
    drop(transport);
    fixture.restart();
    let transport = fixture.ack_transport();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !fixture.remote_ack_outbox().is_empty() {
        transport
            .reconcile_buffer_acknowledgements(fixture.store())
            .unwrap();
        assert!(
            std::time::Instant::now() < deadline,
            "read-only cleanup remains pending"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn remote_ack_mismatched_echo_keeps_outbox_without_reversing_successful_source_ack() {
    for wrong_original in [true, false] {
        let (done, wait) = mpsc::channel();
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(&mut socket, &[APPLY, STATUS, ACK], "host.1").await;
            let apply = next(&mut socket).await;
            result(&mut socket, &apply, recorded(&apply["params"])).await;
            let request = next(&mut socket).await;
            assert_eq!(request["method"], ACK);
            let mut response = retired(&request["params"]);
            if wrong_original {
                response["originalId"] = json!(uuid::Uuid::new_v4().to_string());
            } else {
                response["consumedResult"]["sha256"] = json!("0".repeat(64));
            }
            result(&mut socket, &request, response).await;
            await_done(&mut socket, wait).await;
        });
        let fixture = Fixture::new(&server.endpoint);
        fixture
            .ack_transport()
            .project_buffer_original(
                fixture.store(),
                "ack:bad-echo",
                params(),
                |_, projection, original| ack(fixture.store(), projection, original),
            )
            .unwrap();
        assert!(fixture.pending().is_empty());
        assert_eq!(fixture.remote_ack_outbox().len(), 1);
        done.send(()).unwrap();
    }
}

#[test]
fn failed_source_consumer_and_retired_original_guard_never_send_remote_ack() {
    for consume_fails in [true, false] {
        let (done, wait) = mpsc::channel();
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(&mut socket, &[APPLY, STATUS, ACK], "host.1").await;
            let apply = next(&mut socket).await;
            result(&mut socket, &apply, recorded(&apply["params"])).await;
            await_done(&mut socket, wait).await;
        });
        let fixture = Fixture::new(&server.endpoint);
        let result = fixture.ack_transport().project_buffer_original(
            fixture.store(),
            "ack:no-permission",
            params(),
            |_, projection, original| {
                if consume_fails {
                    return Err("source CAS failed".into());
                }
                ack(fixture.store(), projection, original)?;
                fixture
                    .state
                    .native_profile_ws
                    .invalidate_machine(&fixture.machine.id);
                Ok(())
            },
        );
        // Retirement happened before the original reply's final disclosure
        // check, so that result is rejected even though its local ACK committed.
        assert!(result.is_err());
        assert_eq!(
            fixture.remote_ack_outbox().len(),
            usize::from(!consume_fails)
        );
        done.send(()).unwrap();
    }
}

#[test]
fn remote_ack_enqueue_retains_the_actual_original_reply_lifecycle_guard() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS, ACK], "host.1").await;
        let apply = next(&mut socket).await;
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.ack_transport();
    let channel = transport.workspace.as_ref().unwrap();
    let raw = serde_json::to_string(&params()).unwrap();
    let original = journal::prepare(
        fixture.store(),
        "ack:original-guard",
        &ws_fingerprint(&fixture.machine),
        "native.buffers.update",
        &raw,
    )
    .unwrap();
    let original = journal::mark_possible(fixture.store(), &original).unwrap();
    let mut wrapper = binding(&original);
    wrapper["paramsJson"] = json!(raw);
    let response = call(channel, APPLY, wrapper, Some(original.id()))
        .map_err(|error| error.message)
        .unwrap();
    let value = super::recorded(&response.reply.value, &original).unwrap();
    let recorded = record_held_result(fixture.store(), &original, &response.reply, value).unwrap();
    ack(
        fixture.store(),
        &NativeProjection::new(&response.reply),
        &recorded,
    )
    .unwrap();
    assert_eq!(fixture.remote_ack_outbox().len(), 1);
    fixture
        .state
        .native_profile_ws
        .invalidate_machine(&fixture.machine.id);
    assert!(remote_ack(
        channel,
        fixture.store(),
        &recorded,
        Some(&response.reply),
        std::time::Instant::now() + ACK_BUDGET
    )
    .is_err());
    assert_eq!(fixture.remote_ack_outbox().len(), 1);
    done.send(()).unwrap();
}

#[test]
fn http_recovery_ack_rechecks_current_caller_without_any_ws_reply_guard() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for retire_during_http in [false, true] {
        let (http_started, started) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            // The canonical ACK route is absent from this authenticated hello,
            // selecting HTTP before its dispatch without fabricating a guard.
            hello(&mut socket, &[STATUS], "host.1").await;
            let warm = next(&mut socket).await;
            assert_eq!(warm["method"], STATUS);
            result(&mut socket, &warm, json!({"state":"absent"})).await;
            let (mut http, _) = listener.accept().await.unwrap();
            let mut wire = Vec::new();
            let mut chunk = [0_u8; 4096];
            let (body_start, length) = loop {
                let read = http.read(&mut chunk).await.unwrap();
                assert_ne!(read, 0);
                wire.extend_from_slice(&chunk[..read]);
                if let Some(end) = wire.windows(4).position(|value| value == b"\r\n\r\n") {
                    let header = std::str::from_utf8(&wire[..end]).unwrap();
                    let length = header
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap();
                    break (end + 4, length);
                }
                assert!(wire.len() < 65_536);
            };
            while wire.len() < body_start + length {
                let read = http.read(&mut chunk).await.unwrap();
                assert_ne!(read, 0);
                wire.extend_from_slice(&chunk[..read]);
            }
            let request: Value =
                serde_json::from_slice(&wire[body_start..body_start + length]).unwrap();
            assert_eq!(request["method"], ACK);
            http_started.send(()).unwrap();
            tokio::task::spawn_blocking(move || {
                released.recv_timeout(Duration::from_secs(5)).unwrap()
            })
            .await
            .unwrap();
            let body = json!({"result":retired(&request["params"])}).to_string();
            http.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
            drop(socket);
        });
        let fixture = Fixture::new(&server.endpoint);
        let transport = fixture.ack_transport();
        let original = journal::prepare(
            fixture.store(),
            "ack:http-current-caller",
            &ws_fingerprint(&fixture.machine),
            "native.buffers.update",
            &serde_json::to_string(&params()).unwrap(),
        )
        .unwrap();
        let original = journal::mark_possible(fixture.store(), &original).unwrap();
        let original =
            journal::record_result(fixture.store(), &original, r#"{"acknowledged":true}"#).unwrap();
        journal::acknowledge(fixture.store(), &original).unwrap();
        // Warm the actual captured caller so ACK sees a proven unsupported
        // method rather than a transient connection-not-ready condition.
        drop(
            transport
                .workspace
                .as_ref()
                .unwrap()
                .wire(STATUS, binding(&original), RequestOptions::default())
                .unwrap(),
        );
        std::thread::scope(|scope| {
            let request =
                scope.spawn(|| transport.reconcile_buffer_acknowledgements(fixture.store()));
            started.recv_timeout(Duration::from_secs(5)).unwrap();
            if retire_during_http {
                fixture
                    .state
                    .native_profile_ws
                    .invalidate_machine(&fixture.machine.id);
            }
            release.send(()).unwrap();
            request.join().unwrap().unwrap();
        });
        assert_eq!(
            fixture.remote_ack_outbox().len(),
            usize::from(retire_during_http)
        );
        assert!(
            fixture.pending().is_empty(),
            "cleanup never revives the consumed original"
        );
    }
}

#[test]
fn failed_remote_marker_commit_retains_outbox_and_retries_only_idempotent_ack() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS, ACK], "host.1").await;
        let apply = next(&mut socket).await;
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        let first = next(&mut socket).await;
        assert_eq!(first["method"], ACK);
        result(&mut socket, &first, retired(&first["params"])).await;
        let retry = next(&mut socket).await;
        assert_eq!(retry["method"], ACK);
        assert_eq!(retry["params"], first["params"]);
        result(&mut socket, &retry, retired(&retry["params"])).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.ack_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "ack:commit-failed",
            params(),
            |_, projection, original| {
                ack(fixture.store(), projection, original)?;
                fixture
                    .store()
                    .lock_conn()?
                    .commit_hook(Some(|| true))
                    .map_err(|error| error.to_string())?;
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(fixture.remote_ack_outbox().len(), 1);
    fixture
        .store()
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    transport
        .reconcile_buffer_acknowledgements(fixture.store())
        .unwrap();
    assert!(fixture.remote_ack_outbox().is_empty());
    done.send(()).unwrap();
}

#[test]
fn small_original_uses_exact_utf8_hash_id_and_ack_under_actual_reply_gates() {
    let original_params = params();
    let raw = serde_json::to_string(&original_params).unwrap();
    let expected = raw.clone();
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS], "host.1").await;
        let request = next(&mut socket).await;
        assert_eq!(request["method"], APPLY);
        assert_eq!(request["params"]["paramsJson"], expected);
        assert_eq!(request["params"]["sha256"], hash(expected.as_bytes()));
        assert_eq!(request["params"]["byteLength"], expected.len());
        assert!(request["id"].as_str().is_some_and(|id| !id.is_empty()));
        assert!(uuid::Uuid::parse_str(request["params"]["originalId"].as_str().unwrap()).is_ok());
        result(&mut socket, &request, recorded(&request["params"])).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.transport(true, true);
    let answer = transport
        .project_buffer_original(
            fixture.store(),
            "buffer:owner:1:nonce",
            original_params.clone(),
            |value, projection, original| {
                assert_eq!(value, &json!({"acknowledged":true}));
                assert_eq!(original.phase(), journal::Phase::Recorded);
                assert_eq!(journal::params_json(fixture.store(), original)?, raw);
                ack(fixture.store(), projection, original)?;
                Ok(value.clone())
            },
        )
        .unwrap();
    assert_eq!(answer, json!({"acknowledged":true}));
    assert!(fixture.pending().is_empty());
    let terminal = journal::prepare(
        fixture.store(),
        "buffer:owner:1:nonce",
        &ws_fingerprint(&fixture.machine),
        "native.buffers.update",
        &raw,
    )
    .unwrap();
    assert_eq!(terminal.phase(), journal::Phase::Acknowledged);
    assert!(transport
        .project_buffer_original(
            fixture.store(),
            "buffer:owner:1:nonce",
            original_params,
            |_, _, _| Ok(())
        )
        .is_err());
    done.send(()).unwrap();
}

#[test]
fn lost_accepted_reply_reopen_recovers_by_status_without_freshening_current_raw_report() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut first = accept(&listener).await;
        hello(&mut first, &[APPLY, STATUS], "host.1").await;
        let accepted = next(&mut first).await;
        assert_eq!(accepted["method"], APPLY);
        let binding = identity(&accepted["params"]);
        first.close(None).await.unwrap();
        drop(first);
        let (mut restored, status) = restored_connection(&listener, &[APPLY, STATUS]).await;
        assert_eq!(
            status["method"], STATUS,
            "a restored original must never APPLY again"
        );
        assert_eq!(status["params"], binding);
        result(&mut restored, &status, recorded(&binding)).await;
        await_done(&mut restored, wait).await;
    });
    let mut fixture = Fixture::new(&server.endpoint);
    fixture.seed_legacy_current();
    let before = fixture.current_raw();
    assert_eq!(before.2, 0, "actual schema initialization resets freshness");
    let transport = fixture.transport(true, true);
    let failed: Result<(), String> = transport.project_buffer_original(
        fixture.store(),
        "buffer:old-owner:1:old-nonce",
        params(),
        |_, _, _| panic!("lost reply cannot reach the consumer"),
    );
    assert!(failed.is_err());
    let original_id = fixture.pending()[0].id().to_owned();
    assert_eq!(fixture.pending()[0].phase(), journal::Phase::Possible);
    drop(transport);
    fixture.restart();
    {
        let conn = fixture.store().lock_conn().unwrap();
        crate::native_workspace::ensure_schema(&conn).unwrap();
    }
    let restored = fixture.transport(true, true);
    restored
        .reconcile_buffer_deliveries(fixture.store())
        .unwrap();
    let pending = fixture.pending();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id(), original_id);
    assert_eq!(pending[0].phase(), journal::Phase::Recorded);
    assert!(!pending[0].can_dispatch());
    assert_eq!(
        fixture.current_raw(),
        before,
        "delivery recovery cannot rewrite raw bytes/nonce or confirm current freshness"
    );
    done.send(()).unwrap();
}

#[test]
fn failed_consumer_keeps_recorded_original_and_next_invocation_queries_status_only() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS], "host.1").await;
        let apply = next(&mut socket).await;
        assert_eq!(apply["method"], APPLY);
        let binding = identity(&apply["params"]);
        result(&mut socket, &apply, recorded(&binding)).await;
        let status = next(&mut socket).await;
        assert_eq!(status["method"], STATUS);
        assert_eq!(status["params"], binding);
        result(&mut socket, &status, recorded(&binding)).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.transport(true, true);
    let failed: Result<(), String> = transport.project_buffer_original(
        fixture.store(),
        "buffer:owner:2:nonce",
        params(),
        |_, _, _| Err("local consumer held its exact CAS".into()),
    );
    assert!(failed.unwrap_err().contains("exact CAS"));
    assert_eq!(fixture.pending()[0].phase(), journal::Phase::Recorded);
    transport
        .project_buffer_original(
            fixture.store(),
            "buffer:owner:2:nonce",
            params(),
            |_, projection, original| ack(fixture.store(), projection, original),
        )
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn saved_token_replacement_rejects_old_authority_before_any_recovery_request() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS], "host.1").await;
        let apply = next(&mut socket).await;
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.transport(true, true);
    let _: Result<(), String> = transport.project_buffer_original(
        fixture.store(),
        "buffer:owner:3:nonce",
        params(),
        |_, _, _| Err("hold original".into()),
    );
    let original = fixture.pending()[0].clone();
    fixture.replace_saved_token();
    assert!(transport
        .reconcile_buffer_deliveries(fixture.store())
        .is_err());
    assert!(transport
        .project_buffer_original::<()>(
            fixture.store(),
            "buffer:owner:3:nonce",
            params(),
            |_, _, _| panic!("retired route cannot consume a result")
        )
        .is_err());
    assert_eq!(fixture.pending()[0].id(), original.id());
    assert_eq!(fixture.pending()[0].phase(), journal::Phase::Recorded);
    done.send(()).unwrap();
}

#[test]
fn mismatching_original_result_identity_is_withheld_without_recording_or_consuming() {
    for field in ["originalId", "sha256", "byteLength"] {
        let (done, wait) = mpsc::channel();
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(&mut socket, &[APPLY, STATUS], "host.1").await;
            let apply = next(&mut socket).await;
            let mut response = recorded(&apply["params"]);
            response[field] = match field {
                "originalId" => json!("different-original"),
                "sha256" => json!("0".repeat(64)),
                _ => json!(apply["params"]["byteLength"].as_u64().unwrap() + 1),
            };
            result(&mut socket, &apply, response).await;
            await_done(&mut socket, wait).await;
        });
        let fixture = Fixture::new(&server.endpoint);
        let transport = fixture.transport(true, true);
        let failed: Result<(), String> = transport.project_buffer_original(
            fixture.store(),
            "buffer:owner:4:nonce",
            params(),
            |_, _, _| panic!("mismatched original result reached its consumer"),
        );
        assert!(failed.is_err(), "{field}");
        assert_eq!(fixture.pending()[0].phase(), journal::Phase::Possible);
        assert!(journal::result_json(fixture.store(), &fixture.pending()[0])
            .unwrap()
            .is_none());
        done.send(()).unwrap();
    }
}

#[test]
fn large_original_stages_exact_raw_bytes_with_binding_outside_payload() {
    let mut original_params = params();
    original_params["owners"][0]["buffers"] = json!((0..6000)
        .map(|n| json!({"path":format!("G:/{}-{n}","x".repeat(180)),"dirty":false}))
        .collect::<Vec<_>>());
    let original = serde_json::to_vec(&original_params).unwrap();
    assert!(original.len() > 1024 * 1024);
    assert!(NativeProfileBroker::validates_workspace_params(
        "native.buffers.update",
        &original_params
    ));
    let expected = original.clone();
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, UPLOAD, "host.1").await;
        let start = next(&mut socket).await;
        assert_eq!(start["method"], "native.buffers.upload.start");
        let input = &start["params"];
        assert_eq!(input["byteLength"], expected.len());
        assert_eq!(input["sha256"], hash(&expected));
        assert_eq!(input["delivery"]["byteLength"], expected.len());
        assert_eq!(input["delivery"]["sha256"], hash(&expected));
        let mut status = json!({"uploadId":input["uploadId"],"byteLength":input["byteLength"],"sha256":input["sha256"],"delivery":input["delivery"],"receivedBytes":0,"state":"receiving","expiresAt":4_000_000_000_000_u64});
        result(&mut socket, &start, status.clone()).await;
        let mut bytes = Vec::new();
        loop {
            let request = next(&mut socket).await;
            assert_eq!(request["params"]["uploadId"], input["uploadId"]);
            match request["method"].as_str().unwrap() {
                "native.buffers.upload.write" => {
                    assert_eq!(request["params"]["offset"], bytes.len());
                    let chunk = base64::engine::general_purpose::STANDARD
                        .decode(request["params"]["data"].as_str().unwrap())
                        .unwrap();
                    assert!(chunk.len() <= 65_536);
                    bytes.extend_from_slice(&chunk);
                    status["receivedBytes"] = json!(bytes.len());
                    result(&mut socket, &request, status.clone()).await;
                }
                "native.buffers.upload.commit" => {
                    assert_eq!(bytes.len(), expected.len());
                    assert_eq!(hash(&bytes), hash(&expected));
                    assert!(
                        bytes.as_slice() == expected.as_slice(),
                        "staging must retain exact original bytes, not an escaped wrapper"
                    );
                    status["state"] = json!("completed");
                    status["result"] = recorded(&input["delivery"]);
                    result(&mut socket, &request, status.clone()).await;
                    break;
                }
                other => panic!("Unexpected request or repeated apply: {other}"),
            }
        }
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.transport(true, true);
    transport
        .project_buffer_original(
            fixture.store(),
            "buffer:owner:large:nonce",
            original_params,
            |value, projection, intent| {
                assert_eq!(value["acknowledged"], true);
                assert_eq!(intent.payload_bytes(), original.len());
                ack(fixture.store(), projection, intent)
            },
        )
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}

#[test]
fn changed_payload_for_one_physical_original_is_not_a_new_apply() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS], "host.1").await;
        let apply = next(&mut socket).await;
        result(&mut socket, &apply, recorded(&apply["params"])).await;
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.transport(true, true);
    let original_params = params();
    let _: Result<(), String> = transport.project_buffer_original(
        fixture.store(),
        "buffer:owner:5:nonce",
        original_params.clone(),
        |_, _, _| Err("hold original".into()),
    );
    let original = fixture.pending()[0].clone();
    let mut changed = original_params.clone();
    changed["processId"] = json!(2);
    let failure: Result<(), String> = transport.project_buffer_original(
        fixture.store(),
        "buffer:owner:5:nonce",
        changed,
        |_, _, _| panic!("different original payload reached consumer"),
    );
    assert!(failure.unwrap_err().contains("CONFLICT"));
    assert_eq!(
        journal::params_json(fixture.store(), &original).unwrap(),
        serde_json::to_string(&original_params).unwrap()
    );
    done.send(()).unwrap();
}

#[test]
fn absent_or_unknown_status_never_replays_a_possible_original() {
    for absent in [true, false] {
        let (done, wait) = mpsc::channel();
        let server = Server::spawn(move |listener| async move {
            let mut first = accept(&listener).await;
            hello(&mut first, &[APPLY, STATUS], "host.1").await;
            let apply = next(&mut first).await;
            let binding = identity(&apply["params"]);
            first.close(None).await.unwrap();
            drop(first);
            let mut socket = accept(&listener).await;
            hello(&mut socket, &[APPLY, STATUS], "host.1").await;
            for _ in 0..2 {
                let status = next(&mut socket).await;
                assert_eq!(
                    status["method"], STATUS,
                    "an absent receipt is not permission to reapply"
                );
                assert_eq!(status["params"], binding);
                let response = if absent {
                    json!({"state":"absent"})
                } else {
                    let mut v = binding.clone();
                    v["state"] = json!("unknown");
                    v
                };
                result(&mut socket, &status, response).await;
            }
            await_done(&mut socket, wait).await;
        });
        let fixture = Fixture::new(&server.endpoint);
        let transport = fixture.transport(true, true);
        let first: Result<(), String> = transport.project_buffer_original(
            fixture.store(),
            "buffer:owner:6:nonce",
            params(),
            |_, _, _| panic!("lost reply cannot consume"),
        );
        assert!(first.is_err());
        // A lost reply can precede the replacement socket becoming ready. Only
        // retry this read-only status reconciliation; never retry the apply.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            match transport.reconcile_buffer_deliveries(fixture.store()) {
                Ok(()) => break,
                Err(error) => {
                    assert!(std::time::Instant::now() < deadline, "{error}");
                    assert_eq!(fixture.pending()[0].phase(), journal::Phase::Possible);
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        let failure: Result<(), String> = transport.project_buffer_original(
            fixture.store(),
            "buffer:owner:6:nonce",
            params(),
            |_, _, _| panic!("absent/unknown receipt cannot consume"),
        );
        assert!(failure.is_err());
        assert_eq!(fixture.pending()[0].phase(), journal::Phase::Possible);
        done.send(()).unwrap();
    }
}

#[test]
fn legacy_accepted_lost_reply_restored_without_status_capability_does_not_replay() {
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.buffers.update"], "host.1").await;
        let update = next(&mut socket).await;
        assert_eq!(update["method"], "native.buffers.update");
        socket.close(None).await.unwrap();
        drop(socket);
        let mut complete =
            tokio::task::spawn_blocking(move || wait.recv_timeout(Duration::from_secs(5)).unwrap());
        // The pre-restart broker may reconnect before `fixture.restart()` and
        // then close, so every connection until completion is served alike:
        // a closed one is skipped and the next accepted one is watched.
        loop {
            let mut fresh = tokio::select! {
                result=&mut complete=>{result.unwrap();return;},
                socket=try_accept(&listener)=>match socket {
                    Some(socket)=>socket,
                    None=>continue,
                },
            };
            // Constructing a real process-owned caller may open its idle transport.
            // The forbidden action is replaying the original update, not hello.
            let greeted = tokio::select! {
                result=&mut complete=>{result.unwrap();return;},
                greeted=try_hello(&mut fresh, &["native.buffers.update"], "host.1")=>greeted,
            };
            if !greeted {
                continue;
            }
            loop {
                tokio::select! {
                    result=&mut complete=>{result.unwrap();return;},
                    frame=fresh.next()=>match frame {
                        Some(Ok(Message::Text(text)))=>panic!("legacy original was replayed: {}",serde_json::from_str::<Value>(&text).unwrap()["method"]),
                        Some(Ok(Message::Ping(data)))=>fresh.send(Message::Pong(data)).await.unwrap(),
                        Some(Ok(Message::Pong(_)))=>{},
                        Some(Ok(Message::Close(_)))|Some(Err(_))|None=>break,
                        other=>panic!("unexpected legacy fixture frame: {other:?}"),
                    }
                }
            }
        }
    });
    let mut fixture = Fixture::new(&server.endpoint);
    let transport = fixture.transport(false, true);
    let failure: Result<(), String> = transport.project_buffer_original(
        fixture.store(),
        "buffer:owner:7:nonce",
        params(),
        |_, _, _| panic!("lost legacy reply cannot consume"),
    );
    assert!(failure.is_err());
    let original_id = fixture.pending()[0].id().to_owned();
    drop(transport);
    fixture.restart();
    let restored = fixture.transport(false, true);
    restored
        .reconcile_buffer_deliveries(fixture.store())
        .unwrap();
    let failure: Result<(), String> = restored.project_buffer_original(
        fixture.store(),
        "buffer:owner:7:nonce",
        params(),
        |_, _, _| panic!("a restored legacy original must remain status-only/held"),
    );
    assert!(failure.is_err());
    assert_eq!(fixture.pending()[0].id(), original_id);
    assert_eq!(fixture.pending()[0].phase(), journal::Phase::Possible);
    done.send(()).unwrap();
}

#[test]
fn one_held_binding_cannot_starve_later_pending_originals_across_pages() {
    let (bindings, wait_bindings) = mpsc::channel::<Vec<Value>>();
    let (done, wait) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let expected = tokio::task::spawn_blocking(move || {
            wait_bindings.recv_timeout(Duration::from_secs(5)).unwrap()
        })
        .await
        .unwrap();
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[APPLY, STATUS], "host.1").await;
        for (index, binding) in expected.iter().enumerate() {
            let status = next(&mut socket).await;
            assert_eq!(
                status["method"], STATUS,
                "recovery must never APPLY or restart an original"
            );
            assert_eq!(
                &status["params"], binding,
                "cursor must progress to the next retained original"
            );
            let mut response = recorded(binding);
            if index == 0 {
                response["originalId"] = json!("wrong-held-original");
            }
            result(&mut socket, &status, response).await;
        }
        await_done(&mut socket, wait).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let raw = serde_json::to_string(&params()).unwrap();
    for i in 0..3 {
        let original = journal::prepare(
            fixture.store(),
            &format!("buffer:cursor:{i}:nonce-{i}"),
            &ws_fingerprint(&fixture.machine),
            "native.buffers.update",
            &raw,
        )
        .unwrap();
        journal::mark_possible(fixture.store(), &original).unwrap();
    }
    let sorted = fixture.pending();
    let ids = sorted.iter().map(|o| o.id().to_owned()).collect::<Vec<_>>();
    bindings.send(sorted.iter().map(|o|json!({"originalId":o.id(),"sha256":o.payload_sha256(),"byteLength":o.payload_bytes()})).collect()).unwrap();
    let transport = fixture.transport(true, true);
    let first = transport
        .reconcile_buffer_deliveries(fixture.store())
        .unwrap_err();
    assert!(first.contains("NATIVE_DELIVERY_HELD"));
    assert!(
        first.contains(&ids[0]),
        "the held original must retain its own identity"
    );
    let after_first = fixture.pending();
    assert_eq!(after_first[0].phase(), journal::Phase::Possible);
    assert_eq!(
        after_first[1].phase(),
        journal::Phase::Recorded,
        "the healthy row in the same bounded page still progresses"
    );
    assert_eq!(after_first[2].phase(), journal::Phase::Possible);
    transport
        .reconcile_buffer_deliveries(fixture.store())
        .unwrap();
    let after_second = fixture.pending();
    assert_eq!(
        after_second
            .iter()
            .map(|o| o.id().to_owned())
            .collect::<Vec<_>>(),
        ids
    );
    assert_eq!(
        after_second[0].phase(),
        journal::Phase::Possible,
        "bad binding stays held, never falsely confirmed"
    );
    assert_eq!(after_second[1].phase(), journal::Phase::Recorded);
    assert_eq!(
        after_second[2].phase(),
        journal::Phase::Recorded,
        "a failed prior page cannot prevent later status-only reconciliation"
    );
    done.send(()).unwrap();
}

#[test]
fn http_staging_keeps_original_capacity_when_escaped_wrapper_exceeds_body_limit() {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    let mut original_params = params();
    original_params["owners"][0]["buffers"] = json!((0..9000)
        .map(|n| json!({"path":format!("G:/{}/{n}.rs","\"".repeat(650)),"dirty":false}))
        .collect::<Vec<_>>());
    assert!(NativeProfileBroker::validates_workspace_params(
        "native.buffers.update",
        &original_params
    ));
    let original = serde_json::to_vec(&original_params).unwrap();
    assert!(original.len() < 16 * 1024 * 1024);
    let inflated=serde_json::to_vec(&json!({"version":1,"environmentId":"host.1","method":APPLY,"params":{"originalId":"capacity-fixture","sha256":hash(&original),"byteLength":original.len(),"paramsJson":std::str::from_utf8(&original).unwrap()}})).unwrap();
    assert!(
        inflated.len() > 16 * 1024 * 1024,
        "the fixture must expose actual wrapper inflation beyond the old HTTP limit"
    );
    drop(inflated);
    let expected = original.clone();
    let (done, wait) = mpsc::channel();
    // About 190 separate HTTP RPCs carry the 12 MB original in a debug build.
    let server = Server::spawn_with_watchdog(DEFAULT_RPC_TIMEOUT, move |listener| async move {
        let mut received = Vec::new();
        let mut status = Value::Null;
        let mut commits = 0;
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            assert_eq!(
                line.trim_end(),
                "POST /rpc HTTP/1.1",
                "HTTP-only staging must not open a WS upgrade"
            );
            let mut header_bytes = line.len();
            let mut length = None;
            let mut authorized = false;
            loop {
                line.clear();
                assert!(reader.read_line(&mut line).await.unwrap() > 0);
                header_bytes += line.len();
                assert!(header_bytes < 16 * 1024);
                if line == "\r\n" {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if let Some(size) = lower.strip_prefix("content-length:") {
                    length = Some(size.trim().parse::<usize>().unwrap());
                }
                if lower.starts_with("authorization:") {
                    authorized = line
                        .split_once(':')
                        .is_some_and(|(_, value)| value.trim() == "Bearer secret-native-token");
                }
            }
            assert!(authorized, "original saved credential must stay native");
            let length = length.unwrap();
            assert!(
                length <= 16 * 1024 * 1024,
                "no HTTP RPC body may inflate beyond the old body limit"
            );
            let mut raw = vec![0; length];
            reader.read_exact(&mut raw).await.unwrap();
            let request: Value = serde_json::from_slice(&raw).unwrap();
            assert_eq!(request["environmentId"], "host.1");
            let input = &request["params"];
            match request["method"].as_str().unwrap() {
                "native.buffers.upload.start" => {
                    assert!(status.is_null(), "one original gets one staging admission");
                    assert_eq!(input["byteLength"], expected.len());
                    assert_eq!(input["sha256"], hash(&expected));
                    assert_eq!(input["delivery"]["byteLength"], expected.len());
                    assert_eq!(input["delivery"]["sha256"], hash(&expected));
                    status = json!({"uploadId":input["uploadId"],"byteLength":input["byteLength"],"sha256":input["sha256"],"delivery":input["delivery"],"receivedBytes":0,"state":"receiving","expiresAt":4_000_000_000_000_u64});
                }
                "native.buffers.upload.write" => {
                    assert_eq!(input["uploadId"], status["uploadId"]);
                    assert_eq!(input["offset"], received.len());
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(input["data"].as_str().unwrap())
                        .unwrap();
                    assert!(bytes.len() <= 65_536);
                    received.extend_from_slice(&bytes);
                    status["receivedBytes"] = json!(received.len());
                }
                "native.buffers.upload.commit" => {
                    commits += 1;
                    assert_eq!(commits, 1);
                    assert_eq!(input["uploadId"], status["uploadId"]);
                    assert_eq!(received.len(), expected.len());
                    assert_eq!(hash(&received), hash(&expected));
                    assert!(
                        received.as_slice() == expected.as_slice(),
                        "staging must send original JSON bytes rather than an escaped wrapper"
                    );
                    status["state"] = json!("completed");
                    status["result"] = recorded(&status["delivery"]);
                }
                other => panic!("unexpected bare apply, inflated wrapper or repeat: {other}"),
            }
            let body = json!({"result":status}).to_string();
            let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            let mut stream = reader.into_inner();
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
            if commits == 1 {
                break;
            }
        }
        // After the commit reply the client still verifies, records and
        // acknowledges the 12 MB original (about 1 s in an idle debug build);
        // a fixed 5 s window tripped on loaded shared CI runners. The wait only
        // keeps the listener open to catch a resend, so give it the RPC budget.
        let mut complete =
            tokio::task::spawn_blocking(move || wait.recv_timeout(DEFAULT_RPC_TIMEOUT).unwrap());
        tokio::select! {
            result=&mut complete=>result.unwrap(),
            _connection=listener.accept()=>panic!("completed HTTP original was sent or committed again"),
        }
    });
    let fixture = Fixture::new(&server.endpoint);
    let transport = fixture.http_transport();
    transport
        .project_buffer_original(
            fixture.store(),
            "buffer:http:capacity:nonce",
            original_params,
            |value, projection, intent| {
                assert_eq!(value["acknowledged"], true);
                assert_eq!(intent.payload_bytes(), original.len());
                ack(fixture.store(), projection, intent)
            },
        )
        .unwrap();
    assert!(fixture.pending().is_empty());
    done.send(()).unwrap();
}
