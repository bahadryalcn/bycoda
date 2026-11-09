use super::error::ErrorKind;
use super::flow::*;
use super::tokens::{Endpoints, TokenError, TokenSet};
use crate::oauth_loopback::bind;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn tokens() -> TokenSet {
    TokenSet {
        access_token: "a".into(),
        refresh_token: Some("r".into()),
        expires_in: 3600,
    }
}

fn request(port: u16, target: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(stream, "GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).unwrap();
    reply
}

fn spawn_drive(
    exchange: impl FnOnce(&str) -> Result<TokenSet, TokenError> + Send + 'static,
    window: Duration,
) -> (u16, Arc<AtomicBool>, std::thread::JoinHandle<Outcome>) {
    let listener = bind(0).unwrap();
    let port = listener.local_addr().unwrap().port();
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    let handle = std::thread::spawn(move || {
        drive(
            &listener,
            "state1",
            &flag,
            Instant::now() + window,
            exchange,
        )
    });
    (port, cancel, handle)
}

#[test]
fn state_mismatch_is_rejected_and_never_exchanged() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let log = seen.clone();
    let (port, _, handle) = spawn_drive(
        move |code| {
            log.lock().unwrap().push(code.into());
            Ok(tokens())
        },
        Duration::from_secs(10),
    );
    assert!(request(port, "/callback?code=evil&state=wrong").starts_with("HTTP/1.1 404"));
    assert!(seen.lock().unwrap().is_empty());
    assert!(request(port, "/callback?code=good&state=state1").starts_with("HTTP/1.1 200"));
    assert_eq!(handle.join().unwrap(), Outcome::Done(tokens()));
    assert_eq!(*seen.lock().unwrap(), vec!["good".to_string()]);
}

#[test]
fn user_denial_is_reported() {
    let (port, _, handle) = spawn_drive(|_| Ok(tokens()), Duration::from_secs(10));
    request(port, "/callback?error=access_denied&state=state1");
    assert_eq!(handle.join().unwrap(), Outcome::Denied);
}

#[test]
fn exchange_failure_is_reported_as_failed() {
    let (port, _, handle) = spawn_drive(|_| Err(TokenError::Network), Duration::from_secs(10));
    request(port, "/callback?code=c&state=state1");
    let Outcome::Failed(error) = handle.join().unwrap() else {
        panic!("expected failure");
    };
    assert_eq!(error.kind, ErrorKind::Offline);
}

#[test]
fn cancel_stops_the_wait() {
    let (_, cancel, handle) = spawn_drive(|_| Ok(tokens()), Duration::from_secs(30));
    cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(handle.join().unwrap(), Outcome::Cancelled);
}

#[test]
fn silence_times_out() {
    let (_, _, handle) = spawn_drive(|_| Ok(tokens()), Duration::from_millis(200));
    assert_eq!(handle.join().unwrap(), Outcome::TimedOut);
}

#[test]
fn port_conflict_is_reported_not_hidden() {
    let first = bind(0).unwrap();
    let port = first.local_addr().unwrap().port();
    assert!(crate::oauth_loopback::bind_with_retry(port, Duration::from_millis(100)).is_err());
}

#[test]
fn started_flow_is_pending_until_cancelled() {
    let endpoints = Endpoints {
        authorization: "https://clerk.example/oauth/authorize".into(),
        token: "https://clerk.example/oauth/token".into(),
        revocation: None,
    };
    let started = start("client".into(), endpoints, |_| Ok(())).unwrap();
    let url = url::Url::parse(&started.authorize_url).unwrap();
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    let redirect = url::Url::parse(&query["redirect_uri"]).unwrap();
    assert_eq!(redirect.host_str(), Some("127.0.0.1"));
    assert_eq!(redirect.path(), "/callback");
    assert_eq!(poll(&started.handle).status, "pending");
    // A wrong state does not complete the flow.
    let port = redirect.port().unwrap();
    assert!(request(port, "/callback?code=x&state=nope").starts_with("HTTP/1.1 404"));
    assert_eq!(poll(&started.handle).status, "pending");
    cancel(&started.handle);
    assert_eq!(poll(&started.handle).status, "expired");
}

#[test]
fn a_flow_cancelled_while_the_code_is_exchanged_yields_no_tokens() {
    let (port, cancel, handle) = {
        let (port, cancel, handle) = spawn_cancelling();
        (port, cancel, handle)
    };
    request(port, "/callback?code=c&state=state1");
    assert!(cancel.load(std::sync::atomic::Ordering::Relaxed));
    assert_eq!(handle.join().unwrap(), Outcome::Cancelled);
}

fn spawn_cancelling() -> (u16, Arc<AtomicBool>, std::thread::JoinHandle<Outcome>) {
    let listener = bind(0).unwrap();
    let port = listener.local_addr().unwrap().port();
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    let handle = std::thread::spawn(move || {
        let inner = flag.clone();
        drive(
            &listener,
            "state1",
            &flag,
            Instant::now() + Duration::from_secs(10),
            move |_| {
                inner.store(true, std::sync::atomic::Ordering::Relaxed);
                Ok(tokens())
            },
        )
    });
    (port, cancel, handle)
}

#[test]
fn rejected_scope_is_mapped_to_a_configuration_message() {
    let (port, _, handle) = spawn_drive(|_| Ok(tokens()), Duration::from_secs(10));
    let reply = request(
        port,
        "/callback?error=invalid_scope&error_description=The%20client%20may%20not%20request%20scope%20%27openid%27&state=state1",
    );
    assert!(reply.contains("Sign-in didn&#39;t complete"));
    assert!(reply.contains("rejected by the account server (invalid_scope)"));
    assert!(!reply.contains("openid"));
    let Outcome::Failed(error) = handle.join().unwrap() else {
        panic!("expected a failure");
    };
    assert_eq!(
        error.message,
        "This build's sign-in configuration was rejected by the account server (invalid_scope)."
    );
}

#[test]
fn unknown_callback_errors_carry_a_sanitized_capped_description() {
    let error = callback_error("weird", "Something broke");
    assert_eq!(error.message, "Sign-in failed (weird): Something broke");
    assert_eq!(
        callback_error("weird", "").message,
        "Sign-in failed (weird)."
    );
}
