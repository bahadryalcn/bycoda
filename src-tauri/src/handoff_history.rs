use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};
use tauri::{AppHandle, Manager};
fn path(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty() || session_id.len() > 200 {
        return Err("Invalid session id".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("handoff-history")
        .join(format!("{:x}.json", Sha256::digest(session_id.as_bytes()))))
}
#[tauri::command(async)]
pub fn handoff_history_save(app: AppHandle, history: Value) -> Result<Value, String> {
    let id = history["sessionId"].as_str().ok_or("Invalid session id")?;
    let messages = history["messages"]
        .as_array()
        .ok_or("Invalid handoff messages")?;
    if messages.len() > 20_000
        || messages.iter().any(|message| {
            message["id"].as_str().is_none()
                || message["text"].as_str().is_none()
                || !matches!(
                    message["role"].as_str(),
                    Some("user" | "assistant" | "plan" | "tasks")
                )
        })
    {
        return Err("Invalid handoff messages".into());
    }
    let bytes = serde_json::to_vec(&history).map_err(|error| error.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Handoff history exceeds 8 MiB".into());
    }
    let target = path(&app, id)?;
    fs::create_dir_all(target.parent().ok_or("Invalid archive path")?)
        .map_err(|error| error.to_string())?;
    let temp = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, bytes).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    fs::rename(temp, &target).map_err(|error| error.to_string())?;
    Ok(json!({"path":target.to_string_lossy()}))
}
struct Cached {
    path: PathBuf,
    modified: Option<SystemTime>,
    len: u64,
    history: Arc<Value>,
}
// Paging an archive reads it once: the newest parsed file is kept until its size or mtime changes.
// shortcut: one cached archive, replaced when another session is paged; add an LRU if two are paged at once.
static CACHE: Mutex<Option<Cached>> = Mutex::new(None);
fn load(path: &Path) -> Result<Arc<Value>, String> {
    // The stamp is taken before the read, so a file replaced mid-read is parsed again next time.
    let info = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = info.modified().ok();
    if let Some(cached) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if modified.is_some()
            && cached.path == path
            && cached.modified == modified
            && cached.len == info.len()
        {
            return Ok(cached.history.clone());
        }
    }
    let history = Arc::new(
        serde_json::from_slice::<Value>(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?,
    );
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Cached {
        path: path.to_path_buf(),
        modified,
        len: info.len(),
        history: history.clone(),
    });
    Ok(history)
}
#[tauri::command(async)]
pub fn handoff_history_read(
    app: AppHandle,
    session_id: String,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let history = load(&path(&app, &session_id)?)?;
    page(history.as_ref(), cursor, limit)
}
fn page(history: &Value, cursor: Option<usize>, limit: Option<usize>) -> Result<Value, String> {
    let messages = history["messages"].as_array().ok_or("Invalid history")?;
    let start = cursor.unwrap_or(0).min(messages.len());
    let end = start
        .saturating_add(limit.unwrap_or(20).clamp(1, 100))
        .min(messages.len());
    let mut response = json!({"messages":messages[start..end],"nextCursor":if end < messages.len() {Some(end)} else {None}});
    if start == 0 && history["retainedContext"].is_string() {
        response["retainedContext"] = history["retainedContext"].clone();
    }
    Ok(response)
}
#[cfg(test)]
mod tests {
    use super::*;

    fn history(count: usize) -> Value {
        let messages: Vec<Value> = (0..count)
            .map(|index| json!({"id":format!("m{index}"),"role":"user","text":"text"}))
            .collect();
        json!({"sessionId":"s","retainedContext":"kept","messages":messages})
    }

    #[test]
    fn pages_with_cursor_and_returns_retained_context_on_the_first_page_only() {
        let history = history(5);
        let first = page(&history, None, Some(2)).unwrap();
        assert_eq!(first["messages"].as_array().unwrap().len(), 2);
        assert_eq!(first["nextCursor"], 2);
        assert_eq!(first["retainedContext"], "kept");
        let last = page(&history, Some(4), Some(100)).unwrap();
        assert_eq!(last["messages"][0]["id"], "m4");
        assert!(last.get("nextCursor").is_none() || last["nextCursor"].is_null());
        assert!(last.get("retainedContext").is_none());
        assert!(page(&json!({}), None, None).is_err());
    }

    #[test]
    fn parses_an_archive_once_per_file_version_across_pages() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("history.json");
        fs::write(&file, serde_json::to_vec(&history(3)).unwrap()).unwrap();
        let first = load(&file).unwrap();
        assert!(Arc::ptr_eq(&first, &load(&file).unwrap()));
        // A rewritten archive has another size, so the cached parse is dropped.
        fs::write(&file, serde_json::to_vec(&history(4)).unwrap()).unwrap();
        let rewritten = load(&file).unwrap();
        assert!(!Arc::ptr_eq(&first, &rewritten));
        assert_eq!(rewritten["messages"].as_array().unwrap().len(), 4);
        assert!(load(&directory.path().join("missing.json")).is_err());
    }
}
