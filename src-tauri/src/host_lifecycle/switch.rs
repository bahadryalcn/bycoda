use super::{
    activity, mode,
    process::{run_cli, run_command},
    Mode, QUITTING,
};
use crate::bundled_host::{self, InstallLock, OwnerState};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::Command,
    sync::{atomic::Ordering, Mutex},
    time::Duration,
};

const STATUS_TIMEOUT: Duration = Duration::from_secs(45);
const SWITCH_TIMEOUT: Duration = Duration::from_secs(260);

#[derive(Default)]
struct Pending {
    target: Option<Mode>,
    error: Option<String>,
}

static PENDING: Mutex<Pending> = Mutex::new(Pending {
    target: None,
    error: None,
});

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModeStatus {
    mode: Mode,
    registered: bool,
    mismatch: bool,
    persisted: bool,
    #[serde(default = "switch_supported")]
    switch_supported: bool,
    #[serde(default)]
    pending_mode: Option<Mode>,
    #[serde(default)]
    last_error: Option<String>,
}

fn switch_supported() -> bool {
    true
}

fn legacy_registration(base: &Path) -> Result<bool, String> {
    let mut command;
    #[cfg(windows)]
    {
        let _ = base;
        command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                include_str!("../../../host/service/registration.ps1"),
            ])
            .env_remove("PSModulePath");
        match run_command(command, STATUS_TIMEOUT)?.trim() {
            "registered" => Ok(true),
            "absent" => Ok(false),
            _ => Err("Unknown Windows Host service registration.".into()),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let target = format!("gui/{}/com.bycoda.host", unsafe { libc::getuid() });
        command = Command::new("launchctl");
        command.args(["print", &target]);
        match run_command(command, STATUS_TIMEOUT) {
            Ok(_) => Ok(true),
            Err(error)
                if error.contains("Could not find service \"com.bycoda.host\" in domain") =>
            {
                base.parent()
                    .ok_or_else(|| "Missing Host home directory.".to_owned())?
                    .join("Library/LaunchAgents/com.bycoda.host.plist")
                    .try_exists()
                    .map_err(|error| error.to_string())
            }
            Err(error) => Err(error),
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = base;
        command = Command::new("systemctl");
        command.args([
            "--user",
            "show",
            "bycoda-host.service",
            "--property=LoadState",
            "--value",
        ]);
        match run_command(command, STATUS_TIMEOUT)?.trim() {
            "loaded" => Ok(true),
            "not-found" => Ok(false),
            _ => Err("Unknown systemd Host service registration.".into()),
        }
    }
}

fn read_status(base: &Path) -> Result<ModeStatus, String> {
    let mut status: ModeStatus =
        match run_cli(base, &["service", "status", "--json"], STATUS_TIMEOUT) {
            Ok(response) => serde_json::from_str(response.lines().last().unwrap_or(""))
                .map_err(|_| "Could not read Host service registration.".to_owned())?,
            Err(error) if error.contains("Use: service install, or service uninstall") => {
                let mode = mode(base)?;
                let registered = legacy_registration(base)?;
                ModeStatus {
                    mode,
                    registered,
                    mismatch: registered != (mode == Mode::Service),
                    persisted: base.join("lifecycle.json").is_file(),
                    switch_supported: false,
                    pending_mode: None,
                    last_error: None,
                }
            }
            Err(error) => return Err(error),
        };
    let pending = PENDING.lock().unwrap_or_else(|error| error.into_inner());
    status.pending_mode = pending.target;
    status.last_error = pending.error.clone();
    Ok(status)
}

fn eligible(activity: &super::Activity, force: bool) -> bool {
    force || (!activity.unknown && activity.count() == 0)
}

fn failed_service_removal(
    error: String,
    force: bool,
    restore: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    if !force && error.contains("still running work") {
        return Ok(false);
    }
    // The manager's preflight refused the change before touching the Host.
    if error.contains("has not been stopped") || error.contains("has not settled") {
        return Err(error);
    }
    match restore() {
        Ok(()) => Err(error),
        Err(rollback) => Err(format!(
            "{error}\nCould not restore service mode: {rollback}"
        )),
    }
}

fn apply(base: &Path, target: Mode, force: bool) -> Result<bool, String> {
    if QUITTING.load(Ordering::Acquire) {
        return Err("Bycoda is quitting.".into());
    }
    if bundled_host::job_pending(base) {
        return Ok(false);
    }
    if crate::window::quit_in_progress() {
        return Ok(false);
    }
    let Some(_lock) = InstallLock::acquire(base) else {
        return Ok(false);
    };
    let current = mode(base)?;
    if current == target {
        return Ok(true);
    }
    if !eligible(&activity(base), force) {
        return Ok(false);
    }
    let status = read_status(base)?;
    if !status.switch_supported {
        return Err("Update bycoda Host before switching its lifecycle mode.".into());
    }
    if current == Mode::Service
        && !status.registered
        && bundled_host::owner_state(base) != OwnerState::Stopped
    {
        return Err("An unregistered Host still owns the data directory.".into());
    }
    let port = bundled_host::running_port(base)
        .or(super::supervisor().port)
        .unwrap_or(3776);
    let port_arg = port.to_string();
    let install = || {
        run_cli(
            base,
            &[
                "service",
                "install",
                "--require-registration",
                "--port",
                &port_arg,
            ],
            SWITCH_TIMEOUT,
        )
    };
    let uninstall = |if_idle: bool| {
        let mut args = vec!["service", "uninstall"];
        if if_idle {
            args.push("--if-idle");
        }
        run_cli(base, &args, SWITCH_TIMEOUT)
    };
    match target {
        Mode::Service => {
            if let Err(error) = super::stop_owned(base, !force) {
                if !force && error.contains("still running work") {
                    return Ok(false);
                }
                return Err(error);
            }
            if bundled_host::owner_state(base) != OwnerState::Stopped {
                return Err("A Host outside this desktop still owns the data directory.".into());
            }
            if QUITTING.load(Ordering::Acquire) {
                return Err("Bycoda is quitting.".into());
            }
            if let Err(error) = install() {
                // Registration can succeed even if the service never becomes
                // healthy or the CLI cannot commit the mode. Undo it first.
                let rollback = read_status(base).and_then(|status| {
                    if status.registered {
                        uninstall(false).map(|_| ())
                    } else {
                        Ok(())
                    }
                });
                if rollback.is_ok() {
                    super::ensure_child(base, true, true)?;
                }
                return Err(match rollback {
                    Ok(_) => error,
                    Err(rollback) => format!("{error}\nCould not restore app mode: {rollback}"),
                });
            }
        }
        Mode::App => {
            if let Err(error) = uninstall(!force) {
                return failed_service_removal(error, force, || {
                    if bundled_host::lifecycle_status(base).is_none() {
                        install().map(|_| ())
                    } else {
                        Ok(())
                    }
                });
            }
            if QUITTING.load(Ordering::Acquire) {
                return Ok(true);
            }
            super::supervisor().port = Some(port);
            let started = super::ensure_child(base, true, true).and_then(|()| {
                if bundled_host::host_healthy_within(base, bundled_host::HOST_BOOT_GRACE) {
                    Ok(())
                } else {
                    Err("The app-owned Host did not become ready.".into())
                }
            });
            if let Err(error) = started {
                super::stop_owned(base, false)?;
                return Err(match install() {
                    Ok(_) => error,
                    Err(rollback) => format!("{error}\nCould not restore service mode: {rollback}"),
                });
            }
        }
    }
    Ok(true)
}

// Serialize settings requests and the background idle retry. Keep the status
// snapshot readable while a service manager is draining or starting.
static APPLYING: Mutex<()> = Mutex::new(());

pub(super) fn apply_pending(base: &Path) {
    let Ok(_guard) = APPLYING.try_lock() else {
        return;
    };
    let Some(target) = PENDING
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .target
    else {
        return;
    };
    let result = apply(base, target, false);
    remember(target, &result);
}

fn remember(target: Mode, result: &Result<bool, String>) {
    let mut pending = PENDING.lock().unwrap_or_else(|error| error.into_inner());
    pending.target = matches!(result, Ok(false)).then_some(target);
    pending.error = result.as_ref().err().cloned();
}

fn installed_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if app.config().identifier != bundled_host::RELEASE_IDENTIFIER
        || crate::debug_profile::profile_id().is_some()
    {
        return Err("Host lifecycle modes require the installed desktop.".into());
    }
    crate::local_host::host_data_dir().ok_or_else(|| "Could not find the local Host folder.".into())
}

#[tauri::command]
pub(crate) async fn local_host_mode(app: tauri::AppHandle) -> Result<ModeStatus, String> {
    let base = installed_base(&app)?;
    crate::harness::run_blocking("local_host_mode", move || read_status(&base)).await
}

#[tauri::command]
pub(crate) async fn local_host_set_mode(
    app: tauri::AppHandle,
    mode: Mode,
    force: bool,
) -> Result<ModeStatus, String> {
    let base = installed_base(&app)?;
    crate::harness::run_blocking("local_host_set_mode", move || {
        let _guard = APPLYING
            .try_lock()
            .map_err(|_| "A Host mode switch is already in progress.")?;
        let result = apply(&base, mode, force);
        remember(mode, &result);
        result?;
        read_status(&base)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_or_unknown_activity_defers_unless_confirmed() {
        for activity in [
            super::super::Activity {
                sessions: 2,
                ..Default::default()
            },
            super::super::Activity {
                unknown: true,
                ..Default::default()
            },
        ] {
            assert!(!eligible(&activity, false));
            assert!(eligible(&activity, true));
        }
        assert!(eligible(&Default::default(), false));
    }

    #[test]
    fn a_service_manager_refusal_leaves_service_mode_in_place() {
        let error = "This Windows account cannot remove the scheduled task. The running host has not been stopped.";
        assert_eq!(
            failed_service_removal(error.into(), true, || panic!(
                "preflight changed no service"
            )),
            Err(error.into())
        );
        assert_eq!(
            failed_service_removal("The Host is still running work.".into(), false, || {
                panic!("busy Host was left running")
            }),
            Ok(false)
        );
    }

    #[test]
    fn failure_after_removal_restores_the_old_service_and_reports_the_failure() {
        let restored = std::cell::Cell::new(false);
        let result = failed_service_removal("could not save lifecycle mode".into(), false, || {
            restored.set(true);
            Ok(())
        });
        assert!(restored.get());
        assert_eq!(result, Err("could not save lifecycle mode".into()));
    }
}
