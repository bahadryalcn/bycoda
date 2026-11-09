//! WebView2 browser arguments shared by dynamically created windows.
//!
//! Every window shares one WebView2 data directory, and WebView2 refuses a
//! second environment whose options differ (HRESULT 0x8007139F). The main
//! window's configured arguments can change at launch (the opt-in DevTools
//! port), and `WebviewWindowBuilder::new` does not inherit them, so every
//! window built in code copies them through `inherit_main_browser_args`.

use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};

fn configured_main_browser_args(windows: &[tauri::utils::config::WindowConfig]) -> Option<&str> {
    windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.as_deref())
}

/// Applies the main window's configured browser arguments, if any.
pub(crate) fn inherit_main_browser_args<'a, R: Runtime, M: Manager<R>>(
    app: &AppHandle<R>,
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    match configured_main_browser_args(&app.config().app.windows) {
        Some(args) => builder.additional_browser_args(args),
        None => builder,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_windows_inherit_only_the_actual_main_windows_browser_args() {
        let main_args = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --remote-debugging-port=19771";
        let auxiliary = tauri::utils::config::WindowConfig {
            label: "other-window".into(),
            additional_browser_args: Some("--another-window-option".into()),
            ..Default::default()
        };
        let main = tauri::utils::config::WindowConfig {
            label: "main".into(),
            additional_browser_args: Some(main_args.into()),
            ..Default::default()
        };
        let windows = [auxiliary, main];
        assert_eq!(configured_main_browser_args(&windows), Some(main_args));
        assert_eq!(configured_main_browser_args(&windows[..1]), None);
        let mut release = windows[1].clone();
        release.additional_browser_args = None;
        assert_eq!(configured_main_browser_args(&[release]), None);
    }
}
