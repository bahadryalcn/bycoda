//! One OS-wide emergency stop, dispatched through the captured local Native
//! Profile. A key press can stop control; it can never enable it or grant input.
use serde_json::json;
use std::str::FromStr;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

#[derive(Default)]
pub(crate) struct DesktopShortcutState {
    shortcut: Mutex<Option<Shortcut>>,
    pressed: AtomicBool,
}

fn parse(value: &str) -> Result<Shortcut, String> {
    let chord = Shortcut::from_str(value).map_err(|_| "Invalid global emergency shortcut")?;
    if !chord.mods.intersects(Modifiers::CONTROL | Modifiers::SUPER) {
        return Err("A global emergency shortcut needs Control or Command".into());
    }
    Ok(chord)
}

fn pressed_once(pressed: &AtomicBool, state: ShortcutState) -> bool {
    if state == ShortcutState::Released {
        pressed.store(false, Ordering::Release);
        false
    } else {
        !pressed.swap(true, Ordering::AcqRel)
    }
}

pub(crate) fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(DesktopShortcutState::default());
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event: ShortcutEvent| {
                let state = app.state::<DesktopShortcutState>();
                let matches = state
                    .shortcut
                    .lock()
                    .map(|current| current.as_ref() == Some(shortcut))
                    .unwrap_or(false);
                if matches {
                    if !pressed_once(&state.pressed, event.state) {
                        return;
                    }
                    // Do not perform Host/network work inside the platform hotkey callback.
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = crate::desktop_control_window::stop_captured(app.clone()).await;
                        let _ = app.emit(
                            "desktop_control_shortcut_result",
                            json!({"ok":result.is_ok()}),
                        );
                        if result.is_err() {
                            tauri::async_runtime::spawn(crate::notifications::show_notification(
                                app,
                                String::new(),
                                crate::native_language::translated("Computer control stop failed"),
                                String::new(),
                                crate::native_language::translated(
                                    "Open Computer use settings and retry Stop.",
                                ),
                                false,
                            ));
                        }
                    });
                    return;
                }
                #[cfg(target_os = "macos")]
                crate::quick_composer::handle_global_shortcut(app, shortcut, event);
            })
            .build(),
    )?;
    Ok(())
}

/** Register first and release second: failure retains the previous binding. */
fn replace(
    current: &mut Option<Shortcut>,
    next: Option<Shortcut>,
    mut register: impl FnMut(Shortcut) -> Result<(), String>,
    mut unregister: impl FnMut(Shortcut) -> Result<(), String>,
) -> Result<(), String> {
    if *current == next {
        return Ok(());
    }
    if let Some(next) = next {
        register(next)?;
    }
    if let Some(previous) = *current {
        if let Err(error) = unregister(previous) {
            if let Some(next) = next {
                if let Err(rollback) = unregister(next) {
                    return Err(format!("{error}. Shortcut rollback failed: {rollback}"));
                }
            }
            return Err(error);
        }
    }
    *current = next;
    Ok(())
}

#[tauri::command]
pub fn desktop_shortcut_configure(
    app: AppHandle,
    window: WebviewWindow,
    shortcut: Option<String>,
) -> Result<(), String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("Only workspace settings can configure the emergency shortcut".into());
    }
    let next = shortcut.as_deref().map(parse).transpose()?;
    let state = app.state::<DesktopShortcutState>();
    let mut current = state
        .shortcut
        .lock()
        .map_err(|_| "Emergency shortcut state is locked")?;
    let shortcuts = app.global_shortcut();
    replace(
        &mut current,
        next,
        |chord| {
            shortcuts
                .register(chord)
                .map_err(|error| format!("Could not claim emergency shortcut: {error}"))
        },
        |chord| {
            shortcuts
                .unregister(chord)
                .map_err(|error| format!("Could not release emergency shortcut: {error}"))
        },
    )?;
    state.pressed.store(false, Ordering::Release);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn emergency_shortcut_requires_a_global_modifier() {
        assert!(parse("Control+Option+Escape").is_ok());
        assert!(parse("Command+Shift+KeyQ").is_ok());
        assert!(parse("Option+Escape").is_err());
        assert!(parse("Escape").is_err());
    }
    #[test]
    fn failed_replacement_and_failed_release_retain_original_registration() {
        let old = parse("Control+Option+Escape").unwrap();
        let next = parse("Control+Shift+KeyX").unwrap();
        let mut current = Some(old);
        assert!(replace(
            &mut current,
            Some(next),
            |_| Err("conflict".into()),
            |_| Ok(())
        )
        .is_err());
        assert_eq!(current, Some(old));
        let mut releases = Vec::new();
        assert!(replace(
            &mut current,
            Some(next),
            |_| Ok(()),
            |chord| {
                releases.push(chord);
                if chord == old {
                    Err("release failed".into())
                } else {
                    Ok(())
                }
            }
        )
        .is_err());
        assert_eq!(releases, vec![old, next]);
        assert_eq!(current, Some(old));
    }
    #[test]
    fn disabling_and_identical_reconfiguration_do_not_claim_another_chord() {
        let mut current = Some(parse("Control+Option+Escape").unwrap());
        let original = current;
        replace(
            &mut current,
            original,
            |_| panic!("duplicate register"),
            |_| panic!("duplicate release"),
        )
        .unwrap();
        let mut releases = 0;
        replace(
            &mut current,
            None,
            |_| panic!("disabled register"),
            |_| {
                releases += 1;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(releases, 1);
        assert!(current.is_none());
    }
    #[test]
    fn a_held_hotkey_dispatches_only_once_until_released() {
        let pressed = AtomicBool::new(false);
        assert!(pressed_once(&pressed, ShortcutState::Pressed));
        assert!(!pressed_once(&pressed, ShortcutState::Pressed));
        assert!(!pressed_once(&pressed, ShortcutState::Released));
        assert!(pressed_once(&pressed, ShortcutState::Pressed));
    }
}
