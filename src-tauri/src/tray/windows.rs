//! Track only windows explicitly sent to the Windows notification area.
use super::{compact_label, locked, refresh, TrayState};
use crate::{native_language::translated, window};
use std::sync::Mutex;
use tauri::menu::{MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager, WebviewWindow, Wry};

const OPEN_PREFIX: &str = "tray_open_window_";
const CLOSE_PREFIX: &str = "tray_close_window_";

#[derive(Default)]
pub(super) struct ParkedWindows {
    pub(super) labels: Vec<String>,
}

impl ParkedWindows {
    fn park(&mut self, label: &str) {
        self.remove(label);
        self.labels.push(label.to_owned());
    }

    pub(super) fn remove(&mut self, label: &str) -> bool {
        let len = self.labels.len();
        self.labels.retain(|entry| entry != label);
        self.labels.len() != len
    }
}

pub(crate) fn park(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    if !window::is_workspace_window(window.label()) || app.tray_by_id("main").is_none() {
        return Err("System tray is unavailable for this window".into());
    }
    let state = app.state::<Mutex<TrayState>>();
    window.hide().map_err(|error| error.to_string())?;
    locked(&state).parked.park(window.label());
    refresh_windows(app, &state);
    Ok(())
}

pub(crate) fn revealed(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<Mutex<TrayState>>() {
        let removed = locked(&state).parked.remove(label);
        if removed {
            refresh_windows(app, &state);
        }
    }
}

fn refresh_windows(app: &AppHandle, state: &Mutex<TrayState>) {
    if let Err(error) = refresh(app, state) {
        log::warn!("Hidden windows menu refresh failed: {error}");
    }
}

fn reveal(window: &WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|error| error.to_string())?;
    window::ensure_window_reachable(window)?;
    window.show().map_err(|error| error.to_string())?;
    revealed(window.app_handle(), window.label());
    window.set_focus().map_err(|error| error.to_string())
}

pub(super) fn reopen(app: &AppHandle) {
    let labels = locked(&app.state::<Mutex<TrayState>>())
        .parked
        .labels
        .clone();
    let parked = labels.iter().rev().find_map(|label| {
        let window = app.get_webview_window(label)?;
        (!window.is_visible().unwrap_or(false)).then_some(window)
    });
    let result = match parked {
        Some(window) => reveal(&window),
        None => window::show_existing_or_open_new(app),
    };
    if let Err(error) = result {
        log::warn!("Opening a window from the tray failed: {error}");
    }
}

pub(super) fn menu(app: &AppHandle, labels: &[String]) -> tauri::Result<Submenu<Wry>> {
    let mut hidden = SubmenuBuilder::new(app, translated("Hidden windows"));
    let entries: Vec<_> = labels
        .iter()
        .rev()
        .filter_map(|label| {
            let window = app.get_webview_window(label)?;
            let title = window.title().unwrap_or_default();
            let title = compact_label(title.trim()).replace('&', "&&");
            let title = if title.is_empty() {
                app.package_info().name.clone()
            } else {
                title
            };
            Some((label, title))
        })
        .collect();
    for (index, (label, title)) in entries.iter().enumerate() {
        let title = if entries.iter().filter(|(_, other)| other == title).count() > 1 {
            format!("{title} ({})", index + 1)
        } else {
            title.clone()
        };
        let open = MenuItemBuilder::with_id(format!("{OPEN_PREFIX}{label}"), translated("Open"))
            .build(app)?;
        let close =
            MenuItemBuilder::with_id(format!("{CLOSE_PREFIX}{label}"), translated("Close window"))
                .build(app)?;
        hidden = hidden.item(
            &SubmenuBuilder::new(app, title)
                .items(&[&open, &close])
                .build()?,
        );
    }
    hidden.build()
}

pub(super) fn dispatch(app: &AppHandle, id: &str) -> bool {
    let (label, close) = if let Some(label) = id.strip_prefix(OPEN_PREFIX) {
        (label, false)
    } else if let Some(label) = id.strip_prefix(CLOSE_PREFIX) {
        (label, true)
    } else {
        return false;
    };
    if !locked(&app.state::<Mutex<TrayState>>())
        .parked
        .labels
        .iter()
        .any(|entry| entry == label)
    {
        return true;
    }
    if let Some(window) = app.get_webview_window(label) {
        // Reveal before requesting close so any save or running-work prompt stays reachable.
        let result = reveal(&window).and_then(|()| {
            if close {
                window.close().map_err(|error| error.to_string())
            } else {
                Ok(())
            }
        });
        if let Err(error) = result {
            log::warn!("Hidden window action failed: {error}");
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::ParkedWindows;

    #[test]
    fn reopening_removes_only_the_selected_window_and_reparking_moves_it_to_the_end() {
        let mut parked = ParkedWindows::default();
        for label in ["main", "window-1", "window-2", "main"] {
            parked.park(label);
        }
        assert_eq!(parked.labels, ["window-1", "window-2", "main"]);
        assert!(parked.remove("main"));
        assert_eq!(parked.labels.last().map(String::as_str), Some("window-2"));
        assert!(!parked.remove("main"));
        assert_eq!(parked.labels, ["window-1", "window-2"]);
    }
}
