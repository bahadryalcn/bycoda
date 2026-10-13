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

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::remote::{
    local_host_pair, mark_local_host, prune_stale_local_sync, remote_machines, Machine,
    RemoteConnections,
};

fn host_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var("USERPROFILE").ok()?;
    #[cfg(not(windows))]
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".bycoda-host"))
}

/// The local launcher command (program, leading args), or `None` when
/// nothing is installed at the expected location on this machine.
fn launcher_command(data_dir: &Path) -> Option<(String, Vec<String>)> {
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
    let Some(info) = run_launcher(
        &program,
        &base_args,
        &["connection-info"],
        Duration::from_secs(10),
    ) else {
        return Ok(None);
    };
    let Some(port) = info.get("port").and_then(Value::as_u64) else {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
