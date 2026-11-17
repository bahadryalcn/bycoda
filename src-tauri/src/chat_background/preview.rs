use std::io::Read;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn save_chat_background_html(app: AppHandle, content: String) -> Result<String, String> {
    if content.trim().is_empty() || content.len() > 2 * 1024 * 1024 {
        return Err("HTML background must contain 1 to 2097152 UTF-8 bytes".into());
    }
    // Stored by content hash (store_background_bytes), so identical previews dedupe.
    // shortcut: no orphan GC for previews, add when library exposes a reference set
    tauri::async_runtime::spawn_blocking(move || {
        super::store_background_bytes(&app, content.as_bytes(), "html")
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Only imported app-owned HTML can be read. A chosen file never grants its folder.
#[tauri::command]
pub async fn read_chat_background_html(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backgrounds")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let file = std::path::Path::new(&path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !file.starts_with(&root) {
            return Err("Background is outside the asset store".into());
        }
        let ext = super::validate_background_file(&file)?;
        if ext != "html" && ext != "htm" {
            return Err("Background is not HTML".into());
        }
        let mut bytes = Vec::new();
        std::fs::File::open(file)
            .map_err(|e| e.to_string())?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("HTML background is too large".into());
        }
        String::from_utf8(bytes).map_err(|_| "HTML background must be UTF-8 text".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
