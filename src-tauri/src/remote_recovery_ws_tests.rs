//! Actual WS and saved-route tests. The Native profile selector is an isolated
//! fixture; no installed Wry app, user profile or provider is used.
use super::*;
use crate::host_ws::tests::{accept, hello, next, result, Server};
use futures_util::SinkExt;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn page() -> Value {
    json!({"version":1,"qualified":false,"records":[],"next":null,"incomplete":false,"duplicatesPossible":false})
}
struct Fixture {
    root: PathBuf,
    parent: PathBuf,
    path: PathBuf,
    state: Arc<RemoteConnections>,
    transport: NativeWorkspaceTransport,
}
impl Fixture {
    fn new(endpoint: String) -> Self {
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let root = parent.join(format!(
            "bycoda-native-recovery-ws-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("connections.json");
        let machine = StoredMachine {
            id: "machine.1".into(),
            name: "Local fixture".into(),
            endpoint: endpoint.clone(),
            environment_id: "host.1".into(),
            token: "secret-native-token".into(),
            ssh: None,
            local_host: true,
        };
        write(&path, std::slice::from_ref(&machine)).unwrap();
        let state = Arc::new(RemoteConnections::default());
        state.observe_ws_capability(&machine, &json!({"environmentId":"host.1","capabilities":["transport.ws.read.v2","native.buffers.recovery.v1"]}));
        let recovery = RecoveryRoute {
            revision: state.recovery_routes.capture().unwrap(),
            selected_endpoint: endpoint,
        };
        Self {
            root,
            parent,
            path,
            state,
            transport: NativeWorkspaceTransport {
                workspace: None,
                machine,
                recovery: Some(recovery),
            },
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.recovery_routes.close();
        self.state.native_profile_ws.shutdown();
        self.state.ws.shutdown();
        assert_eq!(
            self.root.canonicalize().unwrap().parent(),
            Some(self.parent.as_path())
        );
        assert!(!std::fs::symlink_metadata(&self.root)
            .unwrap()
            .file_type()
            .is_symlink());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn native_saved_recovery_uses_real_ws_and_window_detach_does_not_cancel_it() {
    let (started, waiting) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.buffers.recovery.list"], "host.1").await;
        let request = next(&mut socket).await;
        assert_eq!(request["method"], "native.buffers.recovery.list");
        started.send(()).unwrap();
        tokio::task::spawn_blocking(move || released.recv().unwrap())
            .await
            .unwrap();
        result(&mut socket, &request, page()).await;
        tokio::task::spawn_blocking(move || finished.recv().unwrap())
            .await
            .unwrap();
    });
    let f = Fixture::new(server.endpoint.clone());
    thread::scope(|scope| {
        let call = scope.spawn(|| {
            f.transport.call_recovery_guarded_saved(
                &f.state,
                &f.path,
                "native.buffers.recovery.list",
                json!({}),
            )
        });
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        f.state.detach_window("native-profile-owner");
        release.send(()).unwrap();
        let reply = call.join().unwrap().unwrap();
        assert_eq!(reply.disclose().unwrap(), page());
    });
    done.send(()).unwrap();
}

#[test]
fn native_saved_recovery_keeps_disclosure_guard_until_final_native_context_check() {
    let (done, finished) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.buffers.recovery.list"], "host.1").await;
        let request = next(&mut socket).await;
        result(&mut socket, &request, page()).await;
        tokio::task::spawn_blocking(move || finished.recv().unwrap())
            .await
            .unwrap();
    });
    let f = Fixture::new(server.endpoint.clone());
    let reply = f
        .transport
        .call_recovery_guarded_saved(&f.state, &f.path, "native.buffers.recovery.list", json!({}))
        .unwrap();
    {
        let _store = f.state.store.lock().unwrap();
        let mut replaced = f.transport.machine.clone();
        replaced.token = "repaired-fixture-token".into();
        write(&f.path, &[replaced]).unwrap();
        f.state.invalidate_ws(&f.transport.machine.id);
    }
    assert!(reply.disclose().is_err());
    done.send(()).unwrap();
}

#[test]
fn native_saved_recovery_retirement_never_replays_ws_over_http() {
    let (started, waiting) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.buffers.recovery.list"], "host.1").await;
        let request = next(&mut socket).await;
        started.send(()).unwrap();
        tokio::task::spawn_blocking(move || released.recv().unwrap())
            .await
            .unwrap();
        let _ = socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({"jsonrpc":"2.0","id":request["id"],"result":page()})
                    .to_string()
                    .into(),
            ))
            .await;
        tokio::select! {
            _ = listener.accept() => panic!("a dispatched Native recovery read must not be replayed over HTTP"),
            _ = tokio::task::spawn_blocking(move || finished.recv().unwrap()) => {}
        }
    });
    let f = Fixture::new(server.endpoint.clone());
    thread::scope(|scope| {
        let call = scope.spawn(|| {
            f.transport.call_recovery_guarded_saved(
                &f.state,
                &f.path,
                "native.buffers.recovery.list",
                json!({}),
            )
        });
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        {
            let _store = f.state.store.lock().unwrap();
            disconnect_saved_machine(&f.state, &f.path, &f.transport.machine.id).unwrap();
            write(&f.path, std::slice::from_ref(&f.transport.machine)).unwrap();
        }
        release.send(()).unwrap();
        assert!(call.join().unwrap().is_err());
    });
    done.send(()).unwrap();
}

#[test]
fn native_saved_recovery_http_compatibility_retains_route_guard_during_projection() {
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut length = 0;
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("POST /rpc "));
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse::<usize>().unwrap();
            }
        }
        let mut bytes = vec![0; length];
        reader.read_exact(&mut bytes).unwrap();
        let request: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(request["method"], "native.buffers.recovery.list");
        let body = json!({"result":page()}).to_string();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let f = Fixture::new(endpoint);
    f.state.observe_ws_capability(
        &f.transport.machine,
        &json!({"environmentId":"host.1","capabilities":[]}),
    );
    let reply = f
        .transport
        .call_recovery_guarded_saved(&f.state, &f.path, "native.buffers.recovery.list", json!({}))
        .unwrap();
    let result = reply.project(|value| {
        assert_eq!(value, &page());
        f.state.invalidate_ws(&f.transport.machine.id);
        Ok(value.clone())
    });
    assert!(result.is_err());
    server.join().unwrap();
}

#[test]
fn native_saved_bulk_guard_is_held_through_projection_and_final_scope_validation() {
    use crate::host_ws::tests::{bulk_in_flight, descriptor, http_chunk, BULK_TEST};
    let _serial = BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let source = json!({"reportId":"a".repeat(64),"reportVersion":1,"ownerId":"owner","ownerVersion":1,"snapshotDigest":"b".repeat(64)});
    let expected = json!({"version":1,"qualified":false,"source":source,"rawReport":"raw native λ".repeat(100_000),"owner":{"ownerId":"owner","updatedAt":1,"unknown":false,"buffers":[]},"resolution":"unsupported"});
    let bytes = Arc::new(serde_json::to_vec(&expected).unwrap());
    let data = bytes.clone();
    let (done, finished) = mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.buffers.recovery.read"], "host.1").await;
        let request = next(&mut socket).await;
        result(&mut socket, &request, json!({"$bulk":descriptor(&data)})).await;
        for offset in (0..data.len()).step_by(65536) {
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
    let f = Fixture::new(server.endpoint.clone());
    let reply = f
        .transport
        .call_recovery_guarded_saved(&f.state, &f.path, "native.buffers.recovery.read", source)
        .unwrap();
    assert_eq!(bulk_in_flight(), (1, bytes.len()));
    let projected = reply.project(|value| {
        assert_eq!(value, &expected);
        assert_eq!(bulk_in_flight(), (1, bytes.len()));
        f.state.invalidate_ws(&f.transport.machine.id);
        assert_eq!(bulk_in_flight(), (1, bytes.len()));
        Ok(value["rawReport"].as_str().unwrap().len())
    });
    assert!(projected.is_err());
    assert_eq!(bulk_in_flight(), (0, 0));
    done.send(()).unwrap();
}

#[test]
fn owner_bound_request_checks_actual_saved_environment_before_dispatch() {
    let f = Fixture::new("http://127.0.0.1:1".into());
    read_shared(&f.path).unwrap(); // the frontend/native inventory may be stale
    assert!(machine_for_request(&f.state, &f.path, "machine.1", Some("host.1")).is_ok());
    let mut replacement = f.transport.machine.clone();
    replacement.environment_id = "host.2".into();
    write(&f.path, &[replacement]).unwrap();
    assert!(machine_for_request(&f.state, &f.path, "machine.1", Some("host.1")).is_err());
    assert_eq!(
        machine_for_request(&f.state, &f.path, "machine.1", Some("host.2"))
            .unwrap()
            .environment_id,
        "host.2"
    );
}
