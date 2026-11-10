use super::*;
use crate::host_ws::tests::{accept, descriptor, hello, http_chunk, next, result, Server};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Fixture {
    state: Arc<RemoteConnections>,
    root: PathBuf,
    path: PathBuf,
    local: StoredMachine,
    target: StoredMachine,
    issuer: Arc<NativeServiceChannel>,
}

impl Fixture {
    fn new(endpoint: &str) -> Self {
        let root = std::env::temp_dir().join(format!("bycoda-device-ws-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("machines.json");
        let target = StoredMachine {
            id: "device-computer".into(),
            name: "Paired device fixture".into(),
            endpoint: endpoint.into(),
            environment_id: "host.1".into(),
            token: "secret-native-token".into(),
            ssh: None,
            local_host: false,
        };
        let mut local = target.clone();
        local.id = "local-issuer".into();
        local.name = "This computer (local sync)".into();
        local.local_host = true;
        write(&path, &[local.clone(), target.clone()]).unwrap();
        let state = Arc::new(RemoteConnections::default());
        let issuer = NativeServiceChannel::fixture(&state, path.clone(), local.clone(), true);
        Self {
            state,
            root,
            path,
            local,
            target,
            issuer,
        }
    }

    fn channel(&self, websocket: bool) -> Arc<NativeDeviceChannel> {
        let caller = self
            .state
            .native_device_ws
            .capture_device(
                NativeRoute::new(
                    &self.target.id,
                    &self.target.environment_id,
                    &self.target.endpoint,
                    &self.target.token,
                    &ws_fingerprint(&self.target),
                )
                .unwrap(),
            )
            .unwrap();
        Arc::new(NativeDeviceChannel {
            selection: Selection {
                store: self.state.store.clone(),
                path: self.path.clone(),
                machine: self.target.clone(),
                endpoint: self.target.endpoint.clone(),
                tunnel: None,
            },
            caller,
            websocket,
            grant_deadline: Instant::now() + Duration::from_secs(60),
        })
    }

    fn taken(&self) -> NativeServiceReply {
        self.issuer
            .request("conversation.desktop.take", json!({}))
            .unwrap()
    }

    fn replace_target(&self, target: StoredMachine) {
        let _store = self.state.store.lock().unwrap();
        write(&self.path, &[self.local.clone(), target]).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.native_device_ws.shutdown();
        self.state.native_service_ws.shutdown();
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(&self.root);
    }
}

fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}

fn frame() -> Value {
    json!({"mime":"image/png","base64":"iVBORw0KGgo=","capturedAt":"2026-10-29T00:00:00.000Z"})
}

async fn http_request(socket: &mut tokio::net::TcpStream) -> Value {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = socket.read(&mut buffer).await.unwrap();
        assert!(count > 0);
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() < 64 * 1024);
        if let Some(end) = bytes.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
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
fn paired_factory_is_finite_and_does_not_grant_setup_stop_or_other_private_scopes() {
    for method in [
        "devices.status",
        "devices.preflight",
        "devices.preview",
        "devices.preview.status",
        "devices.list",
        "devices.start",
        "devices.boot",
        "devices.capture",
        "devices.stream",
        "devices.control.status",
        "devices.control.claim",
        "devices.control.renew",
        "devices.control.release",
        "devices.inspect",
        "devices.action",
    ] {
        assert_eq!(wire_method(method).as_deref(), Some(method));
    }
    for method in [
        "devices.setup",
        "devices.stop",
        "devices.preview.mobile.start",
        "devices.preview.mobile.status",
        "devices.preview.impact",
        "devices.exec",
        "machines.list",
        "native.devices.action",
        "native.services.conversation.desktop.take",
    ] {
        assert!(wire_method(method).is_none(), "{method}");
    }
}

#[test]
fn old_host_uses_http_with_the_original_preview_owner_deadline_and_request_id() {
    let (done, finished) = std::sync::mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut issuer = accept(&listener).await;
        hello(
            &mut issuer,
            &["native.services.conversation.desktop.take"],
            "host.1",
        )
        .await;
        let take = next(&mut issuer).await;
        result(&mut issuer, &take, json!([])).await;
        let (mut http, _) = listener.accept().await.unwrap();
        let request = http_request(&mut http).await;
        assert_eq!(request["method"], "devices.preview");
        assert_eq!(request["environmentId"], "host.1");
        assert_eq!(request["params"]["requestId"], "original-preview");
        assert_eq!(request["params"]["previewOwner"], "issuer:session");
        assert_eq!(request["params"]["previewExpiresAt"], 4_102_444_800_000u64);
        http_result(&mut http, json!({"id":"job.1","requestId":"original-preview","deviceId":"simulator","state":"queued","stages":[],"verification":"launch-only","updatedAt":"2026-10-29T00:00:00.000Z"})).await;
        tokio::task::spawn_blocking(move || finished.recv_timeout(Duration::from_secs(3)).unwrap())
            .await
            .unwrap();
    });
    let fixture = Fixture::new(&server.endpoint);
    let taken = fixture.taken();
    let channel = fixture.channel(false);
    let reply = channel
        .request(
            "devices.preview",
            json!({
                "deviceId":"simulator","requestId":"original-preview","url":"exp://127.0.0.1:8081",
                "previewOwner":"issuer:session","previewExpiresAt":4_102_444_800_000u64,
            }),
            &taken,
            deadline(),
        )
        .unwrap();
    assert_eq!(
        reply
            .project(&taken, |value| Ok(value["id"].clone()))
            .unwrap(),
        "job.1"
    );
    fixture
        .state
        .native_device_ws
        .invalidate_machine(&fixture.target.id);
    assert!(
        reply.check(&taken).is_err(),
        "HTTP callers must retain actual retirement identity"
    );
    done.send(()).unwrap();
}

#[test]
fn only_negotiated_absence_before_dispatch_falls_back_to_http() {
    let (done, finished) = std::sync::mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut issuer = accept(&listener).await;
        hello(
            &mut issuer,
            &["native.services.conversation.desktop.take"],
            "host.1",
        )
        .await;
        let take = next(&mut issuer).await;
        result(&mut issuer, &take, json!([])).await;
        let mut target = accept(&listener).await;
        hello(&mut target, &[], "host.1").await;
        let (mut http, _) = listener.accept().await.unwrap();
        let request = http_request(&mut http).await;
        assert_eq!(request["method"], "devices.capture");
        assert_eq!(request["params"], json!({"deviceId":"simulator"}));
        http_result(&mut http, frame()).await;
        tokio::task::spawn_blocking(move || finished.recv_timeout(Duration::from_secs(3)).unwrap())
            .await
            .unwrap();
    });
    let fixture = Fixture::new(&server.endpoint);
    let taken = fixture.taken();
    let reply = fixture
        .channel(true)
        .request(
            "devices.capture",
            json!({"deviceId":"simulator"}),
            &taken,
            deadline(),
        )
        .unwrap();
    assert_eq!(
        reply.project(&taken, |value| Ok(value.clone())).unwrap(),
        frame()
    );
    done.send(()).unwrap();
}

#[test]
fn dispatched_action_capture_and_reads_never_replay_over_http() {
    for (method, params) in [
        (
            "devices.action",
            json!({"deviceId":"simulator","leaseId":"lease","requestId":"request","action":{"type":"press","x":1,"y":2}}),
        ),
        ("devices.capture", json!({"deviceId":"simulator"})),
        ("devices.list", json!({})),
    ] {
        let http_calls = Arc::new(AtomicUsize::new(0));
        let seen = http_calls.clone();
        let server = Server::spawn(move |listener| async move {
            let mut issuer = accept(&listener).await;
            hello(
                &mut issuer,
                &["native.services.conversation.desktop.take"],
                "host.1",
            )
            .await;
            let take = next(&mut issuer).await;
            result(&mut issuer, &take, json!([])).await;
            let mut target = accept(&listener).await;
            hello(&mut target, &[method], "host.1").await;
            let request = next(&mut target).await;
            assert_eq!(request["method"], method);
            target.close(None).await.unwrap();
            if let Ok(Ok((mut http, _))) =
                tokio::time::timeout(Duration::from_millis(250), listener.accept()).await
            {
                let mut prefix = [0; 4];
                if http.peek(&mut prefix).await.unwrap_or(0) >= 4 && &prefix == b"POST" {
                    seen.fetch_add(1, Ordering::SeqCst);
                    let _ = http_request(&mut http).await;
                    http_result(&mut http, Value::Null).await;
                }
            }
        });
        let fixture = Fixture::new(&server.endpoint);
        let taken = fixture.taken();
        let error = fixture
            .channel(true)
            .request(method, params, &taken, deadline())
            .err()
            .unwrap();
        assert!(!error.contains("Unsupported"), "{method}: {error}");
        if method == "devices.action" {
            assert!(error.contains("outcome is unknown"), "{error}");
        }
        drop(server);
        assert_eq!(http_calls.load(Ordering::SeqCst), 0, "{method}");
    }
}

#[test]
fn real_bulk_stays_charged_through_final_use_and_both_original_callers_fence_disclosure() {
    let _serial = crate::host_ws::tests::BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut value = frame();
    value["base64"] = json!("A".repeat(1_200_000));
    let bytes = Arc::new(serde_json::to_vec(&value).unwrap());
    let data = bytes.clone();
    let (done, finished) = std::sync::mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut issuer = accept(&listener).await;
        hello(
            &mut issuer,
            &["native.services.conversation.desktop.take"],
            "host.1",
        )
        .await;
        let take = next(&mut issuer).await;
        result(&mut issuer, &take, json!([])).await;
        let mut target = accept(&listener).await;
        hello(&mut target, &["devices.capture"], "host.1").await;
        let request = next(&mut target).await;
        result(&mut target, &request, json!({"$bulk":descriptor(&data)})).await;
        for offset in (0..data.len()).step_by(65536) {
            let (stream, _) = listener.accept().await.unwrap();
            let data = data.clone();
            tokio::task::spawn_blocking(move || {
                http_chunk(stream.into_std().unwrap(), &data, offset, None, None)
            })
            .await
            .unwrap();
        }
        tokio::task::spawn_blocking(move || finished.recv_timeout(Duration::from_secs(3)).unwrap())
            .await
            .unwrap();
    });
    let fixture = Fixture::new(&server.endpoint);
    let taken = fixture.taken();
    let channel = fixture.channel(true);
    let reply = channel
        .request(
            "devices.capture",
            json!({"deviceId":"simulator"}),
            &taken,
            deadline(),
        )
        .unwrap();
    drop(channel);
    assert_eq!(crate::host_ws::tests::bulk_in_flight(), (1, bytes.len()));
    assert_eq!(
        reply
            .project(&taken, |actual| Ok(actual["base64"]
                .as_str()
                .unwrap()
                .len()))
            .unwrap(),
        1_200_000
    );
    let mut changed = fixture.target.clone();
    changed.token = "replacement-device-token".into();
    fixture.replace_target(changed);
    let mut consumed = false;
    assert!(reply
        .project(&taken, |_| {
            consumed = true;
            Ok(())
        })
        .is_err());
    assert!(!consumed);
    fixture.replace_target(fixture.target.clone());
    fixture
        .state
        .native_device_ws
        .invalidate_machine(&fixture.target.id);
    assert!(
        reply.check(&taken).is_err(),
        "identical repair must not revive original device caller"
    );
    assert!(taken.check().is_ok());
    assert_eq!(crate::host_ws::tests::bulk_in_flight(), (1, bytes.len()));
    drop(reply);
    assert_eq!(crate::host_ws::tests::bulk_in_flight(), (0, 0));
    done.send(()).unwrap();
}

#[test]
fn original_issuer_retirement_blocks_target_consumer_and_new_dispatch() {
    let (done, finished) = std::sync::mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut issuer = accept(&listener).await;
        hello(
            &mut issuer,
            &["native.services.conversation.desktop.take"],
            "host.1",
        )
        .await;
        let take = next(&mut issuer).await;
        result(&mut issuer, &take, json!([])).await;
        let mut target = accept(&listener).await;
        hello(&mut target, &["devices.capture"], "host.1").await;
        let request = next(&mut target).await;
        result(&mut target, &request, frame()).await;
        tokio::task::spawn_blocking(move || finished.recv_timeout(Duration::from_secs(3)).unwrap())
            .await
            .unwrap();
    });
    let fixture = Fixture::new(&server.endpoint);
    let taken = fixture.taken();
    let channel = fixture.channel(true);
    let reply = channel
        .request(
            "devices.capture",
            json!({"deviceId":"simulator"}),
            &taken,
            deadline(),
        )
        .unwrap();
    fixture
        .state
        .native_service_ws
        .invalidate_machine(&fixture.local.id);
    assert!(reply.project(&taken, |_| Ok(())).is_err());
    assert!(channel
        .request(
            "devices.capture",
            json!({"deviceId":"simulator"}),
            &taken,
            deadline()
        )
        .is_err());
    done.send(()).unwrap();
}

#[test]
fn http_compatibility_does_not_reset_the_original_operation_deadline() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = Server::spawn(move |listener| async move {
        let mut issuer = accept(&listener).await;
        hello(
            &mut issuer,
            &["native.services.conversation.desktop.take"],
            "host.1",
        )
        .await;
        let take = next(&mut issuer).await;
        result(&mut issuer, &take, json!([])).await;
        if let Ok(Ok((mut http, _))) =
            tokio::time::timeout(Duration::from_millis(200), listener.accept()).await
        {
            seen.fetch_add(1, Ordering::SeqCst);
            let _ = http_request(&mut http).await;
            http_result(&mut http, frame()).await;
        }
    });
    let fixture = Fixture::new(&server.endpoint);
    let taken = fixture.taken();
    let elapsed = Instant::now().checked_sub(Duration::from_secs(1)).unwrap();
    let error = fixture
        .channel(false)
        .request(
            "devices.capture",
            json!({"deviceId":"simulator"}),
            &taken,
            elapsed,
        )
        .err()
        .unwrap();
    assert!(error.to_ascii_lowercase().contains("deadline"), "{error}");
    drop(server);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn accepted_preview_retirement_before_later_use_keeps_unknown_without_replay() {
    for retire_issuer in [false, true] {
        let http_calls = Arc::new(AtomicUsize::new(0));
        let seen = http_calls.clone();
        let (done, finished) = std::sync::mpsc::channel();
        let server = Server::spawn(move |listener| async move {
            let mut issuer = accept(&listener).await;
            hello(
                &mut issuer,
                &[
                    "native.services.conversation.desktop.take",
                    "native.services.conversation.desktop.finish",
                ],
                "host.1",
            )
            .await;
            let take = next(&mut issuer).await;
            result(&mut issuer, &take, json!([])).await;
            let mut target = accept(&listener).await;
            hello(&mut target, &["devices.preview"], "host.1").await;
            let request = next(&mut target).await;
            assert_eq!(request["method"], "devices.preview");
            assert_eq!(request["params"]["requestId"], "accepted-original");
            result(
                &mut target,
                &request,
                json!({
                    "id":"accepted-job","requestId":"accepted-original","deviceId":"simulator",
                    "state":"running","stages":[],"verification":"launch-only",
                    "updatedAt":"2026-10-29T00:00:00.000Z",
                    "frame":frame(),
                }),
            )
            .await;
            if !retire_issuer {
                let finish = next(&mut issuer).await;
                assert_eq!(
                    finish["method"],
                    "native.services.conversation.desktop.finish"
                );
                assert_eq!(
                    finish["params"]["id"],
                    "c0b099f9-b5ac-4fc7-b90d-8c27265338cd"
                );
                assert!(finish["params"]["error"]
                    .as_str()
                    .unwrap()
                    .contains("outcome is unknown"));
                assert!(finish["params"].get("result").is_none());
                assert!(finish["params"].get("frame").is_none());
                result(&mut issuer, &finish, json!({"accepted": true})).await;
            }
            tokio::task::spawn_blocking(move || {
                finished.recv_timeout(Duration::from_secs(3)).unwrap()
            })
            .await
            .unwrap();
            if let Ok(Ok((mut http, _))) =
                tokio::time::timeout(Duration::from_millis(200), listener.accept()).await
            {
                let mut prefix = [0; 4];
                if http.peek(&mut prefix).await.unwrap_or(0) >= 4 && &prefix == b"POST" {
                    seen.fetch_add(1, Ordering::SeqCst);
                    let _ = http_request(&mut http).await;
                    http_result(&mut http, Value::Null).await;
                }
            }
        });
        let fixture = Fixture::new(&server.endpoint);
        let taken = fixture.taken();
        let reply = fixture.channel(true).request("devices.preview", json!({
            "deviceId":"simulator","requestId":"accepted-original","url":"exp://127.0.0.1:8081",
            "previewOwner":"issuer:session","previewExpiresAt":4_102_444_800_000u64,
        }), &taken, deadline()).unwrap();
        assert_eq!(
            reply
                .project(&taken, |value| Ok(value["id"].clone()))
                .unwrap(),
            "accepted-job"
        );
        let protected = reply.project(&taken, |value| Ok(value.clone())).unwrap();
        assert!(protected.get("frame").is_some());

        // A UI acknowledgement may wait after preview admission. Releasing this
        // event retires the original caller in that interval, without any UI.
        let (release, released) = std::sync::mpsc::channel();
        let state = fixture.state.clone();
        let id = if retire_issuer {
            fixture.local.id.clone()
        } else {
            fixture.target.id.clone()
        };
        let retire = std::thread::spawn(move || {
            released.recv_timeout(Duration::from_secs(2)).unwrap();
            if retire_issuer {
                state.native_service_ws.invalidate_machine(&id);
            } else {
                state.native_device_ws.invalidate_machine(&id);
            }
        });
        release.send(()).unwrap();
        retire.join().unwrap();
        if !retire_issuer {
            assert!(taken.check().is_ok(), "the original issuer remains current");
        }
        let check = reply.check(&taken).unwrap_err();
        let mut consumed = false;
        let projection = reply
            .project(&taken, |_| {
                consumed = true;
                Ok(())
            })
            .unwrap_err();
        assert!(!consumed);
        for error in [check, projection] {
            assert!(error.contains("outcome is unknown"), "{error}");
            assert!(error.contains("Do not replay this request"), "{error}");
            assert_eq!(error.matches("outcome is unknown").count(), 1, "{error}");
        }
        let finish = crate::conversation_tools_bridge::device_finish_payload(
            &json!("c0b099f9-b5ac-4fc7-b90d-8c27265338cd"),
            &protected,
            &taken,
            &reply,
        );
        if retire_issuer {
            assert!(
                finish.is_err(),
                "a retired issuer receives neither target bytes nor status"
            );
        } else {
            let finish = finish.unwrap();
            assert_eq!(finish["id"], "c0b099f9-b5ac-4fc7-b90d-8c27265338cd");
            assert!(finish["error"]
                .as_str()
                .unwrap()
                .contains("outcome is unknown"));
            assert!(finish.get("result").is_none());
            assert!(finish.get("frame").is_none());
            fixture
                .issuer
                .project("conversation.desktop.finish", finish, |_| Ok(()))
                .unwrap();
        }
        done.send(()).unwrap();
        drop(server);
        assert_eq!(http_calls.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn original_grant_expiry_after_decoded_preview_bulk_only_forwards_unknown_to_issuer() {
    let _serial = crate::host_ws::tests::BULK_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let preview = json!({
        "id":"accepted-job","requestId":"original-preview","deviceId":"simulator",
        "state":"ready","stages":[],"verification":"launch-only",
        "updatedAt":"2026-10-29T00:00:00.000Z",
        "frame":{"mime":"image/png","base64":"A".repeat(1_200_000),"capturedAt":"2026-10-29T00:00:00.000Z"},
    });
    let bytes = Arc::new(serde_json::to_vec(&preview).unwrap());
    let data = bytes.clone();
    let http_calls = Arc::new(AtomicUsize::new(0));
    let seen = http_calls.clone();
    let (done, finished) = std::sync::mpsc::channel();
    let server = Server::spawn(move |listener| async move {
        let mut issuer = accept(&listener).await;
        hello(
            &mut issuer,
            &[
                "native.services.conversation.desktop.take",
                "native.services.conversation.desktop.finish",
            ],
            "host.1",
        )
        .await;
        let take = next(&mut issuer).await;
        result(&mut issuer, &take, json!([])).await;
        let mut target = accept(&listener).await;
        hello(&mut target, &["devices.preview"], "host.1").await;
        let request = next(&mut target).await;
        assert_eq!(request["method"], "devices.preview");
        assert_eq!(request["params"]["requestId"], "original-preview");
        result(&mut target, &request, json!({"$bulk":descriptor(&data)})).await;
        for offset in (0..data.len()).step_by(65536) {
            let (stream, _) = listener.accept().await.unwrap();
            let data = data.clone();
            tokio::task::spawn_blocking(move || {
                http_chunk(stream.into_std().unwrap(), &data, offset, None, None)
            })
            .await
            .unwrap();
        }
        let finish = next(&mut issuer).await;
        assert_eq!(
            finish["method"],
            "native.services.conversation.desktop.finish"
        );
        assert_eq!(
            finish["params"]["id"],
            "c0b099f9-b5ac-4fc7-b90d-8c27265338cd"
        );
        assert!(finish["params"]["error"]
            .as_str()
            .unwrap()
            .contains("outcome is unknown"));
        assert!(finish["params"].get("result").is_none());
        assert!(finish["params"].get("frame").is_none());
        result(&mut issuer, &finish, json!({"accepted":true})).await;
        tokio::task::spawn_blocking(move || finished.recv_timeout(Duration::from_secs(3)).unwrap())
            .await
            .unwrap();
        if let Ok(Ok((mut http, _))) =
            tokio::time::timeout(Duration::from_millis(200), listener.accept()).await
        {
            seen.fetch_add(1, Ordering::SeqCst);
            let _ = http_request(&mut http).await;
            http_result(&mut http, Value::Null).await;
        }
    });
    let fixture = Fixture::new(&server.endpoint);
    let taken = fixture.taken();
    let channel = fixture.channel(true);
    let mut reply = channel
        .request(
            "devices.preview",
            json!({
                "deviceId":"simulator","requestId":"original-preview","url":"exp://127.0.0.1:8081",
                "previewOwner":"issuer:session","previewExpiresAt":4_102_444_800_000u64,
            }),
            &taken,
            deadline(),
        )
        .unwrap();
    let protected = reply.project(&taken, |value| Ok(value.clone())).unwrap();
    assert_eq!(
        protected["frame"]["base64"].as_str().unwrap().len(),
        1_200_000
    );
    assert_eq!(crate::host_ws::tests::bulk_in_flight(), (1, bytes.len()));

    // Only tests can alter the immutable copied deadline. No wait, route or
    // bulk TTL is expired: this specifically fences the original continuation.
    let elapsed = Instant::now().checked_sub(Duration::from_secs(1)).unwrap();
    reply.grant_deadline = elapsed;
    assert!(channel.check_projection_deadline().is_ok());
    assert!(taken.check().is_ok());
    let mut consumed = false;
    assert!(taken
        .with_device_projection(&reply, |_| {
            consumed = true;
            Ok(())
        })
        .is_err());
    assert!(
        !consumed,
        "direct UI projection must check expiry inside its held gates"
    );
    let check = reply.check(&taken).unwrap_err();
    let projection = reply
        .project(&taken, |_| {
            consumed = true;
            Ok(())
        })
        .unwrap_err();
    assert!(!consumed);
    for error in [check, projection] {
        assert!(error.contains("continuation expired"), "{error}");
        assert!(error.contains("outcome is unknown"), "{error}");
        assert!(error.contains("Do not replay this request"), "{error}");
    }
    let finish = crate::conversation_tools_bridge::device_finish_payload(
        &json!("c0b099f9-b5ac-4fc7-b90d-8c27265338cd"),
        &protected,
        &taken,
        &reply,
    )
    .unwrap();
    assert!(finish.get("result").is_none());
    assert!(finish.get("frame").is_none());
    fixture
        .issuer
        .project("conversation.desktop.finish", finish, |_| Ok(()))
        .unwrap();
    assert_eq!(crate::host_ws::tests::bulk_in_flight(), (1, bytes.len()));
    drop(reply);
    assert_eq!(crate::host_ws::tests::bulk_in_flight(), (0, 0));

    let mut expired = fixture.channel(false);
    Arc::get_mut(&mut expired).unwrap().grant_deadline = elapsed;
    let error = expired
        .request(
            "devices.capture",
            json!({"deviceId":"simulator"}),
            &taken,
            deadline(),
        )
        .err()
        .unwrap();
    assert!(error.contains("continuation expired"), "{error}");
    done.send(()).unwrap();
    drop(server);
    assert_eq!(http_calls.load(Ordering::SeqCst), 0);
}
