use super::*;
use std::sync::atomic::AtomicBool;

#[test]
fn challenge_matches_rfc7636_example() {
    assert_eq!(
        code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[test]
fn verifier_is_long_unreserved_and_unique() {
    let first = random_token();
    let second = random_token();
    assert!((43..=128).contains(&first.len()));
    assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(first, second);
}

#[test]
fn callback_with_other_state_or_path_is_ignored() {
    assert_eq!(
        parse_callback("GET /callback?code=c&state=s HTTP/1.1", "s"),
        Callback::Code("c".into())
    );
    assert_eq!(
        parse_callback("GET /callback?code=c&state=evil HTTP/1.1", "s"),
        Callback::Ignore
    );
    assert_eq!(
        parse_callback("GET /callback?code=c HTTP/1.1", "s"),
        Callback::Ignore
    );
    assert_eq!(
        parse_callback("GET /other?code=c&state=s HTTP/1.1", "s"),
        Callback::Ignore
    );
    assert_eq!(
        parse_callback("POST /callback?code=c&state=s HTTP/1.1", "s"),
        Callback::Ignore
    );
}

#[test]
fn busy_port_is_reported_after_the_retry_window() {
    let held = bind_with_retry(0, Duration::ZERO).unwrap();
    let port = held.local_addr().unwrap().port();
    let error = bind_with_retry(port, Duration::from_millis(150)).unwrap_err();
    assert!(error.contains(&port.to_string()));
}

#[test]
fn wait_stops_on_cancel_and_on_deadline() {
    let listener = bind_with_retry(0, Duration::ZERO).unwrap();
    let cancel = AtomicBool::new(true);
    let far = Instant::now() + Duration::from_secs(30);
    assert!(matches!(
        wait_for_callback(&listener, "s", &cancel, far),
        Waited::Cancelled
    ));
    let idle = AtomicBool::new(false);
    assert!(matches!(
        wait_for_callback(
            &listener,
            "s",
            &idle,
            Instant::now() + Duration::from_millis(150)
        ),
        Waited::TimedOut
    ));
}

#[test]
fn a_stalled_client_cannot_hold_the_wait_past_its_deadline() {
    let listener = bind_with_retry(0, Duration::ZERO).unwrap();
    let port = listener.local_addr().unwrap().port();
    // Connects and sends nothing.
    let _stalled = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    let cancel = AtomicBool::new(false);
    let started = Instant::now();
    let waited = wait_for_callback(
        &listener,
        "s",
        &cancel,
        Instant::now() + Duration::from_millis(300),
    );
    assert!(matches!(waited, Waited::TimedOut));
    assert!(started.elapsed() < Duration::from_millis(1500));
}

#[test]
fn error_descriptions_are_sanitized_and_capped() {
    assert_eq!(
        parse_callback(
            "GET /callback?error=invalid_scope&error_description=Not+allowed+%27openid%27%3Cscript%3E&state=s1 HTTP/1.1",
            "s1"
        ),
        Callback::Error(
            "invalid_scope".into(),
            "Not allowed 'openid' script".into()
        )
    );
    let opaque = "a".repeat(80);
    assert_eq!(
        sanitize_description(&format!("token {opaque} end")),
        "token end"
    );
    assert_eq!(
        sanitize_description(&"word ".repeat(100)).chars().count(),
        200
    );
}

#[test]
fn a_browser_gets_the_whole_page_after_sending_its_headers() {
    use std::io::{Read, Write};
    let listener = bind_with_retry(0, Duration::ZERO).unwrap();
    let port = listener.local_addr().unwrap().port();
    let client = std::thread::spawn(move || {
        let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        // Like a browser: the request line, then many headers in a second write.
        browser
            .write_all(b"GET /callback?code=c1&state=s HTTP/1.1\r\nHost: 127.0.0.1\r\n")
            .unwrap();
        let filler = format!("X-Filler: {}\r\n", "a".repeat(2000));
        browser
            .write_all(format!("{filler}Accept-Language: tr-TR,tr;q=0.9\r\n\r\n").as_bytes())
            .unwrap();
        let mut reply = String::new();
        browser.read_to_string(&mut reply).unwrap();
        reply
    });
    let cancel = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_secs(5);
    let Waited::Callback(Callback::Code(code), mut stream, lang) =
        wait_for_callback(&listener, "s", &cancel, deadline)
    else {
        panic!("expected a code callback");
    };
    assert_eq!(code, "c1");
    assert_eq!(lang, Lang::Tr);
    crate::oauth_loopback_page::respond_page(
        &mut stream,
        crate::oauth_loopback_page::Kind::Success,
        "",
        lang,
    );
    drop(stream);
    let reply = client.join().unwrap();
    assert!(reply.starts_with("HTTP/1.1 200 OK"));
    assert!(reply.contains("</html>"));
}
