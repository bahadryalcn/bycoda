use serde::Deserialize;
use std::{cell::RefCell, collections::HashMap};
use tauri::{Emitter, Manager, Window};
use url::Url;
use uuid::Uuid;
use wry::{
    dpi::{PhysicalPosition, PhysicalSize},
    NewWindowResponse, Rect, WebView, WebViewBuilder,
};

// Keep untrusted documents outside Tauri's Webview manager. That manager adds
// the application IPC and local-file asset protocols to every managed Webview.
thread_local! {
    static VIEWS: RefCell<HashMap<(String, Uuid), WebView>> = RefCell::default();
}

fn allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        && url.port() != Some(1420)
        && url.username().is_empty()
        && url.password().is_none()
        && url.as_str().len() <= 4096
}

fn parse_address(address: &str) -> Result<Url, String> {
    Url::parse(address)
        .ok()
        .filter(allowed)
        .ok_or_else(|| "Invalid local preview address".into())
}

async fn on_main<T: Send + 'static>(
    window: &Window,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = send.send(work());
        })
        .map_err(|_| "Local preview window is closed")?;
    receive
        .await
        .map_err(|_| "Local preview window is closed")?
}

async fn with_view<T: Send + 'static>(
    window: &Window,
    id: Uuid,
    work: impl FnOnce(&WebView) -> wry::Result<T> + Send + 'static,
) -> Result<T, String> {
    let key = (window.label().to_owned(), id);
    on_main(window, move || {
        VIEWS.with_borrow(|views| {
            let view = views.get(&key).ok_or("Local preview is closed")?;
            work(view).map_err(|_| "Local preview is unavailable".into())
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn local_browser_preview_open(
    window: Window,
    id: Uuid,
    address: String,
) -> Result<(), String> {
    let url = parse_address(&address)?;
    if !cfg!(any(windows, target_os = "macos")) {
        return Err("Local preview is unavailable on this platform".into());
    }
    let parent = window.clone();
    on_main(&window, move || {
        let key = (parent.label().to_owned(), id);
        if VIEWS.with_borrow(|views| views.contains_key(&key)) {
            return Err("Local preview already exists".into());
        }
        let owner = key.0.clone();
        let app = parent.app_handle().clone();
        let view = WebViewBuilder::new()
            .with_url(url.as_str())
            .with_incognito(true)
            .with_visible(false)
            .with_focused(false)
            .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
            .with_download_started_handler(|_, _| false)
            .with_navigation_handler(move |address| {
                if parse_address(&address).is_err() {
                    let _ = app.emit_to(&owner, "local-browser-preview-blocked", id);
                    return false;
                }
                let _ = app.emit_to(&owner, "local-browser-preview-url", (id, address));
                true
            })
            .build_as_child(&parent)
            .map_err(|_| "Local preview could not start")?;
        VIEWS.with_borrow_mut(|views| views.insert(key, view));
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
pub(crate) struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[tauri::command]
pub(crate) async fn local_browser_preview_layout(
    window: Window,
    id: Uuid,
    bounds: Option<Bounds>,
) -> Result<(), String> {
    with_view(&window, id, move |view| match bounds {
        Some(bounds) => view
            .set_bounds(Rect {
                position: PhysicalPosition::new(bounds.x, bounds.y).into(),
                size: PhysicalSize::new(bounds.width, bounds.height).into(),
            })
            .and_then(|()| view.set_visible(true)),
        None => view.set_visible(false),
    })
    .await
}

#[tauri::command]
pub(crate) async fn local_browser_preview_navigate(
    window: Window,
    id: Uuid,
    address: String,
) -> Result<(), String> {
    let url = parse_address(&address)?;
    with_view(&window, id, move |view| view.load_url(url.as_str())).await
}

#[tauri::command]
pub(crate) async fn local_browser_preview_reload(window: Window, id: Uuid) -> Result<(), String> {
    with_view(&window, id, WebView::reload).await
}

#[tauri::command]
pub(crate) async fn local_browser_preview_location(
    window: Window,
    id: Uuid,
) -> Result<String, String> {
    let address = with_view(&window, id, WebView::url).await?;
    Ok(parse_address(&address)?.into())
}

#[tauri::command]
pub(crate) async fn local_browser_preview_close(window: Window, id: Uuid) -> Result<(), String> {
    let key = (window.label().to_owned(), id);
    on_main(&window, move || {
        VIEWS.with_borrow_mut(|views| views.remove(&key));
        Ok(())
    })
    .await
}

pub(crate) fn detach_window(label: &str) {
    VIEWS.with_borrow_mut(|views| views.retain(|(owner, _), _| owner != label));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_and_blocks_application_or_remote_origins() {
        for address in [
            "http://localhost:3000",
            "http://127.0.0.1:8080",
            "https://[::1]:1234",
        ] {
            assert!(allowed(&Url::parse(address).unwrap()));
        }
        for address in [
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "http://localhost.example:3000",
            "http://user@localhost:3000",
            "tauri://localhost",
            "file:///localhost",
            "https://example.com",
        ] {
            assert!(!allowed(&Url::parse(address).unwrap()));
        }
    }
}
