use std::collections::HashMap;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::fs::expand_home;

const DATA_EVENT: &str = "pty-data";
const EXIT_EVENT: &str = "pty-exit";
const READ_CHUNK: usize = 32 * 1024;
/// Cap how often a busy PTY hops the webview. Each `emit` is a JS eval; a
/// flood of small reads was thousands per second and froze input.
const PTY_COALESCE: Duration = Duration::from_millis(8);
/// Reads the Windows reader may run ahead of the emitter (about 2 MB).
#[cfg(windows)]
const PTY_QUEUE_CHUNKS: usize = 64;
/// Keystrokes or pastes queued for a terminal whose child is not reading.
const WRITE_QUEUE_LEN: usize = 256;
#[cfg(unix)]
const KILL_ESCALATE: Duration = Duration::from_secs(1);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyData {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: String,
    code: Option<i32>,
}

struct LivePty {
    _http_proxy: Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
    _jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    /// SSH targets never inherit local project access or runtime output capture.
    ssh_identity: Option<String>,
    shell_integration: Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>,
    cwd: std::path::PathBuf,
    completion_shell: Option<String>,
    writer: Mutex<Box<dyn Write + Send>>,
    #[cfg(unix)]
    master_fd: i32,
    #[cfg(windows)]
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    pid: u32,
    /// Label of the window showing this terminal. A reload keeps the window,
    /// so the PTY outlives the page; destroying the window reaps it.
    owner: Arc<Mutex<String>>,
}

pub struct PtyHost {
    sessions: Mutex<HashMap<String, Arc<LivePty>>>,
    /// Background reaps of closed windows. Shutdown joins them so their
    /// SIGKILLs land before the process exits.
    reapers: Mutex<Vec<thread::JoinHandle<()>>>,
    /// `pty_spawn` runs off the main thread, so two spawns of one id could
    /// both miss `reattach` and race to insert. One at a time, as before.
    spawn_gate: Mutex<()>,
}

impl PtyHost {
    pub(crate) fn conversation_list(&self, cwd: &std::path::Path) -> serde_json::Value {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        serde_json::json!({"terminals": sessions.iter().filter(|(_, live)| live.ssh_identity.is_none() && crate::worktrees::contains_working_dir(cwd, &live.cwd)).map(|(id, live)| serde_json::json!({"id": id, "cwd": live.cwd, "pid": live.pid})).collect::<Vec<_>>()})
    }
    pub(crate) fn conversation_write(
        &self,
        cwd: &std::path::Path,
        id: &str,
        data: &str,
    ) -> Result<serde_json::Value, String> {
        let live = self.get(id).ok_or("Terminal is not running")?;
        if live.ssh_identity.is_some() || !crate::worktrees::contains_working_dir(cwd, &live.cwd) {
            return Err("Terminal belongs to another project".into());
        }
        if data.is_empty() || data.len() > 65536 {
            return Err("Invalid terminal input".into());
        }
        let mut writer = live.writer.lock().unwrap_or_else(|e| e.into_inner());
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| format!("Failed to write to terminal: {e}"))?;
        Ok(serde_json::json!({"accepted": true, "terminalId": id, "bytes": data.len()}))
    }
    pub(crate) fn has_working_dir(&self, path: &std::path::Path) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .any(|live| {
                live.ssh_identity.is_none()
                    && crate::worktrees::contains_working_dir(path, &live.cwd)
            })
    }

    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            reapers: Mutex::new(Vec::new()),
            spawn_gate: Mutex::new(()),
        }
    }

    fn insert(&self, id: String, live: Arc<LivePty>) -> Option<Arc<LivePty>> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, live)
    }

    /// Hand a live PTY to the window asking for it. The lookup, the owner
    /// change and the redraw happen under the sessions lock, so a closing
    /// window's `kill_window` cannot reap the terminal mid-transfer. `None`
    /// when no PTY runs under `id`, and the caller spawns a fresh one.
    fn reattach(&self, id: &str, owner: &str, cols: u16, rows: u16) -> Option<Result<(), String>> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let live = sessions.get(id)?;
        live.set_owner(owner);
        Some(reattach(live, cols, rows))
    }

    fn get(&self, id: &str) -> Option<Arc<LivePty>> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }

    fn get_for_window(&self, id: &str, owner: &str) -> Result<Arc<LivePty>, String> {
        let live = self.get(id).ok_or("Terminal is not running")?;
        ensure_window(&live, owner)?;
        Ok(live)
    }

    fn remove_for_window(&self, id: &str, owner: &str) -> Result<Option<Arc<LivePty>>, String> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(live) = sessions.get(id) {
            ensure_window(live, owner)?;
        }
        Ok(sessions.remove(id))
    }

    fn kill_for_window(&self, owner: &str) {
        let kids = {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let ids: Vec<_> = sessions
                .iter()
                .filter(|(_, live)| live.ssh_identity.is_none() || live.owned_by(owner))
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| sessions.remove(&id))
                .collect()
        };
        reap(kids);
    }

    fn output_owner(&self, id: &str, source: &Arc<Mutex<String>>) -> Option<String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions
            .get(id)
            .is_some_and(|live| !Arc::ptr_eq(&live.owner, source))
        {
            return None;
        }
        // Final buffered bytes can outlive removal from the session map. Keep
        // their original owner without holding the master PTY open for them.
        Some(source.lock().unwrap_or_else(|e| e.into_inner()).clone())
    }

    fn remove_if_pid(&self, id: &str, pid: u32) -> Option<Arc<LivePty>> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.get(id).map(|live| live.pid) != Some(pid) {
            return None;
        }
        sessions.remove(id)
    }

    pub(crate) fn kill_all(&self) {
        let kids: Vec<Arc<LivePty>> = {
            let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            map.drain().map(|(_, live)| live).collect()
        };
        reap(kids);
    }

    /// The terminals of one closed window. Other windows keep theirs.
    pub(crate) fn kill_window(&self, label: &str) {
        let kids: Vec<Arc<LivePty>> = {
            let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let ids: Vec<String> = map
                .iter()
                .filter(|(_, live)| live.owned_by(label))
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| map.remove(id)).collect()
        };
        reap(kids);
    }

    pub(crate) fn track_reaper(&self, handle: thread::JoinHandle<()>) {
        let mut reapers = self.reapers.lock().unwrap_or_else(|e| e.into_inner());
        reapers.retain(|reaper| !reaper.is_finished());
        reapers.push(handle);
    }

    pub(crate) fn join_reapers(&self) {
        let reapers = std::mem::take(&mut *self.reapers.lock().unwrap_or_else(|e| e.into_inner()));
        for reaper in reapers {
            let _ = reaper.join();
        }
    }
}

impl LivePty {
    fn owned_by(&self, label: &str) -> bool {
        *self.owner.lock().unwrap_or_else(|e| e.into_inner()) == label
    }

    fn owner_label(&self) -> String {
        self.owner.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn set_owner(&self, label: &str) {
        *self.owner.lock().unwrap_or_else(|e| e.into_inner()) = label.to_string();
    }
}

fn reap(kids: Vec<Arc<LivePty>>) {
    let pids: Vec<u32> = kids.iter().map(|live| live.pid).collect();
    for live in kids {
        #[cfg(unix)]
        {
            hangup(live.pid);
            close_fd(live.master_fd);
        }
        #[cfg(not(unix))]
        drop(live);
    }
    // Quit and `Drop` both exit the process, so the SIGKILL has to land
    // before this returns. `terminate`'s detached escalate thread never gets
    // to run, and every shell is its own `setsid` session that outlives us.
    crate::harness::terminate_all(&pids);
}

impl Drop for PtyHost {
    fn drop(&mut self) {
        self.kill_all();
    }
}

/// Off the main thread: opening the PTY and starting the shell takes tens of
/// milliseconds. The terminal is registered before this returns, so a write or
/// resize sent after it resolves finds it.
#[tauri::command(async)]
// Preserve the existing IPC/process-launch argument contract.
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    profile: Option<String>,
) -> Result<(), String> {
    let gate_host = host.clone();
    let _gate = gate_host
        .spawn_gate
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (cols, rows) = (cols.max(2), rows.max(2));
    ensure_identity(host.get(&id).as_deref(), None)?;
    // A reloaded page restores its terminals under the same ids while the old
    // shells are still running. Hand the live PTY to the new view instead of
    // hanging up the shell and every job in it.
    if let Some(attached) = host.reattach(&id, window.label(), cols, rows) {
        return attached;
    }

    let workdir = working_dir(&cwd);
    let _reservation = crate::worktree_lifecycle::reserve_spawn(&workdir)?;

    let shell = shell_for(profile.as_deref());

    #[cfg(unix)]
    {
        spawn_unix(
            app,
            host,
            window.label(),
            id,
            workdir,
            cols,
            rows,
            shell,
            None,
            None,
            None,
            None,
        )
    }

    #[cfg(windows)]
    {
        spawn_windows(
            app,
            host,
            window.label(),
            id,
            workdir,
            cols,
            rows,
            shell,
            None,
            None,
            None,
            None,
        )
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (app, cwd, cols, rows, shell);
        Err("Terminals are not supported on this platform.".into())
    }
}

/// Only the window owning a local PTY can query its launch shell's catalog.
#[tauri::command(async)]
pub fn pty_suggestions(
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    prefix: String,
) -> Result<Vec<String>, String> {
    let live = host.get_for_window(&id, window.label())?;
    if live.ssh_identity.is_some() {
        return Err("Local suggestions are unavailable for private terminals".into());
    }
    let shell = live
        .completion_shell
        .as_deref()
        .ok_or("Shell catalog unavailable")?;
    Ok(crate::terminal_completion::suggestions(shell, &prefix))
}

fn ensure_identity(live: Option<&LivePty>, identity: Option<&str>) -> Result<(), String> {
    if live.is_some_and(|live| live.ssh_identity.as_deref() != identity) {
        return Err("Terminal belongs to another connection; close it before reconnecting".into());
    }
    Ok(())
}

fn ensure_window(live: &LivePty, owner: &str) -> Result<(), String> {
    if live.ssh_identity.is_some() && !live.owned_by(owner) {
        return Err("SSH terminal belongs to another window".into());
    }
    Ok(())
}

pub(crate) fn integration_for_spawn(
    host: &PtyHost,
    id: &str,
    owner: &str,
    mode: Option<&str>,
) -> Result<Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>, String> {
    match mode {
        None => Ok(None),
        Some(mode @ ("auto" | "bash" | "zsh" | "powershell")) => {
            if let Some(live) = host.get(id) {
                ensure_window(&live, owner)?;
                if let Some(integration) = &live.shell_integration {
                    if integration
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .shell_mode()
                        != mode
                    {
                        return Err(
                            "This terminal already belongs to a different shell integration".into(),
                        );
                    }
                    return Ok(Some(integration.clone()));
                }
            }
            Ok(Some(Arc::new(Mutex::new(
                crate::ssh_shell_integration::ShellIntegration::for_shell(mode)?,
            ))))
        }
        _ => Err("Unsupported shell integration".into()),
    }
}

/// Explicit SSH connect only. This uses the same PTY lifecycle, job ownership,
/// window cleanup and byte transport as local terminals, without output logging.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_ssh(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    identity: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    integration: Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>,
    jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    http_proxy: Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
) -> Result<(), String> {
    spawn_private_program(
        app,
        window,
        host,
        id,
        identity,
        "ssh",
        args,
        None,
        integration,
        jump_config,
        http_proxy,
        cols,
        rows,
    )
}

fn validate_new_key_path(path: &std::path::Path) -> Result<(), String> {
    if !path.is_absolute()
        || path.to_string_lossy().chars().any(char::is_control)
        || path.file_name().is_none()
        || !path.parent().is_some_and(|parent| parent.is_dir())
    {
        return Err("Choose an absolute new key path in an existing directory".into());
    }
    let public = std::path::PathBuf::from(format!("{}.pub", path.to_string_lossy()));
    for candidate in [path, public.as_path()] {
        match std::fs::symlink_metadata(candidate) {
            Ok(_) => {
                return Err("Key or public key path already exists. Choose a new filename.".into())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Could not verify that key path is new".into()),
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_keygen(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    path: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let identity = serde_json::to_string(&("keygen", &path)).map_err(|_| "Invalid key filename")?;
    let args = keygen_args(&path);
    spawn_private_program(
        app,
        window,
        host,
        id,
        identity,
        "ssh-keygen",
        args,
        Some(path.into()),
        None,
        None,
        None,
        cols,
        rows,
    )
}

fn keygen_args(path: &str) -> Vec<String> {
    vec![
        "-t".into(),
        "ed25519".into(),
        "-a".into(),
        "64".into(),
        "-f".into(),
        path.into(),
    ]
}

#[allow(clippy::too_many_arguments)]
fn spawn_private_program(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    identity: String,
    program: &'static str,
    args: Vec<String>,
    new_key_path: Option<std::path::PathBuf>,
    integration: Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>,
    jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    http_proxy: Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let gate_host = host.clone();
    let _gate = gate_host
        .spawn_gate
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (cols, rows) = (cols.max(2), rows.max(2));
    ensure_identity(host.get(&id).as_deref(), Some(&identity))?;
    if let Some(live) = host.get(&id) {
        ensure_window(&live, window.label())?;
    }
    if let Some(attached) = host.reattach(&id, window.label(), cols, rows) {
        return attached;
    }
    if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
        return Err("Invalid terminal identifier".into());
    }
    if let Some(path) = new_key_path {
        validate_new_key_path(&path)?;
    }
    let workdir = dirs_home()
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
        .ok_or("Home directory is unavailable")?;
    let shell = (program.into(), args, vec![("SSH_ASKPASS_REQUIRE", "never")]);
    #[cfg(unix)]
    return spawn_unix(
        app,
        host,
        window.label(),
        id,
        workdir,
        cols,
        rows,
        shell,
        Some(identity),
        integration,
        jump_config,
        http_proxy,
    );
    #[cfg(windows)]
    return spawn_windows(
        app,
        host,
        window.label(),
        id,
        workdir,
        cols,
        rows,
        shell,
        Some(identity),
        integration,
        jump_config,
        http_proxy,
    );
    #[cfg(not(any(unix, windows)))]
    Err("Terminals are not supported on this platform".into())
}

/// The new view starts blank. Resizing and a SIGWINCH make the shell reprint
/// its prompt and a full-screen program redraw, even when the size is the same.
fn reattach(live: &LivePty, cols: u16, rows: u16) -> Result<(), String> {
    #[cfg(unix)]
    {
        resize_fd(live.master_fd, cols, rows)?;
        let mut pgrp: libc::pid_t = 0;
        if unsafe { libc::ioctl(live.master_fd, libc::TIOCGPGRP, &mut pgrp) } == 0 && pgrp > 1 {
            unsafe {
                libc::kill(-pgrp, libc::SIGWINCH);
            }
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        let master = live.master.lock().unwrap_or_else(|e| e.into_inner());
        master
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("Failed to resize terminal: {err}"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (live, cols, rows);
        Ok(())
    }
}

/// Stays on the main thread on purpose: the webview's writes arrive there in
/// order, and the writer only queues them for the terminal's own
/// writer thread, so a child that stops reading cannot hang the UI.
#[tauri::command]
pub fn pty_write(
    window: tauri::Window,
    host: State<PtyHost>,
    id: String,
    data: String,
) -> Result<(), String> {
    let live = host.get_for_window(&id, window.label())?;
    write_shell_input(&live, &id, &data, |event| {
        emit_shell_event(window.app_handle(), window.label(), event)
    })
}

fn write_shell_input(
    live: &LivePty,
    id: &str,
    data: &str,
    mut emit: impl FnMut(crate::ssh_shell_integration::ShellEvent),
) -> Result<(), String> {
    // The writer is the transport ordering gate. State is never held across
    // potentially blocking Unix I/O, so output parsing can always progress.
    let mut writer = live.writer.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(integration) = &live.shell_integration {
        let event = integration
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .input_changed(id, data);
        emit(event);
    }
    write_locked(writer.as_mut(), data.as_bytes())
}

fn write_locked(writer: &mut dyn Write, data: &[u8]) -> Result<(), String> {
    writer
        .write_all(data)
        .and_then(|_| writer.flush())
        .map_err(|e| format!("Failed to write to terminal: {e}"))
}

/// On a blocking thread: ConPTY's resize waits on conhost, which stalls while
/// it is busy writing output. On the main thread that froze the whole window,
/// and on an async worker it would starve other commands.
#[tauri::command]
pub async fn pty_resize(
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let live = host.get_for_window(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || resize_live(&live, cols, rows))
        .await
        .map_err(|e| e.to_string())?
}

fn resize_live(live: &LivePty, cols: u16, rows: u16) -> Result<(), String> {
    #[cfg(unix)]
    {
        resize_fd(live.master_fd, cols.max(2), rows.max(2))
    }
    #[cfg(windows)]
    {
        let master = live.master.lock().unwrap_or_else(|e| e.into_inner());
        master
            .resize(portable_pty::PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("Failed to resize terminal: {err}"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (live, cols, rows);
        Err("Terminals are not supported on this platform.".into())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyStatus {
    foreground: Option<String>,
    /// False where no foreground process can be named, so callers stop polling.
    supported: bool,
}

/// Off the main thread: process lookup can fall back to `ps`. Visible terminals
/// poll once a second; Linux normally reads argv directly from `/proc`.
#[tauri::command(async)]
pub fn pty_status(
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
) -> Result<PtyStatus, String> {
    let live = host.get_for_window(&id, window.label())?;
    if live.ssh_identity.is_some() {
        return Ok(PtyStatus {
            foreground: None,
            supported: false,
        });
    }
    #[cfg(unix)]
    {
        let foreground = foreground_label(live.master_fd, live.pid);
        Ok(PtyStatus {
            foreground,
            supported: true,
        })
    }
    #[cfg(not(unix))]
    {
        let _ = live;
        Ok(PtyStatus {
            foreground: None,
            supported: false,
        })
    }
}

/// The terminal leaves the map on the calling thread, so a respawn of the same
/// id right after cannot see it. Only the Windows `taskkill` wait moves to the
/// blocking pool; the signals on Unix return at once.
#[tauri::command]
pub fn pty_kill(window: tauri::Window, host: State<PtyHost>, id: String) -> Result<(), String> {
    if let Some(live) = host.remove_for_window(&id, window.label())? {
        #[cfg(windows)]
        {
            tauri::async_runtime::spawn_blocking(move || {
                terminate(live.pid);
                drop(live);
            });
        }
        #[cfg(not(windows))]
        {
            terminate(live.pid);
            #[cfg(unix)]
            close_fd(live.master_fd);
        }
    }
    Ok(())
}

/// Off the main thread: `kill_all` waits for the shells to die before it
/// returns, and a window close calls this while the app keeps running.
#[tauri::command(async)]
pub fn pty_kill_all(window: tauri::Window, host: State<'_, PtyHost>) -> Result<(), String> {
    host.kill_for_window(window.label());
    Ok(())
}

#[cfg(unix)]
// Preserve the existing IPC/process-launch argument contract.
#[allow(clippy::too_many_arguments)]
fn spawn_unix(
    app: AppHandle,
    host: State<PtyHost>,
    owner: &str,
    id: String,
    workdir: std::path::PathBuf,
    cols: u16,
    rows: u16,
    (shell, args, env): LaunchShell,
    ssh_identity: Option<String>,
    integration: Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>,
    jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    http_proxy: Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
) -> Result<(), String> {
    let private = ssh_identity.is_some();
    use std::fs::File;
    use std::os::unix::io::FromRawFd;
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    let (master, slave) = open_pty(cols, rows)?;

    let mut cmd = Command::new(&shell);
    if let Some(proxy) = &http_proxy {
        cmd.envs(proxy.environment());
    }
    cmd.envs(env.iter().copied());
    cmd.args(&args)
        .current_dir(&workdir)
        .stdin(dup_stdio(slave)?)
        .stdout(dup_stdio(slave)?)
        .stderr(dup_stdio(slave)?)
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("COLORFGBG", "15;0")
        .env("TERM_PROGRAM", "bycoda")
        .env("PATH", crate::harness::gui_search_path());
    if let Some(home) = dirs_home() {
        cmd.env("HOME", &home);
    }
    cmd.env("PWD", &workdir);

    // setsid() already creates a new session and process group. Calling
    // process_group(0) first makes the child a group leader, so setsid()
    // fails with EPERM ("Operation not permitted").
    let slave_fd = slave;
    unsafe {
        cmd.pre_exec(move || {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // Controlling tty is best-effort; the shell still runs without it.
            let _ = libc::ioctl(0, libc::TIOCSCTTY as _, 0);
            if slave_fd > 2 {
                libc::close(slave_fd);
            }
            Ok(())
        });
    }

    set_cloexec(master);
    let io = (|| -> Result<_, String> {
        let reader = unsafe { File::from_raw_fd(dup_fd(master)?) };
        let writer = unsafe { File::from_raw_fd(dup_fd(master)?) };
        Ok((reader, writer))
    })();
    let (reader, writer) = match io {
        Ok(io) => io,
        Err(error) => {
            close_fd(slave);
            close_fd(master);
            return Err(error);
        }
    };
    let spawned = cmd.spawn();
    close_fd(slave);
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => {
            close_fd(master);
            return Err(format!("Failed to start {shell}: {error}"));
        }
    };
    let pid = child.id();

    let live = Arc::new(LivePty {
        _http_proxy: http_proxy,
        _jump_config: jump_config,
        ssh_identity: ssh_identity.clone(),
        shell_integration: integration.clone(),
        cwd: workdir.clone(),
        completion_shell: (!private).then(|| shell.clone()),
        writer: Mutex::new(Box::new(QueuedWriter::spawn(Box::new(writer)))),
        master_fd: master,
        pid,
        owner: Arc::new(Mutex::new(owner.to_string())),
    });
    let data_owner = live.owner.clone();
    host.insert(id.clone(), live);

    let terminal_logs = ssh_identity
        .is_none()
        .then(|| crate::pty_runtime_logs::TerminalLogSender::new(&app, &workdir));
    let data_app = app.clone();
    let data_id = id.clone();
    thread::spawn(move || {
        let mut file = reader;
        let fd = file.as_raw_fd();
        let mut buf = vec![0_u8; READ_CHUNK];
        let mut acc = Vec::with_capacity(READ_CHUNK);
        let mut last_emit = Instant::now();
        loop {
            if acc.is_empty() {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.extend_from_slice(&buf[..n]);
                        last_emit = Instant::now();
                    }
                    Err(_) => break,
                }
            } else if pty_should_flush(acc.len(), last_emit.elapsed())
                || !wait_readable(fd, PTY_COALESCE.saturating_sub(last_emit.elapsed()))
            {
                if let Some(logs) = &terminal_logs {
                    logs.push(&acc);
                }
                emit_pty_data(
                    &data_app,
                    &data_id,
                    &data_owner,
                    &acc,
                    private,
                    &integration,
                );
                acc.clear();
                last_emit = Instant::now();
            } else {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => acc.extend_from_slice(&buf[..n]),
                    Err(_) => break,
                }
            }
        }
        if let Some(logs) = &terminal_logs {
            logs.push(&acc);
        }
        emit_pty_data(
            &data_app,
            &data_id,
            &data_owner,
            &acc,
            private,
            &integration,
        );
    });

    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        // Only announce this child. A remount/respawn reuses the id, and the
        // previous wait thread must not paint "[process exited]" on the new PTY
        // or yank the replacement out of the host map.
        let owner = if let Some(host) = wait_app.try_state::<PtyHost>() {
            host.remove_if_pid(&wait_id, pid).map(|live| {
                close_fd(live.master_fd);
                live.owner_label()
            })
        } else {
            None
        };
        if let Some(owner) = owner {
            emit_to_owner(
                &wait_app,
                Some(owner),
                EXIT_EVENT,
                PtyExit { id: wait_id, code },
                private,
            );
        }
    });

    Ok(())
}

#[cfg(windows)]
// Preserve the existing IPC/process-launch argument contract.
#[allow(clippy::too_many_arguments)]
fn spawn_windows(
    app: AppHandle,
    host: State<PtyHost>,
    owner: &str,
    id: String,
    workdir: std::path::PathBuf,
    cols: u16,
    rows: u16,
    (shell, args, env): LaunchShell,
    ssh_identity: Option<String>,
    integration: Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>,
    jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    http_proxy: Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
) -> Result<(), String> {
    let private = ssh_identity.is_some();
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("Failed to open terminal: {err}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    if let Some(proxy) = &http_proxy {
        for (key, value) in proxy.environment() {
            cmd.env(key, value);
        }
    }
    cmd.args(&args);
    cmd.cwd(&workdir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("COLORFGBG", "15;0");
    cmd.env("TERM_PROGRAM", "bycoda");
    cmd.env("PATH", crate::harness::gui_search_path());
    if let Some(home) = dirs_home() {
        cmd.env("HOME", &home);
        cmd.env("USERPROFILE", &home);
    }
    cmd.env("PWD", workdir.to_string_lossy().as_ref());
    for (key, value) in &env {
        cmd.env(key, value);
    }

    // Allocate I/O before creating a child. A failed pipe allocation must not
    // leave a running SSH process outside the registered terminal lifecycle.
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("Failed to read terminal: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("Failed to write to terminal: {err}"))?;

    let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), cmd)
        .map_err(|err| format!("Failed to start {shell}: {err}"))?;
    let pid = child.process_id().unwrap_or(0);

    let live = Arc::new(LivePty {
        _http_proxy: http_proxy,
        _jump_config: jump_config,
        ssh_identity: ssh_identity.clone(),
        shell_integration: integration.clone(),
        cwd: workdir.clone(),
        completion_shell: (!private).then(|| shell.clone()),
        writer: Mutex::new(Box::new(QueuedWriter::spawn(writer))),
        master: Mutex::new(pair.master),
        pid,
        owner: Arc::new(Mutex::new(owner.to_string())),
    });
    let data_owner = live.owner.clone();
    host.insert(id.clone(), live);

    let terminal_logs = ssh_identity
        .is_none()
        .then(|| crate::pty_runtime_logs::TerminalLogSender::new(&app, &workdir));
    let data_app = app.clone();
    let data_id = id.clone();
    // A blocking read on the ConPTY pipe cannot be polled with a timeout, so
    // this thread only reads; the emitter below owns the timed drain. The
    // bounded queue makes a flooding child wait instead of piling up memory.
    // Either side ending closes the channel and stops the other.
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(PTY_QUEUE_CHUNKS);
    thread::spawn(move || {
        let mut buf = vec![0_u8; READ_CHUNK];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    thread::spawn(move || {
        coalesce_chunks(&rx, PTY_COALESCE, READ_CHUNK, |bytes| {
            if let Some(logs) = &terminal_logs {
                logs.push(bytes);
            }
            emit_pty_data(
                &data_app,
                &data_id,
                &data_owner,
                bytes,
                private,
                &integration,
            )
        });
    });

    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        let owner = if let Some(host) = wait_app.try_state::<PtyHost>() {
            host.remove_if_pid(&wait_id, pid)
                .map(|live| live.owner_label())
        } else {
            None
        };
        if let Some(owner) = owner {
            emit_to_owner(
                &wait_app,
                Some(owner),
                EXIT_EVENT,
                PtyExit { id: wait_id, code },
                private,
            );
        }
    });

    Ok(())
}

fn working_dir(cwd: &str) -> std::path::PathBuf {
    let path = expand_home(cwd);
    if path.is_dir() {
        return path;
    }
    dirs_home().map(std::path::PathBuf::from).unwrap_or(path)
}

/// A shell to start: its path, its arguments, and environment it needs.
type LaunchShell = (String, Vec<String>, Vec<(&'static str, &'static str)>);

#[cfg(all(test, windows))]
#[path = "ssh_keygen_tests.rs"]
mod keygen_tests;

/// The terminal profile `profile` names, the default one, or the old
/// fallback when no shell could be listed.
fn shell_for(profile: Option<&str>) -> LaunchShell {
    match crate::terminal_profiles::resolve(profile) {
        Some(found) => (
            found.path.clone(),
            crate::terminal_profiles::terminal_args(&found),
            crate::terminal_profiles::profile_env(&found),
        ),
        None => {
            let (shell, args) = default_shell();
            (shell, args, Vec::new())
        }
    }
}

fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.is_empty() {
                return (comspec, Vec::new());
            }
        }
        ("powershell.exe".into(), vec!["-NoLogo".into()])
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".into()
                } else {
                    "/bin/bash".into()
                }
            });
        let args = login_args(&shell)
            .iter()
            .map(|arg| (*arg).to_string())
            .collect();
        (shell, args)
    }
}

#[cfg(not(windows))]
fn login_args(shell: &str) -> &'static [&'static str] {
    match std::path::Path::new(shell)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
    {
        "zsh" | "bash" | "sh" | "fish" => &["-l"],
        _ => &[],
    }
}

/// The hangup a closing shell expects, without `terminate`'s escalation.
#[cfg(unix)]
fn hangup(pid: u32) {
    if pid == 0 || pid == 1 {
        return;
    }
    let ipid = pid as i32;
    unsafe {
        libc::kill(ipid, libc::SIGHUP);
        libc::kill(-ipid, libc::SIGHUP);
    }
}

fn terminate(pid: u32) {
    if pid == 0 || pid == 1 {
        return;
    }
    #[cfg(unix)]
    {
        let ipid = pid as i32;
        unsafe {
            libc::kill(ipid, libc::SIGHUP);
            libc::kill(-ipid, libc::SIGHUP);
            libc::kill(ipid, libc::SIGTERM);
            libc::kill(-ipid, libc::SIGTERM);
        }
        thread::spawn(move || {
            thread::sleep(KILL_ESCALATE);
            unsafe {
                libc::kill(ipid, libc::SIGKILL);
                libc::kill(-ipid, libc::SIGKILL);
            }
        });
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        crate::hide_window_console(&mut cmd);
        let _ = cmd
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

#[cfg(unix)]
fn open_pty(cols: u16, rows: u16) -> Result<(i32, i32), String> {
    let master = unsafe { libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY) };
    if master < 0 {
        return Err(os_err("Failed to open terminal"));
    }
    if unsafe { libc::grantpt(master) } != 0 || unsafe { libc::unlockpt(master) } != 0 {
        close_fd(master);
        return Err(os_err("Failed to unlock terminal"));
    }
    let name = slave_name(master).inspect_err(|_| {
        close_fd(master);
    })?;
    let slave = unsafe { libc::open(name.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
    if slave < 0 {
        close_fd(master);
        return Err(os_err("Failed to open terminal slave"));
    }
    if let Err(err) = resize_fd(master, cols, rows) {
        close_fd(master);
        close_fd(slave);
        return Err(err);
    }
    Ok((master, slave))
}

#[cfg(unix)]
fn slave_name(master: i32) -> Result<std::ffi::CString, String> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut buf = vec![0 as libc::c_char; 64];
        let ret = unsafe { libc::ptsname_r(master, buf.as_mut_ptr(), buf.len()) };
        if ret != 0 {
            return Err(os_err("Failed to resolve terminal name"));
        }
        let last = buf.len() - 1;
        buf[last] = 0;
        Ok(unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_owned())
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let ptr = unsafe { libc::ptsname(master) };
        if ptr.is_null() {
            return Err(os_err("Failed to resolve terminal name"));
        }
        Ok(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_owned())
    }
}

#[cfg(unix)]
fn resize_fd(fd: i32, cols: u16, rows: u16) -> Result<(), String> {
    let size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } != 0 {
        return Err(os_err("Failed to resize terminal"));
    }
    Ok(())
}

#[cfg(unix)]
fn dup_fd(fd: i32) -> Result<i32, String> {
    let next = unsafe { libc::dup(fd) };
    if next < 0 {
        return Err(os_err("Failed to duplicate terminal"));
    }
    Ok(next)
}

#[cfg(unix)]
fn dup_stdio(fd: i32) -> Result<std::process::Stdio, String> {
    use std::os::unix::io::FromRawFd;
    let next = dup_fd(fd)?;
    Ok(unsafe { std::process::Stdio::from_raw_fd(next) })
}

#[cfg(unix)]
fn set_cloexec(fd: i32) {
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        if flags >= 0 {
            libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
        }
    }
}

#[cfg(unix)]
fn close_fd(fd: i32) {
    if fd >= 0 {
        unsafe {
            libc::close(fd);
        }
    }
}

#[cfg(unix)]
fn os_err(ctx: &str) -> String {
    format!("{ctx}: {}", std::io::Error::last_os_error())
}

fn emit_pty_data(
    app: &AppHandle,
    id: &str,
    source: &Arc<Mutex<String>>,
    bytes: &[u8],
    private: bool,
    integration: &Option<Arc<Mutex<crate::ssh_shell_integration::ShellIntegration>>>,
) {
    if bytes.is_empty() {
        return;
    }
    // Read at emit time: reattachment moves the same shell, while a new spawn
    // under the same id must never receive bytes buffered by its predecessor.
    let Some(owner) = app
        .try_state::<PtyHost>()
        .and_then(|host| host.output_owner(id, source))
    else {
        return;
    };
    let filtered;
    let bytes = if let Some(integration) = integration {
        let (visible, events) = integration
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .filter(id, bytes);
        for event in events {
            emit_shell_event(app, &owner, event);
        }
        filtered = visible;
        filtered.as_slice()
    } else {
        bytes
    };
    if bytes.is_empty() {
        return;
    }
    let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    emit_to_owner(
        app,
        Some(owner),
        DATA_EVENT,
        PtyData {
            id: id.to_string(),
            data,
        },
        private,
    );
}

/// Private SSH payloads fail closed if their owner disappears or delivery fails.
/// Local terminals retain their existing broadcast fallback.
fn emit_to_owner<P: Serialize + Clone>(
    app: &AppHandle,
    owner: Option<String>,
    event: &str,
    payload: P,
    private: bool,
) {
    if let Some(label) = owner {
        if app.get_webview_window(&label).is_some()
            && app.emit_to(label.as_str(), event, payload.clone()).is_ok()
        {
            return;
        }
    }
    if allow_broadcast_fallback(private) {
        let _ = app.emit(event, payload);
    }
}

fn allow_broadcast_fallback(private: bool) -> bool {
    !private
}

fn emit_shell_event(app: &AppHandle, owner: &str, event: crate::ssh_shell_integration::ShellEvent) {
    if app.get_webview_window(owner).is_some() {
        let _ = app.emit_to(owner, "ssh-shell-state", event);
    }
}

fn request_shell_snapshot(
    live: &LivePty,
    id: &str,
    source: &str,
    mut emit: impl FnMut(crate::ssh_shell_integration::ShellEvent),
) -> Result<String, String> {
    let integration = live
        .shell_integration
        .as_ref()
        .ok_or("This terminal has no opted-in shell integration")?;
    let mut writer = live.writer.lock().unwrap_or_else(|e| e.into_inner());
    let (request_id, event) = integration
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .request_with_source(id, source)?;
    emit(event);
    write_locked(
        writer.as_mut(),
        crate::ssh_shell_integration::request_keys(source)?,
    )?;
    Ok(request_id)
}

#[tauri::command]
pub fn ssh_terminal_suggestions_request(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    source: Option<String>,
) -> Result<String, String> {
    let live = host.get_for_window(&id, window.label())?;
    let integration = live
        .shell_integration
        .as_ref()
        .ok_or("This terminal has no opted-in shell integration")?
        .clone();
    let request_id = request_shell_snapshot(
        &live,
        &id,
        source.as_deref().unwrap_or("reviewed"),
        |event| emit_shell_event(&app, window.label(), event),
    )?;
    let acknowledgement = request_id.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1500));
        let Some(host) = app.try_state::<PtyHost>() else {
            return;
        };
        if !host
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(&current, &live))
        {
            return;
        }
        let event = integration
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .timeout(&id, &request_id);
        if let Some(event) = event {
            emit_shell_event(&app, &live.owner_label(), event);
        }
    });
    Ok(acknowledgement)
}

fn insert_shell_value(
    app: &AppHandle,
    window: &tauri::Window,
    host: &PtyHost,
    id: &str,
    request_id: &str,
    value: &str,
    command: bool,
) -> Result<(), String> {
    let live = host.get_for_window(id, window.label())?;
    let integration = live
        .shell_integration
        .as_ref()
        .ok_or("This terminal has no opted-in shell integration")?;
    let mut writer = live.writer.lock().unwrap_or_else(|e| e.into_inner());
    let (insertion, event) = {
        let mut integration = integration.lock().unwrap_or_else(|e| e.into_inner());
        let insertion = integration.accept(request_id, value, command)?;
        (insertion, integration.dismiss(id))
    };
    emit_shell_event(app, window.label(), event);
    write_locked(writer.as_mut(), insertion.as_bytes())
}
#[tauri::command]
pub fn ssh_terminal_suggestion_accept(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    request_id: String,
    value: String,
) -> Result<(), String> {
    insert_shell_value(&app, &window, &host, &id, &request_id, &value, false)
}
#[tauri::command]
pub fn ssh_terminal_command_insert(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
    request_id: String,
    value: String,
) -> Result<(), String> {
    insert_shell_value(&app, &window, &host, &id, &request_id, &value, true)
}
#[tauri::command]
pub fn ssh_terminal_suggestions_dismiss(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, PtyHost>,
    id: String,
) -> Result<(), String> {
    let live = host.get_for_window(&id, window.label())?;
    let integration = live
        .shell_integration
        .as_ref()
        .ok_or("This terminal has no opted-in shell integration")?;
    emit_shell_event(
        &app,
        window.label(),
        integration
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .dismiss(&id),
    );
    Ok(())
}

/// Merges what `rx` delivers into few emits, in order. The first chunk after a
/// quiet spell goes out at once (a keystroke echo); otherwise a batch waits
/// until `window` has passed since the last emit, which bounds emits to
/// 1/`window` per second, or until it holds `cap` bytes. Returns after the
/// channel closes and the last bytes are emitted.
#[cfg(any(windows, test))]
fn coalesce_chunks<F: FnMut(&[u8])>(
    rx: &std::sync::mpsc::Receiver<Vec<u8>>,
    window: Duration,
    cap: usize,
    mut emit: F,
) {
    use std::sync::mpsc::{RecvTimeoutError, TryRecvError};

    let mut last_emit: Option<Instant> = None;
    while let Ok(first) = rx.recv() {
        let mut acc = first;
        let deadline = last_emit.map(|at| at + window);
        let mut closed = false;
        while acc.len() < cap && !closed {
            // Whatever already queued is free to take.
            match rx.try_recv() {
                Ok(chunk) => {
                    acc.extend_from_slice(&chunk);
                    continue;
                }
                Err(TryRecvError::Disconnected) => {
                    closed = true;
                    continue;
                }
                Err(TryRecvError::Empty) => {}
            }
            let Some(wait) = deadline.map(|at| at.saturating_duration_since(Instant::now())) else {
                break;
            };
            if wait.is_zero() {
                break;
            }
            match rx.recv_timeout(wait) {
                Ok(chunk) => acc.extend_from_slice(&chunk),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => closed = true,
            }
        }
        emit(&acc);
        last_emit = Some(Instant::now());
        if closed {
            return;
        }
    }
}

/// Hands writes to a thread of its own, so a child that stops reading its
/// input stalls that thread and not the caller. Writes keep the order they
/// were queued in; the thread ends when this is dropped or a write fails (the
/// next write then reports the closed terminal).
struct QueuedWriter {
    tx: std::sync::mpsc::SyncSender<Vec<u8>>,
}

impl QueuedWriter {
    fn spawn(mut inner: Box<dyn Write + Send>) -> Self {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(WRITE_QUEUE_LEN);
        thread::spawn(move || {
            while let Ok(bytes) = rx.recv() {
                if inner.write_all(&bytes).and_then(|_| inner.flush()).is_err() {
                    break;
                }
            }
        });
        Self { tx }
    }
}

impl Write for QueuedWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        use std::io::{Error, ErrorKind};
        use std::sync::mpsc::TrySendError;
        match self.tx.try_send(buf.to_vec()) {
            Ok(()) => Ok(buf.len()),
            Err(TrySendError::Full(_)) => Err(Error::new(
                ErrorKind::WouldBlock,
                "terminal input is backed up",
            )),
            Err(TrySendError::Disconnected(_)) => Err(Error::new(
                ErrorKind::BrokenPipe,
                "terminal input is closed",
            )),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(unix)]
fn pty_should_flush(buffered: usize, since: Duration) -> bool {
    buffered >= READ_CHUNK || since >= PTY_COALESCE
}

#[cfg(unix)]
fn wait_readable(fd: i32, timeout: Duration) -> bool {
    if timeout.is_zero() {
        return false;
    }
    let mut pollfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
    unsafe { libc::poll(&mut pollfd, 1, ms) > 0 }
}

#[cfg(unix)]
fn foreground_label(master_fd: i32, shell_pid: u32) -> Option<String> {
    let mut pgrp: libc::pid_t = 0;
    if unsafe { libc::ioctl(master_fd, libc::TIOCGPGRP, &mut pgrp) } != 0 {
        return None;
    }
    let pid = pgrp;
    // An idle shell owns the foreground; settle that before any process lookup.
    if pid <= 0 || pid == shell_pid as i32 {
        return None;
    }
    let label = process_label(pid)?;
    if is_shell_name(&label) {
        return None;
    }
    Some(label)
}

#[cfg(unix)]
fn process_label(pid: i32) -> Option<String> {
    #[cfg(target_os = "linux")]
    if let Some(label) = proc_cmdline_label(pid) {
        return Some(label);
    }
    ps_label(pid)
}

/// Read fresh argv on every lookup: exec can change it without changing the PID,
/// and reattachment must not retain a label from a previous foreground job.
#[cfg(target_os = "linux")]
fn proc_cmdline_label(pid: i32) -> Option<String> {
    let raw = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let args = String::from_utf8_lossy(&raw).replace('\0', " ");
    command_label(args.trim())
}

#[cfg(unix)]
fn ps_label(pid: i32) -> Option<String> {
    use std::process::Command;
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let args = raw.trim();
    if args.is_empty() {
        return None;
    }
    command_label(args)
}

#[cfg(unix)]
fn command_label(args: &str) -> Option<String> {
    let parts: Vec<&str> = args.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    let exe = parts[0];
    let base = std::path::Path::new(exe)
        .file_name()
        .and_then(|name| name.to_str())?;
    if is_interpreter(base) {
        for part in parts.iter().skip(1) {
            if part.starts_with('-') {
                continue;
            }
            let name = std::path::Path::new(part)
                .file_name()
                .and_then(|name| name.to_str())?;
            if !name.starts_with('-') {
                return Some(name.to_string());
            }
        }
    }
    Some(base.to_string())
}

#[cfg(unix)]
fn is_interpreter(name: &str) -> bool {
    matches!(
        name,
        "node" | "nodejs" | "python" | "python3" | "ruby" | "deno" | "bun"
    )
}

#[cfg(unix)]
fn is_shell_name(name: &str) -> bool {
    matches!(
        name,
        "zsh" | "bash" | "sh" | "fish" | "nu" | "dash" | "ksh" | "tcsh" | "zsh5"
    )
}

#[cfg(all(test, unix))]
mod label_tests {
    use super::*;

    #[test]
    fn command_label_prefers_cli_over_interpreter() {
        assert_eq!(
            command_label("node /usr/local/bin/npm run build"),
            Some("npm".into())
        );
        assert_eq!(command_label("cargo build"), Some("cargo".into()));
    }

    #[test]
    fn shell_names_are_ignored() {
        assert!(is_shell_name("zsh"));
        assert!(!is_shell_name("npm"));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn login_args_for_common_shells() {
        assert_eq!(login_args("/bin/zsh"), &["-l"]);
        assert_eq!(login_args("/bin/bash"), &["-l"]);
        assert_eq!(login_args("/usr/bin/fish"), &["-l"]);
        assert_eq!(login_args("/usr/local/bin/nu"), &[] as &[&str]);
    }

    #[test]
    fn pty_flush_waits_for_a_full_chunk_or_the_coalesce_window() {
        assert!(!pty_should_flush(1, Duration::from_millis(1)));
        assert!(pty_should_flush(READ_CHUNK, Duration::from_millis(1)));
        assert!(pty_should_flush(1, PTY_COALESCE));
    }

    fn fake_pty(pid: u32, owner: &str) -> Arc<LivePty> {
        Arc::new(LivePty {
            _jump_config: None,
            _http_proxy: None,
            ssh_identity: None,
            shell_integration: None,
            cwd: std::path::PathBuf::from("/test"),
            completion_shell: None,
            writer: Mutex::new(Box::new(std::io::sink())),
            master_fd: -1,
            pid,
            owner: Arc::new(Mutex::new(owner.to_string())),
        })
    }

    #[test]
    fn kill_window_reaps_only_that_windows_terminals() {
        let host = PtyHost::new();
        // pid 0 keeps the reap from signalling anything real.
        host.insert("a".into(), fake_pty(0, "main"));
        host.insert("b".into(), fake_pty(0, "window-2"));
        host.kill_window("main");
        assert!(host.get("a").is_none());
        assert!(host.get("b").is_some());
    }

    #[test]
    fn a_reattached_terminal_follows_its_new_window() {
        let host = PtyHost::new();
        host.insert("a".into(), fake_pty(0, "main"));
        assert!(host.reattach("missing", "window-2", 80, 24).is_none());
        // The fake has no real fd, so the resize fails, but the handoff holds.
        assert!(host.reattach("a", "window-2", 80, 24).is_some());
        host.kill_window("main");
        assert!(host.get("a").is_some());
        host.kill_window("window-2");
        assert!(host.get("a").is_none());
    }

    #[test]
    fn join_reapers_waits_for_pending_window_reaps() {
        let host = PtyHost::new();
        let (tx, rx) = std::sync::mpsc::channel();
        host.track_reaper(thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            tx.send(()).unwrap();
        }));
        host.join_reapers();
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn remove_if_pid_ignores_a_replaced_session() {
        let host = PtyHost::new();
        host.insert("term".into(), fake_pty(42, "main"));
        assert!(host.remove_if_pid("term", 7).is_none());
        assert!(host.get("term").is_some());
        assert!(host.remove_if_pid("term", 42).is_some());
        assert!(host.get("term").is_none());
    }

    #[test]
    fn terminal_output_follows_transfer_but_not_a_replacement() {
        let host = PtyHost::new();
        let live = fake_pty(0, "main");
        let source = live.owner.clone();
        host.insert("term".into(), live.clone());
        live.set_owner("window-2");
        assert_eq!(
            host.output_owner("term", &source).as_deref(),
            Some("window-2")
        );
        host.remove_for_window("term", "main").unwrap();
        assert_eq!(
            host.output_owner("term", &source).as_deref(),
            Some("window-2")
        );
        // Even a reused/missing pid does not make a replacement the same shell.
        host.insert("term".into(), fake_pty(0, "window-3"));
        assert!(host.output_owner("term", &source).is_none());
    }
}

#[cfg(test)]
mod coalesce_tests {
    use super::*;
    use std::sync::mpsc::{channel, sync_channel};

    fn run(rx: std::sync::mpsc::Receiver<Vec<u8>>, cap: usize) -> Vec<Vec<u8>> {
        let mut emits = Vec::new();
        coalesce_chunks(&rx, PTY_COALESCE, cap, |bytes| emits.push(bytes.to_vec()));
        emits
    }

    #[test]
    fn a_queued_burst_is_one_emit_in_order() {
        let (tx, rx) = channel();
        for i in 0..20_u8 {
            tx.send(vec![i; 10]).unwrap();
        }
        drop(tx);
        let emits = run(rx, READ_CHUNK);
        assert_eq!(emits.len(), 1);
        let expected: Vec<u8> = (0..20_u8).flat_map(|i| vec![i; 10]).collect();
        assert_eq!(emits[0], expected);
    }

    #[test]
    fn bytes_before_close_are_flushed() {
        let (tx, rx) = channel();
        tx.send(b"tail".to_vec()).unwrap();
        drop(tx);
        assert_eq!(run(rx, READ_CHUNK), vec![b"tail".to_vec()]);
    }

    #[test]
    fn an_empty_closed_channel_emits_nothing() {
        let (tx, rx) = channel::<Vec<u8>>();
        drop(tx);
        assert!(run(rx, READ_CHUNK).is_empty());
    }

    #[test]
    fn a_lone_chunk_goes_out_while_the_channel_stays_open() {
        let (tx, rx) = channel();
        let (out_tx, out_rx) = channel();
        let worker = thread::spawn(move || {
            coalesce_chunks(&rx, PTY_COALESCE, READ_CHUNK, |bytes| {
                out_tx.send((Instant::now(), bytes.to_vec())).unwrap();
            });
        });
        let sent = Instant::now();
        tx.send(b"x".to_vec()).unwrap();
        let (at, bytes) = out_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(bytes, b"x");
        assert!(at.duration_since(sent) < PTY_COALESCE + Duration::from_millis(100));
        drop(tx);
        worker.join().unwrap();
    }

    #[test]
    fn the_size_cap_splits_a_large_burst() {
        let (tx, rx) = channel();
        for i in 0..100_u8 {
            tx.send(vec![i; 1000]).unwrap();
        }
        drop(tx);
        let emits = run(rx, 10_000);
        assert!(emits.len() >= 10);
        assert!(emits.iter().all(|emit| emit.len() <= 10_000 + 1000));
        let expected: Vec<u8> = (0..100_u8).flat_map(|i| vec![i; 1000]).collect();
        assert_eq!(emits.concat(), expected);
    }

    #[test]
    fn sustained_output_stays_under_the_emit_rate_bound() {
        let (tx, rx) = sync_channel(64);
        let feeder = thread::spawn(move || {
            let start = Instant::now();
            let mut sent = 0_u32;
            while start.elapsed() < Duration::from_millis(200) {
                tx.send(vec![1; 16]).unwrap();
                sent += 1;
                thread::sleep(Duration::from_millis(1));
            }
            sent
        });
        let started = Instant::now();
        let emits = run(rx, READ_CHUNK);
        let secs = started.elapsed().as_secs_f64();
        let sent = feeder.join().unwrap();
        assert_eq!(
            emits.iter().map(Vec::len).sum::<usize>(),
            sent as usize * 16
        );
        // One emit per window, plus the immediate first and the final flush.
        assert!(
            emits.len() as f64 <= secs * 125.0 + 3.0,
            "{} emits",
            emits.len()
        );
    }
}

#[cfg(test)]
mod queued_writer_tests {
    #[test]
    fn explicit_powershell_integration_uses_shared_factory_without_spawning() {
        let host = super::PtyHost::new();
        assert!(super::integration_for_spawn(&host, "raw", "main", None)
            .unwrap()
            .is_none());
        let integration = super::integration_for_spawn(&host, "fresh", "main", Some("powershell"))
            .unwrap()
            .unwrap();
        assert_eq!(integration.lock().unwrap().shell_mode(), "powershell");
        assert!(host.get("fresh").is_none());
        assert!(super::integration_for_spawn(&host, "fresh", "main", Some("unknown")).is_err());
    }
    use super::*;
    use std::sync::mpsc::channel;

    struct Capture(std::sync::mpsc::Sender<Vec<u8>>);

    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.send(buf.to_vec()).unwrap();
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn ssh_terminal_identity_isolation_and_raw_input_are_preserved() {
        let (tx, rx) = channel();
        #[cfg(windows)]
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize::default())
            .unwrap();
        let live = Arc::new(LivePty {
            _jump_config: None,
            _http_proxy: None,
            ssh_identity: Some("server:user:endpoint".into()),
            shell_integration: None,
            cwd: std::env::temp_dir(),
            completion_shell: None,
            writer: Mutex::new(Box::new(QueuedWriter::spawn(Box::new(Capture(tx))))),
            #[cfg(unix)]
            master_fd: -1,
            #[cfg(windows)]
            master: Mutex::new(pair.master),
            pid: 0,
            owner: Arc::new(Mutex::new("main".into())),
        });
        assert!(ensure_identity(Some(&live), None).is_err());
        assert!(ensure_identity(Some(&live), Some("another-server:user:endpoint")).is_err());
        assert!(ensure_identity(Some(&live), Some("server:user:endpoint")).is_ok());
        let host = PtyHost::new();
        host.insert("ssh".into(), live.clone());
        assert_eq!(
            host.conversation_list(&live.cwd)["terminals"],
            serde_json::json!([])
        );
        assert!(!host.has_working_dir(&live.cwd));
        assert!(host
            .conversation_write(&live.cwd, "ssh", "echo secret\n")
            .is_err());
        assert!(host.get_for_window("ssh", "main").is_ok());
        assert!(host.get_for_window("ssh", "other-window").is_err());
        assert!(host.remove_for_window("ssh", "other-window").is_err());
        assert!(host.get("ssh").is_some());
        // The transport never interprets arrows, shell completion, reverse
        // search, interrupt, bracketed multiline paste, Unicode or IME text.
        let bytes = "\x1b[A\x1b[B\t\x12\x03\x1b[200~echo α\n日本語\x1b[201~".as_bytes();
        live.writer.lock().unwrap().write_all(bytes).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), bytes);
        host.kill_for_window("other-window");
        assert!(host.get("ssh").is_some());
        host.kill_for_window("main");
        assert!(host.get("ssh").is_none());
    }

    #[test]
    fn ssh_output_never_falls_back_to_global_delivery() {
        assert!(!allow_broadcast_fallback(true));
        assert!(allow_broadcast_fallback(false));
    }

    #[test]
    fn shell_writer_gate_orders_requests_without_blocking_output_state() {
        struct BlockingWriter {
            entered: std::sync::mpsc::Sender<()>,
            release: std::sync::mpsc::Receiver<()>,
        }
        impl Write for BlockingWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.entered.send(()).unwrap();
                self.release.recv().unwrap();
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (entered_tx, entered_rx) = channel();
        let (release_tx, release_rx) = channel();
        #[cfg(windows)]
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize::default())
            .unwrap();
        let state = Arc::new(Mutex::new(
            crate::ssh_shell_integration::ShellIntegration::new(),
        ));
        let live = Arc::new(LivePty {
            _jump_config: None,
            _http_proxy: None,
            ssh_identity: Some("fixture".into()),
            shell_integration: Some(state.clone()),
            cwd: std::env::temp_dir(),
            completion_shell: None,
            writer: Mutex::new(Box::new(BlockingWriter {
                entered: entered_tx,
                release: release_rx,
            })),
            #[cfg(unix)]
            master_fd: -1,
            #[cfg(windows)]
            master: Mutex::new(pair.master),
            pid: 0,
            owner: Arc::new(Mutex::new("main".into())),
        });
        let input = live.clone();
        let writing = thread::spawn(move || write_shell_input(&input, "fixture", "x", |_| {}));
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        // Output state must remain available even when the child stops reading.
        assert!(state.try_lock().is_ok());
        let request = live.clone();
        let (done_tx, done_rx) = channel();
        let requesting = thread::spawn(move || {
            let result = request_shell_snapshot(&request, "fixture", "reviewed", |_| {});
            done_tx.send(()).unwrap();
            result
        });
        assert!(
            done_rx.recv_timeout(Duration::from_millis(50)).is_err(),
            "request may not race ahead of raw input enqueue"
        );
        release_tx.send(()).unwrap();
        writing.join().unwrap().unwrap();
        assert!(requesting.join().unwrap().is_err());
    }

    #[test]
    fn private_key_generation_refuses_existing_key_or_public_file() {
        let root = std::env::temp_dir().join(format!("bycoda-key-path-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let key = root.join("test_key");
        assert!(validate_new_key_path(&key).is_ok());
        assert!(validate_new_key_path(std::path::Path::new("relative_key")).is_err());
        std::fs::write(&key, b"test-only existing file").unwrap();
        assert!(validate_new_key_path(&key).is_err());
        std::fs::remove_file(&key).unwrap();
        let public = root.join("test_key.pub");
        std::fs::write(&public, b"test-only public metadata").unwrap();
        assert!(validate_new_key_path(&key).is_err());
        std::fs::remove_file(&public).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn conversation_terminal_access_is_project_scoped_and_writes_exact_bytes() {
        let host = PtyHost::new();
        let root = std::env::temp_dir().join("bycoda-conversation-pty-test");
        let (tx, rx) = channel();
        #[cfg(windows)]
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        host.insert(
            "project-terminal".into(),
            Arc::new(LivePty {
                _jump_config: None,
                _http_proxy: None,
                ssh_identity: None,
                shell_integration: None,
                cwd: root.join("subdir"),
                completion_shell: None,
                writer: Mutex::new(Box::new(Capture(tx))),
                #[cfg(unix)]
                master_fd: -1,
                #[cfg(windows)]
                master: Mutex::new(pair.master),
                pid: 0,
                owner: Arc::new(Mutex::new("main".into())),
            }),
        );
        assert_eq!(
            host.conversation_list(&root)["terminals"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            host.conversation_list(&root.with_extension("other"))["terminals"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert!(host
            .conversation_write(&root.with_extension("other"), "project-terminal", "pwd\n")
            .is_err());
        assert!(host.conversation_write(&root, "missing", "pwd\n").is_err());
        assert!(host
            .conversation_write(&root, "project-terminal", "")
            .is_err());
        host.conversation_write(&root, "project-terminal", "pwd\n\u{3}")
            .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            b"pwd\n\x03"
        );
    }

    #[test]
    fn queued_writes_reach_the_terminal_in_order() {
        let (tx, rx) = channel();
        let mut writer = QueuedWriter::spawn(Box::new(Capture(tx)));
        for i in 0..50_u8 {
            writer.write_all(&[i]).unwrap();
        }
        for i in 0..50_u8 {
            assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), vec![i]);
        }
    }

    #[test]
    fn a_stuck_child_never_blocks_the_caller() {
        struct Stuck {
            entered: Option<std::sync::mpsc::Sender<()>>,
            release: std::sync::mpsc::Receiver<()>,
        }
        impl Write for Stuck {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if let Some(entered) = self.entered.take() {
                    let _ = entered.send(());
                }
                self.release.recv().map_err(|_| {
                    std::io::Error::new(std::io::ErrorKind::BrokenPipe, "fixture released")
                })?;
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (entered_tx, entered_rx) = channel();
        let (release_tx, release_rx) = channel();
        let mut writer = QueuedWriter::spawn(Box::new(Stuck {
            entered: Some(entered_tx),
            release: release_rx,
        }));
        writer.write_all(b"first").unwrap();
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        // The worker is now blocked until this scope releases it, independently
        // of scheduler load or how a platform implements timed sleeps.
        let started = Instant::now();
        for _ in 0..WRITE_QUEUE_LEN {
            writer.write_all(b"x").unwrap();
        }
        let error = writer.write_all(b"overflow").unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(error.kind(), std::io::ErrorKind::WouldBlock);
        drop(release_tx);
    }
}
