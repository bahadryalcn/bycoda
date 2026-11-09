//! Bounded OS handoff queue. Navigation remains in the authorized workspace.
use std::{collections::VecDeque, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

const EVENT: &str = "bycoda:session-link";
const LIMIT: usize = 32;

#[derive(Default)]
struct PendingLinks(Mutex<VecDeque<String>>);

pub(crate) fn is_session_link(value: &str) -> bool {
    value.len() <= 4096
        && !value.chars().any(char::is_control)
        && (value.starts_with("bycoda://session/v1/")
            || value.starts_with("https://link.bycoda.codes/session/v1/"))
}

pub(crate) fn enqueue(app: &tauri::AppHandle, links: impl IntoIterator<Item = String>) {
    let Some(state) = app.try_state::<PendingLinks>() else {
        return;
    };
    let Ok(mut queue) = state.0.lock() else {
        return;
    };
    for link in links
        .into_iter()
        .filter(|link| is_session_link(link))
        .take(LIMIT)
    {
        if queue.len() >= LIMIT {
            queue.pop_front();
        }
        if !queue.contains(&link) {
            queue.push_back(link);
        }
    }
    if queue.is_empty() {
        return;
    }
    drop(queue);
    // A single workspace receives the signal; cold starts drain after subscribing.
    let windows = crate::window::workspace_windows(app);
    if let Some(window) = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.iter().find(|window| window.label() == "main"))
        .or_else(|| windows.first())
    {
        let _ = app.emit_to(window.label(), EVENT, ());
    }
}

#[tauri::command]
pub(crate) fn session_links_take_pending(
    window: tauri::WebviewWindow,
) -> Result<Vec<String>, String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("Session links require a workspace window".into());
    }
    let state = window.state::<PendingLinks>();
    let mut queue = state
        .0
        .lock()
        .map_err(|_| "Session link queue is unavailable")?;
    Ok(queue.drain(..).collect())
}

pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("session-links")
        .setup(|app, _| {
            app.manage(PendingLinks::default());
            if let Some(urls) = app.deep_link().get_current()? {
                enqueue(app, urls.into_iter().map(|url| url.to_string()));
            }
            enqueue(
                app,
                std::env::args_os()
                    .skip(1)
                    .filter_map(|argument| argument.into_string().ok()),
            );
            let handle = app.clone();
            app.deep_link().on_open_url(move |event| {
                enqueue(&handle, event.urls().iter().map(|url| url.to_string()));
                let target = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = crate::window::show_existing_or_open_new(&target);
                });
            });
            // Installed Windows/macOS packages register statically. AppImage needs
            // runtime registration; development must never replace stable ownership.
            #[cfg(all(target_os = "linux", not(debug_assertions)))]
            app.deep_link().register_all()?;
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::is_session_link;

    #[test]
    fn only_bounded_session_handoffs_enter_the_queue() {
        assert!(is_session_link(
            "bycoda://session/v1/native/store/profile/session"
        ));
        assert!(is_session_link(
            "https://link.bycoda.codes/session/v1/host/env/session"
        ));
        for invalid in [
            "bycoda://pair/token",
            "https://link.bycoda.codes.evil/session/v1/host/e/s",
            "bycoda://session/v1/host/e/s\n",
            &"x".repeat(4097),
        ] {
            assert!(!is_session_link(invalid));
        }
    }
}
