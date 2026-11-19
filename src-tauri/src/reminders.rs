use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::native_window_lifecycle::{self, NativeWriteAdmission};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use crate::session_store::{now_millis, validate_id, SessionStore};

pub(crate) const CHANGED: &str = "bycoda:reminders-changed";
const OPEN: &str = "bycoda:reminder-open";
pub(crate) const NOTIFICATION_PREFIX: &str = "reminder:";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    session_id: String,
    due_at: i64,
    fired_at: Option<i64>,
    title: String,
    harness: String,
    cwd: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPreferences {
    notifications_enabled: bool,
    sound: bool,
    #[serde(default)]
    project_rules: HashMap<String, ProjectDeliveryRule>,
    /// Local per-event switches (`finished`, `input`, `failed`); a missing key is on.
    #[serde(default)]
    events: HashMap<String, bool>,
    /// Project-path rules for assistant banners: `pathKey` -> event (`finished`,
    /// `input`) -> rule. A path or event without an entry is unrestricted, as
    /// for a renderer that predates this field.
    #[serde(default)]
    assistant_project_rules: HashMap<String, HashMap<String, ProjectDeliveryRule>>,
}

#[derive(Clone, Deserialize)]
pub struct ProjectDeliveryRule {
    enabled: bool,
    after: i64,
}

impl DeliveryPreferences {
    /// Master switch plus the event switch of an assistant banner (`finished`,
    /// `input` or `failed`). Project rules need session context native lacks.
    pub(crate) fn allows_event(&self, event: &str) -> bool {
        self.notifications_enabled && self.events.get(event).copied().unwrap_or(true)
    }

    /// The owner's project rules for an assistant banner, as the renderer's
    /// `allowsProjectNotification` applies them at `now` to every project path.
    pub(crate) fn allows_assistant_projects(&self, event: &str, paths: &[&str], now: i64) -> bool {
        paths.iter().all(|path| {
            self.assistant_project_rules
                .get(&project_path_key(path))
                .and_then(|rules| rules.get(event))
                .is_none_or(|rule| rule.enabled && now > rule.after)
        })
    }

    fn allows(&self, reminder: &Reminder) -> bool {
        self.notifications_enabled
            && self
                .project_rules
                .get(&reminder.session_id)
                .is_some_and(|rule| rule.enabled && reminder.due_at > rule.after)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenReminder {
    session_id: String,
    due_at: i64,
    #[serde(skip)]
    window_label: Option<String>,
}

/// Sleeps the delivery thread until the next schedule change, preference change
/// or computed due time. A generation counter keeps a signal sent between the
/// thread's snapshot and its wait from being lost.
#[derive(Default)]
struct Wake {
    generation: Mutex<u64>,
    changed: Condvar,
}

impl Wake {
    fn notify(&self) {
        let mut generation = self.generation.lock().unwrap_or_else(PoisonError::into_inner);
        *generation = generation.wrapping_add(1);
        self.changed.notify_all();
    }

    fn current(&self) -> u64 {
        *self.generation.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Returns at once if `seen` is stale; otherwise waits for a notify or the timeout.
    /// `None` waits until notified.
    fn wait(&self, seen: u64, timeout: Option<Duration>) {
        let guard = self.generation.lock().unwrap_or_else(PoisonError::into_inner);
        let _guard = match timeout {
            Some(timeout) => {
                match self
                    .changed
                    .wait_timeout_while(guard, timeout, |generation| *generation == seen)
                {
                    Ok((guard, _)) => guard,
                    Err(error) => error.into_inner().0,
                }
            }
            None => self
                .changed
                .wait_while(guard, |generation| *generation == seen)
                .unwrap_or_else(PoisonError::into_inner),
        };
    }
}

#[derive(Default)]
pub struct ReminderService {
    preferences: Mutex<Option<DeliveryPreferences>>,
    pending_open: Mutex<std::collections::VecDeque<OpenReminder>>,
    window_sessions: Mutex<HashMap<String, Vec<String>>>,
    wake: Wake,
}

impl ReminderService {
    /// Fails closed until the renderer has sent its first preference snapshot. Only tests read
    /// the bare event gate; delivery goes through `allows_assistant_banner`.
    #[cfg(test)]
    pub(crate) fn allows_event(&self, event: &str) -> bool {
        self.preferences
            .lock()
            .ok()
            .and_then(|p| p.as_ref().map(|p| p.allows_event(event)))
            .unwrap_or(false)
    }

    /// Event gate plus the owner's per-project rules for the banner's project paths.
    pub(crate) fn allows_assistant_banner(&self, event: &str, paths: &[&str]) -> bool {
        self.preferences.lock().ok().is_some_and(|p| {
            p.as_ref().is_some_and(|p| {
                p.allows_event(event) && p.allows_assistant_projects(event, paths, now_millis())
            })
        })
    }
}

/// The renderer's `pathKey`, including its case rule for the path after a
/// `remote://<machine>/` prefix.
fn project_path_key(path: &str) -> String {
    let (prefix, rest) = match path
        .strip_prefix("remote://")
        .and_then(|tail| tail.split_once('/'))
    {
        Some((machine, rest)) => (format!("remote://{machine}/"), rest),
        None => (String::new(), path),
    };
    let slashed = rest.replace('\\', "/");
    let trimmed = slashed.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() && prefix.is_empty() {
        "/"
    } else {
        trimmed
    };
    let bytes = trimmed.as_bytes();
    let windows = (bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.len() == 2 || bytes[2] == b'/'))
        || trimmed.starts_with("//");
    format!(
        "{prefix}{}",
        if windows {
            trimmed.to_lowercase()
        } else {
            trimmed.to_owned()
        }
    )
}

pub(crate) fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_reminders (
           session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
           due_at INTEGER NOT NULL CHECK (due_at > 0),
           fired_at INTEGER
         );
         CREATE INDEX IF NOT EXISTS session_reminders_pending
         ON session_reminders (due_at) WHERE fired_at IS NULL;",
    )
}

const REMINDER_ROWS: &str = "SELECT r.session_id, r.due_at, r.fired_at, s.title, s.harness, s.cwd
     FROM session_reminders r JOIN sessions s ON s.id = r.session_id";

fn reminder_from_row(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        session_id: row.get(0)?,
        due_at: row.get(1)?,
        fired_at: row.get(2)?,
        title: row.get(3)?,
        harness: row.get(4)?,
        cwd: row.get(5)?,
    })
}

fn list(conn: &Connection) -> rusqlite::Result<Vec<Reminder>> {
    let mut statement =
        conn.prepare(&format!("{REMINDER_ROWS} ORDER BY r.due_at, r.session_id"))?;
    let rows = statement.query_map([], reminder_from_row)?;
    rows.collect()
}

/// Only pending rows that are due at `now`; the ticker never reads the rest.
fn list_due(conn: &Connection, now: i64) -> rusqlite::Result<Vec<Reminder>> {
    let mut statement = conn.prepare(&format!(
        "{REMINDER_ROWS} WHERE r.fired_at IS NULL AND r.due_at <= ?1
         ORDER BY r.due_at, r.session_id"
    ))?;
    let rows = statement.query_map([now], reminder_from_row)?;
    rows.collect()
}

/// Earliest pending due time among the sessions the preferences make claimable.
/// Read-only, using the `session_id` primary key, one lookup per claimable session.
fn next_due<'a>(
    conn: &Connection,
    claimable: impl Iterator<Item = &'a str>,
) -> rusqlite::Result<Option<i64>> {
    let mut statement = conn.prepare(
        "SELECT MIN(due_at) FROM session_reminders WHERE session_id = ?1 AND fired_at IS NULL",
    )?;
    let mut earliest: Option<i64> = None;
    for session_id in claimable {
        let due_at: Option<i64> = statement.query_row([session_id], |row| row.get(0))?;
        earliest = match (earliest, due_at) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
    }
    Ok(earliest)
}

/// Retry cadence while a due reminder could not be claimed (closed gate or
/// failure). Also the wait after an error.
const RETRY_DELAY: Duration = Duration::from_secs(5);
/// Upper bound for one sleep, so a wall-clock change, which a monotonic timer
/// cannot see, is noticed within a minute.
const MAX_SLEEP: Duration = Duration::from_secs(60);

/// `None` means no claimable pending reminder: sleep until a schedule or
/// preference signal instead of polling.
fn sleep_until(next_due: Option<i64>, now: i64) -> Option<Duration> {
    let due_at = next_due?;
    if due_at <= now {
        return Some(RETRY_DELAY);
    }
    Some(Duration::from_millis((due_at - now) as u64).min(MAX_SLEEP))
}

fn set(conn: &mut Connection, ids: &[String], due_at: i64, now: i64) -> Result<(), String> {
    if due_at <= now || due_at > 8_640_000_000_000_000 {
        return Err("Choose a reminder time in the future.".into());
    }
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    for id in ids {
        validate_id(id, "session")?;
        let valid: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sessions
                 WHERE id = ?1 AND has_user_message = 1 AND inbox_ask IS NULL)",
                [id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !valid {
            return Err("This conversation must be saved before adding a reminder.".into());
        }
        tx.execute(
            "INSERT INTO session_reminders (session_id, due_at) VALUES (?1, ?2)
             ON CONFLICT(session_id) DO UPDATE SET due_at = excluded.due_at, fired_at = NULL",
            params![id, due_at],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

fn clear(
    conn: &mut Connection,
    ids: &[String],
    expected_due_at: Option<i64>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    for id in ids {
        validate_id(id, "session")?;
        tx.execute(
            "DELETE FROM session_reminders WHERE session_id = ?1
             AND (?2 IS NULL OR due_at = ?2)",
            params![id, expected_due_at],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

/// Claim in the database before dispatch, so restarts and multiple windows
/// cannot repeatedly announce the same reminder. Due items remain until handled,
/// including when OS delivery fails or the process exits during dispatch.
fn take_due(
    conn: &mut Connection,
    now: i64,
    is_ready: impl Fn(&Reminder) -> bool,
) -> rusqlite::Result<Vec<Reminder>> {
    let due = list_due(conn, now)?
        .into_iter()
        .filter(|reminder| is_ready(reminder))
        .collect::<Vec<_>>();
    if due.is_empty() {
        return Ok(due);
    }
    let tx = conn.transaction()?;
    for reminder in &due {
        tx.execute(
            "UPDATE session_reminders SET fired_at = ?1
             WHERE session_id = ?2 AND fired_at IS NULL AND due_at <= ?1",
            params![now, reminder.session_id],
        )?;
    }
    tx.commit()?;
    Ok(due)
}

#[tauri::command(async)]
pub fn reminder_list(store: State<'_, SessionStore>) -> Result<Vec<Reminder>, String> {
    store.with_read_conn(|conn| list(conn).map_err(|error| error.to_string()))
}

#[tauri::command(async)]
pub fn reminder_set(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    session_ids: Vec<String>,
    due_at: i64,
) -> Result<(), String> {
    native_window_lifecycle::persistence_write_observed(&window, || {
        let observed = set_with(&store, &session_ids, due_at, now_millis, || {
            app.emit(CHANGED, ()).map_err(|e| e.to_string())
        });
        app.state::<ReminderService>().wake.notify();
        observed
    })
}

#[tauri::command(async)]
pub fn reminder_clear(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    session_ids: Vec<String>,
    expected_due_at: Option<i64>,
) -> Result<(), String> {
    native_window_lifecycle::persistence_write_observed(&window, || {
        let observed = clear_with(&store, &session_ids, expected_due_at, || {
            app.emit(CHANGED, ()).map_err(|e| e.to_string())
        });
        app.state::<ReminderService>().wake.notify();
        observed
    })
}

type ObservedWrite = (Result<(), String>, Result<(), ()>);
fn changed_with(
    store: &SessionStore,
    write: impl FnOnce(&mut Connection) -> Result<(), String>,
    changed: impl FnOnce() -> Result<(), String>,
) -> ObservedWrite {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut connection = store.lock_conn()?;
        write(&mut connection)
    }));
    match result {
        Ok(Ok(())) => {
            // The SQL guard has ended, but the caller's original admission has not.
            let observed = matches!(catch_unwind(AssertUnwindSafe(changed)), Ok(Ok(())));
            (Ok(()), if observed { Ok(()) } else { Err(()) })
        }
        Ok(Err(error)) => (Err(error), Err(())),
        Err(_) => (Err("Reminder write observation failed".into()), Err(())),
    }
}
fn set_with(
    store: &SessionStore,
    ids: &[String],
    due_at: i64,
    now: impl FnOnce() -> i64,
    changed: impl FnOnce() -> Result<(), String>,
) -> ObservedWrite {
    changed_with(
        store,
        |connection| set(connection, ids, due_at, now()),
        changed,
    )
}
fn clear_with(
    store: &SessionStore,
    ids: &[String],
    expected_due_at: Option<i64>,
    changed: impl FnOnce() -> Result<(), String>,
) -> ObservedWrite {
    changed_with(
        store,
        |connection| clear(connection, ids, expected_due_at),
        changed,
    )
}

#[tauri::command]
pub fn reminder_configure(
    service: State<'_, ReminderService>,
    preferences: DeliveryPreferences,
) -> Result<(), String> {
    *service
        .preferences
        .lock()
        .map_err(|error| error.to_string())? = Some(preferences);
    service.wake.notify();
    Ok(())
}

#[tauri::command]
pub fn reminder_register_window(
    window: WebviewWindow,
    service: State<'_, ReminderService>,
    session_ids: Vec<String>,
) -> Result<(), String> {
    service
        .window_sessions
        .lock()
        .map_err(|error| error.to_string())?
        .insert(window.label().to_string(), session_ids);
    Ok(())
}

#[tauri::command]
pub fn reminder_open(app: AppHandle, session_id: String, due_at: i64) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    queue_open(&app, session_id, due_at)
}

#[tauri::command]
pub fn reminder_take_open(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, ReminderService>,
) -> Result<Option<OpenReminder>, String> {
    let mut pending = service
        .pending_open
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(index) = pending.iter().position(|request| {
        request
            .window_label
            .as_deref()
            .is_none_or(|label| label == window.label() || app.get_webview_window(label).is_none())
    }) {
        let request = pending.remove(index);
        if pending.iter().any(|next| {
            next.window_label.as_deref().is_none_or(|label| {
                label == window.label() || app.get_webview_window(label).is_none()
            })
        }) {
            let _ = app.emit_to(window.label(), OPEN, ());
        }
        return Ok(request);
    }
    Ok(None)
}

/// A notification can outlive its window. Keep the request until the chosen
/// window has mounted and attached its listeners, then let only that window act.
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
pub(crate) fn open_from_notification(app: &AppHandle, identifier: &str) {
    let Some((session_id, due_at)) = identifier.rsplit_once(':') else {
        return;
    };
    let Ok(due_at) = due_at.parse::<i64>() else {
        return;
    };
    if validate_id(session_id, "session").is_err() {
        return;
    }
    let _ = queue_open(app, session_id.to_string(), due_at);
}

fn queue_open(app: &AppHandle, session_id: String, due_at: i64) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let mut windows = handle.webview_windows();
        windows.retain(|label, _| crate::window::is_workspace_window(label));
        let service = handle.state::<ReminderService>();
        let mut owners = service.window_sessions.lock().ok();
        if let Some(owners) = owners.as_mut() {
            owners.retain(|label, _| windows.contains_key(label));
        }
        let owns_session = |window: &&WebviewWindow| {
            owners.as_ref().is_some_and(|owners| {
                owners
                    .get(window.label())
                    .is_some_and(|ids| ids.contains(&session_id))
            })
        };
        let target = windows
            .values()
            .filter(owns_session)
            .find(|window| window.is_focused().unwrap_or(false))
            .or_else(|| {
                windows
                    .values()
                    .filter(owns_session)
                    .min_by_key(|window| window.label())
            })
            .or_else(|| {
                windows
                    .values()
                    .find(|window| window.is_focused().unwrap_or(false))
            })
            .or_else(|| windows.get("main"))
            .or_else(|| windows.values().min_by_key(|window| window.label()));
        let request = OpenReminder {
            session_id,
            due_at,
            window_label: target.map(|window| window.label().to_string()),
        };
        drop(owners);
        if let Ok(mut pending) = service.pending_open.lock() {
            pending.push_back(request);
        }
        if let Some(window) = target {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = handle.emit_to(window.label(), OPEN, ());
        } else {
            let _ = crate::window::open_new_window(&handle);
        }
    })
    .map_err(|error| error.to_string())
}

/// One process-owned tick, not a lease for the infinite sleeping timer. A closed
/// gate defers before SQL/dispatch; the next existing timer tick may try again.
fn process_tick_with(
    barrier: Option<&WindowBarrier>,
    store: &SessionStore,
    now: impl FnOnce() -> i64,
    preferences: &DeliveryPreferences,
    latest_preferences: impl FnMut() -> Result<Option<DeliveryPreferences>, String>,
    changed: impl FnOnce() -> Result<(), String>,
    deliver: impl FnMut(Reminder, bool) -> Result<(), String>,
) -> Result<(), String> {
    let admission = match native_window_lifecycle::admit_process_persistence(barrier) {
        Ok(admission) => admission,
        Err(BarrierError::AdmissionClosed) => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    tick_with(
        admission,
        store,
        now,
        preferences,
        latest_preferences,
        changed,
        deliver,
    )
}
fn tick_with(
    admission: NativeWriteAdmission,
    store: &SessionStore,
    now: impl FnOnce() -> i64,
    preferences: &DeliveryPreferences,
    mut latest_preferences: impl FnMut() -> Result<Option<DeliveryPreferences>, String>,
    changed: impl FnOnce() -> Result<(), String>,
    mut deliver: impl FnMut(Reminder, bool) -> Result<(), String>,
) -> Result<(), String> {
    let mut committed = false;
    let mut observation = Ok(());
    let result = catch_unwind(AssertUnwindSafe(|| {
        let due = {
            let mut connection = store.lock_conn()?;
            take_due(&mut connection, now(), |reminder| {
                preferences.project_rules.contains_key(&reminder.session_id)
            })
            .map_err(|error| error.to_string())?
        };
        committed = true;
        if due.is_empty() {
            return Ok(());
        }
        if changed().is_err() {
            observation = Err(());
        }
        for reminder in due {
            // Refresh after any previous blocked delivery. No preference or SQL
            // lock spans an OS notification; all accepted work keeps this guard.
            let preferences = match latest_preferences() {
                Ok(Some(preferences)) => preferences,
                Ok(None) => continue,
                Err(_) => {
                    observation = Err(());
                    continue;
                }
            };
            if !preferences.allows(&reminder) {
                continue;
            }
            let current = store.lock_conn().and_then(|connection| {
                connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM session_reminders WHERE session_id = ?1 AND due_at = ?2 AND fired_at IS NOT NULL)",
                    params![reminder.session_id, reminder.due_at], |row| row.get::<_, bool>(0),
                ).map_err(|error| error.to_string())
            });
            match current {
                Ok(true) => {
                    if deliver(reminder, preferences.sound).is_err() {
                        observation = Err(());
                    }
                }
                Ok(false) => {}
                Err(_) => observation = Err(()),
            }
        }
        Ok(())
    }));
    let result = match result {
        Ok(result) => result,
        Err(_) => {
            observation = Err(());
            // A committed fired claim stays authoritative. Unknown delivery is
            // never reset or replayed, including after a callback unwind.
            if committed {
                Ok(())
            } else {
                Err("Reminder tick observation failed".into())
            }
        }
    };
    admission.finish_observed(result, observation)
}

pub(crate) fn init(app: &AppHandle) {
    app.manage(ReminderService::default());
    let app = app.clone();
    std::thread::spawn(move || loop {
        // Read before the snapshot so a schedule or preference change made after
        // this point makes the wait below return at once.
        let service = app.state::<ReminderService>();
        let seen = service.wake.current();
        let preferences = service
            .preferences
            .lock()
            .ok()
            .and_then(|value| value.clone());
        let Some(preferences) = preferences else {
            service.wake.wait(seen, None);
            continue;
        };
        let store = app.state::<SessionStore>();
        let barrier = app.try_state::<WindowBarrier>();
        let result = process_tick_with(
            barrier.as_ref().map(|state| state.inner()),
            &store,
            now_millis,
            &preferences,
            || {
                app.state::<ReminderService>()
                    .preferences
                    .lock()
                    .map(|value| value.clone())
                    .map_err(|error| error.to_string())
            },
            || app.emit(CHANGED, ()).map_err(|error| error.to_string()),
            |reminder, sound| {
                tauri::async_runtime::block_on(crate::notifications::show_notification(
                    app.clone(),
                    format!(
                        "{NOTIFICATION_PREFIX}{}:{}",
                        reminder.session_id, reminder.due_at
                    ),
                    app.package_info().name.clone(),
                    reminder.title,
                    "Reminder: continue this conversation.".into(),
                    sound,
                ))
                .map(|_| ())
            },
        );
        if let Err(error) = &result {
            log::warn!("Could not check reminders: {error}");
        }
        let next = store.with_read_conn(|conn| {
            next_due(
                conn,
                preferences.project_rules.keys().map(String::as_str),
            )
            .map_err(|error| error.to_string())
        });
        let sleep = match next {
            Ok(next) => sleep_until(next, now_millis()),
            Err(error) => {
                log::warn!("Could not schedule reminders: {error}");
                Some(RETRY_DELAY)
            }
        };
        service.wake.wait(seen, sleep);
    });
}

#[cfg(test)]
#[path = "reminders/admission_tests.rs"]
mod admission_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &Connection, id: &str, cwd: &str) {
        conn.execute(
            "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title,
             created_at, updated_at, has_user_message) VALUES (?1, ?2, 'codex', '',
             'supervised', 'A saved conversation', 1, 1, 1)",
            params![id, cwd],
        )
        .unwrap();
    }

    #[test]
    fn assistant_banner_follows_master_switch_and_event_kind() {
        let parse = |json: &str| -> DeliveryPreferences { serde_json::from_str(json).unwrap() };
        let on = parse(r#"{"notificationsEnabled":true,"sound":false}"#);
        assert!(on.allows_event("finished") && on.allows_event("input"));
        let muted = parse(r#"{"notificationsEnabled":false,"sound":false}"#);
        assert!(!muted.allows_event("finished"));
        let some = parse(
            r#"{"notificationsEnabled":true,"sound":false,"events":{"finished":false,"input":true}}"#,
        );
        assert!(!some.allows_event("finished") && some.allows_event("input"));
        let service = ReminderService::default();
        assert!(!service.allows_event("input"), "unconfigured fails closed");
        *service.preferences.lock().unwrap() = Some(some);
        assert!(service.allows_event("input") && !service.allows_event("finished"));
    }

    #[test]
    fn assistant_banner_follows_project_rules_by_path() {
        let parse = |json: &str| -> DeliveryPreferences { serde_json::from_str(json).unwrap() };
        let legacy = parse(r#"{"notificationsEnabled":true,"sound":false}"#);
        assert!(legacy.allows_assistant_projects("finished", &["C:\\Work\\App"], 10));
        let rules = parse(
            r#"{"notificationsEnabled":true,"sound":false,"assistantProjectRules":{
              "c:/work/app":{"finished":{"enabled":false,"after":0},"input":{"enabled":true,"after":0}},
              "/open":{"finished":{"enabled":true,"after":50}},
              "remote://m/c:/x":{"finished":{"enabled":false,"after":0}}}}"#,
        );
        assert!(!rules.allows_assistant_projects("finished", &["C:\\Work\\App\\"], 100));
        assert!(rules.allows_assistant_projects("input", &["C:\\Work\\App"], 100));
        assert!(!rules.allows_assistant_projects("finished", &["/open"], 50));
        assert!(rules.allows_assistant_projects("finished", &["/open"], 51));
        assert!(!rules.allows_assistant_projects("finished", &["/open", "C:/work/app"], 100));
        assert!(rules.allows_assistant_projects("finished", &["/unlisted"], 100));
        assert!(!rules.allows_assistant_projects("finished", &["remote://m/C:\\X"], 100));
        let service = ReminderService::default();
        assert!(!service.allows_assistant_banner("finished", &["/unlisted"]));
        *service.preferences.lock().unwrap() = Some(rules);
        assert!(service.allows_assistant_banner("finished", &["/unlisted"]));
        assert!(!service.allows_assistant_banner("finished", &["C:/work/app"]));
    }

    #[test]
    fn due_reminders_are_claimed_once_across_projects_and_remain_visible() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "first", "/one");
        seed(&conn, "second", "/two");
        set(&mut conn, &["first".into()], 200, 100).unwrap();
        set(&mut conn, &["second".into()], 400, 100).unwrap();
        assert!(take_due(&mut conn, 199, |_| true).unwrap().is_empty());
        let due = take_due(&mut conn, 200, |_| true).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].session_id, "first");
        assert!(take_due(&mut conn, 300, |_| true).unwrap().is_empty());
        assert_eq!(list(&conn).unwrap().len(), 2);
        assert_eq!(take_due(&mut conn, 500, |_| true).unwrap()[0].cwd, "/two");
    }

    #[test]
    fn project_rules_wait_for_resolution_and_suppress_due_reminders_without_replay() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "muted", "/one");
        seed(&conn, "timed", "/two");
        set(&mut conn, &["muted".into(), "timed".into()], 200, 100).unwrap();
        let mut preferences: DeliveryPreferences =
            serde_json::from_str(r#"{"notificationsEnabled":true,"sound":false}"#).unwrap();
        assert!(take_due(&mut conn, 300, |reminder| {
            preferences.project_rules.contains_key(&reminder.session_id)
        })
        .unwrap()
        .is_empty());
        assert!(list(&conn)
            .unwrap()
            .iter()
            .all(|reminder| reminder.fired_at.is_none()));

        preferences.project_rules.insert(
            "muted".into(),
            ProjectDeliveryRule {
                enabled: false,
                after: 0,
            },
        );
        let due = take_due(&mut conn, 300, |reminder| {
            preferences.project_rules.contains_key(&reminder.session_id)
        })
        .unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].session_id, "muted");
        assert!(!preferences.allows(&due[0]));

        preferences.project_rules.insert(
            "timed".into(),
            ProjectDeliveryRule {
                enabled: true,
                after: 200,
            },
        );
        let due = take_due(&mut conn, 300, |reminder| {
            preferences.project_rules.contains_key(&reminder.session_id)
        })
        .unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].session_id, "timed");
        assert!(!preferences.allows(&due[0]));
        assert!(list(&conn)
            .unwrap()
            .iter()
            .all(|reminder| reminder.fired_at.is_some()));

        preferences.project_rules.get_mut("muted").unwrap().enabled = true;
        assert!(take_due(&mut conn, 400, |_| true).unwrap().is_empty());
        set(&mut conn, &["timed".into()], 500, 400).unwrap();
        let due = take_due(&mut conn, 500, |_| true).unwrap();
        assert_eq!(due.len(), 1);
        assert!(preferences.allows(&due[0]));
    }

    #[test]
    fn reschedule_rearms_and_old_notification_cannot_clear_it() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "session", "/one");
        let ids = ["session".into()];
        set(&mut conn, &ids, 200, 100).unwrap();
        assert_eq!(take_due(&mut conn, 200, |_| true).unwrap().len(), 1);
        set(&mut conn, &ids, 500, 200).unwrap();
        clear(&mut conn, &ids, Some(200)).unwrap();
        let remaining = list(&conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].due_at, 500);
        assert!(remaining[0].fired_at.is_none());
        assert_eq!(take_due(&mut conn, 500, |_| true).unwrap().len(), 1);
        clear(&mut conn, &ids, Some(500)).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn cancellation_and_session_deletion_remove_reminders() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "first", "/one");
        seed(&conn, "second", "/two");
        set(&mut conn, &["first".into(), "second".into()], 200, 100).unwrap();
        clear(&mut conn, &["first".into()], None).unwrap();
        conn.execute("DELETE FROM sessions WHERE id = 'second'", [])
            .unwrap();
        assert!(take_due(&mut conn, 300, |_| true).unwrap().is_empty());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn invalid_batch_and_past_time_do_not_partially_save() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "session", "/one");
        assert!(set(&mut conn, &["session".into(), "missing".into()], 200, 100).is_err());
        assert!(list(&conn).unwrap().is_empty());
        assert!(set(&mut conn, &["session".into()], 100, 100).is_err());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn reopening_catches_missed_reminders_without_reannouncing_fired_ones() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-reminders-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = SessionStore::open(path.join("test.db")).unwrap();
            let mut conn = store.lock_conn().unwrap();
            seed(&conn, "missed", "/one");
            seed(&conn, "fired", "/two");
            set(&mut conn, &["fired".into()], 200, 100).unwrap();
            set(&mut conn, &["missed".into()], 400, 100).unwrap();
            assert_eq!(take_due(&mut conn, 300, |_| true).unwrap().len(), 1);
        }
        {
            let store = SessionStore::open(path.join("test.db")).unwrap();
            let mut conn = store.lock_conn().unwrap();
            let due = take_due(&mut conn, 900, |_| true).unwrap();
            assert_eq!(due.len(), 1);
            assert_eq!(due[0].session_id, "missed");
            assert_eq!(list(&conn).unwrap().len(), 2);
            assert!(take_due(&mut conn, 1000, |_| true).unwrap().is_empty());
        }
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn next_due_is_earliest_pending_claimable_row_and_moves_past_claims() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "early", "/one");
        seed(&conn, "late", "/two");
        seed(&conn, "unclaimable", "/three");
        set(&mut conn, &["late".into()], 400, 100).unwrap();
        set(&mut conn, &["early".into()], 200, 100).unwrap();
        set(&mut conn, &["unclaimable".into()], 100, 100).unwrap();
        let claimable = ["early", "late"];
        assert_eq!(
            next_due(&conn, claimable.iter().copied()).unwrap(),
            Some(200)
        );
        assert_eq!(next_due(&conn, std::iter::empty()).unwrap(), None);
        assert_eq!(
            take_due(&mut conn, 200, |r| claimable.contains(&r.session_id.as_str()))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            next_due(&conn, claimable.iter().copied()).unwrap(),
            Some(400)
        );
        clear(&mut conn, &["late".into()], None).unwrap();
        assert_eq!(next_due(&conn, claimable.iter().copied()).unwrap(), None);
    }

    #[test]
    fn take_due_reads_only_due_rows_and_writes_nothing_when_none_are_due() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        seed(&conn, "future", "/one");
        set(&mut conn, &["future".into()], 500, 100).unwrap();
        let changes_before = conn.total_changes();
        assert!(take_due(&mut conn, 499, |_| true).unwrap().is_empty());
        assert_eq!(conn.total_changes(), changes_before, "no row may be written");
        assert!(list_due(&conn, 499).unwrap().is_empty());
        assert_eq!(list_due(&conn, 500).unwrap().len(), 1);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn sleep_waits_for_next_due_capped_and_retries_stuck_or_failed_ticks() {
        assert_eq!(sleep_until(None, 100), None);
        assert_eq!(sleep_until(Some(100), 100), Some(RETRY_DELAY));
        assert_eq!(sleep_until(Some(50), 100), Some(RETRY_DELAY));
        assert_eq!(
            sleep_until(Some(1_100), 100),
            Some(Duration::from_millis(1_000))
        );
        assert_eq!(sleep_until(Some(100 + 3_600_000), 100), Some(MAX_SLEEP));
    }

    #[test]
    fn schedule_signal_sent_before_wait_is_not_lost() {
        let service = ReminderService::default();
        let seen = service.wake.current();
        service.wake.notify();
        let started = std::time::Instant::now();
        let limit = Duration::from_secs(5);
        service.wake.wait(seen, Some(limit));
        assert!(started.elapsed() < limit, "stale generation must not sleep");
        let current = service.wake.current();
        let started = std::time::Instant::now();
        service.wake.wait(current, Some(Duration::from_millis(50)));
        assert!(started.elapsed() >= Duration::from_millis(50));
    }
}
