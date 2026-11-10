//! Optional OS-wide "Talk to assistant" shortcut. Pressing it shows the main
//! window and emits `bycoda-voice-talk` to it; the renderer decides whether
//! capture may start. Nothing else is opened or acted on from here.
use crate::desktop_shortcut::{pressed_once, replace, DesktopShortcutState};
use serde_json::json;
use std::str::FromStr;
use std::sync::{atomic::AtomicBool, atomic::Ordering, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Event name; keep in sync with `src/platform/tauri/voiceTalkEvent.ts`.
const EVENT: &str = "bycoda-voice-talk";
const MAIN: &str = "main";

#[derive(Default)]
pub(crate) struct DesktopTalkShortcutState {
    shortcut: Mutex<Option<Shortcut>>,
    pressed: AtomicBool,
}

pub(crate) fn init(app: &AppHandle) {
    app.manage(DesktopTalkShortcutState::default());
}

pub(crate) fn current(app: &AppHandle) -> Option<Shortcut> {
    let state = app.try_state::<DesktopTalkShortcutState>()?;
    let guard = state.shortcut.lock().ok()?;
    *guard
}

fn parse(value: &str, stop: Option<Shortcut>) -> Result<Shortcut, String> {
    let chord = Shortcut::from_str(value).map_err(|_| "Invalid Talk to assistant shortcut")?;
    if !chord.mods.intersects(Modifiers::CONTROL | Modifiers::SUPER) {
        return Err("A global Talk to assistant shortcut needs Control or Command".into());
    }
    if stop == Some(chord) {
        return Err("Talk to assistant cannot use the emergency stop shortcut".into());
    }
    Ok(chord)
}

/// Returns true when `shortcut` is the Talk chord (handled, or ignored as a repeat).
pub(crate) fn handle(app: &AppHandle, shortcut: &Shortcut, event: ShortcutState) -> bool {
    let Some(state) = app.try_state::<DesktopTalkShortcutState>() else {
        return false;
    };
    let matches = state
        .shortcut
        .lock()
        .map(|current| current.as_ref() == Some(shortcut))
        .unwrap_or(false);
    if !matches {
        return false;
    }
    if pressed_once(&state.pressed, event) {
        let app = app.clone();
        // Window work leaves the platform hotkey callback.
        tauri::async_runtime::spawn(async move { talk(&app) });
    }
    true
}

fn talk(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    if let Err(error) = reveal(&window) {
        log::warn!("Could not show the main window for Talk to assistant: {error}");
        return;
    }
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    let _ = app.emit_to(MAIN, EVENT, json!({"source": "global-shortcut", "at": at}));
}

fn reveal(window: &WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|error| error.to_string())?;
    crate::window::ensure_window_reachable(window)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn desktop_talk_shortcut_configure(
    app: AppHandle,
    window: WebviewWindow,
    shortcut: Option<String>,
) -> Result<(), String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("Only workspace settings can configure the Talk to assistant shortcut".into());
    }
    // Lock order: stop, then talk (the stop command checks `current` first).
    let stop_state = app.state::<DesktopShortcutState>();
    let stop = stop_state
        .shortcut
        .lock()
        .map_err(|_| "Emergency shortcut state is locked")?;
    let next = shortcut
        .as_deref()
        .map(|value| parse(value, *stop))
        .transpose()?;
    let state = app.state::<DesktopTalkShortcutState>();
    let mut current = state
        .shortcut
        .lock()
        .map_err(|_| "Talk to assistant shortcut state is locked")?;
    let shortcuts = app.global_shortcut();
    replace(
        &mut current,
        next,
        |chord| {
            shortcuts
                .register(chord)
                .map_err(|error| format!("Could not claim Talk to assistant shortcut: {error}"))
        },
        |chord| {
            shortcuts
                .unregister(chord)
                .map_err(|error| format!("Could not release Talk to assistant shortcut: {error}"))
        },
    )?;
    state.pressed.store(false, Ordering::Release);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn talk_shortcut_requires_a_global_modifier() {
        assert!(parse("Control+Shift+KeyT", None).is_ok());
        assert!(parse("Command+Shift+KeyT", None).is_ok());
        assert!(parse("Shift+KeyT", None).is_err());
        assert!(parse("Option+KeyT", None).is_err());
        assert!(parse("KeyT", None).is_err());
    }
    #[test]
    fn talk_shortcut_differs_from_the_emergency_stop() {
        let stop = Shortcut::from_str("Control+Option+Escape").ok();
        assert!(parse("Control+Option+Escape", stop).is_err());
        assert!(parse("Control+Shift+KeyT", stop).is_ok());
    }
    #[test]
    fn a_held_talk_chord_dispatches_once_per_press() {
        let pressed = AtomicBool::new(false);
        assert!(pressed_once(&pressed, ShortcutState::Pressed));
        assert!(!pressed_once(&pressed, ShortcutState::Pressed));
        assert!(!pressed_once(&pressed, ShortcutState::Released));
        assert!(pressed_once(&pressed, ShortcutState::Pressed));
    }
}
