//! Owner-approved one-off commands on saved SSH targets. Manual terminals stay private.
//! Receipts are memory-only and never replayed after restart. No trust or credential import.
use crate::{
    remote::{NativeServiceChannel, NativeServiceReply},
    ssh_group_defaults::RemoteShellKind,
    ssh_security::SshEndpoint,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const OUTPUT_LIMIT: usize = 256 * 1024;
const MAX_JOBS: usize = 64;
const MAX_ACTIVE: usize = 8;
// Longer than the maximum command and transport deadlines; never evict active jobs.
const SETTLED_TTL: Duration = Duration::from_secs(10 * 60);
static SPAWN_GATE: Mutex<()> = Mutex::new(());
static STOPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(super) fn shutdown() {
    // Spawn and shutdown share this lock; no child can start after retirement.
    let _gate = SPAWN_GATE.lock().unwrap_or_else(|e| e.into_inner());
    STOPPED.store(true, std::sync::atomic::Ordering::Release);
}
/// Child has one owner even if thread creation or supervision unwinds.
struct OwnedChild(std::process::Child);
impl std::ops::Deref for OwnedChild {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for OwnedChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            crate::harness::terminate_all(&[self.0.id()]);
            let _ = self.0.kill();
            let _ = self.0.try_wait();
        }
    }
}
#[derive(Clone, Hash, PartialEq, Eq)]
struct Key {
    environment: String,
    source: SshSource,
    request: String,
}
#[derive(Clone, Hash, PartialEq, Eq)]
enum SshSource {
    Session { project: String, session: String },
    AssistantThread { thread: String },
}
struct Job {
    issuer: Arc<NativeServiceChannel>,
    server: String,
    signature: String,
    endpoint_digest: String,
    state: &'static str,
    exit_code: Option<i32>,
    reason: Option<&'static str>,
    remote_unknown: bool,
    cancel: bool,
    output: Vec<u8>,
    stderr: Vec<bool>,
    pending_stdout: Vec<u8>,
    pending_stderr: Vec<u8>,
    output_full: bool,
    total: u64,
    settled_at: Option<Instant>,
}
impl Job {
    fn authorize_issuer(&self, issuer: &Arc<NativeServiceChannel>) -> Result<(), String> {
        if !Arc::ptr_eq(&self.issuer, issuer) || !self.issuer.is_current() {
            return Err("SSH execution belongs to a retired or different native issuer".into());
        }
        Ok(())
    }
    fn replay(
        &self,
        issuer: &Arc<NativeServiceChannel>,
        signature: &str,
        digest: &str,
    ) -> Result<(), String> {
        self.authorize_issuer(issuer)?;
        if self.signature != signature || self.endpoint_digest != digest {
            return Err(
                "SSH requestId already used with different command or target configuration".into(),
            );
        }
        Ok(())
    }
    fn append(&mut self, bytes: &[u8], stderr: bool) {
        self.total = self.total.saturating_add(bytes.len() as u64);
        let pending = if stderr { &mut self.pending_stderr } else { &mut self.pending_stdout };
        pending.extend_from_slice(bytes);
        let mut remaining_bytes = pending.as_slice();
        let complete = loop {
            match std::str::from_utf8(remaining_bytes) {
                Ok(_) => break pending.len(),
                Err(error) => match error.error_len() {
                    Some(len) => remaining_bytes = &remaining_bytes[error.valid_up_to() + len..],
                    None => break pending.len() - remaining_bytes.len() + error.valid_up_to(),
                },
            }
        };
        let ready: Vec<u8> = pending.drain(..complete).collect();
        self.retain_output(&ready, stderr);
    }
    fn retain_output(&mut self, bytes: &[u8], stderr: bool) {
        if self.output_full { return; }
        let remaining = OUTPUT_LIMIT.saturating_sub(self.output.len());
        let mut take = bytes.len().min(remaining);
        if take < bytes.len() {
            self.output_full = true;
            while take > 0 && !complete_utf8_prefix(&bytes[..take]) { take -= 1; }
        }
        self.output
            .extend_from_slice(&bytes[..take]);
        self.stderr
            .extend(std::iter::repeat_n(stderr, take));
    }
    fn flush_pending(&mut self) {
        let stdout = std::mem::take(&mut self.pending_stdout);
        let stderr = std::mem::take(&mut self.pending_stderr);
        self.retain_output(&stdout, false);
        self.retain_output(&stderr, true);
    }
    fn active(&self) -> bool {
        matches!(self.state, "pendingApproval" | "running")
    }
    fn result(&self, request: &str, offset: u64, max_bytes: usize) -> Value {
        let start = usize::try_from(offset)
            .unwrap_or(usize::MAX)
            .min(self.output.len());
        let target = start.saturating_add(max_bytes).min(self.output.len());
        // Keep each stream's UTF-8 sequences intact even when reads from stdout
        // and stderr interleave. Incomplete live output waits for the next read.
        let boundary = |end: usize| {
            if end == self.output.len() && !self.active() {
                // A process may end with genuinely malformed or truncated bytes.
                return true;
            }
            let mut streams = [Vec::new(), Vec::new(), Vec::new()];
            for i in start..end {
                streams[0].push(self.output[i]);
                streams[if self.stderr[i] { 2 } else { 1 }].push(self.output[i]);
            }
            streams.iter().all(|bytes| complete_utf8_prefix(bytes))
        };
        let end = (target..=target.saturating_add(12).min(self.output.len()))
            .find(|end| boundary(*end))
            .or_else(|| (start..target).rev().find(|end| boundary(*end)))
            .unwrap_or(start);
        let stdout: Vec<u8> = (start..end)
            .filter(|i| !self.stderr[*i])
            .map(|i| self.output[i])
            .collect();
        let stderr: Vec<u8> = (start..end)
            .filter(|i| self.stderr[*i])
            .map(|i| self.output[i])
            .collect();
        json!({"requestId":request,"serverId":self.server,"state":self.state,"exitCode":self.exit_code,
            "reason":self.reason,"remoteOutcomeUnknown":self.remote_unknown,"cancelRequested":self.cancel,
            "output":String::from_utf8_lossy(&self.output[start..end]),"cursor":end,"nextOffset":end,
            "stdout":String::from_utf8_lossy(&stdout),"stderr":String::from_utf8_lossy(&stderr),
            "hasMore":end<self.output.len(),"truncated":self.total>self.output.len() as u64,
            "totalBytes":self.total,"retainedBytes":self.output.len()})
    }
}
fn complete_utf8_prefix(mut bytes: &[u8]) -> bool {
    while !bytes.is_empty() {
        match std::str::from_utf8(bytes) {
            Ok(_) => return true,
            Err(error) => match error.error_len() {
                Some(len) => bytes = &bytes[error.valid_up_to() + len..],
                None => return false,
            },
        }
    }
    true
}
type Jobs = HashMap<Key, Arc<Mutex<Job>>>;
type ConversationKey = (String, SshSource);
/// Native dialogs cannot be dismissed programmatically, so a slot is held until the
/// dialog reports back, even after its request has already hit deadline or cancel.
struct ApprovalSlot(ConversationKey);
fn approval_slots() -> &'static Mutex<HashSet<ConversationKey>> {
    static SLOTS: OnceLock<Mutex<HashSet<ConversationKey>>> = OnceLock::new();
    SLOTS.get_or_init(Mutex::default)
}
impl ApprovalSlot {
    fn try_take(conversation: &ConversationKey) -> Option<Self> {
        let mut open = approval_slots().lock().unwrap_or_else(|e| e.into_inner());
        open.insert(conversation.clone())
            .then(|| Self(conversation.clone()))
    }
}
impl Drop for ApprovalSlot {
    fn drop(&mut self) {
        approval_slots()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}
fn evict_expired(jobs: &mut Jobs, now: Instant) {
    jobs.retain(|_, job| {
        // A poisoned job has unknown state and must not be evicted.
        job.lock()
            .map(|job| {
                job.active()
                    || job.remote_unknown
                    || job.settled_at.is_none_or(|settled| {
                        now.checked_duration_since(settled).unwrap_or_default() < SETTLED_TTL
                    })
            })
            .unwrap_or(true)
    });
}
fn jobs() -> &'static Mutex<Jobs> {
    static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();
    JOBS.get_or_init(Mutex::default)
}
fn text(value: &Value, field: &str, limit: usize) -> Result<String, String> {
    value[field]
        .as_str()
        .filter(|v| !v.is_empty() && v.chars().count() <= limit && !v.contains('\0'))
        .map(str::to_owned)
        .ok_or_else(|| format!("Invalid SSH {field}"))
}
fn request_id(value: &Value) -> Result<String, String> {
    let id = text(value, "requestId", 100)?;
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid SSH requestId".into());
    }
    Ok(id)
}
fn exact(input: &Value, allowed: &[&str]) -> Result<(), String> {
    if input
        .as_object()
        .is_none_or(|v| v.keys().any(|key| !allowed.contains(&key.as_str())))
    {
        return Err("Unsupported SSH execution field".into());
    }
    Ok(())
}
fn number(input: &Value, key: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
    match input.get(key) {
        None => Ok(default),
        Some(v) => v
            .as_u64()
            .filter(|n| (min..=max).contains(n))
            .ok_or_else(|| format!("Invalid SSH {key}")),
    }
}
fn key(request: &Value) -> Result<Key, String> {
    let source = match (request.get("sessionId"), request.get("threadId")) {
        (Some(_), None) => SshSource::Session { project: text(request, "cwd", 32768)?, session: text(request, "sessionId", 300)? },
        (None, Some(_)) if request.get("cwd").is_none() && request.get("projectId").is_none() => SshSource::AssistantThread { thread: text(request, "threadId", 300)? },
        _ => return Err("Exactly one SSH source is required".into()),
    };
    Ok(Key {
        environment: text(request, "environmentId", 300)?,
        source,
        request: request_id(&request["input"])?,
    })
}
fn digest(endpoint: &SshEndpoint) -> Result<String, String> {
    let endpoint = serde_json::to_value(endpoint).map_err(|_| "Invalid SSH endpoint")?;
    // Runtime configuration is skipped by SshEndpoint serialization; include it explicitly.
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&endpoint).map_err(|_| "Invalid SSH endpoint")?)
    ))
}
fn endpoint_digest(endpoint: &SshEndpoint) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([
                digest(endpoint)?,
                endpoint.runtime_configuration.as_ref().map(|c| &c.digest)
            ]))
            .map_err(|_| "Invalid SSH configuration")?
        )
    ))
}
fn check(
    request: &Value,
    issuer: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<(), String> {
    taken.check()?;
    if !taken.is_issued_by(issuer)
        || !issuer.is_current()
        || request["environmentId"].as_str() != Some(issuer.environment_id())
    {
        return Err("SSH execution issuer changed".into());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_millis() as u64;
    if request["deadline"]
        .as_u64()
        .is_none_or(|deadline| deadline <= now)
    {
        return Err("SSH execution request expired".into());
    }
    Ok(())
}
fn authorize(
    request: &Value,
    issuer: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<(), String> {
    check(request, issuer, taken)?;
    if STOPPED.load(std::sync::atomic::Ordering::Acquire) {
        return Err("SSH execution service is shutting down".into());
    }
    let authorized = issuer.project(
        "conversation.desktop.authorize",
        json!({"id":request["id"],"action":request["action"]}),
        |value| {
            Ok(value
                .as_object()
                .is_some_and(|v| v.len() == 1 && v.get("authorized") == Some(&Value::Bool(true))))
        },
    )?;
    if !authorized {
        return Err("Original SSH operation authority was revoked".into());
    }
    check(request, issuer, taken)
}
fn literal(value: &str) -> String {
    // Show exact text without newline, bidi, or control characters changing dialog layout.
    let mut out = String::from("\"");
    for c in value.chars() {
        if c.is_control()
            || matches!(c,'\u{061c}'|'\u{200e}'|'\u{200f}'|'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}')
        {
            out.push_str(&format!("\\u{{{:x}}}", c as u32));
        } else {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                _ => out.push(c),
            }
        }
    }
    out.push('"');
    out
}
fn prepare(endpoint: &SshEndpoint, script: &str) -> Result<(Command, Vec<u8>), String> {
    let shell = endpoint
        .runtime_configuration
        .as_ref()
        .and_then(|c| c.shell_kind)
        .unwrap_or(RemoteShellKind::Posix);
    let mut args = crate::ssh_security::connection_args(endpoint)?;
    args.extend([
        "-o".into(),
        "BatchMode=yes".into(),
        "-T".into(),
        "--".into(),
        endpoint.host.clone(),
        match shell {
            RemoteShellKind::Posix => "sh -s",
            RemoteShellKind::Powershell => "pwsh -NoLogo -NoProfile -NonInteractive -Command -",
        }
        .into(),
    ]);
    let mut input = endpoint
        .runtime_configuration
        .as_ref()
        .map(|c| crate::ssh_environment::prologue(&c.environment, shell))
        .transpose()?
        .unwrap_or_default();
    input.push_str(script);
    input.push('\n');
    let mut command = Command::new("ssh");
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env("PATH", crate::harness::gui_search_path());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    crate::hide_window_console(&mut command);
    Ok((command, input.into_bytes()))
}
#[cfg(unix)]
fn nonblocking<T: std::os::fd::AsRawFd>(pipe: &T) -> bool {
    let fd = pipe.as_raw_fd();
    // SAFETY: fd belongs to the live pipe, and fcntl does not take ownership.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        flags >= 0 && libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) == 0
    }
}
#[cfg(windows)]
fn nonblocking<T>(_pipe: &T) -> bool { true }

fn drain(mut source: impl Read, job: Arc<Mutex<Job>>, stderr: bool, stop: Arc<std::sync::atomic::AtomicBool>) -> bool {
    let mut buffer = [0; 8192];
    loop {
        if stop.load(std::sync::atomic::Ordering::Acquire) { return false; }
        match source.read(&mut buffer) {
            Ok(0) => return true,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if stop.load(std::sync::atomic::Ordering::Acquire) { return false; }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return false,
            Ok(n) => {
                if let Ok(mut job) = job.lock() {
                    if !job.active() { return false; }
                    job.append(&buffer[..n], stderr);
                } else {
                    return false;
                }
            }
        }
    }
}

fn supervise_owned(
    mut child: OwnedChild,
    job: Arc<Mutex<Job>>,
    stdin: Vec<u8>,
    timeout: Duration,
    current: impl Fn() -> bool,
    resources: Option<Box<dyn Send>>,
) {
    let output = child.stdout.take();
    let error = child.stderr.take();
    let input = child.stdin.take();
    if output.as_ref().is_some_and(|pipe| !nonblocking(pipe))
        || error.as_ref().is_some_and(|pipe| !nonblocking(pipe))
        || input.as_ref().is_some_and(|pipe| !nonblocking(pipe)) {
        if let Ok(mut job) = job.lock() {
            job.state = "unknown";
            job.reason = Some("command_io_remote_outcome_unknown");
            job.remote_unknown = true;
            job.settled_at = Some(Instant::now());
        }
        return;
    }
    let stop_io = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let out_job = job.clone();
    let out_stop = stop_io.clone();
    let out =
        std::thread::spawn(move || output.is_some_and(|source| drain(source, out_job, false, out_stop)));
    let err_job = job.clone();
    let err_stop = stop_io.clone();
    let err = std::thread::spawn(move || error.is_some_and(|source| drain(source, err_job, true, err_stop)));
    let write_stop = stop_io.clone();
    let write = std::thread::spawn(move || input.is_some_and(|mut input| {
        let mut bytes = stdin.as_slice();
        while !bytes.is_empty() {
            if write_stop.load(std::sync::atomic::Ordering::Acquire) { return false; }
            match input.write(bytes) {
                Ok(0) => return false,
                Ok(n) => bytes = &bytes[n..],
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if write_stop.load(std::sync::atomic::Ordering::Acquire) { return false; }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => return false,
            }
        }
        true
    }));
    let started = Instant::now();
    let (mut state, code, mut reason, mut unknown) = loop {
        let cancelled = job.lock().map(|j| j.cancel).unwrap_or(true);
        let cause = if cancelled {
            Some("cancel_requested_remote_outcome_unknown")
        } else if !current() {
            Some("issuer_retired_remote_outcome_unknown")
        } else if started.elapsed() >= timeout {
            Some("timeout_remote_outcome_unknown")
        } else {
            None
        };
        if let Some(cause) = cause {
            crate::harness::terminate_all(&[child.id()]);
            let _ = child.kill();
            break (
                if cancelled { "cancelled" } else { "unknown" },
                None,
                Some(cause),
                true,
            );
        }
        match child.try_wait() {
            Ok(Some(exit)) => {
                let code = exit.code();
                break (
                    if code.is_none() || code == Some(255) {
                        "unknown"
                    } else {
                        "exited"
                    },
                    code,
                    if code.is_none() || code == Some(255) {
                        Some("ssh_transport_or_signal_remote_outcome_unknown")
                    } else {
                        None
                    },
                    code.is_none() || code == Some(255),
                );
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => {
                crate::harness::terminate_all(&[child.id()]);
                let _ = child.kill();
                break ("unknown", None, Some("process_observation_failed"), true);
            }
        }
    };
    // A proxy child may retain inherited pipes. Never block settlement indefinitely.
    let until = Instant::now() + Duration::from_secs(3);
    while Instant::now() < until
        && (!out.is_finished() || !err.is_finished() || !write.is_finished())
    {
        std::thread::sleep(Duration::from_millis(20));
    }
    if !out.is_finished() || !err.is_finished() || !write.is_finished() {
        stop_io.store(true, std::sync::atomic::Ordering::Release);
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            for handle in [&out, &err, &write] {
                // SAFETY: the join handle owns a live thread handle for this call.
                unsafe { windows_sys::Win32::System::IO::CancelSynchronousIo(handle.as_raw_handle() as _); }
            }
        }
        let cancel_until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < cancel_until && (!out.is_finished() || !err.is_finished() || !write.is_finished()) {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    let all_finished = out.is_finished() && err.is_finished() && write.is_finished();
    let io_ok = if all_finished {
        let out_ok = out.join().unwrap_or(false);
        let err_ok = err.join().unwrap_or(false);
        let write_ok = write.join().unwrap_or(false);
        out_ok && err_ok && write_ok
    } else {
        // The retirement owner keeps the proxy and jump configuration alive
        // until every inherited pipe operation has actually returned.
        std::thread::spawn(move || {
            let _resources = resources;
            let _ = out.join();
            let _ = err.join();
            let _ = write.join();
        });
        false
    };
    if !io_ok {
        state = "unknown";
        reason = Some("command_io_remote_outcome_unknown");
        unknown = true;
    }
    // try_wait reaps a completed child; a failed kill remains an explicitly unknown outcome.
    if child.try_wait().ok().flatten().is_none() {
        state = "unknown";
        reason = Some("local_process_exit_unconfirmed");
        unknown = true;
    }
    if let Ok(mut job) = job.lock() {
        job.flush_pending();
        job.state = state;
        job.exit_code = code;
        job.reason = reason;
        job.remote_unknown = unknown;
        job.settled_at = Some(Instant::now());
    }
}

#[cfg(test)]
fn supervise(child: OwnedChild, job: Arc<Mutex<Job>>, stdin: Vec<u8>, timeout: Duration, current: impl Fn() -> bool) {
    supervise_owned(child, job, stdin, timeout, current, None);
}

pub(super) fn call(
    app: &AppHandle,
    request: &Value,
    issuer: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    check(request, issuer, taken)?;
    let input = &request["input"];
    let key = key(request)?;
    let room = match &key.source {
        SshSource::AssistantThread { thread } => Some(crate::control::validate_assistant_source(app, thread, &key.environment)?),
        _ => None,
    };
    let check_room = || -> Result<(), String> {
        if let (Some((window, owner)), SshSource::AssistantThread { thread }) = (&room, &key.source) {
            let (current, issuer) = crate::control::validate_assistant_source(app, thread, &key.environment)?;
            if current != *window || !Arc::ptr_eq(owner, &issuer) { return Err("Assistant Room source changed".into()); }
        }
        Ok(())
    };
    let authorize_current = || -> Result<(), String> {
        check_room()?;
        authorize(request, issuer, taken)?;
        check_room()
    };
    if room.is_some() { authorize_current()?; }
    let action = request["action"].as_str().ok_or("SSH action required")?;
    if action != "servers.ssh.execute" {
        exact(
            input,
            if action == "servers.ssh.status" {
                &["requestId", "offset", "maxBytes"]
            } else {
                &["requestId"]
            },
        )?;
        let job = jobs()
            .lock()
            .map_err(|_| "SSH executions unavailable")?
            .get(&key)
            .cloned()
            .ok_or("SSH execution not found; restart clears receipts and never replays commands")?;
        job.lock()
            .map_err(|_| "SSH execution unavailable")?
            .authorize_issuer(issuer)?;
        if action == "servers.ssh.cancel" {
            authorize_current()?;
            let mut job = job.lock().map_err(|_| "SSH execution unavailable")?;
            if job.active() {
                job.cancel = true;
            }
            return Ok(job.result(&key.request, 0, 16384));
        }
        let offset = number(input, "offset", 0, 0, u64::MAX)?;
        let max = number(input, "maxBytes", 16384, 1, 65536)? as usize;
        return Ok(job.lock().map_err(|_| "SSH execution unavailable")?.result(
            &key.request,
            offset,
            max,
        ));
    }
    exact(input, &["id", "requestId", "command", "timeoutSeconds"])?;
    let server = text(input, "id", 300)?;
    let script = text(input, "command", 16384)?;
    if script.trim().is_empty() {
        return Err("SSH command is empty".into());
    }
    let timeout = number(input, "timeoutSeconds", 60, 1, 300)?;
    let signature = serde_json::to_string(&json!([server, script, timeout]))
        .map_err(|_| "Invalid SSH command")?;
    let endpoint = crate::ssh_security::prepare_endpoint(
        crate::server_inventory::resolve_ssh_endpoint(app, &server)?,
    )?;
    let reviewed_digest = endpoint_digest(&endpoint)?;
    let (mut command, stdin) = prepare(&endpoint, &script)?;
    let job = {
        let mut jobs = jobs().lock().map_err(|_| "SSH executions unavailable")?;
        evict_expired(&mut jobs, Instant::now());
        if let Some(job) = jobs.get(&key) {
            let job = job.lock().map_err(|_| "SSH execution unavailable")?;
            job.replay(issuer, &signature, &reviewed_digest)?;
            return Ok(job.result(&key.request, 0, 16384));
        }
        if jobs.len() >= MAX_JOBS
            || jobs
                .values()
                .filter(|j| j.lock().map(|j| j.active()).unwrap_or(true))
                .count()
                >= MAX_ACTIVE
        {
            return Err(
                "SSH execution capacity reached; existing receipts are retained to prevent replay"
                    .into(),
            );
        }
        let job = Arc::new(Mutex::new(Job {
            issuer: issuer.clone(),
            server: server.clone(),
            signature,
            endpoint_digest: reviewed_digest.clone(),
            state: "pendingApproval",
            exit_code: None,
            reason: None,
            remote_unknown: false,
            cancel: false,
            output: Vec::new(),
            stderr: Vec::new(),
            pending_stdout: Vec::new(),
            pending_stderr: Vec::new(),
            output_full: false,
            total: 0,
            settled_at: None,
        }));
        jobs.insert(key.clone(), job.clone());
        job
    };
    let conversation: ConversationKey = (key.environment.clone(), key.source.clone());
    let start = (|| -> Result<(), String> {
        authorize_current()?;
        check(request, issuer, taken)?;
        check_room()?;
        let shell = endpoint
            .runtime_configuration
            .as_ref()
            .and_then(|c| c.shell_kind)
            .unwrap_or(RemoteShellKind::Posix);
        let source = match &key.source { SshSource::Session { project, session } => format!("Project: {}\nSession: {}", literal(project), literal(session)), SshSource::AssistantThread { thread } => format!("Assistant Room: {}", literal(thread)) };
        let message=format!("Run this exact command on saved SSH server?\n\nServer ID: {}\nTarget: {}@{}:{}\n{}\nShell: {:?}\nTimeout: {} seconds\n\nCommand (escaped literal):\n{}\n\nThis can change remote files and services. Command output will be disclosed to the calling AI conversation. Cancellation stops local SSH; remote work may continue.",literal(&server),literal(endpoint.user.as_deref().unwrap_or("(default)")),literal(&endpoint.host),endpoint.port,source,shell,timeout,literal(&script));
        // At most one open approval dialog per conversation; others queue here.
        let slot = loop {
            if job.lock().map_err(|_| "SSH execution unavailable")?.cancel {
                break None;
            }
            check(request, issuer, taken)?;
            check_room()?;
            if let Some(slot) = ApprovalSlot::try_take(&conversation) {
                break Some(slot);
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let approved = match slot {
            None => false,
            Some(slot) => {
                let (approval_tx, approval_rx) = std::sync::mpsc::sync_channel(1);
                app
                    .dialog()
                    .message(message)
                    .title("bycoda — SSH command approval")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Run this exact command".into(),
                        "Cancel".into(),
                    ))
                    .show(move |approved| {
                        // A late answer after the request ended has no receiver and starts nothing.
                        let _ = approval_tx.send(approved);
                        drop(slot);
                    });
                loop {
                    if job.lock().map_err(|_| "SSH execution unavailable")?.cancel {
                        break false;
                    }
                    check(request, issuer, taken)?;
                    check_room()?;
                    match approval_rx.recv_timeout(Duration::from_millis(100)) {
                        Ok(approved) => break approved,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Err("SSH approval unavailable".into()),
                    }
                }
            }
        };
        if !approved {
            let mut j = job.lock().map_err(|_| "SSH execution unavailable")?;
            j.state = "cancelled";
            j.reason = Some(if j.cancel { "cancelled_before_start" } else { "owner_declined" });
            j.settled_at = Some(Instant::now());
            return Ok(());
        }
        authorize_current()?;
        if endpoint_digest(&crate::server_inventory::resolve_ssh_endpoint(
            app, &server,
        )?)? != reviewed_digest
        {
            return Err(
                "SSH target configuration changed; use a new requestId and review again".into(),
            );
        }
        check(request, issuer, taken)?;
        check_room()?;
        // Anonymous proxy only. No credentials are read, imported, or borrowed from a terminal.
        let proxy = crate::ssh_security::start_http_proxy_authorized(&endpoint, None)?;
        if let Some(proxy) = &proxy {
            command.envs(proxy.environment());
        }
        authorize_current()?;
        let host = app
            .try_state::<crate::pty::PtyHost>()
            .ok_or("Native SSH process owner unavailable")?;
        // Keep shutdown excluded until the new supervisor is registered for reaping.
        let _spawn_gate = SPAWN_GATE
            .lock()
            .map_err(|_| "SSH spawn admission unavailable")?;
        let mut state = job.lock().map_err(|_| "SSH execution unavailable")?;
        if state.cancel {
            state.state = "cancelled";
            state.reason = Some("cancelled_before_start");
            state.settled_at = Some(Instant::now());
            return Ok(());
        }
        let child = OwnedChild(issuer.admit(|| {
            if STOPPED.load(std::sync::atomic::Ordering::Acquire) {
                return Err("SSH execution service is shutting down".into());
            }
            command
                .spawn()
                .map_err(|_| "SSH process could not start".to_owned())
        })?);
        state.state = "running";
        drop(state);
        let job = job.clone();
        let issuer = issuer.clone();
        // Supervisor owns process, endpoint temporary jump config, and all drains until settlement.
        let supervisor = std::thread::spawn(move || {
            supervise_owned(child, job, stdin, Duration::from_secs(timeout), || {
                !STOPPED.load(std::sync::atomic::Ordering::Acquire) && issuer.is_current()
            }, Some(Box::new((endpoint, proxy))));
        });
        host.track_reaper(supervisor);
        Ok(())
    })();
    if let Err(error) = start {
        if let Ok(mut j) = job.lock() {
            if j.state == "pendingApproval" {
                j.state = "failed";
                j.reason = Some("approval_or_start_failed");
                j.settled_at = Some(Instant::now());
            }
        }
        return Err(error);
    }
    let result =
        job.lock()
            .map_err(|_| "SSH execution unavailable")?
            .result(&key.request, 0, 16384);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_job() -> Job {
        Job {
            issuer: NativeServiceChannel::for_test(),
            server: "s".into(),
            signature: "command".into(),
            endpoint_digest: "digest".into(),
            state: "running",
            exit_code: None,
            reason: None,
            remote_unknown: false,
            cancel: false,
            output: vec![],
            stderr: vec![],
            pending_stdout: vec![],
            pending_stderr: vec![],
            output_full: false,
            total: 0,
            settled_at: None,
        }
    }
    #[test]
    fn replay_is_exact_and_replacement_issuer_cannot_adopt_results() {
        let job = fixture_job();
        assert!(job.replay(&job.issuer, "command", "digest").is_ok());
        assert!(job.replay(&job.issuer, "changed", "digest").is_err());
        assert!(job.replay(&job.issuer, "command", "changed").is_err());
        assert!(job
            .replay(&NativeServiceChannel::for_test(), "command", "digest")
            .is_err());
    }
    #[test]
    fn settled_receipts_expire_without_evicting_active_jobs() {
        let now = Instant::now();
        let make_key = |request: &str| Key {
            environment: "host".into(),
            source: SshSource::Session { project: "project".into(), session: "session".into() },
            request: request.into(),
        };
        let mut settled = fixture_job();
        settled.state = "failed";
        settled.settled_at = Some(now);
        let issuer = settled.issuer.clone();
        let mut jobs = Jobs::new();
        jobs.insert(make_key("settled"), Arc::new(Mutex::new(settled)));
        jobs.insert(make_key("active"), Arc::new(Mutex::new(fixture_job())));
        let mut unknown = fixture_job();
        unknown.state = "unknown";
        unknown.remote_unknown = true;
        unknown.settled_at = Some(now);
        jobs.insert(make_key("unknown"), Arc::new(Mutex::new(unknown)));
        evict_expired(&mut jobs, now + SETTLED_TTL - Duration::from_nanos(1));
        assert!(jobs[&make_key("settled")]
            .lock()
            .unwrap()
            .replay(&issuer, "command", "digest")
            .is_ok());
        evict_expired(&mut jobs, now + SETTLED_TTL);
        assert!(!jobs.contains_key(&make_key("settled")));
        assert!(jobs.contains_key(&make_key("active")));
        assert!(jobs.contains_key(&make_key("unknown")));
    }
    #[test]
    fn receipt_key_separates_project_session_and_environment() {
        let base = json!({"environmentId":"host","cwd":"project","sessionId":"session","input":{"requestId":"r"}});
        let original = key(&base).unwrap();
        for field in ["environmentId", "cwd", "sessionId"] {
            let mut other = base.clone();
            other[field] = json!("other");
            assert!(original != key(&other).unwrap());
        }
        let room = json!({"environmentId":"host","threadId":"session","input":{"requestId":"r"}});
        assert!(original != key(&room).unwrap());
        let mut other_thread = room.clone();
        other_thread["threadId"] = json!("other");
        assert!(key(&room).unwrap() != key(&other_thread).unwrap());
        let mut forged = room.clone();
        forged["sessionId"] = json!("session");
        assert!(key(&forged).is_err());
    }
    #[test]
    fn output_preserves_stream_identity() {
        let mut job = fixture_job();
        job.append(b"out", false);
        job.append(b"error", true);
        let page = job.result("r", 0, 99);
        assert_eq!(page["output"], "outerror");
        assert_eq!(page["stdout"], "out");
        assert_eq!(page["stderr"], "error");
    }
    #[test]
    fn owned_child() {
        match std::env::var("BYCODA_SSH_EXEC_TEST_CHILD").ok().as_deref() {
            Some("exit255") => std::process::exit(255),
            Some("sleep") => std::thread::sleep(Duration::from_secs(30)),
            Some("output") => {
                println!("owned-output");
                eprintln!("owned-error");
            }
            _ => {}
        }
    }
    fn child(mode: &str) -> OwnedChild {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "conversation_tools_bridge::ssh_execution::tests::owned_child",
                "--nocapture",
            ])
            .env("BYCODA_SSH_EXEC_TEST_CHILD", mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::hide_window_console(&mut command);
        OwnedChild(command.spawn().unwrap())
    }
    #[test]
    fn owned_process_output_and_exit255_are_observed() {
        let job = Arc::new(Mutex::new(fixture_job()));
        supervise(
            child("output"),
            job.clone(),
            vec![],
            Duration::from_secs(5),
            || true,
        );
        {
            let j = job.lock().unwrap();
            assert_eq!(j.state, "exited");
            assert_eq!(j.exit_code, Some(0));
            assert!(!j.remote_unknown);
            let result = j.result("r", 0, 65536);
            assert!(result["stdout"].as_str().unwrap().contains("owned-output"));
            assert!(result["stderr"].as_str().unwrap().contains("owned-error"));
        }
        let job = Arc::new(Mutex::new(fixture_job()));
        supervise(
            child("exit255"),
            job.clone(),
            vec![],
            Duration::from_secs(5),
            || true,
        );
        let j = job.lock().unwrap();
        assert_eq!(j.state, "unknown");
        assert!(j.remote_unknown);
        assert_eq!(j.exit_code, Some(255));
    }
    #[test]
    fn owned_process_cancel_timeout_and_revocation_stay_unknown() {
        for cause in ["cancel", "timeout", "revoked"] {
            let job = Arc::new(Mutex::new(fixture_job()));
            if cause == "cancel" {
                job.lock().unwrap().cancel = true;
            }
            supervise(
                child("sleep"),
                job.clone(),
                vec![],
                if cause == "timeout" {
                    Duration::ZERO
                } else {
                    Duration::from_secs(5)
                },
                || cause != "revoked",
            );
            let j = job.lock().unwrap();
            assert!(j.remote_unknown);
            assert!(matches!(j.state, "cancelled" | "unknown"));
            assert!(j.reason.is_some());
        }
    }
    #[test]
    fn strict_request_and_bounds() {
        assert!(request_id(&json!({"requestId":"safe_123-X"})).is_ok());
        for id in ["", "bad/id", "a\nb"] {
            assert!(request_id(&json!({"requestId":id})).is_err());
        }
        assert!(number(&json!({"timeoutSeconds":301}), "timeoutSeconds", 60, 1, 300).is_err());
        assert!(exact(&json!({"approve":true}), &["requestId"]).is_err());
    }
    #[test]
    fn literal_blocks_control_and_bidi_spoofing() {
        let shown = literal("printf \"x\"\n\u{202e}danger");
        assert!(!shown.contains('\n'));
        assert!(!shown.contains('\u{202e}'));
        assert!(shown.contains("\\u{a}"));
        assert!(shown.contains("\\\"x\\\""));
    }
    #[test]
    fn output_is_bounded_and_cursor_is_bytes() {
        let mut job = Job {
            issuer: NativeServiceChannel::for_test(),
            server: "s".into(),
            signature: "s".into(),
            endpoint_digest: "d".into(),
            state: "running",
            exit_code: None,
            reason: None,
            remote_unknown: false,
            cancel: false,
            output: Vec::new(),
            stderr: Vec::new(),
            pending_stdout: Vec::new(),
            pending_stderr: Vec::new(),
            output_full: false,
            total: 0,
            settled_at: None,
        };
        job.append(&vec![b'x'; OUTPUT_LIMIT + 99], false);
        let page = job.result("r", 100, 12);
        assert_eq!(job.output.len(), OUTPUT_LIMIT);
        assert_eq!(page["cursor"], 112);
        assert_eq!(page["truncated"], true);
        assert_eq!(page["totalBytes"], OUTPUT_LIMIT + 99);
        assert_eq!(page["output"], "xxxxxxxxxxxx");
    }
    #[test]
    fn configuration_digest_binds_target_and_runtime() {
        let mut endpoint = SshEndpoint {
            host: "fixture.invalid".into(),
            port: 22,
            ..Default::default()
        };
        let initial = endpoint_digest(&endpoint).unwrap();
        endpoint.port = 2222;
        assert_ne!(initial, endpoint_digest(&endpoint).unwrap());
        endpoint.port = 22;
        endpoint.runtime_configuration =
            Some(Arc::new(crate::ssh_security::RuntimeConfiguration {
                digest: "new".into(),
                environment: vec![],
                shell_kind: Some(RemoteShellKind::Posix),
                provenance: Default::default(),
            }));
        assert_ne!(initial, endpoint_digest(&endpoint).unwrap());
    }
}
