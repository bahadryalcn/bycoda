#[test]
fn search_replace_rpc_deadline_outlasts_per_file_publication() {
    assert_eq!(
        super::rpc_timeout(
            "workspace.run",
            &serde_json::json!({"command":"replace_project"})
        ),
        std::time::Duration::from_secs(1800),
    );
    assert_eq!(
        super::rpc_operation(
            "workspace.run",
            &serde_json::json!({"command":"replace_project"})
        ),
        "workspace.run:replace_project",
    );
}

#[test]
fn public_device_reply_retirement_preserves_post_effect_unknown_classification() {
    use crate::host_ws::tests::{accept, hello, next, result, Server};
    for (method, params, value, effect) in [
        (
            "devices.action",
            serde_json::json!({"deviceId":"device","leaseId":"original-lease","requestId":"original-action","action":{"type":"home"}}),
            serde_json::json!("accepted"),
            true,
        ),
        (
            "devices.capture",
            serde_json::json!({"deviceId":"device"}),
            serde_json::json!({"mime":"image/png","base64":"AAAA","capturedAt":"now"}),
            true,
        ),
        (
            "devices.setup",
            serde_json::json!({"agentAccess":false}),
            serde_json::json!({"running":false,"installed":true,"agentInstalled":false,"platform":"win32","platforms":[]}),
            true,
        ),
        (
            "devices.stop",
            serde_json::json!({}),
            serde_json::json!({"running":false,"installed":true,"agentInstalled":false,"platform":"win32","platforms":[]}),
            true,
        ),
        (
            "devices.preview.mobile.start",
            serde_json::json!({"projectId":"project","requestId":"preview-request","deviceId":"device","url":"exp://127.0.0.1:8081"}),
            serde_json::json!({"id":"preview","requestId":"preview-request","deviceId":"device","state":"ready","stages":[],"verification":"launch-only","updatedAt":"now"}),
            true,
        ),
        (
            "devices.preview.mobile.status",
            serde_json::json!({"projectId":"project","requestId":"preview-request"}),
            serde_json::json!({"id":"preview","requestId":"preview-request","deviceId":"device","state":"ready","stages":[],"verification":"launch-only","updatedAt":"now"}),
            false,
        ),
        (
            "devices.preview.impact",
            serde_json::json!({"projectId":"project"}),
            serde_json::json!({"activeCount":0,"owned":[],"otherActiveCount":0}),
            false,
        ),
        (
            "devices.list",
            serde_json::json!({}),
            serde_json::json!({"devices":[],"errors":[]}),
            false,
        ),
    ] {
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(&mut socket, &[method], "host.1").await;
            let request = next(&mut socket).await;
            result(&mut socket, &request, value).await;
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        });
        let route = super::NativeRoute::new(
            "machine.1",
            "host.1",
            &server.endpoint,
            "secret-native-token",
            "principal",
        )
        .unwrap();
        let broker = super::HostWsBroker::default();
        let reply = broker
            .request(
                &route,
                "device-panel",
                method,
                params,
                super::RequestOptions {
                    request_id: Some("device-panel.request".into()),
                    ..super::RequestOptions::default()
                },
            )
            .unwrap();
        let generation = reply.generation;
        let ipc_reply = reply.clone();
        let route_reply = reply.clone();
        let (_value, guard) = reply.into_guarded_result();
        broker.detach("device-panel");
        let error = super::check_remote_reply(&guard, method).unwrap_err();
        assert_eq!(
            error.contains("operation outcome is unknown"),
            effect,
            "{method}: {error}"
        );
        // Exercise the typed IPC path too. A real resource failure retains
        // its original identity; a final saved-route failure receives only
        // the known envelope identity, never a fabricated command receipt.
        for (reply, route_changed) in [(ipc_reply, false), (route_reply, true)] {
            let error = super::disclose_public_reply(
                reply,
                method,
                Some("device-panel.request".into()),
                None,
                |reply| {
                    if route_changed {
                        Err(super::WsFailure::local(
                            "RPC_WS_ROUTE_CHANGED",
                            "Saved route changed after the Host accepted the request",
                        ))
                    } else {
                        reply.disclose()
                    }
                },
            )
            .unwrap_err();
            assert_eq!(error.uncertain, effect, "{method}: {error}");
            assert!(!error.unsupported, "{method}: {error}");
            assert_eq!(error.generation, Some(generation));
            assert_eq!(error.request_id.as_deref(), Some("device-panel.request"));
            assert!(error.command_id.is_none());
        }
        broker.shutdown();
    }
}
#[test]
fn device_http_outcomes_preserve_admitted_uncertainty_without_reclassifying_denials() {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::{net::TcpListener, sync::mpsc, thread, time::Duration};

    let unknown = br#"{"error":"authority expired","code":"HOST_DEVICE_OPERATION_UNCONFIRMED","delivery":"unknown"}"#;
    let denied = br#"{"error":"authorization denied"}"#;
    let malformed = b"{broken";
    let mut cases = vec![
        ("devices.setup", 400, unknown.to_vec(), 0, "unknown"),
        ("devices.stop", 401, unknown.to_vec(), 0, "unknown"),
        (
            "devices.preview.mobile.start",
            403,
            unknown.to_vec(),
            0,
            "unknown",
        ),
        ("devices.capture", 400, unknown.to_vec(), 0, "unknown"),
        ("devices.setup", 401, denied.to_vec(), 0, "auth"),
        ("devices.stop", 403, denied.to_vec(), 0, "auth"),
        (
            "devices.setup",
            400,
            br#"{"error":"choose agentAccess"}"#.to_vec(),
            0,
            "rejected",
        ),
        (
            "devices.preview.mobile.start",
            400,
            br#"{"error":"preview busy","delivery":"not-sent"}"#.to_vec(),
            0,
            "rejected",
        ),
        ("devices.status", 401, unknown.to_vec(), 0, "auth"),
        (
            "devices.preview.mobile.status",
            400,
            unknown.to_vec(),
            0,
            "rejected",
        ),
        (
            "devices.preview.impact",
            400,
            unknown.to_vec(),
            0,
            "rejected",
        ),
        (
            "devices.setup",
            400,
            br#"{"error":"unconfirmed","code":"HOST_DEVICE_OPERATION_UNCONFIRMED"}"#.to_vec(),
            0,
            "rejected",
        ),
        (
            "devices.setup",
            400,
            br#"{"error":"unconfirmed","delivery":"unknown"}"#.to_vec(),
            0,
            "rejected",
        ),
        ("devices.capture", 200, malformed.to_vec(), 0, "unknown"),
        ("devices.setup", 401, malformed.to_vec(), 0, "unknown"),
        (
            "devices.stop",
            200,
            br#"{"result":true}"#.to_vec(),
            8,
            "unknown",
        ),
        ("devices.status", 200, malformed.to_vec(), 0, "invalid"),
    ];
    cases.push((
        "devices.setup",
        400,
        vec![b'x'; super::MAX_RESPONSE_BYTES as usize + 1],
        0,
        "unknown",
    ));

    for (method, status, body, extra_length, expected) in cases {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let (finished, wait_finished) = mpsc::channel();
        let server = thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(std::time::Instant::now() < deadline, "No HTTP request");
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("HTTP fixture failed: {error}"),
                }
            };
            // BSD/macOS accept() inherits O_NONBLOCK from the listener; the
            // timeouts below only apply to a blocking stream.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            assert_eq!(first.trim_end(), "POST /rpc HTTP/1.1");
            let mut size = None;
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                if let Some(length) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    size = Some(length.trim().parse::<usize>().unwrap());
                }
            }
            let mut request = vec![0; size.unwrap()];
            reader.read_exact(&mut request).unwrap();
            let request: serde_json::Value = serde_json::from_slice(&request).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["environmentId"], "fixture-env");
            write!(
                stream,
                "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len() + extra_length
            )
            .unwrap();
            // An oversized body may legitimately close at the bounded read.
            let _ = stream.write_all(&body);
            let _ = stream.flush();
            drop(reader);
            drop(stream);
            wait_finished.recv_timeout(Duration::from_secs(5)).unwrap();
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock,
                "A device HTTP request was replayed"
            );
        });
        let error = super::rpc_timed(
            &endpoint,
            "fixture-token",
            Some("fixture-env"),
            method,
            serde_json::json!({}),
            Duration::from_secs(4),
        )
        .unwrap_err();
        finished.send(()).unwrap();
        server.join().unwrap();
        assert_eq!(
            error.contains("[RPC_DEVICE_OUTCOME_UNKNOWN]"),
            expected == "unknown",
            "{method}/{status}: {error}"
        );
        assert_eq!(
            error.contains("[RPC_AUTHORIZATION]"),
            expected == "auth",
            "{method}/{status}: {error}"
        );
        if expected == "rejected" {
            assert!(error.starts_with("Host rejected request:"), "{error}");
        }
        if expected == "invalid" {
            assert_eq!(error, "Invalid host response");
        }
        if expected == "unknown" {
            assert!(error.contains("Do not repeat the request"));
        }
    }
}

#[test]
fn compatibility_deadline_expiry_rejects_before_any_http_connection() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let error = super::rpc_until(
        &endpoint,
        "fixture",
        Some("env"),
        "projects.list",
        serde_json::json!({}),
        std::time::Instant::now() - std::time::Duration::from_secs(1),
    )
    .unwrap_err();
    assert!(error.contains("deadline"));
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

#[test]
fn social_peer_authority_requires_a_stable_host_reachable_endpoint_before_enrollment() {
    for endpoint in [
        "ssh://fixture@host:3774",
        "http://remote-host:3774",
        "https://user:secret@host",
        "https://host/path",
        "https://host?key=secret",
    ] {
        assert!(super::social_peer_endpoint(endpoint).is_err());
    }
    for endpoint in [
        "https://host.example",
        "http://127.0.0.1:3774",
        "http://localhost:3774",
    ] {
        assert_eq!(super::social_peer_endpoint(endpoint).unwrap(), endpoint);
    }
}
#[test]
fn oversized_canonical_writes_select_http_before_dispatch_and_keep_body_identities() {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::{
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let machine = super::StoredMachine {
        id: "large-write.host".into(),
        name: "Host".into(),
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        environment_id: "large-write.env".into(),
        token: "paired-owner".into(),
        ssh: None,
        local_host: false,
    };
    let requests = [
        (
            "files.write",
            serde_json::json!({"projectId":"project.1", "path":"file.txt",
                "expected":"a".repeat(600 * 1024), "content":"b".repeat(600 * 1024)}),
        ),
        (
            "commands.dispatch",
            serde_json::json!({"type":"send", "commandId":"original.command.1",
                "sessionId":"session.1", "text":"a".repeat(1024 * 1024)}),
        ),
    ];
    let state = super::RemoteConnections::default();
    state.observe_ws_capability(
        &machine,
        &serde_json::json!({
            "environmentId":machine.environment_id, "capabilities":["transport.ws.v2"],
        }),
    );
    assert!(state.ws_enabled(&machine));
    for (method, params) in &requests {
        assert!(crate::host_ws::HostWsBroker::supports_method(method));
        assert!(!state.ws_request_compatible(&machine, method, params));
    }
    let expected = requests.clone();
    let server = thread::spawn(move || {
        for (method, params) in expected {
            let until = Instant::now() + Duration::from_secs(5);
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(stream) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < until,
                            "HTTP compatibility request was not sent"
                        );
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("fixture accept failed: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            assert_eq!(first.trim_end(), "POST /rpc HTTP/1.1");
            let mut size = None;
            let mut authorized = false;
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if let Some(value) = lower.strip_prefix("content-length:") {
                    size = Some(value.trim().parse::<usize>().unwrap());
                }
                if lower.starts_with("authorization:") {
                    authorized = line.trim_end().ends_with("Bearer paired-owner");
                }
            }
            assert!(authorized);
            let size = size.unwrap();
            assert!(size > 1024 * 1024 && size < 16 * 1024 * 1024);
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                payload,
                serde_json::json!({"version":1,"environmentId":"large-write.env","method":method,"params":params})
            );
            let body = r#"{"result":{"saved":true}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        }
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    });
    for (method, params) in requests {
        // This is the same untouched HTTP arm used after compatibility
        // preflight rejects a frame, with no synthetic new request identity.
        assert_eq!(
            super::machine_rpc(&state, &machine, method, params, false).unwrap(),
            serde_json::json!({"saved":true})
        );
    }
    server.join().unwrap();
}

#[test]
fn ws_capability_is_bound_to_authenticated_identity_and_native_route() {
    let state = super::RemoteConnections::default();
    let machine = super::StoredMachine {
        id: "machine.ws".into(),
        name: "Host".into(),
        endpoint: "https://example.org".into(),
        environment_id: "host.ws".into(),
        token: "native-token".into(),
        ssh: None,
        local_host: false,
    };
    assert!(!state.ws_enabled(&machine));
    state.observe_ws_capability(
        &machine,
        &serde_json::json!({"environmentId":"wrong.host","capabilities":["transport.ws.v2"]}),
    );
    assert!(!state.ws_enabled(&machine));
    state.observe_ws_capability(
        &machine,
        &serde_json::json!({"environmentId":"host.ws","capabilities":["transport.ws.read.v2"]}),
    );
    assert!(state.ws_enabled(&machine));
    let mut renamed = machine.clone();
    renamed.name = "Renamed".into();
    assert!(state.ws_enabled(&renamed));
    let mut new_principal = machine.clone();
    new_principal.token = "replacement-token".into();
    assert!(!state.ws_enabled(&new_principal));
    assert!(!state.ws_enabled(&machine));
}

#[test]
fn old_http_host_without_ws_capability_stays_on_compatibility_transport() {
    let state = super::RemoteConnections::default();
    let machine = super::StoredMachine {
        id: "old.host".into(),
        name: "Old Host".into(),
        endpoint: "http://127.0.0.1:9".into(),
        environment_id: "old.env".into(),
        token: "native-token".into(),
        ssh: None,
        local_host: false,
    };
    state.observe_ws_capability(
        &machine,
        &serde_json::json!({"environmentId":"old.env","capabilities":["rpc.v1"]}),
    );
    assert!(!state.ws_enabled(&machine));
    assert!(super::HostWsBroker::supports_method("projects.list"));
    assert!(!super::HostWsBroker::supports_method("arbitrary.unknown"));
}

#[test]
fn authenticated_subset_ws_capabilities_are_recognized_from_the_native_registry() {
    let machine = super::StoredMachine {
        id: "subset.host".into(),
        name: "Subset Host".into(),
        endpoint: "https://example.org".into(),
        environment_id: "subset.env".into(),
        token: "native-token".into(),
        ssh: None,
        local_host: false,
    };
    for capability in [
        "transport.ws.sessions.v2",
        "transport.ws.health.v2",
        "transport.ws.terminals.v2",
        "transport.ws.git.v2",
        "transport.ws.notes.v2",
        "transport.ws.files.v2",
        "transport.ws.queue.v2",
        "transport.ws.streams.v2",
        "transport.ws.stewards.v2",
        "transport.ws.crews.v2",
        "transport.ws.read.v2",
        "transport.ws.v2",
    ] {
        let state = super::RemoteConnections::default();
        state.observe_ws_capability(
            &machine,
            &serde_json::json!({"environmentId":"subset.env","capabilities":[capability]}),
        );
        assert!(state.ws_enabled(&machine), "{capability}");
        let mut changed = machine.clone();
        changed.token = "other-principal".into();
        assert!(!state.ws_enabled(&changed), "{capability}");
    }
}

#[test]
fn unknown_subset_discovery_keeps_http_without_opening_or_reconnecting_a_socket() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let machine = super::StoredMachine {
        id: "unknown.host".into(),
        name: "Unknown Host".into(),
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        environment_id: "unknown.env".into(),
        token: "native-token".into(),
        ssh: None,
        local_host: false,
    };
    let state = super::RemoteConnections::default();
    for capabilities in [
        serde_json::json!(["transport.ws.unregistered.v2"]),
        serde_json::json!(["transport.ws.sessions.v999"]),
        serde_json::json!(["sessions.list"]),
        serde_json::json!(["rpc.v1"]),
        serde_json::json!([]),
        serde_json::Value::Null,
    ] {
        state.observe_ws_capability(&machine,&serde_json::json!({"environmentId":"unknown.env","capabilities":capabilities,"methods":["sessions.list","projects.list"]}));
        assert!(!state.ws_enabled(&machine));
    }
    // A later descriptor removing all known families also retires the old
    // discovery decision; it cannot schedule a replacement connection.
    state.observe_ws_capability(&machine,&serde_json::json!({"environmentId":"unknown.env","capabilities":["transport.ws.sessions.v2"]}));
    assert!(state.ws_enabled(&machine));
    state.observe_ws_capability(&machine,&serde_json::json!({"environmentId":"unknown.env","capabilities":["transport.ws.future.v2"]}));
    assert!(!state.ws_enabled(&machine));
    let until = std::time::Instant::now() + std::time::Duration::from_millis(100);
    while std::time::Instant::now() < until {
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

#[test]
fn refused_tunnel_recovery_preserves_the_original_command() {
    let command = serde_json::json!({
        "type": "send", "commandId": "original", "sessionId": "remote", "text": "hello"
    });
    let mut attempts = Vec::new();
    let mut deliveries = Vec::new();
    let receipt = super::with_refused_tunnel_retry(true, || {
        attempts.push(command.clone());
        if attempts.len() == 1 {
            return Err(super::CONNECTION_REFUSED.to_owned());
        }
        deliveries.push(command.clone());
        Ok(serde_json::json!({"commandId": command["commandId"]}))
    })
    .unwrap();
    assert_eq!(receipt["commandId"], "original");
    assert_eq!(attempts, vec![command.clone(), command.clone()]);
    assert_eq!(deliveries, vec![command]);
}

#[test]
fn refused_tunnel_recovery_is_bounded_and_respects_reconnect_policy() {
    for (allow, expected) in [(true, 2), (false, 1)] {
        let mut attempts = 0;
        let result: Result<(), String> = super::with_refused_tunnel_retry(allow, || {
            attempts += 1;
            Err(super::CONNECTION_REFUSED.to_owned())
        });
        assert_eq!(result.unwrap_err(), super::CONNECTION_REFUSED);
        assert_eq!(attempts, expected);
    }
}

#[test]
fn ambiguous_or_authorization_failures_never_replay_a_command() {
    for error in [
        "The host request did not complete [RPC_HOST_UNAVAILABLE] (commands.dispatch).",
        "The host request did not complete [RPC_TIMEOUT] (commands.dispatch).",
        "Host rejected request [RPC_AUTHORIZATION] (commands.dispatch).",
        "Machine is unreachable. Automatic reconnect is off; reconnect it yourself.",
        "Host is not running on the machine. Start bycoda Host there, then reconnect.",
    ] {
        let mut deliveries = 0;
        let result: Result<(), String> = super::with_refused_tunnel_retry(true, || {
            deliveries += 1;
            Err(error.to_owned())
        });
        assert_eq!(result.unwrap_err(), error);
        assert_eq!(deliveries, 1, "{error}");
    }
}

#[test]
fn a_host_that_accepts_a_command_then_disconnects_is_not_sent_it_again() {
    use std::io::{BufRead, BufReader};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::{net::TcpListener, thread, time::Duration};

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let done = Arc::new(AtomicBool::new(false));
    let server_done = done.clone();
    let server = thread::spawn(move || {
        let mut delivered = Vec::new();
        while !server_done.load(Ordering::SeqCst) {
            let (stream, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("{error}"),
            };
            // Accepted sockets can inherit the listener's nonblocking mode
            // on macOS; the fixture parses its HTTP request synchronously.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(stream);
            let mut size = 0;
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    size = value.trim().parse::<usize>().unwrap();
                }
            }
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            delivered.push(serde_json::from_slice::<Value>(&body).unwrap());
            // The host accepted the body, but its acknowledgement is lost.
            // Closing this stream must leave the command for receipt recovery.
        }
        delivered
    });
    let command = json!({"type": "send", "commandId": "lost-receipt", "sessionId": "remote"});
    let result = super::with_refused_tunnel_retry(true, || {
        super::rpc(
            &endpoint,
            "fixture",
            Some("env"),
            "commands.dispatch",
            command.clone(),
        )
    });
    done.store(true, Ordering::SeqCst);
    let delivered = server.join().unwrap();
    assert!(result.unwrap_err().contains("RPC_HOST_UNAVAILABLE"));
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0]["params"], command);
}

#[test]
fn request_results_belong_to_the_original_saved_route() {
    let started = saved("route", "me@original");
    let mut current = started.clone();
    current.name = "Renamed".into();
    assert!(same_request_route(&started, &current));
    current.endpoint = "https://replacement.test".into();
    assert!(!same_request_route(&started, &current));
    let mut current = started.clone();
    current.token.push_str("-rotated");
    assert!(!same_request_route(&started, &current));
    let mut current = started.clone();
    current.ssh.as_mut().unwrap().target = "me@replacement".into();
    assert!(!same_request_route(&started, &current));
    let mut current = started.clone();
    current.environment_id.push_str("-replacement");
    assert!(!same_request_route(&started, &current));
}
#[test]
fn conversation_machine_requests_do_not_use_a_stale_saved_ssh_endpoint() {
    let state = super::RemoteConnections::default();
    let mut machine = saved("mac", "me@192.168.1.20");
    machine.endpoint = "http://127.0.0.1:1".to_owned();
    let error = super::machine_rpc(
        &state,
        &machine,
        "devices.status",
        serde_json::json!({}),
        false,
    )
    .unwrap_err();
    assert!(error.contains("Automatic reconnect is off"), "{error}");
}
#[test]
fn transport_diagnostics_identify_timeouts_without_echoing_secrets() {
    let error = ureq::Error::from(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "https://user:secret@host/?token=secret",
    ));
    let ureq::Error::Transport(error) = error else {
        panic!("Expected transport error")
    };
    let message = super::rpc_transport_failure(&error, "devices.status");
    assert!(message.contains("RPC_TIMEOUT"));
    assert!(message.contains("devices.status"));
    assert!(!message.contains("secret"));
    for method in [
        "devices.preflight",
        "devices.preview",
        "devices.preview.status",
    ] {
        assert!(super::supported_remote_method(method));
    }
}
#[test]
fn interrupted_diagnostics_include_only_known_actions_and_no_credentials() {
    let params =
        serde_json::json!({"command":"read_text_file","path":"secret-path","token":"secret"});
    let operation = super::rpc_operation("workspace.run", &params);
    assert_eq!(operation, "workspace.run:read_text_file");
    assert_eq!(
        super::rpc_operation("workspace.run", &serde_json::json!({"command":"secret"})),
        "workspace.run"
    );
    let error = ureq::Error::from(std::io::Error::new(
        std::io::ErrorKind::ConnectionReset,
        "https://user:secret@host",
    ));
    let ureq::Error::Transport(error) = error else {
        panic!("Expected transport error")
    };
    let message = super::rpc_transport_failure(&error, &operation);
    assert!(message.contains("RPC_HOST_UNAVAILABLE"));
    assert!(message.contains("read_text_file"));
    assert!(!message.contains("secret"));
}
#[test]
fn shared_session_queue_methods_reach_the_host() {
    // Hosts advertise sessions.queue, so the native bridge must pass through
    // every operation used to restore, edit, claim and acknowledge the queue.
    for method in [
        "sessions.queue.get",
        "sessions.queue.change",
        "sessions.queue.claim",
        "sessions.queue.finish",
        "sessions.queue.lease",
        "sessions.queue.release",
        "sessions.runLease",
    ] {
        assert!(super::supported_remote_method(method), "{method}");
    }
    assert!(!super::supported_remote_method("sessions.queue"));
    assert!(!super::supported_remote_method("sessions.queue.delete"));
    assert!(!super::supported_remote_method("sessions.queue.clear"));
}

#[test]
fn crew_work_operations_are_forwarded() {
    for method in [
        "crews.start",
        "crews.pause",
        "crews.resume",
        "crews.stop",
        "crews.deleteRun",
    ] {
        assert!(super::supported_remote_method(method), "{method}");
    }
    assert!(!super::supported_remote_method("crews.deleteAll"));
}
#[test]
fn host_tools_methods_are_allowed_but_unknown_methods_are_not() {
    for method in [
        "mcp.tokens.create",
        "mcp.tokens.list",
        "mcp.tokens.revoke",
        "browser.claim",
        "browser.close",
        "browser.frame",
        "browser.input",
        "browser.open",
        "browser.resize",
        "browser.release",
        "browser.status",
        "browser.setup",
        "browser.annotation.start",
        "browser.annotation.hover",
        "browser.annotation.select",
        "browser.annotation.clear",
        "browser.annotation.read",
        "browser.annotation.cancel",
        "devServers.list",
        "automations.preview",
        "devServers.details",
        "devServers.start",
        "devServers.stop",
        "devServers.kill",
        "devServers.restart",
        "devServers.logs",
        "devServers.openExternal",
        "terminals.list",
        "terminals.create",
        "terminals.read",
        "terminals.write",
        "terminals.interrupt",
        "terminals.close",
        "runtimeLogs.read",
        "runtimeLogs.sources",
        "runtimeLogs.monitors.list",
        "runtimeLogs.monitors.start",
        "runtimeLogs.monitors.stop",
        "resources.read",
        "devices.status",
        "devices.setup",
        "devices.start",
        "devices.stop",
        "devices.list",
        "devices.boot",
        "devices.capture",
        "devices.action",
        "mobile.access.status",
        "mobile.access.enable",
        "mobile.access.disable",
        "tunnels.status",
        "tunnels.start",
        "tunnels.stop",
        "tunnels.credential",
        "mobile.pairing.create",
        "mobile.pairing.status",
        "mobile.pairing.cancel",
    ] {
        assert!(super::supported_remote_method(method), "{method}");
    }
    assert!(!super::supported_remote_method("browser.execute"));
    assert!(!super::supported_remote_method("mcp.tokens.update"));
    assert!(!super::supported_remote_method("mcp.tokens.read"));
    assert!(!super::supported_remote_method("removed.feature"));
    assert!(!super::supported_remote_method("devices.exec"));
    assert!(!super::supported_remote_method("terminals.exec"));
    assert!(!super::supported_remote_method("terminals.resize"));
    assert!(!super::supported_remote_method("removed.pr-feature"));
    assert!(!super::supported_remote_method("resources.delete"));
    assert!(!super::supported_remote_method("mobile.pairing.redeem"));
}

#[test]
fn sharing_never_serializes_writes_behind_a_read() {
    for method in [
        "mobile.access.enable",
        "mobile.pairing.create",
        "mobile.pairing.cancel",
    ] {
        assert!(!super::shareable_remote_read(
            method,
            &serde_json::json!({})
        ));
    }
    assert!(super::shareable_remote_read(
        "git.index",
        &serde_json::json!({"projectId":"p"})
    ));
    assert!(super::shareable_remote_read(
        "git.fileDiff",
        &serde_json::json!({"projectId":"p","path":"a.txt"})
    ));
    assert!(!super::shareable_remote_read(
        "git.action",
        &serde_json::json!({"action":"commit"})
    ));
    assert!(super::shareable_remote_read(
        "workspace.run",
        &serde_json::json!({"command":"stat_files"})
    ));
    assert!(!super::shareable_remote_read(
        "workspace.run",
        &serde_json::json!({"command":"git_commit"})
    ));
    assert!(!super::shareable_remote_read(
        "commands.dispatch",
        &serde_json::json!({"type":"cancel"})
    ));
}
use super::*;

#[test]
fn task_preparation_and_review_methods_preserve_read_and_mutation_boundaries() {
    assert!(supported_remote_method("tasks.preflight"));
    assert!(shareable_remote_read("tasks.preflight", &json!({})));
    for method in ["tasks.evaluation.save", "goals.final-review.recheck"] {
        assert!(supported_remote_method(method));
        assert!(!shareable_remote_read(method, &json!({})));
    }
    assert!(!supported_remote_method("tasks.preflight.install"));
    assert!(!supported_remote_method("tasks.evaluation.delete"));
}

#[test]
fn review_note_commands_are_supported_without_allowing_arbitrary_note_methods() {
    assert!(supported_remote_method("tasks.notes.read"));
    assert!(supported_remote_method("tasks.notes.resolve"));
    assert!(supported_remote_method("tasks.review.recheck"));
    assert!(!supported_remote_method("tasks.notes.delete"));
}

#[test]
fn sprint_methods_are_bounded_and_preserve_existing_request_routing() {
    for method in [
        "tasks.snapshotWithCursor",
        "tasks.events",
        "sprints.list",
        "sprints.get",
        "sprints.create",
        "sprints.update",
        "sprints.start",
        "sprints.complete",
        "sprints.archive",
        "sprints.plan",
        "sprints.report",
        "sprints.ingest",
        "sprints.goalContext",
    ] {
        assert!(supported_remote_method(method), "{method}");
        assert!(!shareable_remote_read(method, &json!({})), "{method}");
    }
    for method in ["tasks.events.delete", "sprints.delete", "sprints.execute"] {
        assert!(!supported_remote_method(method), "{method}");
    }
}

#[test]
fn assistant_and_desktop_owner_routes_are_finite_and_not_shared_reads() {
    for method in [
        "assistant.request",
        "desktop.request",
        "desktop.helper.request",
    ] {
        assert!(supported_remote_method(method), "{method}");
        assert!(!shareable_remote_read(method, &json!({})), "{method}");
    }
    for method in [
        "assistant.exec",
        "assistant.request.any",
        "desktop.control.request",
        "desktop.exec",
        "desktop.helper.install",
    ] {
        assert!(!supported_remote_method(method), "{method}");
    }
    assert_eq!(
        rpc_timeout("assistant.request", &json!({"op":"threads.send"})),
        std::time::Duration::from_secs(120)
    );
    assert_eq!(
        rpc_timeout("assistant.request", &json!({"op":"snapshot"})),
        DEFAULT_RPC_TIMEOUT
    );
}

#[test]
fn run_lease_acquire_outlasts_host_writer_retirement() {
    // The Host waits up to 20 s for retirement; the renderer gives up at 25 s.
    assert!(
        rpc_timeout("sessions.runLease", &json!({"action":"acquire"}))
            > std::time::Duration::from_secs(25)
    );
    assert_eq!(
        rpc_timeout("sessions.runLease", &json!({"action":"release"})),
        INTERACTIVE_LEASE_RPC_TIMEOUT
    );
}

#[test]
fn voice_rpc_methods_are_bounded_and_model_loading_has_time_to_finish() {
    use std::time::Duration;
    for method in [
        "voice.local.inspect",
        "voice.local.setup",
        "voice.local.setupStatus",
        "voice.local.start",
        "voice.local.transcribe",
        "voice.local.keepAlive",
        "voice.local.release",
        "voice.local.speak",
        "voice.local.speechNext",
        "voice.local.speechCancel",
        "voice.realtime.secret",
        "voice.tools.list",
        "voice.tools.call",
        "voice.cloud.status",
        "voice.cloud.setKey",
    ] {
        assert!(supported_remote_method(method), "{method}");
    }
    assert!(!supported_remote_method("voice.local.install"));
    assert!(!supported_remote_method("voice.local.exec"));
    assert!(!supported_remote_method("voice.tools.exec"));
    assert!(rpc_timeout("voice.tools.call", &json!({})) >= Duration::from_secs(250));
    assert!(rpc_timeout("assistant.builder.avatarGenerate", &json!({})) > Duration::from_secs(240));
    assert!(rpc_timeout("assistant.builder.interview", &json!({})) > Duration::from_secs(100));
    assert!(rpc_timeout("voice.local.start", &json!({})) >= Duration::from_secs(180));
    assert!(rpc_timeout("voice.local.inspect", &json!({})) >= Duration::from_secs(60));
    assert!(rpc_timeout("voice.local.transcribe", &json!({})) >= Duration::from_secs(40));
    assert_eq!(
        rpc_timeout("voice.local.speechNext", &json!({})),
        DEFAULT_RPC_TIMEOUT
    );
}

#[test]
fn git_actions_outlast_the_hosts_network_limit_and_others_keep_the_default() {
    use std::time::Duration;
    // Allow queue admission, safety reads, and both 120 s sync commands.
    let none = json!({});
    assert!(rpc_timeout("git.action", &none) >= Duration::from_secs(135));
    for command in [
        "git_push",
        "git_pull",
        "git_sync",
        "git_fetch",
        "git_commit",
        "git_stage_files",
        "git_unstage_files",
        "git_discard_files",
        "git_stage_contents",
        "git_checkout",
    ] {
        let run = json!({ "command": command });
        assert!(rpc_timeout("workspace.run", &run) >= Duration::from_secs(450));
    }
    for method in [
        "git.switch",
        "git.createBranch",
        "git.worktreeCreate",
        "workspaces.close",
        "workspaces.finish",
        "workspaces.cleanup.plan",
        "workspaces.cleanup.status",
        "workspaces.cleanup.apply",
    ] {
        assert!(rpc_timeout(method, &none) >= Duration::from_secs(450));
    }
    for command in ["git_file_diff", "git_pr_status", "git_blame"] {
        assert_eq!(
            rpc_timeout("workspace.run", &json!({"command": command})),
            DEFAULT_RPC_TIMEOUT
        );
    }
    for command in ["git_diff_index", "git_operation_status"] {
        assert_eq!(
            rpc_timeout("workspace.run", &json!({"command": command})),
            GIT_STATUS_READ_RPC_TIMEOUT
        );
    }
    let read = json!({ "command": "read_text_file" });
    assert_eq!(rpc_timeout("workspace.run", &read), DEFAULT_RPC_TIMEOUT);
    assert_eq!(rpc_timeout("workspace.run", &none), DEFAULT_RPC_TIMEOUT);
    assert_eq!(rpc_timeout("git.index", &none), DEFAULT_RPC_TIMEOUT);
    assert_eq!(
        rpc_timeout("environment.describe", &none),
        DEFAULT_RPC_TIMEOUT
    );
}

#[test]
fn model_catalog_outlasts_provider_discovery() {
    assert!(rpc_timeout("models.list", &json!({})) > std::time::Duration::from_secs(45));
}

#[test]
fn conversation_tools_outlast_host_setup_and_device_operations() {
    use std::time::Duration;
    let params = json!({});
    // npm + Chromium/hub/agent installation each have a 600 s deadline.
    for method in ["browser.setup", "devices.setup"] {
        assert!(rpc_timeout(method, &params) >= Duration::from_secs(1230));
    }
    // Hub readiness takes 30 s; boot can take 180 s plus device listing;
    // control can chain session list (30 s), open (60 s) and input (30 s).
    assert!(rpc_timeout("devices.start", &params) >= Duration::from_secs(60));
    assert!(rpc_timeout("devices.boot", &params) >= Duration::from_secs(240));
    assert!(rpc_timeout("devices.action", &params) >= Duration::from_secs(180));
    for method in [
        "devices.status",
        "devices.list",
        "devices.capture",
        "devices.stop",
        "resources.read",
        "devices.exec",
    ] {
        assert_eq!(
            rpc_timeout(method, &params),
            DEFAULT_RPC_TIMEOUT,
            "{method}"
        );
    }
    // The Host bounds a frame capture to 5 s; the pane must not wait 30 s.
    for method in ["browser.status", "browser.frame", "browser.input"] {
        assert_eq!(
            rpc_timeout(method, &params),
            INTERACTIVE_ACTION_RPC_TIMEOUT,
            "{method}"
        );
    }
}

#[test]
fn rpc_reuses_a_connection_without_reusing_request_credentials() {
    use std::io::{BufRead, BufReader};
    use std::{net::TcpListener, thread, time::Duration};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut authorizations = Vec::new();
        for _ in 0..2 {
            let mut size = 0;
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if lower.starts_with("content-length:") {
                    size = line
                        .split(':')
                        .nth(1)
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                }
                if lower.starts_with("authorization:") {
                    authorizations.push(line.trim().to_string());
                }
            }
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            let body = r#"{"result":{"ok":true}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        }
        authorizations
    });
    assert_eq!(
        rpc(
            &url,
            "first",
            Some("env"),
            "environment.describe",
            json!({})
        )
        .unwrap(),
        json!({"ok": true})
    );
    assert_eq!(
        rpc(
            &url,
            "second",
            Some("env"),
            "environment.describe",
            json!({})
        )
        .unwrap(),
        json!({"ok": true})
    );
    let headers = server.join().unwrap();
    assert!(headers[0].ends_with("Bearer first"));
    assert!(headers[1].ends_with("Bearer second"));
}
#[test]
fn rpc_body_read_failures_retain_transport_diagnostics() {
    use std::io::{BufRead, BufReader};
    use std::{net::TcpListener, thread, time::Duration};

    for (method, stall, expected) in [
        ("environment.describe", false, "RPC_HOST_UNAVAILABLE"),
        ("environment.describe", true, "RPC_TIMEOUT"),
        ("devices.action", false, "RPC_DEVICE_OUTCOME_UNKNOWN"),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut size = 0;
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("content-length:") {
                    size = line.split(':').nth(1).unwrap().trim().parse().unwrap();
                }
            }
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            // A partial response after valid headers must retain the same
            // transport classification as a failure before those headers.
            write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: 128\r\nConnection: close\r\n\r\n{{\"result\":\"response-secret"
                )
                .unwrap();
            stream.flush().unwrap();
            if stall {
                thread::sleep(Duration::from_millis(500));
            }
        });
        let error = super::rpc_timed(
            &endpoint,
            "request-secret",
            Some("env"),
            method,
            json!({}),
            Duration::from_millis(250),
        )
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains(expected), "{method}: {error}");
        assert!(error.contains(method), "{error}");
        assert!(!error.contains("secret"), "{error}");
        assert_ne!(error, super::CONNECTION_REFUSED);
    }
}

#[test]
fn a_slow_host_does_not_look_like_a_dead_tunnel() {
    use std::{net::TcpListener, thread, time::Duration};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (_stream, _) = listener.accept().unwrap();
        thread::sleep(Duration::from_millis(200));
    });
    let error = ureq::get(&url)
        .timeout(Duration::from_millis(50))
        .call()
        .unwrap_err();
    let ureq::Error::Transport(error) = error else {
        panic!("Expected a timeout")
    };
    assert!(!connection_refused(&error));
    server.join().unwrap();
    // A freed ephemeral port can be claimed by another parallel fixture.
    // Exercise ureq's actual wrapped I/O source without that port race.
    let error = ureq::Error::from(std::io::Error::from(std::io::ErrorKind::ConnectionRefused));
    let ureq::Error::Transport(error) = error else {
        panic!("Expected a refused connection")
    };
    assert!(connection_refused(&error));
}

#[test]
fn session_managed_owner_rpc_allowlist_excludes_trusted_native_protocol() {
    for method in [
        "modelRouting.get",
        "modelRouting.resolve",
        "modelRouting.save",
        "modelRouting.status",
        "workspaces.prepare",
        "workspaces.get",
        "workspaces.list",
        "workspaces.resume",
        "workspaces.finish",
        "workspaces.close",
        "projects.workspacePolicy.get",
        "projects.workspacePolicy.update",
        "workspaces.featureClaims.list",
        "workspaces.featureClaims.acquire",
        "workspaces.featureClaims.release",
        "sessions.rewind.plan",
        "sessions.rewind.apply",
        "sessions.rewind.undo",
        "workspaces.delivery.review",
        "workspaces.delivery.merge",
        "workspaces.delivery.publish",
        "workspaces.cleanup.plan",
        "workspaces.cleanup.apply",
        "workspaces.cleanup.status",
        "workspaces.storage.status",
        "workspaces.pin",
    ] {
        assert!(
            supported_remote_method(method),
            "missing managed owner RPC {method}"
        );
    }
    for method in [
        "native.turn.begin",
        "native.turn.end",
        "native.activity.start",
        "native.activity.end",
        "native.buffers.update",
        "native.buffers.heartbeat",
        "native.buffers.retire",
        "native.buffers.reconcile",
        "native.buffers.recovery.list",
        "native.buffers.recovery.read",
        "native.buffers.recovery.status",
        "native.rewind.plan",
        "native.rewind.prepare",
        "native.rewind.apply",
        "native.rewind.status",
        "native.rewind.lookup",
        "native.rewind.cancelPreparation",
        "native.rewind.ack",
    ] {
        assert!(
            !supported_remote_method(method),
            "renderer must not call trusted transport {method}"
        );
    }
}

#[test]
fn edit_from_here_rpc_methods_preserve_authenticated_transport_and_write_isolation() {
    use std::io::{BufRead, BufReader};
    use std::{net::TcpListener, thread, time::Duration};
    let requests = [
        ("workspaces.exactGitRewind.get", json!({})),
        ("workspaces.exactGitRewind.set", json!({"enabled": false})),
        (
            "sessions.files.revertPlan",
            json!({"sessionId": "session", "userBlockId": "message"}),
        ),
        (
            "sessions.files.revert",
            json!({"sessionId": "session", "userBlockId": "message", "planToken": "reviewed"}),
        ),
    ];
    for (method, params) in &requests {
        assert!(supported_remote_method(method), "{method}");
        // Neither writes nor revision-sensitive plans share an in-flight request.
        assert!(!shareable_remote_read(method, params), "{method}");
    }
    for method in [
        "workspaces.exactGitRewind.reset",
        "sessions.files.delete",
        "sessions.files.revertAll",
        "sessions.files.revertplan",
    ] {
        assert!(!supported_remote_method(method), "{method}");
    }
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let expected = requests.clone();
    let server = thread::spawn(move || {
        for (method, params) in expected {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut size = 0;
            let mut authorization = String::new();
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if lower.starts_with("content-length:") {
                    size = line
                        .split(':')
                        .nth(1)
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                }
                if lower.starts_with("authorization:") {
                    authorization = line;
                }
            }
            assert!(authorization.trim().ends_with("Bearer paired-owner"));
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            let payload: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                payload,
                json!({"version": 1, "environmentId": "execution-host", "method": method, "params": params})
            );
            let body = json!({"result": {"method": method}}).to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        }
    });
    for (method, params) in requests {
        assert_eq!(
            rpc(
                &endpoint,
                "paired-owner",
                Some("execution-host"),
                method,
                params
            )
            .unwrap(),
            json!({"method": method})
        );
    }
    server.join().unwrap();
}

#[test]
fn desktop_social_client_methods_cross_the_native_allowlist_without_privileged_wildcards() {
    // This is the actual renderer client, not a second manually maintained RPC catalog.
    let client = include_str!("../../../src/features/social/model/socialClient.ts");
    let methods: Vec<_> = client
        .split('"')
        .enumerate()
        .filter(|(index, _)| index % 2 == 1)
        .map(|(_, value)| value)
        .filter(|value| {
            value.starts_with("social.")
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
        })
        .collect();
    assert!(
        methods.len() >= 20,
        "the renderer RPC extraction must not pass vacuously"
    );
    for method in methods {
        assert!(
            supported_remote_method(method),
            "renderer RPC blocked by native bridge: {method}"
        );
    }
    for method in [
        "social.tools.call",
        "social.native.register",
        "social.native.authority",
        "social.browser.cookies",
        "social.browser.profile.delete",
        "social.browser.registration.force",
        "social.browser.registration.submit.admin",
    ] {
        assert!(
            !supported_remote_method(method),
            "unreviewed privilege or wildcard: {method}"
        );
    }
}

#[test]
fn desktop_forwards_supported_host_operations() {
    for method in [
        "projects.createDirectory",
        "git.branches",
        "git.switch",
        "git.createBranch",
        "git.worktrees",
        "git.worktreeCreate",
        "attachments.upload",
        "attachments.read",
        "attachments.claim",
        "attachments.claims",
        "attachments.release",
        "sync.pull",
        "sync.push",
        "social.browser.availability",
        "social.browser.begin",
        "social.browser.status",
        "social.token.connect",
        "social.tiktok.creator",
    ] {
        assert!(supported_remote_method(method), "{method}");
    }
    assert!(!supported_remote_method("git.arbitrary"));
    assert!(!supported_remote_method("social.browser.cookies"));
    for method in ["attachments.claim", "attachments.release"] {
        assert!(!super::shareable_remote_read(
            method,
            &serde_json::json!({})
        ));
    }
}
#[test]
fn endpoints_require_an_encrypted_route_and_no_embedded_secrets() {
    assert_eq!(
        endpoint("http://127.0.0.1:3774/").unwrap(),
        "http://127.0.0.1:3774"
    );
    assert!(endpoint("http://[::1]:3774").is_ok());
    assert!(endpoint("https://host.example").is_ok());
    for url in [
        "http://192.168.1.5:3774",
        "file:///tmp/socket",
        "https://user:secret@host.example",
        "https://host.example/rpc",
        "https://host.example?token=secret",
        "https://host.example#secret",
    ] {
        assert!(endpoint(url).is_err(), "{url}");
    }
}
#[test]
fn re_adding_a_reinstalled_host_replaces_its_dead_entry() {
    let mut old = saved("old-id", "me@192.168.1.20");
    old.environment_id = "env-old".into();
    let other = saved("other", "me@192.168.1.30");
    let mut new = saved("new-id", "ME@192.168.1.20");
    new.environment_id = "env-new".into();
    let machines = vec![old, other];
    assert_eq!(
        replaced_machine(&machines, &new).map(|m| m.id.as_str()),
        Some("old-id")
    );

    // Reached through its other address, it is still the same machine.
    let mut by_alternate = saved("new-id", "me@100.64.0.20");
    by_alternate.environment_id = "env-new".into();
    let mut known = saved("old-id", "me@192.168.1.20");
    known.ssh.as_mut().unwrap().alternate = Some("me@100.64.0.20".into());
    assert!(replaced_machine(&[known], &by_alternate).is_some());

    // A different address or SSH port is a different machine.
    let mut elsewhere = saved("new-id", "me@192.168.1.99");
    elsewhere.environment_id = "env-new".into();
    assert!(replaced_machine(&machines, &elsewhere).is_none());
    let mut other_port = new.clone();
    other_port.ssh.as_mut().unwrap().port = Some(2222);
    assert!(replaced_machine(&machines, &other_port).is_none());
}

#[test]
fn retries_on_another_port_only_for_unreachable_hosts() {
    assert!(port_may_have_moved(
        "Machine is unreachable. Check the host and SSH tunnel, then reconnect."
    ));
    assert!(port_may_have_moved(
        "The host request did not complete. Retry to confirm its result."
    ));
    assert!(!port_may_have_moved("Host rejected request: Unauthorized"));
    assert!(!port_may_have_moved(
        "Host identity changed: this address answers as a different machine."
    ));
    assert!(!port_may_have_moved(
        "This host uses an incompatible protocol version"
    ));
}

#[test]
fn reads_the_port_from_connection_info() {
    assert_eq!(
        reported_port("Starting\n{\"port\":3776,\"pid\":12}\n"),
        Some(3776)
    );
    assert_eq!(reported_port("{\"port\":0}"), None);
    assert_eq!(reported_port("not json"), None);
    assert_eq!(reported_port(""), None);
}

#[test]
fn native_recovery_rejects_identical_repair_and_saved_route_replacement() {
    let temporary = std::env::temp_dir().canonicalize().unwrap();
    let root = temporary.join(format!("bycoda-recovery-route-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("connections.json");
    let state = RemoteConnections::default();
    let machine = StoredMachine {
        id: "local-recovery".into(),
        name: "Local".into(),
        endpoint: "http://127.0.0.1:3774".into(),
        environment_id: "env".into(),
        token: "fixture-owner".into(),
        ssh: None,
        local_host: true,
    };
    write(&path, std::slice::from_ref(&machine)).unwrap();
    let transport = NativeWorkspaceTransport {
        workspace: None,
        machine: machine.clone(),
        recovery: Some(RecoveryRoute {
            revision: state.recovery_routes.capture().unwrap(),
            selected_endpoint: machine.endpoint.clone(),
        }),
    };
    transport.assert_recovery_saved(&state, &path).unwrap();
    let mut changed = machine.clone();
    changed.token = "replaced-fixture-owner".into();
    write(&path, &[changed]).unwrap();
    assert!(transport.assert_recovery_saved(&state, &path).is_err());
    write(&path, std::slice::from_ref(&machine)).unwrap();
    transport.assert_recovery_saved(&state, &path).unwrap();
    {
        let _guard = state.store.lock().unwrap();
        disconnect_saved_machine(&state, &path, &machine.id).unwrap();
        write(&path, std::slice::from_ref(&machine)).unwrap();
    }
    assert!(transport.assert_recovery_saved(&state, &path).is_err());
    let fresh = NativeWorkspaceTransport {
        workspace: None,
        machine: machine.clone(),
        recovery: Some(RecoveryRoute {
            revision: state.recovery_routes.capture().unwrap(),
            selected_endpoint: machine.endpoint.clone(),
        }),
    };
    fresh.assert_recovery_saved(&state, &path).unwrap();
    state.recovery_routes.close();
    assert!(fresh.assert_recovery_saved(&state, &path).is_err());
    assert_eq!(
        root.canonicalize().unwrap().parent(),
        Some(temporary.as_path())
    );
    assert!(!std::fs::symlink_metadata(&root)
        .unwrap()
        .file_type()
        .is_symlink());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_recovery_retires_an_actual_in_flight_http_read_before_disclosure() {
    use std::io::{BufRead, BufReader};
    use std::{net::TcpListener, sync::mpsc, thread, time::Duration};
    let temporary = std::env::temp_dir().canonicalize().unwrap();
    let root = temporary.join(format!("bycoda-recovery-inflight-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("connections.json");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let state = Arc::new(RemoteConnections::default());
    let machine = StoredMachine {
        id: "local-recovery".into(),
        name: "Local".into(),
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        environment_id: "env".into(),
        token: "fixture-owner".into(),
        ssh: None,
        local_host: true,
    };
    write(&path, std::slice::from_ref(&machine)).unwrap();
    let transport = NativeWorkspaceTransport {
        workspace: None,
        machine: machine.clone(),
        recovery: Some(RecoveryRoute {
            revision: state.recovery_routes.capture().unwrap(),
            selected_endpoint: machine.endpoint.clone(),
        }),
    };
    let (seen_tx, seen_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut size = 0;
        loop {
            let mut line = String::new();
            assert!(reader.read_line(&mut line).unwrap() > 0);
            if line == "\r\n" {
                break;
            }
            if line.to_ascii_lowercase().starts_with("content-length:") {
                size = line
                    .split(':')
                    .nth(1)
                    .unwrap()
                    .trim()
                    .parse::<usize>()
                    .unwrap();
            }
        }
        let mut body = vec![0; size];
        reader.read_exact(&mut body).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap()["method"],
            "native.buffers.recovery.read"
        );
        seen_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let body = r#"{"result":{"oldRouteSecret":"must-not-return"}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        stream.flush().unwrap();
    });
    let calling = {
        let state = state.clone();
        let path = path.clone();
        thread::spawn(move || {
            transport.call_recovery_saved(
                &state,
                &path,
                "native.buffers.recovery.read",
                json!({"reportId":"fixture"}),
            )
        })
    };
    seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    {
        let _guard = state.store.lock().unwrap();
        disconnect_saved_machine(&state, &path, &machine.id).unwrap();
        write(&path, std::slice::from_ref(&machine)).unwrap();
    }
    release_tx.send(()).unwrap();
    let error = calling.join().unwrap().unwrap_err();
    assert!(!error.contains("must-not-return"));
    assert!(error.contains("retired"));
    server.join().unwrap();
    assert_eq!(
        root.canonicalize().unwrap().parent(),
        Some(temporary.as_path())
    );
    assert!(!std::fs::symlink_metadata(&root)
        .unwrap()
        .file_type()
        .is_symlink());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn only_automatic_loopback_links_count_as_local_sync() {
    let local = |endpoint: &str| StoredMachine {
        id: endpoint.into(),
        name: "This computer (local sync)".into(),
        endpoint: endpoint.into(),
        environment_id: "env".into(),
        token: "secret-token".into(),
        ssh: None,
        local_host: false,
    };
    let name = "This computer (local sync)";
    assert!(is_local_sync(&local("http://127.0.0.1:3774"), name));
    assert!(is_local_sync(&local("http://localhost:3776"), name));
    assert!(!is_local_sync(&local("http://192.168.1.5:3776"), name));
    assert!(!is_local_sync(&saved("mac", "me@192.168.1.5"), name));
    let mut renamed = local("http://127.0.0.1:3774");
    renamed.name = "Build box".into();
    assert!(!is_local_sync(&renamed, name));
    mark_local_host_record(&mut renamed, "http://127.0.0.1:3774").unwrap();
    assert!(is_local_sync(&renamed, name));
    assert_eq!(renamed.name, "Build box");
    let stored = serde_json::to_value(&renamed).unwrap();
    assert_eq!(stored["localHost"], true);
    let restored: StoredMachine = serde_json::from_value(stored).unwrap();
    assert!(is_local_sync(&restored, name));
    assert_eq!(
        serde_json::to_value(restored.public()).unwrap()["localHost"],
        true
    );
}

#[test]
fn retained_recovery_requires_the_native_selected_bootstrap_port_and_environment() {
    let mut machine = NativeWorkspaceTransport::for_test("http://127.0.0.1:3774".into()).machine;
    assert!(recovery_machine_matches(
        &machine,
        "http://127.0.0.1:3774",
        "fixture-env"
    ));
    assert!(!recovery_machine_matches(
        &machine,
        "http://127.0.0.1:3776",
        "fixture-env"
    ));
    assert!(!recovery_machine_matches(
        &machine,
        "http://127.0.0.1:3774",
        "other-profile-host"
    ));
    machine.endpoint = "http://localhost:3774".into();
    assert!(recovery_machine_matches(
        &machine,
        "http://127.0.0.1:3774",
        "fixture-env"
    ));
    machine.endpoint = "http://192.168.1.5:3774".into();
    assert!(!recovery_machine_matches(
        &machine,
        "http://127.0.0.1:3774",
        "fixture-env"
    ));
    machine.endpoint = "http://127.0.0.1:3774".into();
    machine.ssh = saved("fixture", "me@other-machine").ssh;
    assert!(!recovery_machine_matches(
        &machine,
        "http://127.0.0.1:3774",
        "fixture-env"
    ));
}

#[test]
fn marking_local_host_rejects_ssh_and_other_endpoints() {
    let mut tunnel = saved("tunnel", "me@server");
    tunnel.endpoint = "http://127.0.0.1:3774".into();
    tunnel.name = "This computer (local sync)".into();
    assert!(mark_local_host_record(&mut tunnel, "http://127.0.0.1:3774").is_err());
    tunnel.local_host = true;
    assert!(!is_local_sync(&tunnel, "This computer (local sync)"));

    let mut direct = saved("direct", "me@server");
    direct.ssh = None;
    direct.endpoint = "http://127.0.0.1:3775".into();
    assert!(mark_local_host_record(&mut direct, "http://127.0.0.1:3774").is_err());
    assert!(!direct.local_host);
    direct.endpoint = "https://host.example".into();
    assert!(mark_local_host_record(&mut direct, "https://host.example").is_err());
    assert!(!direct.local_host);
}

#[test]
fn older_connection_stores_default_to_no_local_host_marker() {
    let machine: StoredMachine = serde_json::from_value(json!({
        "id": "legacy", "name": "This computer (local sync)",
        "endpoint": "http://127.0.0.1:3774", "environmentId": "env",
        "token": "secret-token", "ssh": null
    }))
    .unwrap();
    assert!(!machine.local_host);
    assert!(is_local_sync(&machine, "This computer (local sync)"));
    assert!(serde_json::to_value(machine.public())
        .unwrap()
        .get("localHost")
        .is_none());
}

fn saved(id: &str, target: &str) -> StoredMachine {
    StoredMachine {
        id: id.into(),
        name: "Home Mac".into(),
        endpoint: format!("ssh://{target}"),
        environment_id: format!("env-{id}"),
        token: "secret-token".into(),
        local_host: false,
        ssh: Some(SshTarget {
            target: target.into(),
            port: None,
            remote_port: 3999,
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        }),
    }
}

#[test]
fn editing_the_address_keeps_identity_and_credentials() {
    let mut machines = vec![saved("a", "me@192.168.1.5"), saved("b", "me@other")];
    machines[0].ssh.as_mut().unwrap().identity_file = Some("C:/keys/mac".into());
    let edited = apply_edit(
        &mut machines,
        "a",
        " Mac ",
        "me@new.local".into(),
        Some(2222),
        Some("me@100.64.0.5".into()),
        None,
    )
    .unwrap();
    assert_eq!(edited.id, "a");
    assert_eq!(edited.environment_id, "env-a");
    assert_eq!(edited.token, "secret-token");
    assert_eq!(edited.name, "Mac");
    assert_eq!(edited.endpoint, "ssh://me@new.local");
    let ssh = edited.ssh.unwrap();
    assert_eq!(ssh.identity_file.as_deref(), Some("C:/keys/mac"));
    assert_eq!(
        (ssh.target.as_str(), ssh.port, ssh.remote_port),
        ("me@new.local", Some(2222), 3999)
    );
    assert_eq!(ssh.alternate.as_deref(), Some("me@100.64.0.5"));
    // Only the edited machine changed, and a blank name keeps the old one.
    assert_eq!(machines[1].ssh.as_ref().unwrap().target, "me@other");
    let again = apply_edit(
        &mut machines,
        "a",
        "  ",
        "me@new.local".into(),
        Some(2222),
        None,
        None,
    )
    .unwrap();
    assert_eq!(again.name, "Mac");
}

#[test]
fn adding_a_known_machine_from_another_address_keeps_both() {
    let old = StoredMachine {
        name: "llm".into(),
        ..saved("a", "me@192.168.1.20")
    };
    let mut added = StoredMachine {
        name: "Alex's MacBook Pro".into(),
        token: "new-token".into(),
        ..saved("fresh-id", "me@100.64.0.20")
    };
    merge_known_machine(&mut added, &old, true, false);
    assert_eq!(added.id, "a");
    assert_eq!(added.name, "llm");
    assert_eq!(added.token, "new-token");
    assert_eq!(added.endpoint, "ssh://me@192.168.1.20");
    let ssh = added.ssh.unwrap();
    assert_eq!(ssh.target, "me@192.168.1.20");
    assert_eq!(ssh.alternate.as_deref(), Some("me@100.64.0.20"));
}

#[test]
fn adding_a_known_machine_again_keeps_its_other_address_and_a_new_name() {
    let mut old = saved("a", "me@home");
    old.ssh.as_mut().unwrap().alternate = Some("me@tailnet".into());
    let mut added = StoredMachine {
        name: "Studio".into(),
        ..saved("fresh-id", "me@home")
    };
    merge_known_machine(&mut added, &old, true, true);
    assert_eq!(added.name, "Studio");
    assert_eq!(added.ssh.unwrap().alternate.as_deref(), Some("me@tailnet"));
}

#[test]
fn reconnecting_a_machine_keeps_its_identity_and_latest_saved_key() {
    let mut old = saved("a", "me@home");
    old.ssh.as_mut().unwrap().identity_file = Some("C:/keys/latest".into());
    let mut again = saved("fresh-id", "me@moved");
    again.ssh.as_mut().unwrap().identity_file = Some("C:/keys/outdated".into());
    merge_known_machine(&mut again, &old, false, false);
    assert_eq!(again.id, "a");
    let ssh = again.ssh.unwrap();
    assert_eq!(ssh.target, "me@moved");
    assert_eq!(ssh.identity_file.as_deref(), Some("C:/keys/latest"));
}

#[test]
fn adding_with_an_explicit_alternate_keeps_it() {
    let old = saved("a", "me@home");
    let mut added = saved("fresh-id", "me@home");
    added.ssh.as_mut().unwrap().alternate = Some("me@tailnet".into());
    merge_known_machine(&mut added, &old, true, false);
    assert_eq!(added.id, "a");
    assert_eq!(added.ssh.unwrap().alternate.as_deref(), Some("me@tailnet"));
}

#[test]
fn only_a_saved_ssh_machine_can_be_edited() {
    let mut machines = vec![saved("a", "me@home")];
    machines[0].ssh = None;
    assert!(apply_edit(&mut machines, "a", "", "me@x".into(), None, None, None).is_err());
    assert!(apply_edit(
        &mut machines,
        "missing",
        "",
        "me@x".into(),
        None,
        None,
        None
    )
    .is_err());
}

#[test]
fn editing_host_port_keeps_ssh_port_identity_and_credentials() {
    let mut machines = vec![saved("a", "me@home")];
    let edited = apply_edit(
        &mut machines,
        "a",
        "",
        "me@home".into(),
        Some(2222),
        None,
        Some(3776),
    )
    .unwrap();
    assert_eq!(edited.ssh.as_ref().unwrap().remote_port, 3776);
    assert_eq!(edited.ssh.as_ref().unwrap().port, Some(2222));
    assert_eq!(edited.id, "a");
    assert_eq!(edited.environment_id, "env-a");
    assert_eq!(edited.token, "secret-token");
    let unchanged = apply_edit(
        &mut machines,
        "a",
        "Renamed",
        "me@home".into(),
        Some(2222),
        None,
        None,
    )
    .unwrap();
    assert_eq!(unchanged.ssh.as_ref().unwrap().remote_port, 3776);
    assert!(apply_edit(
        &mut machines,
        "a",
        "",
        "me@home".into(),
        None,
        None,
        Some(0)
    )
    .is_err());
    assert_eq!(machines[0].ssh.as_ref().unwrap().remote_port, 3776);
}

#[test]
fn legacy_host_writes_preserve_ssh_only_records_and_organization() {
    let path = std::env::temp_dir().join(format!("bycoda-inventory-{}.json", uuid::Uuid::new_v4()));
    let ssh = json!({"kind":"ssh","id":"ssh-only","name":"Standalone","sshEndpoint":{"host":"example.invalid","port":22},"metadata":{"tags":["a"],"favorite":true}});
    let mut host = serde_json::to_value(saved("host", "owner@host")).unwrap();
    host["metadata"] =
        json!({"group":"Work","tags":[],"favorite":false,"forwards":[{"id":"rule"}]});
    write_store_values(&path, &[host, ssh.clone()]).unwrap();
    let mut hosts = read(&path).unwrap();
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].id, "host");
    hosts[0].name = "Renamed".into();
    write(&path, &hosts).unwrap();
    let records = read_store_values(&path).unwrap();
    assert!(records.contains(&ssh));
    let host = records
        .iter()
        .find(|record| record["id"] == "host")
        .unwrap();
    assert_eq!(host["metadata"]["group"], "Work");
    assert_eq!(host["metadata"]["forwards"][0]["id"], "rule");
    assert_eq!(host["environmentId"], "env-host");
    assert_eq!(host["token"], "secret-token");
    write(&path, &[]).unwrap();
    assert_eq!(read_store_values(&path).unwrap(), vec![ssh]);
    let _ = std::fs::remove_file(path);
}

#[test]
fn an_edited_store_round_trips_with_the_token_intact() {
    let path = std::env::temp_dir().join(format!("bycoda-edit-{}.json", uuid::Uuid::new_v4()));
    let mut machines = vec![saved("a", "me@192.168.1.5")];
    write(&path, &machines).unwrap();
    apply_edit(
        &mut machines,
        "a",
        "",
        "me@new.local".into(),
        None,
        None,
        None,
    )
    .unwrap();
    write(&path, &machines).unwrap();
    let loaded = read(&path).unwrap();
    let _ = std::fs::remove_file(&path);
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].token, "secret-token");
    assert_eq!(loaded[0].ssh.as_ref().unwrap().target, "me@new.local");
}

#[test]
fn public_machine_metadata_never_contains_the_token() {
    let stored = StoredMachine {
        id: "id".into(),
        name: "server".into(),
        endpoint: "https://host.example".into(),
        environment_id: "env".into(),
        token: "secret".into(),
        ssh: None,
        local_host: false,
    };
    let value = serde_json::to_string(&stored.public()).unwrap();
    assert!(!value.contains("secret"));
    assert!(!value.contains("token"));
}

#[test]
fn host_refusal_over_ws_settles_like_the_http_refusal() {
    let mut refusal = WsFailure::local("RPC_WS_REMOTE", "LEASE_HELD: busy");
    refusal.uncertain = false;
    assert_eq!(
        super::native_ws_failure(refusal),
        "Host rejected request: LEASE_HELD: busy"
    );
}

#[test]
fn uncertain_host_error_over_ws_keeps_unknown_outcome_text() {
    let mut unknown = WsFailure::local(
        "RPC_WS_REMOTE",
        "The Host operation could not be confirmed.",
    );
    unknown.uncertain = true;
    let text = super::native_ws_failure(unknown);
    assert!(text.starts_with("RPC_WS_REMOTE: "), "{text}");
    assert!(!text.contains(".."), "{text}");
    assert!(!text.starts_with("Host rejected request:"), "{text}");
}

#[test]
fn non_refusal_ws_failures_keep_their_code_text() {
    let interrupted = WsFailure::local("RPC_WS_INTERRUPTED", "Connection lost");
    assert_eq!(
        super::native_ws_failure(interrupted),
        "RPC_WS_INTERRUPTED: Connection lost"
    );
}

#[test]
fn http_fallback_is_allowed_only_when_the_request_was_not_sent() {
    let not_sent = |code: &str| WsFailure::local(code, "fixture");
    for code in ["RPC_WS_DEADLINE", "RPC_WS_UNAVAILABLE", "RPC_WS_BLOCKED"] {
        assert!(
            super::ws_failure_allows_http_fallback(&not_sent(code)),
            "{code}"
        );
    }
    assert!(super::ws_failure_allows_http_fallback(
        &WsFailure::unsupported()
    ));

    // A possibly-sent mutating request is uncertain and must never be replayed.
    for code in ["RPC_WS_DEADLINE", "RPC_WS_UNAVAILABLE", "RPC_WS_BLOCKED"] {
        let mut sent = not_sent(code);
        sent.uncertain = true;
        assert!(!super::ws_failure_allows_http_fallback(&sent), "{code}");
    }
    // A definitive Host answer or a lost connection is not a transport miss.
    for code in [
        "RPC_WS_REMOTE",
        "RPC_WS_INTERRUPTED",
        "RPC_WS_SCHEMA",
        "RPC_WS_OVERLOAD",
    ] {
        assert!(
            !super::ws_failure_allows_http_fallback(&not_sent(code)),
            "{code}"
        );
    }
}
