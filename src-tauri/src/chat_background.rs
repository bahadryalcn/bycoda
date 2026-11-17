use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::fs::expand_home;
pub mod design;
pub mod preview;
pub mod reclaim;

const MAX_BACKGROUND_BYTES: u64 = 25 * 1024 * 1024;
const ALLOWED_EXT: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "html", "htm",
];

pub(crate) fn backgrounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backgrounds");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn background_extension(source: &Path) -> Result<String, String> {
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ALLOWED_EXT.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err("Background must be a PNG, JPG, GIF, WebP, MP4, WebM, or HTML file.".into())
    }
}

/// Checks that `source` is a regular, small-enough image file and returns its lowercase extension.
pub(crate) fn validate_background_file(source: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(source).map_err(|e| format!("{}: {e}", source.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    let ext = background_extension(source)?;
    let limit = match ext.as_str() {
        "mp4" | "webm" => 100 * 1024 * 1024,
        "html" | "htm" => 2 * 1024 * 1024,
        _ => MAX_BACKGROUND_BYTES,
    };
    if meta.len() == 0 || meta.len() > limit {
        return Err(format!(
            "Background must contain between 1 and {limit} bytes."
        ));
    }
    Ok(ext)
}

fn save_chat_background_sync(app: &AppHandle, source_path: &str) -> Result<String, String> {
    let source = expand_home(source_path);
    store_background(app, &source)
}

/// Immutable asset paths keep previous selections usable if preference writes fail.
fn store_background(app: &AppHandle, source: &Path) -> Result<String, String> {
    let ext = validate_background_file(source)?;
    let bytes = read_background_bytes(source, &ext)?;
    store_background_bytes(app, &bytes, &ext)
}

pub(crate) fn read_background_bytes(source: &Path, ext: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let limit = match ext {
        "mp4" | "webm" => 100 * 1024 * 1024,
        "html" | "htm" => 2 * 1024 * 1024,
        _ => MAX_BACKGROUND_BYTES,
    };
    let mut bytes = Vec::new();
    std::fs::File::open(source)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err("Background size changed while importing".into());
    }
    validate_background_bytes(&bytes, ext)?;
    Ok(bytes)
}

fn validate_background_bytes(bytes: &[u8], ext: &str) -> Result<(), String> {
    let valid = match ext {
        "html" | "htm" => std::str::from_utf8(bytes).is_ok_and(|text| !text.trim().is_empty()),
        "mp4" => bytes.len() >= 12 && &bytes[4..8] == b"ftyp",
        "webm" => bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("Background content does not match its file type".into())
    }
}

/// Serializes saves into the store with the reference sweep.
pub(crate) fn store_lock() -> &'static std::sync::Mutex<()> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(()))
}

fn store_background_bytes(app: &AppHandle, bytes: &[u8], ext: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let _guard = store_lock().lock().map_err(|e| e.to_string())?;
    let id = format!("{:x}", Sha256::digest(bytes));
    let dest = backgrounds_dir(app)?.join(format!("asset-{id}.{ext}"));
    // A torn or truncated earlier write must not be trusted just because the name exists.
    let intact =
        std::fs::metadata(&dest).is_ok_and(|m| m.is_file() && m.len() == bytes.len() as u64);
    if intact {
        // Reuse counts as fresh so the reference sweep spares it until the caller records it.
        if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&dest) {
            let _ = file.set_modified(std::time::SystemTime::now());
        }
    } else {
        let mut total = bytes.len() as u64;
        for entry in std::fs::read_dir(backgrounds_dir(app)?).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
        if total > 400 * 1024 * 1024 {
            return Err("Background asset store is full (400 MiB)".into());
        }
        crate::file_access::durable_write(&dest, bytes)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn save_project_chat_background_sync(
    app: &AppHandle,
    project: &str,
    source_path: &str,
) -> Result<String, String> {
    if project.trim().is_empty() {
        return Err("Project is required".into());
    }
    let source = expand_home(source_path);
    store_background(app, &source)
}

#[tauri::command]
pub async fn save_chat_background(app: AppHandle, source_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || save_chat_background_sync(&app, &source_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_chat_background() -> Result<(), String> {
    // Disabling clears the renderer preference; retained designs remain restorable.
    Ok(())
}

#[tauri::command]
pub async fn save_project_chat_background(
    app: AppHandle,
    project: String,
    source_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_project_chat_background_sync(&app, &project, &source_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_project_chat_background(project: String) -> Result<(), String> {
    if project.trim().is_empty() {
        return Err("Project is required".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_extensions_case_insensitively() {
        assert_eq!(
            background_extension(Path::new("scene.HTML")).unwrap(),
            "html"
        );
        assert_eq!(background_extension(Path::new("scene.MP4")).unwrap(), "mp4");
        assert_eq!(
            background_extension(Path::new("scene.webm")).unwrap(),
            "webm"
        );
        assert_eq!(
            background_extension(Path::new("wallpaper.JPEG")).unwrap(),
            "jpeg"
        );
        assert_eq!(
            background_extension(Path::new("wallpaper.webp")).unwrap(),
            "webp"
        );
    }

    #[test]
    fn rejects_files_the_webview_cannot_render_as_backgrounds() {
        assert!(background_extension(Path::new("wallpaper.txt")).is_err());
        assert!(background_extension(Path::new("wallpaper")).is_err());
    }

    #[test]
    fn validates_media_signatures_and_utf8_without_executing_content() {
        assert!(validate_background_bytes(b"not video", "mp4").is_err());
        assert!(validate_background_bytes(b"1234ftypisom", "mp4").is_ok());
        assert!(validate_background_bytes(&[0x1a, 0x45, 0xdf, 0xa3], "webm").is_ok());
        assert!(validate_background_bytes(&[0xff], "html").is_err());
        assert!(validate_background_bytes(b"   ", "html").is_err());
        assert!(validate_background_bytes(b"<script>throw 1</script>", "html").is_ok());
    }
}
