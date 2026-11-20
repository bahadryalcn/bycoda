use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::native_window_lifecycle::{admit_window_buffers, run_admitted_blocking};

/// Same ceiling as the Host attachment read cap; larger files are never held by the renderer.
const MAX_COPY_BYTES: usize = 20 * 1024 * 1024;

/// A suggestion for the dialog only; the owner types the final destination.
fn suggested_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        "attachment".into()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// "Save a copy" for bytes the renderer already holds (an attachment read through its
/// session-authorized reader). The native Save dialog is the only authority: nothing is written
/// before the owner picks a destination, the dialog confirms an overwrite, and the bytes are
/// written as data, never opened or executed. Returns `false` when the owner cancels.
#[tauri::command]
pub async fn save_file_copy(
    window: tauri::Window,
    name: String,
    data: String,
) -> Result<bool, String> {
    if data.len() > MAX_COPY_BYTES.div_ceil(3) * 4 {
        return Err("File is too large to save (maximum 20 MB).".into());
    }
    let admission = admit_window_buffers(&window)?;
    let app = window.app_handle().clone();
    run_admitted_blocking(admission, move || {
        let bytes = STANDARD
            .decode(data.as_bytes())
            .map_err(|_| "The attachment data is invalid.".to_string())?;
        if bytes.len() > MAX_COPY_BYTES {
            return Err("File is too large to save (maximum 20 MB).".into());
        }
        let selected = app
            .dialog()
            .file()
            .set_title("Save a copy")
            .set_file_name(suggested_name(&name))
            .set_parent(&window)
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let destination = selected
            .into_path()
            .map_err(|_| "The selected destination is unavailable.".to_string())?;
        crate::file_access::durable_write(&destination, &bytes)?;
        Ok(true)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::suggested_name;

    #[test]
    fn suggestion_never_carries_a_path_or_control_characters() {
        assert_eq!(
            suggested_name("..\\..\\evil/bundle.zip"),
            "_.._evil_bundle.zip"
        );
        assert_eq!(suggested_name("a\u{0}b:c.zip"), "a_b_c.zip");
        assert_eq!(suggested_name("  ..  "), "attachment");
        assert_eq!(suggested_name(&"x".repeat(500)).chars().count(), 120);
    }
}
