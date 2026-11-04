//! Windows restores hidden windows; macOS/Linux also expose recent sessions.

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const SHOW: &str = "tray_show";
const QUIT: &str = "tray_quit";
const NOTIFICATIONS: &str = "tray_notifications";
const SESSION_PREFIX: &str = "tray_session_";
const OPEN_EVENT: &str = "bycoda:tray-open-session";
const PRESENCE_REFRESH: &str = "tray_presence_refresh";
const PRESENCE_PREFIX: &str = "tray_presence_choice_";

#[derive(Clone, Deserialize, Debug)]
#[serde(default)]
pub struct PresenceLabels {
    availability: String,
    here: String,
    away: String,
    dnd: String,
    idle: String,
    unknown: String,
    pending: String,
    failed: String,
    retry: String,
    refresh: String,
}
impl Default for PresenceLabels {
    fn default() -> Self {
        Self {
            availability: "Availability".into(),
            here: "Here".into(),
            away: "Away".into(),
            dnd: "Do not disturb".into(),
            idle: "Idle".into(),
            unknown: "Unknown".into(),
            pending: "Updating availability...".into(),
            failed: "Availability change was not confirmed.".into(),
            retry: "Retry".into(),
            refresh: "Refresh".into(),
        }
    }
}

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
    #[serde(default)]
    presence: PresenceLabels,
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
            presence: PresenceLabels::default(),
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
    /// What the installed menu shows; an update that changes none of it (only
    /// timestamps, say) skips rebuilding the native menu.
    rendered: Option<String>,
    presence: crate::assistant_presence::View,
    presence_targets: BTreeMap<String, (String, crate::assistant_presence::Choice)>,
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

/// Everything the menu and tooltip display, in display order.
fn menu_signature(rows: &[(String, SessionRow)], labels: &Labels, summary: &str) -> String {
    let shown: Vec<_> = rows
        .iter()
        .map(|(window, row)| (window, &row.id, row.status, &row.label))
        .collect();
    format!(
        "{:?}",
        (
            summary,
            [
                &labels.recent,
                &labels.empty,
                &labels.working,
                &labels.input,
                &labels.done,
                &labels.active,
                &labels.failed,
                &labels.retrying,
                &labels.notifications,
            ],
            shown,
        )
    )
}

/// Snapshot of everything one menu build needs, taken while holding the state
/// lock so the (main-thread-blocking) native calls can run without it.
struct Plan {
    generation: u64,
    rendered: String,
    summary: String,
    rows: Vec<(String, SessionRow)>,
    labels: Labels,
    presence: crate::assistant_presence::View,
}

type Built = (
    tauri::menu::Menu<tauri::Wry>,
    BTreeMap<String, (String, String)>,
    BTreeMap<String, (String, crate::assistant_presence::Choice)>,
);

impl TrayState {
    /// Decides whether the menu must be rebuilt. `None` when what it shows is
    /// unchanged; otherwise a snapshot tagged with a fresh generation.
    fn plan(&mut self) -> Option<Plan> {
        let rows = merged_rows(&self.windows);
        let count = |status| rows.iter().filter(|(_, row)| row.status == status).count();
        let working = count(SessionStatus::Working) + count(SessionStatus::Retrying);
        let input = count(SessionStatus::Input) + count(SessionStatus::Failed);
        let summary = format!(
            "{} {} · {} {} · {} {} · {} {}",
            working,
            self.labels.working,
            input,
            self.labels.input,
            count(SessionStatus::Done),
            self.labels.done,
            count(SessionStatus::Active),
            self.labels.active
        );
        let rows = visible_rows(rows);
        let rendered = format!(
            "{}{:?}{:?}",
            menu_signature(&rows, &self.labels, &summary),
            (
                &self.presence.source_token,
                &self.presence.status,
                self.presence.pending,
                self.presence.status_error,
                self.presence.write_error,
                self.presence.retry
            ),
            self.labels.presence
        );
        if self.rendered.as_deref() == Some(rendered.as_str()) {
            return None;
        }
        self.generation = self.generation.wrapping_add(1);
        Some(Plan {
            generation: self.generation,
            rendered,
            summary,
            rows,
            labels: self.labels.clone(),
            presence: self.presence.clone(),
        })
    }

    /// Records the installed menu only when no newer plan was made meanwhile.
    fn commit(
        &mut self,
        plan: Plan,
        targets: BTreeMap<String, (String, String)>,
        presence_targets: BTreeMap<String, (String, crate::assistant_presence::Choice)>,
    ) -> bool {
        if self.generation != plan.generation {
            return false;
        }
        self.targets = targets;
        self.presence_targets = presence_targets;
        self.rendered = Some(plan.rendered);
        true
    }
}

fn locked(state: &Mutex<TrayState>) -> std::sync::MutexGuard<'_, TrayState> {
    state.lock().unwrap_or_else(|error| error.into_inner())
}

/// Never holds the state lock across native menu calls: those dispatch to the
/// main thread, which takes the same lock in its event handlers.
fn refresh(app: &AppHandle, shared: &Mutex<TrayState>) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let name = app.package_info().name.clone();
    // A racing refresh may install a menu after ours; retry on the latest state.
    for _ in 0..3 {
        let Some(plan) = locked(shared).plan() else {
            return Ok(());
        };
        let (menu, targets, presence_targets) = build_menu(app, &name, &plan)?;
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(format!("{name} · {}", plan.summary)))?;
        #[cfg(target_os = "macos")]
        tray.set_title(Some(""))?;
        let mut state = locked(shared);
        if state.commit(plan, targets, presence_targets) {
            return Ok(());
        }
        state.rendered = None;
    }
    Ok(())
}

/// Rebuilds the menu with the current native-language labels.
pub(crate) fn refresh_language(app: &AppHandle) -> tauri::Result<()> {
    let Some(state) = app.try_state::<Mutex<TrayState>>() else {
        return Ok(());
    };
    locked(&state).rendered = None;
    refresh(app, &state)
}

fn build_menu(app: &AppHandle, name: &str, plan: &Plan) -> tauri::Result<Built> {
    let mut menu = MenuBuilder::new(app).item(
        &MenuItemBuilder::with_id(SHOW, crate::native_language::menu_text("Show", name))
            .build(app)?,
    );
    let mut targets = BTreeMap::new();
    let mut presence_targets = BTreeMap::new();
    if plan.rows.is_empty() {
        menu = menu.separator().item(
            &MenuItemBuilder::new(&plan.labels.empty)
                .enabled(false)
                .build(app)?,
        );
    }
    // Live work stays one click away. Idle history is tucked into a submenu.
    for (status, heading) in [
        (SessionStatus::Input, &plan.labels.input),
        (SessionStatus::Failed, &plan.labels.failed),
        (SessionStatus::Retrying, &plan.labels.retrying),
        (SessionStatus::Working, &plan.labels.working),
        (SessionStatus::Done, &plan.labels.done),
        (SessionStatus::Active, &plan.labels.recent),
    ] {
        let group: Vec<_> = plan
            .rows
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
                let id = format!("{SESSION_PREFIX}{}_{index}", plan.generation);
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
                let id = format!("{SESSION_PREFIX}{}_{index}", plan.generation);
                menu = menu
                    .item(&MenuItemBuilder::with_id(&id, compact_label(&row.label)).build(app)?);
                targets.insert(id, (window.clone(), row.id.clone()));
            }
        }
    }
    let labels = &plan.labels.presence;
    let effective = if plan.presence.status_error {
        crate::assistant_presence::Presence::Unknown
    } else {
        plan.presence
            .status
            .as_ref()
            .map(|status| status.state.clone())
            .unwrap_or(crate::assistant_presence::Presence::Unknown)
    };
    let caption = match effective {
        crate::assistant_presence::Presence::Present => &labels.here,
        crate::assistant_presence::Presence::Away => &labels.away,
        crate::assistant_presence::Presence::Dnd => &labels.dnd,
        crate::assistant_presence::Presence::Idle => &labels.idle,
        _ => &labels.unknown,
    };
    let mut presence = SubmenuBuilder::new(app, format!("{}: {}", labels.availability, caption));
    let available = plan.presence.source_token.is_some()
        && plan
            .presence
            .status
            .as_ref()
            .is_some_and(|status| status.setup_complete)
        && !plan.presence.pending
        && !plan.presence.status_error
        && !plan.presence.write_error;
    for (index, (choice, label, checked)) in [
        (
            crate::assistant_presence::Choice::Present,
            &labels.here,
            effective == crate::assistant_presence::Presence::Present,
        ),
        (
            crate::assistant_presence::Choice::Away,
            &labels.away,
            effective == crate::assistant_presence::Presence::Away,
        ),
        (
            crate::assistant_presence::Choice::Dnd,
            &labels.dnd,
            effective == crate::assistant_presence::Presence::Dnd,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let id = format!("{PRESENCE_PREFIX}{}_{index}", plan.generation);
        presence = presence.item(
            &CheckMenuItemBuilder::with_id(&id, label)
                .checked(checked)
                .enabled(available)
                .build(app)?,
        );
        if let Some(token) = &plan.presence.source_token {
            presence_targets.insert(id, (token.clone(), choice));
        }
    }
    if plan.presence.pending {
        presence = presence.item(
            &MenuItemBuilder::new(&labels.pending)
                .enabled(false)
                .build(app)?,
        );
    }
    if plan.presence.write_error {
        presence = presence.item(
            &MenuItemBuilder::new(&labels.failed)
                .enabled(false)
                .build(app)?,
        );
        if let (Some(choice), Some(token)) = (plan.presence.retry, &plan.presence.source_token) {
            let id = format!("{PRESENCE_PREFIX}{}_retry", plan.generation);
            presence = presence.item(
                &MenuItemBuilder::with_id(&id, &labels.retry)
                    .enabled(!plan.presence.pending)
                    .build(app)?,
            );
            presence_targets.insert(id, (token.clone(), choice));
        }
    }
    presence = presence.separator().item(
        &MenuItemBuilder::with_id(PRESENCE_REFRESH, &labels.refresh)
            .enabled(!plan.presence.pending && !plan.presence.write_error)
            .build(app)?,
    );
    let menu = menu
        .item(&presence.build()?)
        .separator()
        .item(&MenuItemBuilder::with_id(NOTIFICATIONS, &plan.labels.notifications).build(app)?)
        .item(
            &MenuItemBuilder::with_id(QUIT, crate::native_language::menu_text("Quit", name))
                .build(app)?,
        )
        .build()?;
    Ok((menu, targets, presence_targets))
}

pub(crate) fn presence_update(app: &AppHandle, view: crate::assistant_presence::View) {
    let Some(state) = app.try_state::<Mutex<TrayState>>() else {
        return;
    };
    {
        let mut guard = locked(&state);
        if view.revision < guard.presence.revision {
            return;
        }
        guard.presence = view;
    }
    if let Err(error) = refresh(app, &state) {
        eprintln!("Availability menu refresh failed: {error}");
    }
}

/// Async: runs off the main thread; the menu is only rebuilt when what it shows changed.
#[tauri::command]
pub async fn tray_sessions_update(
    app: AppHandle,
    window: tauri::WebviewWindow,
    rows: Vec<SessionRow>,
    labels: Labels,
) -> Result<(), String> {
    let state = app.state::<Mutex<TrayState>>();
    {
        let mut guard = locked(&state);
        guard.windows.insert(window.label().to_string(), rows);
        guard.labels = labels;
    }
    refresh(&app, &state).map_err(|e| e.to_string())
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let state = app.state::<Mutex<TrayState>>();
    locked(&state).windows.remove(label);
    if let Err(error) = refresh(app, &state) {
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
            PRESENCE_REFRESH => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::assistant_presence::refresh_captured(app).await;
                });
            }
            id if id.starts_with(PRESENCE_PREFIX) => {
                let target = app
                    .state::<Mutex<TrayState>>()
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .presence_targets
                    .get(id)
                    .cloned();
                if let Some((token, choice)) = target {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::assistant_presence::set_captured(app, token, choice).await;
                    });
                }
            }
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
    refresh(app, &app.state::<Mutex<TrayState>>())?;
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
    fn menu_signature_ignores_timestamps_but_not_what_is_shown() {
        let labels = Labels::default();
        let shown = |status, updated_at| {
            menu_signature(
                &[("main".into(), row("a", "a", status, true, updated_at))],
                &labels,
                "1 working",
            )
        };
        assert_eq!(
            shown(SessionStatus::Working, 1),
            shown(SessionStatus::Working, 99)
        );
        assert_ne!(
            shown(SessionStatus::Working, 1),
            shown(SessionStatus::Input, 1)
        );
    }

    #[test]
    fn plan_skips_unchanged_menu_and_commit_requires_latest_generation() {
        let mut state = TrayState::default();
        let first = state.plan().expect("first plan renders");
        assert!(state.plan().is_some(), "uncommitted menu is planned again");
        // The second plan superseded the first, so committing it must be refused.
        assert!(!state.commit(first, BTreeMap::new(), BTreeMap::new()));
        let latest = state.plan().expect("still uncommitted");
        assert!(state.commit(latest, BTreeMap::new(), BTreeMap::new()));
        assert!(state.plan().is_none(), "committed menu is not rebuilt");
        state.rendered = None;
        assert!(state.plan().is_some(), "cleared memo forces a rebuild");
    }

    #[test]
    fn plan_captures_rows_and_presence_before_state_changes() {
        let mut state = TrayState::default();
        state.windows.insert(
            "main".into(),
            vec![row("one", "one", SessionStatus::Working, true, 1)],
        );
        state.presence.source_token = Some("first".into());
        state.presence.status = Some(crate::assistant_presence::Status {
            state: crate::assistant_presence::Presence::Present,
            setup_complete: true,
            assistant_name: None,
        });
        let plan = state.plan().expect("menu plan");
        state.windows.clear();
        state.presence.source_token = Some("second".into());
        state.presence.status = None;
        assert_eq!(plan.rows.len(), 1);
        assert_eq!(plan.rows[0].1.id, "one");
        assert_eq!(plan.presence.source_token.as_deref(), Some("first"));
        assert!(plan
            .presence
            .status
            .as_ref()
            .is_some_and(|status| status.setup_complete));
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
