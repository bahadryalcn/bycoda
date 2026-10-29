use super::*;
use crate::host_ws::tests::{accept, hello, next, result, Server};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(in super::super) struct Fixture {
    pub(in super::super) state: Arc<RemoteConnections>,
    pub(in super::super) path: PathBuf,
    pub(in super::super) machine: StoredMachine,
    root: PathBuf,
}
impl Fixture {
    pub(in super::super) fn new(endpoint: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("bycoda-dev-gateway-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("machines.json");
        let machine = StoredMachine {
            id: "machine.1".into(),
            name: "Gateway fixture".into(),
            endpoint: endpoint.into(),
            environment_id: "host.1".into(),
            token: "secret-native-token".into(),
            ssh: None,
            local_host: false,
        };
        write(&path, std::slice::from_ref(&machine)).unwrap();
        Self {
            state: Arc::new(RemoteConnections::default()),
            path,
            machine,
            root,
        }
    }
    pub(in super::super) fn channel(&self, websocket: bool) -> Arc<NativeGatewayChannel> {
        NativeGatewayChannel::fixture(
            &self.state,
            self.path.clone(),
            self.machine.clone(),
            websocket,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.native_gateway_ws.shutdown();
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(&self.root);
    }
}

pub(in super::super) fn target() -> Value {
    json!({"projectId":"project","id":"server","identity":{"pid":42,"startedAt":"birth","name":"retained extension"},"port":5173,"address":"127.0.0.1"})
}
pub(in super::super) fn endpoint() -> Value {
    json!({"address":"127.0.0.1","port":5173,"url":"http://127.0.0.1:5173","connectAddress":"127.0.0.1"})
}

async fn http_request(socket: &mut tokio::net::TcpStream) -> Value {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = socket.read(&mut buffer).await.unwrap();
        assert!(count > 0);
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() <= 2 * 1024 * 1024);
        if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
            let header = std::str::from_utf8(&bytes[..end]).unwrap();
            assert!(header.starts_with("POST /rpc HTTP/1.1"));
            assert!(header
                .to_ascii_lowercase()
                .contains("authorization: bearer secret-native-token"));
            let length = header
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            while bytes.len() < end + 4 + length {
                let count = socket.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
            }
            return serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap();
        }
    }
}
async fn http_result(socket: &mut tokio::net::TcpStream, value: Value) {
    let bytes = serde_json::to_vec(&json!({"result":value})).unwrap();
    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).as_bytes()).await.unwrap();
    socket.write_all(&bytes).await.unwrap();
}

#[test]
fn old_host_http_is_preselected_without_opening_a_websocket() {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = requests.clone();
    let server = Server::spawn(move |listener| async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = http_request(&mut socket).await;
        assert_eq!(request["environmentId"], "host.1");
        assert_eq!(request["method"], "devServers.bridgeCheck");
        assert_eq!(request["params"], target());
        seen.fetch_add(1, Ordering::SeqCst);
        http_result(&mut socket, endpoint()).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let channel = fixture.channel(false);
    let reply = channel.request("devServers.bridgeCheck", target()).unwrap();
    assert_eq!(
        reply.project(|value| Ok(value.clone())).unwrap(),
        endpoint()
    );
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    assert!(channel
        .request("devServers.bridgeFuture", target())
        .is_err());
}

#[test]
fn negotiated_absence_falls_back_before_any_bridge_dispatch() {
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &[], "host.1").await;
        let (mut http, _) = listener.accept().await.unwrap();
        let request = http_request(&mut http).await;
        assert_eq!(request["method"], "devServers.bridgeCheck");
        assert_eq!(request["params"], target());
        http_result(&mut http, endpoint()).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let channel = fixture.channel(true);
    assert_eq!(
        channel
            .request("devServers.bridgeCheck", target())
            .unwrap()
            .project(|value| Ok(value.clone()))
            .unwrap(),
        endpoint()
    );
}

#[test]
fn consuming_read_disconnect_is_unknown_and_never_replayed_over_http() {
    let http_calls = Arc::new(AtomicUsize::new(0));
    let seen = http_calls.clone();
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &["devServers.bridgeCheck", "devServers.bridgeRead"],
            "host.1",
        )
        .await;
        let check = next(&mut socket).await;
        result(&mut socket, &check, endpoint()).await;
        let read = next(&mut socket).await;
        assert_eq!(read["method"], "devServers.bridgeRead");
        socket.close(None).await.unwrap(); // Host consumed the read; its reply was lost.
        if let Ok(Ok((mut http, _))) =
            tokio::time::timeout(Duration::from_millis(400), listener.accept()).await
        {
            let mut prefix = [0; 4];
            if http.peek(&mut prefix).await.unwrap_or(0) >= 4 && &prefix == b"POST" {
                seen.fetch_add(1, Ordering::SeqCst);
                let _ = http_request(&mut http).await;
                http_result(&mut http, json!({"data":"","ended":true})).await;
            }
        }
    });
    let fixture = Fixture::new(&server.endpoint);
    let channel = fixture.channel(true);
    channel.request("devServers.bridgeCheck", target()).unwrap();
    let error = channel
        .request(
            "devServers.bridgeRead",
            json!({"projectId":"project","streamId":"stream"}),
        )
        .err()
        .unwrap();
    assert!(error.contains("outcome is unknown"), "{error}");
    assert_eq!(http_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn saved_credential_replacement_and_identical_repair_block_new_disclosure_admissions() {
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["devServers.bridgeCheck"], "host.1").await;
        let check = next(&mut socket).await;
        result(&mut socket, &check, endpoint()).await;
    });
    let fixture = Fixture::new(&server.endpoint);
    let channel = fixture.channel(true);
    let reply = channel.request("devServers.bridgeCheck", target()).unwrap();
    let admitted = reply.admit().unwrap();
    {
        let _store = fixture.state.store.lock().unwrap();
        let mut replaced = fixture.machine.clone();
        replaced.token = "replaced-native-token".into();
        write(&fixture.path, &[replaced]).unwrap();
    }
    assert!(reply.admit().is_err());
    {
        let _store = fixture.state.store.lock().unwrap();
        write(&fixture.path, std::slice::from_ref(&fixture.machine)).unwrap();
    }
    let state = fixture.state.clone();
    let (done, received) = std::sync::mpsc::channel();
    let retire = std::thread::spawn(move || {
        state.native_gateway_ws.invalidate_machine("machine.1");
        done.send(()).unwrap();
    });
    received
        .recv_timeout(Duration::from_secs(1))
        .expect("admitted IO must not hold the lifecycle/store mutex");
    retire.join().unwrap();
    assert!(reply.admit().is_err());
    assert!(!channel.is_current());
    let repaired = fixture.channel(false);
    assert!(repaired.is_current());
    // Already admitted original IO still owns its reply, caller and charges.
    drop(admitted);
}
