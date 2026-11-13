use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::dirs_home;
use crate::fs::MAX_PREVIEW_BYTES;

const MAX_MEDIA_REQUESTS: usize = 8;
const TOKEN_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_TOKEN_BYTES: u64 = 8192;
static MEDIA_REQUESTS: AtomicUsize = AtomicUsize::new(0);

struct MediaPermit;
impl MediaPermit {
    fn acquire() -> Result<Self, String> {
        let mut count = MEDIA_REQUESTS.load(Ordering::Acquire);
        loop {
            if count >= MAX_MEDIA_REQUESTS {
                return Err("Too many media requests; try again".into());
            }
            match MEDIA_REQUESTS.compare_exchange_weak(
                count,
                count + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(actual) => count = actual,
            }
        }
        Ok(Self)
    }
}
impl Drop for MediaPermit {
    fn drop(&mut self) {
        MEDIA_REQUESTS.fetch_sub(1, Ordering::AcqRel);
    }
}

const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 5;
const MAX_URL_BYTES: usize = 8192;
const USER_AGENT: &str = "Bycoda";

#[derive(Clone, Debug, PartialEq, Eq)]
struct MediaUrl {
    host: String,
    path: String,
    url: String,
}

/// Fetch an issue/PR image or video through the host, as a blob the webview
/// can render without opening `img-src` / `media-src` to GitHub's CDNs.
#[tauri::command]
pub async fn fetch_inbox_media(
    app: tauri::AppHandle,
    url: String,
) -> Result<tauri::ipc::Response, String> {
    let permit = MediaPermit::acquire()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        fetch_inbox_media_sync(&app, &url)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn fetch_inbox_media_sync(app: &tauri::AppHandle, url: &str) -> Result<Vec<u8>, String> {
    let mut current = parse_https_url(url)?;
    let token = if github_auth_host(&current.host) {
        github_auth_token()?
    } else {
        None
    };
    let agent = ureq::AgentBuilder::new()
        .timeout(HTTP_TIMEOUT)
        .redirects(0)
        .build();

    for _ in 0..MAX_REDIRECTS {
        let jira_authorization = crate::jira::avatar_media_authorization(app, &current.url)?;
        if parse_allowed_media_url(&current.url).is_err() && jira_authorization.is_none() {
            return Err("That media host is not allowed".into());
        }
        let mut request = agent
            .get(&current.url)
            .set("Accept", "image/*,video/*,*/*;q=0.1")
            .set("User-Agent", USER_AGENT);
        if let Some(token) = token.as_ref() {
            if github_auth_host(&current.host) {
                request = request.set("Authorization", &format!("Bearer {token}"));
            }
        }
        if let Some(authorization) = jira_authorization {
            request = request.set("Authorization", &authorization);
        }
        // ureq with redirects(0) returns 3xx as Ok, not Err(Status).
        let response = match request.call() {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) if is_redirect(status) => response,
            Err(ureq::Error::Status(status, _)) => {
                return Err(format!("Media request failed ({status})"));
            }
            Err(_) => return Err("Could not fetch media".into()),
        };
        if is_redirect(response.status()) {
            let location = response
                .header("Location")
                .ok_or_else(|| "Media redirect is missing a Location header".to_string())?
                .to_string();
            current = redirect_target(&current.url, &location)?;
            continue;
        }
        return read_media_body(response);
    }
    Err("Too many media redirects".into())
}

fn read_media_body(response: ureq::Response) -> Result<Vec<u8>, String> {
    let status = response.status();
    if !(200..300).contains(&status) {
        return Err(format!("Media request failed ({status})"));
    }
    if let Some(content_type) = response.header("Content-Type") {
        let mime = content_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if mime.starts_with("text/html")
            || mime.starts_with("text/javascript")
            || mime == "application/javascript"
            || mime == "application/xhtml+xml"
        {
            return Err("That URL is not image or video media".into());
        }
    }
    if let Some(length) = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
    {
        if length > MAX_PREVIEW_BYTES {
            return Err(too_large());
        }
    }
    let mut reader = response.into_reader();
    let mut bytes = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|_| "Could not read media".to_string())?;
        if n == 0 {
            break;
        }
        if bytes.len() + n > MAX_PREVIEW_BYTES as usize {
            return Err(too_large());
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    if bytes.is_empty() {
        return Err("Media response was empty".into());
    }
    Ok(bytes)
}

fn too_large() -> String {
    format!(
        "Media is too large to preview (maximum {} MB).",
        MAX_PREVIEW_BYTES / 1024 / 1024
    )
}

fn parse_allowed_media_url(raw: &str) -> Result<MediaUrl, String> {
    let parsed = parse_https_url(raw)?;
    if !is_allowed_media_target(&parsed) {
        return Err("That media host is not allowed".into());
    }
    Ok(parsed)
}

fn parse_https_url(raw: &str) -> Result<MediaUrl, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > MAX_URL_BYTES {
        return Err("Media URL is invalid".into());
    }
    let rest = raw
        .strip_prefix("https://")
        .ok_or_else(|| "Only HTTPS media URLs are allowed".to_string())?;
    if rest.is_empty() || rest.starts_with('/') {
        return Err("Media URL is invalid".into());
    }
    let (authority, path_query) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    if authority.is_empty() || authority.contains('@') || authority.contains('\\') {
        return Err("Media URL is invalid".into());
    }
    if authority.starts_with('[') {
        return Err("Media URL is invalid".into());
    }
    let host = authority
        .split(':')
        .next()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() || host == "localhost" || host.parse::<std::net::IpAddr>().is_ok() {
        return Err("Media URL is invalid".into());
    }
    let without_hash = path_query.split('#').next().unwrap_or(path_query);
    let path = without_hash.split('?').next().unwrap_or(without_hash);
    if path_has_dotdot(path) {
        return Err("Media URL is invalid".into());
    }
    let url = raw.split('#').next().unwrap_or(raw).to_string();
    Ok(MediaUrl {
        host,
        path: path.to_string(),
        url,
    })
}

fn redirect_target(base: &str, location: &str) -> Result<MediaUrl, String> {
    let location = location.trim();
    if location.is_empty() {
        return Err("Media redirect is missing a Location header".into());
    }
    if location.starts_with("https://") {
        return parse_https_url(location);
    }
    if location.starts_with("http://") {
        return Err("Insecure media redirect".into());
    }
    let base = parse_https_url(base)?;
    let joined = if let Some(rest) = location.strip_prefix("//") {
        format!("https://{rest}")
    } else if location.starts_with('/') {
        format!("https://{}{}", base.host, location)
    } else {
        let dir = base
            .path
            .rsplit_once('/')
            .map(|(head, _)| head)
            .unwrap_or("");
        format!("https://{}{dir}/{location}", base.host)
    };
    parse_https_url(&joined)
}

fn is_allowed_media_target(url: &MediaUrl) -> bool {
    if is_github_site(&url.host) {
        return is_github_attachment_path(&url.path);
    }
    is_github_media_cdn(&url.host)
        || is_linear_uploads(&url.host)
        || is_github_asset_s3(&url.host)
        || (url.host.starts_with("avatar-management--avatars.")
            && url.host.ends_with(".prod.public.atl-paas.net"))
}

fn is_github_attachment_path(path: &str) -> bool {
    let path = path.to_ascii_lowercase();
    if path.starts_with("/user-attachments/") {
        return true;
    }
    // /owner/repo/assets/<user-id>/<uuid>
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    parts.len() >= 4 && parts[2] == "assets" && parts[3].bytes().all(|byte| byte.is_ascii_digit())
}

fn is_github_site(host: &str) -> bool {
    host == "github.com" || host == "www.github.com"
}

fn is_github_media_cdn(host: &str) -> bool {
    host == "githubusercontent.com" || host.ends_with(".githubusercontent.com")
}

fn is_linear_uploads(host: &str) -> bool {
    host == "uploads.linear.app" || host.ends_with(".uploads.linear.app")
}

fn is_github_asset_s3(host: &str) -> bool {
    let s3 = host.ends_with(".s3.amazonaws.com")
        || (host.contains(".s3.") && host.ends_with(".amazonaws.com"));
    s3 && (host.starts_with("github-production-user-asset-")
        || host.starts_with("github-production-media.")
        || host.starts_with("github-production-media-"))
}

fn github_auth_host(host: &str) -> bool {
    // JWT-signed githubusercontent URLs reject an extra Authorization header.
    is_github_site(host)
}

fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

fn path_has_dotdot(path: &str) -> bool {
    path.split('/').any(|segment| {
        let lower = segment.to_ascii_lowercase();
        lower == ".." || lower == "%2e%2e" || lower == "%2e." || lower == ".%2e"
    })
}

type TokenResult = Result<Option<String>, String>;
struct TokenFlight {
    result: Mutex<Option<TokenResult>>,
    ready: Condvar,
}
type TokenRegistry = Arc<Mutex<Option<Arc<TokenFlight>>>>;
static TOKEN_FLIGHT: OnceLock<TokenRegistry> = OnceLock::new();

pub(crate) fn github_auth_token() -> TokenResult {
    let deadline = Instant::now() + TOKEN_TIMEOUT;
    let registry = TOKEN_FLIGHT
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone();
    let worker_registry = registry.clone();
    let flight = acquire_token_flight(&registry, |worker| {
        thread::Builder::new()
            .name("inbox-media-auth".into())
            .spawn(move || {
                let failed = worker.clone();
                if std::panic::catch_unwind(|| token_worker(worker_registry, worker)).is_err() {
                    publish_token(
                        &failed,
                        Err("Media authentication process status unknown".into()),
                    );
                }
            })
            .map(|_| ())
    })?;
    wait_for_token(&flight, deadline)
}

/// Room source rechecks must start after the check begins, not join a token
/// lookup which may have started before an account switch.
pub(crate) fn github_auth_token_fresh() -> TokenResult {
    static ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    use std::sync::atomic::Ordering;
    if ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("GitHub account verification is already running".into());
    }
    let registry: TokenRegistry = Arc::new(Mutex::new(None));
    let flight = Arc::new(TokenFlight {
        result: Mutex::new(None),
        ready: Condvar::new(),
    });
    *registry.lock().unwrap_or_else(|e| e.into_inner()) = Some(flight.clone());
    let worker = flight.clone();
    if thread::Builder::new()
        .name("room-inbox-auth".into())
        .spawn(move || {
            token_worker(registry, worker);
            ACTIVE.store(false, Ordering::Release);
        })
        .is_err()
    {
        ACTIVE.store(false, Ordering::Release);
        return Err("GitHub authentication unavailable".into());
    }
    wait_for_token(&flight, Instant::now() + TOKEN_TIMEOUT)
}

fn acquire_token_flight(
    registry: &Mutex<Option<Arc<TokenFlight>>>,
    start: impl FnOnce(Arc<TokenFlight>) -> std::io::Result<()>,
) -> Result<Arc<TokenFlight>, String> {
    let mut current = registry
        .lock()
        .map_err(|_| "Media authentication unavailable".to_string())?;
    if let Some(flight) = current.as_ref() {
        return Ok(flight.clone());
    }
    let flight = Arc::new(TokenFlight {
        result: Mutex::new(None),
        ready: Condvar::new(),
    });
    *current = Some(flight.clone());
    if start(flight.clone()).is_err() {
        *current = None;
        publish_token(&flight, Err("Media authentication unavailable".into()));
    }
    Ok(flight)
}

fn wait_for_token(flight: &TokenFlight, deadline: Instant) -> TokenResult {
    let mut result = flight
        .result
        .lock()
        .map_err(|_| "Media authentication unavailable".to_string())?;
    while result.is_none() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Media authentication timed out".into());
        }
        let (next, timed) = flight
            .ready
            .wait_timeout(result, remaining)
            .map_err(|_| "Media authentication unavailable".to_string())?;
        result = next;
        if timed.timed_out() && result.is_none() {
            return Err("Media authentication timed out".into());
        }
    }
    result.as_ref().unwrap().clone()
}

fn publish_token(flight: &TokenFlight, value: TokenResult) {
    let mut result = flight.result.lock().unwrap_or_else(|e| e.into_inner());
    if result.is_none() {
        *result = Some(value);
        flight.ready.notify_all();
    }
}

fn token_worker(registry: TokenRegistry, flight: Arc<TokenFlight>) {
    let Ok(program) = crate::github_cli::gh_program() else {
        finish_token_flight(&registry, &flight, Ok(None));
        return;
    };
    let Some(home) = dirs_home() else {
        finish_token_flight(&registry, &flight, Ok(None));
        return;
    };
    let mut cmd = Command::new(program);
    cmd.current_dir(&home)
        .args(["auth", "token"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PAGER", "cat")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::harness::apply_gui_env(&mut cmd);
    crate::hide_window_console(&mut cmd);
    run_token_command(registry, flight, cmd, TOKEN_TIMEOUT);
}

fn run_token_command(
    registry: TokenRegistry,
    flight: Arc<TokenFlight>,
    mut cmd: Command,
    timeout: Duration,
) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let Ok(mut child) = crate::harness::process_lifecycle::OwnedChild::spawn(&mut cmd) else {
        finish_token_flight(&registry, &flight, Ok(None));
        return;
    };
    let stdout = child.stdout.take();
    let owner = Arc::new(crate::harness::process_lifecycle::ProcessOwner::new(child));
    let Some(stdout) = stdout else {
        retire_failed_setup(&registry, &flight, &owner);
        return;
    };
    let pin = match owner.pin() {
        Ok(pin) => pin,
        Err(_) => {
            retire_failed_setup(&registry, &flight, &owner);
            return;
        }
    };
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    if thread::Builder::new()
        .name("inbox-media-auth-output".into())
        .spawn(move || {
            let _pin = pin;
            let mut bytes = Vec::new();
            let result = stdout
                .take(MAX_TOKEN_BYTES + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes);
            let _ = send.send(result);
        })
        .is_err()
    {
        retire_failed_setup(&registry, &flight, &owner);
        return;
    }
    owner.activate();
    let outcome = owner.wait_timeout(timeout);
    if outcome.is_none() {
        publish_token(&flight, Err("Media authentication timed out".into()));
        let _ = owner.request_stop();
    }
    let result = match outcome {
        Some(result) => result,
        None => owner.wait(),
    };
    // Unknown retirement retains the flight and prevents further processes.
    let Ok(status) = result else {
        publish_token(
            &flight,
            Err("Media authentication process status unknown".into()),
        );
        return;
    };
    let retirement = owner.retirement().require_verified();
    let bytes = receive.recv().ok().and_then(Result::ok);
    let result = if !status.success() {
        Ok(None)
    } else if let Some(bytes) = bytes {
        if bytes.len() > MAX_TOKEN_BYTES as usize {
            Err("Media authentication output too large".into())
        } else {
            match String::from_utf8(bytes) {
                Ok(token) if !token.trim().is_empty() => Ok(Some(token.trim().to_string())),
                _ => Ok(None),
            }
        }
    } else {
        Err("Media authentication output unavailable".into())
    };
    complete_token_after_retirement(&registry, &flight, result, retirement);
}

fn complete_token_after_retirement(
    registry: &TokenRegistry,
    flight: &Arc<TokenFlight>,
    result: TokenResult,
    retirement: Result<(), String>,
) {
    if retirement.is_err() {
        publish_token(
            flight,
            Err("Media authentication process retirement unknown".into()),
        );
    } else {
        finish_token_flight(registry, flight, result);
    }
}

fn retire_failed_setup(
    registry: &TokenRegistry,
    flight: &Arc<TokenFlight>,
    owner: &Arc<crate::harness::process_lifecycle::ProcessOwner>,
) {
    publish_token(flight, Err("Media authentication unavailable".into()));
    owner.activate();
    let _ = owner.request_stop();
    if owner.wait().is_ok() && owner.retirement().require_verified().is_ok() {
        finish_token_flight(
            registry,
            flight,
            Err("Media authentication unavailable".into()),
        );
    }
}

fn finish_token_flight(registry: &TokenRegistry, flight: &Arc<TokenFlight>, result: TokenResult) {
    let mut current = registry.lock().unwrap_or_else(|e| e.into_inner());
    if current
        .as_ref()
        .is_some_and(|entry| Arc::ptr_eq(entry, flight))
    {
        *current = None;
    }
    publish_token(flight, result);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_admission_is_bounded_and_released() {
        let permits: Vec<_> = (0..MAX_MEDIA_REQUESTS)
            .map(|_| MediaPermit::acquire().unwrap())
            .collect();
        assert!(MediaPermit::acquire().is_err());
        drop(permits);
        assert!(MediaPermit::acquire().is_ok());
    }

    #[test]
    fn concurrent_callers_share_one_lookup_then_refresh_credentials() {
        let registry = Arc::new(Mutex::new(None));
        let starts = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new(std::sync::Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let registry = registry.clone();
                let starts = starts.clone();
                let gate = gate.clone();
                thread::spawn(move || {
                    gate.wait();
                    acquire_token_flight(&registry, |_| {
                        starts.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    })
                    .unwrap()
                })
            })
            .collect();
        gate.wait();
        let flights: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(starts.load(Ordering::SeqCst), 1);
        assert!(flights
            .iter()
            .all(|flight| Arc::ptr_eq(flight, &flights[0])));
        publish_token(&flights[0], Ok(Some("old".into())));
        *registry.lock().unwrap() = None;
        let refreshed = acquire_token_flight(&registry, |_| {
            starts.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        publish_token(&refreshed, Ok(Some("new".into())));
        assert_eq!(starts.load(Ordering::SeqCst), 2);
        assert_eq!(
            wait_for_token(&refreshed, Instant::now() + Duration::from_secs(1))
                .unwrap()
                .as_deref(),
            Some("new")
        );
    }

    #[test]
    fn unknown_flight_refuses_new_lookup_until_verified_release() {
        let registry: TokenRegistry = Arc::new(Mutex::new(None));
        let starts = AtomicUsize::new(0);
        let original = acquire_token_flight(&registry, |_| {
            starts.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        publish_token(&original, Err("Media authentication timed out".into()));
        complete_token_after_retirement(
            &registry,
            &original,
            Ok(None),
            Err("injected unknown".into()),
        );
        let retained = acquire_token_flight(&registry, |_| {
            starts.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        assert!(Arc::ptr_eq(&original, &retained));
        assert_eq!(starts.load(Ordering::SeqCst), 1);
        complete_token_after_retirement(&registry, &original, Ok(None), Ok(()));
        let next = acquire_token_flight(&registry, |_| {
            starts.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        assert!(!Arc::ptr_eq(&original, &next));
        assert_eq!(starts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn stalled_token_flight_returns_deadline_error() {
        let flight = TokenFlight {
            result: Mutex::new(None),
            ready: Condvar::new(),
        };
        let start = Instant::now();
        assert_eq!(
            wait_for_token(&flight, start + Duration::from_millis(20)).unwrap_err(),
            "Media authentication timed out"
        );
        assert!(start.elapsed() < Duration::from_secs(1));
        assert!(flight.result.lock().unwrap().is_none());
    }

    #[test]
    fn token_flight_delivers_one_result_to_all_waiters() {
        let flight = Arc::new(TokenFlight {
            result: Mutex::new(None),
            ready: Condvar::new(),
        });
        let waiters: Vec<_> = (0..8)
            .map(|_| {
                let flight = flight.clone();
                thread::spawn(move || {
                    let mut result = flight.result.lock().unwrap();
                    while result.is_none() {
                        result = flight.ready.wait(result).unwrap();
                    }
                    result.clone().unwrap()
                })
            })
            .collect();
        publish_token(&flight, Ok(Some("fixture".into())));
        for waiter in waiters {
            assert_eq!(waiter.join().unwrap().unwrap().as_deref(), Some("fixture"));
        }
        publish_token(&flight, Err("late".into()));
        assert_eq!(
            flight
                .result
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .as_ref()
                .unwrap()
                .as_deref(),
            Some("fixture")
        );
    }

    #[cfg(unix)]
    #[test]
    fn token_timeout_retires_descendant_holding_stdout() {
        let registry: TokenRegistry = Arc::new(Mutex::new(None));
        let flight = Arc::new(TokenFlight {
            result: Mutex::new(None),
            ready: Condvar::new(),
        });
        *registry.lock().unwrap() = Some(flight.clone());
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 30 & wait"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let worker = flight.clone();
        let worker_registry = registry.clone();
        let (done, finished) = std::sync::mpsc::channel();
        thread::spawn(move || {
            run_token_command(worker_registry, worker, cmd, Duration::from_millis(50));
            let _ = done.send(());
        });
        finished.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(
            flight
                .result
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .as_ref()
                .unwrap_err(),
            "Media authentication timed out"
        );
        assert!(registry.lock().unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn token_process_accepts_bounded_output_and_rejects_overflow() {
        let registry: TokenRegistry = Arc::new(Mutex::new(None));
        for (script, expected) in [
            ("Write-Output 'fixture-token'", true),
            ("Write-Output ('x' * 9000)", false),
        ] {
            let flight = Arc::new(TokenFlight {
                result: Mutex::new(None),
                ready: Condvar::new(),
            });
            *registry.lock().unwrap() = Some(flight.clone());
            let mut cmd = Command::new("powershell.exe");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            crate::hide_window_console(&mut cmd);
            run_token_command(
                registry.clone(),
                flight.clone(),
                cmd,
                Duration::from_secs(5),
            );
            let result = flight.result.lock().unwrap();
            if expected {
                assert_eq!(
                    result.as_ref().unwrap().as_ref().unwrap().as_deref(),
                    Some("fixture-token")
                );
            } else {
                assert_eq!(
                    result.as_ref().unwrap().as_ref().unwrap_err(),
                    "Media authentication output too large"
                );
            }
            assert!(registry.lock().unwrap().is_none());
        }
    }

    #[cfg(windows)]
    #[test]
    fn timed_out_token_process_keeps_flight_until_retired() {
        let registry: TokenRegistry = Arc::new(Mutex::new(None));
        let flight = Arc::new(TokenFlight {
            result: Mutex::new(None),
            ready: Condvar::new(),
        });
        *registry.lock().unwrap() = Some(flight.clone());
        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 10",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
        crate::hide_window_console(&mut cmd);
        let worker = flight.clone();
        let worker_registry = registry.clone();
        let handle = thread::spawn(move || {
            run_token_command(worker_registry, worker, cmd, Duration::from_millis(20))
        });
        let mut result = flight.result.lock().unwrap();
        while result.is_none() {
            result = flight.ready.wait(result).unwrap();
        }
        assert_eq!(
            result.as_ref().unwrap().as_ref().unwrap_err(),
            "Media authentication timed out"
        );
        drop(result);
        handle.join().unwrap();
        let current = registry.lock().unwrap();
        if let Some(retained) = current.as_ref() {
            assert!(
                Arc::ptr_eq(retained, &flight),
                "unknown retirement must retain the original fence"
            );
        }
    }

    #[test]
    fn jira_public_avatars_allow_only_the_avatar_cdn() {
        assert!(parse_allowed_media_url(
            "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/a.png"
        )
        .is_ok());
        assert!(parse_allowed_media_url(
            "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net.evil.test/a.png"
        )
        .is_err());
        assert!(parse_allowed_media_url("https://other.prod.public.atl-paas.net/a.png").is_err());
        assert!(
            parse_allowed_media_url("https://unconfigured.atlassian.net/secure/useravatar")
                .is_err()
        );
    }

    #[test]
    fn github_and_linear_attachments_are_allowed() {
        assert!(parse_allowed_media_url(
            "https://github.com/user-attachments/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )
        .is_ok());
        assert!(
            parse_allowed_media_url("https://user-images.githubusercontent.com/1/shot.png").is_ok()
        );
        assert!(parse_allowed_media_url("https://uploads.linear.app/org/uuid/file.png").is_ok());
        assert!(parse_allowed_media_url(
            "https://github-production-user-asset-6210df.s3.amazonaws.com/1/shot.png"
        )
        .is_ok());
        assert!(parse_allowed_media_url(
            "https://github.com/acme/web/assets/12/aaaaaaaa-bbbb-cccc"
        )
        .is_ok());
    }

    #[test]
    fn github_pages_other_hosts_and_traversal_are_rejected() {
        assert!(parse_allowed_media_url("https://github.com/acme/web/issues/1").is_err());
        assert!(parse_allowed_media_url("https://github.com/acme/web/assets").is_err());
        assert!(parse_allowed_media_url("https://github.com/user-attachments/../login").is_err());
        assert!(parse_allowed_media_url("http://github.com/user-attachments/assets/x").is_err());
        assert!(parse_allowed_media_url("https://evil.example/shot.png").is_err());
        assert!(parse_allowed_media_url(
            "https://github.com@evil.example/user-attachments/assets/x"
        )
        .is_err());
        assert!(parse_allowed_media_url("https://127.0.0.1/shot.png").is_err());
    }

    #[test]
    fn redirects_stay_on_allowed_hosts() {
        let next = redirect_target(
            "https://github.com/user-attachments/assets/abcd",
            "https://objects.githubusercontent.com/github-production-user-asset/1",
        )
        .unwrap();
        assert_eq!(next.host, "objects.githubusercontent.com");
        assert!(redirect_target(
            "https://github.com/user-attachments/assets/abcd",
            "https://evil.example/shot.png"
        )
        .is_ok());
        assert!(!is_allowed_media_target(
            &redirect_target(
                "https://github.com/user-attachments/assets/abcd",
                "https://evil.example/shot.png"
            )
            .unwrap()
        ));
        assert!(redirect_target(
            "https://github.com/user-attachments/assets/abcd",
            "http://objects.githubusercontent.com/x"
        )
        .is_err());
    }
}
