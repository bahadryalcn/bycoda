//! A native screen-edge indicator, independent of workspace visibility and voice.
//! Only bounded status and an exact captured-owner Stop cross this boundary.
use crate::remote::NativeServiceChannel;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "desktop-control-indicator";
const EVENT: &str = "desktop_control_indicator_state";
const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const CHANGE_WAIT: Duration = Duration::from_secs(25);
const DEADLINE: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Action {
    app: String,
    action: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Status {
    enabled: bool,
    active: bool,
    stopped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_action: Option<Action>,
    #[serde(skip_serializing_if = "Option::is_none")]
    assistant_name: Option<String>,
}
impl Status {
    fn parse(value: &serde_json::Value) -> Result<Self, String> {
        let status: Self = serde_json::from_value(value.clone())
            .map_err(|_| "Computer control status is invalid")?;
        if status
            .assistant_name
            .as_ref()
            .is_some_and(|name| name.chars().count() > 80)
            || status.current_action.as_ref().is_some_and(|action| {
                action.app.chars().count() > 200 || action.action.chars().count() > 80
            })
        {
            return Err("Computer control status is invalid".into());
        }
        Ok(status)
    }
    fn inactive(&self) -> bool {
        !self.enabled && !self.active
    }
}
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    revision: u64,
    status: Option<Status>,
    status_error: bool,
    stop_error: bool,
    stopping: bool,
    visible: bool,
}
#[derive(Default)]
struct Core {
    view: View,
    generation: u64,
    dismissed: bool,
}
impl Core {
    fn poll(&mut self, generation: u64, result: Result<Status, String>) -> bool {
        if generation != self.generation || self.view.stopping {
            return false;
        }
        let previous = self.view.clone();
        match result {
            Ok(status) => {
                if status.enabled || status.active {
                    self.dismissed = false;
                    self.view.visible = true;
                }
                if status.stopped && status.inactive() {
                    self.view.stop_error = false;
                }
                self.view.status = Some(status);
                self.view.status_error = false;
            }
            Err(_) => {
                self.view.status = None;
                self.view.status_error = true;
            }
        }
        if self.dismissed {
            self.view.visible = false;
        }
        self.changed(previous)
    }
    fn begin_stop(&mut self) -> Option<u64> {
        if self.view.stopping {
            return None;
        }
        self.generation = self.generation.wrapping_add(1);
        self.view.stopping = true;
        self.view.stop_error = false;
        self.view.revision += 1;
        Some(self.generation)
    }
    fn finish_stop(&mut self, generation: u64, ok: bool) -> bool {
        if generation != self.generation {
            return false;
        }
        let previous = self.view.clone();
        self.view.stopping = false;
        if ok {
            let status = self.view.status.get_or_insert(Status {
                enabled: false,
                active: false,
                stopped: true,
                current_action: None,
                assistant_name: None,
            });
            status.enabled = false;
            status.active = false;
            status.stopped = true;
            status.current_action = None;
            self.view.status_error = false;
            self.view.stop_error = false;
        } else {
            self.view.stop_error = true;
        }
        self.changed(previous)
    }
    fn changed(&mut self, previous: View) -> bool {
        if self.view == previous {
            return false;
        }
        self.view.revision += 1;
        true
    }
    fn dismiss(&mut self) -> Result<(), String> {
        if self.view.stopping
            || self.view.status_error
            || self.view.stop_error
            || !self.view.status.as_ref().is_some_and(Status::inactive)
        {
            return Err(
                "Computer control must be confirmed inactive before hiding its controls".into(),
            );
        }
        self.dismissed = true;
        self.view.visible = false;
        self.view.revision += 1;
        Ok(())
    }
    #[cfg(test)]
    fn can_rebind(&self) -> bool {
        !self.view.stopping
            && !self.view.status_error
            && !self.view.stop_error
            && self.view.status.as_ref().is_some_and(Status::inactive)
    }
}
#[derive(Default)]
pub(crate) struct State {
    core: Mutex<Core>,
    source: Mutex<Option<Arc<NativeServiceChannel>>>,
    running: AtomicBool,
}

pub fn is_indicator(label: &str) -> bool {
    label == LABEL
}
fn indicator_only(window: &WebviewWindow) -> Result<(), String> {
    if is_indicator(window.label()) {
        Ok(())
    } else {
        Err("Only the computer control indicator can use this command".into())
    }
}
fn viewer_only(window: &WebviewWindow) -> Result<(), String> {
    if is_indicator(window.label()) || crate::window::is_workspace_window(window.label()) {
        Ok(())
    } else {
        Err("Only workspace and computer control windows can use this command".into())
    }
}

fn edge_position(x: i32, y: i32, width: u32, height: u32, scale: f64) -> (f64, f64, i32, i32) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let logical_width = (width as f64 / scale - 16.0).clamp(160.0, 640.0);
    let logical_height = (height as f64 / scale - 16.0).clamp(40.0, 64.0);
    let physical_width = (logical_width * scale).round() as i32;
    (
        logical_width,
        logical_height,
        x + ((width as i32 - physical_width) / 2).max(0),
        y + (8.0 * scale).round() as i32,
    )
}
fn configured_main_browser_args(windows: &[tauri::utils::config::WindowConfig]) -> Option<&str> {
    windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.as_deref())
}
fn create(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let builder =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("desktop-control.html".into()));
    // This dynamic window shares the main WebView2 data directory. Its exact
    // environment options must match, including an explicitly configured CDP
    // switch. Builder::new does not inherit the configured main window's args.
    let builder = if let Some(args) = configured_main_browser_args(&app.config().app.windows) {
        builder.additional_browser_args(args)
    } else {
        builder
    };
    let window = builder
        .title(&app.package_info().name)
        .inner_size(640.0, 64.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|error| error.to_string())?;
    // Closing a safety indicator cannot hide an active or uncertain operation.
    let owner = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if owner.state::<State>().running.load(Ordering::Acquire) {
                api.prevent_close();
            }
        }
    });
    Ok(window)
}
#[cfg(target_os = "windows")]
fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    // `.focused(false)` covers initial creation only; a later Tao show uses SW_SHOW.
    unsafe {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(())
}
#[cfg(target_os = "macos")]
fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // Ordinary Tauri show makes this a key window; ordering alone preserves the active app.
    unsafe {
        (&*(pointer as *mut objc2_app_kit::NSWindow)).orderFrontRegardless();
    }
    Ok(())
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}
#[cfg(target_os = "windows")]
fn hide_indicator(window: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            ShowWindow(hwnd.0, SW_HIDE);
        }
    }
}
#[cfg(not(target_os = "windows"))]
fn hide_indicator(window: &WebviewWindow) {
    let _ = window.hide();
}
fn publish(app: &AppHandle) {
    let view = match app.state::<State>().core.lock() {
        Ok(core) => core.view.clone(),
        Err(_) => return,
    };
    let app = app.clone();
    let dispatcher = app.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        if !app.state::<State>().running.load(Ordering::Acquire) {
            return;
        }
        // Check the newest state on the UI queue; a late poll must not reveal a dismissed window.
        let current = match app.state::<State>().core.lock() {
            Ok(core) => core.view.clone(),
            Err(_) => return,
        };
        if current.revision != view.revision {
            return;
        }
        let window = match app.get_webview_window(LABEL) {
            Some(window) => window,
            None if current.visible => match create(&app) {
                Ok(window) => window,
                Err(_) => return,
            },
            None => return,
        };
        let _ = app.emit_to(LABEL, EVENT, &current);
        for workspace in crate::window::workspace_windows(&app) {
            let _ = app.emit_to(workspace.label(), EVENT, &current);
        }
        if current.visible {
            if !window.is_visible().unwrap_or(false) {
                let monitor = app
                    .cursor_position()
                    .ok()
                    .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten())
                    .or_else(|| app.primary_monitor().ok().flatten());
                if let Some(monitor) = monitor {
                    let area = monitor.work_area();
                    let (width, height, x, y) = edge_position(
                        area.position.x,
                        area.position.y,
                        area.size.width,
                        area.size.height,
                        monitor.scale_factor(),
                    );
                    let _ = window.set_size(LogicalSize::new(width, height));
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
                // Deliberately no set_focus: other applications keep their input owner.
                let _ = show_without_focus(&window);
            }
        } else {
            hide_indicator(&window);
        }
    });
}
pub(crate) fn init(app: &AppHandle) -> Result<(), String> {
    app.manage(State::default());
    create(app)?;
    app.state::<State>().running.store(true, Ordering::Release);
    let app = app.clone();
    std::thread::Builder::new()
        .name("desktop-control-indicator".into())
        .spawn(move || {
            let mut revision = String::new();
            while app.state::<State>().running.load(Ordering::Acquire) {
                let generation = {
                    let state = app.state::<State>();
                    let result = match state.core.lock() {
                        Ok(core) if !core.view.stopping => Some(core.generation),
                        _ => None,
                    };
                    result
                };
                if let Some(generation) = generation {
                    let source = {
                        let state = app.state::<State>();
                        state.source.lock().ok().and_then(|source| source.clone())
                    };
                    let source = source.map(Ok).unwrap_or_else(|| {
                        NativeServiceChannel::connect_until(&app, Some(Instant::now() + DEADLINE))
                    });
                    let result = source.and_then(|source| {
                        {
                            let state = app.state::<State>();
                            let mut captured = state
                                .source
                                .lock()
                                .map_err(|_| "Computer control source is unavailable")?;
                            if captured.is_none() {
                                *captured = Some(source.clone());
                            }
                        }
                        source.project_until(
                            "desktop.status",
                            json!({}),
                            Instant::now() + DEADLINE,
                            Status::parse,
                        )
                    });
                    let changed = {
                        let state = app.state::<State>();
                        let result = match state.core.lock() {
                            Ok(mut core) => core.poll(generation, result),
                            Err(_) => false,
                        };
                        result
                    };
                    let needs_show = {
                        let state = app.state::<State>();
                        state
                            .core
                            .lock()
                            .map(|core| core.view.visible)
                            .unwrap_or(false)
                    } && app
                        .get_webview_window(LABEL)
                        .is_none_or(|window| !window.is_visible().unwrap_or(false));
                    if changed || needs_show {
                        publish(&app);
                    }
                }
                let source = app
                    .state::<State>()
                    .source
                    .lock()
                    .ok()
                    .and_then(|source| source.clone());
                let change = source
                    .as_ref()
                    .ok_or("Computer control source is unavailable".to_string())
                    .and_then(|source| {
                        source.project_until(
                            "desktop.status.wait",
                            json!({"afterRevision": revision.clone(), "timeoutMs": 25000}),
                            Instant::now() + CHANGE_WAIT + DEADLINE,
                            |value| {
                                value["revision"]
                                    .as_str()
                                    .filter(|revision| revision.len() <= 100)
                                    .map(str::to_owned)
                                    .ok_or("Computer control status revision is invalid".into())
                            },
                        )
                    });
                match change {
                    Ok(next) => revision = next,
                    Err(error) => {
                        let state = app.state::<State>();
                        if let Ok(mut core) = state.core.lock() {
                            let generation = core.generation;
                            core.poll(generation, Err(error));
                        }
                        if let Ok(mut captured) = state.source.lock() {
                            if source.as_ref().is_some_and(|old| {
                                captured
                                    .as_ref()
                                    .is_some_and(|current| Arc::ptr_eq(old, current))
                                    && !old.is_current()
                            }) {
                                *captured = None;
                                revision.clear();
                            }
                        }
                        publish(&app);
                        std::thread::sleep(RECONNECT_DELAY);
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}
pub(crate) fn shutdown(app: &AppHandle) {
    app.state::<State>().running.store(false, Ordering::Release);
}

#[tauri::command]
pub fn desktop_control_indicator_state(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<View, String> {
    viewer_only(&window)?;
    app.try_state::<State>()
        .ok_or("Computer control indicator is unavailable")?
        .core
        .lock()
        .map(|core| core.view.clone())
        .map_err(|_| "Computer control state is unavailable".into())
}

#[tauri::command]
pub async fn desktop_control_indicator_stop(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    viewer_only(&window)?;
    stop_captured(app).await
}
/// Used only by trusted native physical-shortcut handling and the finite UI command above.
pub(crate) async fn stop_captured(app: AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<State>()
        .ok_or("Computer control indicator is unavailable")?;
    let source = state
        .source
        .lock()
        .map_err(|_| "Computer control source is unavailable")?
        .clone();
    let generation = state
        .core
        .lock()
        .map_err(|_| "Computer control state is unavailable")?
        .begin_stop()
        .ok_or("Computer control Stop is already pending")?;
    publish(&app);
    let owner = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let source = match source {
            Some(source) => source,
            None => {
                let captured =
                    NativeServiceChannel::connect_until(&owner, Some(Instant::now() + DEADLINE))?;
                let state = owner.state::<State>();
                let mut current = state
                    .source
                    .lock()
                    .map_err(|_| "Computer control source is unavailable")?;
                current.get_or_insert(captured).clone()
            }
        };
        source.project_until(
            "desktop.stop",
            json!({}),
            Instant::now() + DEADLINE,
            |value| {
                if value["stopped"] == true {
                    Ok(())
                } else {
                    Err("Computer control Stop was not confirmed".into())
                }
            },
        )
    })
    .await
    .map_err(|_| "Computer control Stop was interrupted".to_string())
    .and_then(|result| result);
    if let Ok(mut core) = app.state::<State>().core.lock() {
        core.finish_stop(generation, result.is_ok());
    }
    publish(&app);
    result
}
#[tauri::command]
pub fn desktop_control_indicator_dismiss(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    indicator_only(&window)?;
    app.state::<State>()
        .core
        .lock()
        .map_err(|_| "Computer control state is unavailable")?
        .dismiss()?;
    publish(&app);
    Ok(())
}

#[tauri::command]
pub fn desktop_control_indicator_fit(window: WebviewWindow, height: f64) -> Result<(), String> {
    indicator_only(&window)?;
    if !height.is_finite() {
        return Err("Invalid computer control window size".into());
    }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let width = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .width as f64
        / scale;
    window
        .set_size(LogicalSize::new(width, height.clamp(40.0, 180.0)))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dynamic_indicator_inherits_only_the_actual_main_windows_browser_args() {
        let main_args = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --remote-debugging-port=19771";
        let auxiliary = tauri::utils::config::WindowConfig {
            label: "other-window".into(),
            additional_browser_args: Some("--another-window-option".into()),
            ..Default::default()
        };
        let main = tauri::utils::config::WindowConfig {
            label: "main".into(),
            additional_browser_args: Some(main_args.into()),
            ..Default::default()
        };
        let windows = [auxiliary, main];
        assert_eq!(configured_main_browser_args(&windows), Some(main_args));
        assert_eq!(configured_main_browser_args(&windows[..1]), None);
        let mut release = windows[1].clone();
        release.additional_browser_args = None;
        assert_eq!(configured_main_browser_args(&[release]), None);
    }
    fn active() -> Status {
        Status {
            enabled: true,
            active: true,
            stopped: false,
            current_action: Some(Action {
                app: "Editor".into(),
                action: "click".into(),
            }),
            assistant_name: Some("Arif".into()),
        }
    }
    #[test]
    fn status_is_bounded_and_cannot_contain_clipboard_or_tree_data() {
        assert!(Status::parse(
            &json!({"enabled":true,"active":true,"stopped":false,"clipboard":"secret"})
        )
        .is_err());
        assert!(Status::parse(&json!({"enabled":true,"active":true,"stopped":false,"currentAction":{"app":"x".repeat(201),"action":"click"}})).is_err());
    }
    #[test]
    fn inactive_startup_stays_hidden_and_active_or_unknown_cannot_be_dismissed() {
        let mut core = Core::default();
        let mut idle = active();
        idle.enabled = false;
        idle.active = false;
        core.poll(0, Ok(idle));
        assert!(!core.view.visible);
        core.poll(0, Ok(active()));
        assert!(core.view.visible);
        assert!(core.dismiss().is_err());
        core.poll(0, Err("unavailable".into()));
        assert!(core.view.visible);
        assert!(core.view.status_error);
        assert!(core.view.status.is_none());
        assert!(core.dismiss().is_err());
    }
    #[test]
    fn stop_fences_old_poll_and_requires_actual_ack_before_hiding() {
        let mut core = Core::default();
        core.poll(0, Ok(active()));
        let stop = core.begin_stop().unwrap();
        assert!(core.begin_stop().is_none());
        assert!(!core.poll(0, Ok(active())));
        core.finish_stop(stop, false);
        assert!(core.view.stop_error);
        assert!(core.dismiss().is_err());
        let retry = core.begin_stop().unwrap();
        core.finish_stop(retry, true);
        assert!(core.can_rebind());
        assert!(core.view.status.as_ref().unwrap().stopped);
        assert!(core.view.visible);
        core.dismiss().unwrap();
        assert!(!core.view.visible);
        assert!(!core.poll(stop, Ok(active())));
        assert!(!core.view.visible);
    }
    #[test]
    fn edge_geometry_keeps_mixed_dpi_negative_monitors_and_small_screens_reachable() {
        assert_eq!(
            edge_position(-1920, 0, 1920, 1040, 1.0),
            (640.0, 64.0, -1280, 8)
        );
        assert_eq!(edge_position(0, 0, 1920, 1040, 2.0), (640.0, 64.0, 320, 16));
        let (width, _, x, y) = edge_position(-800, -600, 800, 560, 1.0);
        assert_eq!(width, 640.0);
        assert_eq!((x, y), (-720, -592));
    }
}
