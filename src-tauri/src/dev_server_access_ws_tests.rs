use super::super::native_gateway::tests::{endpoint, target, Fixture};
use super::*;
use crate::host_ws::tests::{accept, hello, next, result, Server};

#[test]
fn actual_browser_relay_streams_bodies_larger_than_a_frame_on_one_private_ws_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let browser_address = listener.local_addr().unwrap();
    let request_body = (0..CHUNK * 4 + 37)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    let response_body = (0..CHUNK * 4 + 53)
        .map(|index| (250 - index % 251) as u8)
        .collect::<Vec<_>>();
    let expected_request = request_body.clone();
    let expected_response = response_body.clone();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let saved = observed.clone();
    let mut response = format!("HTTP/1.1 200 OK\r\nLocation: http://127.0.0.1:5173/next\r\nX-Original: retained: value\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", response_body.len()).into_bytes();
    response.extend_from_slice(&response_body);
    let server = Server::spawn(move |listener| async move {
        let mut socket = accept(&listener).await;
        hello(
            &mut socket,
            &[
                "devServers.bridgeCheck",
                "devServers.bridgeOpen",
                "devServers.bridgeWrite",
                "devServers.bridgeRead",
                "devServers.bridgeClose",
            ],
            "host.1",
        )
        .await;
        let mut uploaded = Vec::new();
        let mut cursor = 0;
        let mut writes = 0;
        loop {
            let request = next(&mut socket).await;
            assert_eq!(request["params"]["projectId"], "project");
            match request["method"].as_str().unwrap() {
                "devServers.bridgeCheck" => {
                    assert_eq!(request["params"], target());
                    result(&mut socket, &request, endpoint()).await;
                }
                "devServers.bridgeOpen" => {
                    assert_eq!(request["params"], target());
                    result(&mut socket, &request, json!({"streamId":"stream"})).await;
                }
                "devServers.bridgeWrite" => {
                    assert_eq!(request["params"]["streamId"], "stream");
                    let data = STANDARD
                        .decode(request["params"]["data"].as_str().unwrap())
                        .unwrap();
                    assert!(data.len() <= CHUNK);
                    uploaded.extend_from_slice(&data);
                    writes += 1;
                    result(&mut socket, &request, json!({"written":data.len()})).await;
                }
                "devServers.bridgeRead" => {
                    assert_eq!(request["params"]["streamId"], "stream");
                    let complete = uploaded
                        .windows(4)
                        .position(|part| part == b"\r\n\r\n")
                        .is_some_and(|end| uploaded.len() == end + 4 + expected_request.len());
                    if !complete {
                        result(&mut socket, &request, json!({"data":"","ended":false})).await;
                        continue;
                    }
                    // Deliberately split the status/header across three guarded
                    // replies before sending raw response body chunks.
                    let limit = if cursor == 0 {
                        7
                    } else if cursor == 7 {
                        17
                    } else {
                        CHUNK
                    };
                    let end = (cursor + limit).min(response.len());
                    let data = STANDARD.encode(&response[cursor..end]);
                    cursor = end;
                    result(
                        &mut socket,
                        &request,
                        json!({"data":data,"ended":cursor == response.len()}),
                    )
                    .await;
                }
                "devServers.bridgeClose" => {
                    assert!(writes >= 5);
                    assert_eq!(cursor, response.len());
                    // Publish the upload before replying: the relay returns as
                    // soon as this reply arrives and the test then reads it.
                    *saved.lock().unwrap() = uploaded;
                    result(&mut socket, &request, json!({"closed":true})).await;
                    break;
                }
                method => panic!("unexpected private method {method}"),
            }
        }
    });
    let fixture = Fixture::new(&server.endpoint);
    let channel = fixture.channel(true);
    channel.request("devServers.bridgeCheck", target()).unwrap();
    let access = Access {
        channel: channel.clone(),
        params: target(),
        target_origin: "http://127.0.0.1:5173".into(),
    };
    let gateway = Arc::new(Gateway {
        port: browser_address.port(),
        alive: AtomicBool::new(true),
        active: AtomicUsize::new(1),
        touched: Mutex::new(Instant::now()),
        channel: Arc::downgrade(&channel),
    });
    let relay = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        connection(socket, access, gateway);
    });
    let mut browser = TcpStream::connect(browser_address).unwrap();
    browser
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    browser
        .set_write_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let header = format!("POST /nested?kept=1 HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: http://127.0.0.1:{}\r\nReferer: http://127.0.0.1:{}/before\r\nX-Original: unchanged: value\r\nAuthorization: app-local-only\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n", browser_address.port(), browser_address.port(), browser_address.port(), request_body.len());
    browser.write_all(header.as_bytes()).unwrap();
    browser.write_all(&request_body).unwrap();
    let mut received = Vec::new();
    browser.read_to_end(&mut received).unwrap();
    relay.join().unwrap();
    let end = received
        .windows(4)
        .position(|part| part == b"\r\n\r\n")
        .unwrap();
    let header = std::str::from_utf8(&received[..end]).unwrap();
    assert!(header.starts_with("HTTP/1.1 200 OK"));
    assert!(header.contains(&format!(
        "Location: http://127.0.0.1:{}/next",
        browser_address.port()
    )));
    assert!(header.contains("X-Original: retained: value"));
    assert_eq!(&received[end + 4..], expected_response);
    let uploaded = observed.lock().unwrap();
    let end = uploaded
        .windows(4)
        .position(|part| part == b"\r\n\r\n")
        .unwrap();
    let header = std::str::from_utf8(&uploaded[..end]).unwrap();
    assert!(header.starts_with("POST /nested?kept=1 HTTP/1.1"));
    assert!(header.contains("Host: 127.0.0.1:5173\r\n"));
    assert!(header.contains("Origin: http://127.0.0.1:5173\r\n"));
    assert!(header.contains("Referer: http://127.0.0.1:5173/before\r\n"));
    assert!(header.contains("X-Original: unchanged: value\r\n"));
    assert!(header.contains("Authorization: app-local-only\r\n"));
    assert!(header.contains("Connection: close"));
    assert!(!header.contains("keep-alive"));
    assert!(!header.contains("secret-native-token"));
    assert_eq!(&uploaded[end + 4..], request_body);
}

#[test]
fn raw_read_bounds_cover_decoded_size_and_canonical_encoding() {
    let bytes = vec![0xff; CHUNK];
    assert_eq!(
        read_chunk(&json!({"data":STANDARD.encode(&bytes),"ended":false}))
            .unwrap()
            .0,
        bytes
    );
    for response in [
        json!({"data":STANDARD.encode(vec![0; CHUNK + 1]),"ended":false}),
        json!({"data":"!","ended":false}),
        json!({"data":"AA=="}),
        json!({"ended":true}),
    ] {
        assert!(read_chunk(&response).is_err());
    }
}
