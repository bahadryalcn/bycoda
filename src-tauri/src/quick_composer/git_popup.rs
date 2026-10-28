use std::sync::Mutex;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSEvent, NSEventType};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::{Deserialize, Serialize};
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

use crate::quick_native::{PopupWork, QuickWindowOwner};
use crate::window::{QUICK_COMPOSER_GIT_LABEL, QUICK_COMPOSER_LABEL};

const WIDTH: f64 = 320.0;
const MAX_HEIGHT: f64 = 520.0;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PickerKind {
    Workspace,
    Base,
    Branch,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Anchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Request {
    id: String,
    kind: PickerKind,
    choice: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    branches: Option<serde_json::Value>,
    anchor: Anchor,
}

struct Active {
    request: Request,
    parent: WebviewWindow,
    popup: WebviewWindow,
    parent_owner: QuickWindowOwner,
    popup_owner: QuickWindowOwner,
    presented: bool,
    work: PopupWork,
}
impl Active {
    fn current(&self) -> bool {
        self.parent_owner
            .matches(&self.parent.as_ref().window().resources_table())
            && self
                .popup_owner
                .matches(&self.popup.as_ref().window().resources_table())
    }
    fn accepts(&self, owner: &QuickWindowOwner) -> bool {
        self.parent_owner.same(owner) || self.popup_owner.same(owner)
    }
}
#[derive(Default)]
pub struct PopupState(Mutex<Option<Active>>);

fn owner(window: &WebviewWindow) -> Result<QuickWindowOwner, String> {
    QuickWindowOwner::get(&window.as_ref().window().resources_table())
}

#[tauri::command]
pub async fn quick_git_open(
    app: AppHandle,
    window: WebviewWindow,
    request: Request,
) -> Result<(), String> {
    if window.label() != QUICK_COMPOSER_LABEL {
        return Err("Only the quick composer can open this picker.".into());
    }
    if request.id.is_empty()
        || ![
            request.anchor.x,
            request.anchor.y,
            request.anchor.width,
            request.anchor.height,
        ]
        .iter()
        .all(|n| n.is_finite())
        || request
            .choice
            .get("cwd")
            .and_then(|v| v.as_str())
            .is_none_or(str::is_empty)
    {
        return Err("Invalid picker request.".into());
    }
    crate::quick_native::bounded_json_size(&request, 1024 * 1024)?;
    let parent_owner = owner(&window)?;
    let parent_admission =
        crate::native_window_lifecycle::admit_window_buffers(&window.as_ref().window())?;
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            if !parent_owner.matches(&window.as_ref().window().resources_table())
                || !window.is_visible().unwrap_or(false)
            {
                return Err("The composer is no longer visible.".into());
            }
            let popup = prepare(&handle, &window).map_err(|err| err.to_string())?;
            let popup_owner = owner(&popup)?;
            let popup_admission =
                crate::native_window_lifecycle::admit_window_buffers(&popup.as_ref().window())?;
            let active = Active {
                request: request.clone(),
                parent: window,
                popup: popup.clone(),
                parent_owner,
                popup_owner,
                presented: false,
                work: PopupWork::new(parent_admission, popup_admission),
            };
            let previous = handle
                .state::<PopupState>()
                .0
                .lock()
                .map_err(|err| err.to_string())?
                .replace(active);
            // No UI/barrier work while holding PopupState. Replacement settles
            // only the exact old physical context, never a same-label lookup.
            if let Some(previous) = previous {
                let _ = previous.work.finish(Ok::<_, ()>(()));
            }
            // A newly booting webview retrieves the same request with quick_git_state.
            let emitted = popup
                .emit("quick_git_request", request)
                .map_err(|err| err.to_string());
            if emitted.is_err() {
                retire(&handle, &owner(&popup)?);
            }
            emitted
        })();
        let _ = tx.try_send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv()
        .await
        .ok_or_else(|| "Picker window did not open.".to_string())?
}

#[tauri::command]
pub fn quick_git_state(
    window: WebviewWindow,
    state: State<'_, PopupState>,
) -> Result<Option<Request>, String> {
    if window.label() != QUICK_COMPOSER_GIT_LABEL {
        return Err("Only the picker can read its state.".into());
    }
    let caller = owner(&window)?;
    Ok(state
        .0
        .lock()
        .map_err(|err| err.to_string())?
        .as_ref()
        .filter(|active| active.popup_owner.same(&caller) && active.current())
        .map(|active| active.request.clone()))
}

/// Resize only the popup. The composer's frame and native glass never grow.
#[tauri::command]
pub fn quick_git_fit(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    height: f64,
) -> Result<(), String> {
    if window.label() != QUICK_COMPOSER_GIT_LABEL || !height.is_finite() {
        return Ok(());
    }
    let handle = app.clone();
    let Ok(caller) = owner(&window) else {
        return Err("Picker owner unavailable.".into());
    };
    app.run_on_main_thread(move || {
        let state = handle.state::<PopupState>();
        let view = state.0.lock().ok().and_then(|mut state| {
            state
                .as_mut()
                .filter(|active| {
                    active.request.id == id && active.popup_owner.same(&caller) && active.current()
                })
                .map(|active| {
                    let present = !active.presented;
                    active.presented = true;
                    (active.request.clone(), active.parent.clone(), present)
                })
        });
        let Some((request, parent, should_present)) = view else {
            return;
        };
        if !parent.is_visible().unwrap_or(false) {
            complete(&handle, Some(&caller), Some(&id), None, false, false);
            return;
        }
        let (Some(parent_ns), Some(popup_ns)) = (
            crate::macos::ns_window(&parent),
            crate::macos::ns_window(&window),
        ) else {
            return;
        };
        let parent_frame = parent_ns.frame();
        let screen = parent_ns
            .screen()
            .map(|screen| screen.visibleFrame())
            .unwrap_or(parent_frame);
        let frame = popup_frame(parent_frame, screen, &request.anchor, height);
        popup_ns.setFrame_display(frame, false);
        popup_ns.invalidateShadow();
        popup_ns.displayIfNeeded();
        // Focus once for each opening, including reuse of an already visible panel.
        // Later content resizes must not steal focus.
        if should_present {
            super::present(&window);
        }
    })
    .map_err(|err| err.to_string())
}

fn popup_frame(parent: NSRect, screen: NSRect, anchor: &Anchor, height: f64) -> NSRect {
    let width = WIDTH.min(screen.size.width);
    let height = height.clamp(1.0, MAX_HEIGHT).min(screen.size.height);
    let x = (parent.origin.x + anchor.x)
        .clamp(screen.origin.x, screen.origin.x + screen.size.width - width);
    let anchor_top = parent.origin.y + parent.size.height - anchor.y;
    let below = anchor_top - anchor.height - 6.0 - height;
    let above = anchor_top + 6.0;
    let y = if below >= screen.origin.y {
        below
    } else {
        above
    };
    let y = y.clamp(
        screen.origin.y,
        screen.origin.y + screen.size.height - height,
    );
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

#[tauri::command]
pub fn quick_git_complete(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    choice: Option<serde_json::Value>,
    restore_focus: bool,
) -> Result<(), String> {
    if ![QUICK_COMPOSER_LABEL, QUICK_COMPOSER_GIT_LABEL].contains(&window.label()) {
        return Err("Invalid picker window.".into());
    }
    let handle = app.clone();
    let caller = owner(&window)?;
    app.run_on_main_thread(move || {
        complete(
            &handle,
            Some(&caller),
            Some(&id),
            choice,
            restore_focus,
            false,
        );
    })
    .map_err(|err| err.to_string())
}

fn complete(
    app: &AppHandle,
    caller: Option<&QuickWindowOwner>,
    id: Option<&str>,
    choice: Option<serde_json::Value>,
    restore_focus: bool,
    blur: bool,
) {
    let state = app.state::<PopupState>();
    let request = {
        let Ok(mut state) = state.0.lock() else {
            return;
        };
        if state.as_ref().is_none_or(|active| {
            !active.current()
                || caller.is_some_and(|caller| !active.accepts(caller))
                || id.is_some_and(|id| active.request.id != id)
        }) {
            return;
        }
        state.take()
    };
    if let Some(active) = request {
        let Active {
            request,
            parent,
            popup,
            work,
            ..
        } = active;
        let hidden = popup.hide().map_err(|err| err.to_string());
        if restore_focus && parent.is_visible().unwrap_or(false) {
            super::present(&parent);
        }
        let trigger_click = blur
            && MainThreadMarker::new().is_some_and(|mtm| {
                NSApplication::sharedApplication(mtm)
                    .currentEvent()
                    .is_some_and(|event| event.r#type() == NSEventType::LeftMouseDown)
                    && crate::macos::ns_window(&parent).is_some_and(|window| {
                        over_trigger(window.frame(), &request.anchor, NSEvent::mouseLocation())
                    })
            });
        let emitted = parent.emit(
            "quick_git_result",
            serde_json::json!({ "id": request.id, "choice": choice, "restoreFocus": restore_focus,
            "triggerKind": if trigger_click { Some(request.kind) } else { None } }),
        );
        let _ = work.finish(hidden.and(emitted.map_err(|err| err.to_string())));
    }
}

fn over_trigger(parent: NSRect, anchor: &Anchor, point: NSPoint) -> bool {
    let left = parent.origin.x + anchor.x;
    let top = parent.origin.y + parent.size.height - anchor.y;
    point.x >= left
        && point.x <= left + anchor.width
        && point.y <= top
        && point.y >= top - anchor.height
}

pub(super) fn dismiss(app: &AppHandle, restore_focus: bool) {
    complete(app, None, None, None, restore_focus, false);
}

/// Exact old callbacks cannot consume a new physical popup's state. An actual
/// destroyed/invalid context drops its two admissions as unknown, not success.
pub(super) fn retire(app: &AppHandle, owner: &QuickWindowOwner) {
    let retired = app
        .state::<PopupState>()
        .0
        .lock()
        .ok()
        .and_then(|mut active| {
            if active.as_ref().is_some_and(|active| active.accepts(owner)) {
                active.take()
            } else {
                None
            }
        });
    drop(retired);
}

#[tauri::command]
pub fn quick_composer_dismiss(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != QUICK_COMPOSER_LABEL {
        return Err("Invalid composer window.".into());
    }
    let handle = app.clone();
    let caller = owner(&window)?;
    app.run_on_main_thread(move || {
        complete(&handle, Some(&caller), None, None, false, false);
        let _ = window.hide();
        // A dismissed draft lives only in this webview; keep it. There is no
        // visibility/age-based destruction without a verified Native raw receipt.
    })
    .map_err(|err| err.to_string())
}

/// Boot the hidden webview after the workspace paints, before the first picker click.
/// The nonactivating panel is presented only after content is measured.
pub(super) fn prepare(app: &AppHandle, parent: &WebviewWindow) -> tauri::Result<WebviewWindow> {
    if let Some(popup) = app.get_webview_window(QUICK_COMPOSER_GIT_LABEL) {
        return Ok(popup);
    }
    let creation = crate::native_window_lifecycle::admit_window(app, QUICK_COMPOSER_GIT_LABEL)
        .map_err(std::io::Error::other)?;
    let popup = WebviewWindowBuilder::new(
        app,
        QUICK_COMPOSER_GIT_LABEL,
        WebviewUrl::App("quick-composer.html?popup=git".into()),
    )
    .title("Choose workspace")
    .inner_size(WIDTH, 1.0)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .effects(
        EffectsBuilder::new()
            .effect(Effect::Popover)
            .state(EffectState::Active)
            .radius(12.0)
            .build(),
    )
    .parent(parent)?
    .build()?;
    creation.created(&popup);
    let identity = QuickWindowOwner::install(&mut popup.as_ref().window().resources_table())
        .map_err(std::io::Error::other)?;
    super::make_panel(&popup);
    // Attaching an AppKit child can affect its ordering even when the builder
    // requested invisibility. Keep the preloaded panel out until its first fit.
    popup.hide()?;
    let handle = app.clone();
    popup.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            identity.retire();
            retire(&handle, &identity);
        } else if matches!(event, WindowEvent::Focused(false)) {
            let blurred = handle
                .state::<PopupState>()
                .0
                .lock()
                .ok()
                .and_then(|active| {
                    active
                        .as_ref()
                        .filter(|active| {
                            active.presented
                                && active.popup_owner.same(&identity)
                                && active.current()
                        })
                        .map(|active| active.popup.clone())
                });
            if blurred.is_some_and(|popup| {
                popup.is_visible().unwrap_or(false) && !popup.is_focused().unwrap_or(false)
            }) {
                complete(&handle, Some(&identity), None, None, false, true);
            }
        }
    });
    Ok(popup)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blur_only_marks_a_click_inside_the_current_trigger() {
        let parent = NSRect::new(NSPoint::new(-600.0, 400.0), NSSize::new(680.0, 140.0));
        let anchor = Anchor {
            x: 30.0,
            y: 10.0,
            width: 100.0,
            height: 24.0,
        };
        assert!(over_trigger(parent, &anchor, NSPoint::new(-550.0, 520.0)));
        assert!(!over_trigger(parent, &anchor, NSPoint::new(-400.0, 520.0)));
        assert!(!over_trigger(parent, &anchor, NSPoint::new(-550.0, 490.0)));
    }

    #[test]
    fn request_preserves_the_composers_branch_snapshot() {
        let value = serde_json::json!({
            "id": "first-open", "kind": "workspace",
            "choice": { "cwd": "/repo", "mode": "current" },
            "branches": { "current": "main", "detached": false,
                "branches": [{ "name": "main", "current": true, "remote": null }] },
            "anchor": { "x": 10.0, "y": 10.0, "width": 100.0, "height": 24.0 }
        });
        let request: Request = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), value);
    }
    #[test]
    fn menu_is_anchored_without_changing_the_composer_frame() {
        let parent = NSRect::new(NSPoint::new(200.0, 600.0), NSSize::new(680.0, 140.0));
        let screen = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1440.0, 900.0));
        let anchor = Anchor {
            x: 120.0,
            y: 16.0,
            width: 70.0,
            height: 24.0,
        };
        let frame = popup_frame(parent, screen, &anchor, 280.0);
        assert_eq!(frame.origin, NSPoint::new(320.0, 414.0));
        assert_eq!(frame.size, NSSize::new(320.0, 280.0));
        assert_eq!(parent.size.height, 140.0);
    }
    #[test]
    fn popup_is_never_a_workspace_launch_target() {
        assert!(!crate::window::is_workspace_window(
            QUICK_COMPOSER_GIT_LABEL
        ));
        assert!(!crate::window::is_workspace_window(QUICK_COMPOSER_LABEL));
        assert!(crate::window::is_workspace_window("main"));
    }

    #[test]
    fn menu_flips_and_clamps_at_screen_edges() {
        let parent = NSRect::new(NSPoint::new(1000.0, 0.0), NSSize::new(680.0, 140.0));
        let screen = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1440.0, 900.0));
        let frame = popup_frame(
            parent,
            screen,
            &Anchor {
                x: 500.0,
                y: 16.0,
                width: 70.0,
                height: 24.0,
            },
            300.0,
        );
        assert_eq!(frame.origin, NSPoint::new(1120.0, 130.0));
        let small = NSRect::new(NSPoint::new(-800.0, -400.0), NSSize::new(250.0, 200.0));
        let frame = popup_frame(
            parent,
            small,
            &Anchor {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            700.0,
        );
        assert_eq!(frame, small);
    }
}
