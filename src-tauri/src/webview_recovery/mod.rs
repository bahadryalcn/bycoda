//! Recovery from WebView2 process failures (Windows).
//!
//! A WebView2 browser process that dies (for example on a commit-limit
//! failure) leaves every window open and black, and the runtime then logs
//! the same error every few milliseconds until Windows kills the hung app.
//! The `ProcessFailed` event is the only signal, so each webview registers
//! for it and the policy decides between reloading, relaunching and stopping.
//!
//! Browser-process exit relaunches the app instead of recreating windows:
//! the browser process is shared, so every window's webview is dead, and
//! destroying a window runs its teardown (terminals, forwards, and, for the
//! last window, provider processes) anyway. A dead webview cannot answer the
//! quit prompt, so a native dialog asks first whenever a relaunch would stop
//! an owned Host, desktop agents or terminals.

mod policy;
#[cfg(windows)]
mod webview2;

pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri::plugin::Builder::new("webview-recovery");
    #[cfg(windows)]
    let builder = builder.on_webview_ready(|webview| webview2::register(&webview));
    builder.build()
}
