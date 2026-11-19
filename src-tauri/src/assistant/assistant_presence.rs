//! Finite availability controls share one captured native owner route.
use crate::remote::NativeServiceChannel;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const EVENT: &str = "assistant_presence_state";
const DEADLINE: Duration = Duration::from_secs(4);
const HEARTBEAT: Duration = Duration::from_secs(5);
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Choice {
    Present,
    Away,
    Dnd,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Present,
    Idle,
    Away,
    Dnd,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Status {
    pub state: Presence,
    pub setup_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistant_name: Option<String>,
    /// The owner's own choice; `state` can differ when this computer reads idle or away.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice: Option<Choice>,
}
impl Status {
    /// The choice a menu marks: the owner's own, or the effective state from a Host without it.
    pub fn selected(&self) -> Option<Choice> {
        self.choice.or(match self.state {
            Presence::Present => Some(Choice::Present),
            Presence::Away => Some(Choice::Away),
            Presence::Dnd => Some(Choice::Dnd),
            Presence::Idle => None,
        })
    }
    fn parse(value: &serde_json::Value) -> Result<Self, String> {
        let status: Self =
            serde_json::from_value(value.clone()).map_err(|_| "Availability status is invalid")?;
        if status
            .assistant_name
            .as_ref()
            .is_some_and(|name| name.chars().count() > 80 || name.chars().any(char::is_control))
        {
            return Err("Availability status is invalid".into());
        }
        Ok(status)
    }
}
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub revision: u64,
    pub source_token: Option<String>,
    pub status: Option<Status>,
    pub pending: bool,
    pub status_error: bool,
    pub write_error: bool,
    pub retry: Option<Choice>,
}
#[derive(Default)]
struct Core {
    view: View,
    generation: u64,
}
impl Core {
    fn begin(&mut self, token: &str, choice: Choice) -> Result<u64, String> {
        if self.view.source_token.as_deref() != Some(token)
            || self.view.pending
            || !self
                .view
                .status
                .as_ref()
                .is_some_and(|status| status.setup_complete)
            || (self.view.write_error && self.view.retry != Some(choice))
        {
            return Err("The captured availability source changed or remains pending".into());
        }
        self.generation += 1;
        self.view.revision += 1;
        self.view.pending = true;
        self.view.retry = Some(choice);
        Ok(self.generation)
    }
    fn finish(&mut self, generation: u64, result: Result<Status, String>, write: bool) {
        if generation != self.generation {
            return;
        }
        match result {
            Ok(status) => {
                self.view.status = Some(status);
                self.view.status_error = false;
                if write {
                    self.view.pending = false;
                    self.view.write_error = false;
                    self.view.retry = None;
                }
            }
            Err(_) => {
                self.view.status_error = true;
                if write {
                    self.view.pending = false;
                    self.view.write_error = true;
                }
            }
        }
    }
    /// Bumps the revision only when the view moved, so an unchanged heartbeat is not a new state.
    fn commit(&mut self, before: &View) -> bool {
        let changed = self.view != *before;
        if changed {
            self.view.revision += 1;
        }
        changed
    }
}
#[derive(Default)]
struct Owned {
    core: Core,
    source: Option<Arc<NativeServiceChannel>>,
}
#[derive(Default)]
struct State {
    owned: Mutex<Owned>,
    running: AtomicBool,
    // Shutdown clears `running` under `stop` and notifies `wake`, so the heartbeat exits at once.
    stop: Mutex<()>,
    wake: Condvar,
}

impl State {
    fn stop_heartbeat(&self) {
        {
            let _guard = self.stop.lock().unwrap_or_else(|error| error.into_inner());
            self.running.store(false, Ordering::Release);
        }
        self.wake.notify_all();
    }
}
fn publish(app: &AppHandle) {
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    let Ok(owned) = state.owned.lock() else {
        return;
    };
    let view = owned.core.view.clone();
    drop(owned);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        for window in crate::window::workspace_windows(&handle) {
            let _ = handle.emit_to(window.label(), EVENT, &view);
        }
        crate::tray::presence_update(&handle, view);
    });
}
fn read(source: &Arc<NativeServiceChannel>) -> Result<Status, String> {
    source.project_until(
        "assistant.presence.get",
        json!({}),
        Instant::now() + DEADLINE,
        Status::parse,
    )
}
fn refresh(app: &AppHandle) -> Result<View, String> {
    let state = app
        .try_state::<State>()
        .ok_or("Availability is unavailable")?;
    let (generation, source) = {
        let mut owned = state
            .owned
            .lock()
            .map_err(|_| "Availability is unavailable")?;
        if owned.core.view.pending || owned.core.view.write_error {
            return Ok(owned.core.view.clone());
        }
        owned.core.generation += 1;
        (
            owned.core.generation,
            owned.source.clone().filter(|source| source.is_current()),
        )
    };
    let source = source.map(Ok).unwrap_or_else(|| {
        NativeServiceChannel::connect_until(app, Some(Instant::now() + DEADLINE))
    });
    let result = source.as_ref().map_err(Clone::clone).and_then(read);
    let (view, changed) = {
        let mut owned = state
            .owned
            .lock()
            .map_err(|_| "Availability is unavailable")?;
        let before = owned.core.view.clone();
        if owned.core.generation == generation {
            if let Ok(source) = source {
                if !owned
                    .source
                    .as_ref()
                    .is_some_and(|old| Arc::ptr_eq(old, &source))
                {
                    owned.core.view.source_token = Some(uuid::Uuid::new_v4().to_string());
                    owned.core.view.status = None;
                }
                owned.source = Some(source);
            } else {
                // An unreachable Host is offline; a failed read of a live one keeps the last status.
                owned.core.view.status = None;
            }
            owned.core.finish(generation, result, false);
        }
        let changed = owned.core.commit(&before);
        (owned.core.view.clone(), changed)
    };
    if changed {
        publish(app);
    }
    Ok(view)
}
pub(crate) fn init(app: &AppHandle) -> Result<(), String> {
    app.manage(State::default());
    app.state::<State>().running.store(true, Ordering::Release);
    let app = app.clone();
    std::thread::Builder::new()
        .name("assistant-presence".into())
        .spawn(move || {
            let _ = refresh(&app);
            let mut last_connect = Instant::now();
            while wait_heartbeat(&app) {
                let current = {
                    let state = app.state::<State>();
                    let Ok(owned) = state.owned.lock() else {
                        continue;
                    };
                    if owned.core.view.pending {
                        continue;
                    }
                    (
                        owned.core.generation,
                        owned.source.clone().filter(|source| source.is_current()),
                        owned.core.view.write_error,
                    )
                };
                match current.1 {
                    Some(source) => {
                        let result = read(&source);
                        let mut changed = false;
                        if let Ok(mut owned) = app.state::<State>().owned.lock() {
                            let before = owned.core.view.clone();
                            owned.core.finish(current.0, result, false);
                            changed = owned.core.commit(&before);
                        }
                        if changed {
                            publish(&app);
                        }
                    }
                    // The Host was not up at start or restarted (every local update does):
                    // reconnect so the mark does not stay Offline until a menu opens. The new
                    // source gets a new token, so a menu opened earlier cannot write to it.
                    None if heartbeat_reconnects(current.2, last_connect.elapsed()) => {
                        last_connect = Instant::now();
                        let _ = refresh(&app);
                    }
                    None => {}
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}
const RECONNECT_EVERY: Duration = Duration::from_secs(15);
/// The heartbeat reconnects a missing or replaced source, at most every 15 s, and never over an
/// unconfirmed write: that one waits for the owner's explicit retry.
fn heartbeat_reconnects(write_error: bool, since_last: Duration) -> bool {
    !write_error && since_last >= RECONNECT_EVERY
}
/// Sleeps one full heartbeat; returns false once shutdown has cleared the running flag.
fn wait_heartbeat(app: &AppHandle) -> bool {
    let state = app.state::<State>();
    let guard = state.stop.lock().unwrap_or_else(|error| error.into_inner());
    let _ = state
        .wake
        .wait_timeout_while(guard, HEARTBEAT, |_| {
            state.running.load(Ordering::Acquire)
        });
    state.running.load(Ordering::Acquire)
}
pub(crate) fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<State>() {
        state.stop_heartbeat();
    }
}
fn viewer(window: &WebviewWindow) -> Result<(), String> {
    if crate::window::is_workspace_window(window.label()) {
        Ok(())
    } else {
        Err("Availability controls require a workspace window".into())
    }
}
#[tauri::command]
pub fn assistant_presence_state(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    viewer(&window)?;
    let state = app
        .try_state::<State>()
        .ok_or("Availability is unavailable")?;
    let result = state
        .owned
        .lock()
        .map(|owned| owned.core.view.clone())
        .map_err(|_| "Availability is unavailable".into());
    result
}
#[tauri::command]
pub async fn assistant_presence_refresh(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<View, String> {
    viewer(&window)?;
    refresh_captured(app).await
}
pub(crate) async fn refresh_captured(app: AppHandle) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || refresh(&app))
        .await
        .map_err(|_| "Availability refresh was interrupted".to_string())?
}
#[tauri::command]
pub async fn assistant_presence_set(
    app: AppHandle,
    window: WebviewWindow,
    source_token: String,
    state: Choice,
) -> Result<View, String> {
    viewer(&window)?;
    set_captured(app, source_token, state).await
}
pub(crate) async fn set_captured(
    app: AppHandle,
    token: String,
    choice: Choice,
) -> Result<View, String> {
    let (generation, source) = {
        let state = app
            .try_state::<State>()
            .ok_or("Availability is unavailable")?;
        let mut owned = state
            .owned
            .lock()
            .map_err(|_| "Availability is unavailable")?;
        let source = owned
            .source
            .clone()
            .ok_or("The captured availability source is unavailable")?;
        let generation = owned.core.begin(&token, choice)?;
        (generation, source)
    };
    publish(&app);
    let result = tauri::async_runtime::spawn_blocking(move || {
        source.project_until(
            "assistant.presence.set",
            json!({"state":choice}),
            Instant::now() + DEADLINE,
            Status::parse,
        )
    })
    .await
    .map_err(|_| "Availability change was interrupted".to_string())
    .and_then(|result| result);
    let view = {
        let state = app.state::<State>();
        let mut owned = state
            .owned
            .lock()
            .map_err(|_| "Availability is unavailable")?;
        let before = owned.core.view.clone();
        owned.core.finish(generation, result, true);
        owned.core.commit(&before);
        owned.core.view.clone()
    };
    publish(&app);
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready() -> Core {
        Core {
            view: View {
                source_token: Some("original".into()),
                status: Some(Status {
                    state: Presence::Present,
                    setup_complete: true,
                    assistant_name: Some("Arif".into()),
                    choice: None,
                }),
                ..View::default()
            },
            ..Core::default()
        }
    }
    #[test]
    fn exact_source_and_pending_fence() {
        let mut core = ready();
        assert!(core.begin("replacement", Choice::Away).is_err());
        let generation = core.begin("original", Choice::Away).unwrap();
        assert!(core.begin("original", Choice::Dnd).is_err());
        core.finish(
            generation - 1,
            Ok(Status {
                state: Presence::Dnd,
                setup_complete: true,
                assistant_name: None,
                choice: None,
            }),
            false,
        );
        assert!(core.view.pending);
        assert_eq!(core.view.status.unwrap().state, Presence::Present);
    }
    #[test]
    fn uncertain_write_keeps_exact_choice_and_read_cannot_clear_it() {
        let mut core = ready();
        let generation = core.begin("original", Choice::Away).unwrap();
        core.finish(generation, Err("revoked".into()), true);
        assert!(core.view.write_error);
        core.finish(
            generation,
            Ok(Status {
                state: Presence::Idle,
                setup_complete: true,
                assistant_name: None,
                choice: None,
            }),
            false,
        );
        assert!(core.view.write_error);
        assert_eq!(core.view.retry, Some(Choice::Away));
        assert!(core.begin("original", Choice::Dnd).is_err());
        let retry = core.begin("original", Choice::Away).unwrap();
        core.finish(
            retry,
            Ok(Status {
                state: Presence::Away,
                setup_complete: true,
                assistant_name: None,
                choice: None,
            }),
            true,
        );
        assert!(!core.view.write_error);
        assert!(core.view.retry.is_none());
    }
    #[test]
    fn failed_read_keeps_last_status() {
        let mut core = ready();
        core.finish(core.generation, Err("timeout".into()), false);
        assert!(core.view.status_error);
        assert_eq!(core.view.status.unwrap().state, Presence::Present);
    }
    #[test]
    fn effective_away_ack_is_not_claimed_present() {
        let mut core = ready();
        let generation = core.begin("original", Choice::Present).unwrap();
        core.finish(
            generation,
            Ok(Status {
                state: Presence::Away,
                setup_complete: true,
                assistant_name: None,
                choice: None,
            }),
            true,
        );
        assert_eq!(core.view.status.unwrap().state, Presence::Away);
    }
    #[test]
    fn menus_mark_the_owner_choice_not_the_automatic_state() {
        let status =
            Status::parse(&json!({"state":"away","setupComplete":true,"choice":"present"}))
                .unwrap();
        assert_eq!(status.selected(), Some(Choice::Present));
        let older = Status::parse(&json!({"state":"dnd","setupComplete":true})).unwrap();
        assert_eq!(older.selected(), Some(Choice::Dnd));
        let idle = Status::parse(&json!({"state":"idle","setupComplete":true})).unwrap();
        assert_eq!(idle.selected(), None);
    }
    #[test]
    fn unchanged_heartbeat_is_not_a_new_revision() {
        let mut core = ready();
        let before = core.view.clone();
        let same = core.view.status.clone().unwrap();
        core.finish(core.generation, Ok(same), false);
        assert!(!core.commit(&before));
        assert_eq!(core.view, before);
    }
    #[test]
    fn repeated_offline_read_is_not_republished() {
        let mut core = ready();
        core.finish(core.generation, Err("timeout".into()), false);
        let before = core.view.clone();
        core.finish(core.generation, Err("timeout".into()), false);
        assert!(!core.commit(&before));
        assert_eq!(core.view.revision, before.revision);
    }
    #[test]
    fn changed_heartbeat_bumps_revision_once() {
        let mut core = ready();
        let before = core.view.clone();
        core.finish(
            core.generation,
            Ok(Status {
                state: Presence::Away,
                setup_complete: true,
                assistant_name: Some("Arif".into()),
                choice: None,
            }),
            false,
        );
        assert!(core.commit(&before));
        assert_eq!(core.view.revision, before.revision + 1);
    }
    #[test]
    fn heartbeat_reconnects_lost_source_but_not_over_unconfirmed_write() {
        assert!(heartbeat_reconnects(false, RECONNECT_EVERY));
        assert!(!heartbeat_reconnects(false, Duration::from_secs(5)));
        assert!(!heartbeat_reconnects(true, Duration::from_secs(60)));
    }

    #[test]
    fn shutdown_wakes_a_waiting_heartbeat() {
        let state = State::default();
        state.running.store(true, Ordering::Release);
        std::thread::scope(|scope| {
            let (waiting, ready) = std::sync::mpsc::channel();
            let state = &state;
            let waiter = scope.spawn(move || {
                let guard = state.stop.lock().unwrap();
                waiting.send(()).unwrap();
                let (_guard, result) = state
                    .wake
                    .wait_timeout_while(guard, HEARTBEAT, |_| state.running.load(Ordering::Acquire))
                    .unwrap();
                assert!(!result.timed_out());
                assert!(!state.running.load(Ordering::Acquire));
            });
            ready.recv().unwrap();
            state.stop_heartbeat();
            waiter.join().unwrap();
        });
    }
    #[test]
    fn strict_status_and_finite_choices() {
        assert!(Status::parse(&json!({"state":"idle","setupComplete":true})).is_ok());
        assert!(Status::parse(&json!({"state":"unknown","setupComplete":true})).is_err());
        assert!(
            Status::parse(&json!({"state":"present","setupComplete":true,"secret":"no"})).is_err()
        );
        assert!(serde_json::from_value::<Choice>(json!("idle")).is_err());
        assert!(serde_json::from_value::<Choice>(json!("unknown")).is_err());
        assert!(
            Status::parse(&json!({"state":"away","setupComplete":true,"choice":"idle"})).is_err()
        );
        assert!(Status::parse(
            &json!({"state":"present","setupComplete":true,"assistantName":"a".repeat(81)})
        )
        .is_err());
    }
}
