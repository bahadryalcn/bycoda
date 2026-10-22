//! Windows restores hidden windows; macOS/Linux also expose recent sessions.

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const SHOW: &str = "tray_show";
const QUIT: &str = "tray_quit";
const NOTIFICATIONS: &str = "tray_notifications";
const SESSION_PREFIX: &str = "tray_session_";
const OPEN_EVENT: &str = "bycoda:tray-open-session";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Working,
    Input,
    Done,
    Active,
    Retrying,
    Failed,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub(crate) id: String,
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) status: SessionStatus,
    pub(crate) updated_at: u64,
    pub(crate) owned: bool,
}

#[derive(Clone, Deserialize)]
pub struct Labels {
    recent: String,
    empty: String,
    working: String,
    input: String,
    done: String,
    active: String,
    #[serde(default = "failed_label")]
    failed: String,
    #[serde(default = "retrying_label")]
    retrying: String,
    notifications: String,
}

impl Default for Labels {
    fn default() -> Self {
        Self {
            recent: "Last sessions".into(),
            empty: "No recent sessions".into(),
            working: "Working".into(),
            input: "Needs input".into(),
            done: "Done".into(),
            active: "Active".into(),
            failed: failed_label(),
            retrying: retrying_label(),
            notifications: "Notifications".into(),
        }
    }
}

fn failed_label() -> String {
    "Failed or usage limit".into()
}
fn retrying_label() -> String {
    "Retrying".into()
}

#[derive(Default)]
struct TrayState {
    windows: BTreeMap<String, Vec<SessionRow>>,
    // Opaque menu IDs avoid interpreting session/title content as actions.
    targets: BTreeMap<String, (String, String)>,
    generation: u64,
    labels: Labels,
}

fn merged_rows(windows: &BTreeMap<String, Vec<SessionRow>>) -> Vec<(String, SessionRow)> {
    let mut rows: BTreeMap<String, (String, SessionRow)> = BTreeMap::new();
    for (window, snapshot) in windows {
        for row in snapshot {
            let replace = rows.get(&row.key).is_none_or(|(_, current)| {
                (row.owned && !current.owned)
                    || (row.owned == current.owned && row.updated_at > current.updated_at)
            });
            if replace {
                rows.insert(row.key.clone(), (window.clone(), row.clone()));
            }
        }
    }
    let rank = |status| match status {
        SessionStatus::Input => 0,
        SessionStatus::Failed => 1,
        SessionStatus::Retrying => 2,
        SessionStatus::Working => 3,
        SessionStatus::Done => 4,
        SessionStatus::Active => 5,
    };
    let mut rows: Vec<_> = rows.into_values().collect();
    rows.sort_by(|a, b| {
        rank(a.1.status)
            .cmp(&rank(b.1.status))
            .then(b.1.updated_at.cmp(&a.1.updated_at))
            .then(a.1.key.cmp(&b.1.key))
    });
    rows
}

fn compact_label(label: &str) -> String {
    let mut chars = label.chars().filter(|c| !c.is_control());
    let mut text: String = chars.by_ref().take(100).collect();
    if chars.next().is_some() {
        text.pop();
        text.push('…');
    }
    text
}

fn visible_rows(rows: Vec<(String, SessionRow)>) -> Vec<(String, SessionRow)> {
    let mut idle = 0;
    rows.into_iter()
        .filter(|(_, row)| {
            if matches!(row.status, SessionStatus::Done | SessionStatus::Active) {
                idle += 1;
                idle <= 10
            } else {
                true
            }
        })
        .collect()
}

fn refresh(app: &AppHandle, state: &mut TrayState) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let rows = merged_rows(&state.windows);
    let count = |status| rows.iter().filter(|(_, row)| row.status == status).count();
    let working = count(SessionStatus::Working) + count(SessionStatus::Retrying);
    let input = count(SessionStatus::Input) + count(SessionStatus::Failed);
    let summary = format!(
        "{} {} · {} {} · {} {} · {} {}",
        working,
        state.labels.working,
        input,
        state.labels.input,
        count(SessionStatus::Done),
        state.labels.done,
        count(SessionStatus::Active),
        state.labels.active
    );
    let name = &app.package_info().name;
    let mut menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id(SHOW, format!("Show {name}")).build(app)?);
    state.generation = state.generation.wrapping_add(1);
    let mut targets = BTreeMap::new();
    if rows.is_empty() {
        menu = menu.separator().item(
            &MenuItemBuilder::new(&state.labels.empty)
                .enabled(false)
                .build(app)?,
        );
    }
    // Live work stays one click away. Idle history is tucked into a submenu.
    let rows = visible_rows(rows);
    for (status, heading) in [
        (SessionStatus::Input, &state.labels.input),
        (SessionStatus::Failed, &state.labels.failed),
        (SessionStatus::Retrying, &state.labels.retrying),
        (SessionStatus::Working, &state.labels.working),
        (SessionStatus::Done, &state.labels.done),
        (SessionStatus::Active, &state.labels.recent),
    ] {
        let group: Vec<_> = rows
            .iter()
            .enumerate()
            .filter(|(_, (_, row))| row.status == status)
            .collect();
        if group.is_empty() {
            continue;
        }
        let heading = format!("{heading} ({})", group.len());
        if status == SessionStatus::Active {
            let mut recent = SubmenuBuilder::new(app, &heading);
            for (index, (window, row)) in group {
                let id = format!("{SESSION_PREFIX}{}_{index}", state.generation);
                recent = recent
                    .item(&MenuItemBuilder::with_id(&id, compact_label(&row.label)).build(app)?);
                targets.insert(id, (window.clone(), row.id.clone()));
            }
            menu = menu.separator().item(&recent.build()?);
        } else {
            menu = menu
                .separator()
                .item(&MenuItemBuilder::new(&heading).enabled(false).build(app)?);
            for (index, (window, row)) in group {
                let id = format!("{SESSION_PREFIX}{}_{index}", state.generation);
                menu = menu
                    .item(&MenuItemBuilder::with_id(&id, compact_label(&row.label)).build(app)?);
                targets.insert(id, (window.clone(), row.id.clone()));
            }
        }
    }
    let menu = menu
        .separator()
        .item(&MenuItemBuilder::with_id(NOTIFICATIONS, &state.labels.notifications).build(app)?)
        .item(&MenuItemBuilder::with_id(QUIT, format!("Quit {name}")).build(app)?)
        .build()?;
    tray.set_menu(Some(menu))?;
    state.targets = targets;
    tray.set_tooltip(Some(format!("{name} · {summary}")))?;
    #[cfg(target_os = "macos")]
    tray.set_title(Some(""))?;
    Ok(())
}

#[tauri::command]
pub fn tray_sessions_update(
    app: AppHandle,
    window: tauri::WebviewWindow,
    rows: Vec<SessionRow>,
    labels: Labels,
) -> Result<(), String> {
    let state = app.state::<Mutex<TrayState>>();
    let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
    state.windows.insert(window.label().to_string(), rows);
    state.labels = labels;
    refresh(&app, &mut state).map_err(|e| e.to_string())
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let state = app.state::<Mutex<TrayState>>();
    let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
    state.windows.remove(label);
    if let Err(error) = refresh(app, &mut state) {
        eprintln!("Session menu refresh failed: {error}");
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Mutex::new(TrayState::default()));
    // The product name differs per build (Bycoda, Bycoda Fork, Bycoda Dev).
    let name = &app.package_info().name;
    let show = MenuItemBuilder::with_id(SHOW, format!("Show {name}")).build(app)?;
    let quit = MenuItemBuilder::with_id(QUIT, format!("Quit {name}")).build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(name)
        .menu(&menu)
        // Windows left click reopens; macOS/Linux expose the session menu.
        .show_menu_on_left_click(!cfg!(target_os = "windows"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => {
                let _ = crate::window::show_hidden_or_open_new(app);
            }
            QUIT => crate::window::request_quit(app),
            NOTIFICATIONS => {
                let windows = crate::window::workspace_windows(app);
                if let Some(window) = windows
                    .iter()
                    .find(|w| w.is_focused().unwrap_or(false))
                    .or_else(|| windows.first())
                {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("bycoda:tray-notifications", ());
                }
            }
            id if id.starts_with(SESSION_PREFIX) => {
                let target = app
                    .state::<Mutex<TrayState>>()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .targets
                    .get(id)
                    .cloned();
                if let Some((label, session_id)) = target {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit(OPEN_EVENT, session_id);
                    }
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "windows")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                )
            {
                let _ = crate::window::show_hidden_or_open_new(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        // Three compact bars with transparent surroundings: a template adapts
        // to both light and dark menu bars without a boxed application icon.
        let mut rgba = vec![0u8; 20 * 20 * 4];
        for (top, right) in [(4, 15), (9, 12), (14, 16)] {
            for y in top..top + 2 {
                for x in 4..right {
                    rgba[(y * 20 + x) * 4 + 3] = 255;
                }
            }
        }
        tray = tray
            .icon(tauri::image::Image::new_owned(rgba, 20, 20))
            .icon_as_template(true);
    }

    tray.build(app)?;
    refresh(
        app,
        &mut app
            .state::<Mutex<TrayState>>()
            .lock()
            .unwrap_or_else(|e| e.into_inner()),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, key: &str, status: SessionStatus, owned: bool, updated_at: u64) -> SessionRow {
        SessionRow {
            id: id.into(),
            key: key.into(),
            label: id.into(),
            status,
            owned,
            updated_at,
        }
    }

    #[test]
    fn owned_session_outranks_newer_history_and_host_summary() {
        let windows = BTreeMap::from([
            (
                "main".into(),
                vec![row("host-id", "host-id", SessionStatus::Active, false, 100)],
            ),
            (
                "session-window".into(),
                vec![row("local-id", "host-id", SessionStatus::Working, true, 10)],
            ),
        ]);
        let merged = merged_rows(&windows);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0, "session-window");
        assert_eq!(merged[0].1.id, "local-id");
        assert_eq!(merged[0].1.status, SessionStatus::Working);
    }

    #[test]
    fn attention_then_working_then_recent_idle_and_closed_window_is_removed() {
        let mut windows = BTreeMap::from([
            (
                "main".into(),
                vec![
                    row("idle", "idle", SessionStatus::Active, false, 100),
                    row("done", "done", SessionStatus::Done, true, 40),
                ],
            ),
            (
                "other".into(),
                vec![
                    row("working", "working", SessionStatus::Working, true, 20),
                    row("input", "input", SessionStatus::Input, true, 10),
                ],
            ),
        ]);
        assert_eq!(
            merged_rows(&windows)
                .iter()
                .map(|(_, row)| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["input", "working", "done", "idle"]
        );
        windows.remove("other");
        assert_eq!(merged_rows(&windows).len(), 2);
    }

    #[test]
    fn menu_labels_have_no_control_characters_and_are_bounded_by_characters() {
        assert_eq!(compact_label("hello\n\tworld"), "helloworld");
        let long = compact_label(&"ş".repeat(200));
        assert_eq!(long.chars().count(), 100);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn history_limit_never_hides_working_or_waiting_sessions() {
        let mut rows: Vec<_> = (0..15)
            .map(|index| {
                (
                    "main".into(),
                    row(
                        &format!("idle-{index}"),
                        &format!("idle-{index}"),
                        SessionStatus::Active,
                        false,
                        0,
                    ),
                )
            })
            .collect();
        rows.push((
            "main".into(),
            row("work", "work", SessionStatus::Working, true, 0),
        ));
        rows.push((
            "main".into(),
            row("input", "input", SessionStatus::Input, true, 0),
        ));
        let visible = visible_rows(rows);
        assert_eq!(visible.len(), 12);
        assert_eq!(visible[10].1.id, "work");
        assert_eq!(visible[11].1.id, "input");
    }
}
