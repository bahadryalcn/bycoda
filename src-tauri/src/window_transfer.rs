use std::collections::HashMap;
use std::sync::{mpsc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub type WindowReady = mpsc::Receiver<Result<(), String>>;

/// Tab payloads waiting for the window they were staged for, keyed by label.
pub struct WindowTransferState {
    payloads: Mutex<HashMap<String, String>>,
    ready: Mutex<HashMap<String, PendingTransfer>>,
    drag_previews: Mutex<HashMap<String, DragPreviewState>>,
}

struct DragPreviewState {
    drag_id: String,
    source_id: String,
    source_ids: Vec<String>,
    revision: u64,
    target: Option<String>,
    closed_drag_ids: Vec<String>,
}

impl DragPreviewState {
    fn accepts_preview(&self, drag_id: &str, revision: u64) -> bool {
        revision > self.revision && !self.closed_drag_ids.iter().any(|closed| closed == drag_id)
    }

    fn clear(&mut self, drag_id: &str, revision: u64) -> Option<String> {
        // A clear can arrive before its first hover IPC. Remember that gesture
        // without changing another gesture's current revision or destination.
        if !self.closed_drag_ids.iter().any(|closed| closed == drag_id) {
            self.closed_drag_ids.push(drag_id.to_string());
            if self.closed_drag_ids.len() > 32 {
                self.closed_drag_ids.remove(0);
            }
        }
        if self.drag_id != drag_id || revision <= self.revision {
            return None;
        }
        self.revision = revision;
        self.target.take()
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowTabDragHover {
    drag_id: String,
    source_window_label: String,
    source_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    source_ids: Vec<String>,
    revision: u64,
    ended: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    /// x/y remain OS-logical for old clients. Zoom-aware clients convert them
    /// back to CSS pixels using this scale and their current devicePixelRatio.
    #[serde(skip_serializing_if = "Option::is_none")]
    scale_factor: Option<f64>,
}

struct PendingTransfer {
    id: Option<String>,
    sender: Option<mpsc::Sender<Result<(), String>>>,
}

impl WindowTransferState {
    pub fn new() -> Self {
        Self {
            payloads: Mutex::new(HashMap::new()),
            ready: Mutex::new(HashMap::new()),
            drag_previews: Mutex::new(HashMap::new()),
        }
    }

    pub fn stage(&self, label: &str, payload: String) -> Result<(), String> {
        if payload.trim().is_empty() {
            return Err("empty window transfer payload".into());
        }
        let mut payloads = self.payloads.lock().map_err(|err| err.to_string())?;
        if payloads.contains_key(label) {
            return Err("This window is already receiving a tab. Try again.".into());
        }
        payloads.insert(label.to_string(), payload);
        Ok(())
    }

    pub fn discard(&self, label: &str) {
        if let Ok(mut staged) = self.payloads.lock() {
            staged.remove(label);
        }
        if let Ok(mut ready) = self.ready.lock() {
            ready.remove(label);
        }
    }

    fn reject_closed_destination(&self, label: &str) {
        if let Ok(mut ready) = self.ready.lock() {
            if let Some(pending) = ready.get_mut(label) {
                if let Some(sender) = pending.sender.take() {
                    let _ = sender.send(Err("The destination window closed. Your conversation remains in the original window.".into()));
                }
            }
        }
        if let Ok(mut payloads) = self.payloads.lock() {
            payloads.remove(label);
        }
    }

    fn take(&self, label: &str) -> Result<Option<String>, String> {
        Ok(self
            .payloads
            .lock()
            .map_err(|err| err.to_string())?
            .remove(label))
    }

    fn take_checked(&self, label: &str, id: Option<&str>) -> Result<Option<String>, String> {
        let ready = self.ready.lock().map_err(|err| err.to_string())?;
        if let Some(id) = id {
            if ready.get(label).and_then(|pending| pending.id.as_deref()) != Some(id) {
                return Err("This transfer is no longer pending.".into());
            }
        } else if ready.get(label).is_some_and(|pending| pending.id.is_some()) {
            return Ok(None);
        }
        self.take(label)
    }

    pub fn watch_ready(&self, label: &str) -> Result<WindowReady, String> {
        let (sender, receiver) = mpsc::channel();
        self.ready.lock().map_err(|err| err.to_string())?.insert(
            label.to_string(),
            PendingTransfer {
                id: None,
                sender: Some(sender),
            },
        );
        Ok(receiver)
    }

    #[cfg(test)]
    fn acknowledge(&self, label: &str) -> Result<(), String> {
        self.finish(label, Ok(()))
    }

    #[cfg(test)]
    fn finish(&self, label: &str, result: Result<(), String>) -> Result<(), String> {
        self.finish_checked(label, None, result)
    }

    fn finish_checked(
        &self,
        label: &str,
        id: Option<&str>,
        result: Result<(), String>,
    ) -> Result<(), String> {
        let mut ready = self.ready.lock().map_err(|err| err.to_string())?;
        if let Some(pending) = ready.get_mut(label) {
            if pending.id.as_deref() != id {
                return Err("This transfer is no longer pending.".into());
            }
            // Keep the reservation until the sender has processed this reply.
            // Otherwise its cleanup could erase a subsequent transfer.
            if let Some(sender) = pending.sender.take() {
                sender.send(result).map_err(|err| err.to_string())?;
            }
        } else if id.is_some() {
            return Err("This transfer is no longer pending.".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub fn reject_window_transfer(
    window: WebviewWindow,
    state: State<'_, WindowTransferState>,
    reason: String,
    transfer_id: Option<String>,
) -> Result<(), String> {
    state.finish_checked(window.label(), transfer_id.as_deref(), Err(reason))
}

fn contains_point(left: f64, top: f64, width: f64, height: f64, x: f64, y: f64) -> bool {
    x >= left && y >= top && x < left + width && y < top + height
}

fn source_screen_point(
    window: &WebviewWindow,
    client_x: f64,
    client_y: f64,
    pixel_ratio: Option<f64>,
) -> Result<(f64, f64), String> {
    if !client_x.is_finite() || !client_y.is_finite() {
        return Err("Invalid pointer coordinates".into());
    }
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(client_to_screen(
        (origin.x as f64, origin.y as f64),
        (client_x, client_y),
        scale,
        pixel_ratio,
    ))
}

fn pointer_pixel_ratio(scale: f64, pixel_ratio: Option<f64>) -> f64 {
    pixel_ratio
        .filter(|ratio| ratio.is_finite() && *ratio > 0.0)
        .unwrap_or(scale)
}

fn client_to_screen(
    origin: (f64, f64),
    point: (f64, f64),
    scale: f64,
    pixel_ratio: Option<f64>,
) -> (f64, f64) {
    let ratio = pointer_pixel_ratio(scale, pixel_ratio);
    (origin.0 + point.0 * ratio, origin.1 + point.1 * ratio)
}

fn screen_to_logical(origin: (f64, f64), point: (f64, f64), scale: f64) -> (f64, f64) {
    ((point.0 - origin.0) / scale, (point.1 - origin.1) / scale)
}

fn window_at_point(
    app: &AppHandle,
    source_label: &str,
    px: f64,
    py: f64,
    pixel_ratio: Option<f64>,
) -> Option<WebviewWindow> {
    // The source owns its own drop region even when another workspace window
    // lies beneath it. Use the same six logical-pixel pop-out threshold as JS.
    if let Some(source) = app.get_webview_window(source_label) {
        if let (Ok(origin), Ok(size), Ok(scale)) = (
            source.inner_position(),
            source.inner_size(),
            source.scale_factor(),
        ) {
            if source_owns_point(
                origin.x as f64,
                origin.y as f64,
                size.width as f64,
                size.height as f64,
                pointer_pixel_ratio(scale, pixel_ratio),
                px,
                py,
            ) {
                return None;
            }
        }
    }
    let mut windows = crate::window::workspace_windows(app);
    #[cfg(target_os = "windows")]
    let topmost = unsafe {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};
        GetAncestor(
            WindowFromPoint(POINT {
                x: px.round() as i32,
                y: py.round() as i32,
            }),
            GA_ROOT,
        )
    };
    windows.sort_by_key(|candidate| {
        (
            !candidate.is_focused().unwrap_or(false),
            candidate.label() != "main",
            candidate.label().to_string(),
        )
    });
    windows.into_iter().find(|candidate| {
        #[cfg(target_os = "windows")]
        if candidate.hwnd().ok().map(|handle| handle.0) != Some(topmost) {
            return false;
        }
        if candidate.label() == source_label
            || !candidate.is_visible().unwrap_or(false)
            || candidate.is_minimized().unwrap_or(true)
        {
            return false;
        }
        let (Ok(origin), Ok(size)) = (candidate.inner_position(), candidate.inner_size()) else {
            return false;
        };
        contains_point(
            origin.x as f64,
            origin.y as f64,
            size.width as f64,
            size.height as f64,
            px,
            py,
        )
    })
}

fn source_owns_point(
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    scale: f64,
    x: f64,
    y: f64,
) -> bool {
    let margin = 6.0 * scale;
    x >= left - margin
        && x <= left + width + margin
        && y >= top - margin
        && y <= top + height + margin
}

fn destination_point(window: &WebviewWindow, point: (f64, f64)) -> Result<(f64, f64), String> {
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(screen_to_logical(
        (origin.x as f64, origin.y as f64),
        point,
        scale,
    ))
}

fn emit_drag_hover(
    app: &AppHandle,
    target: &str,
    payload: &WindowTabDragHover,
) -> Result<(), String> {
    app.emit_to(
        tauri::EventTarget::webview_window(target),
        "window_tab_drag_hover",
        payload,
    )
    .map_err(|e| e.to_string())
}

fn finish_drag_preview(window: &WebviewWindow, state: &WindowTransferState) {
    if let Ok(mut previews) = state.drag_previews.lock() {
        if let Some(previous) = previews.get_mut(window.label()) {
            let drag_id = previous.drag_id.clone();
            if let Some(target) = previous.clear(&drag_id, previous.revision.saturating_add(1)) {
                let _ = emit_drag_hover(
                    window.app_handle(),
                    &target,
                    &WindowTabDragHover {
                        drag_id: previous.drag_id.clone(),
                        source_window_label: window.label().to_string(),
                        source_id: previous.source_id.clone(),
                        source_ids: previous.source_ids.clone(),
                        revision: previous.revision,
                        ended: true,
                        x: None,
                        y: None,
                        scale_factor: None,
                    },
                );
            }
        }
    }
}

/// Destroying a destination releases its source immediately. Destroying a drag
/// source also clears its last hover in every still-live destination.
pub fn window_closed(app: &AppHandle, label: &str) {
    let state = app.state::<WindowTransferState>();
    state.reject_closed_destination(label);
    if let Ok(mut previews) = state.drag_previews.lock() {
        if let Some(previous) = previews.remove(label) {
            if let Some(target) = previous.target {
                let _ = emit_drag_hover(
                    app,
                    &target,
                    &WindowTabDragHover {
                        drag_id: previous.drag_id,
                        source_window_label: label.to_string(),
                        source_id: previous.source_id,
                        source_ids: previous.source_ids,
                        revision: previous.revision.saturating_add(1),
                        ended: true,
                        x: None,
                        y: None,
                        scale_factor: None,
                    },
                );
            }
        }
        for preview in previews.values_mut() {
            if preview.target.as_deref() == Some(label) {
                preview.target = None;
            }
        }
    };
}

/// Monotonic source revisions also order the terminal clear. Late IPC updates
/// cannot resurrect a hint after release/cancel or a subsequent gesture.
#[tauri::command]
// Optional group identity extends the existing drag IPC without breaking callers.
#[allow(clippy::too_many_arguments)]
pub fn preview_window_tab_drag(
    window: WebviewWindow,
    state: State<'_, WindowTransferState>,
    client_x: f64,
    client_y: f64,
    drag_id: String,
    source_id: String,
    revision: u64,
    source_ids: Option<Vec<String>>,
    pixel_ratio: Option<f64>,
) -> Result<(), String> {
    let point = source_screen_point(&window, client_x, client_y, pixel_ratio)?;
    let app = window.app_handle();
    let target = window_at_point(app, window.label(), point.0, point.1, pixel_ratio);
    let coords = target
        .as_ref()
        .map(|target| {
            destination_point(target, point).and_then(|(x, y)| {
                target
                    .scale_factor()
                    .map(|scale| (x, y, scale))
                    .map_err(|error| error.to_string())
            })
        })
        .transpose()?;
    let target_label = target.as_ref().map(|target| target.label().to_string());
    let mut previews = state.drag_previews.lock().map_err(|e| e.to_string())?;
    if let Some(previous) = previews.get(window.label()) {
        if !previous.accepts_preview(&drag_id, revision) {
            return Ok(());
        }
        if previous.target != target_label {
            if let Some(previous_target) = &previous.target {
                let _ = emit_drag_hover(
                    app,
                    previous_target,
                    &WindowTabDragHover {
                        drag_id: previous.drag_id.clone(),
                        source_window_label: window.label().to_string(),
                        source_id: previous.source_id.clone(),
                        source_ids: previous.source_ids.clone(),
                        revision,
                        ended: true,
                        x: None,
                        y: None,
                        scale_factor: None,
                    },
                );
            }
        }
    }
    let closed_drag_ids = previews
        .get(window.label())
        .map(|previous| previous.closed_drag_ids.clone())
        .unwrap_or_default();
    previews.insert(
        window.label().to_string(),
        DragPreviewState {
            drag_id: drag_id.clone(),
            source_id: source_id.clone(),
            source_ids: source_ids.clone().unwrap_or_default(),
            revision,
            target: target_label.clone(),
            closed_drag_ids,
        },
    );
    if let (Some(target), Some((x, y, scale))) = (target_label, coords) {
        emit_drag_hover(
            app,
            &target,
            &WindowTabDragHover {
                drag_id,
                source_window_label: window.label().to_string(),
                source_id,
                source_ids: source_ids.unwrap_or_default(),
                revision,
                ended: false,
                x: Some(x),
                y: Some(y),
                scale_factor: Some(scale),
            },
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_window_tab_drag(
    window: WebviewWindow,
    state: State<'_, WindowTransferState>,
    drag_id: String,
    revision: u64,
) -> Result<(), String> {
    let mut previews = state.drag_previews.lock().map_err(|e| e.to_string())?;
    if let Some(previous) = previews.get_mut(window.label()) {
        if let Some(target) = previous.clear(&drag_id, revision) {
            emit_drag_hover(
                window.app_handle(),
                &target,
                &WindowTabDragHover {
                    drag_id,
                    source_window_label: window.label().to_string(),
                    source_id: previous.source_id.clone(),
                    source_ids: previous.source_ids.clone(),
                    revision,
                    ended: true,
                    x: None,
                    y: None,
                    scale_factor: None,
                },
            )?;
        }
    } else {
        previews.insert(
            window.label().to_string(),
            DragPreviewState {
                closed_drag_ids: vec![drag_id.clone()],
                drag_id,
                source_id: String::new(),
                source_ids: vec![],
                revision,
                target: None,
            },
        );
    }
    Ok(())
}

/// Pointer coordinates are relative to the source webview. Convert to physical
/// screen pixels before comparing windows on monitors with different scaling.
#[tauri::command]
// Preserve the existing window-transfer IPC argument contract.
#[allow(clippy::too_many_arguments)]
pub async fn move_window_tabs(
    window: WebviewWindow,
    transfer: String,
    x: Option<f64>,
    y: Option<f64>,
    client_x: Option<f64>,
    client_y: Option<f64>,
    relocate: bool,
    target_window_label: Option<String>,
    pixel_ratio: Option<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app = window.app_handle();
        finish_drag_preview(&window, &app.state::<WindowTransferState>());
        let point = if let Some((cx, cy)) = client_x.zip(client_y) {
            Some(source_screen_point(&window, cx, cy, pixel_ratio)?)
        } else { None };
        let target = if let Some(label) = target_window_label.as_deref() {
            if label == window.label() { return Err("The session is already in this window.".into()); }
            Some(crate::window::workspace_windows(app).into_iter()
                .find(|candidate| candidate.label() == label)
                .ok_or_else(|| "The destination window is no longer open.".to_string())?)
        } else { point.and_then(|(px, py)| window_at_point(app, window.label(), px, py, pixel_ratio)) };
        if let Some(target) = target {
            // A cross-window drop is resolved in the receiving webview, so
            // pane edges use that window's own logical scale and DOM geometry.
            let transfer = if target_window_label.is_none() {
                if let Some((px, py)) = point {
                    let (x, y) = destination_point(&target, (px, py))?;
                    with_drop_point(&transfer, x, y, Some(target.scale_factor().map_err(|error| error.to_string())?))?
                } else { transfer }
            } else { transfer };
            let state = app.state::<WindowTransferState>();
            // Hold the readiness lock while staging so concurrent sources cannot
            // replace a transfer already consumed by its receiver.
            let (sender, receiver) = mpsc::channel();
            let transfer_id = uuid::Uuid::new_v4().to_string();
            {
                let mut ready = state.ready.lock().map_err(|e| e.to_string())?;
                if ready.contains_key(target.label()) { return Err("This window is already receiving a tab. Try again.".into()); }
                state.stage(target.label(), transfer)?;
                ready.insert(target.label().to_string(), PendingTransfer { id: Some(transfer_id.clone()), sender: Some(sender) });
            }
            let result = app.emit_to(tauri::EventTarget::webview_window(target.label()), "window_transfer_available", &transfer_id)
                .map_err(|e| e.to_string())
                .and_then(|_| receiver.recv_timeout(std::time::Duration::from_secs(30))
                    .map_err(|_| "The destination did not accept the tab. It remains in the original window.".to_string())?) ;
            state.discard(target.label());
            result?;
            if app.get_webview_window(target.label()).is_none() {
                return Err("The destination window closed. Your conversation remains in the original window.".into());
            }
            let _ = target.unminimize();
            let _ = target.show();
            let _ = target.set_focus();
            return Ok("transferred".into());
        }
        if let (true, Some((px, py))) = (relocate, point) {
            let scale = pointer_pixel_ratio(window.scale_factor().map_err(|e| e.to_string())?, pixel_ratio);
            window.set_position(tauri::PhysicalPosition::new((px - 120.0 * scale) as i32, (py - 16.0 * scale) as i32)).map_err(|e| e.to_string())?;
            let _ = crate::window::ensure_window_reachable(&window);
            return Ok("relocated".into());
        }
        if let Some((px, py)) = point {
            let scale = pointer_pixel_ratio(window.scale_factor().map_err(|e| e.to_string())?, pixel_ratio);
            crate::window::open_transfer_window_at_point(app, transfer,
                tauri::PhysicalPosition::new((px - 120.0 * scale) as i32, (py - 16.0 * scale) as i32))?;
        } else {
            crate::window::open_transfer_window(app, transfer, x.zip(y))?;
        }
        Ok("transferred".into())
    }).await.map_err(|e| e.to_string())?
}

fn with_drop_point(
    transfer: &str,
    x: f64,
    y: f64,
    scale_factor: Option<f64>,
) -> Result<String, String> {
    let mut payload: serde_json::Value =
        serde_json::from_str(transfer).map_err(|e| e.to_string())?;
    let object = payload
        .as_object_mut()
        .ok_or("Invalid window transfer payload")?;
    let mut drop_point = serde_json::json!({ "x": x, "y": y });
    if let Some(scale) = scale_factor {
        drop_point["scaleFactor"] = serde_json::json!(scale);
    }
    object.insert("dropPoint".into(), drop_point);
    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_window_transfer(
    window: WebviewWindow,
    state: State<'_, WindowTransferState>,
    transfer_id: Option<String>,
) -> Result<Option<String>, String> {
    state.take_checked(window.label(), transfer_id.as_deref())
}

#[tauri::command]
pub fn window_transfer_ready(
    window: WebviewWindow,
    state: State<'_, WindowTransferState>,
    transfer_id: Option<String>,
) -> Result<(), String> {
    state.finish_checked(window.label(), transfer_id.as_deref(), Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_pointer_conversion_uses_webview_zoom_in_addition_to_os_scale() {
        let origin = (-1600.0, 100.0);
        let client = (-80.0, 60.0);
        assert_eq!(
            client_to_screen(origin, client, 2.0, Some(3.0)),
            (-1840.0, 280.0)
        );
        assert_eq!(
            client_to_screen(origin, client, 2.0, None),
            (-1760.0, 220.0)
        );
    }

    #[test]
    fn absent_or_invalid_browser_pixel_ratios_keep_the_previous_os_scale_contract() {
        for ratio in [
            None,
            Some(0.0),
            Some(-1.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
        ] {
            assert_eq!(
                client_to_screen((20.0, 30.0), (100.0, 80.0), 1.5, ratio),
                (170.0, 150.0)
            );
        }
    }

    #[test]
    fn destination_os_logical_point_reconverts_to_zoomed_css_coordinates() {
        let physical = client_to_screen((-1600.0, 100.0), (-80.0, 60.0), 2.0, Some(3.0));
        let logical = screen_to_logical((-2560.0, 0.0), physical, 1.25);
        assert_eq!(logical, (576.0, 224.0));
        let payload = with_drop_point(r#"{"tabs":[]}"#, logical.0, logical.1, Some(1.25)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let native_scale = value["dropPoint"]["scaleFactor"].as_f64().unwrap();
        let receiver_pixel_ratio = 2.5;
        assert_eq!(logical.0 * native_scale / receiver_pixel_ratio, 288.0);
        assert_eq!(logical.1 * native_scale / receiver_pixel_ratio, 112.0);
        let legacy = with_drop_point(r#"{"tabs":[]}"#, logical.0, logical.1, None).unwrap();
        assert!(!legacy.contains("scaleFactor"));
    }

    #[test]
    fn stale_drag_clear_preserves_current_destination_and_revision() {
        let mut current = DragPreviewState {
            drag_id: "new".into(),
            source_id: "session".into(),
            source_ids: vec![],
            revision: 200,
            target: Some("main".into()),
            closed_drag_ids: vec![],
        };
        assert!(current.clear("old", 900).is_none());
        assert_eq!(current.revision, 200);
        assert_eq!(current.target.as_deref(), Some("main"));
        assert!(current.accepts_preview("new", 201));
        assert!(!current.accepts_preview("old", 901));
    }

    #[test]
    fn clear_before_first_hover_prevents_late_preview_without_stopping_other_gesture() {
        let mut current = DragPreviewState {
            drag_id: "previous".into(),
            source_id: "session".into(),
            source_ids: vec![],
            revision: 100,
            target: Some("main".into()),
            closed_drag_ids: vec![],
        };
        assert!(current.clear("not-yet-delivered", 300).is_none());
        assert!(!current.accepts_preview("not-yet-delivered", 200));
        assert!(!current.accepts_preview("not-yet-delivered", 400));
        assert!(current.accepts_preview("previous", 101));
        assert_eq!(current.clear("previous", 102).as_deref(), Some("main"));
        assert!(!current.accepts_preview("previous", 103));
        assert!(current.accepts_preview("next", 103));
    }

    #[test]
    fn source_region_blocks_phantom_underlying_target_until_popout_margin_is_crossed() {
        assert!(source_owns_point(
            -1600.0, 100.0, 1200.0, 900.0, 2.0, -500.0, 500.0
        ));
        assert!(source_owns_point(
            -1600.0, 100.0, 1200.0, 900.0, 2.0, -388.0, 500.0
        ));
        assert!(!source_owns_point(
            -1600.0, 100.0, 1200.0, 900.0, 2.0, -387.0, 500.0
        ));
    }

    #[test]
    fn hover_protocol_uses_target_logical_coordinates_and_terminal_clear_has_no_point() {
        let active = WindowTabDragHover {
            drag_id: "drag-1".into(),
            source_window_label: "window-2".into(),
            source_id: "session-1".into(),
            source_ids: vec!["session-1".into(), "session-2".into()],
            revision: 42,
            ended: false,
            x: Some(120.5),
            y: Some(80.0),
            scale_factor: Some(1.5),
        };
        let value = serde_json::to_value(&active).unwrap();
        assert_eq!(value["sourceWindowLabel"], "window-2");
        assert_eq!(value["sourceId"], "session-1");
        assert_eq!(
            value["sourceIds"],
            serde_json::json!(["session-1", "session-2"])
        );
        assert_eq!(value["dragId"], "drag-1");
        assert_eq!(value["x"], 120.5);
        assert_eq!(value["revision"], 42);
        assert_eq!(value["scaleFactor"], 1.5);
        let clear = WindowTabDragHover {
            revision: 43,
            ended: true,
            x: None,
            y: None,
            scale_factor: None,
            ..active
        };
        let value = serde_json::to_value(&clear).unwrap();
        assert_eq!(value["ended"], true);
        assert!(value.get("x").is_none());
        assert!(value.get("y").is_none());
        assert!(value.get("scaleFactor").is_none());
    }

    #[test]
    fn cross_window_drop_keeps_payload_and_destination_coordinates() {
        let payload =
            with_drop_point(r#"{"tabs":[{"id":"moving"}]}"#, 120.5, 80.0, Some(1.5)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["tabs"][0]["id"], "moving");
        assert_eq!(value["dropPoint"]["x"], 120.5);
        assert_eq!(value["dropPoint"]["y"], 80.0);
        assert_eq!(value["dropPoint"]["scaleFactor"], 1.5);
        assert!(with_drop_point("[]", 0.0, 0.0, None).is_err());
    }

    #[test]
    fn drop_bounds_support_negative_monitor_origins_and_physical_scaling() {
        assert!(contains_point(-2560.0, 0.0, 2560.0, 1440.0, -1200.0, 100.0));
        assert!(!contains_point(-2560.0, 0.0, 2560.0, 1440.0, 0.0, 100.0));
        // A 2x source at (2000, 0), dragged 600 logical px left.
        assert!(contains_point(
            0.0,
            0.0,
            1600.0,
            1200.0,
            2000.0 - 600.0 * 2.0,
            100.0
        ));
    }

    #[test]
    fn a_destination_rejection_is_returned_to_the_source() {
        let state = WindowTransferState::new();
        let ready = state.watch_ready("target").unwrap();
        state.finish("target", Err("duplicate tab".into())).unwrap();
        assert_eq!(ready.recv().unwrap(), Err("duplicate tab".into()));
    }

    #[test]
    fn closing_destination_rejects_waiter_and_discards_unconsumed_payload() {
        let state = WindowTransferState::new();
        state.stage("target", "payload".into()).unwrap();
        let ready = state.watch_ready("target").unwrap();
        state.reject_closed_destination("target");
        assert!(ready.recv().unwrap().unwrap_err().contains("closed"));
        assert_eq!(state.take("target").unwrap(), None);
        // Preserve the reservation until its original sender handles the error.
        assert!(state.ready.lock().unwrap().contains_key("target"));
        state.discard("target");
    }

    #[test]
    fn staging_cannot_replace_an_unconsumed_transfer() {
        let state = WindowTransferState::new();
        state.stage("target", "original".into()).unwrap();
        assert!(state.stage("target", "replacement".into()).is_err());
        assert_eq!(state.take("target").unwrap().as_deref(), Some("original"));
    }

    #[test]
    fn stale_replies_cannot_complete_or_consume_a_later_transfer() {
        let state = WindowTransferState::new();
        let (sender, receiver) = mpsc::channel();
        state.ready.lock().unwrap().insert(
            "target".into(),
            PendingTransfer {
                id: Some("new".into()),
                sender: Some(sender),
            },
        );
        state.stage("target", "new payload".into()).unwrap();
        assert!(state.take_checked("target", Some("old")).is_err());
        assert!(state.finish_checked("target", Some("old"), Ok(())).is_err());
        assert_eq!(receiver.try_recv(), Err(mpsc::TryRecvError::Empty));
        assert_eq!(
            state
                .take_checked("target", Some("new"))
                .unwrap()
                .as_deref(),
            Some("new payload")
        );
        state.finish_checked("target", Some("new"), Ok(())).unwrap();
        assert_eq!(receiver.recv().unwrap(), Ok(()));
        assert!(state.ready.lock().unwrap().contains_key("target"));
        state.discard("target");
        assert!(!state.ready.lock().unwrap().contains_key("target"));
    }

    #[test]
    fn each_window_takes_only_its_own_payload() {
        let state = WindowTransferState::new();
        state.stage("window-1", "a".into()).unwrap();
        state.stage("window-2", "b".into()).unwrap();
        assert_eq!(state.take("window-2").unwrap().as_deref(), Some("b"));
        assert_eq!(state.take("window-1").unwrap().as_deref(), Some("a"));
        assert_eq!(state.take("window-1").unwrap(), None);
    }

    #[test]
    fn an_empty_payload_is_rejected() {
        assert!(WindowTransferState::new()
            .stage("window-1", " ".into())
            .is_err());
    }

    #[test]
    fn a_failed_window_leaves_nothing_behind() {
        let state = WindowTransferState::new();
        state.stage("window-1", "a".into()).unwrap();
        state.discard("window-1");
        assert_eq!(state.take("window-1").unwrap(), None);
    }

    #[test]
    fn readiness_is_scoped_and_taking_payload_is_not_readiness() {
        let state = WindowTransferState::new();
        state.stage("a", "payload".into()).unwrap();
        let ready = state.watch_ready("a").unwrap();
        state.take("a").unwrap();
        state.acknowledge("b").unwrap();
        assert!(matches!(ready.try_recv(), Err(mpsc::TryRecvError::Empty)));
        state.acknowledge("a").unwrap();
        assert_eq!(ready.try_recv(), Ok(Ok(())));
        state.acknowledge("a").unwrap();
    }

    #[test]
    fn discarding_a_transfer_releases_its_waiter() {
        let state = WindowTransferState::new();
        let ready = state.watch_ready("a").unwrap();
        state.discard("a");
        assert_eq!(ready.try_recv(), Err(mpsc::TryRecvError::Disconnected));
    }
}
