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
    install_running, job_pending, lifecycle_status, owner_state, probe_lifecycle_status,
    running_port, LifecycleProbeError, OwnerState, HOST_BOOT_GRACE,
};

use crate::remote::{
    local_host_pair, local_link, mark_local_host, probe_local_link_token, prune_stale_local_sync,
    remote_machines, replace_local_pairing, Machine, RemoteConnections,
};

pub(crate) fn host_data_dir() -> Option<PathBuf> {
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
        // Node cold start behind antivirus scanning can exceed 10 s once.
        Duration::from_secs(30),
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
pub(crate) fn local_device_name() -> String {
    "This computer (local sync)".to_string()
}

/// One reconnect at a time, so a double click cannot issue two pairings.
static REPAIR_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Owner action: pairs again through this computer's launcher after the Host
/// revoked the saved link's token, and replaces that token on the existing record
/// (same machine id). Never runs on its own — a revocation stays in force until
/// the owner asks for this. Fails for any machine that is not the automatic local
/// link.
pub(crate) fn repair_local_pairing(app: &AppHandle, machine_id: &str) -> Result<Machine, String> {
    let _serial = REPAIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let state: State<'_, RemoteConnections> = app.state();
    local_link(app, &state, machine_id)
        .ok_or_else(|| "This connection is not the local host".to_string())?;
    let (program, base_args) = host_data_dir()
        .and_then(|dir| launcher_command(&dir))
        .ok_or("The local Host is not installed on this computer")?;
    let pair = run_launcher(
        &program,
        &base_args,
        &["pair", "--name", &local_device_name(), "--json"],
        Duration::from_secs(45),
    )
    .ok_or("The local Host did not issue a new pairing")?;
    let token = pair
        .get("token")
        .and_then(Value::as_str)
        .ok_or("The local Host did not issue a new pairing")?;
    replace_local_pairing(app, &state, machine_id, token)
}

/// Once-per-launch token check state: 0 unchecked, 1 check running, 2 done.
static STARTUP_CHECK: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
const CHECK_UNCHECKED: u8 = 0;
const CHECK_RUNNING: u8 = 1;
const CHECK_DONE: u8 = 2;

#[derive(Debug, PartialEq, Eq)]
enum StartupDecision {
    /// Already checked (or being checked) in this launch: touch nothing.
    Skip,
    /// The Host answered: the token is valid; the launch check is finished.
    Done,
    /// The Host revoked the token: re-pair once; the launch check is finished.
    Repair,
    /// Host down, timeout or any other failure: do nothing, check again later.
    LeaveUnset,
}

/// Decides the launch check. `probe` runs only when no check happened yet.
fn startup_decision(
    already_started: bool,
    probe: impl FnOnce() -> Result<(), String>,
) -> StartupDecision {
    if already_started {
        return StartupDecision::Skip;
    }
    match probe() {
        Ok(()) => StartupDecision::Done,
        Err(error) if error.contains("[RPC_AUTHORIZATION]") => StartupDecision::Repair,
        Err(_) => StartupDecision::LeaveUnset,
    }
}

/// First reuse of the saved local link in this launch: if the Host revoked its
/// token, pair again once. Never runs again afterwards, so a mid-session
/// revocation waits for the owner's Reconnect.
fn startup_token_check(app: &AppHandle, machine: Machine) -> Machine {
    use std::sync::atomic::Ordering;
    let claimed = STARTUP_CHECK
        .compare_exchange(
            CHECK_UNCHECKED,
            CHECK_RUNNING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok();
    let state: State<'_, RemoteConnections> = app.state();
    let decision = startup_decision(!claimed, || {
        probe_local_link_token(app, &state, &machine.id)
    });
    match decision {
        StartupDecision::Skip => machine,
        StartupDecision::LeaveUnset => {
            STARTUP_CHECK.store(CHECK_UNCHECKED, Ordering::Release);
            machine
        }
        StartupDecision::Done => {
            STARTUP_CHECK.store(CHECK_DONE, Ordering::Release);
            machine
        }
        StartupDecision::Repair => {
            let repaired = repair_local_pairing(app, &machine.id).unwrap_or(machine);
            STARTUP_CHECK.store(CHECK_DONE, Ordering::Release);
            repaired
        }
    }
}

/// The owner's "Reconnect" for a revoked link to this computer's Host. Refuses
/// every machine other than the automatic loopback link. Runs the launcher and
/// Host RPC, so it uses the blocking pool.
#[tauri::command]
pub async fn local_host_reconnect(app: AppHandle, machine_id: String) -> Result<Machine, String> {
    crate::harness::run_blocking("local_host_reconnect", move || {
        repair_local_pairing(&app, &machine_id)
    })
    .await
}

/// Links this desktop to a host running on this same machine, if there is
/// one, reusing an already-saved connection to it when present. Returns
/// `Ok(None)` whenever there is nothing to link (no host installed, or it
/// is not currently running) — this is the common case on a desktop that
/// is not also acting as someone else's remote machine, so it is not an
/// error.
///
/// The linking work blocks on lifecycle probes, the launcher process and
/// Host RPC, so the command runs it on the blocking pool; `remote_machines` is
/// a short store read and is called directly.
#[tauri::command]
pub async fn local_host_connect(app: AppHandle) -> Result<Option<Machine>, String> {
    crate::harness::run_blocking("local_host_connect", move || {
        local_host_connect_blocking(app)
    })
    .await
}

pub(crate) fn local_host_connect_blocking(app: AppHandle) -> Result<Option<Machine>, String> {
    let Some(data_dir) = host_data_dir() else {
        return Ok(None);
    };
    let Some((program, base_args)) = launcher_command(&data_dir) else {
        return Ok(None);
    };
    if app.config().identifier == crate::bundled_host::RELEASE_IDENTIFIER
        && crate::debug_profile::profile_id().is_none()
        && crate::host_lifecycle::mode(&data_dir)? == crate::host_lifecycle::Mode::App
    {
        crate::host_lifecycle::ensure_child(&data_dir, false, false)?;
        let owned = crate::host_lifecycle::owned_pid().is_some();
        if owned || owner_state(&data_dir).starting() {
            let _ = wait_for_host(
                &data_dir,
                if owned {
                    Duration::from_secs(2)
                } else {
                    Duration::ZERO
                },
            );
        }
    }
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
        let marked = mark_local_host(&app, &state, &machine.id, &url)?;
        return Ok(Some(startup_token_check(&app, marked)));
    }

    let Some(pair) = run_launcher(
        &program,
        &base_args,
        &["pair", "--name", &local_device_name(), "--json"],
        Duration::from_secs(45),
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
    /// absent | running | starting | stopped | updating | unknown
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

/// A busy host can miss one probe; retry once before calling it unconfirmed.
fn probe_with_retry(data_dir: &Path) -> Result<(Value, Value), LifecycleProbeError> {
    match probe_lifecycle_status(data_dir) {
        Err(LifecycleProbeError::Unconfirmed) => {
            std::thread::sleep(Duration::from_millis(500));
            probe_lifecycle_status(data_dir)
        }
        other => other,
    }
}

fn updating(data_dir: &Path) -> bool {
    install_running(data_dir) || job_pending(data_dir)
}

/// Polled by the app-wide notice. An install or update in progress stops the
/// host on purpose, so it is reported as `updating`, not `stopped`.
#[tauri::command]
pub async fn local_host_status() -> LocalHostStatus {
    // The probes read the Host's lifecycle files and make bounded HTTP calls.
    tauri::async_runtime::spawn_blocking(local_host_status_blocking)
        .await
        .unwrap_or(LocalHostStatus { state: "unknown" })
}

fn local_host_status_blocking() -> LocalHostStatus {
    let Some(data_dir) = host_data_dir() else {
        return LocalHostStatus { state: "absent" };
    };
    let installed = launcher_command(&data_dir).is_some();
    if !installed {
        return LocalHostStatus { state: "absent" };
    }
    let probe = probe_with_retry(&data_dir);
    let responding = probe.is_ok();
    let updating = !responding && updating(&data_dir);
    if !responding
        && !updating
        && crate::debug_profile::profile_id().is_none()
        && crate::host_lifecycle::mode(&data_dir).ok() == Some(crate::host_lifecycle::Mode::App)
        && owner_state(&data_dir).starting()
    {
        return LocalHostStatus { state: "starting" };
    }
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
    let started = run_with_timeout(command, Duration::from_secs(30)).is_some();
    log::info!("local host: start service result={started}");
    started
}

/// How long to keep asking before the owner lease decides: a service manager
/// needs this long to launch the Host process after a start request, and a busy
/// Host to answer again.
const SERVICE_LAUNCH_SETTLE: Duration = Duration::from_secs(20);
/// The same margin after `service install`, which waits for the Host itself.
const INSTALL_SETTLE: Duration = Duration::from_secs(10);

static STARTING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Starts this computer's stopped Host in its configured lifecycle mode, then
/// links the desktop to it again.
#[tauri::command]
pub async fn local_host_start(app: AppHandle) -> Result<Option<Machine>, String> {
    crate::harness::run_blocking("local_host_start", move || {
        let _guard = STARTING
            .try_lock()
            .map_err(|_| "This computer's host is already starting.".to_string())?;
        let data_dir = host_data_dir().ok_or("Could not find this computer's host folder.")?;
        if crate::debug_profile::profile_id().is_none()
            && crate::host_lifecycle::mode(&data_dir)? == crate::host_lifecycle::Mode::App
        {
            if updating(&data_dir) {
                return Err("The host on this computer is being updated. Try again when it finishes.".into());
            }
            if !data_dir.join("runtime-path").is_file() {
                return Err("bycoda Host is not installed on this computer.".into());
            }
            crate::host_lifecycle::ensure_child(&data_dir, true, false)?;
            if wait_for_host(&data_dir, SERVICE_LAUNCH_SETTLE) != HostWait::Ready {
                return Err(format!("The local Host has not answered. Check {}.", data_dir.join("host.log").display()));
            }
            return local_host_connect_blocking(app);
        }
        let (program, base_args) =
            launcher_command(&data_dir).ok_or("bycoda Host is not installed on this computer.")?;
        // One bounded probe, no retry: a host that answers needs no restart. A
        // failed probe is either Stopped (service not running) or Unconfirmed
        // (starting or hung Host, corrupt running.json, port reused by another app).
        // Without a live owner both go through the idempotent install/start path,
        // which returns early when a Host really answers.
        let stopped = match probe_lifecycle_status(&data_dir) {
            Ok(_) => None,
            Err(error) => Some(error == LifecycleProbeError::Stopped),
        };
        if let Some(stopped) = stopped {
            if crate::debug_profile::profile_id().is_some() {
                if stopped {
                    return Err(
                        "The development host stopped. Restart pnpm dev:native for this workspace."
                            .into(),
                    );
                }
            } else {
                if updating(&data_dir) {
                    return Err(
                        "The host on this computer is being updated. Try again when it finishes."
                            .into(),
                    );
                }
                // Starting or reinstalling the service is a no-op for a process that
                // already holds the owner lease, so a live owner is only waited for.
                let mut outcome = if stopped {
                    if start_service() {
                        wait_for_host(&data_dir, SERVICE_LAUNCH_SETTLE)
                    } else {
                        HostWait::Silent
                    }
                } else if matches!(owner_state(&data_dir), OwnerState::Live { .. }) {
                    // A busy Host can miss the single probe above.
                    wait_for_host(&data_dir, SERVICE_LAUNCH_SETTLE)
                } else {
                    HostWait::Silent
                };
                if outcome == HostWait::Silent {
                    let port = running_port(&data_dir).unwrap_or(3776).to_string();
                    let installed = run_launcher(
                        &program,
                        &base_args,
                        &["service", "install", "--port", &port],
                        Duration::from_secs(60),
                    )
                    .is_some();
                    log::info!("local host: service install result={installed}");
                    outcome = wait_for_host(&data_dir, INSTALL_SETTLE);
                }
                log::info!("local host: start outcome={outcome:?}");
                match outcome {
                    HostWait::Ready => {}
                    HostWait::Alive => {
                        return Err(format!(
                            "The host on this computer is still starting and has not answered yet. Try again in a moment; if it stays this way, check {}.",
                            data_dir.join("host.log").display()
                        ));
                    }
                    HostWait::Silent => {
                        return Err(format!(
                            "The host on this computer did not start. Check {}.",
                            data_dir.join("host.log").display()
                        ));
                    }
                }
            }
        }
        local_host_connect_blocking(app)
    })
    .await
}

/// How a wait for this computer's host ended.
#[derive(Debug, PartialEq, Eq)]
enum HostWait {
    /// The lifecycle endpoint answered.
    Ready,
    /// A process holds the owner lease but has not answered.
    Alive,
    /// No live owner was found.
    Silent,
}

/// Waits for the lifecycle endpoint. `settle` covers a service manager that has
/// not launched the process yet; past it the wait continues only while a Host
/// inside its boot grace holds the owner lease.
fn wait_for_host(data_dir: &Path, settle: Duration) -> HostWait {
    wait_for_host_with(
        data_dir,
        settle,
        HOST_BOOT_GRACE,
        Duration::from_millis(500),
    )
}

fn wait_for_host_with(
    data_dir: &Path,
    settle: Duration,
    grace: Duration,
    poll: Duration,
) -> HostWait {
    let begun = Instant::now();
    // A Host that restarts renews its boot time, so the whole wait is bounded too.
    let limit = settle + grace;
    loop {
        if lifecycle_status(data_dir).is_some() {
            return HostWait::Ready;
        }
        let owner = owner_state(data_dir);
        let waited = begun.elapsed();
        if waited >= limit || (waited >= settle && !owner.starting()) {
            return if matches!(owner, OwnerState::Live { .. }) {
                HostWait::Alive
            } else {
                HostWait::Silent
            };
        }
        std::thread::sleep(poll);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn startup_check_repairs_only_a_revoked_token_once() {
        let revoked =
            || Err("Host rejected request [RPC_AUTHORIZATION] (environment.describe).".to_string());
        assert_eq!(startup_decision(false, || Ok(())), StartupDecision::Done);
        assert_eq!(startup_decision(false, revoked), StartupDecision::Repair);
        for failure in [
            "RPC_HOST_UNAVAILABLE",
            "RPC_TIMEOUT",
            "[RPC_ROUTE_REJECTED]",
        ] {
            assert_eq!(
                startup_decision(false, || Err(failure.to_string())),
                StartupDecision::LeaveUnset
            );
        }
        // After the first check the probe never runs, even for a revoked token.
        assert_eq!(
            startup_decision(true, || panic!("must not probe")),
            StartupDecision::Skip
        );
    }

    #[test]
    fn reports_a_stopped_host_only_when_installed_idle_and_silent() {
        assert_eq!(local_host_state(false, false, false), "absent");
        assert_eq!(local_host_state(true, true, true), "running");
        assert_eq!(local_host_state(true, false, true), "updating");
        assert_eq!(local_host_state(true, false, false), "stopped");
    }

    #[test]
    fn waits_for_a_booting_host_but_not_for_a_silent_or_overdue_one() {
        let directory =
            std::env::temp_dir().join(format!("bycoda-local-host-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let poll = Duration::from_millis(20);
        let sentinel = |started_at: u128| {
            fs::write(
                directory.join("owner.lock"),
                format!(r#"{{"version":2,"pid":123,"nonce":"n","startedAt":{started_at}}}"#),
            )
            .unwrap();
        };
        let now = || {
            std::time::SystemTime::now()
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        };

        // Nothing holds the lease: only the settle window is waited.
        let begun = Instant::now();
        assert_eq!(
            wait_for_host_with(&directory, Duration::from_millis(60), HOST_BOOT_GRACE, poll),
            HostWait::Silent
        );
        assert!(begun.elapsed() < Duration::from_secs(5));

        // A booting Host holds the lease: the wait outlasts the settle window and
        // ends as alive, not as a failed start.
        let lease = rusqlite::Connection::open(directory.join("owner.db")).unwrap();
        lease.execute_batch("BEGIN EXCLUSIVE").unwrap();
        sentinel(now());
        let begun = Instant::now();
        assert_eq!(
            wait_for_host_with(&directory, Duration::ZERO, Duration::from_millis(300), poll),
            HostWait::Alive
        );
        assert!(begun.elapsed() >= Duration::from_millis(300));

        // A live owner past its boot grace is reported at once.
        sentinel(now() - HOST_BOOT_GRACE.as_millis() - 1_000);
        let begun = Instant::now();
        assert_eq!(
            wait_for_host_with(&directory, Duration::ZERO, HOST_BOOT_GRACE, poll),
            HostWait::Alive
        );
        assert!(begun.elapsed() < Duration::from_secs(5));
        drop(lease);
        let _ = fs::remove_dir_all(&directory);
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
