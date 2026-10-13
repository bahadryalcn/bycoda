//! Keeps the bycoda Host on this computer in step with the desktop by
//! installing it from the package shipped inside the installer. The same
//! verified bootstrap script that sets up SSH hosts runs here, against the
//! bundled archive instead of a download.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::remote_ssh::{bootstrap_script, HostPlatform};

/// Only installed release builds carry the host package.
const RELEASE_IDENTIFIER: &str = "com.bycoda.desktop";
/// A deferred upgrade is retried while the app stays open.
const RETRY_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// Another window's or a crashed run's lock is ignored after this long.
const STALE_LOCK: Duration = Duration::from_secs(10 * 60);
/// A coordinator job that has not changed for this long is not running.
const STALE_JOB: Duration = Duration::from_secs(30 * 60);
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledHostStatus {
    /// installed | upgraded | current | deferred | failed | unavailable
    pub state: String,
    pub message: Option<String>,
    pub bundled: Option<String>,
    pub installed: Option<String>,
}

static STATUS: Mutex<Option<BundledHostStatus>> = Mutex::new(None);

#[derive(Debug, PartialEq, Eq)]
enum Plan {
    Install,
    Upgrade,
    Current,
    Deferred(&'static str),
}

/// What to do with this computer's host. Never downgrades, and never
/// interrupts running work: a failed activity read means wait, not idle.
fn plan(installed: Option<&str>, bundled: &str, busy: Result<bool, ()>, job_pending: bool) -> Plan {
    if job_pending {
        return Plan::Deferred("Another host update is being installed.");
    }
    let Some(installed) = installed else {
        return Plan::Install;
    };
    if !is_newer(bundled, installed) {
        return Plan::Current;
    }
    match busy {
        Ok(false) => Plan::Upgrade,
        Ok(true) => Plan::Deferred("The host update waits until running sessions finish."),
        Err(()) => Plan::Deferred("Could not check whether the host is busy."),
    }
}

fn version_parts(version: &str) -> Option<Vec<u64>> {
    let core = version.trim().split(['-', '+']).next()?;
    core.split('.').map(|part| part.parse().ok()).collect()
}

/// Whether `candidate` is a strictly newer x.y.z release than `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (version_parts(candidate), version_parts(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

fn data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var("USERPROFILE").ok()?;
    #[cfg(not(windows))]
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".bycoda-host"))
}

/// The version of the runtime the installed launcher points at.
fn installed_version(base: &Path) -> Option<String> {
    let runtime = std::fs::read_to_string(base.join("runtime-path")).ok()?;
    let runtime = PathBuf::from(runtime.trim());
    let file = std::fs::read_to_string(runtime.join("version.json")).ok();
    if let Some(version) = file
        .as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|value| value.get("version")?.as_str().map(str::to_string))
    {
        return Some(version);
    }
    // Runtime folders are named `<version>-<target>-<id>`.
    let name = runtime.file_name()?.to_str()?;
    let version = name.split('-').next()?;
    version_parts(version).map(|_| version.to_string())
}

/// Whether the host has running sessions or shells. An unreadable database
/// is an error, never zero.
fn host_busy(base: &Path) -> Result<bool, ()> {
    let database = base.join("host.db");
    if !database.exists() {
        return Ok(false);
    }
    let connection = rusqlite::Connection::open_with_flags(
        &database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ())?;
    let _ = connection.busy_timeout(Duration::from_secs(5));
    connection
        .query_row(
            "select count(*) from sessions where status='running' or shell_running=1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|_| ())
}

/// A local update coordinator job for the host that is still in progress.
fn job_pending(base: &Path) -> bool {
    let job = base.join("update-jobs").join("host.json");
    let Ok(text) = std::fs::read_to_string(&job) else {
        return false;
    };
    let state = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.get("state")?.as_str().map(str::to_string))
        .unwrap_or_default();
    let fresh = std::fs::metadata(&job)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| SystemTime::now().duration_since(time).ok())
        .is_some_and(|age| age < STALE_JOB);
    fresh
        && !matches!(
            state.as_str(),
            "installed" | "failed" | "error" | "cancelled" | ""
        )
}

/// The port of the host that is running now, so an upgrade keeps it.
fn running_port(base: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(base.join("running.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    u16::try_from(value.get("port")?.as_u64()?)
        .ok()
        .filter(|port| *port > 0)
}

fn archive_name() -> Option<&'static str> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Some("bycoda-host-win32-x64.zip")
    } else if cfg!(all(windows, target_arch = "aarch64")) {
        Some("bycoda-host-win32-arm64.zip")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("bycoda-host-darwin-arm64.tar.gz")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("bycoda-host-darwin-x64.tar.gz")
    } else {
        None
    }
}

struct InstallLock(PathBuf);

impl InstallLock {
    fn acquire(base: &Path) -> Option<Self> {
        std::fs::create_dir_all(base).ok()?;
        let path = base.join("app-install.lock");
        for _ in 0..2 {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(_) => return Some(Self(path)),
                Err(_) => {
                    let stale = std::fs::metadata(&path)
                        .and_then(|meta| meta.modified())
                        .ok()
                        .and_then(|time| SystemTime::now().duration_since(time).ok())
                        .is_some_and(|age| age > STALE_LOCK);
                    if !stale {
                        return None;
                    }
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        None
    }
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Runs the bootstrap script against the bundled archive.
fn run_installer(base: &Path, archive: &Path, upgrade: bool) -> Result<(), String> {
    let windows = cfg!(windows);
    let platform = if windows {
        HostPlatform::Windows
    } else {
        HostPlatform::Unix
    };
    let script = base.join(if windows {
        "app-install.ps1"
    } else {
        "app-install.sh"
    });
    // Windows PowerShell 5.1 reads a BOM-less file in the ANSI code page.
    let body = if windows {
        format!("\u{feff}{}", bootstrap_script(platform))
    } else {
        bootstrap_script(platform)
    };
    std::fs::write(&script, body)
        .map_err(|error| format!("Could not prepare the host installer: {error}"))?;
    let mut command = if windows {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        command
    } else {
        Command::new("/bin/sh")
    };
    command
        .arg(&script)
        .env("BYCODA_HOST_ARCHIVE", archive)
        .env("BYCODA_HOST_FORCE_UPGRADE", if upgrade { "1" } else { "0" })
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    if let Some(port) = running_port(base) {
        command.env("BYCODA_HOST_PORT", port.to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let result = run_with_timeout(command, SCRIPT_TIMEOUT);
    let _ = std::fs::remove_file(&script);
    result
}

fn run_with_timeout(mut command: Command, timeout: Duration) -> Result<(), String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the host installer: {error}"))?;
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = std::io::Read::read_to_string(stderr, &mut text);
        }
        text
    });
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let errors = reader.join().unwrap_or_default();
                if status.success() {
                    return Ok(());
                }
                let detail = errors.lines().rev().find(|line| !line.trim().is_empty());
                return Err(detail
                    .unwrap_or("The host installer failed.")
                    .trim()
                    .to_string());
            }
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                return Err("The host installer did not finish in time.".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn record(status: BundledHostStatus) {
    if let Ok(mut slot) = STATUS.lock() {
        *slot = Some(status);
    }
}

/// One attempt; returns true when a later retry could still change the result.
fn ensure_once(app: &AppHandle) -> bool {
    let bundled = app.package_info().version.to_string();
    let Some(name) = archive_name() else {
        return false;
    };
    let archive = match app.path().resource_dir() {
        Ok(dir) => dir.join("host").join(name),
        Err(_) => return false,
    };
    let (Some(base), true) = (data_dir(), archive.exists()) else {
        record(BundledHostStatus {
            state: "unavailable".into(),
            bundled: Some(bundled),
            ..Default::default()
        });
        return false;
    };
    let Some(_lock) = InstallLock::acquire(&base) else {
        return true;
    };
    let installed = installed_version(&base);
    let decision = plan(
        installed.as_deref(),
        &bundled,
        host_busy(&base),
        job_pending(&base),
    );
    let status = |state: &str, message: Option<String>| BundledHostStatus {
        state: state.into(),
        message,
        bundled: Some(bundled.clone()),
        installed: installed.clone(),
    };
    match decision {
        Plan::Current => {
            record(status("current", None));
            false
        }
        Plan::Deferred(reason) => {
            record(status("deferred", Some(reason.into())));
            true
        }
        Plan::Install | Plan::Upgrade => {
            let upgrade = decision == Plan::Upgrade;
            match run_installer(&base, &archive, upgrade) {
                Ok(()) => {
                    record(BundledHostStatus {
                        state: if upgrade { "upgraded" } else { "installed" }.into(),
                        message: None,
                        bundled: Some(bundled.clone()),
                        installed: installed_version(&base),
                    });
                    let _ = crate::local_host::local_host_connect(app.clone());
                    false
                }
                Err(error) => {
                    record(status("failed", Some(error)));
                    true
                }
            }
        }
    }
}

/// Starts keeping this computer's host current in the background.
pub fn start(app: &AppHandle) {
    if app.config().identifier != RELEASE_IDENTIFIER {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        while ensure_once(&app) {
            std::thread::sleep(RETRY_INTERVAL);
        }
    });
}

/// The latest result, for Settings → Connections.
#[tauri::command]
pub fn local_host_bundle_status() -> Option<BundledHostStatus> {
    STATUS.lock().ok().and_then(|slot| slot.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_a_missing_host_and_upgrades_only_an_idle_older_one() {
        assert_eq!(plan(None, "0.5.54", Ok(false), false), Plan::Install);
        assert_eq!(
            plan(Some("0.5.53"), "0.5.54", Ok(false), false),
            Plan::Upgrade
        );
        assert!(matches!(
            plan(Some("0.5.53"), "0.5.54", Ok(true), false),
            Plan::Deferred(_)
        ));
    }

    #[test]
    fn never_downgrades_or_reinstalls_the_same_version() {
        assert_eq!(
            plan(Some("0.5.54"), "0.5.54", Ok(false), false),
            Plan::Current
        );
        assert_eq!(
            plan(Some("0.6.0"), "0.5.54", Ok(false), false),
            Plan::Current
        );
        assert_eq!(
            plan(Some("0.5.100"), "0.5.54", Ok(false), false),
            Plan::Current
        );
    }

    #[test]
    fn waits_when_activity_is_unreadable_or_another_update_runs() {
        assert!(matches!(
            plan(Some("0.5.53"), "0.5.54", Err(()), false),
            Plan::Deferred(_)
        ));
        assert!(matches!(
            plan(None, "0.5.54", Ok(false), true),
            Plan::Deferred(_)
        ));
        // Same version stays current even when the database cannot be read.
        assert_eq!(
            plan(Some("0.5.54"), "0.5.54", Err(()), false),
            Plan::Current
        );
    }

    #[test]
    fn compares_release_versions_numerically() {
        assert!(is_newer("0.5.10", "0.5.9"));
        assert!(!is_newer("0.5.9", "0.5.10"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("garbage", "0.5.1"));
    }

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-bundled-host-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_the_installed_version_from_its_runtime() {
        let base = scratch("version");
        assert_eq!(installed_version(&base), None);
        let runtime = base.join("runtime").join("0.5.53-win32-x64-abc-local");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::write(
            base.join("runtime-path"),
            format!("{}\n", runtime.display()),
        )
        .unwrap();
        assert_eq!(installed_version(&base).as_deref(), Some("0.5.53"));
        std::fs::write(runtime.join("version.json"), r#"{"version":"0.5.54"}"#).unwrap();
        assert_eq!(installed_version(&base).as_deref(), Some("0.5.54"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn treats_an_unreadable_host_database_as_busy_not_idle() {
        let base = scratch("busy");
        assert_eq!(host_busy(&base), Ok(false));
        std::fs::write(base.join("host.db"), b"not a database").unwrap();
        assert_eq!(host_busy(&base), Err(()));
        std::fs::remove_file(base.join("host.db")).unwrap();
        let connection = rusqlite::Connection::open(base.join("host.db")).unwrap();
        connection
            .execute_batch(
                "create table sessions (status text, shell_running integer);
                 insert into sessions values ('idle', 0);",
            )
            .unwrap();
        assert_eq!(host_busy(&base), Ok(false));
        connection
            .execute("insert into sessions values ('running', 0)", [])
            .unwrap();
        assert_eq!(host_busy(&base), Ok(true));
        drop(connection);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn honours_only_a_fresh_unfinished_coordinator_job() {
        let base = scratch("jobs");
        assert!(!job_pending(&base));
        std::fs::create_dir_all(base.join("update-jobs")).unwrap();
        let job = base.join("update-jobs").join("host.json");
        std::fs::write(&job, r#"{"state":"waiting"}"#).unwrap();
        assert!(job_pending(&base));
        std::fs::write(&job, r#"{"state":"installed"}"#).unwrap();
        assert!(!job_pending(&base));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn one_installer_runs_at_a_time() {
        let base = scratch("lock");
        let first = InstallLock::acquire(&base).unwrap();
        assert!(InstallLock::acquire(&base).is_none());
        drop(first);
        assert!(InstallLock::acquire(&base).is_some());
        let _ = std::fs::remove_dir_all(&base);
    }
}
