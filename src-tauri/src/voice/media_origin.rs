fn same_origin(left: &url::Url, right: &url::Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

/// Only the bundled application, or the explicitly configured development origin,
/// can request audio. Preview frames retain opaque sandbox origins and deny media.
pub(crate) fn trusted_media_page(uri: &str, development_url: Option<&str>) -> bool {
    let Ok(page) = url::Url::parse(uri) else {
        return false;
    };
    if !page.username().is_empty() || page.password().is_some() {
        return false;
    }
    let bundled = match page.scheme() {
        "tauri" => page.host_str() == Some("localhost") && page.port().is_none(),
        "http" | "https" => page.host_str() == Some("tauri.localhost") && page.port().is_none(),
        _ => false,
    };
    bundled
        || development_url
            .and_then(|value| url::Url::parse(value).ok())
            .is_some_and(|development| {
                matches!(development.scheme(), "http" | "https")
                    && development.username().is_empty()
                    && development.password().is_none()
                    && same_origin(&page, &development)
            })
}

#[cfg(target_os = "linux")]
pub(crate) fn enable(window: &tauri::WebviewWindow) {
    use tauri::Manager;
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequestExt, WebViewExt,
    };

    let development_url = if cfg!(debug_assertions) {
        window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .map(|value| value.as_str().to_owned())
    } else {
        None
    };
    let _ = window.with_webview(move |webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_webaudio(true);
        }
        view.connect_permission_request(move |view, request| {
            let Some(media) = request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
            else {
                return false;
            };
            if UserMediaPermissionRequestExt::is_for_audio_device(media)
                && !UserMediaPermissionRequestExt::is_for_video_device(media)
                && WebViewExt::uri(view)
                    .is_some_and(|uri| trusted_media_page(uri.as_str(), development_url.as_deref()))
            {
                request.allow();
            } else {
                request.deny();
            }
            true
        });
    });
}

#[cfg(test)]
mod tests {
    use super::trusted_media_page;

    #[test]
    fn bundled_app_pages_are_allowed_without_granting_preview_or_remote_origins() {
        for uri in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://tauri.localhost/#voice",
        ] {
            assert!(trusted_media_page(uri, None));
        }
        for uri in [
            "https://example.com",
            "https://tauri.localhost.example.com",
            "https://html-preview.localhost/",
            "html-preview://localhost/",
            "file:///index.html",
            "data:text/html,x",
            "about:blank",
            "https://tauri.localhost:8443/",
            "tauri://attacker/index.html",
            "https://user@tauri.localhost/",
        ] {
            assert!(!trusted_media_page(uri, None), "{uri}");
        }
    }

    #[test]
    fn development_requires_the_exact_configured_origin() {
        let configured = Some("http://localhost:1420/");
        assert!(trusted_media_page(
            "http://localhost:1420/voice?tab=1",
            configured
        ));
        assert!(!trusted_media_page("http://localhost:1421/", configured));
        assert!(!trusted_media_page("http://127.0.0.1:1420/", configured));
        assert!(!trusted_media_page("https://localhost:1420/", configured));
        assert!(!trusted_media_page("http://localhost:1420/", None));
    }
}
