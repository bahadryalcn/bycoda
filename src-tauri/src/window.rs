use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::window::Color;
#[cfg(target_os = "windows")]
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow, WebviewWindowBuilder};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

/// The floating quick composer. It is a webview window but not a workspace:
/// it has no sessions, takes no part in quitting, and is never shown by the
/// paths that bring workspace windows back.
pub const QUICK_COMPOSER_LABEL: &str = "quick-composer";
pub const QUICK_COMPOSER_GIT_LABEL: &str = "quick-composer-git";
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

const QUIT_POLL: &str = "quit_poll";
const QUIT_CONFIRM: &str = "quit_confirm";
const QUIT_COMMIT: &str = "quit_commit";
const QUIT_ABORTED: &str = "quit_aborted";

/// A wedged webview must not strand the app. Missing the poll deadline is safe
/// because silence counts as busy, so it can be short.
const POLL_TIMEOUT: Duration = Duration::from_secs(2);
const COMMIT_TIMEOUT: Duration = Duration::from_secs(10);
/// Confirming waits on a person, so this is a backstop rather than a deadline:
/// a dialog that never arrives, or an answer that never gets back, would
/// otherwise leave Quit dead for the life of the process. Expiring only abandons
/// the run, so a later Quit starts a fresh one.
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Polling,
    Confirming,
    Committing,
}

/// One quit at a time, decided in one place. Quit events reach every window, so
/// letting each answer for itself let an idle window exit the app while a busy
/// one was still asking - killing agents nobody agreed to stop.
struct QuitRun {
    id: u32,
    stage: Stage,
    /// Windows still owing a reply for the current stage.
    pending: HashSet<String>,
    /// Windows that answered the poll, so their listeners are known to be live.
    replied: HashSet<String>,
    in_flight: u32,
    /// The window showing the dialog, so its close can abort the quit.
    prompt: Option<String>,
}

static QUIT_RUN: Mutex<Option<QuitRun>> = Mutex::new(None);
static QUIT_COUNTER: AtomicU32 = AtomicU32::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitConfirm {
    id: u32,
    in_flight: u32,
}

pub fn open_new_window(app: &AppHandle) -> Result<(), String> {
    open_session_window(app, true).map(|_| ())
}

/// Boot a tool window without adopting the main workspace's conversations.
pub fn open_tool_window(
    app: &AppHandle,
    tool: &str,
    cwd: &str,
    grouped: bool,
) -> Result<(), String> {
    let url = tool_window_url(tool, cwd, grouped)?;
    build_session_window_with_url(app, true, None, Some(url)).map(|_| ())
}

fn tool_window_url(tool: &str, cwd: &str, grouped: bool) -> Result<tauri::WebviewUrl, String> {
    if ![
        "servers",
        "social",
        "tasks",
        "automations",
        "inbox",
        "notes",
        "conversation-tools",
        "terminal",
    ]
    .contains(&tool)
    {
        return Err("Unknown workspace tool".into());
    }
    let mut url =
        tauri::Url::parse("https://bycoda.invalid/index.html").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("tool", tool)
        .append_pair("cwd", cwd)
        .append_pair("tools", if grouped { "all" } else { "single" });
    Ok(tauri::WebviewUrl::App(
        format!("index.html?{}", url.query().unwrap_or_default()).into(),
    ))
}

/// Opens a window with its top-left corner at the given screen position
/// (logical pixels), e.g. where a tab was dropped outside its window.
/// Opens a workspace window seeded with `payload`, which only that window can
/// take, so two quick pop-outs cannot swap or overwrite each other's tabs.
pub fn open_transfer_window(
    app: &AppHandle,
    payload: String,
    position: Option<(f64, f64)>,
) -> Result<(), String> {
    open_transfer_window_position(
        app,
        payload,
        position.map(|(x, y)| tauri::LogicalPosition::new(x, y).into()),
    )
}

/// The source webview's native origin and scale are authoritative on mixed-DPI
/// desktops. Browser screen coordinates alone do not share that coordinate space.
pub fn open_transfer_window_at_point(
    app: &AppHandle,
    payload: String,
    position: tauri::PhysicalPosition<i32>,
) -> Result<(), String> {
    open_transfer_window_position(app, payload, Some(position.into()))
}

fn open_transfer_window_position(
    app: &AppHandle,
    payload: String,
    position: Option<tauri::Position>,
) -> Result<(), String> {
    // The source keeps its tab until the destination has actually mounted.
    let (window, ready) = build_session_window(app, true, Some(WindowSeed { payload, position }))?;
    let state = app.state::<crate::window_transfer::WindowTransferState>();
    // Registered before build below; boot can acknowledge before build returns.
    let result = ready
        .ok_or_else(|| "missing window readiness waiter".to_string())?
        .recv_timeout(Duration::from_secs(30));
    state.discard(window.label());
    let accepted = result
        .map_err(|_| {
            "The new window did not become ready. Your conversation remains in the original window."
                .to_string()
        })
        .and_then(|result| result);
    if let Err(error) = accepted {
        let _ = window.destroy();
        return Err(error);
    }
    if app.get_webview_window(window.label()).is_none() {
        return Err(
            "The destination window closed. Your conversation remains in the original window."
                .into(),
        );
    }
    Ok(())
}

struct WindowSeed {
    payload: String,
    position: Option<tauri::Position>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn reachable_bounds(bounds: ScreenRect, areas: &[ScreenRect]) -> ScreenRect {
    // A deliberately spanning window remains valid when all its corners are on
    // the available desktop. Only recover bounds that actually leave work areas.
    let right = i64::from(bounds.x) + i64::from(bounds.width.saturating_sub(1));
    let bottom = i64::from(bounds.y) + i64::from(bounds.height.saturating_sub(1));
    let corners = [
        (i64::from(bounds.x), i64::from(bounds.y)),
        (right, i64::from(bounds.y)),
        (i64::from(bounds.x), bottom),
        (right, bottom),
    ];
    if corners.iter().all(|(x, y)| {
        areas.iter().any(|area| {
            *x >= i64::from(area.x)
                && *x < i64::from(area.x) + i64::from(area.width)
                && *y >= i64::from(area.y)
                && *y < i64::from(area.y) + i64::from(area.height)
        })
    }) {
        return bounds;
    }
    // Prefer the work area with the greatest overlap. For a removed monitor,
    // fall back to the nearest work area instead of assuming a (0, 0) origin.
    let area = areas
        .iter()
        .filter(|area| area.width > 0 && area.height > 0)
        .max_by(|a, b| {
            let score = |area: &&ScreenRect| {
                let left = i64::from(bounds.x).max(i64::from(area.x));
                let top = i64::from(bounds.y).max(i64::from(area.y));
                let right = (i64::from(bounds.x) + i64::from(bounds.width))
                    .min(i64::from(area.x) + i64::from(area.width));
                let bottom = (i64::from(bounds.y) + i64::from(bounds.height))
                    .min(i64::from(area.y) + i64::from(area.height));
                let overlap = (right - left).max(0) * (bottom - top).max(0);
                let cx = 2 * i64::from(bounds.x) + i64::from(bounds.width);
                let cy = 2 * i64::from(bounds.y) + i64::from(bounds.height);
                let dx = i128::from(
                    cx - cx.clamp(
                        2 * i64::from(area.x),
                        2 * (i64::from(area.x) + i64::from(area.width)),
                    ),
                );
                let dy = i128::from(
                    cy - cy.clamp(
                        2 * i64::from(area.y),
                        2 * (i64::from(area.y) + i64::from(area.height)),
                    ),
                );
                (overlap, -(dx * dx + dy * dy))
            };
            score(a).cmp(&score(b))
        });
    let Some(area) = area else {
        return bounds;
    };
    let width = bounds.width.min(area.width);
    let height = bounds.height.min(area.height);
    ScreenRect {
        x: i64::from(bounds.x).clamp(
            i64::from(area.x),
            i64::from(area.x) + i64::from(area.width - width),
        ) as i32,
        y: i64::from(bounds.y).clamp(
            i64::from(area.y),
            i64::from(area.y) + i64::from(area.height - height),
        ) as i32,
        width,
        height,
    }
}

/// Reuse window-state's saved dimensions, but keep the entire restored window
/// and its title controls reachable after monitor or work-area changes.
pub fn ensure_window_reachable(window: &WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())?
        || window.is_fullscreen().map_err(|error| error.to_string())?
        || window.is_minimized().map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    let origin = window.outer_position().map_err(|error| error.to_string())?;
    let outer = window.outer_size().map_err(|error| error.to_string())?;
    let bounds = ScreenRect {
        x: origin.x,
        y: origin.y,
        width: outer.width,
        height: outer.height,
    };
    let areas: Vec<_> = window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            ScreenRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect();
    let reachable = reachable_bounds(bounds, &areas);
    if reachable.width != bounds.width || reachable.height != bounds.height {
        let inner = window.inner_size().map_err(|error| error.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(
                reachable
                    .width
                    .saturating_sub(outer.width.saturating_sub(inner.width))
                    .max(1),
                reachable
                    .height
                    .saturating_sub(outer.height.saturating_sub(inner.height))
                    .max(1),
            ))
            .map_err(|error| error.to_string())?;
    }
    if reachable.x != bounds.x || reachable.y != bounds.y {
        window
            .set_position(tauri::PhysicalPosition::new(reachable.x, reachable.y))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn configure_session_window(config: &mut tauri::utils::config::WindowConfig, reveal: bool) {
    config.visible = reveal;
    config.focus = reveal;
    // Secondary windows host individual conversations, so they must not inherit
    // the main workspace's minimum size when its config is cloned.
    config.min_width = None;
    config.min_height = None;
}

pub fn open_session_window(app: &AppHandle, reveal: bool) -> Result<WebviewWindow, String> {
    build_session_window(app, reveal, None).map(|(window, _)| window)
}

fn build_session_window(
    app: &AppHandle,
    reveal: bool,
    seed: Option<WindowSeed>,
) -> Result<(WebviewWindow, Option<crate::window_transfer::WindowReady>), String> {
    build_session_window_with_url(app, reveal, seed, None)
}

fn build_session_window_with_url(
    app: &AppHandle,
    reveal: bool,
    seed: Option<WindowSeed>,
    url: Option<tauri::WebviewUrl>,
) -> Result<(WebviewWindow, Option<crate::window_transfer::WindowReady>), String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("missing main window config")?
        .clone();

    configure_session_window(&mut config, reveal);
    if let Some(url) = url {
        config.url = url;
        config.title = "bycoda".into();
    }
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    config.label = if reveal {
        format!("window-{id}")
    } else {
        format!("quick-session-{}", uuid::Uuid::new_v4())
    };

    let label = config.label.clone();
    let position = seed.as_ref().and_then(|seed| seed.position);
    let ready = if let Some(seed) = seed {
        // Staged before the webview exists, so its boot always finds it.
        let state = app.state::<crate::window_transfer::WindowTransferState>();
        state.stage(&label, seed.payload)?;
        Some(state.watch_ready(&label)?)
    } else {
        None
    };

    crate::ssh_window_lifecycle::register(&label)?;
    let build = || {
        let builder =
            WebviewWindowBuilder::from_config(app, &config).map_err(|err| err.to_string())?;
        builder.build().map_err(|err| err.to_string())
    };
    #[cfg(target_os = "macos")]
    let window = if reveal {
        build()
    } else {
        crate::macos_background::without_activation(build)
    };
    #[cfg(not(target_os = "macos"))]
    let window = build();
    let window = window.inspect_err(|_| {
        crate::ssh_window_lifecycle::close(&label);
        app.state::<crate::window_transfer::WindowTransferState>()
            .discard(&label);
    })?;

    // The persistence plugin runs during build. An explicit drop overrides its
    // old position and expanded state, while its remembered normal size survives.
    if let Some(position) = position {
        let _ = window.set_fullscreen(false);
        let _ = window.unmaximize();
        let _ = window.set_position(position);
    }
    let _ = ensure_window_reachable(&window);

    #[cfg(target_os = "macos")]
    {
        // Pop-outs are built on a blocking worker. AppKit chrome must be
        // installed on the main thread; readiness is still awaited off-thread.
        let chrome_window = window.clone();
        window
            .run_on_main_thread(move || crate::macos::install(&chrome_window))
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_decorations(false);
        let _ = window.set_shadow(true);
    }

    if reveal {
        let _ = window.set_focus();
    }
    Ok((window, ready))
}

/// The page colour to fill the window with when glass is off. Not a constant:
/// Linux can turn glass off in dark mode, not just light.
#[derive(Clone, Copy, Deserialize)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

// macOS hands the components to AppKit instead, so it has no use for this.
#[cfg(any(target_os = "windows", target_os = "linux"))]
impl Rgb {
    fn fill(self) -> Color {
        Color(self.r, self.g, self.b, 255)
    }
}

/// Desktop blur goes on after the first UI paint and only in dark mode.
#[tauri::command]
pub fn set_window_glass_enabled(window: WebviewWindow, enabled: bool, background: Rgb) {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            let _ = window.set_background_color(Some(Color(0, 0, 0, 3)));
            crate::macos::enable_glass(&window);
        } else {
            crate::macos::disable_glass(&window, background.r, background.g, background.b);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
            let _ = window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build());
        } else {
            let _ = window.set_effects(None);
            let _ = window.set_background_color(Some(background.fill()));
        }
    }
    #[cfg(target_os = "linux")]
    {
        // No system blur API on Linux: transparency only. The compositor
        // (e.g. Mutter) blends the translucent CSS glass over the desktop.
        let _ = window.set_background_color(Some(if enabled {
            Color(0, 0, 0, 0)
        } else {
            background.fill()
        }));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (window, enabled, background);
    }
}

/// Close with a running chat hides the webview so the harness child keeps going.
#[tauri::command]
pub fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|err| err.to_string())
}

/// Finish an idle close. `destroy` skips CloseRequested so the JS handler
/// does not loop; `close` would fire it again.
#[tauri::command]
pub fn destroy_window(window: WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|err| err.to_string())
}

pub fn is_workspace_window(label: &str) -> bool {
    label != QUICK_COMPOSER_LABEL && label != QUICK_COMPOSER_GIT_LABEL
}

/// Every workspace window, sorted by label.
pub fn workspace_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    let mut windows: Vec<WebviewWindow> = app
        .webview_windows()
        .into_values()
        .filter(|window| is_workspace_window(window.label()))
        .collect();
    windows.sort_by(|a, b| a.label().cmp(b.label()));
    windows
}

fn workspace_labels(app: &AppHandle) -> Vec<String> {
    workspace_windows(app)
        .iter()
        .map(|window| window.label().to_string())
        .collect()
}

/// Dock click / Cmd-click with no visible windows: bring hidden ones back.
pub fn show_hidden_or_open_new(app: &AppHandle) -> Result<(), String> {
    let windows = workspace_windows(app);
    if windows.is_empty() {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = open_new_window(&app) {
                eprintln!("Could not open workspace window: {error}");
            }
        });
        return Ok(());
    }
    for window in &windows {
        let _ = window.unminimize();
        let _ = ensure_window_reachable(window);
        let _ = window.show();
    }
    windows
        .first()
        .ok_or_else(|| "missing window".to_string())?
        .set_focus()
        .map_err(|err| err.to_string())
}

/// A Windows relaunch reveals one workspace without disturbing the other windows.
#[cfg(windows)]
pub fn show_existing_or_open_new(app: &AppHandle) -> Result<(), String> {
    let windows = workspace_windows(app);
    // Prefer the current workspace, then a visible one, then the main workspace.
    // Reopening must not reveal every hidden session/tool window.
    let window = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| {
            windows
                .iter()
                .find(|window| window.is_visible().unwrap_or(false))
        })
        .or_else(|| windows.iter().find(|window| window.label() == "main"))
        .or_else(|| windows.first());
    let Some(window) = window else {
        return show_hidden_or_open_new(app);
    };
    window.unminimize().map_err(|error| error.to_string())?;
    ensure_window_reachable(window)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

/// window-state can restore a window as hidden after a quit-while-hidden.
pub fn ensure_launch_window_visible(app: &AppHandle) {
    let windows = workspace_windows(app);
    if windows.is_empty() {
        return;
    }
    for window in &windows {
        let _ = ensure_window_reachable(window);
    }
    let any_visible = windows
        .iter()
        .any(|window| window.is_visible().unwrap_or(false));
    if any_visible {
        return;
    }
    let _ = show_hidden_or_open_new(app);
}

pub fn allow_exit() -> bool {
    ALLOW_EXIT.load(Ordering::SeqCst)
}

/// What the coordinator should do once a stage's bookkeeping is settled.
#[derive(Debug, PartialEq)]
enum Next {
    Wait,
    Confirm,
    Exit,
    Abort,
}

/// A quit already under way owns the decision. Starting a second one would
/// orphan the open dialog: its answer arrives for a run that no longer exists.
fn begin_run(slot: &mut Option<QuitRun>, id: u32, labels: Vec<String>) -> bool {
    if slot.is_some() {
        return false;
    }
    *slot = Some(QuitRun {
        id,
        stage: Stage::Polling,
        pending: labels.into_iter().collect(),
        replied: HashSet::new(),
        in_flight: 0,
        prompt: None,
    });
    true
}

fn record_reply(slot: &mut Option<QuitRun>, id: u32, label: &str, in_flight: u32) -> Next {
    let Some(run) = slot.as_mut() else {
        return Next::Wait;
    };
    if run.id != id || run.stage != Stage::Polling {
        return Next::Wait;
    }
    run.pending.remove(label);
    run.replied.insert(label.to_string());
    run.in_flight += in_flight;
    if run.pending.is_empty() {
        Next::Confirm
    } else {
        Next::Wait
    }
}

/// Silence counts as busy. A window that never answered may well have a turn
/// running, and guessing idle is what killed agents in the first place.
///
/// Closes once: a final reply and the poll timeout can land together, and
/// asking twice would send a second dialog that cancels the first.
fn close_poll(slot: &mut Option<QuitRun>, id: u32) -> Option<u32> {
    let run = slot
        .as_mut()
        .filter(|run| run.id == id && run.stage == Stage::Polling)?;
    run.in_flight += run.pending.len() as u32;
    run.pending.clear();
    run.stage = Stage::Confirming;
    Some(run.in_flight)
}

fn open_commit(slot: &mut Option<QuitRun>, id: u32, labels: Vec<String>) -> bool {
    let Some(run) = slot.as_mut().filter(|run| run.id == id) else {
        return false;
    };
    run.stage = Stage::Committing;
    run.pending = labels.into_iter().collect();
    true
}

fn record_ready(slot: &mut Option<QuitRun>, id: u32, label: &str) -> Next {
    let Some(run) = slot.as_mut() else {
        return Next::Wait;
    };
    if run.id != id || run.stage != Stage::Committing {
        return Next::Wait;
    }
    run.pending.remove(label);
    if run.pending.is_empty() {
        Next::Exit
    } else {
        Next::Wait
    }
}

fn drop_window(slot: &mut Option<QuitRun>, label: &str) -> Next {
    let Some(run) = slot.as_mut() else {
        return Next::Wait;
    };
    if run.stage == Stage::Confirming {
        return if run.prompt.as_deref() == Some(label) {
            Next::Abort
        } else {
            Next::Wait
        };
    }
    run.pending.remove(label);
    if !run.pending.is_empty() {
        return Next::Wait;
    }
    if run.stage == Stage::Polling {
        Next::Confirm
    } else {
        Next::Exit
    }
}

/// Ask every window what it has running, then decide once for all of them.
pub fn request_quit(app: &AppHandle) {
    let labels = workspace_labels(app);
    if labels.is_empty() {
        confirm_quit(app.clone());
        return;
    }
    let id = QUIT_COUNTER.fetch_add(1, Ordering::Relaxed);
    if !begin_run(
        &mut QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()),
        id,
        labels,
    ) {
        resurface_prompt(app);
        return;
    }
    // One webview tearing down fails the whole emit, and exiting on that would
    // kill every other window's work without asking. Let the poll time out
    // instead: silence counts as busy, so the user is still asked.
    let _ = app.emit(QUIT_POLL, id);
    watch_stage(app, id, Stage::Polling, POLL_TIMEOUT);
}

/// One window's live turn count, counted before anything is killed.
#[tauri::command]
pub fn quit_poll_reply(app: AppHandle, window: WebviewWindow, id: u32, in_flight: u32) {
    let next = record_reply(
        &mut QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()),
        id,
        window.label(),
        in_flight,
    );
    if next == Next::Confirm {
        start_confirm(&app, id);
    }
}

/// Bring a parked dialog back into view. The run cannot be restarted, and with
/// close-to-tray the user cannot close that window to clear it either.
fn resurface_prompt(app: &AppHandle) {
    let label = {
        let guard = QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner());
        let Some(run) = guard.as_ref() else { return };
        if run.stage != Stage::Confirming {
            return;
        }
        run.prompt.clone()
    };
    let Some(window) = label.and_then(|label| app.get_webview_window(&label)) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// The answer to the one dialog the whole app gets to show.
#[tauri::command]
pub fn quit_decision(app: AppHandle, window: WebviewWindow, id: u32, confirmed: bool) {
    {
        let guard = QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner());
        let Some(run) = guard.as_ref() else { return };
        if run.id != id || run.stage != Stage::Confirming {
            return;
        }
        // Only the window that was asked gets to answer for everyone.
        if run.prompt.as_deref() != Some(window.label()) {
            return;
        }
    }
    if confirmed {
        start_commit(&app, id);
    } else {
        clear_run(id);
    }
}

/// One window has persisted. The last one out turns the lights off, so a slow
/// window cannot lose its workspace to a faster window's exit.
#[tauri::command]
pub fn quit_ready(app: AppHandle, window: WebviewWindow, id: u32, persisted: bool) {
    // A window that could not save its workspace keeps the app open, the way a
    // failed persist did before the handshake existed. The windows that did
    // save are staying too, so take them back out of quitting.
    if !persisted {
        clear_run(id);
        let _ = app.emit(QUIT_ABORTED, ());
        return;
    }
    let next = record_ready(
        &mut QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()),
        id,
        window.label(),
    );
    if next == Next::Exit {
        confirm_quit(app);
    }
}

/// A window that closes mid-quit must not be waited on forever.
pub fn forget_quit_window(app: &AppHandle, label: &str) {
    let (id, next) = {
        let mut guard = QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner());
        let Some(id) = guard.as_ref().map(|run| run.id) else {
            return;
        };
        (id, drop_window(&mut guard, label))
    };
    match next {
        Next::Confirm => start_confirm(app, id),
        Next::Exit => confirm_quit(app.clone()),
        Next::Abort => clear_run(id),
        Next::Wait => {}
    }
}

fn start_confirm(app: &AppHandle, id: u32) {
    let Some(in_flight) = close_poll(
        &mut QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()),
        id,
    ) else {
        return;
    };
    if in_flight == 0 {
        start_commit(app, id);
        return;
    }
    if workspace_windows(app).is_empty() {
        clear_run(id);
        confirm_quit(app.clone());
        return;
    }
    // Tray Quit arrives with every window hidden, and a dialog parented to a
    // hidden window cannot be answered.
    let _ = show_hidden_or_open_new(app);
    let replied = {
        let guard = QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner());
        guard
            .as_ref()
            .filter(|run| run.id == id)
            .map(|run| run.replied.clone())
            .unwrap_or_default()
    };
    let Some(label) = prompt_window(app, &replied) else {
        clear_run(id);
        confirm_quit(app.clone());
        return;
    };
    if let Some(run) = QUIT_RUN
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_mut()
    {
        if run.id == id {
            run.prompt = Some(label.clone());
        }
    }
    let payload = QuitConfirm { id, in_flight };
    if app
        .emit_to(EventTarget::webview_window(&label), QUIT_CONFIRM, payload)
        .is_err()
    {
        clear_run(id);
        return;
    }
    watch_stage(app, id, Stage::Confirming, CONFIRM_TIMEOUT);
}

fn start_commit(app: &AppHandle, id: u32) {
    let labels = workspace_labels(app);
    let empty = labels.is_empty();
    if !open_commit(
        &mut QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()),
        id,
        labels,
    ) {
        return;
    }
    if empty {
        confirm_quit(app.clone());
        return;
    }
    // Same here: the windows that did receive it still deserve their save, so
    // the commit timeout is the backstop rather than exiting on the spot.
    let _ = app.emit(QUIT_COMMIT, id);
    watch_stage(app, id, Stage::Committing, COMMIT_TIMEOUT);
}

/// Prefer the window the user is looking at; any window beats none.
///
/// Only among windows that answered the poll, though: replying proves their
/// listeners are live. A window still booting would swallow the dialog, and
/// confirming has nothing to time out on.
fn prompt_window(app: &AppHandle, replied: &HashSet<String>) -> Option<String> {
    let windows = app.webview_windows();
    let labels = workspace_labels(app);
    let answered: Vec<String> = labels
        .iter()
        .filter(|label| replied.contains(*label))
        .cloned()
        .collect();
    let pool = if answered.is_empty() {
        &labels
    } else {
        &answered
    };
    let focused = pool.iter().find(|label| {
        windows
            .get(*label)
            .is_some_and(|window| window.is_focused().unwrap_or(false))
    });
    if let Some(label) = focused {
        return Some(label.clone());
    }
    let visible = pool.iter().find(|label| {
        windows
            .get(*label)
            .is_some_and(|window| window.is_visible().unwrap_or(false))
    });
    if let Some(label) = visible {
        return Some(label.clone());
    }
    pool.first().cloned()
}

/// Nothing waits forever: a webview that never answers still lets the app quit.
fn watch_stage(app: &AppHandle, id: u32, stage: Stage, wait: Duration) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        let stalled = QUIT_RUN
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|run| run.id == id && run.stage == stage);
        if !stalled {
            return;
        }
        match stage {
            Stage::Polling => start_confirm(&app, id),
            Stage::Committing => confirm_quit(app),
            Stage::Confirming => clear_run(id),
        }
    });
}

fn clear_run(id: u32) {
    let mut guard = QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner());
    if guard.as_ref().is_some_and(|run| run.id == id) {
        *guard = None;
    }
}

/// Persist already happened in JS. Show windows so window-state doesn't save hidden.
pub fn confirm_quit(app: AppHandle) {
    *QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()) = None;
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    for window in workspace_windows(&app) {
        let _ = window.show();
    }
    // Belt and braces. `RunEvent::Exit` reaps too, and it also runs before the
    // process is gone, but a macOS terminate that skips the run loop would not
    // reach it — and `kill_all`'s SIGKILL wait only works while we're alive.
    if let Some(host) = app.try_state::<crate::harness::HarnessHost>() {
        host.kill_all();
    }
    if let Some(host) = app.try_state::<crate::pty::PtyHost>() {
        host.kill_all();
    }
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_urls_preserve_project_paths_and_allow_only_workspace_tools() {
        for tool in [
            "servers",
            "social",
            "tasks",
            "automations",
            "inbox",
            "notes",
            "conversation-tools",
            "terminal",
        ] {
            let tauri::WebviewUrl::App(path) =
                tool_window_url(tool, "G:\\İş & plan #1", true).unwrap()
            else {
                panic!("tool window must use the app origin");
            };
            let base = tauri::Url::parse("http://tauri.localhost/").unwrap();
            let url = base.join(&path.to_string_lossy()).unwrap();
            let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(params["tool"], tool);
            assert_eq!(params["cwd"], "G:\\İş & plan #1");
            assert_eq!(params["tools"], "all");
            assert_eq!(url.host_str(), Some("tauri.localhost"));
        }
        assert!(tool_window_url("settings", "/repo", false).is_err());
    }

    #[test]
    fn restored_bounds_keep_title_controls_inside_a_negative_origin_work_area() {
        let area = ScreenRect {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1040,
        };
        let bounds = ScreenRect {
            x: -2100,
            y: -300,
            width: 900,
            height: 700,
        };
        assert_eq!(
            reachable_bounds(bounds, &[area]),
            ScreenRect {
                x: -1920,
                y: 40,
                width: 900,
                height: 700
            }
        );
    }

    #[test]
    fn removed_monitor_bounds_return_to_the_nearest_work_area_and_fit() {
        let left = ScreenRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let right = ScreenRect {
            x: 0,
            y: 0,
            width: 1280,
            height: 720,
        };
        let bounds = ScreenRect {
            x: 2400,
            y: 150,
            width: 1600,
            height: 1000,
        };
        assert_eq!(reachable_bounds(bounds, &[left, right]), right);
    }

    #[test]
    fn small_mixed_scale_windows_keep_their_size_and_existing_screen() {
        let areas = [
            ScreenRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            ScreenRect {
                x: 1920,
                y: -600,
                width: 2560,
                height: 1400,
            },
        ];
        let bounds = ScreenRect {
            x: 3000,
            y: -400,
            width: 360,
            height: 240,
        };
        assert_eq!(reachable_bounds(bounds, &areas), bounds);
        assert_eq!(reachable_bounds(bounds, &[]), bounds);
    }

    #[test]
    fn a_deliberately_spanning_window_keeps_its_layout() {
        let areas = [
            ScreenRect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
            },
            ScreenRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        ];
        let bounds = ScreenRect {
            x: -900,
            y: 100,
            width: 2000,
            height: 800,
        };
        assert_eq!(reachable_bounds(bounds, &areas), bounds);
    }

    #[test]
    fn background_session_creation_overrides_main_windows_visible_and_focus_defaults() {
        let mut config = tauri::utils::config::WindowConfig {
            visible: true,
            focus: true,
            ..Default::default()
        };
        configure_session_window(&mut config, false);
        assert!(!config.visible);
        assert!(!config.focus);
    }

    #[test]
    fn explicit_reveal_creates_a_visible_focused_session_window() {
        let mut config = tauri::utils::config::WindowConfig {
            visible: false,
            focus: false,
            ..Default::default()
        };
        configure_session_window(&mut config, true);
        assert!(config.visible);
        assert!(config.focus);
    }

    #[test]
    fn session_windows_do_not_inherit_the_main_workspace_minimum_size() {
        let main = tauri::utils::config::WindowConfig {
            min_width: Some(800.0),
            min_height: Some(520.0),
            ..Default::default()
        };
        for reveal in [false, true] {
            let mut config = main.clone();
            configure_session_window(&mut config, reveal);
            assert_eq!(config.min_width, None);
            assert_eq!(config.min_height, None);
        }
        assert_eq!(main.min_width, Some(800.0));
        assert_eq!(main.min_height, Some(520.0));
    }

    fn polling(labels: &[&str]) -> Option<QuitRun> {
        let mut slot = None;
        let owned = labels.iter().map(|label| label.to_string()).collect();
        assert!(begin_run(&mut slot, 1, owned));
        slot
    }

    fn in_flight(slot: &Option<QuitRun>) -> Option<u32> {
        slot.as_ref().map(|run| run.in_flight)
    }

    #[test]
    fn one_window_answering_does_not_decide_for_the_others() {
        let mut slot = polling(&["main", "window-2"]);
        assert_eq!(record_reply(&mut slot, 1, "main", 0), Next::Wait);
        assert_eq!(record_reply(&mut slot, 1, "window-2", 2), Next::Confirm);
        assert_eq!(close_poll(&mut slot, 1), Some(2));
    }

    #[test]
    fn a_window_that_never_answers_counts_as_busy() {
        let mut slot = polling(&["main", "window-2"]);
        record_reply(&mut slot, 1, "main", 0);
        // The poll timed out with window-2 still owing an answer.
        assert_eq!(close_poll(&mut slot, 1), Some(1));
    }

    #[test]
    fn replies_from_a_stale_run_are_ignored() {
        let mut slot = polling(&["main"]);
        assert_eq!(record_reply(&mut slot, 99, "main", 5), Next::Wait);
        assert_eq!(in_flight(&slot), Some(0));
    }

    #[test]
    fn a_second_quit_while_polling_is_ignored() {
        let mut slot = polling(&["main"]);
        assert!(!begin_run(&mut slot, 2, vec!["main".to_string()]));
        assert_eq!(slot.as_ref().map(|run| run.id), Some(1));
    }

    #[test]
    fn a_second_quit_leaves_the_open_dialog_in_charge() {
        let mut slot = polling(&["main"]);
        record_reply(&mut slot, 1, "main", 1);
        close_poll(&mut slot, 1);
        assert!(!begin_run(&mut slot, 2, vec!["main".to_string()]));
        assert_eq!(slot.as_ref().map(|run| run.id), Some(1));
    }

    #[test]
    fn only_windows_that_answered_are_offered_the_dialog() {
        let mut slot = polling(&["main", "window-2"]);
        record_reply(&mut slot, 1, "window-2", 1);
        // main never answered, so it is still booting or wedged: asking it
        // would leave the dialog unshown and the quit with nothing to await.
        let replied = slot.as_ref().map(|run| run.replied.clone());
        assert_eq!(replied, Some(HashSet::from(["window-2".to_string()])));
    }

    #[test]
    fn a_final_reply_and_the_timeout_cannot_both_close_the_poll() {
        let mut slot = polling(&["main"]);
        record_reply(&mut slot, 1, "main", 1);
        assert_eq!(close_poll(&mut slot, 1), Some(1));
        assert_eq!(close_poll(&mut slot, 1), None);
    }

    #[test]
    fn the_app_exits_only_once_every_window_has_persisted() {
        let mut slot = polling(&["main", "window-2"]);
        record_reply(&mut slot, 1, "main", 1);
        record_reply(&mut slot, 1, "window-2", 0);
        close_poll(&mut slot, 1);
        let labels = vec!["main".to_string(), "window-2".to_string()];
        assert!(open_commit(&mut slot, 1, labels));
        assert_eq!(record_ready(&mut slot, 1, "main"), Next::Wait);
        assert_eq!(record_ready(&mut slot, 1, "window-2"), Next::Exit);
    }

    #[test]
    fn a_window_closing_mid_poll_is_not_waited_on() {
        let mut slot = polling(&["main", "window-2"]);
        record_reply(&mut slot, 1, "main", 0);
        assert_eq!(drop_window(&mut slot, "window-2"), Next::Confirm);
    }

    #[test]
    fn closing_the_window_holding_the_dialog_aborts_the_quit() {
        let mut slot = polling(&["main"]);
        record_reply(&mut slot, 1, "main", 1);
        close_poll(&mut slot, 1);
        if let Some(run) = slot.as_mut() {
            run.prompt = Some("main".to_string());
        }
        assert_eq!(drop_window(&mut slot, "main"), Next::Abort);
    }

    #[test]
    fn another_window_closing_leaves_the_dialog_alone() {
        let mut slot = polling(&["main", "window-2"]);
        record_reply(&mut slot, 1, "main", 1);
        record_reply(&mut slot, 1, "window-2", 0);
        close_poll(&mut slot, 1);
        if let Some(run) = slot.as_mut() {
            run.prompt = Some("main".to_string());
        }
        assert_eq!(drop_window(&mut slot, "window-2"), Next::Wait);
    }
}
