use std::collections::HashMap;
use std::io::Read;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
pub(crate) mod attachments;
mod fresh_token;
pub(crate) use fresh_token::github_auth_token_fresh;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::dirs_home;
use crate::fs::MAX_PREVIEW_BYTES;

const MAX_MEDIA_REQUESTS: usize = 8;
/// Requests beyond the running limit wait in order; past this many waiters the
/// overflow is refused so a runaway page cannot grow the queue without bound.
const MAX_QUEUED_MEDIA: usize = 256;
/// A queued request that never reaches a slot fails instead of waiting forever.
const MEDIA_QUEUE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REQUEST_ID_BYTES: usize = 64;
const TOKEN_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_TOKEN_BYTES: u64 = 8192;

/// Bounded FIFO admission: `slots` requests run at once, up to `max_queued`
/// more wait (each for at most `wait`), and a waiter can be cancelled.
struct MediaGate {
    slots: Arc<Semaphore>,
    queued: AtomicUsize,
    max_queued: usize,
    wait: Duration,
}

struct QueuedSlot<'a>(&'a AtomicUsize);
impl Drop for QueuedSlot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl MediaGate {
    fn new(slots: usize, max_queued: usize, wait: Duration) -> Self {
        Self {
            slots: Arc::new(Semaphore::new(slots)),
            queued: AtomicUsize::new(0),
            max_queued,
            wait,
        }
    }

    async fn admit(&self, cancel: &Notify) -> Result<OwnedSemaphorePermit, String> {
        if let Ok(permit) = self.slots.clone().try_acquire_owned() {
            return Ok(permit);
        }
        let mut queued = self.queued.load(Ordering::Acquire);
        loop {
            if queued >= self.max_queued {
                return Err("Media queue is full; try again".into());
            }
            match self.queued.compare_exchange_weak(
                queued,
                queued + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(actual) => queued = actual,
            }
        }
        let _queued = QueuedSlot(&self.queued);
        tokio::select! {
            permit = self.slots.clone().acquire_owned() => {
                permit.map_err(|_| "Media queue unavailable".to_string())
            }
            _ = cancel.notified() => Err(MEDIA_CANCELLED.into()),
            _ = tokio::time::sleep(self.wait) => Err("Media queue timed out; try again".into()),
        }
    }
}

const MEDIA_CANCELLED: &str = "Media request cancelled";

fn media_gate() -> &'static MediaGate {
    static GATE: OnceLock<MediaGate> = OnceLock::new();
    GATE.get_or_init(|| MediaGate::new(MAX_MEDIA_REQUESTS, MAX_QUEUED_MEDIA, MEDIA_QUEUE_TIMEOUT))
}

/// Cancel handles for requests that supplied an id; bounded by the gate
/// (running plus queued) because an entry lives only while its command runs.
type CancelRegistry = Mutex<HashMap<String, Arc<Notify>>>;

fn cancel_registry() -> &'static CancelRegistry {
    static REGISTRY: OnceLock<CancelRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

struct CancelHandle {
    registry: &'static CancelRegistry,
    id: String,
    notify: Arc<Notify>,
}

impl CancelHandle {
    fn register(registry: &'static CancelRegistry, id: String) -> Result<Self, String> {
        if id.is_empty() || id.len() > MAX_REQUEST_ID_BYTES {
            return Err("Media request id is invalid".into());
        }
        let notify = Arc::new(Notify::new());
        let mut entries = registry.lock().unwrap_or_else(|e| e.into_inner());
        if entries.contains_key(&id) {
            return Err("Media request id is already in use".into());
        }
        entries.insert(id.clone(), notify.clone());
        drop(entries);
        Ok(Self {
            registry,
            id,
            notify,
        })
    }
}

impl Drop for CancelHandle {
    fn drop(&mut self) {
        let mut entries = self.registry.lock().unwrap_or_else(|e| e.into_inner());
        if entries
            .get(&self.id)
            .is_some_and(|entry| Arc::ptr_eq(entry, &self.notify))
        {
            entries.remove(&self.id);
        }
    }
}

fn cancel_media_request(registry: &CancelRegistry, id: &str) {
    let notify = registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .cloned();
    if let Some(notify) = notify {
        notify.notify_one();
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
///
/// Requests over the running limit queue (bounded, with a deadline) instead of
/// failing. A caller that no longer needs the bytes passes `request_id` and
/// calls `cancel_inbox_media` to leave the queue; a running request finishes.
#[tauri::command]
pub async fn fetch_inbox_media(
    app: tauri::AppHandle,
    url: String,
    request_id: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    // Reject unsafe URLs before they take a queue slot.
    parse_https_url(&url)?;
    let handle = request_id
        .map(|id| CancelHandle::register(cancel_registry(), id))
        .transpose()?;
    let idle = Notify::new();
    let cancel = handle.as_ref().map_or(&idle, |handle| &*handle.notify);
    let permit = media_gate().admit(cancel).await?;
    drop(handle);
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        fetch_inbox_media_sync(&app, &url)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Leave the media queue. A request that is already running is not interrupted.
#[tauri::command]
pub fn cancel_inbox_media(request_id: String) {
    cancel_media_request(cancel_registry(), &request_id);
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
        let gitlab_token = crate::gitlab::attachment_media_token(app, &current.url)?;
        let azure_authorization =
            crate::azure_devops::attachment_media_authorization(app, &current.url)?;
        if parse_allowed_media_url(&current.url).is_err()
            && jira_authorization.is_none()
            && gitlab_token.is_none()
            && azure_authorization.is_none()
        {
            return Err("That media host is not allowed".into());
        }
        let request_url = if jira_authorization.is_some() {
            crate::jira::attachment_download_url(&current.url)?
        } else {
            current.url.clone()
        };
        let mut request = agent
            .get(&request_url)
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
        if let Some(token) = gitlab_token {
            request = request.set("PRIVATE-TOKEN", &token);
        }
        if let Some(authorization) = azure_authorization {
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
        // Both callers send this credential to github.com, never to another instance.
        .args(["auth", "token", "--hostname", "github.com"])
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

    async fn wait_for_queued(gate: &MediaGate, count: usize) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while gate.queued.load(Ordering::Acquire) != count {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("queue did not reach the expected length");
    }

    fn queued_admit(
        gate: &Arc<MediaGate>,
        cancel: &Arc<Notify>,
    ) -> tokio::task::JoinHandle<Result<OwnedSemaphorePermit, String>> {
        let (gate, cancel) = (gate.clone(), cancel.clone());
        tokio::spawn(async move { gate.admit(&cancel).await })
    }

    #[tokio::test]
    async fn media_admission_queues_past_the_limit_and_releases_in_order() {
        let gate = Arc::new(MediaGate::new(2, 4, Duration::from_secs(5)));
        let idle = Arc::new(Notify::new());
        let mut running = vec![
            gate.admit(&idle).await.unwrap(),
            gate.admit(&idle).await.unwrap(),
        ];
        let first = queued_admit(&gate, &idle);
        wait_for_queued(&gate, 1).await;
        let second = queued_admit(&gate, &idle);
        wait_for_queued(&gate, 2).await;
        assert!(!first.is_finished() && !second.is_finished());
        running.pop();
        let first = first.await.unwrap().unwrap();
        assert!(!second.is_finished());
        drop(first);
        let second = second.await.unwrap().unwrap();
        assert_eq!(gate.queued.load(Ordering::Acquire), 0);
        drop((running, second));
        assert_eq!(gate.slots.available_permits(), 2);
    }

    #[tokio::test]
    async fn media_queue_is_bounded() {
        let gate = Arc::new(MediaGate::new(1, 1, Duration::from_secs(5)));
        let waiter_cancel = Arc::new(Notify::new());
        let idle = Notify::new();
        let _running = gate.admit(&idle).await.unwrap();
        let waiter = queued_admit(&gate, &waiter_cancel);
        wait_for_queued(&gate, 1).await;
        assert_eq!(
            gate.admit(&idle).await.unwrap_err(),
            "Media queue is full; try again"
        );
        assert_eq!(gate.queued.load(Ordering::Acquire), 1);
        waiter_cancel.notify_one();
        assert!(waiter.await.unwrap().is_err());
    }

    #[tokio::test]
    async fn cancelled_waiter_leaves_the_queue_without_taking_a_slot() {
        let gate = Arc::new(MediaGate::new(1, 2, Duration::from_secs(5)));
        let cancel = Arc::new(Notify::new());
        let idle = Notify::new();
        let running = gate.admit(&idle).await.unwrap();
        let waiter = queued_admit(&gate, &cancel);
        wait_for_queued(&gate, 1).await;
        cancel.notify_one();
        assert_eq!(waiter.await.unwrap().unwrap_err(), MEDIA_CANCELLED);
        assert_eq!(gate.queued.load(Ordering::Acquire), 0);
        // A cancel which arrives before the request starts waiting still counts.
        let early = Notify::new();
        early.notify_one();
        assert_eq!(gate.admit(&early).await.unwrap_err(), MEDIA_CANCELLED);
        drop(running);
        assert_eq!(gate.slots.available_permits(), 1);
        assert!(gate.admit(&idle).await.is_ok());
    }

    #[tokio::test]
    async fn queued_media_request_times_out_and_frees_its_place() {
        let gate = MediaGate::new(1, 2, Duration::from_millis(30));
        let idle = Notify::new();
        let _running = gate.admit(&idle).await.unwrap();
        let start = Instant::now();
        assert_eq!(
            gate.admit(&idle).await.unwrap_err(),
            "Media queue timed out; try again"
        );
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(gate.queued.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn cancel_handles_are_unique_bounded_and_released() {
        let registry: &'static CancelRegistry = Box::leak(Box::new(Mutex::new(HashMap::new())));
        assert!(CancelHandle::register(registry, String::new()).is_err());
        assert!(CancelHandle::register(registry, "x".repeat(MAX_REQUEST_ID_BYTES + 1)).is_err());
        let handle = CancelHandle::register(registry, "one".into()).unwrap();
        assert!(CancelHandle::register(registry, "one".into()).is_err());
        cancel_media_request(registry, "unknown");
        cancel_media_request(registry, "one");
        tokio::time::timeout(Duration::from_secs(1), handle.notify.notified())
            .await
            .expect("cancel must wake the registered request");
        drop(handle);
        assert!(registry.lock().unwrap().is_empty());
        assert!(CancelHandle::register(registry, "one".into()).is_ok());
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
