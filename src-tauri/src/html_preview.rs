use crate::control::receipts::WindowIssuer;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

struct Preview {
    content: String,
    root: Option<PathBuf>,
    background: bool,
}

enum PreviewState {
    Pending,
    Cancelled,
    Failed,
    Ready(Preview),
}
struct PreviewRecord {
    owner: Arc<WindowIssuer>,
    state: PreviewState,
}
#[derive(Default)]
struct PreviewRegistry {
    entries: HashMap<String, PreviewRecord>,
    sealed: bool,
    expired: PreviewFence,
}

const FENCE_BYTES: usize = 1024 * 1024;
struct PreviewFence {
    bits: Vec<u8>,
    set_bits: usize,
}
impl Default for PreviewFence {
    fn default() -> Self {
        Self {
            bits: vec![0; FENCE_BYTES],
            set_bits: 0,
        }
    }
}
impl PreviewFence {
    fn indexes(key: &str) -> [usize; 4] {
        let digest = Sha256::digest(key.as_bytes());
        std::array::from_fn(|i| {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&digest[i * 8..i * 8 + 8]);
            (u64::from_le_bytes(bytes) % (FENCE_BYTES as u64 * 8)) as usize
        })
    }
    fn contains(&self, key: &str) -> bool {
        Self::indexes(key)
            .into_iter()
            .all(|i| self.bits[i / 8] & (1 << (i % 8)) != 0)
    }
    fn insert(&mut self, key: &str) {
        for i in Self::indexes(key) {
            let bit = 1 << (i % 8);
            if self.bits[i / 8] & bit == 0 {
                self.bits[i / 8] |= bit;
                self.set_bits += 1;
            }
        }
    }
    fn saturated(&self) -> bool {
        self.set_bits >= FENCE_BYTES * 8 / 4
    }
}

impl PreviewRegistry {
    fn reap(&mut self) {
        let expired = &mut self.expired;
        self.entries.retain(|token, entry| {
            if entry.owner.is_retired() {
                expired.insert(token);
                false
            } else {
                true
            }
        });
    }
    fn begin(&mut self, owner: &Arc<WindowIssuer>, token: &str) -> Result<(), String> {
        self.reap();
        if let Some(entry) = self.entries.get(token) {
            if !Arc::ptr_eq(&entry.owner, owner) {
                return Err("Preview belongs to another page.".into());
            }
            if matches!(entry.state, PreviewState::Cancelled) {
                self.expired.insert(token);
                self.entries.remove(token);
                return Err("Preview was closed before creation.".into());
            }
            return Err("Preview token was already used.".into());
        }
        if self.sealed || self.expired.saturated() {
            return Err("HTML preview admission is unavailable until restart.".into());
        }
        if self.expired.contains(token) {
            return Err("Preview token was already used.".into());
        }
        if self.entries.len() >= 64 {
            return Err("Too many open HTML previews.".into());
        }
        self.entries.insert(
            token.into(),
            PreviewRecord {
                owner: owner.clone(),
                state: PreviewState::Pending,
            },
        );
        Ok(())
    }
    fn finish(
        &mut self,
        owner: &Arc<WindowIssuer>,
        token: &str,
        result: Result<Preview, String>,
    ) -> Result<String, String> {
        let entry = self
            .entries
            .get_mut(token)
            .ok_or("Preview creation is unavailable.")?;
        if !Arc::ptr_eq(&entry.owner, owner) {
            return Err("Preview belongs to another page.".into());
        }
        if matches!(entry.state, PreviewState::Cancelled) {
            self.expired.insert(token);
            self.entries.remove(token);
            return Err("Preview was closed before creation.".into());
        }
        if !matches!(entry.state, PreviewState::Pending) {
            return Err("Preview creation is unavailable.".into());
        }
        match result {
            Ok(preview) => {
                entry.state = PreviewState::Ready(preview);
                Ok(token.into())
            }
            Err(error) => {
                entry.state = PreviewState::Failed;
                Err(error)
            }
        }
    }
    fn close(&mut self, owner: &Arc<WindowIssuer>, token: &str) -> Result<(), String> {
        self.reap();
        if let Some(entry) = self.entries.get_mut(token) {
            if !Arc::ptr_eq(&entry.owner, owner) {
                return Err("Preview belongs to another page.".into());
            }
            if matches!(entry.state, PreviewState::Pending | PreviewState::Cancelled) {
                entry.state = PreviewState::Cancelled;
            } else {
                self.expired.insert(token);
                self.entries.remove(token);
            }
        } else {
            if self.expired.contains(token) {
                return Ok(());
            }
            if self.entries.len() >= 4096 {
                self.sealed = true;
                return Err("HTML preview admission is unavailable until restart.".into());
            }
            self.entries.insert(
                token.into(),
                PreviewRecord {
                    owner: owner.clone(),
                    state: PreviewState::Cancelled,
                },
            );
        }
        Ok(())
    }
}

fn previews() -> &'static Mutex<PreviewRegistry> {
    static PREVIEWS: OnceLock<Mutex<PreviewRegistry>> = OnceLock::new();
    PREVIEWS.get_or_init(|| Mutex::new(PreviewRegistry::default()))
}

#[tauri::command(async)]
pub fn create_html_preview(
    window: tauri::WebviewWindow,
    token: String,
    path: String,
    content: String,
    still: Option<bool>,
) -> Result<String, String> {
    validate_token(&token)?;
    let owner = crate::control::receipts::capture(&window)?;
    owner.with_live(|| {
        previews()
            .lock()
            .map_err(|e| e.to_string())?
            .begin(&owner, &token)
    })?;
    let result = make_preview_with(path, content, still.unwrap_or(false));
    owner.with_live(|| {
        previews()
            .lock()
            .map_err(|e| e.to_string())?
            .finish(&owner, &token, result)
    })
}

fn make_preview(path: String, content: String) -> Result<Preview, String> {
    make_preview_with(path, content, false)
}

fn make_preview_with(path: String, content: String, still: bool) -> Result<Preview, String> {
    if content.len() > 16 * 1024 * 1024 {
        return Err("HTML preview is limited to 16 MiB.".into());
    }
    if path.starts_with("background://") {
        if content.trim().is_empty() || content.len() > 2 * 1024 * 1024 {
            return Err("HTML background must contain 1 to 2097152 UTF-8 bytes".into());
        }
        return Ok(Preview {
            content: background_document(&content, still)?,
            root: None,
            background: true,
        });
    }
    let root = if path.starts_with("remote://") {
        None // Remote HTML is already read by the owning host; never read its assets locally.
    } else {
        html_file_url(Path::new(&path))?;
        Some(
            Path::new(&path)
                .canonicalize()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("HTML file has no containing folder")?
                .to_path_buf(),
        )
    };
    Ok(Preview {
        content,
        root,
        background: false,
    })
}

/// The trusted outer document owns frame-src. Authored code only runs in its opaque
/// srcdoc child: attempts to navigate that child are governed by this parent policy.
/// Neither document has local assets, network, forms, popups or a native bridge.
fn background_document(content: &str, still: bool) -> Result<String, String> {
    // CSP covers resource fetches. WebRTC has no reliable connect-src enforcement;
    // retire its constructors before authored code. CSP frame-src does not cover
    // about:blank, so the guard itself refuses frame/object/embed creation to stop a
    // fresh realm with intact constructors; worker and popup denial cover the rest.
    let guard = include_str!("html_preview/background_guard.js");
    // Still mode makes the scene see reduced motion, so it draws one frame and stops.
    let still_motion = if still {
        format!(
            "<script>{}</script>",
            include_str!("html_preview/still_motion.js")
        )
    } else {
        String::new()
    };
    let inner = format!(
        r#"<!doctype html><meta http-equiv="Content-Security-Policy" content="frame-src 'none'"><script>{guard}</script>{still_motion}{content}"#
    );
    let escaped = inner
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    // Escaping can expand the 2 MiB source about fivefold; bound the final document.
    if escaped.len() > 12 * 1024 * 1024 {
        return Err("HTML background is too large once escaped".into());
    }
    Ok(format!(
        r#"<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src about:; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,iframe{{margin:0;width:100%;height:100%;border:0;overflow:hidden}}</style><iframe title="Background" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="{escaped}"></iframe>"#
    ))
}

#[cfg(test)]
mod background_tests {
    use super::*;

    #[test]
    fn offline_scene_has_no_file_root_and_cannot_escape_srcdoc() {
        let authored =
            r#"</iframe><script>fetch('https://example.com')</script><img src="file:///secret">"#;
        let preview = make_preview("background://scene.html".into(), authored.into()).unwrap();
        assert!(preview.root.is_none());
        assert!(preview
            .content
            .contains("frame-src about:; child-src 'none'; worker-src 'none'"));
        assert!(preview.content.contains("connect-src 'none'"));
        assert!(preview.content.contains("sandbox=\"allow-scripts\""));
        assert!(!preview.content.contains("<script>"));
        assert!(preview.content.contains("&lt;/iframe&gt;"));
        assert!(preview.content.contains("RTCPeerConnection"));
        for part in [
            "&quot;webkit&quot;",
            "MutationObserver",
            "contentWindow",
            "createElement",
        ] {
            assert!(preview.content.contains(part), "{part}");
        }
    }

    #[test]
    fn escaped_background_document_is_bounded() {
        let heavy = "\"".repeat(2 * 1024 * 1024);
        assert!(background_document(&heavy, false).is_err());
        assert!(background_document("<b>ok</b>", false).is_ok());
    }

    #[test]
    fn still_mode_reports_reduced_motion_and_live_mode_does_not() {
        let still = background_document("<b>ok</b>", true).unwrap();
        let live = background_document("<b>ok</b>", false).unwrap();
        assert!(still.contains("prefers-reduced-motion"));
        assert!(!live.contains("prefers-reduced-motion"));
        // The override runs after the guard and before authored content.
        let guard = still.find("RTCPeerConnection").unwrap();
        let override_at = still.find("prefers-reduced-motion").unwrap();
        let authored = still.find("&lt;b&gt;ok").unwrap();
        assert!(guard < override_at && override_at < authored);
    }
}

#[tauri::command]
pub fn close_html_preview(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    validate_token(&token)?;
    let owner = crate::control::receipts::capture(&window)?;
    owner.with_live(|| {
        previews()
            .lock()
            .map_err(|e| e.to_string())?
            .close(&owner, &token)
    })
}

fn validate_token(token: &str) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(token).map_err(|_| "Invalid preview token.")?;
    if id.to_string() != token || id.get_version_num() != 4 {
        return Err("Invalid preview token.".into());
    }
    Ok(())
}

fn preview_asset(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let base = url::Url::from_directory_path(root).map_err(|_| "Invalid preview folder")?;
    let candidate = base
        .join(relative)
        .map_err(|e| e.to_string())?
        .to_file_path()
        .map_err(|_| "Invalid asset path")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !candidate.starts_with(root) || !candidate.is_file() {
        return Err("Asset is outside the preview folder".into());
    }
    // Never serve hidden files or folders (.env, .git, .ssh, ...) to the page.
    let hidden = candidate.strip_prefix(root).is_ok_and(|rel| {
        rel.components()
            .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
    });
    if hidden {
        return Err("Hidden files are not served by HTML previews".into());
    }
    Ok(candidate)
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Largest body one preview response carries. Bigger assets are served as byte ranges.
const MAX_PREVIEW_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;

struct Served {
    status: u16,
    body: Vec<u8>,
    content_type: &'static str,
    content_range: Option<String>,
}

impl Served {
    fn full(body: Vec<u8>, content_type: &'static str) -> Self {
        Self {
            status: 200,
            body,
            content_type,
            content_range: None,
        }
    }
    fn text(status: u16, message: &str, content_range: Option<String>) -> Self {
        Self {
            status,
            body: message.as_bytes().to_vec(),
            content_type: "text/plain; charset=utf-8",
            content_range,
        }
    }
}

fn preview_content(path: &str, range: Option<&str>) -> Result<Served, String> {
    preview_content_with(previews(), path, range, read_asset)
}

#[derive(Debug, PartialEq)]
enum RangePlan {
    Full,
    /// `end` is exclusive.
    Partial {
        start: u64,
        end: u64,
    },
    Unsatisfiable,
}

fn parse_digits(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Plans one `bytes=` range. Forms that are malformed, multi-range or not bytes are
/// ignored (full body), as RFC 9110 allows; a range that starts past the end is unsatisfiable.
fn plan_range(header: Option<&str>, len: u64) -> RangePlan {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return RangePlan::Full;
    };
    if spec.contains(',') {
        return RangePlan::Full;
    }
    let Some((first, last)) = spec.trim().split_once('-') else {
        return RangePlan::Full;
    };
    let (first, last) = (first.trim(), last.trim());
    if first.is_empty() {
        let Some(suffix) = parse_digits(last) else {
            return RangePlan::Full;
        };
        if suffix == 0 || len == 0 {
            return RangePlan::Unsatisfiable;
        }
        return RangePlan::Partial {
            start: len - suffix.min(len),
            end: len,
        };
    }
    let Some(start) = parse_digits(first) else {
        return RangePlan::Full;
    };
    if start >= len {
        return RangePlan::Unsatisfiable;
    }
    let end = if last.is_empty() {
        len
    } else {
        let Some(last) = parse_digits(last) else {
            return RangePlan::Full;
        };
        if last < start {
            return RangePlan::Full;
        }
        last.saturating_add(1).min(len)
    };
    RangePlan::Partial { start, end }
}

/// Reads only the bytes a response needs, so memory per response stays bounded
/// regardless of the file size.
fn read_asset(asset: &Path, range: Option<&str>) -> Result<Served, String> {
    let mut file = std::fs::File::open(asset).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let content_type = mime(asset);
    let (start, end, partial) = match plan_range(range, len) {
        RangePlan::Unsatisfiable => {
            return Ok(Served::text(
                416,
                "Requested range is not satisfiable.",
                Some(format!("bytes */{len}")),
            ));
        }
        RangePlan::Full if len > MAX_PREVIEW_RESPONSE_BYTES => {
            return Ok(Served::text(
                413,
                "Preview asset is too large for one response. Request byte ranges.",
                None,
            ));
        }
        RangePlan::Full => (0, len, false),
        RangePlan::Partial { start, end } => {
            (start, end.min(start + MAX_PREVIEW_RESPONSE_BYTES), true)
        }
    };
    let wanted = end - start;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut body = Vec::with_capacity(wanted as usize);
    file.take(wanted)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() as u64 != wanted {
        return Err("Preview asset changed while it was being read".into());
    }
    if !partial {
        return Ok(Served::full(body, content_type));
    }
    Ok(Served {
        status: 206,
        body,
        content_type,
        content_range: Some(format!("bytes {start}-{}/{len}", end - 1)),
    })
}

fn preview_content_with(
    registry: &Mutex<PreviewRegistry>,
    path: &str,
    range: Option<&str>,
    read: impl FnOnce(&Path, Option<&str>) -> Result<Served, String>,
) -> Result<Served, String> {
    let (token, relative) = path
        .trim_start_matches('/')
        .split_once('/')
        .ok_or("Invalid preview URL")?;
    let entries = registry.lock().map_err(|e| e.to_string())?;
    let record = entries.entries.get(token).ok_or("Preview has closed")?;
    if !record.owner.is_live() {
        return Err("Preview has closed".into());
    }
    let PreviewState::Ready(entry) = &record.state else {
        return Err("Preview has closed".into());
    };
    if relative == "index.html" {
        return Ok(Served::full(
            entry.content.as_bytes().to_vec(),
            "text/html; charset=utf-8",
        ));
    }
    let root = entry
        .root
        .as_ref()
        .ok_or("Relative assets are unavailable for remote previews")?
        .clone();
    let owner = record.owner.clone();
    drop(entries);
    // Filesystem latency must not hold the registry against close or unrelated previews.
    let asset = preview_asset(&root, relative)?;
    let served = read(&asset, range)?;
    let entries = registry.lock().map_err(|e| e.to_string())?;
    let current = entries.entries.get(token).ok_or("Preview has closed")?;
    if !Arc::ptr_eq(&current.owner, &owner)
        || !owner.is_live()
        || !matches!(current.state, PreviewState::Ready(_))
    {
        return Err("Preview has closed".into());
    }
    Ok(served)
}

/// Simultaneous asset reads across every preview window (the active-read ceiling).
const MAX_PREVIEW_READS: usize = 8;
/// Requests allowed to wait for a read slot; a page's sub-resource burst fits, a flood does not.
const MAX_PREVIEW_QUEUED: usize = 256;
/// Longest a request waits for a read slot before it is answered 503.
const PREVIEW_QUEUE_WAIT: Duration = Duration::from_secs(15);

struct PreviewBusy;

/// Bounded FIFO admission: at most `max_reads` run, at most `max_queued` wait, and no
/// request waits longer than `wait`. Everything past those bounds fails fast with 503.
struct PreviewAdmission {
    reads: Arc<Semaphore>,
    queued: AtomicUsize,
    max_queued: usize,
    wait: Duration,
}

/// Holds one queue position and frees it when the wait ends or the request is dropped.
struct QueueSlot<'a>(&'a AtomicUsize);
impl Drop for QueueSlot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl PreviewAdmission {
    fn new(max_reads: usize, max_queued: usize, wait: Duration) -> Self {
        Self {
            reads: Arc::new(Semaphore::new(max_reads)),
            queued: AtomicUsize::new(0),
            max_queued,
            wait,
        }
    }

    async fn acquire(&self) -> Result<OwnedSemaphorePermit, PreviewBusy> {
        if let Ok(permit) = self.reads.clone().try_acquire_owned() {
            return Ok(permit);
        }
        let slot = self
            .queued
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < self.max_queued).then_some(count + 1)
            })
            .map(|_| QueueSlot(&self.queued))
            .map_err(|_| PreviewBusy)?;
        let waited = tokio::time::timeout(self.wait, self.reads.clone().acquire_owned()).await;
        drop(slot);
        match waited {
            Ok(Ok(permit)) => Ok(permit),
            _ => Err(PreviewBusy),
        }
    }
}

pub fn respond_async(request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    static ADMISSION: OnceLock<PreviewAdmission> = OnceLock::new();
    let admission = ADMISSION.get_or_init(|| {
        PreviewAdmission::new(MAX_PREVIEW_READS, MAX_PREVIEW_QUEUED, PREVIEW_QUEUE_WAIT)
    });
    tauri::async_runtime::spawn(async move {
        let response = match admission.acquire().await {
            Ok(permit) => tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                respond(request)
            })
            .await
            .unwrap_or_else(|_| {
                preview_response(
                    500,
                    b"Preview read failed.".to_vec(),
                    "text/plain; charset=utf-8",
                    None,
                )
            }),
            Err(PreviewBusy) => preview_response(
                503,
                b"Preview is busy. Reload to retry.".to_vec(),
                "text/plain; charset=utf-8",
                None,
            ),
        };
        responder.respond(response);
    });
}

pub fn respond(request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let token = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or("");
    let background = previews().lock().ok().is_some_and(|registry| {
        registry.entries.get(token).is_some_and(
            |record| matches!(&record.state, PreviewState::Ready(preview) if preview.background),
        )
    });
    let result = if request.method() == tauri::http::Method::GET {
        preview_content(request.uri().path(), requested_range(&request))
    } else {
        Err("Unsupported preview request".into())
    };
    let mut response = match result {
        Ok(served) => preview_response(
            served.status,
            served.body,
            served.content_type,
            served.content_range,
        ),
        Err(error) => preview_response(404, error.into_bytes(), "text/plain; charset=utf-8", None),
    };
    if background {
        response.headers_mut().insert(
            "X-DNS-Prefetch-Control",
            tauri::http::HeaderValue::from_static("off"),
        );
        response.headers_mut().insert("Content-Security-Policy", tauri::http::HeaderValue::from_static(
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src about:; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
        ));
    }
    response
}

/// The `Range` the page asked for. `If-Range` names a validator this server cannot check
/// (assets have no ETag), so the Range is ignored and the body follows the normal rules.
fn requested_range(request: &tauri::http::Request<Vec<u8>>) -> Option<&str> {
    if request.headers().contains_key("if-range") {
        return None;
    }
    request.headers().get("range")?.to_str().ok()
}

fn preview_response(
    status: u16,
    body: Vec<u8>,
    content_type: &'static str,
    content_range: Option<String>,
) -> tauri::http::Response<Vec<u8>> {
    let mut builder = tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(range) = content_range {
        builder = builder.header("Content-Range", range);
    }
    builder
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
        .header("Permissions-Policy", "microphone=(), camera=(), display-capture=()")
        .body(body)
        .expect("static preview response headers")
}

fn html_file_url(path: &Path) -> Result<String, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("Could not open HTML file: {error}"))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !path.is_file()
        || !(extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm"))
    {
        return Err("Go Live requires an existing HTML file.".into());
    }
    url::Url::from_file_path(&path)
        .map(|url| url.to_string())
        .map_err(|_| "Could not create the HTML file URL.".into())
}

fn chrome_command() -> Command {
    #[cfg(windows)]
    {
        for variable in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
            if let Some(base) = std::env::var_os(variable) {
                let executable = PathBuf::from(base).join("Google/Chrome/Application/chrome.exe");
                if executable.is_file() {
                    return Command::new(executable);
                }
            }
        }
        Command::new("chrome.exe")
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/open");
        command.args(["-a", "Google Chrome"]);
        command
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Command::new("google-chrome")
    }
}

fn launch_html(path: &Path) -> Result<(), String> {
    let url = html_file_url(path)?;
    let mut command = chrome_command();
    #[cfg(not(target_os = "macos"))]
    command.arg("--new-tab");
    command.arg(url);
    crate::harness::apply_gui_env(&mut command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: no console helper.
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!("Could not open Google Chrome. Check that Chrome is installed: {error}")
        })?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[tauri::command(async)]
pub async fn open_html_in_chrome(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || launch_html(&PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_create(path: String, content: String) -> (Arc<WindowIssuer>, String) {
        let owner = Arc::new(WindowIssuer::default());
        let token = uuid::Uuid::new_v4().to_string();
        let mut entries = previews().lock().unwrap();
        entries.begin(&owner, &token).unwrap();
        entries
            .finish(&owner, &token, make_preview(path, content))
            .unwrap();
        (owner, token)
    }

    #[test]
    fn asset_read_allows_close_and_discards_late_bytes() {
        let folder =
            std::env::temp_dir().join(format!("bycoda-preview-read-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let html = folder.join("index.html");
        std::fs::write(&html, "preview").unwrap();
        std::fs::write(folder.join("asset.css"), "private content").unwrap();
        let owner = Arc::new(WindowIssuer::default());
        let token = uuid::Uuid::new_v4().to_string();
        let mut entries = PreviewRegistry::default();
        entries.begin(&owner, &token).unwrap();
        entries
            .finish(
                &owner,
                &token,
                make_preview(html.to_string_lossy().into(), "preview".into()),
            )
            .unwrap();
        let registry = Mutex::new(entries);
        let result =
            preview_content_with(&registry, &format!("/{token}/asset.css"), None, |_, _| {
                let mut registry = registry
                    .try_lock()
                    .expect("asset I/O must release registry");
                registry.close(&owner, &token).unwrap();
                Ok(Served::full(b"late private bytes".to_vec(), "text/css"))
            });
        assert_eq!(result.err().as_deref(), Some("Preview has closed"));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[tokio::test]
    async fn parallel_reads_beyond_the_ceiling_queue_and_all_complete() {
        let admission = Arc::new(PreviewAdmission::new(2, 16, Duration::from_secs(5)));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let tasks: Vec<_> = (0..10)
            .map(|_| {
                let (admission, running, peak) = (admission.clone(), running.clone(), peak.clone());
                tokio::spawn(async move {
                    let permit = admission.acquire().await.ok()?;
                    let now = running.fetch_add(1, Ordering::AcqRel) + 1;
                    peak.fetch_max(now, Ordering::AcqRel);
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    running.fetch_sub(1, Ordering::AcqRel);
                    drop(permit);
                    Some(())
                })
            })
            .collect();
        for task in tasks {
            assert!(task.await.unwrap().is_some(), "queued read must not 503");
        }
        assert_eq!(peak.load(Ordering::Acquire), 2);
        assert_eq!(admission.queued.load(Ordering::Acquire), 0);
        assert_eq!(admission.reads.available_permits(), 2);
    }

    #[tokio::test]
    async fn full_queue_and_expired_wait_answer_busy_and_free_their_slots() {
        let admission = Arc::new(PreviewAdmission::new(1, 1, Duration::from_millis(40)));
        let held = admission.acquire().await.ok().unwrap();
        let waiter = tokio::spawn({
            let admission = admission.clone();
            async move { admission.acquire().await.is_err() }
        });
        while admission.queued.load(Ordering::Acquire) == 0 {
            tokio::task::yield_now().await;
        }
        // The queue holds one waiter, so a further request is rejected immediately.
        assert!(admission.acquire().await.is_err());
        // The waiter hits the deadline while the read slot stays held.
        assert!(waiter.await.unwrap());
        assert_eq!(admission.queued.load(Ordering::Acquire), 0);
        drop(held);
        assert!(admission.acquire().await.is_ok());
        let response = preview_response(503, b"busy".to_vec(), "text/plain; charset=utf-8", None);
        assert_eq!(response.status(), 503);
        assert_eq!(response.headers()["Cache-Control"], "no-store");
        assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
    }

    #[test]
    fn plan_range_serves_bounded_slices_and_ignores_unsupported_forms() {
        let len = 1000;
        assert_eq!(
            plan_range(Some("bytes=0-99"), len),
            RangePlan::Partial { start: 0, end: 100 }
        );
        assert_eq!(
            plan_range(Some("bytes=500-"), len),
            RangePlan::Partial {
                start: 500,
                end: 1000
            }
        );
        // The last byte position is clamped to the file end, not rejected.
        assert_eq!(
            plan_range(Some("bytes=900-5000"), len),
            RangePlan::Partial {
                start: 900,
                end: 1000
            }
        );
        assert_eq!(
            plan_range(Some("bytes=-10"), len),
            RangePlan::Partial {
                start: 990,
                end: 1000
            }
        );
        assert_eq!(
            plan_range(Some("bytes=-5000"), len),
            RangePlan::Partial {
                start: 0,
                end: 1000
            }
        );
        assert_eq!(
            plan_range(Some("bytes=1000-"), len),
            RangePlan::Unsatisfiable
        );
        assert_eq!(plan_range(Some("bytes=-0"), len), RangePlan::Unsatisfiable);
        assert_eq!(plan_range(Some("bytes=-5"), 0), RangePlan::Unsatisfiable);
        // Multi-range, reversed, signed or non-bytes forms fall back to the full body.
        for header in [
            "bytes=0-1,4-5",
            "bytes=5-2",
            "bytes=+1-4",
            "bytes=a-b",
            "items=0-1",
            "bytes=",
        ] {
            assert_eq!(plan_range(Some(header), len), RangePlan::Full, "{header}");
        }
        assert_eq!(plan_range(None, len), RangePlan::Full);
    }

    #[test]
    fn partial_responses_carry_content_range_and_accept_ranges() {
        let response =
            preview_response(206, vec![1, 2], "video/mp4", Some("bytes 0-1/3000".into()));
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["Content-Range"], "bytes 0-1/3000");
        assert_eq!(response.headers()["Accept-Ranges"], "bytes");
        assert_eq!(response.headers()["Cache-Control"], "no-store");
    }

    #[test]
    fn retired_pages_reclaim_lost_replies_and_preserve_live_other_pages() {
        let mut registry = PreviewRegistry::default();
        let live = Arc::new(WindowIssuer::default());
        let active = uuid::Uuid::new_v4().to_string();
        registry.begin(&live, &active).unwrap();
        registry
            .finish(
                &live,
                &active,
                make_preview("remote://host/x".into(), "live".into()),
            )
            .unwrap();
        for _ in 0..100 {
            let old = Arc::new(WindowIssuer::default());
            let id = uuid::Uuid::new_v4().to_string();
            registry.begin(&old, &id).unwrap();
            registry
                .finish(
                    &old,
                    &id,
                    make_preview("remote://host/x".into(), "lost".into()),
                )
                .unwrap();
            tauri::Resource::close(old);
        }
        registry.reap();
        assert_eq!(registry.entries.len(), 1);
        assert!(matches!(
            registry.entries.get(&active).unwrap().state,
            PreviewState::Ready(_)
        ));
    }

    #[test]
    fn early_close_fences_late_creation_and_other_pages_cannot_close() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let foreign = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        registry.close(&owner, &id).unwrap();
        assert!(registry.close(&foreign, &id).is_err());
        assert!(registry.begin(&owner, &id).is_err());
        registry.close(&owner, &id).unwrap();
        assert!(registry.begin(&owner, &id).is_err());
    }

    #[test]
    fn close_during_creation_rejects_late_result_without_reopening() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let foreign = Arc::new(WindowIssuer::default());
        let token = uuid::Uuid::new_v4().to_string();
        registry.begin(&owner, &token).unwrap();
        registry.close(&owner, &token).unwrap();
        registry.close(&owner, &token).unwrap();
        assert!(matches!(
            registry.entries[&token].state,
            PreviewState::Cancelled
        ));
        assert!(registry
            .finish(
                &foreign,
                &token,
                make_preview("remote://host/x".into(), "late".into())
            )
            .is_err());
        assert!(registry
            .finish(
                &owner,
                &token,
                make_preview("remote://host/x".into(), "late".into())
            )
            .is_err());
        assert!(!registry.entries.contains_key(&token));
        assert!(registry.expired.contains(&token));
        assert!(registry.begin(&owner, &token).is_err());
    }

    #[test]
    fn pending_unknown_capacity_refuses_without_eviction() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let ids: Vec<_> = (0..64).map(|_| uuid::Uuid::new_v4().to_string()).collect();
        for id in &ids {
            registry.begin(&owner, id).unwrap();
        }
        assert!(registry
            .begin(&owner, &uuid::Uuid::new_v4().to_string())
            .is_err());
        assert!(ids.iter().all(|id| registry.entries.contains_key(id)));
        let delayed = uuid::Uuid::new_v4().to_string();
        registry.close(&owner, &delayed).unwrap();
        assert!(registry.begin(&owner, &delayed).is_err());
    }

    #[test]
    fn saturated_fence_refuses_admission_without_dropping_pending() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let pending = uuid::Uuid::new_v4().to_string();
        registry.begin(&owner, &pending).unwrap();
        registry.expired.set_bits = FENCE_BYTES * 8 / 4;
        assert!(registry
            .begin(&owner, &uuid::Uuid::new_v4().to_string())
            .is_err());
        assert!(registry.entries.contains_key(&pending));
    }

    #[test]
    fn exact_live_owner_precedes_fence_false_positive() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let foreign = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        registry.begin(&owner, &id).unwrap();
        registry
            .finish(
                &owner,
                &id,
                make_preview("remote://host/x".into(), "live".into()),
            )
            .unwrap();
        registry.expired.insert(&id);
        assert!(registry.close(&foreign, &id).is_err());
        registry.close(&owner, &id).unwrap();
        assert!(!registry.entries.contains_key(&id));
        assert!(registry.begin(&owner, &id).is_err());
    }

    #[test]
    fn completed_previews_release_live_capacity_for_same_owner() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let mut first = String::new();
        for i in 0..5000 {
            let id = uuid::Uuid::new_v4().to_string();
            if i == 0 {
                first = id.clone();
            }
            registry.begin(&owner, &id).unwrap();
            registry
                .finish(
                    &owner,
                    &id,
                    make_preview("remote://host/x".into(), "content".into()),
                )
                .unwrap();
            registry.close(&owner, &id).unwrap();
            registry.close(&owner, &id).unwrap();
        }
        assert!(registry.entries.is_empty());
        assert!(registry.begin(&owner, &first).is_err());
    }

    #[test]
    fn preview_serves_scripts_and_assets_only_inside_its_folder() {
        let root = std::env::temp_dir().join(format!("bycoda-preview-{}", uuid::Uuid::new_v4()));
        let folder = root.join("preview");
        std::fs::create_dir_all(&folder).unwrap();
        let html = folder.join("page.html");
        std::fs::write(&html, "disk content").unwrap();
        std::fs::write(folder.join("mağaza #1.css"), "body { color: red }").unwrap();
        std::fs::write(root.join("secret.txt"), "secret").unwrap();
        let (owner, token) = test_create(
            html.to_string_lossy().into(),
            "<script>document.body.textContent='live'</script>".into(),
        );
        let response = respond(
            tauri::http::Request::builder()
                .uri(format!("html-preview://localhost/{token}/index.html"))
                .body(vec![])
                .unwrap(),
        );
        assert_eq!(response.status(), 200);
        assert!(String::from_utf8(response.into_body())
            .unwrap()
            .contains("<script>"));
        let served = preview_content(&format!("/{token}/ma%C4%9Faza%20%231.css"), None).unwrap();
        assert_eq!(served.content_type, "text/css; charset=utf-8");
        assert!(preview_content(&format!("/{token}/../secret.txt"), None).is_err());
        assert!(preview_content(&format!("/{token}/%2e%2e/secret.txt"), None).is_err());
        assert!(preview_content(&format!("/{token}/file:///secret.txt"), None).is_err());
        previews().lock().unwrap().close(&owner, &token).unwrap();
        assert!(preview_content(&format!("/{token}/index.html"), None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_rejects_hidden_files_and_folders() {
        let root = std::env::temp_dir().join(format!("bycoda-hidden-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join(".env"), "TOKEN=1").unwrap();
        std::fs::write(root.join(".git/config"), "[core]").unwrap();
        std::fs::write(root.join("assets/.secret"), "x").unwrap();
        std::fs::write(root.join("assets/app.js"), "1").unwrap();
        let root = root.canonicalize().unwrap();
        assert!(preview_asset(&root, ".env").is_err());
        assert!(preview_asset(&root, ".git/config").is_err());
        assert!(preview_asset(&root, "assets/.secret").is_err());
        assert!(preview_asset(&root, "assets/../.env").is_err());
        assert!(preview_asset(&root, "assets/app.js").is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remote_preview_uses_supplied_content_without_local_assets() {
        let (owner, token) = test_create(
            "remote://mac/repo/page.html".into(),
            "<h1>Remote</h1>".into(),
        );
        assert_eq!(
            preview_content(&format!("/{token}/index.html"), None)
                .unwrap()
                .body,
            b"<h1>Remote</h1>"
        );
        assert!(preview_content(&format!("/{token}/style.css"), None).is_err());
        previews().lock().unwrap().close(&owner, &token).unwrap();
    }

    #[test]
    fn html_urls_preserve_special_characters_and_reject_other_files() {
        let root = std::env::temp_dir().join(format!("bycoda-html-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let html = root.join("mağaza #1 %.HTML");
        std::fs::write(&html, "<html></html>").unwrap();
        let url = html_file_url(&html).unwrap();
        assert!(url.starts_with("file:///"));
        assert!(url.contains("%23"));
        assert!(url.contains("%25"));
        assert_eq!(
            url::Url::parse(&url)
                .unwrap()
                .to_file_path()
                .unwrap()
                .canonicalize()
                .unwrap(),
            html.canonicalize().unwrap()
        );
        let htm = root.join("page.htm");
        std::fs::write(&htm, "hello").unwrap();
        assert!(html_file_url(&htm).is_ok());
        let other = root.join("script.js");
        std::fs::write(&other, "hello").unwrap();
        assert!(html_file_url(&other).is_err());
        assert!(html_file_url(&root).is_err());
        assert!(html_file_url(&root.join("missing.html")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
