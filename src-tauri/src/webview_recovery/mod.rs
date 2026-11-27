//! Recovery from WebView2 process failures (Windows).
//!
//! A WebView2 browser process that dies (for example on a commit-limit
//! failure) leaves every window open and black, and the runtime then logs
//! the same error every few milliseconds until Windows kills the hung app.
//! A renderer exit reloads the page. A browser exit replaces the webviews
//! in their existing native windows, preserving window-owned work. If that
//! fails, the native dialog still guards a relaunch that would interrupt work.

mod policy;
#[cfg(windows)]
mod recreate;
#[cfg(windows)]
mod webview2;

pub(crate) fn remember_config(config: &tauri::utils::config::WindowConfig) {
    #[cfg(windows)]
    recreate::remember_config(config);
    #[cfg(not(windows))]
    let _ = config;
}

pub(crate) fn forget_config(label: &str) {
    #[cfg(windows)]
    recreate::forget(label);
    #[cfg(not(windows))]
    let _ = label;
}

#[cfg(windows)]
pub(crate) fn is_rebuilding() -> bool {
    recreate::is_rebuilding()
}

pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri::plugin::Builder::new("webview-recovery");
    #[cfg(windows)]
    let builder = builder
        .on_webview_ready(|webview| webview2::register(&webview))
        .on_event(|_, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = event
            {
                recreate::forget(label);
            }
        });
    builder.build()
}
