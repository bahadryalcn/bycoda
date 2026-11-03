//! Opens the macOS Privacy & Security pane that governs a capability bycoda
//! was denied, so permission errors can offer a direct recovery action.
//! Other platforms have no equivalent per-app pane and return an error.

/// Panes the UI may open. The frontend names a capability, never a URL.
fn pane_url(pane: &str) -> Option<&'static str> {
    match pane {
        "screen-recording" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        }
        "microphone" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        }
        "files-and-folders" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")
        }
        _ => None,
    }
}

#[tauri::command]
pub fn open_privacy_settings(pane: String) -> Result<(), String> {
    let url = pane_url(&pane).ok_or_else(|| format!("Unknown privacy pane: {pane}"))?;
    open(url)
}

#[cfg(target_os = "macos")]
fn open(url: &str) -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "macos"))]
fn open(_url: &str) -> Result<(), String> {
    Err("Privacy settings are only available on macOS.".into())
}

#[cfg(test)]
mod tests {
    use super::pane_url;

    #[test]
    fn only_known_panes_resolve() {
        assert!(pane_url("screen-recording")
            .unwrap()
            .ends_with("Privacy_ScreenCapture"));
        assert!(pane_url("microphone")
            .unwrap()
            .ends_with("Privacy_Microphone"));
        assert!(pane_url("https://example.com").is_none());
    }
}
