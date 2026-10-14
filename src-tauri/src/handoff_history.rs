use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
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
#[tauri::command(async)]
pub fn handoff_history_read(
    app: AppHandle,
    session_id: String,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let history: Value = serde_json::from_slice(
        &fs::read(path(&app, &session_id)?).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let messages = history["messages"].as_array().ok_or("Invalid history")?;
    let start = cursor.unwrap_or(0).min(messages.len());
    let end = start
        .saturating_add(limit.unwrap_or(20).clamp(1, 100))
        .min(messages.len());
    Ok(
        json!({"messages":messages[start..end],"nextCursor":if end < messages.len() {Some(end)} else {None}}),
    )
}
