use super::*;
use std::sync::mpsc;

fn fixture(
    response: Vec<u8>,
    echo: bool,
) -> (
    HttpProxyEndpoint,
    mpsc::Receiver<Vec<u8>>,
    std::thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (send, receive) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_bounded(
            &mut stream,
            b"\r\n\r\n",
            MAX_HEADER,
            Instant::now() + Duration::from_secs(3),
        )
        .unwrap();
        send.send(request).unwrap();
        if stream.write_all(&response).is_err() {
            assert!(!echo);
            return;
        }
        if echo {
            stream.write_all(b"SSH-2.0-owned\r\n").unwrap();
            let mut input = [0; 4];
            stream.read_exact(&mut input).unwrap();
            assert_eq!(&input, b"ping");
            stream.write_all(b"pong").unwrap();
            let mut remaining = Vec::new();
            stream.read_to_end(&mut remaining).unwrap();
            assert!(remaining.is_empty());
            stream.write_all(b"tail").unwrap();
            stream.shutdown(Shutdown::Write).unwrap();
        }
    });
    (
        HttpProxyEndpoint {
            scheme: Default::default(),
            host: "127.0.0.1".into(),
            port,
        },
        receive,
        thread,
    )
}
fn target() -> HttpProxyTarget {
    HttpProxyTarget {
        host: "bound-ssh.example".into(),
        port: 2222,
    }
}
fn client(lease: &HttpProxyLease) -> TcpStream {
    let mut stream = TcpStream::connect(lease.address).unwrap();
    stream.write_all(MAGIC).unwrap();
    stream.write_all(lease.capability.as_bytes()).unwrap();
    stream.write_all(b"\n").unwrap();
    stream
}
fn ack(stream: &mut TcpStream) -> Vec<u8> {
    read_bounded(stream, b"\n", 16, Instant::now() + Duration::from_secs(3)).unwrap()
}
fn wait_failure(lease: &HttpProxyLease) -> HttpProxyFailure {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if let Some(failure) = lease.failure() {
            return failure;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn explicit_configuration_and_basic_approval_do_not_accept_shell_or_header_syntax() {
    for host in [
        "",
        "-proxy",
        "evil\r\nHeader:x",
        "http://proxy",
        "user@proxy",
        "%h",
        "proxy/path",
        "x;cmd",
    ] {
        assert!(HttpProxyEndpoint {
            scheme: Default::default(),
            host: host.into(),
            port: 8080
        }
        .validate()
        .is_err());
    }
    assert!(HttpProxyEndpoint {
        scheme: Default::default(),
        host: "127.0.0.1".into(),
        port: 0
    }
    .validate()
    .is_err());
    assert!(BasicCredentials::approved_plain_http("user", "password", false).is_err());
    assert!(BasicCredentials::approved_plain_http("user:extra", "password", true).is_err());
    assert!(BasicCredentials::approved_plain_http("user", "bad\nvalue", true).is_err());
    assert!(proxy_command(Path::new("/tmp/evil%h")).is_err());
    assert!(proxy_command(Path::new("/tmp/own helper"))
        .unwrap()
        .ends_with(" ssh-http-proxy"));
}

#[test]
fn relay_is_target_bound_preserves_early_bytes_and_supports_half_close() {
    let (proxy, request, server) = fixture(
        b"HTTP/1.1 200 Connection Established\r\n\r\n".to_vec(),
        true,
    );
    let lease = HttpProxyLease::start(proxy, target(), None).unwrap();
    let mut local = client(&lease);
    assert_eq!(ack(&mut local), b"OK\n");
    let request = String::from_utf8(request.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
    assert_eq!(
        request,
        "CONNECT bound-ssh.example:2222 HTTP/1.1\r\nHost: bound-ssh.example:2222\r\n\r\n"
    );
    let mut banner = [0; 15];
    local.read_exact(&mut banner).unwrap();
    assert_eq!(&banner, b"SSH-2.0-owned\r\n");
    local.write_all(b"ping").unwrap();
    let mut pong = [0; 4];
    local.read_exact(&mut pong).unwrap();
    assert_eq!(&pong, b"pong");
    local.shutdown(Shutdown::Write).unwrap();
    let mut tail = Vec::new();
    local.read_to_end(&mut tail).unwrap();
    assert_eq!(&tail, b"tail");
    server.join().unwrap();
}

#[test]
fn approved_basic_is_only_in_parent_connect_header_and_never_debug_or_command() {
    let (proxy, request, server) = fixture(
        b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n".to_vec(),
        false,
    );
    let credentials =
        BasicCredentials::approved_plain_http("owned-user", "owned-password", true).unwrap();
    let lease = HttpProxyLease::start(proxy.clone(), target(), Some(credentials)).unwrap();
    assert!(
        !lease.matches(&proxy, &target()),
        "authenticated lease cannot be reused for an unauthenticated profile"
    );
    let debug = format!("{lease:?}");
    assert!(!debug.contains("owned-password"));
    assert!(!debug.contains(&lease.capability));
    let command = lease
        .proxy_command(Path::new("C:/fixture/bycoda.exe"))
        .unwrap();
    assert!(!command.contains("owned-user"));
    assert!(!command.contains("owned-password"));
    assert!(!command.contains(&lease.capability));
    assert!(lease
        .environment()
        .iter()
        .all(|(_, value)| !value.contains("owned-password")));
    let mut local = client(&lease);
    assert_eq!(ack(&mut local), b"ERR 407\n");
    let request = String::from_utf8(request.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
    use base64::Engine as _;
    assert!(request.contains(&format!(
        "Proxy-Authorization: Basic {}\r\n",
        base64::engine::general_purpose::STANDARD.encode(b"owned-user:owned-password")
    )));
    assert_eq!(wait_failure(&lease), HttpProxyFailure::Rejected(407));
    server.join().unwrap();
}

#[test]
fn any_success_status_establishes_connect_tunnel() {
    let (proxy, request, server) =
        fixture(b"HTTP/1.1 204 Tunnel Established\r\n\r\n".to_vec(), false);
    let lease = HttpProxyLease::start(proxy, target(), None).unwrap();
    let mut local = client(&lease);
    assert_eq!(ack(&mut local), b"OK\n");
    request.recv_timeout(Duration::from_secs(3)).unwrap();
    server.join().unwrap();
}

#[test]
fn wrong_capability_never_contacts_upstream_and_does_not_consume_valid_admission() {
    let (proxy, request, server) = fixture(b"HTTP/1.1 403 Denied\r\n\r\n".to_vec(), false);
    let lease = HttpProxyLease::start(proxy, target(), None).unwrap();
    let mut wrong = TcpStream::connect(lease.address).unwrap();
    wrong.write_all(MAGIC).unwrap();
    wrong.write_all(&[b'0'; 64]).unwrap();
    wrong.write_all(b"\n").unwrap();
    wrong
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut byte = [0];
    assert_eq!(wrong.read(&mut byte).unwrap(), 0);
    assert!(request.recv_timeout(Duration::from_millis(100)).is_err());
    let mut valid = client(&lease);
    assert_eq!(ack(&mut valid), b"ERR 403\n");
    assert!(request.recv_timeout(Duration::from_secs(3)).is_ok());
    assert_eq!(wait_failure(&lease), HttpProxyFailure::Rejected(403));
    server.join().unwrap();
}

#[test]
fn non_success_and_invalid_headers_do_not_redirect_or_echo_upstream_content() {
    for (response, expected) in [
        (
            b"HTTP/1.1 302 Move\r\nLocation: http://other\r\n\r\n".to_vec(),
            HttpProxyFailure::Rejected(302),
        ),
        (
            b"HTTP/1.1 502 Internal SECRET_SENTINEL\r\n\r\n".to_vec(),
            HttpProxyFailure::Rejected(502),
        ),
        (
            b"HTTP/9.9 200 Invalid\r\n\r\n".to_vec(),
            HttpProxyFailure::Invalid,
        ),
        (
            [
                b"HTTP/1.1 200 OK\r\nX: ".as_slice(),
                &vec![b'x'; MAX_HEADER],
                b"\r\n\r\n",
            ]
            .concat(),
            HttpProxyFailure::Invalid,
        ),
    ] {
        let (proxy, request, server) = fixture(response, false);
        let lease = HttpProxyLease::start(proxy, target(), None).unwrap();
        let mut local = client(&lease);
        let _ = ack(&mut local);
        let error = wait_failure(&lease);
        assert_eq!(error, expected);
        assert!(!error.to_string().contains("SECRET_SENTINEL"));
        request.recv_timeout(Duration::from_secs(3)).unwrap();
        server.join().unwrap();
    }
}

#[test]
fn connect_header_poll_timeouts_preserve_the_overall_response_deadline() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy = HttpProxyEndpoint {
        scheme: Default::default(),
        host: "127.0.0.1".into(),
        port: upstream.local_addr().unwrap().port(),
    };
    let server = std::thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        read_bounded(
            &mut stream,
            b"\r\n\r\n",
            MAX_HEADER,
            Instant::now() + Duration::from_secs(3),
        )
        .unwrap();
        stream.write_all(b"HTTP/1.1 2").unwrap();
        // Several cancellation-poll windows may elapse while a valid proxy
        // slowly sends its response; they must not become connection failures.
        std::thread::sleep(Duration::from_millis(180));
        stream.write_all(b"00 OK\r\n\r\n").unwrap();
    });
    let lease = HttpProxyLease::start(proxy, target(), None).unwrap();
    let mut local = client(&lease);
    assert_eq!(ack(&mut local), b"OK\n");
    server.join().unwrap();
}

#[test]
fn stop_cancels_pending_authentication_and_active_connect_and_closes_listener() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy = HttpProxyEndpoint {
        scheme: Default::default(),
        host: "127.0.0.1".into(),
        port: upstream.local_addr().unwrap().port(),
    };
    let lease = HttpProxyLease::start(proxy, target(), None).unwrap();
    let address = lease.address;
    let mut local = client(&lease);
    let (mut accepted, _) = upstream.accept().unwrap();
    read_bounded(
        &mut accepted,
        b"\r\n\r\n",
        MAX_HEADER,
        Instant::now() + Duration::from_secs(3),
    )
    .unwrap();
    lease.stop();
    lease.stop();
    accepted
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    let mut byte = [0];
    assert_eq!(accepted.read(&mut byte).unwrap(), 0);
    local
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    assert_eq!(local.read(&mut byte).unwrap(), 0);
    let deadline = Instant::now() + Duration::from_secs(1);
    while TcpStream::connect_timeout(&address, Duration::from_millis(30)).is_ok() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(lease.state.credentials.lock().unwrap().is_none());
}

#[test]
fn drop_interrupts_unauthenticated_helper_and_never_opens_upstream_relay() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    upstream.set_nonblocking(true).unwrap();
    let lease = HttpProxyLease::start(
        HttpProxyEndpoint {
            scheme: Default::default(),
            host: "127.0.0.1".into(),
            port: upstream.local_addr().unwrap().port(),
        },
        target(),
        None,
    )
    .unwrap();
    let address = lease.address;
    let mut local = TcpStream::connect(address).unwrap();
    local.write_all(b"partial").unwrap();
    std::thread::sleep(Duration::from_millis(50));
    drop(lease);
    local
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    let mut byte = [0];
    assert_eq!(local.read(&mut byte).unwrap(), 0);
    assert_eq!(
        upstream.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

#[test]
fn trickled_header_bytes_cannot_extend_global_read_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        for _ in 0..100 {
            if stream.write_all(b"x").is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    });
    let mut stream = TcpStream::connect(address).unwrap();
    let started = Instant::now();
    assert_eq!(
        read_bounded(
            &mut stream,
            b"\r\n\r\n",
            MAX_HEADER,
            started + Duration::from_millis(150)
        ),
        Err(HttpProxyFailure::Timeout)
    );
    assert!(started.elapsed() < Duration::from_secs(1));
    let _ = stream.shutdown(Shutdown::Both);
    drop(stream);
    server.join().unwrap();
}
