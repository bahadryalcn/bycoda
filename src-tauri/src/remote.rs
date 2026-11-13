//! Remote host connections. The renderer receives machine metadata, never the
//! saved bearer credential. Workspace requests never fall back to local calls.
use crate::host_ws::{HostWsBroker, NativeRoute, RequestOptions, WsFailure, WsReply};
use crate::remote_routes::{port_may_have_moved, reported_port};
use crate::remote_ssh::{self, Job, JobView, SshTarget, Tunnel, Tunnels};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

#[path = "remote_changes.rs"]
mod changes;

#[path = "remote_native_workspace.rs"]
mod native_workspace_transport;

#[path = "remote_native_commit.rs"]
mod native_commit;
pub(crate) use native_commit::NativeProjection;

#[path = "remote_native_upload.rs"]
mod native_upload;

#[path = "assistant/assistant_native_signer.rs"]
pub(crate) mod assistant_native_signer;
#[path = "assistant/assistant_room_delegation.rs"]
pub(crate) mod assistant_room_delegation;
#[path = "remote_native_service.rs"]
mod native_service;
pub(crate) use native_service::{NativeServiceChannel, NativeServiceReply};

#[path = "remote_native_gateway.rs"]
mod native_gateway;

#[path = "remote_native_devices.rs"]
mod native_devices;
pub(crate) use native_devices::NativeDeviceReply;
#[path = "remote_native_buffer_delivery.rs"]
mod native_buffer_delivery;

#[path = "remote_native_delivery_epochs.rs"]
mod native_delivery_epochs;

#[path = "dev_server_access.rs"]
pub mod dev_access;

#[path = "remote_folder_access.rs"]
pub mod folder_access;

/// Sent to every window when a machine's SSH process ends on its own.
const TUNNEL_EXIT_EVENT: &str = "remote://tunnel-exit";
const HOST_CONNECTION_EVENT: &str = "host-connection-event";

struct WsCapability {
    fingerprint: String,
    enabled: bool,
}

#[derive(Default)]
pub struct RemoteConnections {
    changes: changes::Changes,
    reads: changes::Reads,
    pub(crate) store: Arc<Mutex<()>>,
    pub(crate) tunnels: Tunnels,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    ws: HostWsBroker,
    native_profile_ws: crate::host_ws::native_profile::NativeProfileBroker,
    native_service_ws: crate::host_ws::native_profile::NativeProfileBroker,
    native_service_channel: Mutex<Option<Arc<NativeServiceChannel>>>,
    native_gateway_ws: crate::host_ws::native_profile::NativeProfileBroker,
    native_device_ws: crate::host_ws::native_profile::NativeProfileBroker,
    native_workspace_uploads: Arc<native_upload::NativeUploads>,
    native_buffer_delivery_cursors: Arc<native_buffer_delivery::RecoveryCursors>,
    native_buffer_delivery_ack_cursors: Arc<native_buffer_delivery::RecoveryCursors>,
    ws_capabilities: Mutex<HashMap<String, WsCapability>>,
    /// Local Host `environment.describe` per machine, reused by the managed
    /// send chain instead of one fresh describe per native check.
    native_workspace_descriptors:
        Mutex<HashMap<String, native_workspace_transport::CachedDescriptor>>,
    recovery_routes: Arc<RecoveryRoutes>,
}

/// Native-only retirement history. Saved-row equality cannot detect disconnect /
/// re-pair ABA while an old bearer remains valid on the Host.
#[derive(Default)]
struct RecoveryRoutes {
    revision: AtomicU64,
    closed: AtomicBool,
    commit: Mutex<()>,
}
impl RecoveryRoutes {
    fn retire(&self) {
        let _guard = self
            .commit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.retire_locked();
    }
    fn retire_locked(&self) {
        let _ = self
            .revision
            .try_update(Ordering::AcqRel, Ordering::Acquire, |revision| {
                revision.checked_add(1)
            });
    }
    fn capture(&self) -> Result<u64, String> {
        let revision = self.revision.load(Ordering::Acquire);
        if self.closed.load(Ordering::Acquire) || revision == u64::MAX {
            return Err("Native recovery connection retired".into());
        }
        Ok(revision)
    }
    fn current(&self, revision: u64) -> bool {
        self.capture().is_ok_and(|current| current == revision)
    }
    fn close(&self) {
        let _guard = self
            .commit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.closed.store(true, Ordering::Release);
        self.retire_locked();
    }
}

impl RemoteConnections {
    /// Has the renderer told when a machine's SSH tunnel drops.
    pub fn emit_tunnel_exits(&self, app: AppHandle) {
        self.tunnels.set_exit_sink(Arc::new(move |exit| {
            folder_access::stop_environment(&exit.environment_id);
            if let Some(state) = app.try_state::<RemoteConnections>() {
                state.ws.invalidate_environment(&exit.environment_id);
                state
                    .native_profile_ws
                    .invalidate_environment(&exit.environment_id);
                state
                    .native_service_ws
                    .invalidate_environment(&exit.environment_id);
                state
                    .native_gateway_ws
                    .invalidate_environment(&exit.environment_id);
                state
                    .native_device_ws
                    .invalidate_environment(&exit.environment_id);
            }
            let _ = app.emit(TUNNEL_EXIT_EVENT, exit);
        }));
    }
    pub fn shutdown(&self) {
        self.recovery_routes.close();
        self.ws.shutdown();
        self.native_profile_ws.shutdown();
        self.native_service_ws.shutdown();
        self.native_gateway_ws.shutdown();
        self.native_device_ws.shutdown();
        folder_access::shutdown();
        if let Ok(jobs) = self.jobs.lock() {
            for job in jobs.values() {
                job.cancel();
            }
        }
        self.tunnels.clear();
    }
    pub fn detach_window(&self, label: &str) {
        self.ws.detach(label);
    }

    pub(crate) fn invalidate_ws(&self, machine_id: &str) {
        self.recovery_routes.retire();
        self.ws.invalidate_machine(machine_id);
        self.native_profile_ws.invalidate_machine(machine_id);
        self.native_service_ws.invalidate_machine(machine_id);
        self.native_gateway_ws.invalidate_machine(machine_id);
        self.native_device_ws.invalidate_machine(machine_id);
        self.native_buffer_delivery_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(machine_id);
        self.native_buffer_delivery_ack_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(machine_id);
        self.ws_capabilities
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(machine_id);
        self.forget_native_workspace_descriptor(machine_id);
    }

    fn forget_native_workspace_descriptor(&self, machine_id: &str) {
        self.native_workspace_descriptors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(machine_id);
    }

    fn ws_enabled(&self, machine: &StoredMachine) -> bool {
        let mut capabilities = self
            .ws_capabilities
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let fingerprint = ws_fingerprint(machine);
        let changed = capabilities
            .get(&machine.id)
            .is_some_and(|entry| entry.fingerprint != fingerprint);
        if changed {
            capabilities.remove(&machine.id);
            drop(capabilities);
            self.ws.invalidate_machine(&machine.id);
            self.native_profile_ws.invalidate_machine(&machine.id);
            self.native_service_ws.invalidate_machine(&machine.id);
            self.native_gateway_ws.invalidate_machine(&machine.id);
            self.native_device_ws.invalidate_machine(&machine.id);
            return false;
        }
        capabilities
            .get(&machine.id)
            .is_some_and(|entry| entry.enabled)
    }

    fn observe_ws_capability(&self, machine: &StoredMachine, descriptor: &Value) {
        if descriptor["environmentId"].as_str() != Some(machine.environment_id.as_str()) {
            return;
        }
        let enabled = descriptor["capabilities"].as_array().is_some_and(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .any(HostWsBroker::supports_ws_capability)
        });
        self.ws_capabilities
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                machine.id.clone(),
                WsCapability {
                    fingerprint: ws_fingerprint(machine),
                    enabled,
                },
            );
        if !enabled {
            self.ws.invalidate_machine(&machine.id);
            self.native_profile_ws.invalidate_machine(&machine.id);
            self.native_service_ws.invalidate_machine(&machine.id);
            self.native_gateway_ws.invalidate_machine(&machine.id);
            self.native_device_ws.invalidate_machine(&machine.id);
        }
    }

    fn ws_request_compatible(&self, machine: &StoredMachine, method: &str, params: &Value) -> bool {
        self.ws_enabled(machine) && HostWsBroker::supports_params(method, params)
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

fn ws_fingerprint(machine: &StoredMachine) -> String {
    // Credential/SSH context is native-only and is never emitted to the renderer.
    let bytes = serde_json::to_vec(&json!([
        machine.id,
        machine.environment_id,
        machine.endpoint,
        machine.token,
        machine.ssh
    ]))
    .expect("serializable native route");
    format!("{:x}", Sha256::digest(bytes))
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
    let machines: Vec<StoredMachine> = read_store_values(path)?
        .into_iter()
        .filter(|record| record.get("kind").and_then(Value::as_str) != Some("ssh"))
        .map(|record| {
            serde_json::from_value(record).map_err(|_| "Remote connection store is invalid".into())
        })
        .collect::<Result<_, String>>()?;
    // A direct loopback machine is the Host on this computer. An SSH machine's
    // forward listens on loopback too and is never one.
    crate::host_ws::local_endpoints::replace(
        machines
            .iter()
            .filter(|machine| machine.ssh.is_none())
            .map(|machine| machine.endpoint.as_str()),
    );
    Ok(machines)
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
    let before = read_store_values(path)?;
    let prepared = match crate::assistant_server_observation::prepare(path, &before, records) {
        Ok(()) => true,
        Err(_) => {
            crate::assistant_server_observation::mark_gap(path)?;
            false
        }
    };
    let result = write_store_values_inner(path, records);
    // The file is authoritative even when replacement reports an error.
    if prepared {
        match read_store_values(path)
            .and_then(|actual| crate::assistant_server_observation::reconcile(path, &actual))
        {
            Ok(()) => {}
            Err(_) => {
                crate::assistant_server_observation::mark_gap(path)?;
            }
        }
    }
    result
}

fn write_store_values_inner(path: &Path, records: &[Value]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing connection directory")?;
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
/// (`host/sync/sync-transfer.ts`), so it bounds memory without limiting transcripts.
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
/// The renderer abandons a run-lease acquire after 4 s (`RUN_LEASE_ACQUIRE_TIMEOUT_MS`).
const INTERACTIVE_LEASE_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(4);
/// A writer-retirement acquire may wait 20 s on the Host. The renderer gives up
/// at 25 s (`RUN_LEASE_RETIREMENT_ACQUIRE_TIMEOUT_MS`); the wire must outlast it
/// so a late grant or refusal still reaches the abandoned request.
const RETIREMENT_LEASE_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const INTERACTIVE_READ_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// Workspace and policy reads resolve the repository identity with git, which
/// takes seconds on a large repository or a cold disk.
const WORKSPACE_READ_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const INTERACTIVE_ACTION_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const GIT_STATUS_READ_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const ATTACHMENT_CHUNK_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const CONNECTION_REFUSED: &str =
    "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

/// Git mutations may wait up to 120 s for the repository lease, then run a
/// 120 s command (or pull + push for sync), plus bounded safety reads. The
/// client must outlast that work so a successful write is not reported as failed.
/// Ordinary reads retain their short deadline.
fn rpc_timeout(method: &str, params: &Value) -> std::time::Duration {
    const GIT_MUTATION: std::time::Duration = std::time::Duration::from_secs(450);
    match method {
        // A reviewed page can publish 500 files, including Windows permission-preserving replacements.
        "workspace.run"
            if params.get("command").and_then(Value::as_str) == Some("replace_project") =>
        {
            std::time::Duration::from_secs(1800)
        }
        // The isolated assistant reply adapter permits a 90 s model turn.
        // Keep its durable request identity through that bounded operation.
        "assistant.request" if params.get("op").and_then(Value::as_str) == Some("threads.send") => {
            std::time::Duration::from_secs(120)
        }
        // Interactive HTTP-only methods that a send, the composer or an open
        // pane awaits. A hung Host must not hold a native worker (and the user's
        // send) for the 30 s default; these reply in milliseconds when healthy.
        "sessions.runLease" if params.get("action").and_then(Value::as_str) == Some("acquire") => {
            RETIREMENT_LEASE_RPC_TIMEOUT
        }
        "sessions.runLease" => INTERACTIVE_LEASE_RPC_TIMEOUT,
        "sessions.desktopLive"
        | "sessions.adopted"
        | "attachments.claim"
        | "attachments.claims"
        | "attachments.release"
        | "attachments.status"
        | "host.settings.get"
        | "shell.profiles" => INTERACTIVE_READ_RPC_TIMEOUT,
        "workspaces.get" | "workspaces.list" | "projects.workspacePolicy.get" => {
            WORKSPACE_READ_RPC_TIMEOUT
        }
        // One 512 KiB chunk per call; allow slow SSH links.
        "attachments.upload" | "attachments.read" => ATTACHMENT_CHUNK_RPC_TIMEOUT,
        "sessions.update"
        | "sessions.pin.state"
        | "sessions.pin.apply"
        | "sessions.pin.receipt"
        | "browser.status"
        | "browser.claim"
        | "browser.frame"
        | "browser.input" => INTERACTIVE_ACTION_RPC_TIMEOUT,
        "browser.resize" => INTERACTIVE_ACTION_RPC_TIMEOUT,
        // Cheap status reads for the Git panel. History, blame, PR status and
        // file diffs keep the default: the Host allows its git reads 30 s.
        "workspace.run"
            if params
                .get("command")
                .and_then(Value::as_str)
                .is_some_and(|command| {
                    matches!(
                        command,
                        "git_diff_index"
                            | "git_diff_files"
                            | "git_diff_stats"
                            | "git_head_message"
                            | "git_branches"
                            | "git_worktrees"
                            | "git_submodules"
                            | "git_operation_state"
                            | "git_operation_status"
                            | "git_conflicts"
                            | "git_stash_list"
                            | "git_tags"
                            | "git_remotes"
                    )
                }) =>
        {
            GIT_STATUS_READ_RPC_TIMEOUT
        }
        "browser.setup" | "devices.setup" => std::time::Duration::from_secs(1230),
        // Pi/OMP discovery can use 45 seconds, plus binary resolution and teardown.
        "models.list" => std::time::Duration::from_secs(60),
        // Model calls, offline discovery and device start can exceed ordinary RPC reads.
        m if m.starts_with("appearance.") => std::time::Duration::from_secs(100),
        // Must outlast the Host contract deadlines (interview 100 s, avatar 240 s).
        "assistant.builder.interview" => std::time::Duration::from_secs(110),
        "assistant.builder.avatarGenerate" => std::time::Duration::from_secs(250),
        "voice.local.inspect" | "devices.start" => std::time::Duration::from_secs(60),
        "voice.local.start" => std::time::Duration::from_secs(180),
        "voice.local.transcribe" | "voice.cloud.transcribe" => std::time::Duration::from_secs(40),
        "voice.dictation.process" => std::time::Duration::from_secs(110),
        // Tool calls may await an existing native owner approval dialog.
        "voice.tools.call" => std::time::Duration::from_secs(250),
        "devices.boot" => std::time::Duration::from_secs(240),
        "devices.action" => std::time::Duration::from_secs(180),
        "git.action" | "git.switch" | "git.createBranch" | "git.worktreeCreate" => GIT_MUTATION,
        // Worktree removal fingerprints and inventories the checkout (Host workers allow 120 s
        // each), waits for the repository lease and deletes it; close and finish queue behind
        // the same Host work. The desktop runs these in the background, so outlast the Host.
        "workspaces.close"
        | "workspaces.finish"
        | "workspaces.cleanup.plan"
        | "workspaces.cleanup.status"
        | "workspaces.cleanup.apply" => GIT_MUTATION,
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
    let timeout = rpc_timeout(method, &params);
    rpc_timed(endpoint, token, environment_id, method, params, timeout)
}

fn rpc_until(
    endpoint: &str,
    token: &str,
    environment_id: Option<&str>,
    method: &str,
    params: Value,
    deadline: std::time::Instant,
) -> Result<Value, String> {
    let remaining = deadline
        .checked_duration_since(std::time::Instant::now())
        .filter(|t| !t.is_zero())
        .ok_or("Host operation deadline elapsed before compatibility dispatch")?;
    let timeout = remaining.min(rpc_timeout(method, &params));
    rpc_timed(endpoint, token, environment_id, method, params, timeout)
}

fn rpc_timed(
    endpoint: &str,
    token: &str,
    environment_id: Option<&str>,
    method: &str,
    params: Value,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    let agent = rpc_agent();
    let payload = json!({ "version": 1, "environmentId": environment_id, "method": method, "params": params }).to_string();
    let exchange = transport_health::Exchange::new(endpoint, environment_id, method, timeout);
    let response = exchange.send(|timeout| {
        agent
            .post(&format!("{endpoint}/rpc"))
            .timeout(timeout)
            .set("Authorization", &format!("Bearer {token}"))
            .set("Content-Type", "application/json")
            .send_string(&payload)
            .map_err(Box::new)
    });
    let response = match response {
        Ok(response) => response,
        Err(error) if connection_refused(&error) => return Err(exchange.refused_message().into()),
        Err(error) => {
            return Err(rpc_transport_failure(
                &error,
                &rpc_operation(method, &params),
            ))
        }
    };
    let status = response.status();
    let authorization_error = || {
        format!("Host rejected request [RPC_AUTHORIZATION] ({method}). Reconnect the selected machine and check its access scope.")
    };
    let device_effect = device_http_effect(method);
    if (status == 401 || status == 403) && !device_effect {
        return Err(authorization_error());
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            let ureq::Error::Transport(error) = ureq::Error::from(error) else {
                unreachable!("An I/O error becomes a transport error")
            };
            exchange.failed(&error);
            if device_effect {
                device_http_unknown(method)
            } else {
                rpc_transport_failure(&error, &rpc_operation(method, &params))
            }
        })?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(if device_effect {
            device_http_unknown(method)
        } else {
            "Host response is too large".into()
        });
    }
    let invalid_response = || {
        if device_effect {
            device_http_unknown(method)
        } else {
            "Invalid host response".to_owned()
        }
    };
    let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid_response())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        if device_effect
            && value.get("code").and_then(Value::as_str)
                == Some("HOST_DEVICE_OPERATION_UNCONFIRMED")
            && value.get("delivery").and_then(Value::as_str) == Some("unknown")
        {
            return Err(device_http_unknown(method));
        }
        if status == 401 || status == 403 {
            return Err(authorization_error());
        }
        return Err(format!("Host rejected request: {error}"));
    }
    if status == 401 || status == 403 {
        // A damaged/missing rejection envelope cannot prove a device effect
        // was refused before admission. Valid predispatch denials above can.
        return Err(device_http_unknown(method));
    }
    if status != 200 {
        return Err(if device_effect {
            device_http_unknown(method)
        } else {
            format!("Host returned HTTP {status}")
        });
    }
    value
        .as_object_mut()
        .and_then(|object| object.remove("result"))
        .ok_or_else(invalid_response)
}

// Error classification only; this does not grant the narrower NativeDevice
// caller any lifecycle/mobile methods. Canonical effect metadata is authoritative.
fn device_http_effect(method: &str) -> bool {
    matches!(
        method,
        "devices.setup"
            | "devices.stop"
            | "devices.start"
            | "devices.boot"
            | "devices.capture"
            | "devices.control.claim"
            | "devices.control.release"
            | "devices.control.renew"
            | "devices.action"
            | "devices.preview"
            | "devices.preview.mobile.start"
    ) && HostWsBroker::method_has_effect(method)
}

fn device_http_unknown(method: &str) -> String {
    format!("The device operation may have completed [RPC_DEVICE_OUTCOME_UNKNOWN] ({method}). Its outcome is unknown. Do not repeat the request; inspect its original device or preview status and reconnect the selected machine if access changed.")
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
                    | "git_init"
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
                    | "replace_project"
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
    machine_rpc_for_consumer(state, machine, method, params, allow_connect, None, None)
}

fn machine_rpc_for_consumer(
    state: &RemoteConnections,
    machine: &StoredMachine,
    method: &str,
    params: Value,
    allow_connect: bool,
    consumer: Option<(&AppHandle, &str)>,
    retained: Option<&Mutex<Option<crate::host_ws::ReplyGuard>>>,
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
        let response = if let Some((app, consumer)) =
            consumer.filter(|_| state.ws_request_compatible(machine, method, &params))
        {
            let route = NativeRoute::new(
                &machine.id,
                &machine.environment_id,
                endpoint,
                &machine.token,
                &ws_fingerprint(machine),
            )
            .map_err(|error| error.to_string())?;
            let pending = with_current_ws_machine(app, state, machine, || {
                state.ws.begin_request(
                    &route,
                    consumer,
                    method,
                    params.clone(),
                    RequestOptions::default(),
                )
            });
            match pending.and_then(|pending| pending.wait()) {
                Ok(reply) => {
                    let (value, guard) = reply.into_guarded_result();
                    if let Some(retained) = retained {
                        *retained
                            .lock()
                            .map_err(|_| "Native reply disclosure is unavailable")? = Some(guard);
                    } else {
                        guard.check().map_err(native_ws_failure)?;
                    }
                    Ok(value)
                }
                // Compatibility fallbacks reuse the same params, so a durable commandId is unchanged.
                Err(error) if ws_failure_allows_http_fallback(&error) => rpc(
                    endpoint,
                    &machine.token,
                    Some(&machine.environment_id),
                    method,
                    params.clone(),
                ),
                Err(error) => Err(native_ws_failure(error)),
            }
        } else {
            rpc(
                endpoint,
                &machine.token,
                Some(&machine.environment_id),
                method,
                params.clone(),
            )
        };
        if method == "environment.describe" {
            if let Ok(descriptor) = &response {
                state.observe_ws_capability(machine, descriptor);
                if let Some(target) = &machine.ssh {
                    crate::remote_routes::observe(target, &machine.environment_id, descriptor);
                }
            }
        }
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
                state.invalidate_ws(&machine.id);
                state.tunnels.invalidate(&machine.id, lease);
            }
        }
        response
    })
}

/// Only a failure that proves the request never reached the Host may be sent again
/// over HTTP. `uncertain` is set for a mutating request that may have been sent, so
/// a clear flag on a mutating request means it was never dispatched. A read that
/// was sent and then timed out is also clear here; re-running a read is harmless.
/// `unsupported` is the separate pre-dispatch case that the WS path already reports.
fn ws_failure_allows_http_fallback(error: &WsFailure) -> bool {
    error.unsupported
        || (!error.uncertain
            && matches!(
                error.code.as_str(),
                "RPC_WS_DEADLINE" | "RPC_WS_UNAVAILABLE" | "RPC_WS_BLOCKED"
            ))
}

/// Formats a WS failure the way the HTTP path reports a Host refusal, so the
/// caller can settle a definitive rejection instead of treating it as unknown.
fn native_ws_failure(error: WsFailure) -> String {
    if error.uncertain {
        return format!(
            "{}. The operation outcome is unknown; reconcile its command receipt before retrying.",
            error.to_string().trim_end_matches('.')
        );
    }
    if error.code == "RPC_WS_REMOTE" {
        return format!("Host rejected request: {}", error.message);
    }
    error.to_string()
}

/// A held reply proves dispatch already succeeded. Losing disclosure authority
/// afterward cannot reclassify an effect as an operation that was never sent.
fn check_remote_reply(guard: &crate::host_ws::ReplyGuard, method: &str) -> Result<(), String> {
    guard.check().map_err(|mut error| {
        error.uncertain |= HostWsBroker::method_has_effect(method);
        error.unsupported = false;
        native_ws_failure(error)
    })
}

/// This adapter has already received an accepted Host reply. A final saved-route
/// check can still fail before IPC disclosure, but it cannot make an effect safe
/// to repeat or erase the original envelope identity.
fn disclose_public_reply(
    reply: WsReply,
    method: &str,
    request_id: Option<String>,
    command_id: Option<String>,
    disclose: impl FnOnce(WsReply) -> Result<WsReply, WsFailure>,
) -> Result<WsReply, WsFailure> {
    let generation = reply.generation;
    disclose(reply).map_err(|mut error| {
        error.generation = error.generation.or(Some(generation));
        error.request_id = error.request_id.or(request_id);
        error.command_id = error.command_id.or(command_id);
        error.uncertain |= HostWsBroker::method_has_effect(method);
        error.unsupported = false;
        error
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

#[tauri::command]
pub async fn remote_connect(
    app: AppHandle,
    name: String,
    url: String,
    token: String,
) -> Result<Machine, String> {
    crate::harness::run_blocking("remote_connect", move || {
        let state = app.state::<RemoteConnections>();
        connect_host(app.clone(), state, name, url, token, false)
    })
    .await
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
    state.invalidate_ws(&machine.id);
    state.observe_ws_capability(&machine, &descriptor);
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
        state.invalidate_ws(&machine_id);
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
        state.invalidate_ws(&machine.id);
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
    disconnect_saved_machine(&state, &path, &machine_id)?;
    state.tunnels.remove(&machine_id);
    folder_access::stop_machine(&machine_id);
    Ok(())
}

/// Caller holds the canonical connection-store lock through write + retirement.
fn disconnect_saved_machine(
    state: &RemoteConnections,
    path: &Path,
    machine_id: &str,
) -> Result<(), String> {
    let mut machines = read(path)?;
    machines.retain(|m| m.id != machine_id);
    write(path, &machines)?;
    state.invalidate_ws(machine_id);
    Ok(())
}

/// HTTP calls and SSH tunnel starts block for seconds when a Host hangs. Run
/// them on the blocking pool so they cannot occupy every async worker and
/// stall true async commands such as `harness_write` and `harness_kill`.
#[tauri::command]
// Preserve the existing IPC/process-launch argument contract.
pub async fn remote_request(
    app: AppHandle,
    window: tauri::Window,
    machine_id: String,
    method: String,
    params: Value,
    fresh: Option<bool>,
    allow_connect: Option<bool>,
    expected_environment_id: Option<String>,
    sync_cycle_id: Option<String>,
) -> Result<Value, String> {
    let sync_effect = if matches!(method.as_str(), "sync.push" | "sync.pull") {
        let id = sync_cycle_id.as_deref().ok_or("SYNC_OWNER_REQUIRED")?;
        Some(crate::sync_owner::admit(&window, &machine_id, id)?)
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, RemoteConnections> = app.state();
        let result = remote_request_blocking(
            &app,
            &window,
            &state,
            machine_id,
            method,
            params,
            fresh,
            allow_connect,
            expected_environment_id,
            None,
            None,
        );
        if let Some(effect) = sync_effect {
            effect.finish(result.is_ok());
        }
        result
    })
    .await
    .map_err(|e| format!("Remote request task failed: {e}"))?
}

fn assistant_route_request(
    route: &crate::session_store::canonical_store::AssistantNativeRoute,
    op: &str,
) -> Result<Value, String> {
    let parts: Vec<String> =
        serde_json::from_str(&route.key).map_err(|_| "Invalid assistant route")?;
    if parts.len() != 2 || parts[0] != route.environment_id {
        return Err("Invalid assistant route".into());
    }
    let text = route
        .intent
        .get("text")
        .and_then(Value::as_str)
        .ok_or("Assistant text is unavailable")?;
    let id = route
        .intent
        .get("key")
        .and_then(Value::as_str)
        .ok_or("Assistant request identity is unavailable")?;
    let mut params = json!({"op":op,"threadId":parts[1].as_str(),"text":text,"idempotencyKey":id});
    params["expectedHostInstance"] = json!(&route.host_instance);
    if op == "threads.send" {
        params["via"] = json!("text");
    }
    if let Some(session) = route.intent.get("sessionId") {
        params["sessionId"] = session.clone();
    }
    Ok(params)
}

fn assistant_route_generation(state: &RemoteConnections) -> Result<String, String> {
    static PROCESS: OnceLock<String> = OnceLock::new();
    let process = PROCESS.get_or_init(|| uuid::Uuid::new_v4().to_string());
    Ok(format!("{}:{}", process, state.recovery_routes.capture()?))
}

fn with_assistant_route_current<T>(
    app: &AppHandle,
    route: &crate::session_store::canonical_store::AssistantNativeRoute,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state: State<'_, RemoteConnections> = app.state();
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let _route_guard = state
        .recovery_routes
        .commit
        .lock()
        .map_err(|_| "Connection retirement is unavailable")?;
    if assistant_route_generation(&state)? != route.generation
        || !read_uncached(&store_path(app)?)?.iter().any(|machine| {
            machine.id == route.machine_id
                && machine.environment_id == route.environment_id
                && machine.local_host
                && ws_fingerprint(machine) == route.fingerprint
        })
    {
        return Err("The original Host connection changed; the send remains held".into());
    }
    work()
}

fn assistant_reply_proof(
    route: &crate::session_store::canonical_store::AssistantNativeRoute,
    response: &Value,
    status: bool,
) -> Result<Value, String> {
    if status
        && response
            .pointer("/sendReceipt/status")
            .and_then(Value::as_str)
            != Some("settled")
    {
        return Err("The original Host has not confirmed this reply".into());
    }
    let parts: Vec<String> =
        serde_json::from_str(&route.key).map_err(|_| "Invalid assistant route")?;
    let message = response
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().find(|message| {
                message.get("role").and_then(Value::as_str) == Some("assistant")
                    && message.get("threadId").and_then(Value::as_str)
                        == parts.get(1).map(String::as_str)
            })
        })
        .ok_or("The original Host reply is not confirmed")?;
    let id = message
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 512)
        .ok_or("The original Host reply is not confirmed")?;
    Ok(json!({"messageId":id}))
}

fn verify_assistant_instance(
    app: &AppHandle,
    window: &tauri::Window,
    route: &crate::session_store::canonical_store::AssistantNativeRoute,
) -> Result<(), String> {
    let state: State<'_, RemoteConnections> = app.state();
    let response = remote_request_blocking(
        app,
        window,
        &state,
        route.machine_id.clone(),
        "assistant.request".into(),
        json!({"op":"threads.sendIdentity"}),
        None,
        Some(true),
        Some(route.environment_id.clone()),
        Some(route.fingerprint.clone()),
        Some(route.generation.clone()),
    )?;
    if response
        .pointer("/sendIdentity/instanceId")
        .and_then(Value::as_str)
        != Some(route.host_instance.as_str())
    {
        return Err("The original Host instance changed; the send remains held".into());
    }
    Ok(())
}

/// Native captures the local Host route and persists it with the claim before sending.
#[tauri::command]
pub async fn assistant_native_send(
    app: AppHandle,
    window: tauri::Window,
    page_token: String,
    key: String,
    operation_id: String,
    intent_version: i64,
    environment_id: String,
) -> Result<Value, String> {
    let admission = crate::session_store::canonical_store::admit(&window, &page_token)?;
    crate::harness::run_blocking("assistant_native_send", move || {
        let _admission = admission;
        crate::session_store::canonical_store::register_assistant_preparation(
            &window,
            &page_token,
            &key,
            &operation_id,
            intent_version,
        )?;
        let public = crate::local_host::local_host_connect_blocking(app.clone())?
            .ok_or("The original Host is unavailable")?;
        if !public.local_host || public.environment_id != environment_id {
            return Err("The original Host identity changed".into());
        }
        let state: State<'_, RemoteConnections> = app.state();
        let (machine, generation) = {
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let machine = read_uncached(&store_path(&app)?)?
                .into_iter()
                .find(|machine| {
                    machine.id == public.id
                        && machine.environment_id == environment_id
                        && machine.local_host
                })
                .ok_or("The original Host is unavailable")?;
            (machine, assistant_route_generation(&state)?)
        };
        let fingerprint = ws_fingerprint(&machine);
        let identity = remote_request_blocking(
            &app,
            &window,
            &state,
            machine.id.clone(),
            "assistant.request".into(),
            json!({"op":"threads.sendIdentity"}),
            None,
            Some(true),
            Some(environment_id.clone()),
            Some(fingerprint.clone()),
            Some(generation.clone()),
        )?;
        let host_instance = identity
            .pointer("/sendIdentity/instanceId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 512)
            .ok_or("The original Host instance is unavailable")?
            .to_owned();
        let route = crate::session_store::canonical_store::prepare_assistant_send(
            &window,
            &page_token,
            &key,
            &operation_id,
            intent_version,
            &machine.id,
            &environment_id,
            &fingerprint,
            &generation,
            &host_instance,
        )?;
        let params = assistant_route_request(&route, "threads.send")?;
        let response = remote_request_blocking(
            &app,
            &window,
            &state,
            route.machine_id.clone(),
            "assistant.request".into(),
            params,
            None,
            Some(true),
            Some(route.environment_id.clone()),
            Some(route.fingerprint.clone()),
            Some(route.generation.clone()),
        )?;
        if crate::session_store::canonical_store::page(&window)? != page_token {
            return Err("The original page changed; the result remains held".into());
        }
        let proof = assistant_reply_proof(&route, &response, false)?;
        with_assistant_route_current(&app, &route, || {
            crate::session_store::canonical_store::record_assistant_proof(
                &window,
                &page_token,
                &route,
                &proof,
            )
        })?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub async fn assistant_native_finish(
    window: tauri::Window,
    page_token: String,
    key: String,
    operation_id: String,
) -> Result<(), String> {
    let admission = crate::session_store::canonical_store::admit(&window, &page_token)?;
    crate::harness::run_blocking("assistant_native_finish", move || {
        let _admission = admission;
        if crate::session_store::canonical_store::page(&window)? != page_token {
            return Err("CANONICAL_PAGE_STALE".into());
        }
        if crate::session_store::canonical_store::assistant_send_settled(
            &window,
            &key,
            &operation_id,
            None,
        )? {
            return Ok(());
        }
        let route = crate::session_store::canonical_store::assistant_send_route(&window, &key)?;
        if route.operation_id != operation_id || route.proof.is_none() {
            return Err("The original Host receipt is unavailable".into());
        }
        verify_assistant_instance(window.app_handle(), &window, &route)?;
        if crate::session_store::canonical_store::page(&window)? != page_token {
            return Err("CANONICAL_PAGE_STALE".into());
        }
        with_assistant_route_current(window.app_handle(), &route, || {
            crate::session_store::canonical_store::complete_assistant_send(
                &window,
                &page_token,
                &route,
            )
        })
    })
    .await
}

/// A successor may settle only after Native verifies the captured Host receipt.
#[tauri::command]
pub async fn assistant_native_reconcile(
    app: AppHandle,
    window: tauri::Window,
    page_token: String,
    key: String,
    request_key: String,
    operation_id: Option<String>,
) -> Result<Value, String> {
    let admission = crate::session_store::canonical_store::admit(&window, &page_token)?;
    crate::harness::run_blocking("assistant_native_reconcile", move || {
        let _admission = admission;
        if crate::session_store::canonical_store::page(&window)? != page_token {
            return Err("CANONICAL_PAGE_STALE".into());
        }
        if let Some(ref operation_id) = operation_id {
            if crate::session_store::canonical_store::assistant_send_settled(
                &window,
                &key,
                operation_id,
                Some(&request_key),
            )? {
                return Ok(json!({"sendReceipt":{"status":"settled"}}));
            }
            if crate::session_store::canonical_store::assistant_send_not_sent(
                &window,
                &key,
                operation_id,
                &request_key,
            )? {
                return Ok(json!({"sendReceipt":{"status":"notSent"}}));
            }
        }
        let route = match crate::session_store::canonical_store::assistant_send_route(&window, &key)
        {
            Ok(route) => route,
            Err(error) => {
                if crate::session_store::canonical_store::release_prepared_assistant(
                    &window,
                    &page_token,
                    &key,
                    &request_key,
                    operation_id.as_deref(),
                )? {
                    return Ok(json!({"sendReceipt":{"status":"notSent"}}));
                }
                return Err(error);
            }
        };
        if route.intent.get("key").and_then(Value::as_str) != Some(request_key.as_str()) {
            return Err("The original send identity changed".into());
        }
        if operation_id
            .as_ref()
            .is_some_and(|operation_id| operation_id != &route.operation_id)
        {
            return Err("The original send identity changed".into());
        }
        with_assistant_route_current(&app, &route, || Ok(()))?;
        verify_assistant_instance(&app, &window, &route)?;
        let response = if route.proof.is_some() {
            json!({"sendReceipt":{"status":"settled"}})
        } else {
            let state: State<'_, RemoteConnections> = app.state();
            let params = assistant_route_request(&route, "threads.sendStatus")?;
            let result = remote_request_blocking(
                &app,
                &window,
                &state,
                route.machine_id.clone(),
                "assistant.request".into(),
                params,
                None,
                Some(true),
                Some(route.environment_id.clone()),
                Some(route.fingerprint.clone()),
                Some(route.generation.clone()),
            )?;
            let proof = assistant_reply_proof(&route, &result, true)?;
            with_assistant_route_current(&app, &route, || {
                crate::session_store::canonical_store::record_assistant_proof(
                    &window,
                    &page_token,
                    &route,
                    &proof,
                )
            })?;
            result
        };
        if crate::session_store::canonical_store::page(&window)? != page_token {
            return Err("CANONICAL_PAGE_STALE".into());
        }
        with_assistant_route_current(&app, &route, || {
            crate::session_store::canonical_store::complete_assistant_send(
                &window,
                &page_token,
                &route,
            )
        })?;
        Ok(response)
    })
    .await
}

fn remote_request_blocking(
    app: &AppHandle,
    window: &tauri::Window,
    state: &RemoteConnections,
    machine_id: String,
    method: String,
    params: Value,
    fresh: Option<bool>,
    allow_connect: Option<bool>,
    expected_environment_id: Option<String>,
    expected_fingerprint: Option<String>,
    expected_generation: Option<String>,
) -> Result<Value, String> {
    if !supported_remote_method(&method) {
        return Err("Unsupported remote operation".into());
    }
    if method == "machine.changes" && changes::is_empty_subscription(&params) {
        // Releasing a renderer registration is local. Never start an SSH tunnel
        // or read credentials merely because a disconnected pane closes.
        return state
            .changes
            .request(&machine_id, window.label(), params, |_| {
                Err("Empty subscriptions do not need a host request".into())
            });
    }
    let machine = machine_for_request(
        state,
        &store_path(app)?,
        &machine_id,
        expected_environment_id.as_deref(),
    )?;
    if !decision_model_key_allowed(
        &method,
        params.get("apiKey").is_some(),
        machine.local_host && is_local_sync(&machine, ""),
    ) {
        return Err("Decision model keys are available only on this computer.".into());
    }
    if expected_fingerprint
        .as_deref()
        .is_some_and(|expected| ws_fingerprint(&machine) != expected)
    {
        return Err("The original Host connection changed. The outcome remains unknown.".into());
    }
    if expected_generation
        .as_deref()
        .is_some_and(|expected| assistant_route_generation(state).ok().as_deref() != Some(expected))
    {
        return Err("The original Host connection retired. The outcome remains unknown.".into());
    }
    if fresh == Some(true) && machine.ssh.is_some() {
        state.tunnels.forget_failure(&machine.id);
    }
    // Background polling must respect the owner's automatic reconnect setting.
    let allow = fresh == Some(true) || allow_connect != Some(false);
    let disclosure = Mutex::new(None);
    let send = |params| {
        machine_rpc_for_consumer(
            state,
            &machine,
            &method,
            params,
            allow,
            Some((app, window.label())),
            Some(&disclosure),
        )
    };
    let response = if method == "machine.changes" {
        state
            .changes
            .request(&machine.id, window.label(), params, send)
    } else if shareable_remote_read(&method, &params)
        && !(state.ws_enabled(&machine) && HostWsBroker::supports_params(&method, &params))
    {
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
    if method == "workspaces.exactGitRewind.set" {
        // The Host advertises its exact-rewind capabilities from this policy.
        state.forget_native_workspace_descriptor(&machine.id);
    }
    {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        let current = read_uncached(&store_path(app)?)?;
        if !current
            .iter()
            .any(|saved| same_request_route(&machine, saved))
        {
            state.invalidate_ws(&machine.id);
            return Err("Connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.".into());
        }
        if expected_generation.as_deref().is_some_and(|expected| {
            assistant_route_generation(state).ok().as_deref() != Some(expected)
        }) {
            return Err(
                "The original Host connection retired. The outcome remains unknown.".into(),
            );
        }
        if let Some(guard) = disclosure
            .lock()
            .map_err(|_| "Native reply disclosure is unavailable")?
            .as_ref()
        {
            check_remote_reply(guard, &method)?;
        }
        // A reconnect probes over HTTP. Without retiring the blocked lane, a
        // successful probe leaves every subsequent WebSocket read blocked.
        // Only the explicit, successful probe for this saved identity can do
        // this; ordinary polling, failed auth and another Host cannot reopen it.
        if fresh == Some(true)
            && method == "environment.describe"
            && response.as_ref().is_ok_and(|descriptor| {
                descriptor.get("environmentId").and_then(Value::as_str)
                    == Some(machine.environment_id.as_str())
            })
        {
            state.ws.retry_blocked_machine(&machine.id);
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

fn saved_ws_machine(
    app: &AppHandle,
    state: &RemoteConnections,
    machine_id: &str,
) -> Result<StoredMachine, WsFailure> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| WsFailure::local("RPC_WS_STORE", "Native connection store is unavailable"))?;
    read_uncached(
        &store_path(app).map_err(|_| {
            WsFailure::local("RPC_WS_STORE", "Native connection store is unavailable")
        })?,
    )
    .map_err(|_| WsFailure::local("RPC_WS_STORE", "Native connection store is unavailable"))?
    .iter()
    .find(|machine| machine.id == machine_id)
    .cloned()
    .ok_or_else(|| WsFailure::local("RPC_WS_DETACHED", "Machine is no longer connected"))
}

fn with_current_ws_machine<T>(
    app: &AppHandle,
    state: &RemoteConnections,
    machine: &StoredMachine,
    admit: impl FnOnce() -> Result<T, WsFailure>,
) -> Result<T, WsFailure> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| WsFailure::local("RPC_WS_STORE", "Native connection store is unavailable"))?;
    let path = store_path(app)
        .map_err(|_| WsFailure::local("RPC_WS_STORE", "Native connection store is unavailable"))?;
    let machines = read_uncached(&path)
        .map_err(|_| WsFailure::local("RPC_WS_STORE", "Native connection store is unavailable"))?;
    if !machines
        .iter()
        .any(|current| same_request_route(machine, current))
    {
        state.invalidate_ws(&machine.id);
        return Err(WsFailure::local(
            "RPC_WS_ROUTE_CHANGED",
            "Native connection changed before admission",
        ));
    }
    admit()
}

fn native_ws_route(
    state: &RemoteConnections,
    machine: &StoredMachine,
    allow_connect: bool,
) -> Result<NativeRoute, WsFailure> {
    let lease = machine
        .ssh
        .as_ref()
        .map(|target| {
            state
                .tunnels
                .endpoint(&machine.id, &machine.environment_id, target, allow_connect)
        })
        .transpose()
        .map_err(|_| WsFailure::local("RPC_WS_SSH", "Verified native SSH tunnel is unavailable"))?;
    let endpoint = lease
        .as_ref()
        .map(|lease| lease.endpoint.as_str())
        .unwrap_or(&machine.endpoint);
    NativeRoute::new(
        &machine.id,
        &machine.environment_id,
        endpoint,
        &machine.token,
        &ws_fingerprint(machine),
    )
}

/// Blocking Host-connection work off Tauri's async workers: a hung Host must
/// not occupy the threads that stop and write commands need.
async fn run_ws_blocking<T: Send + 'static>(
    label: &'static str,
    work: impl FnOnce() -> Result<T, WsFailure> + Send + 'static,
) -> Result<T, WsFailure> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| {
            WsFailure::local("RPC_WS_TASK", &format!("{label} task failed: {error}"))
        })?
}

/// Desktop adapters attach with a saved machine ID. Tokens and SSH credentials
/// remain in this process; the sink is scoped to the invoking Tauri window.
#[tauri::command]
pub async fn host_connection_attach(
    app: AppHandle,
    window: tauri::Window,
    machine_id: String,
    allow_connect: Option<bool>,
) -> Result<bool, WsFailure> {
    run_ws_blocking("host_connection_attach", move || {
        let state = app.state::<RemoteConnections>();
        let machine = saved_ws_machine(&app, &state, &machine_id)?;
        // Negotiate using authenticated compatibility discovery before opening WS.
        let descriptor = machine_rpc(
            &state,
            &machine,
            "environment.describe",
            json!({}),
            allow_connect != Some(false),
        )
        .map_err(|_| WsFailure::local("RPC_WS_DISCOVERY", "Authenticated Host discovery failed"))?;
        if descriptor["environmentId"].as_str() != Some(machine.environment_id.as_str()) {
            state.invalidate_ws(&machine.id);
            return Err(WsFailure::local(
                "RPC_WS_IDENTITY",
                "Saved Host identity changed",
            ));
        }
        if !state.ws_enabled(&machine) {
            return Ok(false);
        }
        let route = native_ws_route(&state, &machine, allow_connect != Some(false))?;
        let label = window.label().to_owned();
        let consumer = label.clone();
        let event_app = app.clone();
        with_current_ws_machine(&app, &state, &machine, || {
            state.ws.attach(
                &route,
                &consumer,
                Arc::new(move |event| {
                    let _ = event_app.emit_to(
                        &label,
                        HOST_CONNECTION_EVENT,
                        json!({"machineId":machine_id,"event":event}),
                    );
                }),
            )
        })?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub fn host_connection_detach(
    window: tauri::Window,
    state: State<'_, RemoteConnections>,
    machine_id: String,
) {
    state.ws.detach_machine(&machine_id, window.label());
}

#[tauri::command]
pub async fn host_connection_request(
    app: AppHandle,
    window: tauri::WebviewWindow,
    machine_id: String,
    method: String,
    params: Value,
    request_id: Option<String>,
    command_id: Option<String>,
    response_timeout_ms: Option<u64>,
    allow_connect: Option<bool>,
) -> Result<WsReply, WsFailure> {
    let issuer = crate::control::receipts::capture(&window)
        .map_err(|_| WsFailure::local("RPC_WS_DETACHED", "Native window is unavailable"))?;
    run_ws_blocking("host_connection_request", move || {
        let state = app.state::<RemoteConnections>();
        if !HostWsBroker::supports_method(&method) {
            return Err(WsFailure::unsupported());
        }
        let machine = saved_ws_machine(&app, &state, &machine_id)?;
        if !state.ws_enabled(&machine) {
            return Err(WsFailure::unsupported());
        }
        let route = native_ws_route(&state, &machine, allow_connect != Some(false))?;
        let command_id = command_id.or_else(|| params["commandId"].as_str().map(str::to_owned));
        let pending = with_current_ws_machine(&app, &state, &machine, || {
            state.ws.begin_request(
                &route,
                window.label(),
                &method,
                params,
                RequestOptions {
                    request_id: request_id.clone(),
                    command_id: command_id.clone(),
                    response_timeout: response_timeout_ms.map(std::time::Duration::from_millis),
                    absolute_deadline: None,
                    issuer: Some(issuer.clone()),
                },
            )
        });
        let reply = pending.and_then(|pending| pending.wait());
        let current = saved_ws_machine(&app, &state, &machine_id);
        if !current
            .as_ref()
            .is_ok_and(|current| same_request_route(&machine, current))
        {
            state.invalidate_ws(&machine.id);
            let mut error = WsFailure::local(
                "RPC_WS_ROUTE_CHANGED",
                "Native connection changed during the request",
            );
            error.generation = match &reply {
                Ok(reply) => Some(reply.generation),
                Err(error) => error.generation,
            };
            error.request_id = reply
                .as_ref()
                .err()
                .and_then(|error| error.request_id.clone())
                .or(request_id);
            error.command_id = reply
                .as_ref()
                .err()
                .and_then(|error| error.command_id.clone())
                .or(command_id);
            error.uncertain = match &reply {
                Ok(_) => HostWsBroker::method_has_effect(&method),
                Err(error) => error.uncertain,
            };
            return Err(error);
        }
        reply.and_then(|reply| {
            disclose_public_reply(reply, &method, request_id, command_id, |reply| {
                with_current_ws_machine(&app, &state, &machine, || reply.disclose())
            })
        })
    })
    .await
}

/// Off the main thread: resolving the route takes the machine's SSH tunnel
/// slot, which a reconnect holds for up to its 20 s start.
#[tauri::command]
pub async fn host_connection_cancel(
    app: AppHandle,
    window: tauri::Window,
    machine_id: String,
    request_id: String,
) -> Result<(), WsFailure> {
    run_ws_blocking("host_connection_cancel", move || {
        let state = app.state::<RemoteConnections>();
        let machine = saved_ws_machine(&app, &state, &machine_id)?;
        // Cancellation never creates an SSH tunnel or opens a replacement pipe.
        if let Ok(route) = native_ws_route(&state, &machine, false) {
            state.ws.cancel_request(&route, window.label(), &request_id);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn host_connection_bulk(
    app: AppHandle,
    window: tauri::Window,
    machine_id: String,
    descriptor: Value,
    response_timeout_ms: Option<u64>,
) -> Result<Value, WsFailure> {
    run_ws_blocking("host_connection_bulk", move || {
        let state = app.state::<RemoteConnections>();
        let machine = saved_ws_machine(&app, &state, &machine_id)?;
        if !state.ws_enabled(&machine) {
            return Err(WsFailure::unsupported());
        }
        let route = native_ws_route(&state, &machine, false)?;
        let result = state.ws.fetch_bulk(
            &route,
            window.label(),
            &descriptor,
            response_timeout_ms.map(std::time::Duration::from_millis),
        );
        if !saved_ws_machine(&app, &state, &machine_id)
            .as_ref()
            .is_ok_and(|current| same_request_route(&machine, current))
        {
            state.invalidate_ws(&machine.id);
            return Err(WsFailure::local(
                "RPC_WS_ROUTE_CHANGED",
                "Native connection changed during bulk transfer",
            ));
        }
        result.and_then(|pending| {
            with_current_ws_machine(&app, &state, &machine, || pending.disclose())
        })
    })
    .await
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

/// `deadline` bounds the connect and the call for optional metadata reads.
pub(crate) fn local_social_rpc_until(
    app: &AppHandle,
    method: &str,
    params: Value,
    deadline: Option<std::time::Instant>,
) -> Result<Value, String> {
    if !matches!(method, "social.bridge.describe" | "social.access.issue") {
        return Err("Unsupported native social bridge operation".into());
    }
    let channel = NativeServiceChannel::connect_until(app, deadline)?;
    channel
        .request_until(method, params, deadline)?
        .project(|value| {
            let mut value = value.clone();
            if method == "social.access.issue" && value.get("endpoint").is_none() {
                value["endpoint"] = json!(channel.endpoint());
            }
            Ok(value)
        })
}

pub(crate) fn local_editor_format_rpc(app: &AppHandle, params: Value) -> Result<Value, String> {
    // An unpaired local editor preserves its existing formatter-unavailable result.
    let state: State<'_, RemoteConnections> = app.state();
    let paired = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read_uncached(&store_path(app)?)?
            .iter()
            .any(|m| is_local_sync(m, "This computer (local sync)"))
    };
    if !paired {
        return Ok(Value::Null);
    }
    NativeServiceChannel::connect(app)?.project(
        "workspace.run",
        json!({"command":"format_text_file","args":params}),
        |value| Ok(value.clone()),
    )
}

/// Pinned native-only route. Credentials are never passed through renderer arguments.
/// Reconnects and retries are explicit; an uncertain mutation is not replayed here.
pub(crate) struct NativeWorkspaceTransport {
    machine: StoredMachine,
    recovery: Option<RecoveryRoute>,
    workspace: Option<Arc<native_workspace_transport::NativeWorkspaceChannel>>,
}

#[derive(Clone)]
struct NativeRecoverySelection {
    store: Arc<Mutex<()>>,
    routes: Arc<RecoveryRoutes>,
    path: PathBuf,
    machine: StoredMachine,
    pin: RecoveryRoute,
}
impl NativeRecoverySelection {
    fn with_current<T>(&self, consume: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _guard = self
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        validate_recovery_saved(&self.machine, &self.pin, &self.routes, &self.path)?;
        consume()
    }
}
fn validate_recovery_saved(
    machine: &StoredMachine,
    pin: &RecoveryRoute,
    routes: &RecoveryRoutes,
    path: &Path,
) -> Result<(), String> {
    if !routes.current(pin.revision)
        || !read_uncached(path)?.iter().any(|current| {
            same_request_route(machine, current)
                && machine.local_host == current.local_host
                && recovery_machine_matches(
                    current,
                    &pin.selected_endpoint,
                    &machine.environment_id,
                )
        })
        || !routes.current(pin.revision)
    {
        return Err("Native recovery connection changed or retired".into());
    }
    Ok(())
}
fn require_machine_environment(
    machine: &StoredMachine,
    expected: Option<&str>,
) -> Result<(), String> {
    if expected.is_some_and(|expected| expected != machine.environment_id) {
        return Err(
            "The owning Host environment changed; reconnect this conversation before sending"
                .into(),
        );
    }
    Ok(())
}
fn machine_for_request(
    state: &RemoteConnections,
    path: &Path,
    machine_id: &str,
    expected_environment: Option<&str>,
) -> Result<StoredMachine, String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let machines = if expected_environment.is_some() {
        Arc::new(read_uncached(path)?)
    } else {
        read_shared(path)?
    };
    let machine = machines
        .iter()
        .find(|machine| machine.id == machine_id)
        .cloned()
        .ok_or("Machine is no longer connected")?;
    require_machine_environment(&machine, expected_environment)?;
    Ok(machine)
}

pub(crate) struct NativeRecoveryReply {
    value: Value,
    guard: Option<crate::host_ws::native_profile::NativeProfileGuard>,
    selection: NativeRecoverySelection,
}
impl NativeRecoveryReply {
    pub(crate) fn project<T>(
        self,
        project: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        self.inspect(project)
    }
    fn inspect<T>(&self, project: impl FnOnce(&Value) -> Result<T, String>) -> Result<T, String> {
        let check = || {
            if let Some(guard) = &self.guard {
                guard.check().map_err(native_ws_failure)?;
            }
            Ok(())
        };
        self.selection.with_current(check)?;
        let projected = project(&self.value)?;
        self.selection.with_current(|| {
            check()?;
            Ok(projected)
        })
    }
    #[cfg(test)]
    pub(crate) fn disclose(self) -> Result<Value, String> {
        self.project(|value| Ok(value.clone()))
    }
}

#[derive(Clone)]
struct RecoveryRoute {
    revision: u64,
    selected_endpoint: String,
}

impl NativeWorkspaceTransport {
    /// Recovery pins the actual Native-selected bootstrap, not the selected project machine.
    pub(crate) fn connect_recovery(
        app: &AppHandle,
        selected_endpoint: &str,
        environment_id: &str,
    ) -> Result<Self, String> {
        let state = app
            .try_state::<RemoteConnections>()
            .ok_or("The Native local Host connection state is unavailable")?;
        let (machine, recovery) = {
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let machine = read_uncached(&store_path(app)?)?
                .into_iter()
                .find(|machine| {
                    recovery_machine_matches(machine, selected_endpoint, environment_id)
                })
                .ok_or("The Native-selected local Host is not paired for report recovery")?;
            let revision = state.recovery_routes.capture()?;
            (
                machine,
                RecoveryRoute {
                    revision,
                    selected_endpoint: selected_endpoint.into(),
                },
            )
        };
        let transport = Self {
            machine,
            recovery: Some(recovery),
            workspace: None,
        };
        transport.assert_recovery_current(app)?;
        let descriptor = rpc(
            &transport.machine.endpoint,
            &transport.machine.token,
            Some(environment_id),
            "environment.describe",
            json!({}),
        )?;
        if descriptor["environmentId"] != environment_id
            || descriptor["protocolVersion"] != 1
            || !descriptor["capabilities"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item == "native.buffers.recovery.v1")
            })
        {
            return Err("The Native-selected local Host cannot inspect retained reports".into());
        }
        transport.assert_recovery_current(app)?;
        state.observe_ws_capability(&transport.machine, &descriptor);
        Ok(transport)
    }
    pub(crate) fn assert_recovery_current(&self, app: &AppHandle) -> Result<(), String> {
        let state = app
            .try_state::<RemoteConnections>()
            .ok_or("Native recovery connection unavailable")?;
        self.assert_recovery_saved(&state, &store_path(app)?)
    }
    pub(crate) fn call_recovery(
        &self,
        app: &AppHandle,
        method: &str,
        params: Value,
    ) -> Result<NativeRecoveryReply, String> {
        let state = app
            .try_state::<RemoteConnections>()
            .ok_or("Native recovery connection unavailable")?;
        self.call_recovery_guarded_saved(&state, &store_path(app)?, method, params)
    }
    #[cfg(test)]
    fn call_recovery_saved(
        &self,
        state: &RemoteConnections,
        path: &Path,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.call_recovery_guarded_saved(state, path, method, params)?
            .disclose()
    }
    fn call_recovery_guarded_saved(
        &self,
        state: &RemoteConnections,
        path: &Path,
        method: &str,
        params: Value,
    ) -> Result<NativeRecoveryReply, String> {
        use crate::host_ws::native_profile::NativeProfileBroker;
        if !matches!(
            method,
            "native.buffers.recovery.list"
                | "native.buffers.recovery.read"
                | "native.buffers.recovery.status"
        ) {
            return Err("Unsupported Native profile recovery operation".into());
        }
        let selection = self.with_recovery_saved(state, path, || {
            Ok(NativeRecoverySelection {
                store: state.store.clone(),
                routes: state.recovery_routes.clone(),
                path: path.to_owned(),
                machine: self.machine.clone(),
                pin: self
                    .recovery
                    .as_ref()
                    .ok_or("Native recovery connection unavailable")?
                    .clone(),
            })
        })?;
        let pending = self.with_recovery_saved(state, path, || {
            if !state.ws_enabled(&self.machine)
                || !NativeProfileBroker::supports_params(method, &params)
            {
                return Ok(None);
            }
            let route = NativeRoute::new(
                &self.machine.id,
                &self.machine.environment_id,
                &self.machine.endpoint,
                &self.machine.token,
                &ws_fingerprint(&self.machine),
            )
            .map_err(native_ws_failure)?;
            let caller = state
                .native_profile_ws
                .capture(route)
                .map_err(native_ws_failure)?;
            caller
                .begin(method, params.clone(), RequestOptions::default())
                .map(Some)
                .map_err(native_ws_failure)
        })?;
        let result = match pending {
            Some(pending) => match pending.wait() {
                Ok(reply) => {
                    let (value, guard) = reply.into_guarded();
                    NativeRecoveryReply {
                        value,
                        guard: Some(guard),
                        selection,
                    }
                }
                // Unsupported is reported only before domain dispatch. Old Host
                // compatibility must never resend a dispatched/uncertain call.
                Err(error) if error.unsupported => {
                    self.assert_recovery_saved(state, path)?;
                    NativeRecoveryReply {
                        value: self.rpc_compat(method, params)?,
                        guard: None,
                        selection,
                    }
                }
                Err(error) => return Err(native_ws_failure(error)),
            },
            None => {
                self.assert_recovery_saved(state, path)?;
                NativeRecoveryReply {
                    value: self.rpc_compat(method, params)?,
                    guard: None,
                    selection,
                }
            }
        };
        self.with_recovery_saved(state, path, || {
            if let Some(guard) = &result.guard {
                guard.check().map_err(native_ws_failure)?;
            }
            Ok(())
        })?;
        Ok(result)
    }
    fn assert_recovery_saved(&self, state: &RemoteConnections, path: &Path) -> Result<(), String> {
        self.with_recovery_saved(state, path, || Ok(()))
    }
    fn with_recovery_saved<T>(
        &self,
        state: &RemoteConnections,
        path: &Path,
        consume: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        let pin = self
            .recovery
            .as_ref()
            .ok_or("Native recovery connection unavailable")?;
        validate_recovery_saved(&self.machine, pin, &state.recovery_routes, path)?;
        consume()
    }
    #[cfg(test)]
    pub(crate) fn for_test(endpoint: String) -> Self {
        Self {
            machine: StoredMachine {
                id: "fixture".into(),
                name: "Fixture".into(),
                endpoint,
                environment_id: "fixture-env".into(),
                token: "fixture-token".into(),
                ssh: None,
                local_host: true,
            },
            recovery: None,
            workspace: None,
        }
    }
    pub(crate) fn connect(app: &AppHandle, capability: &str) -> Result<Self, String> {
        native_workspace_transport::NativeWorkspaceChannel::connect(app, capability)
    }

    fn rpc_compat(&self, method: &str, params: Value) -> Result<Value, String> {
        if !matches!(
            method,
            "native.turn.begin"
                | "native.turn.end"
                | "native.activity.start"
                | "native.activity.end"
                | "native.buffers.update"
                | "native.buffers.heartbeat"
                | "native.buffers.retire"
                | "native.buffers.reconcile"
                | "native.buffers.recovery.list"
                | "native.buffers.recovery.read"
                | "native.buffers.recovery.status"
                | "native.rewind.plan"
                | "native.rewind.prepare"
                | "native.rewind.apply"
                | "native.rewind.status"
                | "native.rewind.lookup"
                | "native.rewind.cancelPreparation"
                | "native.rewind.ack"
                | "workspaces.cleanup.plan"
                | "workspaces.cleanup.apply"
                | "workspaces.cleanup.status"
        ) {
            return Err("Unsupported native workspace bridge operation".into());
        }
        rpc(
            &self.machine.endpoint,
            &self.machine.token,
            Some(&self.machine.environment_id),
            method,
            params,
        )
    }
}

fn recovery_machine_matches(machine: &StoredMachine, endpoint: &str, environment: &str) -> bool {
    // Both accepted spellings still name the exact bootstrap-selected loopback port.
    let alternate = endpoint.replacen("http://127.0.0.1:", "http://localhost:", 1);
    is_local_sync(machine, "This computer (local sync)")
        && machine.environment_id == environment
        && (machine.endpoint == endpoint || machine.endpoint == alternate)
        && endpoint.starts_with("http://127.0.0.1:")
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

pub(crate) fn conversation_machine_call(
    app: &AppHandle,
    action: &str,
    _input: &Value,
    _owner: &str,
    _expires_at: &Value,
) -> Result<Value, String> {
    if action != "machines.list" {
        return Err("Device operations require their original desktop issuer".into());
    }
    let state: State<'_, RemoteConnections> = app.state();
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let machines = read_uncached(&store_path(app)?)?;
    Ok(
        json!({"machines": machines.iter().map(|machine| json!({"id":machine.id,"name":machine.name,
        "environmentId":machine.environment_id,"localHost":machine.local_host})).collect::<Vec<_>>() }),
    )
}

pub(crate) fn conversation_machine_call_pinned(
    app: &AppHandle,
    action: &str,
    input: &Value,
    owner: &str,
    expires_at: &Value,
    issuer: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<NativeDeviceReply, String> {
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
            | "devices.control.status"
            | "devices.control.claim"
            | "devices.control.release"
            | "devices.control.renew"
            | "devices.inspect"
            | "devices.action"
    ) {
        return Err("Unsupported paired device operation".into());
    }
    taken.check()?;
    if !taken.is_issued_by(issuer) || !issuer.is_current() {
        return Err("The original desktop issuer changed".into());
    }
    let state: State<'_, RemoteConnections> = app.state();
    let id = input
        .get("machineId")
        .and_then(Value::as_str)
        .ok_or("Explicit machineId required")?;
    let mut params = input.clone();
    params
        .as_object_mut()
        .ok_or("Invalid machine input")?
        .remove("machineId");
    if action.starts_with("devices.preview") {
        params["previewOwner"] = json!(owner);
        params["previewExpiresAt"] = expires_at.clone();
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_millis();
    let remaining = expires_at
        .as_u64()
        .map(u128::from)
        .and_then(|expires| expires.checked_sub(now))
        .filter(|remaining| *remaining > 0)
        .ok_or("The original desktop device request expired before dispatch")?;
    let remaining = std::time::Duration::from_millis(
        u64::try_from(remaining).map_err(|_| "Invalid desktop request deadline")?,
    );
    let started = std::time::Instant::now();
    let grant_deadline = started
        .checked_add(remaining)
        .ok_or("Invalid desktop request deadline")?;
    let deadline = (started + rpc_timeout(action, &params)).min(grant_deadline);
    let environment = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read_uncached(&store_path(app)?)?
            .into_iter()
            .find(|m| m.id == id)
            .ok_or("Selected machine is no longer connected")?
            .environment_id
    };
    let channel = native_devices::NativeDeviceChannel::connect(
        app,
        &state,
        id,
        &environment,
        taken,
        deadline,
        grant_deadline,
    )?;
    channel.request(action, params, taken, deadline)
}

#[tauri::command]
pub async fn social_authority_status(app: AppHandle) -> Result<Value, String> {
    crate::harness::run_blocking("social_authority_status", move || {
        let state = app.state::<RemoteConnections>();
        let source = NativeServiceChannel::connect(&app)?;
        let machines = {
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            read_uncached(&store_path(&app)?)?
        };
        source.project("social.native.status", json!({}), |value| {
            let mut value = value.clone();
            value["sourceMachineId"] = json!(source.machine_id());
            if let Some(id) = value["authority"]["environmentId"]
                .as_str()
                .map(str::to_owned)
            {
                value["authorityMachineId"] = machines
                    .iter()
                    .find(|m| m.environment_id == id)
                    .map(|m| json!(m.id))
                    .unwrap_or(Value::Null);
            }
            Ok(value)
        })
    })
    .await
}

#[tauri::command]
pub async fn social_authority_connect(
    app: AppHandle,
    machine_id: Option<String>,
    mapping: Value,
    source_endpoint: Option<String>,
) -> Result<Value, String> {
    crate::harness::run_blocking("social_authority_connect", move || {
        let state = app.state::<RemoteConnections>();
        let source = NativeServiceChannel::connect(&app)?;
        let Some(id) = machine_id else {
            return source.project("social.native.reset", json!({}), |value| Ok(value.clone()));
        };
        let target = {
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            read_uncached(&store_path(&app)?)?
                .into_iter()
                .find(|m| m.id == id && m.environment_id != source.environment_id())
                .ok_or("Choose a different paired host")?
        };
        let source_url = source_endpoint
            .ok_or("Enter this host's HTTPS endpoint reachable from the central authority")?;
        let source_url = social_peer_endpoint(&source_url)?;
        let authority_url = social_peer_endpoint(&target.endpoint)?;
        let peer = NativeServiceChannel::peer(&app, &target.id, &target.environment_id)?;
        let enrollment = source.request(
            "social.native.enroll",
            json!({"environmentId":target.environment_id}),
        )?;
        let token = enrollment.project(|value| {
            value["token"]
                .as_str()
                .map(str::to_owned)
                .ok_or("Social enrollment failed".into())
        })?;
        enrollment.check()?;
        // The dedicated enrollment token is forwarded only to its original paired
        // authority. It is never a device/session tool principal or renderer value.
        let registered = peer.request(
            "social.native.register",
            json!({"environmentId":source.environment_id(),
            "endpoint":source_url,"token":token,"mapping":mapping}),
        )?;
        registered.check()?;
        enrollment.check()?;
        let result = source.request(
            "social.native.authority",
            json!({"environmentId":target.environment_id,
            "endpoint":authority_url,"mapping":mapping}),
        )?;
        registered.check()?;
        result.project(|value| Ok(value.clone()))
    })
    .await
}

#[path = "remote/method_catalog.rs"]
mod method_catalog;
use method_catalog::{decision_model_key_allowed, supported_remote_method};
#[path = "remote/social_endpoint.rs"]
mod social_endpoint;
use social_endpoint::social_peer_endpoint;
#[path = "remote/transport_health.rs"]
mod transport_health;
pub(crate) use transport_health::local_host_refusing;

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

mod ssh_jobs;
use ssh_jobs::start_ssh_job;

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
#[path = "remote_recovery_ws_tests.rs"]
mod recovery_ws_tests;

#[cfg(test)]
mod tests;
