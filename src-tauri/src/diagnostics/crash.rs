use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const MESSAGE_LIMIT: usize = 2000;
const BACKTRACE_LIMIT: usize = 20_000;
static CRASH_PATH: OnceLock<PathBuf> = OnceLock::new();
/// Set once this process wrote a marker, so a clean exit can tell a recovered panic from a crash.
static WROTE_MARKER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CrashMarker {
    pub message: String,
    pub location: Option<String>,
    pub thread: Option<String>,
    pub backtrace: String,
    pub occurred_at: String,
    pub app_version: String,
}

/// Truncate on a char boundary, never inside a character.
pub(super) fn truncate_chars(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => text[..index].to_string(),
        None => text.to_string(),
    }
}

pub(super) fn marker_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("diagnostics").join("last-crash.json")
}

pub(crate) fn install_panic_hook(app_data_dir: &Path) {
    if CRASH_PATH.set(marker_path(app_data_dir)).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| record(info)));
        previous(info);
    }));
}

fn record(info: &std::panic::PanicHookInfo<'_>) {
    let Some(path) = CRASH_PATH.get() else { return };
    let payload = info.payload();
    let message = payload
        .downcast_ref::<&str>()
        .map(|text| (*text).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "Box<dyn Any>".into());
    let location = info
        .location()
        .map(|at| format!("{}:{}:{}", at.file(), at.line(), at.column()));
    log::error!(
        target: "panic",
        "{} ({})",
        truncate_chars(&message, MESSAGE_LIMIT),
        location.as_deref().unwrap_or("unknown location")
    );
    let marker = CrashMarker {
        message: truncate_chars(&message, MESSAGE_LIMIT),
        location,
        thread: std::thread::current().name().map(str::to_string),
        backtrace: truncate_chars(
            &std::backtrace::Backtrace::force_capture().to_string(),
            BACKTRACE_LIMIT,
        ),
        occurred_at: now_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    if let Ok(raw) = serde_json::to_vec(&marker) {
        if write_atomic(path, &raw).is_ok() {
            WROTE_MARKER.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    super::file_log::flush();
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Temp file, fsync, then rename (rule rust-rename-without-fsync).
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

pub(super) fn read_marker(path: &Path) -> Option<CrashMarker> {
    let raw = std::fs::read(path)
        .ok()
        .filter(|raw| raw.len() <= 256 * 1024)?;
    serde_json::from_slice(&raw).ok()
}

pub(super) fn render_marker(marker: &CrashMarker) -> String {
    format!(
        "message: {}\nlocation: {}\nthread: {}\noccurredAt: {}\nappVersion: {}\nbacktrace:\n{}\n",
        marker.message,
        marker.location.as_deref().unwrap_or("unknown"),
        marker.thread.as_deref().unwrap_or("unknown"),
        marker.occurred_at,
        marker.app_version,
        marker.backtrace
    )
}

pub(super) fn installed_path() -> Option<&'static PathBuf> {
    CRASH_PATH.get()
}

/// Called on a clean exit: a panic this process survived (caught by `catch_unwind` or on a
/// background thread) is not a crash, so its marker is removed. A marker from an earlier run
/// that the user has not answered yet stays.
pub(crate) fn clear_recovered_on_exit() {
    if WROTE_MARKER.swap(false, std::sync::atomic::Ordering::SeqCst) {
        let _ = remove_marker(CRASH_PATH.get().map(PathBuf::as_path));
    }
}

/// Removes the native marker and the Host marker (the user answered the report prompt).
pub(super) fn clear() -> Result<(), String> {
    let native = remove_marker(CRASH_PATH.get().map(PathBuf::as_path));
    let host = remove_marker(super::logs::host_crash_path().as_deref());
    native.and(host)
}

fn remove_marker(path: Option<&Path>) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
