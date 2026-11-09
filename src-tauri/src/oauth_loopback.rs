//! Shared building blocks of browser sign-in with PKCE over a loopback redirect
//! (RFC 7636 and RFC 8252): verifier and challenge, the `127.0.0.1` listener, callback
//! parsing against the expected `state`, and a cancellable wait loop. Used by the
//! messaging providers and the bycoda account; each keeps its own token exchange.
pub(crate) use crate::oauth_loopback_page::Lang;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub(crate) const CALLBACK_PATH: &str = "/callback";
/// Poll interval of the accept loop; also how fast a cancel releases the port.
pub(crate) const ACCEPT_TICK: Duration = Duration::from_millis(100);
/// A client gets this long to send its request line. The wait is single-threaded, so a
/// stalled connection must not hold it for long.
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(1);
/// A cancelled flow releases its port within one accept tick; a new bind waits this long.
const BIND_RETRY_WINDOW: Duration = Duration::from_secs(2);

/// S256 code challenge of a verifier.
pub(crate) fn code_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// 64 hex characters from two random UUIDs; used for `state` and the PKCE verifier
/// (RFC 7636 asks for 43 to 128 unreserved characters).
pub(crate) fn random_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Keeps short alphanumeric text from an untrusted query value.
pub(crate) fn sanitize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ' ' | '.'))
        .take(120)
        .collect()
}

/// Short human-readable text from an untrusted `error_description`: plain characters
/// only, long opaque runs (which could echo a token or state) dropped, capped at 200.
pub(crate) fn sanitize_description(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric()
                || matches!(c, '_' | '-' | ' ' | '.' | ',' | '\'' | ':' | '(' | ')')
            {
                c
            } else {
                ' '
            }
        })
        .collect();
    let joined = cleaned
        .split_whitespace()
        .filter(|word| word.chars().count() <= 40)
        .collect::<Vec<_>>()
        .join(" ");
    joined.chars().take(200).collect()
}

/// Result of one browser request to the loopback listener.
#[derive(Debug, PartialEq)]
pub(crate) enum Callback {
    Code(String),
    Denied,
    /// Sanitized `error` code and `error_description` (empty when absent).
    Error(String, String),
    /// Wrong path or state (favicon, stale tab); keep listening.
    Ignore,
}

/// Parses `GET /callback?... HTTP/1.1` against the expected state.
pub(crate) fn parse_callback(request_line: &str, expected_state: &str) -> Callback {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Ignore;
    };
    let Ok(url) = url::Url::parse(&format!("http://loopback{target}")) else {
        return Callback::Ignore;
    };
    if url.path() != CALLBACK_PATH {
        return Callback::Ignore;
    }
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if query.get("state").map(String::as_str) != Some(expected_state) {
        return Callback::Ignore;
    }
    if let Some(error) = query.get("error") {
        return if error == "access_denied" {
            Callback::Denied
        } else {
            let description = query
                .get("error_description")
                .map(|text| sanitize_description(text))
                .unwrap_or_default();
            Callback::Error(sanitize(error), description)
        };
    }
    match query.get("code").filter(|code| !code.is_empty()) {
        Some(code) => Callback::Code(code.clone()),
        None => Callback::Ignore,
    }
}

/// Binds `127.0.0.1:port` (0 picks a free port). A busy port is retried for
/// `retry_window` so a cancelled flow can release it, then reported.
pub(crate) fn bind_with_retry(port: u16, retry_window: Duration) -> Result<TcpListener, String> {
    let deadline = Instant::now() + retry_window;
    loop {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => return Ok(listener),
            Err(_) if Instant::now() < deadline => std::thread::sleep(ACCEPT_TICK),
            Err(_) => {
                return Err(format!(
                    "Could not open the local sign-in port {port}. Close other sign-in windows and try again."
                ))
            }
        }
    }
}

pub(crate) fn bind(port: u16) -> Result<TcpListener, String> {
    bind_with_retry(port, BIND_RETRY_WINDOW)
}

pub(crate) fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    let page = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>bycoda</title><body style=\"font-family:system-ui;padding:40px\"><p>{message}</p></body>"
    );
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(reply.as_bytes()); // -- the browser tab may already be closed.
    finish(stream);
}

/// How long `finish` keeps reading after the reply so the close is graceful.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(250);

/// Ends a reply gracefully: flush, half-close, then drain what the browser still sends.
/// Closing a socket with unread request bytes makes Windows send a reset, and the browser
/// then drops the page it already received and shows a blank tab.
pub(crate) fn finish(stream: &mut TcpStream) {
    let _ = stream.flush(); // -- best effort; the tab may already be closed.
    let _ = stream.shutdown(Shutdown::Write); // -- same.
    let _ = stream.set_read_timeout(Some(DRAIN_TIMEOUT)); // -- a failed timeout only ends the drain early.
    let limit = Instant::now() + DRAIN_TIMEOUT;
    let mut chunk = [0u8; 1024];
    let mut drained = 0usize;
    while Instant::now() < limit && drained < 64 * 1024 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => drained += read,
        }
    }
}

/// True once the request head (request line and headers) has ended.
fn head_complete(bytes: &[u8]) -> bool {
    bytes.windows(4).any(|w| w == b"\r\n\r\n") || bytes.windows(2).any(|w| w == b"\n\n")
}

/// Reads the request line and headers (up to the blank line, at most 8 KiB) within
/// `REQUEST_READ_TIMEOUT` in total and never past `deadline`, so trickled bytes cannot
/// extend the wait. Reading the whole head keeps unread bytes from turning the close into
/// a reset (a blank browser tab) and makes `Accept-Language` available.
fn read_request_line(stream: &TcpStream, deadline: Instant) -> Option<(String, String)> {
    let limit = deadline.min(Instant::now() + REQUEST_READ_TIMEOUT);
    let mut reader = stream;
    let mut line = Vec::new();
    let mut chunk = [0u8; 512];
    while !head_complete(&line) && line.len() < 8192 {
        // A head cut short by the time limit still has its request line.
        let Some(remaining) = limit.checked_duration_since(Instant::now()) else {
            break;
        };
        stream
            .set_read_timeout(Some(remaining.max(Duration::from_millis(1))))
            .ok()?;
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => line.extend_from_slice(&chunk[..read]),
            Err(_) => break,
        }
    }
    if !line.contains(&b'\n') {
        return None;
    }
    let end = line
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(line.len());
    let head = String::from_utf8_lossy(&line).into_owned();
    Some((
        String::from_utf8_lossy(&line[..end]).trim().to_string(),
        head,
    ))
}

/// How `wait_for_callback` ended.
pub(crate) enum Waited {
    /// A code, denial or provider error; the stream is still open so the caller can
    /// finish its token exchange before answering the browser tab.
    Callback(Callback, TcpStream, Lang),
    Cancelled,
    TimedOut,
    /// The listener could not be switched to non-blocking accept.
    Failed,
}

/// Accepts loopback requests until one carries the expected `state`, the flow is
/// cancelled or the deadline passes. Other requests get a 404 and the wait continues.
pub(crate) fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Waited {
    if listener.set_nonblocking(true).is_err() {
        return Waited::Failed;
    }
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Waited::Cancelled;
        }
        if Instant::now() >= deadline {
            return Waited::TimedOut;
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => {
                let _ = stream.set_nonblocking(false); // -- falls back to the read timeout below.
                stream
            }
            // Idle (`WouldBlock`) or a persistent accept error: wait a tick, then re-check
            // cancel and the deadline instead of spinning.
            Err(_) => {
                std::thread::sleep(ACCEPT_TICK);
                continue;
            }
        };
        let Some((line, head)) = read_request_line(&stream, deadline) else {
            continue;
        };
        match parse_callback(&line, expected_state) {
            Callback::Ignore => respond(&mut stream, "404 Not Found", "Not found."),
            callback => return Waited::Callback(callback, stream, Lang::from_request(&head)),
        }
    }
}

#[cfg(test)]
#[path = "oauth_loopback_tests.rs"]
mod tests;
