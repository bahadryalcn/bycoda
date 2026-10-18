//! Bounded SFTP CLI operations using the canonical SSH endpoint and trust policy.
//! No shell commands, private-key reads, remote configuration or overwrite bypass.
use crate::ssh_security::{connection_args, SshEndpoint};
use serde::Serialize;
use tauri::Manager;
#[path = "ssh_sftp_transfer.rs"]
mod transfer;
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

struct OperationOwner {
    owner: String,
    alive: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}
type Operations = Mutex<HashMap<String, OperationOwner>>;
static OPERATIONS: OnceLock<Operations> = OnceLock::new();
static PROCESS_IDS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
const MAX_OUTPUT: u64 = 4 * 1024 * 1024;

fn operations() -> &'static Operations {
    OPERATIONS.get_or_init(Default::default)
}

struct ProcessIdGuard(String);
impl Drop for ProcessIdGuard {
    fn drop(&mut self) {
        if let Some(processes) = PROCESS_IDS.get() {
            if let Ok(mut entries) = processes.lock() {
                entries.remove(&self.0);
            }
        }
    }
}

struct Operation {
    id: String,
    cancelled: Arc<AtomicBool>,
    owner: String,
    alive: Arc<AtomicBool>,
    endpoint: Option<SshEndpoint>,
    http_proxy_grant: Option<crate::ssh_http_proxy_credentials::HttpProxyGrant>,
    window_lease: Option<crate::ssh_window_lifecycle::Lease>,
}
impl Operation {
    #[cfg(test)]
    fn begin(id: String) -> Result<Self, String> {
        Self::begin_owned(
            id,
            "internal-test".into(),
            Arc::new(AtomicBool::new(true)),
            None,
        )
    }
    #[cfg(test)]
    fn begin_for_window(id: String, owner: &str, endpoint: &SshEndpoint) -> Result<Self, String> {
        Self::begin_for_window_with_lease(
            id,
            owner,
            endpoint,
            crate::ssh_window_lifecycle::capture(owner)?,
        )
    }
    fn begin_for_window_with_lease(
        id: String,
        owner: &str,
        endpoint: &SshEndpoint,
        lease: crate::ssh_window_lifecycle::Lease,
    ) -> Result<Self, String> {
        lease.check()?;
        if lease.owner() != owner {
            return Err("SFTP window owner changed".into());
        }
        let mut operation = Self::begin_owned(
            id,
            owner.into(),
            Arc::new(AtomicBool::new(true)),
            Some(endpoint.clone()),
        )?;
        operation.window_lease = Some(lease);
        operation.check()?;
        Ok(operation)
    }
    fn begin_owned(
        id: String,
        owner: String,
        alive: Arc<AtomicBool>,
        endpoint: Option<SshEndpoint>,
    ) -> Result<Self, String> {
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return Err("SFTP is shutting down".into());
        }
        if !alive.load(Ordering::SeqCst) {
            return Err("SFTP owner window is closed".into());
        }
        if id.is_empty()
            || id.len() > 128
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("Invalid SFTP operation identifier".into());
        }
        let mut entries = operations()
            .lock()
            .map_err(|_| "SFTP operation registry unavailable")?;
        if entries.contains_key(&id) {
            return Err("SFTP operation already running".into());
        }
        if entries.len() >= 8 {
            return Err("Too many SFTP operations; wait for a transfer to finish".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        entries.insert(
            id.clone(),
            OperationOwner {
                owner: owner.clone(),
                alive: alive.clone(),
                cancelled: cancelled.clone(),
            },
        );
        Ok(Self {
            id,
            cancelled,
            owner,
            alive,
            endpoint,
            http_proxy_grant: None,
            window_lease: None,
        })
    }
    fn authorize_http_proxy(
        &mut self,
        app: &tauri::AppHandle,
        owner: &str,
        connection_id: &str,
        endpoint: &SshEndpoint,
        operation: &crate::ssh_http_proxy_credentials::ProxyOperation,
        ticket: Option<&str>,
    ) -> Result<(), String> {
        self.check()?;
        self.http_proxy_grant = ticket
            .map(|ticket| {
                app.state::<crate::ssh_http_proxy_credentials::HttpProxyCredentials>()
                    .consume(owner, ticket, Some(connection_id), endpoint, operation)
            })
            .transpose()?;
        Ok(())
    }
    fn check(&self) -> Result<(), String> {
        if let Some(lease) = &self.window_lease {
            lease.check()?;
        }
        if self.cancelled.load(Ordering::Relaxed) || !self.alive.load(Ordering::SeqCst) {
            Err("SFTP operation cancelled".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut entries) = operations().lock() {
            entries.remove(&self.id);
        }
    }
}

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

/// SFTP batch parser is not a shell, but wildcard expansion and control/newline
/// injection must still be prevented. Literal spaces, quotes and Unicode work.
fn quote_path(path: &str) -> Result<String, String> {
    if path.is_empty()
        || path.len() > 16384
        || path.chars().any(|c| c.is_control() || "*?[]{}".contains(c))
    {
        return Err("SFTP paths must be literal and contain no controls or wildcards".into());
    }
    let path = if path.starts_with('-') {
        format!("./{path}")
    } else {
        path.into()
    };
    Ok(format!(
        "\"{}\"",
        path.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

pub(crate) fn sftp_args(endpoint: &SshEndpoint) -> Result<Vec<String>, String> {
    let shared = connection_args(endpoint)?;
    let mut args = vec!["-q".into(), "-b".into(), "-".into()];
    let mut i = 0;
    while i < shared.len() {
        match shared[i].as_str() {
            "-p" => {
                args.extend(["-P".into(), shared[i + 1].clone()]);
                i += 2;
            }
            "-l" => {
                args.extend(["-o".into(), format!("User={}", shared[i + 1])]);
                i += 2;
            }
            _ => {
                args.push(shared[i].clone());
                i += 1;
            }
        }
    }
    args.extend([
        "-o".into(),
        "BatchMode=yes".into(),
        "--".into(),
        endpoint.host.clone(),
    ]);
    Ok(args)
}

fn transfer_args(endpoint: &SshEndpoint, progress: bool) -> Result<Vec<String>, String> {
    let mut args = sftp_args(endpoint)?;
    if progress {
        if args.first().is_some_and(|value| value == "-q") {
            args.remove(0);
        }
        args.insert(0, "-vvv".into());
    }
    Ok(args)
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        // Kill this operation's sftp and its ssh transport together; never touch
        // another terminal, sshd, service or shared application process.
        let mut command = Command::new("taskkill.exe");
        hidden(&mut command);
        let _ = command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
}

fn terminate(child: &mut std::process::Child) {
    kill_process_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

fn run_batch(
    endpoint: &SshEndpoint,
    batch: String,
    operation: &Operation,
) -> Result<String, String> {
    run_batch_progress(endpoint, batch, operation, None)
}

fn run_batch_progress(
    endpoint: &SshEndpoint,
    batch: String,
    operation: &Operation,
    progress: Option<Arc<transfer::Progress>>,
) -> Result<String, String> {
    operation.check()?;
    if operation
        .endpoint
        .as_ref()
        .is_some_and(|bound| bound != endpoint)
    {
        return Err("SFTP effective target changed during operation".into());
    }
    let mut command = Command::new(if cfg!(windows) { "sftp.exe" } else { "sftp" });
    hidden(&mut command);
    let http_proxy = crate::ssh_security::start_http_proxy_authorized(
        endpoint,
        operation.http_proxy_grant.as_ref(),
    )?;
    if let Some(proxy) = &http_proxy {
        command.envs(proxy.environment());
    }
    #[cfg(test)]
    if let Ok(path) = std::env::var("BYCODA_TEST_SFTP_KNOWN_HOSTS") {
        command.args(["-o", &format!("UserKnownHostsFile={path}")]);
    }
    command
        .args(transfer_args(endpoint, progress.is_some())?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("SSH_ASKPASS_REQUIRE", "never");
    let mut spawn = || -> Result<std::process::Child, String> {
        let mut processes = PROCESS_IDS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "SFTP process registry unavailable")?;
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return Err("SFTP is shutting down".into());
        }
        operation.check()?;
        #[cfg(windows)]
        let spawned = crate::windows::spawn_managed(&mut command);
        #[cfg(not(windows))]
        let spawned = command.spawn();
        let child = spawned.map_err(|_| "OpenSSH SFTP is unavailable")?;
        processes.insert(operation.id.clone(), child.id());
        drop(processes);
        Ok(child)
    };
    let mut child = if let Some(lease) = &operation.window_lease {
        lease.with_live(spawn)?
    } else {
        spawn()?
    };
    let _process_guard = ProcessIdGuard(operation.id.clone());
    let stdout = child.stdout.take().ok_or("SFTP output unavailable")?;
    let stderr = child.stderr.take().ok_or("SFTP diagnostics unavailable")?;
    let output = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = stdout.take(MAX_OUTPUT + 1).read_to_end(&mut bytes);
        bytes
    });
    let diagnostic = std::thread::spawn(move || transfer::read_diagnostics(stderr, progress));
    let input = child.stdin.take().ok_or("SFTP input unavailable")?;
    // A long path can exceed an OS pipe buffer before authentication finishes.
    // Write on a separate thread so cancellation can still kill the transport.
    let input = std::thread::spawn(move || {
        let mut input = input;
        input.write_all(batch.as_bytes())
    });
    let deadline = Instant::now()
        + Duration::from_secs(if operation.id.starts_with("cleanup-") {
            15
        } else {
            300
        });
    let status = loop {
        if operation.check().is_err() || Instant::now() >= deadline {
            terminate(&mut child);
            let _ = input.join();
            let _ = output.join();
            let _ = diagnostic.join();
            return Err(if operation.check().is_err() {
                "SFTP operation cancelled"
            } else {
                "SFTP operation timed out"
            }
            .into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => {
                terminate(&mut child);
                let _ = input.join();
                let _ = output.join();
                let _ = diagnostic.join();
                return Err("SFTP process failed".into());
            }
        }
    };
    let bytes = output.join().map_err(|_| "SFTP output failed")?;
    let diagnostic = diagnostic.join().map_err(|_| "SFTP diagnostics failed")?;
    if input.join().map_err(|_| "SFTP input failed")?.is_err() {
        return Err("Could not send SFTP operation".into());
    }
    operation.check()?;
    if bytes.len() as u64 > MAX_OUTPUT || diagnostic.len() as u64 > MAX_OUTPUT {
        return Err("SFTP response exceeds 4 MiB; use a smaller directory".into());
    }
    if !status.success() {
        let message: String = String::from_utf8_lossy(&diagnostic)
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .take(1000)
            .collect();
        return Err(format!("SFTP failed: {}", message.trim()));
    }
    String::from_utf8(bytes).map_err(|_| "SFTP returned unsupported filename encoding".into())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub kind: String,
}

fn parse_listing(content: &str) -> Result<Vec<SftpEntry>, String> {
    let mut entries = vec![];
    for line in content.lines() {
        let line = line.trim_start();
        let Some(kind) = line.chars().next().filter(|c| "-dl".contains(*c)) else {
            continue;
        };
        // OpenSSH's long listing has mode, links, owner, group, size, month,
        // day, time/year, then the untouched filename (which can contain spaces).
        if line.len() < 10
            || !line.as_bytes()[1..10]
                .iter()
                .all(|b| b"rwxstST-*".contains(b))
        {
            continue;
        }
        let mut rest = line;
        for _ in 0..8 {
            rest = rest.trim_start();
            let end = rest
                .find(char::is_whitespace)
                .ok_or("Unsupported SFTP directory listing")?;
            rest = &rest[end..];
        }
        let raw = rest.trim_start();
        let name = if kind == 'l' {
            raw.split_once(" -> ").map_or(raw, |(name, _)| name)
        } else {
            raw
        };
        if name == "." || name == ".." {
            continue;
        }
        if name.is_empty() || name.chars().any(char::is_control) || name.contains('/') {
            return Err("Unsupported SFTP filename".into());
        }
        entries.push(SftpEntry {
            name: name.into(),
            kind: match kind {
                'd' => "directory",
                'l' => "symlink",
                _ => "file",
            }
            .into(),
        });
    }
    entries.sort_by(|a, b| (a.kind != "directory", &a.name).cmp(&(b.kind != "directory", &b.name)));
    Ok(entries)
}

#[tauri::command(async)]
pub fn ssh_sftp_list(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    path: String,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<Vec<SftpEntry>, String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let request = crate::ssh_http_proxy_credentials::ProxyOperation::SftpList {
        operation_id: operation_id.clone(),
        path: path.clone(),
    };
    let mut operation = Operation::begin_for_window_with_lease(
        operation_id,
        window.label(),
        &endpoint,
        owner_lease,
    )?;
    operation.authorize_http_proxy(
        &app,
        window.label(),
        &connection_id,
        &endpoint,
        &request,
        http_proxy_ticket_id.as_deref(),
    )?;
    let output = run_batch(
        &endpoint,
        format!("ls -la {}\nbye\n", quote_path(&path)?),
        &operation,
    )?;
    parse_listing(&output)
}

fn publish_download(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::hard_link(temporary, destination).map_err(|_| "Could not publish download without overwriting; destination must support hard links and a new filename".into())
}

/// Downloads never overwrite an existing local path. Data stays in a sibling
/// temporary file until success; hard_link publishes it atomically without
/// clobbering. A failed/cancelled transfer removes its own partial file.
#[tauri::command(async)]
pub fn ssh_sftp_download(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    remote_path: String,
    local_path: String,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    transfer::download(
        app,
        window,
        connection_id,
        remote_path,
        local_path,
        operation_id,
        http_proxy_ticket_id,
    )
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Preserve the reviewed IPC transfer contract.
pub fn ssh_sftp_upload(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    local_path: String,
    remote_path: String,
    overwrite_confirmed: bool,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<u64, String> {
    transfer::upload(
        app,
        window,
        connection_id,
        local_path,
        remote_path,
        overwrite_confirmed,
        operation_id,
        http_proxy_ticket_id,
    )
}

#[tauri::command(async)]
pub fn ssh_sftp_recoveries(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
) -> Result<Vec<transfer::RecoveryView>, String> {
    transfer::list(&app, window.label(), &connection_id)
}

#[tauri::command(async)]
pub fn ssh_sftp_resume(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    recovery_id: String,
    overwrite_confirmed: bool,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    transfer::resume(
        app,
        window,
        connection_id,
        recovery_id,
        overwrite_confirmed,
        operation_id,
        http_proxy_ticket_id,
    )
}

#[tauri::command(async)]
pub fn ssh_sftp_discard(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    recovery_id: String,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    transfer::discard(
        app,
        window,
        connection_id,
        recovery_id,
        operation_id,
        http_proxy_ticket_id,
    )
}
/// App shutdown cancels all registered operations; each worker owns and reaps
/// its native child. Called before the application's final process teardown.
pub fn shutdown() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Ok(entries) = operations().lock() {
        for entry in entries.values() {
            entry.cancelled.store(true, Ordering::Relaxed);
        }
    }
    if let Some(processes) = PROCESS_IDS.get() {
        if let Ok(entries) = processes.lock() {
            for pid in entries.values() {
                kill_process_tree(*pid);
            }
        }
    }
}

#[tauri::command]
pub fn ssh_sftp_cancel(window: tauri::Window, operation_id: String) -> Result<(), String> {
    cancel_for_window(window.label(), &operation_id)
}

fn cancel_for_window(owner: &str, operation_id: &str) -> Result<(), String> {
    if let Some(entry) = operations()
        .lock()
        .map_err(|_| "SFTP operation registry unavailable")?
        .get(operation_id)
    {
        if entry.owner != owner {
            return Err("SFTP operation belongs to another window".into());
        }
        entry.cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Closing one window cannot cancel or kill another window's transfers.
pub fn kill_window(owner: &str) {
    crate::ssh_window_lifecycle::close(owner);
    let ids = if let Ok(entries) = operations().lock() {
        entries
            .iter()
            .filter_map(|(id, entry)| {
                if entry.owner == owner {
                    entry.alive.store(false, Ordering::SeqCst);
                    entry.cancelled.store(true, Ordering::Relaxed);
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    if let Ok(processes) = PROCESS_IDS.get_or_init(Default::default).lock() {
        for id in ids {
            if let Some(pid) = processes.get(&id) {
                kill_process_tree(*pid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_literal_paths_and_rejects_batch_injection() {
        assert_eq!(
            quote_path("/home/alice/a b\"c").unwrap(),
            "\"/home/alice/a b\\\"c\""
        );
        assert_eq!(quote_path("-option").unwrap(), "\"./-option\"");
        for path in ["", "x\nput bad", "x\rbye", "x\0", "/x/*", "/x/[a]"] {
            assert!(quote_path(path).is_err());
        }
    }
    #[test]
    fn maps_shared_policy_to_sftp_without_confusing_port_or_username() {
        let args = sftp_args(&SshEndpoint {
            host: "host.test".into(),
            user: Some("alice".into()),
            port: 2222,
            ..Default::default()
        })
        .unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-P", "2222"]));
        assert!(args.contains(&"User=alice".into()));
        assert!(args.contains(&"StrictHostKeyChecking=yes".into()));
        assert!(args.contains(&"BatchMode=yes".into()));
        assert!(!args.contains(&"-l".into()));
    }
    #[test]
    fn parses_spaces_and_symlinks_without_following_them() {
        let rows = parse_listing("sftp> ls -la .\ndrwxr-xr-x 2 alice staff 1 Oct 18 12:00 .\ndrwxr-xr-x 2 alice staff 1 Oct 18 12:00 folder name\n-rw-r--r-- 1 alice staff 3 Oct 18 2026 a b.txt\nlrwxrwxrwx 1 alice staff 4 Oct 18 12:00 link -> /secret\n").unwrap();
        assert_eq!(
            rows,
            vec![
                SftpEntry {
                    name: "folder name".into(),
                    kind: "directory".into()
                },
                SftpEntry {
                    name: "a b.txt".into(),
                    kind: "file".into()
                },
                SftpEntry {
                    name: "link".into(),
                    kind: "symlink".into()
                }
            ]
        );
    }
    #[test]
    fn cancellation_is_operation_scoped_and_cleans_registry() {
        let operation = Operation::begin("test-cancel-operation".into()).unwrap();
        assert!(Operation::begin("test-cancel-operation".into()).is_err());
        cancel_for_window("internal-test", "test-cancel-operation").unwrap();
        assert!(operation.check().is_err());
        drop(operation);
        assert!(Operation::begin("test-cancel-operation".into()).is_ok());
    }

    #[test]
    fn cancellation_requires_native_owner_window() {
        crate::ssh_window_lifecycle::register("sftp-owner").unwrap();
        let endpoint = SshEndpoint {
            host: "example.test".into(),
            port: 22,
            ..Default::default()
        };
        let operation =
            Operation::begin_for_window("owned-cancel".into(), "sftp-owner", &endpoint).unwrap();
        assert!(cancel_for_window("other-window", "owned-cancel").is_err());
        assert!(operation.check().is_ok());
        cancel_for_window("sftp-owner", "owned-cancel").unwrap();
        assert!(operation.check().is_err());
    }

    #[test]
    fn closing_window_stops_its_cleanup_but_not_another_owner_or_reopened_window() {
        crate::ssh_window_lifecycle::register("closing-sftp-owner").unwrap();
        crate::ssh_window_lifecycle::register("retained-sftp-owner").unwrap();
        let endpoint = SshEndpoint {
            host: "example.test".into(),
            port: 22,
            ..Default::default()
        };
        let first =
            Operation::begin_for_window("window-first".into(), "closing-sftp-owner", &endpoint)
                .unwrap();
        let other =
            Operation::begin_for_window("window-other".into(), "retained-sftp-owner", &endpoint)
                .unwrap();
        kill_window("closing-sftp-owner");
        assert!(first.check().is_err());
        assert!(other.check().is_ok());
        assert!(Operation::begin_owned(
            "cleanup-closed-owner".into(),
            first.owner.clone(),
            first.alive.clone(),
            first.endpoint.clone()
        )
        .is_err());
        assert!(
            Operation::begin_for_window("closed-late".into(), "closing-sftp-owner", &endpoint)
                .is_err()
        );
        let old_lease = first.window_lease.clone().unwrap();
        crate::ssh_window_lifecycle::register("closing-sftp-owner").unwrap();
        assert!(Operation::begin_for_window_with_lease(
            "old-generation".into(),
            "closing-sftp-owner",
            &endpoint,
            old_lease
        )
        .is_err());
        let reopened =
            Operation::begin_for_window("window-reopened".into(), "closing-sftp-owner", &endpoint)
                .unwrap();
        assert!(reopened.check().is_ok());
        assert!(!Arc::ptr_eq(&reopened.alive, &first.alive));
    }

    #[test]
    fn transfer_is_bound_to_effective_endpoint_before_process_spawn() {
        crate::ssh_window_lifecycle::register("target-window").unwrap();
        let endpoint = SshEndpoint {
            host: "original.test".into(),
            port: 22,
            ..Default::default()
        };
        let operation =
            Operation::begin_for_window("target-bound".into(), "target-window", &endpoint).unwrap();
        let changed = SshEndpoint {
            host: "different.test".into(),
            ..endpoint
        };
        assert_eq!(
            run_batch(&changed, "ls .\nbye\n".into(), &operation).unwrap_err(),
            "SFTP effective target changed during operation"
        );
        assert!(!PROCESS_IDS
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .contains_key("target-bound"));
    }

    #[test]
    fn download_publication_never_clobbers_an_existing_destination() {
        let root =
            std::env::temp_dir().join(format!("bycoda-sftp-publish-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let staged = root.join("staged");
        let destination = root.join("destination");
        fs::write(&staged, "new download").unwrap();
        fs::write(&destination, "owner contents").unwrap();
        assert!(publish_download(&staged, &destination).is_err());
        assert_eq!(fs::read_to_string(&destination).unwrap(), "owner contents");
        let fresh = root.join("new-name");
        publish_download(&staged, &fresh).unwrap();
        assert_eq!(fs::read_to_string(&fresh).unwrap(), "new download");
        for path in [staged, destination, fresh] {
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn real_sftp_cancellation_reaps_transport_while_peer_stalls() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = std::thread::spawn(move || {
            let operation = Operation::begin("real-cancel-stalled-sftp".into()).unwrap();
            run_batch(
                &SshEndpoint {
                    host: "127.0.0.1".into(),
                    port,
                    ..Default::default()
                },
                "ls .\nbye\n".into(),
                &operation,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(10);
        let peer = loop {
            if let Ok((peer, _)) = listener.accept() {
                break peer;
            }
            assert!(
                Instant::now() < deadline,
                "sftp must reach disposable protocol peer"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        let started = Instant::now();
        cancel_for_window("internal-test", "real-cancel-stalled-sftp").unwrap();
        let result = worker.join().unwrap();
        assert_eq!(result.unwrap_err(), "SFTP operation cancelled");
        assert!(started.elapsed() < Duration::from_secs(8));
        assert!(!PROCESS_IDS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .contains_key("real-cancel-stalled-sftp"));
        drop(peer);
    }

    #[test]
    #[ignore = "Requires BYCODA_TEST_SFTP_ROOT and disposable running sshd"]
    fn real_sftp_lists_puts_renames_downloads_and_reports_missing_paths() {
        let root = std::env::var("BYCODA_TEST_SFTP_ROOT").expect("fixture root");
        let key = std::env::var("BYCODA_TEST_SFTP_IDENTITY").expect("fixture identity reference");
        let port = fs::read_to_string(Path::new(&root).join("port.txt"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let endpoint = SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(std::env::var("USERNAME").unwrap()),
            port,
            identity_file: Some(key),
            jump_host: None,
            ..Default::default()
        };
        let operation = Operation::begin("real-sftp-fixture".into()).unwrap();
        let source = Path::new(&root).join("source file.txt");
        let staging = Path::new(&root).join("uploaded.partial");
        let published = Path::new(&root).join("uploaded file.txt");
        let download = Path::new(&root).join("downloaded file.txt");
        fs::write(&source, "fixture transfer Türkçe 日本語\n").unwrap();
        let path = |path: &Path| quote_path(&path.to_string_lossy().replace('\\', "/")).unwrap();
        let batch = format!(
            "put {} {}\nrename {} {}\nget {} {}\nls -la {}\nbye\n",
            path(&source),
            path(&staging),
            path(&staging),
            path(&published),
            path(&published),
            path(&download),
            path(Path::new(&root))
        );
        let output = run_batch(&endpoint, batch, &operation).unwrap();
        assert_eq!(fs::read(&source).unwrap(), fs::read(&download).unwrap());
        assert_eq!(fs::read(&source).unwrap(), fs::read(&published).unwrap());
        assert!(parse_listing(&output)
            .unwrap()
            .iter()
            .any(|entry| entry.name == "uploaded file.txt"));
        assert!(run_batch(
            &endpoint,
            "ls /bycoda-nonexistent-fixture-path\nbye\n".into(),
            &operation
        )
        .is_err());
    }
}
