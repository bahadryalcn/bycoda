//! Media permission decisions for every bycoda webview.
//!
//! Without a handler wry grants camera and microphone to any origin on macOS,
//! and WebView2 shows its own sticky allow/block prompt on Windows that
//! Windows Settings cannot undo. bycoda decides instead: microphone and
//! clipboard read (editor paste) for its own pages, everything else denied.
//!
//! Tauri passes no requesting origin, so the decision uses the webview's
//! top-level URL. That is safe: Permissions Policy defaults microphone, camera
//! and display-capture to 'self', so a cross-origin iframe cannot ask unless
//! the page delegates with `allow=`, and HtmlPreview's iframe sets
//! `allow="microphone 'none'; camera 'none'; display-capture 'none'"`.

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::Manager;

fn is_app_origin(url: &url::Url) -> bool {
    let local_app = url.scheme() == "tauri" && url.host_str() == Some("localhost");
    let custom_protocol =
        matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost");
    (local_app || custom_protocol) && url.port().is_none()
}

fn decide(url: &str, kind: PermissionKind, dev_url: Option<&str>) -> PermissionResponse {
    if !matches!(
        kind,
        PermissionKind::Microphone | PermissionKind::ClipboardRead
    ) {
        return PermissionResponse::Deny;
    }
    let Ok(url) = url::Url::parse(url) else {
        return PermissionResponse::Deny;
    };
    let dev = dev_url
        .and_then(|value| url::Url::parse(value).ok())
        .is_some_and(|dev| url.origin() == dev.origin());
    if is_app_origin(&url) || dev {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Deny
    }
}

pub fn handle<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    kind: PermissionKind,
) -> PermissionResponse {
    // The dev server origin is trusted only in debug builds.
    let dev_url = cfg!(debug_assertions)
        .then(|| webview.app_handle().config().build.dev_url.clone())
        .flatten();
    match webview.url() {
        Ok(url) => decide(url.as_str(), kind, dev_url.as_ref().map(|u| u.as_str())),
        Err(_) => PermissionResponse::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str, kind: PermissionKind, dev: Option<&str>) -> bool {
        matches!(decide(url, kind, dev), PermissionResponse::Allow)
    }

    #[test]
    fn microphone_only_for_app_origins() {
        assert!(allowed(
            "tauri://localhost/index.html",
            PermissionKind::Microphone,
            None
        ));
        assert!(allowed(
            "http://tauri.localhost/",
            PermissionKind::Microphone,
            None
        ));
        assert!(allowed(
            "https://tauri.localhost/voice-overlay.html",
            PermissionKind::Microphone,
            None
        ));
        assert!(!allowed(
            "http://tauri.localhost.evil.com/",
            PermissionKind::Microphone,
            None
        ));
        assert!(!allowed(
            "http://tauri.localhost:8080/",
            PermissionKind::Microphone,
            None
        ));
        assert!(!allowed(
            "https://example.com/",
            PermissionKind::Microphone,
            None
        ));
        assert!(!allowed("not a url", PermissionKind::Microphone, None));
    }

    #[test]
    fn dev_server_only_when_configured() {
        let dev = Some("http://localhost:1420/");
        assert!(allowed(
            "http://localhost:1420/index.html",
            PermissionKind::Microphone,
            dev
        ));
        assert!(!allowed(
            "http://localhost:1421/",
            PermissionKind::Microphone,
            dev
        ));
        assert!(!allowed(
            "http://localhost:1420/",
            PermissionKind::Microphone,
            None
        ));
    }

    #[test]
    fn camera_and_other_kinds_are_always_denied() {
        assert!(!allowed("tauri://localhost/", PermissionKind::Camera, None));
        assert!(!allowed(
            "https://tauri.localhost/",
            PermissionKind::Geolocation,
            None
        ));
        assert!(!allowed(
            "https://tauri.localhost/",
            PermissionKind::DisplayCapture,
            None
        ));
    }

    #[test]
    fn clipboard_read_follows_the_microphone_origin_rule() {
        assert!(allowed(
            "tauri://localhost/",
            PermissionKind::ClipboardRead,
            None
        ));
        assert!(!allowed(
            "https://example.com/",
            PermissionKind::ClipboardRead,
            None
        ));
    }
}
