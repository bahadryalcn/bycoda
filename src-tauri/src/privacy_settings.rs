//! Opens an allowlisted OS permission pane after an explicit owner action.
//! Opening settings never grants permission or proves capture is available.

/// Panes the UI may open. The frontend names a capability, never a URL.
fn pane_url(pane: &str, platform: &str) -> Option<&'static str> {
    match (platform, pane) {
        ("macos", "screen-recording") => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        }
        ("macos", "microphone") => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        }
        ("macos", "files-and-folders") => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")
        }
        ("windows", "microphone") => Some("ms-settings:privacy-microphone"),
        _ => None,
    }
}

#[tauri::command(async)]
pub async fn open_privacy_settings(pane: String) -> Result<(), String> {
    let url = pane_url(&pane, std::env::consts::OS)
        .ok_or_else(|| "This privacy settings pane is not supported on this system.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || open(url))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn open(url: &str) -> Result<(), String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let mut child = std::process::Command::new("/usr/bin/open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err("Could not open system privacy settings.".into()),
            Ok(None) if started.elapsed() < Duration::from_secs(5) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => error.to_string(),
                    _ => "Opening system privacy settings timed out.".into(),
                });
            }
        }
    }
}

#[cfg(windows)]
fn open(url: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    // Native URI dispatch avoids a console, shell interpolation, and a helper
    // process. Only the static allowlisted URL above can reach this boundary.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result > 32 {
        Ok(())
    } else {
        Err(format!(
            "Could not open system privacy settings (code {result})."
        ))
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn open(_url: &str) -> Result<(), String> {
    Err("Open your system sound settings and app microphone permissions manually.".into())
}

#[cfg(test)]
mod tests {
    use super::pane_url;

    #[test]
    fn only_known_panes_resolve() {
        assert!(pane_url("screen-recording", "macos")
            .unwrap()
            .ends_with("Privacy_ScreenCapture"));
        assert!(pane_url("microphone", "macos")
            .unwrap()
            .ends_with("Privacy_Microphone"));
        assert_eq!(
            pane_url("microphone", "windows"),
            Some("ms-settings:privacy-microphone")
        );
        for platform in ["macos", "windows", "linux"] {
            assert!(pane_url("https://example.com", platform).is_none());
            assert!(pane_url("ms-settings:privacy-microphone", platform).is_none());
        }
        assert!(pane_url("microphone", "linux").is_none());
        assert!(pane_url("screen-recording", "windows").is_none());
        assert!(pane_url("files-and-folders", "windows").is_none());
    }
}
