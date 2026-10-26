//! Links this desktop to a Bycoda Host already running on this same
//! machine (installed earlier by an SSH pairing from elsewhere, or set up
//! manually per `docs/guides/remote-access.md`), over loopback, with no SSH and no
//! user action — so a machine that is both a paired host and its own
//! desktop has a sync peer for its own library. Uses the same host CLI
//! commands the SSH bootstrap already drives remotely
//! (`remote_ssh.rs::pairing_script`), just as a local child process.
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::bundled_host::{
    install_running, job_pending, lifecycle_status, probe_lifecycle_status, running_port,
    LifecycleProbeError,
};

use crate::remote::{
    local_host_pair, mark_local_host, prune_stale_local_sync, remote_machines, Machine,
    RemoteConnections,
};

fn host_data_dir() -> Option<PathBuf> {
    if crate::debug_profile::profile_id().is_some() {
        // Missing debug isolation is unknown, never a fallback to the owner's Host.
        return crate::debug_profile::host_data_dir();
    }
    #[cfg(windows)]
    let home = std::env::var("USERPROFILE").ok()?;
    #[cfg(not(windows))]
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".bycoda-host"))
}

/// The local launcher command (program, leading args), or `None` when
/// nothing is installed at the expected location on this machine.
fn launcher_command(data_dir: &Path) -> Option<(String, Vec<String>)> {
    if crate::debug_profile::profile_id().is_some() {
        let node = std::env::var("BYCODA_DEV_NODE_EXECUTABLE").ok()?;
        let entry = std::env::var("BYCODA_DEV_HOST_ENTRY").ok()?;
        return Some((node, vec![entry]));
    }
    #[cfg(windows)]
    let launcher = data_dir.join("bin").join("bycoda-host.cmd");
    #[cfg(not(windows))]
    let launcher = data_dir.join("bin").join("bycoda-host");
    if !launcher.exists() {
        return None;
    }
    Some((launcher.to_string_lossy().into_owned(), Vec::new()))
}

/// The host CLI prints progress lines before its JSON result; only the
/// last line is the result (same convention `remote_ssh.rs` relies on for
/// the SSH-driven bootstrap/pairing scripts).
fn parse_launcher_output(stdout: &str) -> Option<Value> {
    let last = stdout.lines().last()?;
    serde_json::from_str(last).ok()
}

/// Runs `command` with piped stdout and returns that stdout, or `None` if it
/// fails to spawn, exits unsuccessfully, or does not finish within `timeout`
/// (in which case it is killed).
fn run_with_timeout(mut command: Command, timeout: Duration) -> Option<String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // Drain stdout on a thread so a full pipe can never block the child.
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                // Do not join the reader: a grandchild (e.g. node behind a
                // .cmd shim) may still hold the pipe open.
                return None;
            }
        }
    };
    let buffer = reader.join().ok()?;
    if !status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

fn run_launcher(
    program: &str,
    base_args: &[String],
    args: &[&str],
    timeout: Duration,
) -> Option<Value> {
    let mut command = Command::new(program);
    command.args(base_args).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    parse_launcher_output(&run_with_timeout(command, timeout)?)
}

/// Identity of the host's `running.json`: a restart or port change rewrites it.
type RunningStamp = Option<(std::time::SystemTime, u64)>;

fn running_stamp(data_dir: &Path) -> RunningStamp {
    let metadata = std::fs::metadata(data_dir.join("running.json")).ok()?;
    Some((metadata.modified().ok()?, metadata.len()))
}

/// The last `connection-info` answer for one `running.json`.
struct ConnectionInfoCache {
    stamp: RunningStamp,
    port: Option<u64>,
    /// After a failed lookup, no new launcher run before this instant.
    retry_at: Option<Instant>,
    backoff: Duration,
}

static CONNECTION_INFO: std::sync::Mutex<Option<ConnectionInfoCache>> = std::sync::Mutex::new(None);
const CONNECTION_RETRY_MIN: Duration = Duration::from_secs(15);
const CONNECTION_RETRY_MAX: Duration = Duration::from_secs(300);

/// The running host's port. The app asks on every focus and every 30 s, and
/// `connection-info` starts a Node process each time; a verified answer is
/// kept for as long as `running.json` is unchanged and the host still answers
/// its lifecycle probe (a direct loopback request). Failures back off.
fn connection_port(data_dir: &Path, program: &str, base_args: &[String]) -> Option<u64> {
    let stamp = running_stamp(data_dir);
    {
        let cache = CONNECTION_INFO.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cached) = cache.as_ref().filter(|cached| cached.stamp == stamp) {
            if let Some(port) = cached.port {
                match probe_lifecycle_status(data_dir) {
                    Ok(_) => return Some(port),
                    Err(LifecycleProbeError::Stopped) => return None,
                    // Busy or mid-restart: ask the launcher below.
                    Err(LifecycleProbeError::Unconfirmed) => {}
                }
            } else if cached.retry_at.is_some_and(|at| Instant::now() < at) {
                return None;
            }
        }
    }
    let port = run_launcher(
        program,
        base_args,
        &["connection-info"],
        Duration::from_secs(10),
    )
    .and_then(|info| info.get("port").and_then(Value::as_u64));
    let mut cache = CONNECTION_INFO.lock().unwrap_or_else(|e| e.into_inner());
    let backoff = match cache.as_ref() {
        Some(previous) if previous.stamp == stamp && previous.port.is_none() => {
            (previous.backoff * 2).min(CONNECTION_RETRY_MAX)
        }
        _ => CONNECTION_RETRY_MIN,
    };
    *cache = Some(ConnectionInfoCache {
        stamp,
        port,
        retry_at: port.is_none().then(|| Instant::now() + backoff),
        backoff,
    });
    port
}

/// How this desktop appears in its own host's device list, distinct from
/// an SSH-paired desktop's name (`remote_ssh::device_name`).
fn local_device_name() -> String {
    "This computer (local sync)".to_string()
}

/// Links this desktop to a host running on this same machine, if there is
/// one, reusing an already-saved connection to it when present. Returns
/// `Ok(None)` whenever there is nothing to link (no host installed, or it
/// is not currently running) — this is the common case on a desktop that
/// is not also acting as someone else's remote machine, so it is not an
/// error.
///
/// `remote_machines`/`remote_connect` are themselves plain, non-`async`
/// functions under `#[tauri::command(async)]` (Tauri runs them on a
/// blocking thread; the attribute does not require an `async fn` body) —
/// so this command follows the same shape and calls them directly, with
/// no `.await`.
#[tauri::command(async)]
pub fn local_host_connect(app: AppHandle) -> Result<Option<Machine>, String> {
    let Some(data_dir) = host_data_dir() else {
        return Ok(None);
    };
    let Some((program, base_args)) = launcher_command(&data_dir) else {
        return Ok(None);
    };
    let Some(port) = connection_port(&data_dir, &program, &base_args) else {
        return Ok(None);
    };
    let url = format!("http://127.0.0.1:{port}");

    let state: State<'_, RemoteConnections> = app.state();
    prune_stale_local_sync(&app, &state, &local_device_name(), &url)?;
    let existing = remote_machines(app.clone(), state)?;
    if let Some(machine) = existing
        .into_iter()
        .find(|machine| machine.endpoint == url && machine.ssh.is_none())
    {
        let state: State<'_, RemoteConnections> = app.state();
        return mark_local_host(&app, &state, &machine.id, &url).map(Some);
    }

    let Some(pair) = run_launcher(
        &program,
        &base_args,
        &["pair", "--name", &local_device_name(), "--json"],
        Duration::from_secs(20),
    ) else {
        return Ok(None);
    };
    let Some(token) = pair.get("token").and_then(Value::as_str) else {
        return Ok(None);
    };
    let state: State<'_, RemoteConnections> = app.state();
    let machine = local_host_pair(
        app.clone(),
        state,
        local_device_name(),
        url,
        token.to_string(),
    )?;
    Ok(Some(machine))
}

/// Whether this computer has a host, and whether it is answering.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalHostStatus {
    /// absent | running | stopped | updating | unknown
    pub state: &'static str,
}

fn local_host_state(installed: bool, responding: bool, updating: bool) -> &'static str {
    match (installed, responding, updating) {
        (false, _, _) => "absent",
        (true, true, _) => "running",
        (true, false, true) => "updating",
        (true, false, false) => "stopped",
    }
}

fn updating(data_dir: &Path) -> bool {
    install_running(data_dir) || job_pending(data_dir)
}

/// Polled by the app-wide notice. An install or update in progress stops the
/// host on purpose, so it is reported as `updating`, not `stopped`.
#[tauri::command(async)]
pub fn local_host_status() -> LocalHostStatus {
    let Some(data_dir) = host_data_dir() else {
        return LocalHostStatus { state: "absent" };
    };
    let installed = launcher_command(&data_dir).is_some();
    if !installed {
        return LocalHostStatus { state: "absent" };
    }
    let probe = probe_lifecycle_status(&data_dir);
    let responding = probe.is_ok();
    let updating = !responding && updating(&data_dir);
    if matches!(probe, Err(LifecycleProbeError::Unconfirmed)) && !updating {
        return LocalHostStatus { state: "unknown" };
    }
    LocalHostStatus {
        state: local_host_state(installed, responding, updating),
    }
}

/// Asks this computer's service manager to start its existing host service,
/// without rewriting its definition. Starting is a no-op for a running service
/// (the Windows task ignores a second instance), so it never interrupts work.
fn start_service() -> bool {
    let mut command;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$ErrorActionPreference = 'Stop'; $name = 'Bycoda Host-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; Get-ScheduledTask -TaskName $name | Out-Null; Start-ScheduledTask -TaskName $name",
            ])
            // A parent running PowerShell 7 may pass incompatible module paths.
            .env_remove("PSModulePath")
            .creation_flags(0x08000000);
    }
    #[cfg(target_os = "macos")]
    {
        let target = format!("gui/{}/com.bycoda.host", unsafe { libc::getuid() });
        command = Command::new("launchctl");
        command.args(["kickstart", target.as_str()]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        command = Command::new("systemctl");
        command.args(["--user", "start", "bycoda-host.service"]);
    }
    run_with_timeout(command, Duration::from_secs(30)).is_some()
}

static STARTING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Starts this computer's stopped host from the app, then links the desktop to
/// it again. Falls back to the host's own `service install`, which starts an
/// existing service and only (re)creates a missing one; it also returns early
/// when a host already answers.
#[tauri::command(async)]
pub fn local_host_start(app: AppHandle) -> Result<Option<Machine>, String> {
    let _guard = STARTING
        .try_lock()
        .map_err(|_| "This computer's host is already starting.".to_string())?;
    let data_dir = host_data_dir().ok_or("Could not find this computer's host folder.")?;
    let (program, base_args) =
        launcher_command(&data_dir).ok_or("bycoda Host is not installed on this computer.")?;
    if lifecycle_status(&data_dir).is_none() {
        if crate::debug_profile::profile_id().is_some() {
            return Err(
                "The development host stopped. Restart pnpm dev:native for this workspace.".into(),
            );
        }
        if updating(&data_dir) {
            return Err(
                "The host on this computer is being updated. Try again when it finishes.".into(),
            );
        }
        let started = start_service() && wait_until_responding(&data_dir, Duration::from_secs(20));
        if !started {
            let port = running_port(&data_dir).unwrap_or(3776).to_string();
            run_launcher(
                &program,
                &base_args,
                &["service", "install", "--port", &port],
                Duration::from_secs(60),
            );
            if !wait_until_responding(&data_dir, Duration::from_secs(10)) {
                return Err(format!(
                    "The host on this computer did not start. Check {}.",
                    data_dir.join("host.log").display()
                ));
            }
        }
    }
    local_host_connect(app)
}

fn wait_until_responding(data_dir: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if lifecycle_status(data_dir).is_some() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reports_a_stopped_host_only_when_installed_idle_and_silent() {
        assert_eq!(local_host_state(false, false, false), "absent");
        assert_eq!(local_host_state(true, true, true), "running");
        assert_eq!(local_host_state(true, false, true), "updating");
        assert_eq!(local_host_state(true, false, false), "stopped");
    }

    #[test]
    fn launcher_command_is_none_when_nothing_is_installed() {
        let directory =
            std::env::temp_dir().join(format!("bycoda-local-host-{}", uuid::Uuid::new_v4()));
        assert!(launcher_command(&directory).is_none());
        let _ = fs::remove_dir_all(&directory);
    }

    #[cfg(not(windows))]
    #[test]
    fn launcher_command_finds_the_unix_binary() {
        let directory =
            std::env::temp_dir().join(format!("bycoda-local-host-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(directory.join("bin")).unwrap();
        fs::write(directory.join("bin").join("bycoda-host"), b"").unwrap();
        let (program, args) = launcher_command(&directory).expect("launcher found");
        assert!(program.ends_with("bycoda-host"));
        assert!(args.is_empty());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn run_launcher_parses_the_last_json_line_of_stdout() {
        let value = parse_launcher_output("some log line\n{\"port\":3774}\n");
        assert_eq!(
            value.unwrap().get("port").and_then(|v| v.as_u64()),
            Some(3774)
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn run_with_timeout_kills_a_hung_child() {
        let mut command = Command::new("sleep");
        command.arg("5");
        let started = Instant::now();
        assert!(run_with_timeout(command, Duration::from_millis(100)).is_none());
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn run_launcher_rejects_output_with_no_json_line() {
        assert!(parse_launcher_output("no json here").is_none());
    }
}
