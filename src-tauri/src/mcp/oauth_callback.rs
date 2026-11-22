use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::oauth_loopback::{self, Callback, Waited, CALLBACK_PATH};
use crate::oauth_loopback_page::{respond_page, Kind};

const CALLBACK_TTL: Duration = Duration::from_secs(300);
const MAX_LISTENERS: usize = 16;
const CANCELLED: &str = "MCP sign-in callback was cancelled or expired.";

struct Pending {
    listener: Option<TcpListener>,
    cancel: Arc<AtomicBool>,
    deadline: Instant,
    // Dropped when the binding settles, which releases the expiry task.
    _expiry: tokio::sync::oneshot::Sender<()>,
}

static LISTENERS: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
pub(crate) struct Binding {
    id: String,
    port: u16,
}

#[derive(Serialize)]
pub(crate) struct RelayCallback {
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

fn remove(id: &str) -> Option<Pending> {
    LISTENERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id)
}

fn cancel(id: &str) {
    let mut listeners = LISTENERS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pending) = listeners.get(id) {
        if pending.listener.is_none() {
            // Keep a waiting worker in the capacity count until it releases the socket.
            pending.cancel.store(true, Ordering::Relaxed);
        } else {
            listeners.remove(id);
        }
    }
}

#[tauri::command]
pub(crate) async fn mcp_oauth_callback_bind() -> Result<Binding, String> {
    let listener = oauth_loopback::bind_with_retry(0, Duration::ZERO)?;
    let port = listener
        .local_addr()
        .map_err(|_| "Local sign-in port is unavailable.")?
        .port();
    let id = oauth_loopback::random_token();
    let (expiry, released) = tokio::sync::oneshot::channel();
    {
        let mut listeners = LISTENERS.lock().unwrap_or_else(|e| e.into_inner());
        if listeners.len() >= MAX_LISTENERS {
            return Err("Too many MCP sign-ins are waiting.".into());
        }
        listeners.insert(
            id.clone(),
            Pending {
                listener: Some(listener),
                cancel: Arc::new(AtomicBool::new(false)),
                deadline: Instant::now() + CALLBACK_TTL,
                _expiry: expiry,
            },
        );
    }
    let expiry_id = id.clone();
    let _expiry = tauri::async_runtime::spawn(async move {
        if tokio::time::timeout(CALLBACK_TTL, released).await.is_err() {
            cancel(&expiry_id);
        }
    });
    Ok(Binding { id, port })
}

#[tauri::command]
pub(crate) async fn mcp_oauth_callback_cancel(id: String) {
    cancel(&id);
}

#[tauri::command]
pub(crate) async fn mcp_oauth_callback_wait(
    id: String,
    state: String,
) -> Result<RelayCallback, String> {
    if state.is_empty() || state.len() > 256 || !state.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err("Invalid MCP sign-in state.".into());
    }
    let (listener, cancelled, deadline) = {
        let mut listeners = LISTENERS.lock().unwrap_or_else(|e| e.into_inner());
        let pending = listeners.get_mut(&id).ok_or(CANCELLED)?;
        let listener = pending
            .listener
            .take()
            .ok_or("MCP sign-in callback is already waiting.")?;
        (listener, pending.cancel.clone(), pending.deadline)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let result = receive(&listener, &cancelled, deadline, &state);
        if remove(&id).is_none() || cancelled.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let Waited::Callback(callback, mut stream, lang) = result else {
            return Err(CANCELLED.into());
        };
        let (code, error, page) = match callback {
            Callback::Code(code) => (Some(code), None, Kind::Received),
            Callback::Denied => (None, Some("access_denied"), Kind::Cancelled),
            Callback::Error(_, _) => (None, Some("authorization_failed"), Kind::Failure),
            Callback::Ignore => return Err("Invalid MCP sign-in callback.".into()),
        };
        respond_page(&mut stream, page, "", lang);
        Ok(RelayCallback { state, code, error })
    })
    .await
    .map_err(|_| "The local MCP sign-in callback stopped.".to_string())?
}

fn receive(
    listener: &TcpListener,
    cancelled: &AtomicBool,
    deadline: Instant,
    state: &str,
) -> Waited {
    let Ok(addr) = listener.local_addr() else {
        return Waited::Failed;
    };
    let host = format!("127.0.0.1:{}", addr.port());
    oauth_loopback::wait_for_checked_callback(listener, cancelled, deadline, |line, head| {
        parse_request(line, head, &host, state)
    })
}

fn parse_request(line: &str, head: &str, expected_host: &str, state: &str) -> Callback {
    let mut parts = line.split_ascii_whitespace();
    let (Some("GET"), Some(target), Some("HTTP/1.1"), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Callback::Ignore;
    };
    let Some((CALLBACK_PATH, query)) = target.split_once('?') else {
        return Callback::Ignore;
    };
    if !head.contains("\r\n\r\n") || query.contains('#') {
        return Callback::Ignore;
    }
    let mut hosts = head
        .split("\r\n")
        .skip(1)
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("host"));
    if hosts.next().map(|(_, value)| value.trim()) != Some(expected_host) || hosts.next().is_some()
    {
        return Callback::Ignore;
    }
    let mut states = 0;
    let mut outcomes = 0;
    for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match name.as_ref() {
            "state" => states += 1,
            "code" | "error" if !value.is_empty() && value.len() <= 4096 => outcomes += 1,
            "code" | "error" => return Callback::Ignore,
            _ => {}
        }
    }
    if states != 1 || outcomes != 1 {
        return Callback::Ignore;
    }
    oauth_loopback::parse_callback(line, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Shutdown, TcpStream};

    #[test]
    fn accepts_only_the_bound_host_and_exactly_one_callback_state_and_result() {
        let host = "127.0.0.1:43210";
        let check = |target: &str, headers: &str| {
            let line = format!("GET {target} HTTP/1.1");
            parse_request(
                &line,
                &format!("{line}\r\n{headers}\r\n\r\n"),
                host,
                "expected",
            )
        };
        let exact_host = format!("Host: {host}");
        assert_eq!(
            check("/callback?code=authorized&state=expected", &exact_host),
            Callback::Code("authorized".into())
        );
        assert_eq!(
            check("/callback?error=access_denied&state=expected", &exact_host),
            Callback::Denied
        );
        for target in [
            "/different?code=valid&state=expected",
            "/other/../callback?code=valid&state=expected",
            "/callback?code=valid&state=other",
            "/callback?code=valid&state=other&state=expected",
            "/callback?error=access_denied&code=valid&state=expected",
            "/callback?code=&state=expected",
        ] {
            assert_eq!(check(target, &exact_host), Callback::Ignore);
        }
        for headers in [
            "Accept: */*".to_owned(),
            "Host: other:43210".to_owned(),
            format!("{exact_host}\r\n{exact_host}"),
        ] {
            assert_eq!(
                check("/callback?code=valid&state=expected", &headers),
                Callback::Ignore
            );
        }
    }

    #[test]
    fn delivers_one_callback_without_echoing_its_code_and_releases_cancelled_bindings() {
        tauri::async_runtime::block_on(async {
            let binding = mcp_oauth_callback_bind().await.unwrap();
            let browser = std::thread::spawn(move || {
                let mut browser = TcpStream::connect(("127.0.0.1", binding.port)).unwrap();
                browser
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                write!(
                    browser,
                    "GET /callback?code=fixture-code&state=fixture-state HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
                    binding.port
                ).unwrap();
                browser.shutdown(Shutdown::Write).unwrap();
                let mut page = String::new();
                browser.read_to_string(&mut page).unwrap();
                assert!(page.contains("Authorization received"));
                assert!(!page.contains("fixture-code"));
                assert!(!page.contains("fixture-state"));
            });
            let received = mcp_oauth_callback_wait(binding.id.clone(), "fixture-state".into())
                .await
                .unwrap();
            assert_eq!(received.code.as_deref(), Some("fixture-code"));
            assert!(mcp_oauth_callback_wait(binding.id, "fixture-state".into())
                .await
                .is_err());
            browser.join().unwrap();

            let cancelled = mcp_oauth_callback_bind().await.unwrap();
            mcp_oauth_callback_cancel(cancelled.id.clone()).await;
            assert!(
                mcp_oauth_callback_wait(cancelled.id, "fixture-state".into())
                    .await
                    .is_err()
            );
        });
    }
}
