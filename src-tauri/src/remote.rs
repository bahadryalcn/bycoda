//! Remote host connections. The renderer receives machine metadata, never the
//! saved bearer credential. Workspace requests never fall back to local calls.
use crate::remote_ssh::{self, Job, JobView, SshTarget, Tunnel, Tunnels};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

#[path = "remote_changes.rs"]
mod changes;

#[path = "dev_server_access.rs"]
pub mod dev_access;

#[path = "remote_folder_access.rs"]
pub mod folder_access;

/// Sent to every window when a machine's SSH process ends on its own.
const TUNNEL_EXIT_EVENT: &str = "remote://tunnel-exit";

#[derive(Default)]
pub struct RemoteConnections {
    changes: changes::Changes,
    reads: changes::Reads,
    pub(crate) store: Mutex<()>,
    tunnels: Tunnels,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}

impl RemoteConnections {
    /// Has the renderer told when a machine's SSH tunnel drops.
    pub fn emit_tunnel_exits(&self, app: AppHandle) {
        self.tunnels.set_exit_sink(Arc::new(move |exit| {
            folder_access::stop_environment(&exit.environment_id);
            let _ = app.emit(TUNNEL_EXIT_EVENT, exit);
        }));
    }
    pub fn shutdown(&self) {
        folder_access::shutdown();
        if let Ok(jobs) = self.jobs.lock() {
            for job in jobs.values() {
                job.cancel();
            }
        }
        self.tunnels.clear();
    }
    fn job(&self, id: &str) -> Result<Arc<Job>, String> {
        self.jobs
            .lock()
            .map_err(|_| "Connection setup is unavailable")?
            .get(id)
            .cloned()
            .ok_or_else(|| "Connection setup has expired".into())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredMachine {
    id: String,
    name: String,
    endpoint: String,
    environment_id: String,
    token: String,
    #[serde(default)]
    ssh: Option<SshTarget>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    local_host: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) endpoint: String,
    pub(crate) environment_id: String,
    pub(crate) ssh: Option<SshTarget>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(crate) local_host: bool,
}

impl StoredMachine {
    fn public(&self) -> Machine {
        Machine {
            id: self.id.clone(),
            name: self.name.clone(),
            endpoint: self.endpoint.clone(),
            environment_id: self.environment_id.clone(),
            ssh: self.ssh.clone(),
            local_host: self.local_host,
        }
    }
}

/// A response belongs to the exact saved route and credential it started with.
/// Renaming a machine is harmless; replacing/removing its route is not.
fn same_request_route(started: &StoredMachine, current: &StoredMachine) -> bool {
    started.id == current.id
        && started.environment_id == current.environment_id
        && started.endpoint == current.endpoint
        && started.token == current.token
        && serde_json::to_value(&started.ssh).ok() == serde_json::to_value(&current.ssh).ok()
}

pub(crate) fn public_inventory_machine(record: &Value) -> Result<Machine, String> {
    serde_json::from_value::<StoredMachine>(record.clone())
        .map(|machine| machine.public())
        .map_err(|_| "Remote connection store is invalid".into())
}

fn endpoint(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value.trim()).map_err(|_| "Enter a valid host URL")?;
    let host = url.host_str().ok_or("Host URL has no hostname")?;
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback)) {
        return Err("Use HTTPS, or an HTTP loopback address forwarded through SSH".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Host URL must contain only the scheme, hostname, and port".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

struct CachedMachines {
    path: PathBuf,
    modified: std::time::SystemTime,
    length: u64,
    machines: Arc<Vec<StoredMachine>>,
}

static MACHINE_CACHE: Mutex<Option<CachedMachines>> = Mutex::new(None);

fn read(path: &Path) -> Result<Vec<StoredMachine>, String> {
    Ok(read_shared(path)?.as_ref().clone())
}

/// The cached store without copying it: per-request paths look up one machine.
fn read_shared(path: &Path) -> Result<Arc<Vec<StoredMachine>>, String> {
    let mut cache = MACHINE_CACHE
        .lock()
        .map_err(|_| "Connection cache is locked")?;
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            *cache = None;
            return Ok(Arc::new(Vec::new()));
        }
        Err(error) => return Err(error.to_string()),
    };
    let modified = metadata.modified().ok();
    if let Some(hit) = cache.as_ref() {
        if hit.path == path && Some(hit.modified) == modified && hit.length == metadata.len() {
            return Ok(Arc::clone(&hit.machines));
        }
    }
    let machines = Arc::new(read_uncached(path)?);
    *cache = modified.map(|modified| CachedMachines {
        path: path.to_path_buf(),
        modified,
        length: metadata.len(),
        machines: Arc::clone(&machines),
    });
    Ok(machines)
}

pub(crate) fn read_store_values(path: &Path) -> Result<Vec<Value>, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Remote connection store is invalid".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn read_uncached(path: &Path) -> Result<Vec<StoredMachine>, String> {
    read_store_values(path)?
        .into_iter()
        .filter(|record| record.get("kind").and_then(Value::as_str) != Some("ssh"))
        .map(|record| {
            serde_json::from_value(record).map_err(|_| "Remote connection store is invalid".into())
        })
        .collect()
}

fn write(path: &Path, machines: &[StoredMachine]) -> Result<(), String> {
    let existing = read_store_values(path)?;
    let mut records: Vec<Value> = existing
        .iter()
        .filter(|record| record.get("kind").and_then(Value::as_str) == Some("ssh"))
        .cloned()
        .collect();
    for machine in machines {
        let mut record = serde_json::to_value(machine).map_err(|e| e.to_string())?;
        if let Some(metadata) = existing
            .iter()
            .find(|old| old.get("id").and_then(Value::as_str) == Some(machine.id.as_str()))
            .and_then(|old| old.get("metadata"))
        {
            record["metadata"] = metadata.clone();
        }
        records.push(record);
    }
    write_store_values(path, &records)
}

pub(crate) fn write_store_values(path: &Path, records: &[Value]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing connection directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!("remote-machines-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(records).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    // Writes include edits, disconnects and credential replacements. Do not
    // rely on timestamp precision when this process changes the store.
    if let Ok(mut cache) = MACHINE_CACHE.lock() {
        *cache = None;
    }
    result
}

/// Hosts split large session syncs into pieces below this cap
/// (`host/sync-transfer.ts`), so it bounds memory without limiting transcripts.
const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
static RPC_AGENT: OnceLock<ureq::Agent> = OnceLock::new();

fn rpc_agent() -> &'static ureq::Agent {
    RPC_AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .redirects(0)
            .max_idle_connections(32)
            .max_idle_connections_per_host(4)
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout(DEFAULT_RPC_TIMEOUT)
            .build()
    })
}

const DEFAULT_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const CONNECTION_REFUSED: &str =
    "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

/// Git mutations may wait up to 120 s for the repository lease, then run a
/// 120 s command (or pull + push for sync), plus bounded safety reads. The
/// client must outlast that work so a successful write is not reported as failed.
/// Ordinary reads retain their short deadline.
fn rpc_timeout(method: &str, params: &Value) -> std::time::Duration {
    const GIT_MUTATION: std::time::Duration = std::time::Duration::from_secs(450);
    match method {
        "browser.setup" | "devices.setup" => std::time::Duration::from_secs(1230),
        // Pi/OMP discovery can use 45 seconds, plus binary resolution and teardown.
        "models.list" => std::time::Duration::from_secs(60),
        // Offline discovery and first model load can exceed ordinary RPC reads.
        "voice.local.inspect" => std::time::Duration::from_secs(60),
        "voice.local.start" => std::time::Duration::from_secs(180),
        "voice.local.transcribe" => std::time::Duration::from_secs(40),
        "devices.start" => std::time::Duration::from_secs(60),
        "devices.boot" => std::time::Duration::from_secs(240),
        "devices.action" => std::time::Duration::from_secs(180),
        "git.action" | "git.switch" | "git.createBranch" | "git.worktreeCreate" => GIT_MUTATION,
        "workspace.run"
            if params
                .get("command")
                .and_then(Value::as_str)
                .is_some_and(|command| {
                    command.starts_with("git_")
                        && !matches!(
                            command,
                            "git_diff_index"
                                | "git_diff_files"
                                | "git_diff_stats"
                                | "git_file_diff"
                                | "git_staged_context"
                                | "git_head_message"
                                | "git_range_context"
                                | "git_history"
                                | "git_commit_files"
                                | "git_commit_file_diff"
                                | "git_branches"
                                | "git_worktrees"
                                | "git_submodules"
                                | "git_pr_status"
                                | "git_operation_state"
                                | "git_operation_status"
                                | "git_conflicts"
                                | "git_conflict_stages"
                                | "git_stash_list"
                                | "git_tags"
                                | "git_remotes"
                                | "git_file_history"
                                | "git_blame"
                                | "git_commit_message"
                        )
                }) =>
        {
            GIT_MUTATION
        }
        _ => DEFAULT_RPC_TIMEOUT,
    }
}

fn rpc(
    endpoint: &str,
    token: &str,
    environment_id: Option<&str>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let agent = rpc_agent();
    let payload = json!({ "version": 1, "environmentId": environment_id, "method": method, "params": params });
    let response = agent
        .post(&format!("{endpoint}/rpc"))
        .timeout(rpc_timeout(method, &params))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .send_string(&payload.to_string());
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(error)) if connection_refused(&error) => {
            return Err(CONNECTION_REFUSED.into())
        }
        Err(ureq::Error::Transport(error)) => {
            return Err(rpc_transport_failure(
                &error,
                &rpc_operation(method, &params),
            ))
        }
    };
    let status = response.status();
    if status == 401 || status == 403 {
        return Err(format!("Host rejected request [RPC_AUTHORIZATION] ({method}). Reconnect the selected machine and check its access scope."));
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Host response is too large".into());
    }
    let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid host response")?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(format!("Host rejected request: {error}"));
    }
    if status != 200 {
        return Err(format!("Host returned HTTP {status}"));
    }
    value
        .as_object_mut()
        .and_then(|object| object.remove("result"))
        .ok_or_else(|| "Invalid host response".into())
}

// Only a refused connection proves the local forwarding listener is gone.
// A slow request or an interrupted response says nothing about SSH health.
fn connection_refused(error: &ureq::Transport) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(error) = source {
        if error
            .downcast_ref::<std::io::Error>()
            .is_some_and(|e| e.kind() == std::io::ErrorKind::ConnectionRefused)
        {
            return true;
        }
        source = error.source();
    }
    false
}

/// Only action identifiers from the host workspace contract may enter diagnostics.
fn rpc_operation(method: &str, params: &Value) -> String {
    if method == "workspace.run" {
        if let Some(action) = params.get("command").and_then(Value::as_str) {
            if matches!(
                action,
                "browse_dir"
                    | "copy_path"
                    | "create_path"
                    | "delete_path"
                    | "format_text_file"
                    | "git_blame"
                    | "git_branches"
                    | "git_checkout"
                    | "git_checkout_commit"
                    | "git_cherry_pick"
                    | "git_commit"
                    | "git_commit_file_diff"
                    | "git_commit_files"
                    | "git_commit_message"
                    | "git_conflict_stages"
                    | "git_conflicts"
                    | "git_create_branch"
                    | "git_create_branch_at"
                    | "git_create_branch_from"
                    | "git_create_tag"
                    | "git_delete_branch"
                    | "git_delete_remote_branch"
                    | "git_delete_tag"
                    | "git_diff_files"
                    | "git_diff_index"
                    | "git_diff_stats"
                    | "git_discard_all"
                    | "git_discard_file"
                    | "git_fetch"
                    | "git_file_diff"
                    | "git_file_history"
                    | "git_head_message"
                    | "git_history"
                    | "git_merge"
                    | "git_operation_abort"
                    | "git_operation_continue"
                    | "git_operation_state"
                    | "git_operation_status"
                    | "git_pr_create"
                    | "git_pr_status"
                    | "git_pull"
                    | "git_push"
                    | "git_range_context"
                    | "git_rebase"
                    | "git_remote_add"
                    | "git_remote_remove"
                    | "git_remotes"
                    | "git_rename_branch"
                    | "git_reset"
                    | "git_resolve_conflict"
                    | "git_revert"
                    | "git_stage_all"
                    | "git_stage_contents"
                    | "git_stage_file"
                    | "git_stage_files"
                    | "git_discard_files"
                    | "git_unstage_files"
                    | "git_staged_context"
                    | "git_stash"
                    | "git_stash_action"
                    | "git_stash_clear"
                    | "git_stash_list"
                    | "git_submodules"
                    | "git_sync"
                    | "git_tags"
                    | "git_trust_repository"
                    | "git_undo_last_commit"
                    | "git_unstage_all"
                    | "git_unstage_file"
                    | "git_worktrees"
                    | "list_claude_commands"
                    | "list_dir"
                    | "list_project_files"
                    | "list_skills"
                    | "move_path"
                    | "read_binary_file"
                    | "read_file_chunk"
                    | "read_file_info"
                    | "read_file_preview"
                    | "read_folder_entry"
                    | "read_text_file"
                    | "rename_path"
                    | "search_project"
                    | "session_checkpoint_file_diff"
                    | "session_checkpoint_keep"
                    | "session_checkpoint_status"
                    | "session_checkpoint_undo"
                    | "skill_delete"
                    | "skill_export"
                    | "skill_import"
                    | "skill_policy_get"
                    | "skill_policy_set"
                    | "stat_files"
                    | "write_text_file"
            ) {
                return format!("{method}:{action}");
            }
        }
    }
    method.to_owned()
}

fn rpc_transport_failure(error: &ureq::Transport, method: &str) -> String {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    let mut timeout = false;
    let mut unavailable = false;
    while let Some(cause) = source {
        timeout |= cause.downcast_ref::<std::io::Error>().is_some_and(|io| {
            matches!(
                io.kind(),
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
            )
        });
        unavailable |= cause.downcast_ref::<std::io::Error>().is_some_and(|io| {
            matches!(
                io.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::ConnectionReset
                    | std::io::ErrorKind::ConnectionAborted
                    | std::io::ErrorKind::UnexpectedEof
            )
        });
        source = cause.source();
    }
    let (code, remedy) = if timeout {
        ("RPC_TIMEOUT", "The host exceeded the request deadline. Check its status before retrying an action; its outcome is unknown.")
    } else if unavailable {
        ("RPC_HOST_UNAVAILABLE", "The host connection closed or refused the request. The host may be restarting or the SSH tunnel may be down. Reconnect before retrying an action; its outcome is unknown.")
    } else {
        match error.kind() {
            ureq::ErrorKind::Dns => ("RPC_DNS", "The machine address could not be resolved. Check the saved connection address."),
            ureq::ErrorKind::ProxyConnect | ureq::ErrorKind::ProxyUnauthorized | ureq::ErrorKind::InvalidProxyUrl =>
                ("RPC_PROXY", "The network proxy could not connect. Check the proxy and machine connection."),
            ureq::ErrorKind::BadHeader | ureq::ErrorKind::BadStatus =>
                ("RPC_PROTOCOL", "The endpoint did not return a valid host response. Check the host address and version."),
            _ => ("RPC_CONNECTION_INTERRUPTED", "The connection was interrupted. Check the host and SSH tunnel before retrying an action; its outcome is unknown."),
        }
    };
    // Never include ureq's raw diagnostic: it can contain endpoints and credentials.
    format!("The host request did not complete [{code}] ({method}). {remedy}")
}

/// A refused TCP connection never delivered the request body. Once its lease
/// has been invalidated, the same operation can safely try a new tunnel once.
/// Resets, EOFs and timeouts may have delivered a command and must not retry.
fn with_refused_tunnel_retry<T>(
    allow_reconnect: bool,
    mut send: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    match send() {
        Err(error) if allow_reconnect && error == CONNECTION_REFUSED => send(),
        result => result,
    }
}

fn machine_rpc(
    state: &RemoteConnections,
    machine: &StoredMachine,
    method: &str,
    params: Value,
    allow_connect: bool,
) -> Result<Value, String> {
    with_refused_tunnel_retry(allow_connect && machine.ssh.is_some(), || {
        let lease = machine
            .ssh
            .as_ref()
            .map(|target| {
                state
                    .tunnels
                    .endpoint(&machine.id, &machine.environment_id, target, allow_connect)
            })
            .transpose()?;
        let endpoint = lease
            .as_ref()
            .map(|lease| lease.endpoint.as_str())
            .unwrap_or(&machine.endpoint);
        let response = rpc(
            endpoint,
            &machine.token,
            Some(&machine.environment_id),
            method,
            params.clone(),
        );
        let response = match response {
            Err(error)
                if error.starts_with("The host request did not complete")
                    && state.tunnels.take_host_refusal(&machine.id) =>
            {
                Err(
                    "Host is not running on the machine. Start bycoda Host there, then reconnect."
                        .to_owned(),
                )
            }
            other => other,
        };
        if response
            .as_ref()
            .err()
            .is_some_and(|error| error.starts_with("Machine is unreachable"))
        {
            if let Some(lease) = &lease {
                state.tunnels.invalidate(&machine.id, lease);
            }
        }
        response
    })
}

pub(crate) fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("remote-machines.json"))
}

#[tauri::command(async)]
pub fn remote_machines(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
) -> Result<Vec<Machine>, String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    Ok(read(&store_path(&app)?)?
        .iter()
        .map(StoredMachine::public)
        .collect())
}

#[tauri::command(async)]
pub fn remote_connect(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    name: String,
    url: String,
    token: String,
) -> Result<Machine, String> {
    connect_host(app, state, name, url, token, false)
}

/// Called only after pairing through the launcher installed on this computer.
pub(crate) fn local_host_pair(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    name: String,
    url: String,
    token: String,
) -> Result<Machine, String> {
    connect_host(app, state, name, url, token, true)
}

fn connect_host(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    name: String,
    url: String,
    token: String,
    local_host: bool,
) -> Result<Machine, String> {
    let endpoint = endpoint(&url)?;
    let token = token.trim().to_string();
    if token.len() != 43
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Enter the device token issued by bycoda-host pair".into());
    }
    let descriptor = rpc(&endpoint, &token, None, "environment.describe", json!({}))?;
    if descriptor.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
        return Err("This host uses an incompatible protocol version".into());
    }
    let environment_id = descriptor
        .get("environmentId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("Host identity is missing")?
        .to_string();
    let name = if name.trim().is_empty() {
        descriptor
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Remote machine")
            .to_string()
    } else {
        name.trim().chars().take(100).collect()
    };
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = store_path(&app)?;
    let mut machines = read(&path)?;
    let existing = machines.iter().find(|m| m.environment_id == environment_id);
    let id = existing
        .map(|m| m.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let machine = StoredMachine {
        id: id.clone(),
        name,
        local_host: local_host
            || existing.is_some_and(|m| m.local_host && m.ssh.is_none() && m.endpoint == endpoint),
        endpoint,
        environment_id,
        token,
        ssh: if local_host {
            None
        } else {
            existing.and_then(|m| m.ssh.clone())
        },
    };
    machines.retain(|m| m.id != id);
    machines.push(machine.clone());
    write(&path, &machines)?;
    Ok(machine.public())
}

/// What an edit changes in a saved SSH machine: its label and where to dial.
/// The machine's id, environment id and credential are never part of it.
fn apply_edit(
    machines: &mut [StoredMachine],
    machine_id: &str,
    name: &str,
    target: String,
    port: Option<u16>,
    alternate: Option<String>,
    remote_port: Option<u16>,
) -> Result<StoredMachine, String> {
    if remote_port == Some(0) {
        return Err("The Host port must be a number from 1 to 65535.".into());
    }
    let machine = machines
        .iter_mut()
        .find(|m| m.id == machine_id)
        .ok_or("Machine is no longer connected")?;
    let old = machine
        .ssh
        .as_ref()
        .ok_or("This connection does not use SSH")?;
    // Older callers omit the host port and keep setup's saved value.
    let ssh = SshTarget {
        target,
        port,
        remote_port: remote_port.unwrap_or(old.remote_port),
        alternate,
        host_key_alias: None,
        identity_file: old.identity_file.clone(),
    };
    machine.endpoint = format!("ssh://{}", ssh.target);
    machine.ssh = Some(ssh);
    let name: String = name.trim().chars().take(100).collect();
    if !name.is_empty() {
        machine.name = name;
    }
    Ok(machine.clone())
}

/// Saves a new name or address for a machine and keeps everything that
/// projects and the host know it by. Where the way in changed, the tunnel to
/// the old address is closed here (on purpose, so nothing reports it as
/// dropped) and its cached failure goes with it; the caller then reconnects
/// through `remote_ssh_reconnect`, which can ask the user about a new host key.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Keep the existing named IPC arguments compatible.
pub fn remote_machine_update(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    machine_id: String,
    name: String,
    target: String,
    port: Option<u16>,
    alternate: Option<String>,
    remote_port: Option<u16>,
) -> Result<Machine, String> {
    let target = remote_ssh::validate_target(&target, port)?;
    let alternate = remote_ssh::validate_alternate(alternate.as_deref(), port)?
        .filter(|alternate| *alternate != target);
    // A running setup would write its older copy of the machine back over this.
    if state
        .jobs
        .lock()
        .map_err(|_| "Connection setup is unavailable")?
        .values()
        .any(|job| !job.view().done)
    {
        return Err("Another SSH connection is being set up. Finish or cancel it first.".into());
    }
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = store_path(&app)?;
    let mut machines = read(&path)?;
    let before = machines
        .iter()
        .find(|m| m.id == machine_id)
        .and_then(|m| m.ssh.clone());
    let machine = apply_edit(
        &mut machines,
        &machine_id,
        &name,
        target,
        port,
        alternate,
        remote_port,
    )?;
    write(&path, &machines)?;
    if before != machine.ssh {
        state.tunnels.remove(&machine_id);
    }
    Ok(machine.public())
}

/// Whether a saved machine is a desktop's automatic link to a host on this computer.
fn is_local_sync(machine: &StoredMachine, local_name: &str) -> bool {
    machine.ssh.is_none()
        && (machine.local_host || machine.name == local_name)
        && (machine.endpoint.starts_with("http://127.0.0.1:")
            || machine.endpoint.starts_with("http://localhost:"))
}

/// Persists ownership after reusing a connection to the launcher's current port.
/// SSH forwarding listeners are never eligible, even when their URL is loopback.
pub(crate) fn mark_local_host(
    app: &AppHandle,
    state: &RemoteConnections,
    machine_id: &str,
    current_endpoint: &str,
) -> Result<Machine, String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = store_path(app)?;
    let mut machines = read(&path)?;
    let machine = machines
        .iter_mut()
        .find(|m| m.id == machine_id)
        .ok_or("Machine is no longer connected")?;
    mark_local_host_record(machine, current_endpoint)?;
    let public = machine.public();
    write(&path, &machines)?;
    Ok(public)
}

fn mark_local_host_record(
    machine: &mut StoredMachine,
    current_endpoint: &str,
) -> Result<(), String> {
    if machine.ssh.is_some()
        || machine.endpoint != current_endpoint
        || !(current_endpoint.starts_with("http://127.0.0.1:")
            || current_endpoint.starts_with("http://localhost:"))
    {
        return Err("This connection is not the local host".into());
    }
    machine.local_host = true;
    Ok(())
}

/// Forgets automatic local links to hosts other than the one now running on
/// this computer. An earlier product version ran its host on another port; a
/// stale link would otherwise win the lookup and report missing features.
pub(crate) fn prune_stale_local_sync(
    app: &AppHandle,
    state: &RemoteConnections,
    local_name: &str,
    current_endpoint: &str,
) -> Result<(), String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = store_path(app)?;
    let machines = read(&path)?;
    let (stale, kept): (Vec<_>, Vec<_>) = machines.into_iter().partition(|machine| {
        is_local_sync(machine, local_name) && machine.endpoint != current_endpoint
    });
    if stale.is_empty() {
        return Ok(());
    }
    write(&path, &kept)?;
    for machine in stale {
        state.tunnels.remove(&machine.id);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn remote_disconnect(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    machine_id: String,
) -> Result<(), String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = store_path(&app)?;
    let mut machines = read(&path)?;
    machines.retain(|m| m.id != machine_id);
    write(&path, &machines)?;
    state.tunnels.remove(&machine_id);
    folder_access::stop_machine(&machine_id);
    Ok(())
}

#[tauri::command(async)]
// Preserve the existing IPC/process-launch argument contract.
#[allow(clippy::too_many_arguments)]
pub fn remote_request(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, RemoteConnections>,
    machine_id: String,
    method: String,
    params: Value,
    fresh: Option<bool>,
    allow_connect: Option<bool>,
) -> Result<Value, String> {
    if !supported_remote_method(&method) {
        return Err("Unsupported remote operation".into());
    }
    if method == "machine.changes"
        && params.get("tasksKnown").is_none()
        && ["sessions", "projects"].iter().all(|key| {
            params
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        })
    {
        // Releasing a renderer registration is local. Never start an SSH tunnel
        // or read credentials merely because a disconnected pane closes.
        return state
            .changes
            .request(&machine_id, window.label(), params, |_| {
                Err("Empty subscriptions do not need a host request".into())
            });
    }
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read_shared(&store_path(&app)?)?
            .iter()
            .find(|m| m.id == machine_id)
            .cloned()
            .ok_or("Machine is no longer connected")?
    };
    if fresh == Some(true) && machine.ssh.is_some() {
        state.tunnels.forget_failure(&machine.id);
    }
    // Background polling must respect the owner's automatic reconnect setting.
    let allow = fresh == Some(true) || allow_connect != Some(false);
    let send = |params| machine_rpc(&state, &machine, &method, params, allow);
    let response = if method == "machine.changes" {
        state
            .changes
            .request(&machine.id, window.label(), params, send)
    } else if shareable_remote_read(&method, &params) {
        let key = serde_json::to_string(&json!([
            machine.id,
            machine.environment_id,
            machine.token,
            machine.endpoint,
            machine.ssh,
            method,
            params
        ]))
        .map_err(|_| "Invalid remote read")?;
        state.reads.request(
            key,
            rpc_timeout(&method, &params) + std::time::Duration::from_secs(5),
            || send(params),
        )
    } else {
        send(params)
    };
    {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        let current = read_shared(&store_path(&app)?)?;
        if !current
            .iter()
            .any(|saved| same_request_route(&machine, saved))
        {
            return Err("Connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.".into());
        }
    }
    let result = response?;
    if method == "environment.describe"
        && result.get("environmentId").and_then(Value::as_str)
            != Some(machine.environment_id.as_str())
    {
        return Err("Host identity changed. Add this machine again before continuing.".into());
    }
    Ok(result)
}

fn shareable_remote_read(method: &str, params: &Value) -> bool {
    matches!(
        method,
        "sessions.sync"
            | "sessions.page"
            | "sessions.block"
            | "sessions.syncChunk"
            | "sessions.list"
            | "environment.describe"
            | "models.list"
            | "tasks.preflight"
            | "git.diff"
            | "git.index"
            | "git.fileDiff"
            | "git.branches"
            | "git.worktrees"
    ) || (method == "workspace.run"
        && matches!(
            params.get("command").and_then(Value::as_str),
            Some(
                "git_diff_index"
                    | "git_file_diff"
                    | "git_diff_files"
                    | "git_diff_stats"
                    | "stat_files"
                    | "list_dir"
                    | "list_project_files"
            )
        ))
}

pub(crate) fn local_social_rpc(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if !matches!(method, "social.bridge.describe" | "social.access.issue") {
        return Err("Unsupported native social bridge operation".into());
    }
    let state: State<'_, RemoteConnections> = app.state();
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(app)?)?
            .into_iter()
            .find(|machine| is_local_sync(machine, "This computer (local sync)"))
            .ok_or("Connect the local bycoda Host for social session tools")?
    };
    let mut value = rpc(
        &machine.endpoint,
        &machine.token,
        Some(&machine.environment_id),
        method,
        params,
    )?;
    if method == "social.access.issue" && value.get("endpoint").is_none() {
        value["endpoint"] = Value::String(machine.endpoint);
    }
    Ok(value)
}

pub(crate) fn local_runtime_logs_rpc(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if !matches!(
        method,
        "runtimeLogs.bridge.describe" | "runtimeLogs.access.issue" | "runtimeLogs.terminals.append"
    ) {
        return Err("Unsupported native runtime log bridge operation".into());
    }
    let state: State<'_, RemoteConnections> = app.state();
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(app)?)?
            .into_iter()
            .find(|machine| is_local_sync(machine, "This computer (local sync)"))
            .ok_or("Connect the local bycoda Host for runtime log tools")?
    };
    let mut value = rpc(
        &machine.endpoint,
        &machine.token,
        Some(&machine.environment_id),
        method,
        params,
    )?;
    if method == "runtimeLogs.access.issue" {
        value["endpoint"] = Value::String(machine.endpoint);
    }
    Ok(value)
}

pub(crate) fn local_editor_format_rpc(app: &AppHandle, params: Value) -> Result<Value, String> {
    let state: State<'_, RemoteConnections> = app.state();
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(app)?)?
            .into_iter()
            .find(|machine| is_local_sync(machine, "This computer (local sync)"))
    };
    let Some(machine) = machine else {
        return Ok(Value::Null);
    };
    rpc(
        &machine.endpoint,
        &machine.token,
        Some(&machine.environment_id),
        "workspace.run",
        json!({ "command": "format_text_file", "args": params }),
    )
}

pub(crate) fn local_conversation_environment(app: &AppHandle) -> Result<String, String> {
    let state: State<'_, RemoteConnections> = app.state();
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    read(&store_path(app)?)?
        .into_iter()
        .find(|machine| is_local_sync(machine, "This computer (local sync)"))
        .map(|machine| machine.environment_id)
        .ok_or("Connect the local bycoda Host for history import".into())
}

pub(crate) fn local_conversation_rpc(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if !matches!(
        method,
        "conversation.bridge.describe"
            | "conversation.access.issue"
            | "conversation.desktop.take"
            | "conversation.desktop.finish"
            | "conversation.desktop.authorize"
    ) {
        return Err("Unsupported native conversation bridge operation".into());
    }
    let state: State<'_, RemoteConnections> = app.state();
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(app)?)?
            .into_iter()
            .find(|machine| is_local_sync(machine, "This computer (local sync)"))
            .ok_or("Connect the local bycoda Host for Conversation Tools")?
    };
    let mut value = rpc(
        &machine.endpoint,
        &machine.token,
        Some(&machine.environment_id),
        method,
        params,
    )?;
    if method == "conversation.access.issue" {
        value["endpoint"] = Value::String(machine.endpoint);
    }
    Ok(value)
}

pub(crate) fn conversation_machine_call(
    app: &AppHandle,
    action: &str,
    input: &Value,
    owner: &str,
    expires_at: &Value,
) -> Result<Value, String> {
    let state: State<'_, RemoteConnections> = app.state();
    let machines = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(app)?)?
    };
    if action == "machines.list" {
        return Ok(
            json!({"machines": machines.iter().map(|machine| json!({"id": machine.id, "name": machine.name, "environmentId": machine.environment_id, "localHost": machine.local_host})).collect::<Vec<_>>() }),
        );
    }
    if !matches!(
        action,
        "devices.status"
            | "devices.preflight"
            | "devices.preview"
            | "devices.preview.status"
            | "devices.list"
            | "devices.start"
            | "devices.boot"
            | "devices.capture"
            | "devices.action"
    ) {
        return Err("Unsupported machine tool".into());
    }
    let id = input
        .get("machineId")
        .and_then(Value::as_str)
        .ok_or("Explicit machineId required")?;
    let machine = machines
        .iter()
        .find(|machine| machine.id == id)
        .ok_or("Selected machine is no longer connected")?;
    let mut params = input.clone();
    params
        .as_object_mut()
        .ok_or("Invalid machine input")?
        .remove("machineId");
    if action.starts_with("devices.preview") {
        params["previewOwner"] = json!(owner);
        params["previewExpiresAt"] = expires_at.clone();
    }
    let value = machine_rpc(&state, machine, action, params, true)
        .map_err(|error| error.replace(&machine.token, "[machine credential redacted]"))?;
    serde_json::from_str(
        &value
            .to_string()
            .replace(&machine.token, "[machine credential redacted]"),
    )
    .map_err(|_| "Invalid machine tool response".into())
}

#[tauri::command(async)]
pub fn social_authority_status(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
) -> Result<Value, String> {
    // Read under the store lock, but never hold it across the HTTP call (up to
    // its timeout), which would stall every other connection command.
    let machines = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(&app)?)?
    };
    let source = machines
        .iter()
        .find(|machine| is_local_sync(machine, "This computer (local sync)"))
        .ok_or("Connect the local host first")?;
    let mut value = rpc(
        &source.endpoint,
        &source.token,
        Some(&source.environment_id),
        "social.native.status",
        json!({}),
    )?;
    value["sourceMachineId"] = json!(source.id);
    let authority_id = value
        .get("authority")
        .and_then(|v| v.get("environmentId"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(id) = authority_id {
        value["authorityMachineId"] = machines
            .iter()
            .find(|m| m.environment_id == id)
            .map(|m| json!(m.id))
            .unwrap_or(Value::Null);
    }
    Ok(value)
}

#[tauri::command(async)]
pub fn social_authority_connect(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    machine_id: Option<String>,
    mapping: Value,
    source_endpoint: Option<String>,
) -> Result<Value, String> {
    let machines = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(&app)?)?
    };
    let source = machines
        .iter()
        .find(|machine| is_local_sync(machine, "This computer (local sync)"))
        .ok_or("Connect the local host first")?;
    let Some(id) = machine_id else {
        return rpc(
            &source.endpoint,
            &source.token,
            Some(&source.environment_id),
            "social.native.reset",
            json!({}),
        );
    };
    let target = machines
        .iter()
        .find(|machine| machine.id == id && machine.environment_id != source.environment_id)
        .ok_or("Choose a different paired host")?;
    let source_url = source_endpoint
        .ok_or("Enter this host's HTTPS endpoint reachable from the central authority")?;
    let enrollment = rpc(
        &source.endpoint,
        &source.token,
        Some(&source.environment_id),
        "social.native.enroll",
        json!({"environmentId": target.environment_id}),
    )?;
    let token = enrollment
        .get("token")
        .and_then(Value::as_str)
        .ok_or("Social enrollment failed")?;
    // Dedicated peer token stays between native code and the hosts; it never
    // reaches the renderer and cannot perform general device operations.
    rpc(
        &target.endpoint,
        &target.token,
        Some(&target.environment_id),
        "social.native.register",
        json!({"environmentId": source.environment_id, "endpoint": source_url, "token": token, "mapping": mapping}),
    )?;
    rpc(
        &source.endpoint,
        &source.token,
        Some(&source.environment_id),
        "social.native.authority",
        json!({"environmentId": target.environment_id, "endpoint": target.endpoint, "mapping": mapping}),
    )
}

fn supported_remote_method(method: &str) -> bool {
    matches!(
        method,
        "social.request"
            | "voice.local.inspect"
            | "voice.local.start"
            | "voice.local.transcribe"
            | "voice.local.keepAlive"
            | "voice.local.release"
            | "voice.local.speak"
            | "voice.local.speechNext"
            | "voice.local.speechCancel"
            | "social.oauth.availability"
            | "social.oauth.begin"
            | "social.oauth.status"
            | "social.oauth.select"
            | "social.token.connect"
            | "social.token.inspect"
            | "social.tiktok.creator"
            | "social.browser.availability"
            | "social.browser.begin"
            | "social.browser.status"
            | "social.browser.profile.read"
            | "social.browser.profile.update"
            | "social.browser.profile.follow"
            | "social.browser.workflow.begin"
            | "social.browser.workflow.status"
            | "social.browser.workflow.cancel"
            | "social.browser.registration.advance"
            | "social.browser.registration.review"
            | "social.browser.registration.submit"
            | "social.browser.registration.reconcile"
            | "social.monitoring.status"
            | "social.media.upload"
            | "browser.claim"
            | "browser.close"
            | "browser.frame"
            | "browser.input"
            | "browser.open"
            | "browser.release"
            | "browser.status"
            | "browser.setup"
            | "browser.annotation.start"
            | "browser.annotation.hover"
            | "browser.annotation.select"
            | "browser.annotation.clear"
            | "browser.annotation.read"
            | "browser.annotation.cancel"
            | "devServers.list"
            | "devServers.details"
            | "devServers.start"
            | "devServers.stop"
            | "devServers.kill"
            | "devServers.restart"
            | "devServers.logs"
            | "devServers.openExternal"
            | "terminals.list"
            | "terminals.create"
            | "terminals.read"
            | "terminals.write"
            | "terminals.interrupt"
            | "terminals.close"
            | "runtimeLogs.read"
            | "runtimeLogs.sources"
            | "runtimeLogs.monitors.list"
            | "runtimeLogs.monitors.start"
            | "runtimeLogs.monitors.stop"
            | "resources.read"
            | "devices.status"
            | "devices.preflight"
            | "devices.preview"
            | "devices.preview.status"
            | "devices.setup"
            | "devices.start"
            | "devices.stop"
            | "devices.list"
            | "devices.boot"
            | "devices.capture"
            | "devices.action"
            | "environment.describe"
            | "mobile.access.status"
            | "mobile.access.enable"
            | "tunnels.status"
            | "tunnels.start"
            | "tunnels.stop"
            | "tunnels.credential"
            | "mobile.pairing.create"
            | "mobile.pairing.status"
            | "mobile.pairing.cancel"
            | "machine.changes"
            | "commands.status"
            | "projects.list"
            | "mcp.tokens.create"
            | "mcp.tokens.list"
            | "mcp.tokens.revoke"
            | "projects.browse"
            | "projects.createDirectory"
            | "projects.open"
            | "models.list"
            | "sessions.list"
            | "sessions.update"
            | "sessions.delete"
            | "sessions.sync"
            | "sessions.page"
            | "sessions.block"
            | "sessions.syncChunk"
            | "sessions.adopted"
            | "sessions.desktopLive"
            | "sessions.queue.get"
            | "sessions.queue.change"
            | "sessions.queue.claim"
            | "sessions.queue.finish"
            | "sessions.queue.lease"
            | "sessions.queue.release"
            | "sessions.runLease"
            | "commands.dispatch"
            | "attachments.upload"
            | "attachments.status"
            | "attachments.read"
            | "attachments.claim"
            | "attachments.claims"
            | "attachments.release"
            | "devices.revokeSelf"
            | "git.diff"
            | "git.branches"
            | "git.switch"
            | "git.createBranch"
            | "git.worktrees"
            | "git.worktreeCreate"
            | "files.read"
            | "files.list"
            | "files.index"
            | "workspace.run"
            | "files.search"
            | "files.searchContent"
            | "files.create"
            | "files.write"
            | "git.index"
            | "git.fileDiff"
            | "git.action"
            | "sync.pull"
            | "sync.push"
            | "shell.profiles"
            | "shell.setProfile"
            | "sessions.get"
            | "automations.list"
            | "automations.preview"
            | "automations.save"
            | "automations.delete"
            | "automations.runs"
            | "automations.runNow"
            | "crews.list"
            | "crews.schema"
            | "crews.inspect"
            | "crews.save"
            | "crews.delete"
            | "crews.deleteRun"
            | "crews.agent.save"
            | "crews.agent.delete"
            | "crews.start"
            | "crews.get"
            | "crews.assign"
            | "crews.request"
            | "crews.resolve"
            | "crews.respond"
            | "crews.answer"
            | "crews.pause"
            | "crews.stop"
            | "crews.resume"
            | "crews.accept"
            | "crews.finish"
            | "tasks.list"
            | "tasks.snapshotWithCursor"
            | "tasks.events"
            | "tasks.preflight"
            | "tasks.evaluation.save"
            | "tasks.save"
            | "tasks.move"
            | "tasks.start"
            | "tasks.reorder"
            | "tasks.retarget"
            | "tasks.notes.read"
            | "tasks.notes.resolve"
            | "tasks.review.recheck"
            | "tasks.delete"
            | "sprints.list"
            | "sprints.get"
            | "sprints.create"
            | "sprints.update"
            | "sprints.start"
            | "sprints.complete"
            | "sprints.archive"
            | "sprints.plan"
            | "sprints.report"
            | "sprints.ingest"
            | "sprints.goalContext"
            | "goals.list"
            | "goals.final-review.recheck"
            | "goals.create"
            | "goals.update"
            | "goals.approve"
            | "goals.replan"
            | "goals.cancel"
            | "goals.delete"
            | "stewards.list"
            | "stewards.save"
            | "stewards.delete"
            | "stewards.runNow"
            | "stewards.decline"
            | "host.settings.get"
            | "host.settings.save"
    )
}

/// A machine set up again: it keeps its id, so its projects and sessions stay
/// linked. Added anew from another address (its Tailscale one, say), it keeps
/// the address it had and takes the new one as its other address, rather
/// than losing the first; it keeps its name unless a new one was given.
fn merge_known_machine(
    machine: &mut StoredMachine,
    old: &StoredMachine,
    adding: bool,
    named: bool,
) {
    machine.id = old.id.clone();
    // Setup/reconnect may have started before a key was assigned. Keep the
    // latest saved binding instead of writing the job's older target over it.
    if let (Some(new), Some(previous)) = (machine.ssh.as_mut(), old.ssh.as_ref()) {
        new.identity_file = previous.identity_file.clone();
    }
    if !adding {
        return;
    }
    let (Some(new), Some(previous)) = (machine.ssh.as_mut(), old.ssh.as_ref()) else {
        return;
    };
    if new.target != previous.target {
        let added = std::mem::replace(&mut new.target, previous.target.clone());
        new.alternate = Some(added);
        new.port = previous.port.or(new.port);
        machine.endpoint = format!("ssh://{}", new.target);
    } else {
        new.alternate = new.alternate.clone().or_else(|| previous.alternate.clone());
    }
    if !named {
        machine.name = old.name.clone();
    }
}

/// A saved SSH machine at the same address as `new` that now answers as
/// another environment, i.e. its host was reinstalled with new data.
fn replaced_machine<'a>(
    machines: &'a [StoredMachine],
    new: &StoredMachine,
) -> Option<&'a StoredMachine> {
    let new_ssh = new.ssh.as_ref()?;
    let addresses = |ssh: &SshTarget| {
        std::iter::once(ssh.target.to_ascii_lowercase())
            .chain(ssh.alternate.iter().map(|value| value.to_ascii_lowercase()))
            .collect::<Vec<_>>()
    };
    let wanted = addresses(new_ssh);
    machines.iter().find(|machine| {
        machine.environment_id != new.environment_id
            && machine.ssh.as_ref().is_some_and(|ssh| {
                ssh.port == new_ssh.port
                    && addresses(ssh)
                        .iter()
                        .any(|address| wanted.contains(address))
            })
    })
}

/// Connection failures that a host listening on another port also produces.
/// Rejected credentials and changed identities are answered, not unreachable.
fn port_may_have_moved(error: &str) -> bool {
    error.starts_with("Machine is unreachable")
        || error.starts_with("The host request did not complete")
}

/// The port from a `connection-info` result (the script's last line).
fn reported_port(output: &str) -> Option<u16> {
    let info: Value = serde_json::from_str(output.lines().last()?.trim()).ok()?;
    u16::try_from(info.get("port")?.as_u64()?)
        .ok()
        .filter(|port| *port > 0)
}

fn start_ssh_job(
    app: AppHandle,
    target: SshTarget,
    name: String,
    existing: Option<StoredMachine>,
    upgrade: bool,
) -> Result<String, String> {
    let adding = existing.is_none();
    let named = !name.trim().is_empty();
    let job = Job::new();
    let id = job.view().id;
    {
        let state = app.state::<RemoteConnections>();
        let mut jobs = state
            .jobs
            .lock()
            .map_err(|_| "Connection setup is unavailable")?;
        if jobs.values().any(|job| !job.view().done) {
            return Err(
                "Another SSH connection is being set up. Finish or cancel it first.".into(),
            );
        }
        jobs.retain(|_, job| !job.view().done);
        jobs.insert(id.clone(), job.clone());
    }
    std::thread::spawn(move || {
        let prepared = (|| -> Result<(StoredMachine, Tunnel), String> {
            let askpass = job.askpass()?;
            let mut target = target;
            let mut machine = if let Some(mut existing) = existing {
                if upgrade {
                    let (platform, dial) = remote_ssh::detect_platform(&target, &job, &askpass)?;
                    job.message("Updating bycoda Host on the machine…");
                    let output = remote_ssh::run_script(
                        &dial,
                        platform,
                        remote_ssh::upgrade_script(platform, target.remote_port),
                        &job,
                        &askpass,
                    )?;
                    let info: Value = serde_json::from_str(output.lines().last().unwrap_or(""))
                        .map_err(|_| "Host update returned an invalid response")?;
                    target.remote_port = info
                        .get("port")
                        .and_then(Value::as_u64)
                        .and_then(|v| u16::try_from(v).ok())
                        .filter(|p| *p > 0)
                        .ok_or("Host did not report a valid port")?;
                    existing.ssh = Some(target.clone());
                } else {
                    job.message("Reconnecting to the machine…");
                }
                existing
            } else {
                let (platform, dial) = remote_ssh::detect_platform(&target, &job, &askpass)?;
                job.message("Installing or starting bycoda Host…");
                let output = remote_ssh::run_script(
                    &dial,
                    platform,
                    remote_ssh::bootstrap_script(platform),
                    &job,
                    &askpass,
                )?;
                let info: Value = serde_json::from_str(output.lines().last().unwrap_or(""))
                    .map_err(|_| "Host setup returned an invalid response")?;
                target.remote_port = info
                    .get("port")
                    .and_then(Value::as_u64)
                    .and_then(|v| u16::try_from(v).ok())
                    .filter(|p| *p > 0)
                    .ok_or("Host did not report a valid port")?;
                job.message("Pairing this desktop with the host…");
                let pair = remote_ssh::run_script(
                    &dial,
                    platform,
                    remote_ssh::pairing_script(platform, &remote_ssh::device_name()),
                    &job,
                    &askpass,
                )?;
                let pair: Value = serde_json::from_str(pair.lines().last().unwrap_or(""))
                    .map_err(|_| "Host pairing returned an invalid response")?;
                let token = pair
                    .get("token")
                    .and_then(Value::as_str)
                    .filter(|s| {
                        s.len() == 43
                            && s.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                    })
                    .ok_or("Host returned an invalid device credential")?
                    .to_string();
                let environment_id = pair
                    .get("environmentId")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .ok_or("Host identity is missing")?
                    .to_string();
                StoredMachine {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    endpoint: format!("ssh://{}", target.target),
                    environment_id,
                    token,
                    ssh: Some(target.clone()),
                    local_host: false,
                }
            };
            job.message("Opening the secure connection…");
            let connect = |target: &SshTarget| -> Result<(Tunnel, Value), String> {
                let tunnel = Tunnel::start(target, Some(&job), Some(&askpass))?;
                let descriptor = rpc(
                    &format!("http://127.0.0.1:{}", tunnel.port),
                    &machine.token,
                    Some(&machine.environment_id),
                    "environment.describe",
                    json!({}),
                )?;
                Ok((tunnel, descriptor))
            };
            let (tunnel, descriptor) = match connect(&target) {
                Ok(connected) => connected,
                // A reconnect to a host that now listens elsewhere (it was
                // reinstalled or updated): ask it over SSH and retry once.
                Err(error) if !adding && !upgrade && port_may_have_moved(&error) => {
                    job.message("Looking for the host on the machine…");
                    let (platform, dial) = remote_ssh::detect_platform(&target, &job, &askpass)?;
                    let output = remote_ssh::run_script(
                        &dial,
                        platform,
                        remote_ssh::connection_info_script(platform),
                        &job,
                        &askpass,
                    )
                    .map_err(|_| error.clone())?;
                    match reported_port(&output) {
                        Some(port) if port != target.remote_port => {
                            target.remote_port = port;
                            machine.ssh = Some(target.clone());
                            job.message("Opening the secure connection…");
                            connect(&target)?
                        }
                        _ => return Err(error),
                    }
                }
                Err(error) => return Err(error),
            };
            if descriptor.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
                return Err("This host uses an incompatible protocol version".into());
            }
            if descriptor.get("environmentId").and_then(Value::as_str)
                != Some(&machine.environment_id)
            {
                return Err(
                    "Host identity changed: this address now answers as a different host, usually after it was reinstalled. Add the machine again with the same address; it replaces this connection."
                        .into(),
                );
            }
            if upgrade {
                let capabilities = descriptor.get("capabilities").and_then(Value::as_array);
                let supports = |name: &str| {
                    capabilities.is_some_and(|entries| {
                        entries.iter().any(|entry| entry.as_str() == Some(name))
                    })
                };
                if !supports("git.index")
                    || !supports("files.list")
                    || !supports("files.create")
                    || !supports("files.searchContent")
                {
                    return Err("The installed host package still lacks Explorer and Changes. Install a newer bycoda release with updated host packages.".into());
                }
            }
            if machine.name.trim().is_empty() {
                machine.name = descriptor
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&target.target)
                    .chars()
                    .take(100)
                    .collect();
            }
            Ok((machine, tunnel))
        })();
        job.complete(|| {
            let (mut machine, mut tunnel) = prepared?;
            let state = app.state::<RemoteConnections>();
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let path = store_path(&app)?;
            let mut machines = read(&path)?;
            if let Some(old) = machines
                .iter()
                .find(|m| m.environment_id == machine.environment_id)
            {
                merge_known_machine(&mut machine, old, adding, named);
                if let Some(ssh) = &machine.ssh {
                    tunnel.retarget(ssh.clone());
                }
            } else if let Some(old) = adding
                .then(|| replaced_machine(&machines, &machine))
                .flatten()
            {
                // The same SSH machine whose host was replaced: take over its
                // saved entry instead of leaving a dead duplicate beside it.
                machine.id = old.id.clone();
                if !named {
                    machine.name = old.name.clone();
                }
                state.tunnels.remove(&machine.id);
            }
            machines.retain(|m| m.id != machine.id);
            machines.push(machine.clone());
            write(&path, &machines)?;
            state
                .tunnels
                .insert(machine.id.clone(), &machine.environment_id, tunnel);
            Ok(machine.public())
        });
    });
    Ok(id)
}

#[tauri::command(async)]
pub fn remote_ssh_begin(
    app: AppHandle,
    target: String,
    name: String,
    port: Option<u16>,
    alternate: Option<String>,
) -> Result<String, String> {
    let target = remote_ssh::validate_target(&target, port)?;
    let alternate = remote_ssh::validate_alternate(alternate.as_deref(), port)?
        .filter(|alternate| *alternate != target);
    start_ssh_job(
        app,
        SshTarget {
            target,
            port,
            remote_port: 3776,
            alternate,
            host_key_alias: None,
            identity_file: None,
        },
        name.trim().chars().take(100).collect(),
        None,
        false,
    )
}

#[tauri::command(async)]
pub fn remote_ssh_reconnect(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    machine_id: String,
    upgrade: Option<bool>,
) -> Result<String, String> {
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store_path(&app)?)?
            .into_iter()
            .find(|m| m.id == machine_id)
            .ok_or("Machine is no longer connected")?
    };
    let target = machine
        .ssh
        .clone()
        .ok_or("This connection does not use SSH")?;
    start_ssh_job(
        app,
        target,
        machine.name.clone(),
        Some(machine),
        upgrade.unwrap_or(false),
    )
}

#[tauri::command]
pub fn remote_ssh_poll(
    state: State<'_, RemoteConnections>,
    job_id: String,
) -> Result<JobView, String> {
    Ok(state.job(&job_id)?.view())
}

#[tauri::command]
pub fn remote_ssh_answer(
    state: State<'_, RemoteConnections>,
    job_id: String,
    prompt_id: String,
    answer: String,
) -> Result<(), String> {
    state.job(&job_id)?.answer(&prompt_id, answer)
}

#[tauri::command]
pub fn remote_ssh_cancel(
    state: State<'_, RemoteConnections>,
    job_id: String,
) -> Result<(), String> {
    state.job(&job_id)?.cancel();
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn refused_tunnel_recovery_preserves_the_original_command() {
        let command = serde_json::json!({
            "type": "send", "commandId": "original", "sessionId": "remote", "text": "hello"
        });
        let mut attempts = Vec::new();
        let mut deliveries = Vec::new();
        let receipt = super::with_refused_tunnel_retry(true, || {
            attempts.push(command.clone());
            if attempts.len() == 1 {
                return Err(super::CONNECTION_REFUSED.to_owned());
            }
            deliveries.push(command.clone());
            Ok(serde_json::json!({"commandId": command["commandId"]}))
        })
        .unwrap();
        assert_eq!(receipt["commandId"], "original");
        assert_eq!(attempts, vec![command.clone(), command.clone()]);
        assert_eq!(deliveries, vec![command]);
    }

    #[test]
    fn refused_tunnel_recovery_is_bounded_and_respects_reconnect_policy() {
        for (allow, expected) in [(true, 2), (false, 1)] {
            let mut attempts = 0;
            let result: Result<(), String> = super::with_refused_tunnel_retry(allow, || {
                attempts += 1;
                Err(super::CONNECTION_REFUSED.to_owned())
            });
            assert_eq!(result.unwrap_err(), super::CONNECTION_REFUSED);
            assert_eq!(attempts, expected);
        }
    }

    #[test]
    fn ambiguous_or_authorization_failures_never_replay_a_command() {
        for error in [
            "The host request did not complete [RPC_HOST_UNAVAILABLE] (commands.dispatch).",
            "The host request did not complete [RPC_TIMEOUT] (commands.dispatch).",
            "Host rejected request [RPC_AUTHORIZATION] (commands.dispatch).",
            "Machine is unreachable. Automatic reconnect is off; reconnect it yourself.",
            "Host is not running on the machine. Start bycoda Host there, then reconnect.",
        ] {
            let mut deliveries = 0;
            let result: Result<(), String> = super::with_refused_tunnel_retry(true, || {
                deliveries += 1;
                Err(error.to_owned())
            });
            assert_eq!(result.unwrap_err(), error);
            assert_eq!(deliveries, 1, "{error}");
        }
    }

    #[test]
    fn a_host_that_accepts_a_command_then_disconnects_is_not_sent_it_again() {
        use std::io::{BufRead, BufReader};
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::{net::TcpListener, thread, time::Duration};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let done = Arc::new(AtomicBool::new(false));
        let server_done = done.clone();
        let server = thread::spawn(move || {
            let mut delivered = Vec::new();
            while !server_done.load(Ordering::SeqCst) {
                let (stream, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("{error}"),
                };
                // Accepted sockets can inherit the listener's nonblocking mode
                // on macOS; the fixture parses its HTTP request synchronously.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(stream);
                let mut size = 0;
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).unwrap() > 0);
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        size = value.trim().parse::<usize>().unwrap();
                    }
                }
                let mut body = vec![0; size];
                reader.read_exact(&mut body).unwrap();
                delivered.push(serde_json::from_slice::<Value>(&body).unwrap());
                // The host accepted the body, but its acknowledgement is lost.
                // Closing this stream must leave the command for receipt recovery.
            }
            delivered
        });
        let command = json!({"type": "send", "commandId": "lost-receipt", "sessionId": "remote"});
        let result = super::with_refused_tunnel_retry(true, || {
            super::rpc(
                &endpoint,
                "fixture",
                Some("env"),
                "commands.dispatch",
                command.clone(),
            )
        });
        done.store(true, Ordering::SeqCst);
        let delivered = server.join().unwrap();
        assert!(result.unwrap_err().contains("RPC_HOST_UNAVAILABLE"));
        assert_eq!(delivered.len(), 1);
        assert_eq!(delivered[0]["params"], command);
    }

    #[test]
    fn request_results_belong_to_the_original_saved_route() {
        let started = saved("route", "me@original");
        let mut current = started.clone();
        current.name = "Renamed".into();
        assert!(same_request_route(&started, &current));
        current.endpoint = "https://replacement.test".into();
        assert!(!same_request_route(&started, &current));
        let mut current = started.clone();
        current.token.push_str("-rotated");
        assert!(!same_request_route(&started, &current));
        let mut current = started.clone();
        current.ssh.as_mut().unwrap().target = "me@replacement".into();
        assert!(!same_request_route(&started, &current));
        let mut current = started.clone();
        current.environment_id.push_str("-replacement");
        assert!(!same_request_route(&started, &current));
    }
    #[test]
    fn conversation_machine_requests_do_not_use_a_stale_saved_ssh_endpoint() {
        let state = super::RemoteConnections::default();
        let mut machine = saved("mac", "me@192.168.1.20");
        machine.endpoint = "http://127.0.0.1:1".to_owned();
        let error = super::machine_rpc(
            &state,
            &machine,
            "devices.status",
            serde_json::json!({}),
            false,
        )
        .unwrap_err();
        assert!(error.contains("Automatic reconnect is off"), "{error}");
    }
    #[test]
    fn transport_diagnostics_identify_timeouts_without_echoing_secrets() {
        let error = ureq::Error::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "https://user:secret@host/?token=secret",
        ));
        let ureq::Error::Transport(error) = error else {
            panic!("Expected transport error")
        };
        let message = super::rpc_transport_failure(&error, "devices.status");
        assert!(message.contains("RPC_TIMEOUT"));
        assert!(message.contains("devices.status"));
        assert!(!message.contains("secret"));
        for method in [
            "devices.preflight",
            "devices.preview",
            "devices.preview.status",
        ] {
            assert!(super::supported_remote_method(method));
        }
    }
    #[test]
    fn interrupted_diagnostics_include_only_known_actions_and_no_credentials() {
        let params =
            serde_json::json!({"command":"read_text_file","path":"secret-path","token":"secret"});
        let operation = super::rpc_operation("workspace.run", &params);
        assert_eq!(operation, "workspace.run:read_text_file");
        assert_eq!(
            super::rpc_operation("workspace.run", &serde_json::json!({"command":"secret"})),
            "workspace.run"
        );
        let error = ureq::Error::from(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "https://user:secret@host",
        ));
        let ureq::Error::Transport(error) = error else {
            panic!("Expected transport error")
        };
        let message = super::rpc_transport_failure(&error, &operation);
        assert!(message.contains("RPC_HOST_UNAVAILABLE"));
        assert!(message.contains("read_text_file"));
        assert!(!message.contains("secret"));
    }
    #[test]
    fn shared_session_queue_methods_reach_the_host() {
        // Hosts advertise sessions.queue, so the native bridge must pass through
        // every operation used to restore, edit, claim and acknowledge the queue.
        for method in [
            "sessions.queue.get",
            "sessions.queue.change",
            "sessions.queue.claim",
            "sessions.queue.finish",
            "sessions.queue.lease",
            "sessions.queue.release",
            "sessions.runLease",
        ] {
            assert!(super::supported_remote_method(method), "{method}");
        }
        assert!(!super::supported_remote_method("sessions.queue"));
        assert!(!super::supported_remote_method("sessions.queue.delete"));
        assert!(!super::supported_remote_method("sessions.queue.clear"));
    }

    #[test]
    fn crew_work_operations_are_forwarded() {
        for method in [
            "crews.start",
            "crews.pause",
            "crews.resume",
            "crews.stop",
            "crews.deleteRun",
        ] {
            assert!(super::supported_remote_method(method), "{method}");
        }
        assert!(!super::supported_remote_method("crews.deleteAll"));
    }
    #[test]
    fn host_tools_methods_are_allowed_but_unknown_methods_are_not() {
        for method in [
            "mcp.tokens.create",
            "mcp.tokens.list",
            "mcp.tokens.revoke",
            "browser.claim",
            "browser.close",
            "browser.frame",
            "browser.input",
            "browser.open",
            "browser.release",
            "browser.status",
            "browser.setup",
            "browser.annotation.start",
            "browser.annotation.hover",
            "browser.annotation.select",
            "browser.annotation.clear",
            "browser.annotation.read",
            "browser.annotation.cancel",
            "devServers.list",
            "automations.preview",
            "devServers.details",
            "devServers.start",
            "devServers.stop",
            "devServers.kill",
            "devServers.restart",
            "devServers.logs",
            "devServers.openExternal",
            "terminals.list",
            "terminals.create",
            "terminals.read",
            "terminals.write",
            "terminals.interrupt",
            "terminals.close",
            "runtimeLogs.read",
            "runtimeLogs.sources",
            "runtimeLogs.monitors.list",
            "runtimeLogs.monitors.start",
            "runtimeLogs.monitors.stop",
            "resources.read",
            "devices.status",
            "devices.setup",
            "devices.start",
            "devices.stop",
            "devices.list",
            "devices.boot",
            "devices.capture",
            "devices.action",
            "mobile.access.status",
            "mobile.access.enable",
            "tunnels.status",
            "tunnels.start",
            "tunnels.stop",
            "tunnels.credential",
            "mobile.pairing.create",
            "mobile.pairing.status",
            "mobile.pairing.cancel",
        ] {
            assert!(super::supported_remote_method(method), "{method}");
        }
        assert!(!super::supported_remote_method("browser.execute"));
        assert!(!super::supported_remote_method("mcp.tokens.update"));
        assert!(!super::supported_remote_method("mcp.tokens.read"));
        assert!(!super::supported_remote_method("removed.feature"));
        assert!(!super::supported_remote_method("devices.exec"));
        assert!(!super::supported_remote_method("terminals.exec"));
        assert!(!super::supported_remote_method("terminals.resize"));
        assert!(!super::supported_remote_method("removed.pr-feature"));
        assert!(!super::supported_remote_method("resources.delete"));
        assert!(!super::supported_remote_method("mobile.pairing.redeem"));
    }

    #[test]
    fn sharing_never_serializes_writes_behind_a_read() {
        for method in [
            "mobile.access.enable",
            "mobile.pairing.create",
            "mobile.pairing.cancel",
        ] {
            assert!(!super::shareable_remote_read(
                method,
                &serde_json::json!({})
            ));
        }
        assert!(super::shareable_remote_read(
            "git.index",
            &serde_json::json!({"projectId":"p"})
        ));
        assert!(super::shareable_remote_read(
            "git.fileDiff",
            &serde_json::json!({"projectId":"p","path":"a.txt"})
        ));
        assert!(!super::shareable_remote_read(
            "git.action",
            &serde_json::json!({"action":"commit"})
        ));
        assert!(super::shareable_remote_read(
            "workspace.run",
            &serde_json::json!({"command":"stat_files"})
        ));
        assert!(!super::shareable_remote_read(
            "workspace.run",
            &serde_json::json!({"command":"git_commit"})
        ));
        assert!(!super::shareable_remote_read(
            "commands.dispatch",
            &serde_json::json!({"type":"cancel"})
        ));
    }
    use super::*;

    #[test]
    fn task_preparation_and_review_methods_preserve_read_and_mutation_boundaries() {
        assert!(supported_remote_method("tasks.preflight"));
        assert!(shareable_remote_read("tasks.preflight", &json!({})));
        for method in ["tasks.evaluation.save", "goals.final-review.recheck"] {
            assert!(supported_remote_method(method));
            assert!(!shareable_remote_read(method, &json!({})));
        }
        assert!(!supported_remote_method("tasks.preflight.install"));
        assert!(!supported_remote_method("tasks.evaluation.delete"));
    }

    #[test]
    fn review_note_commands_are_supported_without_allowing_arbitrary_note_methods() {
        assert!(supported_remote_method("tasks.notes.read"));
        assert!(supported_remote_method("tasks.notes.resolve"));
        assert!(supported_remote_method("tasks.review.recheck"));
        assert!(!supported_remote_method("tasks.notes.delete"));
    }

    #[test]
    fn sprint_methods_are_bounded_and_preserve_existing_request_routing() {
        for method in [
            "tasks.snapshotWithCursor",
            "tasks.events",
            "sprints.list",
            "sprints.get",
            "sprints.create",
            "sprints.update",
            "sprints.start",
            "sprints.complete",
            "sprints.archive",
            "sprints.plan",
            "sprints.report",
            "sprints.ingest",
            "sprints.goalContext",
        ] {
            assert!(supported_remote_method(method), "{method}");
            assert!(!shareable_remote_read(method, &json!({})), "{method}");
        }
        for method in ["tasks.events.delete", "sprints.delete", "sprints.execute"] {
            assert!(!supported_remote_method(method), "{method}");
        }
    }

    #[test]
    fn voice_rpc_methods_are_bounded_and_model_loading_has_time_to_finish() {
        use std::time::Duration;
        for method in [
            "voice.local.inspect",
            "voice.local.start",
            "voice.local.transcribe",
            "voice.local.keepAlive",
            "voice.local.release",
            "voice.local.speak",
            "voice.local.speechNext",
            "voice.local.speechCancel",
        ] {
            assert!(supported_remote_method(method), "{method}");
        }
        assert!(!supported_remote_method("voice.local.install"));
        assert!(!supported_remote_method("voice.local.exec"));
        assert!(rpc_timeout("voice.local.start", &json!({})) >= Duration::from_secs(180));
        assert!(rpc_timeout("voice.local.inspect", &json!({})) >= Duration::from_secs(60));
        assert!(rpc_timeout("voice.local.transcribe", &json!({})) >= Duration::from_secs(40));
        assert_eq!(
            rpc_timeout("voice.local.speechNext", &json!({})),
            DEFAULT_RPC_TIMEOUT
        );
    }

    #[test]
    fn git_actions_outlast_the_hosts_network_limit_and_others_keep_the_default() {
        use std::time::Duration;
        // Allow queue admission, safety reads, and both 120 s sync commands.
        let none = json!({});
        assert!(rpc_timeout("git.action", &none) >= Duration::from_secs(135));
        for command in [
            "git_push",
            "git_pull",
            "git_sync",
            "git_fetch",
            "git_commit",
            "git_stage_files",
            "git_unstage_files",
            "git_discard_files",
            "git_stage_contents",
            "git_checkout",
        ] {
            let run = json!({ "command": command });
            assert!(rpc_timeout("workspace.run", &run) >= Duration::from_secs(450));
        }
        for method in ["git.switch", "git.createBranch", "git.worktreeCreate"] {
            assert!(rpc_timeout(method, &none) >= Duration::from_secs(450));
        }
        for command in [
            "git_diff_index",
            "git_file_diff",
            "git_operation_status",
            "git_pr_status",
            "git_blame",
        ] {
            assert_eq!(
                rpc_timeout("workspace.run", &json!({"command": command})),
                DEFAULT_RPC_TIMEOUT
            );
        }
        let read = json!({ "command": "read_text_file" });
        assert_eq!(rpc_timeout("workspace.run", &read), DEFAULT_RPC_TIMEOUT);
        assert_eq!(rpc_timeout("workspace.run", &none), DEFAULT_RPC_TIMEOUT);
        assert_eq!(rpc_timeout("git.index", &none), DEFAULT_RPC_TIMEOUT);
        assert_eq!(
            rpc_timeout("environment.describe", &none),
            DEFAULT_RPC_TIMEOUT
        );
    }

    #[test]
    fn model_catalog_outlasts_provider_discovery() {
        assert!(rpc_timeout("models.list", &json!({})) > std::time::Duration::from_secs(45));
    }

    #[test]
    fn conversation_tools_outlast_host_setup_and_device_operations() {
        use std::time::Duration;
        let params = json!({});
        // npm + Chromium/hub/agent installation each have a 600 s deadline.
        for method in ["browser.setup", "devices.setup"] {
            assert!(rpc_timeout(method, &params) >= Duration::from_secs(1230));
        }
        // Hub readiness takes 30 s; boot can take 180 s plus device listing;
        // control can chain session list (30 s), open (60 s) and input (30 s).
        assert!(rpc_timeout("devices.start", &params) >= Duration::from_secs(60));
        assert!(rpc_timeout("devices.boot", &params) >= Duration::from_secs(240));
        assert!(rpc_timeout("devices.action", &params) >= Duration::from_secs(180));
        for method in [
            "devices.status",
            "devices.list",
            "devices.capture",
            "devices.stop",
            "browser.status",
            "browser.frame",
            "resources.read",
            "devices.exec",
        ] {
            assert_eq!(
                rpc_timeout(method, &params),
                DEFAULT_RPC_TIMEOUT,
                "{method}"
            );
        }
    }

    #[test]
    fn rpc_reuses_a_connection_without_reusing_request_credentials() {
        use std::io::{BufRead, BufReader};
        use std::{net::TcpListener, thread, time::Duration};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut authorizations = Vec::new();
            for _ in 0..2 {
                let mut size = 0;
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).unwrap() > 0);
                    if line == "\r\n" {
                        break;
                    }
                    let lower = line.to_ascii_lowercase();
                    if lower.starts_with("content-length:") {
                        size = line
                            .split(':')
                            .nth(1)
                            .unwrap()
                            .trim()
                            .parse::<usize>()
                            .unwrap();
                    }
                    if lower.starts_with("authorization:") {
                        authorizations.push(line.trim().to_string());
                    }
                }
                let mut body = vec![0; size];
                reader.read_exact(&mut body).unwrap();
                let body = r#"{"result":{"ok":true}}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
                stream.flush().unwrap();
            }
            authorizations
        });
        assert_eq!(
            rpc(
                &url,
                "first",
                Some("env"),
                "environment.describe",
                json!({})
            )
            .unwrap(),
            json!({"ok": true})
        );
        assert_eq!(
            rpc(
                &url,
                "second",
                Some("env"),
                "environment.describe",
                json!({})
            )
            .unwrap(),
            json!({"ok": true})
        );
        let headers = server.join().unwrap();
        assert!(headers[0].ends_with("Bearer first"));
        assert!(headers[1].ends_with("Bearer second"));
    }
    #[test]
    fn a_slow_host_does_not_look_like_a_dead_tunnel() {
        use std::{net::TcpListener, thread, time::Duration};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(200));
        });
        let error = ureq::get(&url)
            .timeout(Duration::from_millis(50))
            .call()
            .unwrap_err();
        let ureq::Error::Transport(error) = error else {
            panic!("Expected a timeout")
        };
        assert!(!connection_refused(&error));
        server.join().unwrap();
        // A freed ephemeral port can be claimed by another parallel fixture.
        // Exercise ureq's actual wrapped I/O source without that port race.
        let error = ureq::Error::from(std::io::Error::from(std::io::ErrorKind::ConnectionRefused));
        let ureq::Error::Transport(error) = error else {
            panic!("Expected a refused connection")
        };
        assert!(connection_refused(&error));
    }

    #[test]
    fn desktop_social_client_methods_cross_the_native_allowlist_without_privileged_wildcards() {
        // This is the actual renderer client, not a second manually maintained RPC catalog.
        let client = include_str!("../../src/features/social/model/socialClient.ts");
        let methods: Vec<_> = client
            .split('"')
            .enumerate()
            .filter(|(index, _)| index % 2 == 1)
            .map(|(_, value)| value)
            .filter(|value| {
                value.starts_with("social.")
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
            })
            .collect();
        assert!(
            methods.len() >= 20,
            "the renderer RPC extraction must not pass vacuously"
        );
        for method in methods {
            assert!(
                supported_remote_method(method),
                "renderer RPC blocked by native bridge: {method}"
            );
        }
        for method in [
            "social.tools.call",
            "social.native.register",
            "social.native.authority",
            "social.browser.cookies",
            "social.browser.profile.delete",
            "social.browser.registration.force",
            "social.browser.registration.submit.admin",
        ] {
            assert!(
                !supported_remote_method(method),
                "unreviewed privilege or wildcard: {method}"
            );
        }
    }

    #[test]
    fn desktop_forwards_supported_host_operations() {
        for method in [
            "projects.createDirectory",
            "git.branches",
            "git.switch",
            "git.createBranch",
            "git.worktrees",
            "git.worktreeCreate",
            "attachments.upload",
            "attachments.read",
            "attachments.claim",
            "attachments.claims",
            "attachments.release",
            "sync.pull",
            "sync.push",
            "social.browser.availability",
            "social.browser.begin",
            "social.browser.status",
            "social.token.connect",
            "social.tiktok.creator",
        ] {
            assert!(supported_remote_method(method), "{method}");
        }
        assert!(!supported_remote_method("git.arbitrary"));
        assert!(!supported_remote_method("social.browser.cookies"));
        for method in ["attachments.claim", "attachments.release"] {
            assert!(!super::shareable_remote_read(
                method,
                &serde_json::json!({})
            ));
        }
    }
    #[test]
    fn endpoints_require_an_encrypted_route_and_no_embedded_secrets() {
        assert_eq!(
            endpoint("http://127.0.0.1:3774/").unwrap(),
            "http://127.0.0.1:3774"
        );
        assert!(endpoint("http://[::1]:3774").is_ok());
        assert!(endpoint("https://host.example").is_ok());
        for url in [
            "http://192.168.1.5:3774",
            "file:///tmp/socket",
            "https://user:secret@host.example",
            "https://host.example/rpc",
            "https://host.example?token=secret",
            "https://host.example#secret",
        ] {
            assert!(endpoint(url).is_err(), "{url}");
        }
    }
    #[test]
    fn re_adding_a_reinstalled_host_replaces_its_dead_entry() {
        let mut old = saved("old-id", "me@192.168.1.20");
        old.environment_id = "env-old".into();
        let other = saved("other", "me@192.168.1.30");
        let mut new = saved("new-id", "ME@192.168.1.20");
        new.environment_id = "env-new".into();
        let machines = vec![old, other];
        assert_eq!(
            replaced_machine(&machines, &new).map(|m| m.id.as_str()),
            Some("old-id")
        );

        // Reached through its other address, it is still the same machine.
        let mut by_alternate = saved("new-id", "me@100.64.0.20");
        by_alternate.environment_id = "env-new".into();
        let mut known = saved("old-id", "me@192.168.1.20");
        known.ssh.as_mut().unwrap().alternate = Some("me@100.64.0.20".into());
        assert!(replaced_machine(&[known], &by_alternate).is_some());

        // A different address or SSH port is a different machine.
        let mut elsewhere = saved("new-id", "me@192.168.1.99");
        elsewhere.environment_id = "env-new".into();
        assert!(replaced_machine(&machines, &elsewhere).is_none());
        let mut other_port = new.clone();
        other_port.ssh.as_mut().unwrap().port = Some(2222);
        assert!(replaced_machine(&machines, &other_port).is_none());
    }

    #[test]
    fn retries_on_another_port_only_for_unreachable_hosts() {
        assert!(port_may_have_moved(
            "Machine is unreachable. Check the host and SSH tunnel, then reconnect."
        ));
        assert!(port_may_have_moved(
            "The host request did not complete. Retry to confirm its result."
        ));
        assert!(!port_may_have_moved("Host rejected request: Unauthorized"));
        assert!(!port_may_have_moved(
            "Host identity changed: this address answers as a different machine."
        ));
        assert!(!port_may_have_moved(
            "This host uses an incompatible protocol version"
        ));
    }

    #[test]
    fn reads_the_port_from_connection_info() {
        assert_eq!(
            reported_port("Starting\n{\"port\":3776,\"pid\":12}\n"),
            Some(3776)
        );
        assert_eq!(reported_port("{\"port\":0}"), None);
        assert_eq!(reported_port("not json"), None);
        assert_eq!(reported_port(""), None);
    }

    #[test]
    fn only_automatic_loopback_links_count_as_local_sync() {
        let local = |endpoint: &str| StoredMachine {
            id: endpoint.into(),
            name: "This computer (local sync)".into(),
            endpoint: endpoint.into(),
            environment_id: "env".into(),
            token: "secret-token".into(),
            ssh: None,
            local_host: false,
        };
        let name = "This computer (local sync)";
        assert!(is_local_sync(&local("http://127.0.0.1:3774"), name));
        assert!(is_local_sync(&local("http://localhost:3776"), name));
        assert!(!is_local_sync(&local("http://192.168.1.5:3776"), name));
        assert!(!is_local_sync(&saved("mac", "me@192.168.1.5"), name));
        let mut renamed = local("http://127.0.0.1:3774");
        renamed.name = "Build box".into();
        assert!(!is_local_sync(&renamed, name));
        mark_local_host_record(&mut renamed, "http://127.0.0.1:3774").unwrap();
        assert!(is_local_sync(&renamed, name));
        assert_eq!(renamed.name, "Build box");
        let stored = serde_json::to_value(&renamed).unwrap();
        assert_eq!(stored["localHost"], true);
        let restored: StoredMachine = serde_json::from_value(stored).unwrap();
        assert!(is_local_sync(&restored, name));
        assert_eq!(
            serde_json::to_value(restored.public()).unwrap()["localHost"],
            true
        );
    }

    #[test]
    fn marking_local_host_rejects_ssh_and_other_endpoints() {
        let mut tunnel = saved("tunnel", "me@server");
        tunnel.endpoint = "http://127.0.0.1:3774".into();
        tunnel.name = "This computer (local sync)".into();
        assert!(mark_local_host_record(&mut tunnel, "http://127.0.0.1:3774").is_err());
        tunnel.local_host = true;
        assert!(!is_local_sync(&tunnel, "This computer (local sync)"));

        let mut direct = saved("direct", "me@server");
        direct.ssh = None;
        direct.endpoint = "http://127.0.0.1:3775".into();
        assert!(mark_local_host_record(&mut direct, "http://127.0.0.1:3774").is_err());
        assert!(!direct.local_host);
        direct.endpoint = "https://host.example".into();
        assert!(mark_local_host_record(&mut direct, "https://host.example").is_err());
        assert!(!direct.local_host);
    }

    #[test]
    fn older_connection_stores_default_to_no_local_host_marker() {
        let machine: StoredMachine = serde_json::from_value(json!({
            "id": "legacy", "name": "This computer (local sync)",
            "endpoint": "http://127.0.0.1:3774", "environmentId": "env",
            "token": "secret-token", "ssh": null
        }))
        .unwrap();
        assert!(!machine.local_host);
        assert!(is_local_sync(&machine, "This computer (local sync)"));
        assert!(serde_json::to_value(machine.public())
            .unwrap()
            .get("localHost")
            .is_none());
    }

    fn saved(id: &str, target: &str) -> StoredMachine {
        StoredMachine {
            id: id.into(),
            name: "Home Mac".into(),
            endpoint: format!("ssh://{target}"),
            environment_id: format!("env-{id}"),
            token: "secret-token".into(),
            local_host: false,
            ssh: Some(SshTarget {
                target: target.into(),
                port: None,
                remote_port: 3999,
                alternate: None,
                host_key_alias: None,
                identity_file: None,
            }),
        }
    }

    #[test]
    fn editing_the_address_keeps_identity_and_credentials() {
        let mut machines = vec![saved("a", "me@192.168.1.5"), saved("b", "me@other")];
        machines[0].ssh.as_mut().unwrap().identity_file = Some("C:/keys/mac".into());
        let edited = apply_edit(
            &mut machines,
            "a",
            " Mac ",
            "me@new.local".into(),
            Some(2222),
            Some("me@100.64.0.5".into()),
            None,
        )
        .unwrap();
        assert_eq!(edited.id, "a");
        assert_eq!(edited.environment_id, "env-a");
        assert_eq!(edited.token, "secret-token");
        assert_eq!(edited.name, "Mac");
        assert_eq!(edited.endpoint, "ssh://me@new.local");
        let ssh = edited.ssh.unwrap();
        assert_eq!(ssh.identity_file.as_deref(), Some("C:/keys/mac"));
        assert_eq!(
            (ssh.target.as_str(), ssh.port, ssh.remote_port),
            ("me@new.local", Some(2222), 3999)
        );
        assert_eq!(ssh.alternate.as_deref(), Some("me@100.64.0.5"));
        // Only the edited machine changed, and a blank name keeps the old one.
        assert_eq!(machines[1].ssh.as_ref().unwrap().target, "me@other");
        let again = apply_edit(
            &mut machines,
            "a",
            "  ",
            "me@new.local".into(),
            Some(2222),
            None,
            None,
        )
        .unwrap();
        assert_eq!(again.name, "Mac");
    }

    #[test]
    fn adding_a_known_machine_from_another_address_keeps_both() {
        let old = StoredMachine {
            name: "llm".into(),
            ..saved("a", "me@192.168.1.20")
        };
        let mut added = StoredMachine {
            name: "Alex's MacBook Pro".into(),
            token: "new-token".into(),
            ..saved("fresh-id", "me@100.64.0.20")
        };
        merge_known_machine(&mut added, &old, true, false);
        assert_eq!(added.id, "a");
        assert_eq!(added.name, "llm");
        assert_eq!(added.token, "new-token");
        assert_eq!(added.endpoint, "ssh://me@192.168.1.20");
        let ssh = added.ssh.unwrap();
        assert_eq!(ssh.target, "me@192.168.1.20");
        assert_eq!(ssh.alternate.as_deref(), Some("me@100.64.0.20"));
    }

    #[test]
    fn adding_a_known_machine_again_keeps_its_other_address_and_a_new_name() {
        let mut old = saved("a", "me@home");
        old.ssh.as_mut().unwrap().alternate = Some("me@tailnet".into());
        let mut added = StoredMachine {
            name: "Studio".into(),
            ..saved("fresh-id", "me@home")
        };
        merge_known_machine(&mut added, &old, true, true);
        assert_eq!(added.name, "Studio");
        assert_eq!(added.ssh.unwrap().alternate.as_deref(), Some("me@tailnet"));
    }

    #[test]
    fn reconnecting_a_machine_keeps_its_identity_and_latest_saved_key() {
        let mut old = saved("a", "me@home");
        old.ssh.as_mut().unwrap().identity_file = Some("C:/keys/latest".into());
        let mut again = saved("fresh-id", "me@moved");
        again.ssh.as_mut().unwrap().identity_file = Some("C:/keys/outdated".into());
        merge_known_machine(&mut again, &old, false, false);
        assert_eq!(again.id, "a");
        let ssh = again.ssh.unwrap();
        assert_eq!(ssh.target, "me@moved");
        assert_eq!(ssh.identity_file.as_deref(), Some("C:/keys/latest"));
    }

    #[test]
    fn adding_with_an_explicit_alternate_keeps_it() {
        let old = saved("a", "me@home");
        let mut added = saved("fresh-id", "me@home");
        added.ssh.as_mut().unwrap().alternate = Some("me@tailnet".into());
        merge_known_machine(&mut added, &old, true, false);
        assert_eq!(added.id, "a");
        assert_eq!(added.ssh.unwrap().alternate.as_deref(), Some("me@tailnet"));
    }

    #[test]
    fn only_a_saved_ssh_machine_can_be_edited() {
        let mut machines = vec![saved("a", "me@home")];
        machines[0].ssh = None;
        assert!(apply_edit(&mut machines, "a", "", "me@x".into(), None, None, None).is_err());
        assert!(apply_edit(
            &mut machines,
            "missing",
            "",
            "me@x".into(),
            None,
            None,
            None
        )
        .is_err());
    }

    #[test]
    fn editing_host_port_keeps_ssh_port_identity_and_credentials() {
        let mut machines = vec![saved("a", "me@home")];
        let edited = apply_edit(
            &mut machines,
            "a",
            "",
            "me@home".into(),
            Some(2222),
            None,
            Some(3776),
        )
        .unwrap();
        assert_eq!(edited.ssh.as_ref().unwrap().remote_port, 3776);
        assert_eq!(edited.ssh.as_ref().unwrap().port, Some(2222));
        assert_eq!(edited.id, "a");
        assert_eq!(edited.environment_id, "env-a");
        assert_eq!(edited.token, "secret-token");
        let unchanged = apply_edit(
            &mut machines,
            "a",
            "Renamed",
            "me@home".into(),
            Some(2222),
            None,
            None,
        )
        .unwrap();
        assert_eq!(unchanged.ssh.as_ref().unwrap().remote_port, 3776);
        assert!(apply_edit(
            &mut machines,
            "a",
            "",
            "me@home".into(),
            None,
            None,
            Some(0)
        )
        .is_err());
        assert_eq!(machines[0].ssh.as_ref().unwrap().remote_port, 3776);
    }

    #[test]
    fn legacy_host_writes_preserve_ssh_only_records_and_organization() {
        let path =
            std::env::temp_dir().join(format!("bycoda-inventory-{}.json", uuid::Uuid::new_v4()));
        let ssh = json!({"kind":"ssh","id":"ssh-only","name":"Standalone","sshEndpoint":{"host":"example.invalid","port":22},"metadata":{"tags":["a"],"favorite":true}});
        let mut host = serde_json::to_value(saved("host", "owner@host")).unwrap();
        host["metadata"] =
            json!({"group":"Work","tags":[],"favorite":false,"forwards":[{"id":"rule"}]});
        write_store_values(&path, &[host, ssh.clone()]).unwrap();
        let mut hosts = read(&path).unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].id, "host");
        hosts[0].name = "Renamed".into();
        write(&path, &hosts).unwrap();
        let records = read_store_values(&path).unwrap();
        assert!(records.contains(&ssh));
        let host = records
            .iter()
            .find(|record| record["id"] == "host")
            .unwrap();
        assert_eq!(host["metadata"]["group"], "Work");
        assert_eq!(host["metadata"]["forwards"][0]["id"], "rule");
        assert_eq!(host["environmentId"], "env-host");
        assert_eq!(host["token"], "secret-token");
        write(&path, &[]).unwrap();
        assert_eq!(read_store_values(&path).unwrap(), vec![ssh]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn an_edited_store_round_trips_with_the_token_intact() {
        let path = std::env::temp_dir().join(format!("bycoda-edit-{}.json", uuid::Uuid::new_v4()));
        let mut machines = vec![saved("a", "me@192.168.1.5")];
        write(&path, &machines).unwrap();
        apply_edit(
            &mut machines,
            "a",
            "",
            "me@new.local".into(),
            None,
            None,
            None,
        )
        .unwrap();
        write(&path, &machines).unwrap();
        let loaded = read(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].token, "secret-token");
        assert_eq!(loaded[0].ssh.as_ref().unwrap().target, "me@new.local");
    }

    #[test]
    fn public_machine_metadata_never_contains_the_token() {
        let stored = StoredMachine {
            id: "id".into(),
            name: "server".into(),
            endpoint: "https://host.example".into(),
            environment_id: "env".into(),
            token: "secret".into(),
            ssh: None,
            local_host: false,
        };
        let value = serde_json::to_string(&stored.public()).unwrap();
        assert!(!value.contains("secret"));
        assert!(!value.contains("token"));
    }
}
