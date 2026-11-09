//! Floating voice companion window.
//!
//! The voice session (microphone, recognition, playback and tools) stays in the
//! workspace window that started it. This always-on-top window only mirrors
//! that state and sends commands back, so it can float over other
//! applications while the workspace is hidden, minimized or in the background.
//! One overlay belongs to one workspace window and closes with it.

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::window::is_workspace_window;

pub const VOICE_OVERLAY_PREFIX: &str = "voice-overlay-";
/// Sent to the owner when its overlay disappears for any reason, including
/// a native close that never reached the overlay's page.
const CLOSED_EVENT: &str = "voice_overlay_closed";

const MIN_WIDTH: f64 = 160.0;
const MAX_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 40.0;
const MAX_HEIGHT: f64 = 640.0;
/// Keep this much of the window on screen so it can always be dragged back.
const MARGIN: i32 = 8;

pub fn is_voice_overlay(label: &str) -> bool {
    label.starts_with(VOICE_OVERLAY_PREFIX)
}

fn overlay_label(owner: &str) -> String {
    format!("{VOICE_OVERLAY_PREFIX}{owner}")
}

fn owner_label(overlay: &str) -> Option<&str> {
    overlay.strip_prefix(VOICE_OVERLAY_PREFIX)
}

/// Labels become a URL query value; accept only the characters Tauri labels
/// produced by this app use.
fn safe_label(label: &str) -> bool {
    !label.is_empty()
        && label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn clamp_size(width: f64, height: f64) -> Result<(f64, f64), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("Invalid voice window size.".into());
    }
    Ok((
        width.clamp(MIN_WIDTH, MAX_WIDTH),
        height.clamp(MIN_HEIGHT, MAX_HEIGHT),
    ))
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Area {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// Fit a physical rectangle inside a work area, preferring its top-left edge
/// when it is larger than the area.
fn clamp_into(x: f64, y: f64, width: i32, height: i32, area: Area) -> (i32, i32) {
    let max_x = area.x + (area.width - width - MARGIN).max(MARGIN);
    let max_y = area.y + (area.height - height - MARGIN).max(MARGIN);
    let x = (x.round() as i32).clamp(area.x + MARGIN, max_x.max(area.x + MARGIN));
    let y = (y.round() as i32).clamp(area.y + MARGIN, max_y.max(area.y + MARGIN));
    (x, y)
}

fn area_of(monitor: &Monitor) -> Area {
    let area = monitor.work_area();
    Area {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width as i32,
        height: area.size.height as i32,
    }
}

fn monitor_at(app: &AppHandle, window: &WebviewWindow, x: f64, y: f64) -> Option<Monitor> {
    app.monitor_from_point(x, y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

/// Place `overlay` with its top-left at a physical point, sized in logical
/// pixels of whichever screen that point lands on.
fn place(
    app: &AppHandle,
    overlay: &WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let monitor = monitor_at(app, overlay, x + 1.0, y + 1.0);
    let scale = monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let physical_width = (width * scale).round() as i32;
    let physical_height = (height * scale).round() as i32;
    let (x, y) = match monitor.as_ref() {
        Some(monitor) => clamp_into(x, y, physical_width, physical_height, area_of(monitor)),
        None => (x.round() as i32, y.round() as i32),
    };
    overlay
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    overlay
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPlacement {
    /// `true` for a drag that left the workspace window: `x`/`y` are the grab
    /// offset inside the panel and the window appears under the pointer.
    /// Otherwise `x`/`y` are the panel's client position in the owner window.
    from_cursor: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Open (or move and reveal) the floating voice window of the calling
/// workspace window. Returns the overlay's label.
#[tauri::command]
pub async fn voice_overlay_open(
    app: AppHandle,
    window: WebviewWindow,
    placement: OverlayPlacement,
) -> Result<String, String> {
    let owner = window.label().to_string();
    if is_voice_overlay(&owner) || !is_workspace_window(&owner) || !safe_label(&owner) {
        return Err("Only a workspace window can open the voice window.".into());
    }
    if !placement.x.is_finite() || !placement.y.is_finite() {
        return Err("Invalid voice window position.".into());
    }
    let (width, height) = clamp_size(placement.width, placement.height)?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let (x, y) = if placement.from_cursor {
        let cursor = app.cursor_position().map_err(|error| error.to_string())?;
        (
            cursor.x - placement.x * scale,
            cursor.y - placement.y * scale,
        )
    } else {
        let origin = window.inner_position().map_err(|error| error.to_string())?;
        (
            origin.x as f64 + placement.x * scale,
            origin.y as f64 + placement.y * scale,
        )
    };
    let label = overlay_label(&owner);
    if let Some(existing) = app.get_webview_window(&label) {
        place(&app, &existing, x, y, width, height)?;
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(label);
    }
    let overlay = crate::webview_args::inherit_main_browser_args(
        &app,
        WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::App(format!("voice-overlay.html?owner={owner}").into()),
        ),
    )
    .title(&app.package_info().name)
    .inner_size(width, height)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    // macOS shadows follow the page's alpha. Elsewhere an undecorated
    // transparent window would get a rectangular frame, so the page draws
    // its own outline instead.
    .shadow(cfg!(target_os = "macos"))
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    place(&app, &overlay, x, y, width, height)?;
    overlay.show().map_err(|error| error.to_string())?;
    let _ = overlay.set_focus();
    Ok(label)
}

fn overlay_only(window: &WebviewWindow) -> Result<(), String> {
    if is_voice_overlay(window.label()) {
        Ok(())
    } else {
        Err("Only the voice window can do this.".into())
    }
}

/// The overlay grows when it expands; keep the top-left anchored but stay on
/// the current screen.
#[tauri::command]
pub fn voice_overlay_fit(
    app: AppHandle,
    window: WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
    overlay_only(&window)?;
    let (width, height) = clamp_size(width, height)?;
    let origin = window.outer_position().map_err(|error| error.to_string())?;
    place(
        &app,
        &window,
        origin.x as f64,
        origin.y as f64,
        width,
        height,
    )
}

/// Keyboard movement for the drag handle, in logical pixels.
#[tauri::command]
pub fn voice_overlay_nudge(
    app: AppHandle,
    window: WebviewWindow,
    dx: f64,
    dy: f64,
) -> Result<(), String> {
    overlay_only(&window)?;
    if !dx.is_finite() || !dy.is_finite() {
        return Err("Invalid movement.".into());
    }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let origin = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let x = origin.x as f64 + dx.clamp(-200.0, 200.0) * scale;
    let y = origin.y as f64 + dy.clamp(-200.0, 200.0) * scale;
    let (x, y) = match monitor_at(&app, &window, x + 1.0, y + 1.0) {
        Some(monitor) => clamp_into(
            x,
            y,
            size.width as i32,
            size.height as i32,
            area_of(&monitor),
        ),
        None => (x.round() as i32, y.round() as i32),
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

/// Close the overlay of a workspace window, or the calling overlay itself.
#[tauri::command]
pub fn voice_overlay_close(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let label = if is_voice_overlay(window.label()) {
        window.label().to_string()
    } else {
        overlay_label(window.label())
    };
    if let Some(overlay) = app.get_webview_window(&label) {
        overlay.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Bring the owning workspace window forward from the floating window.
#[tauri::command]
pub fn voice_overlay_show_owner(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    overlay_only(&window)?;
    let owner = owner_label(window.label())
        .and_then(|label| app.get_webview_window(label))
        .ok_or_else(|| "The workspace window is no longer open.".to_string())?;
    let _ = owner.unminimize();
    owner.show().map_err(|error| error.to_string())?;
    owner.set_focus().map_err(|error| error.to_string())
}

/// Keep the pair consistent when either window goes away.
pub fn window_destroyed(app: &AppHandle, label: &str) {
    if let Some(owner) = owner_label(label) {
        let _ = app.emit_to(owner, CLOSED_EVENT, ());
    } else if let Some(overlay) = app.get_webview_window(&overlay_label(label)) {
        let _ = overlay.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn labels_round_trip_and_are_not_workspaces() {
        let label = overlay_label("main");
        assert!(is_voice_overlay(&label));
        assert_eq!(owner_label(&label), Some("main"));
        assert!(!is_workspace_window(&label));
        assert!(is_workspace_window("main"));
    }

    #[test]
    fn unsafe_owner_labels_are_rejected() {
        assert!(safe_label("window-3_a"));
        assert!(!safe_label("a&b=c"));
        assert!(!safe_label(""));
    }

    #[test]
    fn placement_stays_inside_the_work_area() {
        assert_eq!(clamp_into(-400.0, -50.0, 320, 48, AREA), (8, 8));
        assert_eq!(clamp_into(5000.0, 5000.0, 320, 48, AREA), (1592, 984));
        assert_eq!(clamp_into(100.4, 200.6, 320, 48, AREA), (100, 201));
    }

    #[test]
    fn placement_respects_a_negative_origin_monitor() {
        let left = Area {
            x: -1280,
            y: 0,
            width: 1280,
            height: 1024,
        };
        assert_eq!(clamp_into(-1500.0, 10.0, 320, 48, left), (-1272, 10));
    }

    #[test]
    fn sizes_are_bounded() {
        assert_eq!(clamp_size(10.0, 10_000.0).unwrap(), (MIN_WIDTH, MAX_HEIGHT));
        assert!(clamp_size(f64::NAN, 10.0).is_err());
    }
}
