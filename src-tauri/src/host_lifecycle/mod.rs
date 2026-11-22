//! Supervision for the installed desktop's local Host. The kernel lease remains
//! authoritative across desktop, SSH, manual and service launches.
mod process;
pub(crate) mod switch;

use crate::bundled_host::{self, OwnerState};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Mode {
    App,
    Service,
}

#[derive(Deserialize)]
struct ModeFile {
    version: u32,
    mode: Mode,
}

pub(crate) fn mode(base: &Path) -> Result<Mode, String> {
    match fs::read(base.join("lifecycle.json")) {
        Ok(bytes) => match serde_json::from_slice::<ModeFile>(&bytes) {
            Ok(ModeFile { version: 1, mode }) => Ok(mode),
            _ => Err(
                "Invalid Host lifecycle.json. Inspect the installation before changing it.".into(),
            ),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match base.join("runtime-path").try_exists() {
                Ok(true) => Ok(Mode::Service),
                Ok(false) => Ok(Mode::App),
                Err(error) => Err(format!("Could not inspect the Host installation: {error}")),
            }
        }
        Err(error) => Err(format!("Could not read the Host lifecycle mode: {error}")),
    }
}

static QUITTING: AtomicBool = AtomicBool::new(false);
static OWNED_PID: AtomicU32 = AtomicU32::new(0);
static SUPERVISOR: Mutex<Supervisor> = Mutex::new(Supervisor {
    child: None,
    port: None,
    failures: 0,
    retry_at: None,
    owner_stopped: false,
});

struct Supervisor {
    child: Option<process::OwnedHost>,
    port: Option<u16>,
    failures: u32,
    retry_at: Option<Instant>,
    owner_stopped: bool,
}

fn supervisor() -> std::sync::MutexGuard<'static, Supervisor> {
    SUPERVISOR.lock().unwrap_or_else(|error| error.into_inner())
}

fn can_spawn(owner: OwnerState, blocked: bool) -> bool {
    !blocked && owner == OwnerState::Stopped
}

fn restart_delay(failures: u32) -> Duration {
    bundled_host::exponential_retry(failures, Duration::from_secs(1), Duration::from_secs(60))
}

fn schedule_retry(state: &mut Supervisor) {
    state.failures = state.failures.saturating_add(1);
    state.retry_at = Some(Instant::now() + restart_delay(state.failures));
}

pub(crate) fn start(app: &AppHandle) {
    if app.config().identifier != bundled_host::RELEASE_IDENTIFIER
        || crate::debug_profile::profile_id().is_some()
    {
        return;
    }
    let Some(base) = crate::local_host::host_data_dir() else {
        return;
    };
    std::thread::spawn(move || {
        while !QUITTING.load(Ordering::Acquire) {
            switch::apply_pending(&base);
            if let Err(error) = ensure_child(&base, false, false) {
                log::warn!("local Host supervisor: {error}");
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

pub(crate) fn ensure_child(base: &Path, explicit: bool, installing: bool) -> Result<(), String> {
    let mut state = supervisor();
    if let Some(child) = state.child.as_mut() {
        let Some(status) = child.exit_status()? else {
            return Ok(());
        };
        let child = state.child.take().expect("owned Host");
        OWNED_PID.store(0, Ordering::Release);
        if status.success()
            && !bundled_host::job_pending(base)
            && !bundled_host::install_running(base)
        {
            state.owner_stopped = true;
        }
        if child.age() >= bundled_host::HOST_BOOT_GRACE {
            state.failures = 0;
        }
        schedule_retry(&mut state);
    }
    if explicit {
        state.owner_stopped = false;
    }
    // Installer/switch callers hold the installation lock across the handover.
    let blocked = quitting()
        || state.owner_stopped
        || bundled_host::job_blocks_app_start(base)
        || (!installing && bundled_host::install_running(base))
        || (!explicit && state.retry_at.is_some_and(|time| Instant::now() < time));
    if blocked
        || mode(base)? != Mode::App
        || !base.join("runtime-path").is_file()
        || !can_spawn(bundled_host::owner_state(base), blocked)
    {
        return Ok(());
    }
    let port = bundled_host::running_port(base)
        .or(state.port)
        .unwrap_or(3776);
    match process::OwnedHost::spawn(base, port) {
        Ok(child) => {
            OWNED_PID.store(child.id(), Ordering::Release);
            state.child = Some(child);
            state.port = Some(port);
            state.retry_at = None;
            Ok(())
        }
        Err(error) => {
            schedule_retry(&mut state);
            Err(error)
        }
    }
}

pub(crate) fn owned_pid() -> Option<u32> {
    let pid = OWNED_PID.load(Ordering::Acquire);
    (pid != 0).then_some(pid)
}

pub(crate) fn stop_owned(base: &Path, if_idle: bool) -> Result<(), String> {
    let mut state = supervisor();
    if let Some(mut child) = state.child.take() {
        if let Err(error) = child.drain(base, if_idle) {
            state.child = Some(child);
            return Err(error);
        }
        OWNED_PID.store(0, Ordering::Release);
    }
    state.retry_at = None;
    state.failures = 0;
    Ok(())
}

pub(crate) fn begin_quit() {
    QUITTING.store(true, Ordering::Release);
}

fn quitting() -> bool {
    QUITTING.load(Ordering::Acquire) || crate::window::quit_in_progress()
}

pub(crate) fn finish_quit() {
    if let Some(base) = crate::local_host::host_data_dir() {
        if let Err(error) = stop_owned(&base, false) {
            log::error!("local Host shutdown: {error}");
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Activity {
    pub sessions: u32,
    pub shells: u32,
    pub automations: u32,
    #[serde(default)]
    pub unknown: bool,
    #[serde(default)]
    pub running_sessions: Vec<RunningSession>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct RunningSession {
    pub id: String,
    pub title: Option<String>,
}

impl Activity {
    pub(crate) fn count(&self) -> u32 {
        self.sessions
            .saturating_add(self.shells)
            .saturating_add(self.automations)
    }
}

pub(crate) fn activity(base: &Path) -> Activity {
    if bundled_host::owner_state(base) == OwnerState::Stopped {
        return Activity::default();
    }
    if let Some(activity) = bundled_host::lifecycle_status(base).and_then(|(_, response)| {
        let mut activity =
            serde_json::from_value::<Activity>(response.get("activity")?.clone()).ok()?;
        activity.running_sessions = response
            .get("runningSessions")
            .and_then(|items| serde_json::from_value(items.clone()).ok())
            .unwrap_or_default();
        Some(activity)
    }) {
        return activity;
    }
    bundled_host::host_activity(base).unwrap_or(Activity {
        unknown: true,
        ..Activity::default()
    })
}

pub(crate) fn quit_activity() -> Activity {
    if owned_pid().is_none() {
        return Activity::default();
    }
    crate::local_host::host_data_dir().map_or_else(Activity::default, |base| {
        let activity = activity(&base);
        // An owned child can still be between spawn and lease acquisition.
        if activity.count() == 0 && bundled_host::owner_state(&base) == OwnerState::Unknown {
            Activity {
                unknown: true,
                ..activity
            }
        } else {
            activity
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_stopped_owners_can_be_spawned_and_only_outside_quit_or_update() {
        assert!(can_spawn(OwnerState::Stopped, false));
        assert!(!can_spawn(OwnerState::Stopped, true));
        assert!(!can_spawn(OwnerState::Live { started_at: None }, false));
        assert!(!can_spawn(OwnerState::Unknown, false));
    }

    #[test]
    fn restart_backoff_is_bounded() {
        assert_eq!(restart_delay(1), Duration::from_secs(1));
        assert_eq!(restart_delay(4), Duration::from_secs(8));
        assert_eq!(restart_delay(u32::MAX), Duration::from_secs(60));
    }
}
