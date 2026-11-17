//! Windows presentation and an explicit, cancellable region capture.
use base64::Engine;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;
use tauri::WebviewWindow;

pub(super) fn present(panel: &WebviewWindow) {
    let _ = panel.show();
    let _ = panel.set_focus();
}

/// Logical desktop coordinates; monitor origins can be negative.
pub(super) fn popup_frame(
    parent: (f64, f64),
    screen: (f64, f64, f64, f64),
    anchor: (f64, f64, f64, f64),
    height: f64,
) -> (f64, f64, f64, f64) {
    let width = super::git_popup::WIDTH.min(screen.2);
    let height = height
        .clamp(1.0, super::git_popup::MAX_HEIGHT)
        .min(screen.3);
    let x = (parent.0 + anchor.0).clamp(screen.0, screen.0 + screen.2 - width);
    let below = parent.1 + anchor.1 + anchor.3 + 6.0;
    let y = if below + height <= screen.1 + screen.3 {
        below
    } else {
        parent.1 + anchor.1 - height - 6.0
    }
    .clamp(screen.1, screen.1 + screen.3 - height);
    (x, y, width, height)
}

pub(super) fn capture_screenshot() -> Result<Option<String>, String> {
    let path = super::screenshots::new_path()?;
    let script = include_str!("capture-windows.ps1");
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let powershell = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .ok_or("Windows system directory is unavailable.")?
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let result = crate::fs::output_with_timeout(
        Command::new(powershell)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-EncodedCommand",
                &encoded,
            ])
            .env("BYCODA_CAPTURE_PATH", &path)
            .creation_flags(0x08000000),
        Duration::from_secs(120),
    );
    if let Err(error) = result.as_ref() {
        let _ = std::fs::remove_file(&path);
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir(dir);
        }
        return Err(format!("Could not take a screenshot: {error}"));
    }
    let output = result.map_err(|err| err.to_string())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&path);
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir(dir);
        }
        return Err("Could not take a screenshot. Try again or attach an image file.".into());
    }
    if path.is_file() {
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .and_then(|file| file.sync_all())
            .map_err(|err| err.to_string())?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::popup_frame;

    #[test]
    fn picker_flips_and_clamps_on_a_negative_monitor() {
        assert_eq!(
            popup_frame(
                (-800.0, 600.0),
                (-1000.0, 0.0, 1000.0, 900.0),
                (120.0, 16.0, 70.0, 24.0),
                280.0
            ),
            (-680.0, 330.0, 320.0, 280.0)
        );
        assert_eq!(
            popup_frame(
                (-800.0, 400.0),
                (-1000.0, 0.0, 1000.0, 900.0),
                (120.0, 16.0, 70.0, 24.0),
                280.0
            ),
            (-680.0, 446.0, 320.0, 280.0)
        );
    }
}
