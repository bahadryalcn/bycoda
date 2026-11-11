use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
#[cfg(all(test, unix))]
use std::process::Child;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::fs::expand_home;
#[cfg(test)]
use crate::native_provider_output::StreamKind;
use crate::native_provider_output::{
    NativeOutputStream, NativeProviderOutputRegistry, OutputChannel, OutputMetadata, OutputOwner,
    OutputSource, OutputState, UnavailableReason,
};
use crate::passwd_identity;

mod launch_env;
pub(crate) mod management_authority;
#[cfg(windows)]
mod mcp_auth;
pub(crate) mod owned_opencode;
pub(crate) mod process_lifecycle;
mod process_receipts;
mod tool_grants;
pub(crate) mod turn_writes;
use launch_env::{apply_launch_env, apply_provider_account};
use process_lifecycle::{OwnedChild, WriteGate};

const STDOUT_EVENT: &str = "harness-stdout-lines";
const STDERR_EVENT: &str = "harness-stderr-lines";
const EXIT_EVENT: &str = "harness-exit";
const SSE_EVENT: &str = "harness-sse-batch";
const SSE_END_EVENT: &str = "harness-sse-end";
const OUTPUT_STATE_EVENT: &str = "harness-output-state";

pub(crate) const DEFAULT_PROVIDER_ACCOUNT_ID: &str = "default";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAccount {
    provider: String,
    id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarnessLines {
    session_id: String,
    construction_id: String,
    lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_output: Option<OutputMetadata>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarnessExit {
    session_id: String,
    construction_id: String,
    code: Option<i32>,
    pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_output_state: Option<OutputState>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarnessSseBatch {
    session_id: String,
    data: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_output: Option<OutputMetadata>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarnessSseEnd {
    session_id: String,
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_output_state: Option<OutputState>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarnessOutputState {
    session_id: String,
    native_output_state: OutputState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessHttpResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorBinary {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredBinary {
    pub path: String,
    pub args: Option<Vec<String>>,
    /// Antigravity only: which wire protocol this binary speaks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityBinary {
    pub path: String,
    pub args: Vec<String>,
    /// `acp` for the separate ACP server, `stream-json` for the agy CLI's
    /// headless mode (the only thing Windows has).
    pub transport: &'static str,
}

const ANTIGRAVITY_ACP: &str = "acp";
const ANTIGRAVITY_STREAM_JSON: &str = "stream-json";

/// The ACP server is `agy_acp_server(.par)`; a binary named `agy` is the CLI.
fn antigravity_transport(path: &Path) -> &'static str {
    if binary_name_eq(path, "agy") {
        ANTIGRAVITY_STREAM_JSON
    } else {
        ANTIGRAVITY_ACP
    }
}

fn antigravity_args(transport: &str) -> Vec<String> {
    if transport == ANTIGRAVITY_ACP && cfg!(target_os = "linux") {
        vec!["--uid=".into()]
    } else {
        Vec::new()
    }
}

/// Source-issued correlation for one physical process, never an operation grant
/// or proof that the provider consumed a frame.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessProcessReceipt {
    version: u8,
    backend: &'static str,
    session_id: String,
    pid: u32,
    construction_id: String,
}

/// Upper bound for one wait while stopping an already-signalled provider.
const STOP_WAIT: Duration = Duration::from_secs(5);
/// One shared deadline for the whole `stop_and_drain` (writer drain, process
/// wait and exit confirmation) instead of a fresh `STOP_WAIT` for each step.
const STOP_DEADLINE: Duration = Duration::from_secs(8);
/// One shared deadline for every retained provider exit of a retiring session.
const RETIRE_EXIT_DEADLINE: Duration = Duration::from_secs(20);

struct LiveChild {
    cwd: PathBuf,
    stdin: Mutex<ChildStdin>,
    pid: u32,
    /// The actual process output stream's UUID, not the registry-wide process epoch.
    construction_id: String,
    /// Captured from the actual spawning window, never reconstructed by label.
    issuer: Option<Arc<crate::control::receipts::WindowIssuer>>,
    /// Original Native turn/output association; warm per-turn control is separate.
    _control_turn: Option<Arc<crate::control::ChildControlTurn>>,
    native_session_capability:
        Option<crate::session_store::canonical_store::NativeSessionCapability>,
    native_process_purpose: Option<crate::session_store::canonical_store::NativeProcessPurpose>,
    management_input_policy: Option<management_authority::InputPolicy>,
    management_route_id: Option<String>,
    utility_executable: Option<String>,
    utility_endpoint: Option<String>,
    account: Option<HarnessAccount>,
    /// Windows that consume this child's output.
    owners: Arc<Owners>,
    output: Option<Arc<NativeOutputStream>>,
    process: Option<Arc<crate::native_provider_output::NativeOutputChild>>,
    exit: Option<Arc<ManagedProviderExit>>,
    writers: Arc<WriteGate>,
    /// FIFO that serializes every stdin write (plain and controlled) to this child.
    order: Arc<WriteOrder>,
}

impl LiveChild {
    fn admit_write(&self) -> Result<LiveWrite, String> {
        let permit = self.writers.admit()?;
        let process = self
            .process
            .as_ref()
            .ok_or("Original process owner unavailable")?
            .pin()
            .map_err(|e| e.to_string())?;
        // The ticket is taken here, at command entry, so writes leave in arrival
        // order. This never blocks; the wait happens in `LiveWrite::acquire`.
        Ok(LiveWrite {
            ticket: self.order.ticket(),
            order: self.order.clone(),
            _permit: permit,
            _process: process,
            gate: self.writers.clone(),
            acquired: false,
            started: false,
            completed: false,
        })
    }
    fn request_stop(&self) -> Result<(), String> {
        self.writers.close();
        self.process
            .as_ref()
            .ok_or("Original process owner unavailable")?
            .request_stop()
            .map_err(|e| e.to_string())
    }
    /// Best-effort and idempotent: the waits share one deadline, failures are logged and
    /// never surfaced. The process was already signalled/terminated by `request_stop`.
    fn stop_and_drain(&self) -> Result<(), String> {
        let deadline = Instant::now() + STOP_DEADLINE;
        let left = || deadline.saturating_duration_since(Instant::now());
        if let Err(error) = self.request_stop() {
            log::warn!("stop request failed: {error}");
        }
        match self.writers.drain_timeout(left()) {
            None => log::warn!("writer drain timed out during stop"),
            Some(Err(error)) => log::warn!("writer settled with failure: {error}"),
            Some(Ok(())) => {}
        }
        if let Some(process) = &self.process {
            match process.wait_actual_timeout(left()) {
                None => log::warn!("process wait timed out during stop"),
                Some(Err(error)) => log::warn!("process wait failed during stop: {error}"),
                // The process owner reports an unverified retirement itself.
                Some(Ok(_)) => {}
            }
        }
        if let Some(exit) = &self.exit {
            if let Err(error) = exit.wait(left()) {
                log::warn!("provider exit not confirmed during stop: {error}");
            }
        }
        Ok(())
    }
    fn receipt(&self, session_id: &str) -> HarnessProcessReceipt {
        HarnessProcessReceipt {
            version: 1,
            backend: "native",
            session_id: session_id.to_owned(),
            pid: self.pid,
            construction_id: self.construction_id.clone(),
        }
    }
}

const WRITE_ORDER_POLL: Duration = Duration::from_millis(100);
pub(crate) const PROVIDER_NOT_READING: &str = "The provider is not reading its input; the previous message's delivery is unknown. Stop the turn and retry.";

/// Per-child FIFO of provider stdin writes. Provider clients legitimately issue
/// writes back-to-back (handshake, notifications, approval responses, steer), so
/// an overlapping write waits for its predecessors instead of being refused. A
/// slot is held until the writer thread itself finishes, so a wedged or timed-out
/// write keeps later writes from starting and they refuse after their own budget.
#[derive(Default)]
struct WriteOrder {
    state: Mutex<WriteOrderState>,
    changed: Condvar,
}
#[derive(Default)]
struct WriteOrderState {
    next: u64,
    serving: u64,
    /// Tickets released before their turn; skipped when serving reaches them.
    abandoned: std::collections::BTreeSet<u64>,
}
impl WriteOrder {
    fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn ticket(&self) -> u64 {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let ticket = state.next;
        state.next += 1;
        ticket
    }
    /// A free slot is taken even when the deadline has already passed.
    fn wait_turn(&self, ticket: u64, deadline: Instant, gate: &WriteGate) -> Result<(), String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if state.serving == ticket {
                return Ok(());
            }
            if gate.is_closing() {
                return Err("Original process is closing".into());
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(PROVIDER_NOT_READING.into());
            }
            state = self
                .changed
                .wait_timeout(state, left.min(WRITE_ORDER_POLL))
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }
    fn release(&self, ticket: u64) {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let state = &mut *guard;
        if ticket < state.serving {
            return;
        }
        if ticket > state.serving {
            state.abandoned.insert(ticket);
            return;
        }
        state.serving += 1;
        while state.abandoned.remove(&state.serving) {
            state.serving += 1;
        }
        self.changed.notify_all();
    }
}

struct LiveWrite {
    ticket: u64,
    order: Arc<WriteOrder>,
    _permit: process_lifecycle::WritePermit,
    _process: process_lifecycle::ProcessPin,
    gate: Arc<WriteGate>,
    acquired: bool,
    started: bool,
    completed: bool,
}
impl LiveWrite {
    /// Waits for this write's turn on the child's stdin, at most until `deadline`.
    /// Idempotent. Call it only from a blocking section.
    fn acquire(&mut self, deadline: Instant) -> Result<(), String> {
        if !self.acquired {
            self.order.wait_turn(self.ticket, deadline, &self.gate)?;
            self.acquired = true;
        }
        Ok(())
    }
    fn finish(mut self, result: &Result<(), String>) {
        if let Err(error) = result {
            self.gate.record_failure(error.clone());
        }
        self.completed = true;
    }
}
impl Drop for LiveWrite {
    fn drop(&mut self) {
        self.order.release(self.ticket);
        if self.started && !self.completed {
            self.gate
                .record_failure("Original writer settlement unknown".into());
        }
    }
}

#[cfg(all(test, unix))]
struct TestOwnedChild {
    process: Arc<crate::native_provider_output::NativeOutputChild>,
}
#[cfg(all(test, unix))]
impl TestOwnedChild {
    fn kill(&mut self) -> std::io::Result<()> {
        self.process.request_stop()
    }
    fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.process.wait_actual()
    }
}
#[cfg(all(test, unix))]
fn owned_live_fixture<C: Into<OwnedChild>>(child: C) -> (Arc<LiveChild>, TestOwnedChild) {
    let mut child = child.into();
    let stdin = child.stdin.take().unwrap();
    let registry = NativeProviderOutputRegistry::new();
    let (output, process) = registry.begin_process(
        OutputSource::fixture("owned-test"),
        child,
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    output.reader(0).finish(true, false);
    output.reader(1).finish(true, false);
    let exit = Arc::new(ManagedProviderExit::default());
    let live = Arc::new(LiveChild {
        cwd: std::env::temp_dir(),
        stdin: Mutex::new(stdin),
        pid: process.id(),
        construction_id: output.epoch().into(),
        issuer: None,
        _control_turn: None,
        native_session_capability: None,
        native_process_purpose: None,
        management_input_policy: None,
        management_route_id: None,
        utility_executable: None,
        utility_endpoint: None,
        account: None,
        owners: Arc::new(Owners::default()),
        output: Some(output.clone()),
        process: Some(process.clone()),
        exit: Some(exit.clone()),
        writers: WriteGate::new(),
        order: WriteOrder::new(),
    });
    let waiting = process.clone();
    thread::spawn(move || {
        exit.finish(
            waiting
                .wait(&output, false)
                .map(|_| ())
                .map_err(|e| e.to_string()),
        );
    });
    (live, TestOwnedChild { process })
}

fn require_process_construction(value: Option<&str>) -> Result<&str, String> {
    let value = value.ok_or("NATIVE_PROCESS_CONSTRUCTION_REQUIRED")?;
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| "NATIVE_PROCESS_CONSTRUCTION_INVALID")?;
    if value.len() != 36
        || parsed.to_string() != value
        || parsed.as_bytes()[6] >> 4 != 4
        || parsed.as_bytes()[8] & 0xc0 != 0x80
    {
        return Err("NATIVE_PROCESS_CONSTRUCTION_INVALID".into());
    }
    Ok(value)
}

#[cfg(test)]
#[path = "harness/process_construction_tests.rs"]
mod process_construction_tests;

struct LiveSse {
    stop: Arc<AtomicBool>,
    issuer: Option<Arc<crate::control::receipts::WindowIssuer>>,
    owners: Arc<Owners>,
    output: Option<Arc<NativeOutputStream>>,
    native_session_capability:
        Option<crate::session_store::canonical_store::NativeSessionCapability>,
}

/// Where a child's events go: only the windows that consume them, instead of
/// every webview. Each window's frontend listens scoped to its own label and
/// discards output for children it does not own, so broadcasting only costs
/// serialisation and a JS callback per window.
#[derive(Default)]
struct Owners {
    labels: Mutex<Vec<String>>,
    physical: Mutex<HashMap<String, Arc<OutputOwner>>>,
}

#[derive(Debug, PartialEq, Eq)]
enum Route {
    Windows(Vec<String>),
    /// No owner is known or alive; correctness beats savings.
    Broadcast,
}

impl Owners {
    fn new(label: &str) -> Self {
        Self {
            labels: Mutex::new(vec![label.to_string()]),
            physical: Mutex::new(HashMap::new()),
        }
    }

    fn add(&self, label: &str) {
        let mut labels = self.labels.lock().unwrap_or_else(|e| e.into_inner());
        if !labels.iter().any(|existing| existing == label) {
            labels.push(label.to_string());
        }
    }
    fn for_source(window: &tauri::WebviewWindow, source: &OutputSource) -> Self {
        let owners = Self::new(window.label());
        if let Some(owner) = source.owner() {
            owners
                .physical
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(window.label().into(), owner);
        }
        owners
    }
    fn capture_window(&self, window: &tauri::WebviewWindow, instance: Option<uuid::Uuid>) {
        let Some(instance) = instance else {
            return;
        };
        let Some(owner) = OutputOwner::capture(window, instance) else {
            return;
        };
        let mut physical = self
            .physical
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // Missing/overflow observations remain unknown; legacy label routing is
        // preserved rather than denying an ordinary attach.
        if physical.len() < 64 {
            physical.entry(window.label().into()).or_insert(owner);
        }
    }
    fn add_window(&self, window: &tauri::WebviewWindow) {
        self.add(window.label());
        self.capture_window(
            window,
            window
                .app_handle()
                .try_state::<crate::session_store::SessionStore>()
                .map(|store| store.native_instance_id()),
        );
    }
    fn output_owner(&self, label: &str) -> Option<Arc<OutputOwner>> {
        self.physical
            .lock()
            .ok()?
            .get(label)
            .filter(|owner| owner.current())
            .cloned()
    }
    fn output_current(&self) -> bool {
        let Ok(labels) = self.labels.lock() else {
            return false;
        };
        !labels.is_empty()
            && labels
                .iter()
                .all(|label| self.output_owner(label).is_some())
    }

    /// Owners whose window still exists, or a broadcast when there are none.
    fn route(&self, window_exists: impl Fn(&str) -> bool) -> Route {
        let labels = self.labels.lock().unwrap_or_else(|e| e.into_inner());
        let live: Vec<String> = labels
            .iter()
            .filter(|label| window_exists(label))
            .cloned()
            .collect();
        if live.is_empty() {
            Route::Broadcast
        } else {
            Route::Windows(live)
        }
    }
}

// The ledger observation is pre-recipient. Only the final native route can
// stamp the captured physical consumer; this is not the spawning-owner grant.
fn recipient_output_metadata(
    mut observed: Option<OutputMetadata>,
    owner_epoch: Option<String>,
) -> Option<OutputMetadata> {
    if let Some(observed) = &mut observed {
        observed.owner_epoch = owner_epoch;
        if observed.owner_epoch.is_none() {
            observed.available = false;
            observed
                .unavailable_reason
                .get_or_insert(UnavailableReason::OwnerUnavailable);
        }
    }
    observed
}

fn recipient_output_state(mut state: OutputState, owner_epoch: Option<String>) -> OutputState {
    state.owner_epoch = owner_epoch;
    if state.owner_epoch.is_none() {
        state.state = crate::native_provider_output::EmissionState::Unavailable;
        state
            .reason
            .get_or_insert(UnavailableReason::OwnerUnavailable);
    }
    state
}

fn emit_output_batch<P: Serialize + Clone>(
    app: &AppHandle,
    owners: &Owners,
    stream: &NativeOutputStream,
    event: &str,
    channel: OutputChannel,
    items: &[String],
    make: impl Fn(Option<OutputMetadata>) -> P,
) {
    let route = owners.route(|label| app.get_webview_window(label).is_some());
    if matches!(route, Route::Broadcast) {
        stream.invalidate(UnavailableReason::BroadcastOwner);
    }
    stream.emit_prepared(channel, items, |metadata, prepared| {
        let mut delivered = false;
        let mut complete = true;
        if let Route::Windows(labels) = route {
            for label in labels {
                let owner = owners.output_owner(&label);
                let observed = recipient_output_metadata(
                    metadata.clone(),
                    owner.as_ref().map(|owner| owner.epoch()),
                );
                let sent = app.emit_to(label.as_str(), event, make(observed)).is_ok();
                stream.observe_prepared_delivery(
                    metadata.as_ref(),
                    owner.clone(),
                    prepared.as_ref(),
                    sent,
                );
                delivered |= sent;
                complete &= sent && owner.is_some();
            }
        } else {
            complete = false;
        }
        if !delivered {
            let mut observed = metadata.clone();
            if let Some(observed) = &mut observed {
                observed.owner_epoch = None;
                observed.available = false;
                observed
                    .unavailable_reason
                    .get_or_insert(UnavailableReason::BroadcastOwner);
            }
            // Preserve existing fallback delivery; it never supplies an exact
            // physical consumer or a prospective Native checkpoint seal.
            let sent = app.emit(event, make(observed)).is_ok();
            stream.observe_prepared_delivery(metadata.as_ref(), None, prepared.as_ref(), sent);
            complete = false;
        }
        complete
    });
}

fn route_output_state<P: Serialize + Clone>(
    app: &AppHandle,
    owners: &Owners,
    state: OutputState,
    event: &str,
    make: impl Fn(OutputState) -> P,
) -> bool {
    let mut delivered = false;
    let mut complete = true;
    if let Route::Windows(labels) = owners.route(|label| app.get_webview_window(label).is_some()) {
        for label in labels {
            let owner = owners.output_owner(&label);
            let current =
                recipient_output_state(state.clone(), owner.as_ref().map(|owner| owner.epoch()));
            let sent = app.emit_to(label.as_str(), event, make(current)).is_ok();
            delivered |= sent;
            complete &= sent && owner.is_some();
        }
    } else {
        complete = false;
    }
    if !delivered {
        let mut current = state;
        current.owner_epoch = None;
        current.state = crate::native_provider_output::EmissionState::Unavailable;
        current
            .reason
            .get_or_insert(UnavailableReason::BroadcastOwner);
        let _ = app.emit(event, make(current));
        complete = false;
    }
    complete
}

type OutputCurrentCheck = Arc<dyn Fn() -> bool + Send + Sync>;
type OutputNotice = Arc<dyn Fn(OutputState) -> bool + Send + Sync>;
fn output_callbacks(app: &AppHandle, owners: &Arc<Owners>) -> (OutputCurrentCheck, OutputNotice) {
    let current = owners.clone();
    let notice_owners = owners.clone();
    let notice_app = app.clone();
    (
        Arc::new(move || current.output_current()),
        Arc::new(move |state| {
            let session_id = state.session_id.clone();
            route_output_state(
                &notice_app,
                &notice_owners,
                state,
                OUTPUT_STATE_EVENT,
                |native_output_state| HarnessOutputState {
                    session_id: session_id.clone(),
                    native_output_state,
                },
            )
        }),
    )
}

struct HarnessInner {
    children: HashMap<String, Arc<LiveChild>>,
    epochs: HashMap<String, u64>,
    managed_exits: HashMap<String, Vec<Arc<ManagedProviderExit>>>,
    receipts: process_receipts::ProcessReceipts,
    turn_bindings: turn_writes::Bindings,
}

/// A removed child is not proof that its process and Host activity have exited.
/// Keep this receipt across ordinary stop calls until acknowledged retirement
/// consumes it. Successful older lifetimes are pruned on the next spawn.
#[derive(Default)]
struct ManagedProviderExit {
    result: Mutex<Option<Result<(), String>>>,
    changed: Condvar,
}
struct OwnedHttpCompletion {
    exit: Arc<ManagedProviderExit>,
    complete: bool,
}
impl Drop for OwnedHttpCompletion {
    fn drop(&mut self) {
        if !self.complete {
            self.exit
                .finish(Err("OWNED_OPENCODE_HTTP_OUTCOME_UNKNOWN".into()));
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PageRetirement {
    Pending,
    Confirmed,
    Unknown,
}

struct PageProof {
    id: String,
    issuer: Arc<crate::control::receipts::WindowIssuer>,
    pending: usize,
    uncertain: bool,
    exits: Vec<Arc<ManagedProviderExit>>,
}

fn page_proofs() -> &'static Mutex<Vec<PageProof>> {
    static PROOFS: OnceLock<Mutex<Vec<PageProof>>> = OnceLock::new();
    PROOFS.get_or_init(Mutex::default)
}

fn page_proof_id(issuer: &Arc<crate::control::receipts::WindowIssuer>) -> Result<String, String> {
    let mut proofs = page_proofs()
        .lock()
        .map_err(|_| "NATIVE_PAGE_PROOF_UNAVAILABLE")?;
    if let Some(proof) = proofs
        .iter()
        .find(|proof| Arc::ptr_eq(&proof.issuer, issuer))
    {
        return Ok(proof.id.clone());
    }
    let id = uuid::Uuid::new_v4().to_string();
    proofs.push(PageProof {
        id: id.clone(),
        issuer: issuer.clone(),
        pending: 0,
        uncertain: false,
        exits: Vec::new(),
    });
    Ok(id)
}

fn mark_page_external_unverified(
    issuer: &Arc<crate::control::receipts::WindowIssuer>,
) -> Result<(), String> {
    let id = page_proof_id(issuer)?;
    let mut proofs = page_proofs()
        .lock()
        .map_err(|_| "NATIVE_PAGE_PROOF_UNAVAILABLE")?;
    proofs
        .iter_mut()
        .find(|proof| proof.id == id)
        .ok_or("NATIVE_PAGE_PROOF_UNAVAILABLE")?
        .uncertain = true;
    Ok(())
}

/// This ID is generated by Native for the actual page resource, never supplied
/// by the renderer. It is meaningful only while this app process is alive.
pub(crate) fn page_incarnation(window: &tauri::Window) -> Result<String, String> {
    let webview = window
        .app_handle()
        .get_webview_window(window.label())
        .ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    // Re-checks run under store writer locks that admitted spawns wait for.
    issuer.ensure_live()?;
    page_proof_id(&issuer)
}

pub(crate) fn page_retirement_status(id: &str) -> PageRetirement {
    let Ok(proofs) = page_proofs().lock() else {
        return PageRetirement::Unknown;
    };
    let Some(proof) = proofs.iter().find(|proof| proof.id == id) else {
        return PageRetirement::Unknown;
    };
    if proof.uncertain {
        return PageRetirement::Unknown;
    }
    if proof.issuer.is_live()
        || proof.pending != 0
        || proof.exits.iter().any(|exit| !exit.settled())
    {
        return PageRetirement::Pending;
    }
    if !proof.issuer.is_retired() {
        return PageRetirement::Unknown;
    }
    if proof.exits.iter().all(|exit| exit.succeeded()) {
        PageRetirement::Confirmed
    } else {
        PageRetirement::Unknown
    }
}

/// Retry only a retired page with work that can still settle. A live page or
/// permanently uncertain evidence must not start an endless recovery poll.
pub(crate) fn page_retirement_waiting(id: &str) -> bool {
    let Ok(proofs) = page_proofs().lock() else {
        return false;
    };
    let Some(proof) = proofs.iter().find(|proof| proof.id == id) else {
        return false;
    };
    proof.issuer.is_retired()
        && !proof.uncertain
        && (proof.pending != 0 || proof.exits.iter().any(|exit| !exit.settled()))
}

/// Call only after durable recovery acknowledgement removed every row for this
/// incarnation. Pending and uncertain proof must remain retained.
pub(crate) fn release_page_proof(id: &str) {
    if let Ok(mut proofs) = page_proofs().lock() {
        proofs.retain(|proof| {
            !(proof.id == id
                && proof.issuer.is_retired()
                && !proof.uncertain
                && proof.pending == 0
                && proof.exits.iter().all(|exit| exit.succeeded()))
        });
    }
}

struct PageStart {
    id: String,
    completed: bool,
}
impl PageStart {
    fn complete(&mut self) {
        self.completed = true;
    }
    fn new(issuer: &Arc<crate::control::receipts::WindowIssuer>) -> Result<Self, String> {
        issuer.with_live(|| {
            let id = page_proof_id(issuer)?;
            let mut proofs = page_proofs()
                .lock()
                .map_err(|_| "NATIVE_PAGE_PROOF_UNAVAILABLE")?;
            proofs
                .iter_mut()
                .find(|proof| proof.id == id)
                .ok_or("NATIVE_PAGE_PROOF_UNAVAILABLE")?
                .pending += 1;
            Ok(Self {
                id,
                completed: false,
            })
        })
    }
    fn attach(&self, exit: Arc<ManagedProviderExit>) -> Result<(), String> {
        let mut proofs = page_proofs()
            .lock()
            .map_err(|_| "NATIVE_PAGE_PROOF_UNAVAILABLE")?;
        let proof = proofs
            .iter_mut()
            .find(|proof| proof.id == self.id)
            .ok_or("NATIVE_PAGE_PROOF_UNAVAILABLE")?;
        proof.exits.retain(|entry| !entry.succeeded());
        proof.exits.push(exit);
        Ok(())
    }
}
impl Drop for PageStart {
    fn drop(&mut self) {
        if let Ok(mut proofs) = page_proofs().lock() {
            if let Some(proof) = proofs.iter_mut().find(|proof| proof.id == self.id) {
                proof.pending = proof.pending.saturating_sub(1);
                proof.uncertain |= !self.completed;
            }
        }
    }
}

/// Source-private capacity claim. A never-attempted setup may release its slot;
/// once OS creation is attempted a panic/unknown outcome retains the reservation.
/// It does not supply retirement evidence and is never serialized.
struct ProcessStart<'host> {
    host: &'host HarnessHost,
    exit: Arc<ManagedProviderExit>,
    attempted: bool,
}
impl Drop for ProcessStart<'_> {
    fn drop(&mut self) {
        if !self.attempted {
            self.host
                .lock_inner()
                .receipts
                .release_unstarted(&self.exit);
        }
    }
}

impl ManagedProviderExit {
    fn succeeded(&self) -> bool {
        matches!(
            self.result
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref(),
            Some(Ok(()))
        )
    }
    fn settled(&self) -> bool {
        self.result
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    fn finish(&self, result: Result<(), String>) {
        *self.result.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
        self.changed.notify_all();
    }

    fn wait(&self, timeout: Duration) -> Result<(), String> {
        let result = self.result.lock().unwrap_or_else(|e| e.into_inner());
        let (result, _) = self
            .changed
            .wait_timeout_while(result, timeout, |result| result.is_none())
            .unwrap_or_else(|e| e.into_inner());
        result.clone().unwrap_or_else(|| {
            Err(
                "Managed provider exit is not confirmed; reconnect before capturing the turn"
                    .into(),
            )
        })
    }
}

/// Best-effort: the process was waited, so admission is released even if its
/// retirement is unproven. The process owner reports that failure itself.
fn finish_spawn_authority(
    authority: crate::session_store::authority::NativeLease,
) -> Result<(), String> {
    authority.finish()
}

/// Runs blocking command work (network RPC, SQLite under the write connection,
/// process spawn/wait, file hashing) on Tauri's blocking pool. A
/// `#[tauri::command(async)]` sync fn runs on the tokio workers (one per core);
/// enough stalled ones would freeze every IPC command, stop and write included.
pub(crate) async fn run_blocking<T, F>(label: &'static str, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("{label} task failed: {error}"))?
}

pub struct HarnessHost {
    inner: Mutex<HarnessInner>,
    sse: Mutex<HashMap<String, Arc<LiveSse>>>,
    runtime_binary_paths: Mutex<Option<HashMap<String, String>>>,
    /// Bumped by `kill_all` so a spawn that started before quit cannot reinsert.
    kill_all_gen: AtomicU64,
    output: NativeProviderOutputRegistry,
}

fn session_spawn_gate(target: &str) -> Arc<Mutex<()>> {
    static SPAWNS: OnceLock<Mutex<HashMap<String, std::sync::Weak<Mutex<()>>>>> = OnceLock::new();
    let mut gates = SPAWNS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    gates.retain(|_, gate| gate.strong_count() != 0);
    if let Some(gate) = gates.get(target).and_then(std::sync::Weak::upgrade) {
        return gate;
    }
    let gate = Arc::new(Mutex::new(()));
    gates.insert(target.to_owned(), Arc::downgrade(&gate));
    gate
}

/// Hold the same ordered spawn gates through native ownership transfer, so a
/// transfer cannot race a pending fork or move a live provider to another page.
pub(crate) fn with_quiescent_sessions<T>(
    app: &AppHandle,
    ids: &[String],
    transfer: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let mut ids = ids.to_vec();
    ids.sort();
    ids.dedup();
    let gates: Vec<_> = ids.iter().map(|id| session_spawn_gate(id)).collect();
    let _guards = gates
        .iter()
        .map(|gate| {
            gate.try_lock()
                .map_err(|_| "Conversation is still starting; retry transfer".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let host = app.state::<HarnessHost>();
    let inner = host.lock_inner();
    if inner.children.iter().any(|(route, child)| {
        ids.iter().any(|id| {
            route == id
                || crate::native_provider_output::logical_session(route) == id
                || child
                    .output
                    .as_ref()
                    .is_some_and(|output| output.target() == id)
                || child
                    .native_session_capability
                    .as_ref()
                    .is_some_and(|capability| capability.shell_id() == id)
        })
    }) {
        return Err("A conversation is still running; stop it before moving".into());
    }
    if ids.iter().any(|id| {
        inner
            .managed_exits
            .get(id)
            .is_some_and(|exits| exits.iter().any(|exit| !exit.succeeded()))
    }) {
        return Err("Conversation process exit is unconfirmed; retry transfer".into());
    }
    drop(inner);
    let streams = host
        .sse
        .lock()
        .map_err(|_| "Conversation state unavailable")?;
    if streams.iter().any(|(route, stream)| {
        ids.iter().any(|id| {
            route == id
                || crate::native_provider_output::logical_session(route) == id
                || stream
                    .output
                    .as_ref()
                    .is_some_and(|output| output.target() == id)
                || stream
                    .native_session_capability
                    .as_ref()
                    .is_some_and(|capability| capability.shell_id() == id)
        })
    }) {
        return Err("A conversation is still running; stop it before moving".into());
    }
    drop(streams);
    transfer()
}

impl HarnessHost {
    fn reserve_process(&self, session_id: &str) -> Result<ProcessStart<'_>, String> {
        let mut inner = self.lock_inner();
        inner.receipts.capacity()?;
        let exit = Arc::new(ManagedProviderExit::default());
        inner.receipts.reserve(session_id, exit.clone());
        Ok(ProcessStart {
            host: self,
            exit,
            attempted: false,
        })
    }
    /// Only a retained native construction can translate a routing key. No
    /// suffix parsing or caller-supplied logical identity is involved.
    fn output_for_route(&self, route: &str) -> Result<Option<Arc<NativeOutputStream>>, String> {
        let process = self.get(route).and_then(|live| live.output.clone());
        let sse = self
            .sse
            .lock()
            .map_err(|_| "NATIVE_OUTPUT_SOURCE_UNAVAILABLE")?
            .get(route)
            .and_then(|live| live.output.clone());
        if process
            .as_ref()
            .zip(sse.as_ref())
            .is_some_and(|(a, b)| a.target() != b.target())
        {
            return Err("NATIVE_OUTPUT_SOURCE_CHANGED".into());
        }
        Ok(process.or(sse))
    }
    pub(crate) fn authority_idle(&self, session_id: &str) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "NATIVE_AUTHORITY_UNKNOWN_PROCESS")?;
        if inner.children.iter().any(|(route, child)| {
            crate::native_provider_output::logical_session(route) == session_id
                || child
                    .output
                    .as_ref()
                    .is_some_and(|output| output.target() == session_id)
                || child
                    .native_session_capability
                    .as_ref()
                    .is_some_and(|capability| capability.shell_id() == session_id)
        }) {
            return Err("NATIVE_AUTHORITY_PROVIDER_ACTIVE".into());
        }
        for exit in inner.managed_exits.get(session_id).into_iter().flatten() {
            let result = exit
                .result
                .lock()
                .map_err(|_| "NATIVE_AUTHORITY_UNKNOWN_PROCESS")?;
            if !matches!(result.as_ref(), Some(Ok(()))) {
                return Err("NATIVE_AUTHORITY_UNKNOWN_PROVIDER_SETTLEMENT".into());
            }
        }
        drop(inner);
        if self
            .sse
            .lock()
            .map_err(|_| "NATIVE_AUTHORITY_UNKNOWN_PROCESS")?
            .iter()
            .any(|(route, live)| {
                route == session_id
                    || live
                        .native_session_capability
                        .as_ref()
                        .is_some_and(|capability| capability.shell_id() == session_id)
                    || live
                        .output
                        .as_ref()
                        .is_some_and(|output| output.target() == session_id)
            })
        {
            return Err("NATIVE_AUTHORITY_PROVIDER_STREAM_ACTIVE".into());
        }
        Ok(())
    }
    pub(crate) fn runtime_binary_path(&self, provider: &str) -> Option<String> {
        self.runtime_binary_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()?
            .get(provider)
            .map(|path| path.trim().to_owned())
            .filter(|path| !path.is_empty())
    }

    pub(crate) fn has_working_dir(&self, path: &Path) -> bool {
        self.lock_inner()
            .children
            .values()
            .any(|child| crate::worktrees::contains_working_dir(path, &child.cwd))
    }

    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HarnessInner {
                children: HashMap::new(),
                epochs: HashMap::new(),
                managed_exits: HashMap::new(),
                receipts: process_receipts::ProcessReceipts::default(),
                turn_bindings: turn_writes::Bindings::default(),
            }),
            sse: Mutex::new(HashMap::new()),
            runtime_binary_paths: Mutex::new(None),
            kill_all_gen: AtomicU64::new(0),
            output: NativeProviderOutputRegistry::new(),
        }
    }

    /// Actual app Exit only. No provider stop/kill or synthetic settlement.
    pub(crate) fn shutdown_provider_output(&self) {
        self.output.shutdown();
    }

    /// Private retained handles, not serialized public observations/proofs.
    #[allow(dead_code)] // The trusted output-applied checkpoint port is not installed.
    pub(crate) fn native_output_streams(&self, session_id: &str) -> Vec<Arc<NativeOutputStream>> {
        self.output.retained(session_id)
    }
    #[allow(dead_code)] // Private future checkpoint discovery; not a qualified verifier/IPC.
    pub(crate) fn native_output_target_streams(
        &self,
        logical_session_id: &str,
    ) -> Vec<Arc<NativeOutputStream>> {
        self.output.retained_for_target(logical_session_id)
    }

    /// Native-only preflight. The retained result must be consumed under the
    /// physical-owner group and actual FULL transaction; no public DTO is proof.
    pub(crate) fn prepare_native_output_inputs(
        &self,
        store: &crate::session_store::SessionStore,
        target: &str,
        recipient: &crate::native_window_lifecycle::NativeCheckpointWindow,
        claims: &[crate::native_provider_output::NativeInputClaim],
    ) -> Result<
        crate::native_provider_output::PreparedNativeInputGroup,
        crate::native_provider_output::InputComparisonError,
    > {
        self.output
            .prepare_input_group(store, target, recipient, claims)
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, HarnessInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get(&self, session_id: &str) -> Option<Arc<LiveChild>> {
        self.lock_inner().children.get(session_id).cloned()
    }

    /// Match the original construction before selecting its physical stdin.
    /// The short registry lock is never held across admission or pipe I/O.
    fn get_original(
        &self,
        session_id: &str,
        construction_id: Option<&str>,
    ) -> Result<Arc<LiveChild>, String> {
        let expected = require_process_construction(construction_id)?;
        let inner = self.lock_inner();
        let live = inner
            .children
            .get(session_id)
            .filter(|live| live.construction_id == expected)
            .ok_or("NATIVE_PROCESS_CONSTRUCTION_STALE")?;
        Ok(Arc::clone(live))
    }

    /// Stamp this spawn and drop any child already registered under the id.
    fn begin_spawn(&self, session_id: &str) -> (u64, u64, Option<Arc<LiveChild>>) {
        let mut inner = self.lock_inner();
        let kill_all = self.kill_all_gen.load(Ordering::SeqCst);
        let epoch = inner.epochs.entry(session_id.to_string()).or_insert(0);
        *epoch += 1;
        let epoch = *epoch;
        let prev = inner.children.remove(session_id);
        if let Some(previous) = &prev {
            previous.writers.close();
        }
        crate::session_tools_bridge::revoke_session(session_id);
        crate::session_tools_bridge::begin_session(session_id, (epoch, kill_all));
        (epoch, kill_all, prev)
    }

    #[cfg(all(test, unix))]
    fn spawn_stamp_current(&self, session_id: &str, epoch: u64, kill_all: u64) -> bool {
        let inner = self.lock_inner();
        self.kill_all_gen.load(Ordering::SeqCst) == kill_all
            && inner.epochs.get(session_id) == Some(&epoch)
    }

    /// Keep the child only if nothing cancelled this spawn while it was forking.
    fn install_spawn(
        &self,
        session_id: String,
        epoch: u64,
        kill_all: u64,
        live: Arc<LiveChild>,
    ) -> Option<Arc<LiveChild>> {
        let mut inner = self.lock_inner();
        // Retain even a rejected physical construction until its actual drain.
        if inner.receipts.bind(&session_id, &live).is_err() {
            return Some(live);
        }
        if self.kill_all_gen.load(Ordering::SeqCst) != kill_all {
            return Some(live);
        }
        if inner.epochs.get(&session_id) != Some(&epoch) {
            return Some(live);
        }
        let previous = inner.children.insert(session_id, live);
        if let Some(previous) = &previous {
            previous.writers.close();
        }
        drop(inner);
        if let Some(prev) = previous {
            if let Some(output) = &prev.output {
                output.invalidate(UnavailableReason::TerminalCancelled);
            }
            let _ = prev.request_stop();
        }
        None
    }

    /// Register the exit receipt in the same critical section as process creation.
    /// A retirement that cancelled this spawn must not acknowledge ownership while
    /// an untracked process can still be created by that old spawn stamp.
    #[cfg(test)]
    fn spawn_tracked(
        &self,
        session_id: &str,
        epoch: u64,
        kill_all: u64,
        command: &mut Command,
    ) -> Result<(OwnedChild, Arc<ManagedProviderExit>), String> {
        self.spawn_tracked_guarded(session_id, epoch, kill_all, command, None)
    }

    #[cfg(test)]
    fn spawn_tracked_guarded(
        &self,
        session_id: &str,
        epoch: u64,
        kill_all: u64,
        command: &mut Command,
        authority: Option<&mut crate::session_store::authority::NativeLease>,
    ) -> Result<(OwnedChild, Arc<ManagedProviderExit>), String> {
        self.spawn_tracked_for_target(session_id, session_id, epoch, kill_all, command, authority)
    }

    #[cfg(test)]
    fn spawn_tracked_for_target(
        &self,
        session_id: &str,
        logical_session_id: &str,
        epoch: u64,
        kill_all: u64,
        command: &mut Command,
        authority: Option<&mut crate::session_store::authority::NativeLease>,
    ) -> Result<(OwnedChild, Arc<ManagedProviderExit>), String> {
        let mut reservation = self.reserve_process(session_id)?;
        self.spawn_tracked_reserved(
            session_id,
            logical_session_id,
            epoch,
            kill_all,
            command,
            authority,
            &mut reservation,
        )
    }

    fn spawn_tracked_reserved(
        &self,
        session_id: &str,
        logical_session_id: &str,
        epoch: u64,
        kill_all: u64,
        command: &mut Command,
        mut authority: Option<&mut crate::session_store::authority::NativeLease>,
        reservation: &mut ProcessStart<'_>,
    ) -> Result<(OwnedChild, Arc<ManagedProviderExit>), String> {
        let mut inner = self.lock_inner();
        if self.kill_all_gen.load(Ordering::SeqCst) != kill_all
            || inner.epochs.get(session_id) != Some(&epoch)
        {
            return Err(SPAWN_CANCELLED.into());
        }
        if !std::ptr::eq(self, reservation.host)
            || reservation.attempted
            || !inner.receipts.reserved(session_id, &reservation.exit)
        {
            return Err("NATIVE_PROCESS_RECEIPT_RESERVATION_CHANGED".into());
        }
        if let Some(lease) = authority.as_deref_mut() {
            lease.begin_external()?;
        }
        reservation.attempted = true;
        let child = match OwnedChild::spawn(command) {
            Ok(child) => child,
            Err(error) => {
                reservation.attempted = false;
                if let Some(lease) = authority.as_deref_mut() {
                    lease.spawn_failed()?;
                }
                return Err(format!("Failed to start harness: {error}"));
            }
        };
        if let Some(lease) = authority {
            let _ = lease.spawned(child.id());
        }
        let exit = reservation.exit.clone();
        let receipts = inner
            .managed_exits
            .entry(logical_session_id.into())
            .or_default();
        receipts.retain(|receipt| !receipt.succeeded());
        receipts.push(Arc::clone(&exit));
        Ok((child, exit))
    }

    fn kill_session(&self, session_id: &str) -> Option<Arc<LiveChild>> {
        let mut inner = self.lock_inner();
        *inner.epochs.entry(session_id.to_string()).or_insert(0) += 1;
        crate::session_tools_bridge::revoke_session(session_id);
        let removed = inner.children.remove(session_id);
        if let Some(live) = &removed {
            live.writers.close();
        }
        drop(inner);
        if let Some(output) = removed.as_ref().and_then(|live| live.output.as_ref()) {
            output.cancelled();
        }
        removed
    }

    #[cfg(test)]
    fn kill_original_session(
        &self,
        session_id: &str,
        construction_id: Option<&str>,
    ) -> Result<Arc<LiveChild>, String> {
        self.select_original_for_stop(session_id, construction_id, None)
    }

    /// Targeted IPC cannot invalidate a newer spawn or stop its event stream.
    /// A known historical construction still owns its original physical drain.
    fn select_original_for_stop(
        &self,
        session_id: &str,
        construction_id: Option<&str>,
        issuer: Option<&Arc<crate::control::receipts::WindowIssuer>>,
    ) -> Result<Arc<LiveChild>, String> {
        let expected = require_process_construction(construction_id)?;
        let mut inner = self.lock_inner();
        let live = inner
            .receipts
            .original(session_id, expected)
            .or_else(|| {
                inner
                    .children
                    .get(session_id)
                    .filter(|live| live.construction_id == expected)
                    .cloned()
            })
            .ok_or("NATIVE_PROCESS_CONSTRUCTION_STALE")?;
        if let Some(issuer) = issuer {
            if !live
                .issuer
                .as_ref()
                .is_some_and(|original| Arc::ptr_eq(original, issuer))
            {
                log::info!("stopping original session process from another window");
            }
        }
        let current = inner
            .children
            .get(session_id)
            .is_some_and(|child| Arc::ptr_eq(child, &live));
        if !current {
            // Do not change current epochs, grants, SSE or B's output. Returning
            // this exact retained owner is not itself a successful retirement.
            live.writers.close();
            return Ok(live);
        }
        *inner.epochs.entry(session_id.to_owned()).or_insert(0) += 1;
        crate::session_tools_bridge::revoke_session(session_id);
        inner.children.remove(session_id);
        live.writers.close();
        // Detach while the matching child is still protected by `inner`.
        // Cancelling this retained Arc later cannot select a replacement SSE.
        let sse = self
            .sse
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(session_id);
        drop(inner);
        if let Some(output) = &live.output {
            output.cancelled();
        }
        if let Some(sse) = sse {
            sse.stop.store(true, Ordering::SeqCst);
            if let Some(output) = &sse.output {
                output.cancelled();
            }
        }
        Ok(live)
    }

    pub(crate) fn retire_managed_session(&self, session_id: &str) -> Result<(), String> {
        self.retire_managed_session_inner(session_id, false, None)
    }

    /// Starting a replacement provider captures no files, so an earlier provider
    /// whose exit already SETTLED with a failure (its process was waited and its
    /// pipes drained; only bookkeeping such as a busy lease store failed) must not
    /// block the session forever. A still-pending exit keeps refusing: that
    /// provider may still be writing.
    fn retire_managed_session_for_spawn(
        &self,
        session_id: &str,
        issuer: &Arc<crate::control::receipts::WindowIssuer>,
    ) -> Result<(), String> {
        self.retire_managed_session_inner(session_id, true, Some(issuer))
    }

    fn assert_spawn_owner(
        &self,
        target: &str,
        issuer: &Arc<crate::control::receipts::WindowIssuer>,
    ) -> Result<(), String> {
        let same_target = |route: &str, output: Option<&Arc<NativeOutputStream>>| {
            route == target
                || crate::native_provider_output::logical_session(route) == target
                || output.is_some_and(|output| output.target() == target)
        };
        let inner = self.lock_inner();
        if inner.children.iter().any(|(route, child)| {
            (same_target(route, child.output.as_ref())
                || child
                    .native_session_capability
                    .as_ref()
                    .is_some_and(|capability| capability.shell_id() == target))
                && !child
                    .issuer
                    .as_ref()
                    .is_some_and(|owner| Arc::ptr_eq(owner, issuer))
        }) {
            return Err("NATIVE_SESSION_OWNED_BY_ANOTHER_WINDOW".into());
        }
        drop(inner);
        let streams = self
            .sse
            .lock()
            .map_err(|_| "NATIVE_AUTHORITY_UNKNOWN_PROCESS")?;
        if streams.iter().any(|(route, stream)| {
            (same_target(route, stream.output.as_ref())
                || stream
                    .native_session_capability
                    .as_ref()
                    .is_some_and(|capability| capability.shell_id() == target))
                && !stream
                    .issuer
                    .as_ref()
                    .is_some_and(|owner| Arc::ptr_eq(owner, issuer))
        }) {
            return Err("NATIVE_SESSION_OWNED_BY_ANOTHER_WINDOW".into());
        }
        Ok(())
    }

    fn retire_managed_session_inner(
        &self,
        session_id: &str,
        tolerate_settled_failure: bool,
        issuer: Option<&Arc<crate::control::receipts::WindowIssuer>>,
    ) -> Result<(), String> {
        let begin = || -> Result<Vec<Arc<ManagedProviderExit>>, String> {
            if let Some(issuer) = issuer {
                self.assert_spawn_owner(session_id, issuer)?;
            }
            let mut routes = vec![session_id.to_owned()];
            routes.extend(
                self.lock_inner()
                    .children
                    .iter()
                    .filter(|(route, live)| {
                        crate::native_provider_output::logical_session(route) == session_id
                            || live
                                .output
                                .as_ref()
                                .is_some_and(|output| output.target() == session_id)
                            || live
                                .native_session_capability
                                .as_ref()
                                .is_some_and(|capability| capability.shell_id() == session_id)
                    })
                    .map(|(route, _)| route.clone()),
            );
            routes.extend(
                self.sse
                    .lock()
                    .map_err(|_| "NATIVE_AUTHORITY_UNKNOWN_PROCESS")?
                    .iter()
                    .filter(|(route, live)| {
                        crate::native_provider_output::logical_session(route) == session_id
                            || live
                                .output
                                .as_ref()
                                .is_some_and(|output| output.target() == session_id)
                            || live
                                .native_session_capability
                                .as_ref()
                                .is_some_and(|capability| capability.shell_id() == session_id)
                    })
                    .map(|(route, _)| route.clone()),
            );
            routes.sort();
            routes.dedup();
            let mut exact_exits = Vec::new();
            for route in routes {
                self.stop_sse(&route);
                if let Some(live) = self.kill_session(&route) {
                    let _ = live.request_stop();
                    if let Some(exit) = &live.exit {
                        exact_exits.push(exit.clone());
                    }
                }
            }
            let retained = self
                .lock_inner()
                .managed_exits
                .get(session_id)
                .cloned()
                .unwrap_or_default();
            for exit in retained {
                if !exact_exits
                    .iter()
                    .any(|existing| Arc::ptr_eq(existing, &exit))
                {
                    exact_exits.push(exit);
                }
            }
            Ok(exact_exits)
        };
        let exits = if let Some(issuer) = issuer {
            issuer.with_live(begin)?
        } else {
            begin()?
        };
        // One deadline for all retained exits, not 20 s for each. An exit that is not
        // confirmed by then still refuses: that provider may be writing.
        let deadline = Instant::now() + RETIRE_EXIT_DEADLINE;
        for exit in &exits {
            // Do not capture files until the retained provider exit succeeds.
            if let Err(error) = exit.wait(deadline.saturating_duration_since(Instant::now())) {
                if tolerate_settled_failure && exit.settled() {
                    log::warn!("earlier provider exit settled with failure; continuing: {error}");
                    continue;
                }
                return Err(format!(
                    "Provider may still be writing; cannot capture turn: {error}"
                ));
            }
        }
        let mut inner = self.lock_inner();
        if inner.children.iter().any(|(route, child)| {
            crate::native_provider_output::logical_session(route) == session_id
                || child
                    .output
                    .as_ref()
                    .is_some_and(|output| output.target() == session_id)
                || child
                    .native_session_capability
                    .as_ref()
                    .is_some_and(|capability| capability.shell_id() == session_id)
        }) {
            return Err("A different managed provider started during turn retirement".into());
        }
        if let Some(pending) = inner.managed_exits.get_mut(session_id) {
            pending.retain(|entry| !exits.iter().any(|exit| Arc::ptr_eq(entry, exit)));
            if !pending.is_empty() {
                return Err("A different managed provider is still settling".into());
            }
        }
        inner.managed_exits.remove(session_id);
        Ok(())
    }

    fn remove_if_child(
        &self,
        session_id: &str,
        expected: &Arc<LiveChild>,
    ) -> Option<Arc<LiveChild>> {
        let mut inner = self.lock_inner();
        if !inner
            .children
            .get(session_id)
            .is_some_and(|live| Arc::ptr_eq(live, expected))
        {
            return None;
        }
        crate::session_tools_bridge::revoke_session(session_id);
        let removed = inner.children.remove(session_id);
        let sse = self
            .sse
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(session_id);
        drop(inner);
        if let Some(sse) = sse {
            sse.stop.store(true, Ordering::SeqCst);
            if let Some(output) = &sse.output {
                output.cancelled();
            }
        }
        removed
    }

    fn kill_account(&self, provider: &str, account_id: &str) {
        let children: Vec<(String, Arc<LiveChild>)> = {
            let mut inner = self.lock_inner();
            let session_ids: Vec<String> = inner
                .children
                .iter()
                .filter_map(|(session_id, live)| {
                    let account = live.account.as_ref()?;
                    (account.provider == provider && account.id == account_id)
                        .then(|| session_id.clone())
                })
                .collect();
            session_ids
                .into_iter()
                .filter_map(|session_id| {
                    *inner.epochs.entry(session_id.clone()).or_insert(0) += 1;
                    crate::session_tools_bridge::revoke_session(&session_id);
                    inner
                        .children
                        .remove(&session_id)
                        .map(|child| (session_id, child))
                })
                .collect()
        };
        for (session_id, _) in &children {
            self.stop_sse(session_id);
        }
        for (_, child) in &children {
            if let Some(output) = &child.output {
                output.cancelled();
            }
        }
        for (_, child) in &children {
            let _ = child.request_stop();
        }
        for (_, child) in children {
            let _ = child.stop_and_drain();
        }
    }

    pub(crate) fn kill_all(&self) {
        let kids: Vec<Arc<LiveChild>> = {
            let mut inner = self.lock_inner();
            self.kill_all_gen.fetch_add(1, Ordering::SeqCst);
            crate::session_tools_bridge::revoke_all();
            inner.children.drain().map(|(_, child)| child).collect()
        };
        self.stop_all_sse();
        for live in &kids {
            if let Some(output) = &live.output {
                output.cancelled();
            }
        }
        for live in &kids {
            let _ = live.request_stop();
        }
        for live in kids {
            let _ = live.stop_and_drain();
        }
    }

    /// Retire only processes created by this physical page, never subscribers
    /// or children owned by another window with the same session route.
    fn retire_issuer(
        &self,
        issuer: &Arc<crate::control::receipts::WindowIssuer>,
    ) -> Vec<Arc<LiveChild>> {
        let mut inner = self.lock_inner();
        let ids: Vec<String> = inner
            .children
            .iter()
            .filter(|(_, child)| {
                child
                    .issuer
                    .as_ref()
                    .is_some_and(|owner| Arc::ptr_eq(owner, issuer))
            })
            .map(|(id, _)| id.clone())
            .collect();
        let mut children = Vec::with_capacity(ids.len());
        for id in ids {
            *inner.epochs.entry(id.clone()).or_insert(0) += 1;
            crate::session_tools_bridge::revoke_session(&id);
            if let Some(child) = inner.children.remove(&id) {
                child.writers.close();
                children.push(child);
            }
        }
        children
    }

    fn insert_sse(&self, session_id: String, live: Arc<LiveSse>) -> Option<Arc<LiveSse>> {
        self.sse
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session_id, live)
    }

    fn stop_sse(&self, session_id: &str) {
        let removed = self
            .sse
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(session_id);
        if let Some(live) = removed {
            live.stop.store(true, Ordering::SeqCst);
            if let Some(output) = &live.output {
                output.cancelled();
            }
        }
    }

    fn stop_all_sse(&self) {
        let streams: Vec<Arc<LiveSse>> = {
            let mut map = self.sse.lock().unwrap_or_else(|e| e.into_inner());
            map.drain().map(|(_, live)| live).collect()
        };
        for live in streams {
            live.stop.store(true, Ordering::SeqCst);
            if let Some(output) = &live.output {
                output.cancelled();
            }
        }
    }
}

pub(crate) fn page_retired(app: &AppHandle, issuer: &Arc<crate::control::receipts::WindowIssuer>) {
    let host = app.state::<HarnessHost>();
    let children = host.retire_issuer(issuer);
    let streams: Vec<Arc<LiveSse>> = {
        let mut streams = host.sse.lock().unwrap_or_else(|error| error.into_inner());
        let ids: Vec<String> = streams
            .iter()
            .filter(|(_, stream)| {
                stream
                    .issuer
                    .as_ref()
                    .is_some_and(|owner| Arc::ptr_eq(owner, issuer))
            })
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| streams.remove(&id))
            .collect()
    };
    for stream in streams {
        stream.stop.store(true, Ordering::SeqCst);
        if let Some(output) = &stream.output {
            output.cancelled();
        }
    }
    let _ = app.emit_to("main", "session-recovery-changed", ());
    if children.is_empty() {
        crate::sync_owner::page_retired(app, issuer);
        return;
    }
    let retired_app = app.clone();
    let retired_issuer = issuer.clone();
    std::thread::spawn(move || {
        for child in &children {
            if let Some(output) = &child.output {
                output.cancelled();
            }
            let _ = child.request_stop();
        }
        for child in children {
            let _ = child.stop_and_drain();
        }
        crate::sync_owner::page_retired(&retired_app, &retired_issuer);
    });
}

impl Drop for HarnessHost {
    fn drop(&mut self) {
        self.shutdown_provider_output();
        self.kill_all();
    }
}

/// Resolve the Cursor CLI (`cursor-agent`), never Grok's `agent` shim.
#[tauri::command]
pub async fn harness_resolve_cursor() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_cursor", move || {
        resolve_cursor_agent()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "Cursor CLI not found. Install it and run `agent login`, then retry.".into()
            })
    })
    .await
}

/// Resolve the Codex CLI (`codex`).
#[tauri::command]
pub async fn harness_resolve_codex() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_codex", move || {
        resolve_codex()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "Codex CLI not found. Install it from https://developers.openai.com/codex/cli and run `codex login`, then retry."
                    .into()
            })
    })
    .await
}

/// Resolve the OpenCode CLI (`opencode`).
#[tauri::command]
pub async fn harness_resolve_opencode() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_opencode", move || {
        resolve_opencode()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "OpenCode CLI not found. Install it from https://opencode.ai and run `opencode auth login`, then retry."
                    .into()
            })
    })
    .await
}

#[tauri::command]
pub async fn harness_resolve_configured(
    provider: String,
    binary_path: String,
) -> Result<ConfiguredBinary, String> {
    crate::harness::run_blocking("harness_resolve_configured", move || {
        resolve_harness_binary_override(&provider, &binary_path).map(|path| {
            let transport = (provider == "antigravity").then(|| antigravity_transport(&path));
            ConfiguredBinary {
                args: transport.map(antigravity_args),
                path: path.to_string_lossy().into_owned(),
                transport,
            }
        })
    })
    .await
}

fn initialize_runtime_binary_paths(
    runtime: &Mutex<Option<HashMap<String, String>>>,
    paths: HashMap<String, String>,
) -> HashMap<String, String> {
    let mut runtime = runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if runtime.is_none() {
        *runtime = Some(paths);
    }
    runtime.clone().unwrap_or_default()
}

#[tauri::command]
pub fn harness_runtime_binary_paths(
    host: State<'_, HarnessHost>,
    paths: HashMap<String, String>,
) -> HashMap<String, String> {
    initialize_runtime_binary_paths(&host.runtime_binary_paths, paths)
}

/// Resolve the Claude Code CLI (`claude`).
#[tauri::command]
pub async fn harness_resolve_claude() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_claude", move || {
        resolve_claude()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "Claude Code CLI not found. Install it from https://claude.com/product/claude-code and run `claude auth login`, then retry."
                    .into()
            })
    })
    .await
}

fn resolve_mcp_binary(provider: &str, binary_path: Option<&str>) -> Result<PathBuf, String> {
    if !matches!(provider, "claude" | "codex" | "cursor" | "opencode") {
        return Err("Unsupported MCP provider".into());
    }
    match binary_path {
        Some(path) => resolve_harness_binary_override(provider, path),
        None => resolve_harness_binary_default(provider)
            .ok_or_else(|| format!("{provider} CLI not found")),
    }
}

fn claude_mcp_command(
    args: Vec<String>,
    cwd: String,
    timeout: Duration,
    binary_path: Option<&str>,
) -> Result<String, String> {
    let binary = resolve_mcp_binary("claude", binary_path)?;
    mcp_command(binary, args, cwd, timeout)
}

fn mcp_command(
    binary: PathBuf,
    args: Vec<String>,
    cwd: String,
    timeout: Duration,
) -> Result<String, String> {
    let workdir = crate::session_folder::resolve_session_cwd(&cwd);
    if !workdir.is_dir() {
        return Err("Project directory does not exist".into());
    }
    let read =
        args == ["--version"] || args == ["mcp", "list"] || args == ["mcp", "list", "--json"];
    let output = if read {
        exec_output_read(&binary.to_string_lossy(), &args, Some(&cwd), timeout)?
    } else {
        exec_output(&binary.to_string_lossy(), &args, Some(&cwd), timeout)?
    };
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("{} {}", stderr.trim(), stdout).trim().to_string())
}

/// `claude mcp list` health-checks every server, including plugin and claude.ai
/// connectors, so it can take well over 30 seconds on a busy profile.
const CLAUDE_MCP_LIST_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMcpList {
    output: String,
    /// The CLI was stopped before it exited; `output` holds the lines it printed.
    timed_out: bool,
}

#[tauri::command]
pub async fn claude_mcp_list(
    host: State<'_, HarnessHost>,
    cwd: String,
) -> Result<ClaudeMcpList, String> {
    let binary_path = host.runtime_binary_path("claude");
    tauri::async_runtime::spawn_blocking(move || {
        if !expand_home(&cwd).is_dir() {
            return Err("Project directory does not exist".into());
        }
        let binary = resolve_mcp_binary("claude", binary_path.as_deref())?;
        let (result, timed_out) = exec_output_read_partial(
            &binary.to_string_lossy(),
            &["mcp".into(), "list".into()],
            Some(&cwd),
            CLAUDE_MCP_LIST_TIMEOUT,
        )?;
        let mut output = String::from_utf8_lossy(&result.stdout).trim().to_string();
        if timed_out {
            if !output.lines().any(|line| line.contains(": ")) {
                return Err(format!(
                    "Claude did not report MCP server status within {} seconds.",
                    CLAUDE_MCP_LIST_TIMEOUT.as_secs()
                ));
            }
        } else if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!("{} {}", stderr.trim(), output).trim().to_string());
        }
        for name in configured_ws_mcp_servers(&expand_home(&cwd)) {
            if !output
                .lines()
                .any(|line| line.starts_with(&format!("{name}:")))
            {
                output.push_str(&format!(
                    "\n{name}: WebSocket server (open Claude /mcp for status)"
                ));
            }
        }
        Ok(ClaudeMcpList { output, timed_out })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuthStatus {
    name: String,
    /// Codex's `auth_status`: `o_auth`, `bearer_token`, `not_logged_in` or `unsupported`.
    auth_status: String,
}

/// Codex reports per-server sign-in state; return only names and that state,
/// never transport config (its env and headers can hold secrets).
#[tauri::command]
pub async fn codex_mcp_list(
    host: State<'_, HarnessHost>,
    cwd: String,
) -> Result<Vec<McpAuthStatus>, String> {
    let binary_path = host.runtime_binary_path("codex");
    tauri::async_runtime::spawn_blocking(move || {
        if !expand_home(&cwd).is_dir() {
            return Err("Project directory does not exist".into());
        }
        let binary = resolve_mcp_binary("codex", binary_path.as_deref())?;
        let output = exec_output_read(
            &binary.to_string_lossy(),
            &["mcp".into(), "list".into(), "--json".into()],
            Some(&cwd),
            Duration::from_secs(30),
        )?;
        if !output.status.success() {
            return Err("Codex could not list MCP server status".into());
        }
        parse_codex_mcp_auth(&String::from_utf8_lossy(&output.stdout))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_codex_mcp_auth(stdout: &str) -> Result<Vec<McpAuthStatus>, String> {
    let servers: Vec<serde_json::Value> = serde_json::from_str(stdout.trim())
        .map_err(|_| "Codex returned unreadable MCP status".to_string())?;
    Ok(servers
        .iter()
        .filter_map(|server| {
            Some(McpAuthStatus {
                name: server.get("name")?.as_str()?.to_owned(),
                auth_status: server
                    .get("auth_status")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            })
        })
        .collect())
}

fn configured_ws_mcp_servers(cwd: &Path) -> Vec<String> {
    let mut names = Vec::new();
    let read = |path: &Path| -> Option<serde_json::Value> {
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
    };
    let collect = |servers: Option<&serde_json::Value>, names: &mut Vec<String>| {
        if let Some(servers) = servers.and_then(serde_json::Value::as_object) {
            for (name, config) in servers {
                if config.get("type").and_then(serde_json::Value::as_str) == Some("ws")
                    && valid_mcp_name(name)
                    && !names.contains(name)
                {
                    names.push(name.clone());
                }
            }
        }
    };
    if let Some(home) = dirs_home() {
        if let Some(settings) = read(&Path::new(&home).join(".claude.json")) {
            collect(settings.get("mcpServers"), &mut names);
            collect(
                settings
                    .get("projects")
                    .and_then(|projects| projects.get(cwd.to_string_lossy().as_ref()))
                    .and_then(|project| project.get("mcpServers")),
                &mut names,
            );
        }
    }
    for directory in cwd.ancestors() {
        if let Some(settings) = read(&directory.join(".mcp.json")) {
            collect(settings.get("mcpServers"), &mut names);
        }
        if directory.join(".git").exists() {
            break;
        }
    }
    names
}

#[tauri::command]
pub async fn claude_mcp_add(
    host: State<'_, HarnessHost>,
    cwd: String,
    name: String,
    config: String,
    scope: String,
) -> Result<(), String> {
    if !valid_mcp_name(&name) {
        return Err("Server name must use letters, numbers, hyphens, or underscores".into());
    }
    if !matches!(scope.as_str(), "local" | "project" | "user") {
        return Err("Invalid MCP scope".into());
    }
    let value: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Server configuration must be a JSON object".into());
    }
    let binary_path = host.runtime_binary_path("claude");
    tauri::async_runtime::spawn_blocking(move || {
        claude_mcp_command(
            vec![
                "mcp".into(),
                "add-json".into(),
                name,
                config,
                "--scope".into(),
                scope,
            ],
            cwd,
            Duration::from_secs(30),
            binary_path.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

pub(crate) fn add_mcp_via_cli(
    provider: &str,
    scope: &str,
    cwd: &str,
    name: &str,
    config: &serde_json::Value,
    binary_path: Option<&str>,
) -> Result<(), String> {
    let (binary, args) = mcp_add_args(provider, scope, name, config, binary_path)?;
    mcp_command(binary, args, cwd.to_owned(), Duration::from_secs(30))?;
    Ok(())
}

pub(crate) fn opencode_major_version(cwd: &str, binary_path: Option<&str>) -> Result<u32, String> {
    let binary = resolve_mcp_binary("opencode", binary_path)?;
    let version = mcp_command(
        binary,
        vec!["--version".into()],
        cwd.to_owned(),
        Duration::from_secs(10),
    )?;
    version
        .split_whitespace()
        .find_map(|part| {
            part.trim_start_matches('v')
                .split('.')
                .next()?
                .parse::<u32>()
                .ok()
        })
        .filter(|major| matches!(major, 1 | 2))
        .ok_or_else(|| format!("Unsupported OpenCode version: {version}"))
}

fn mcp_add_args(
    provider: &str,
    scope: &str,
    name: &str,
    config: &serde_json::Value,
    binary_path: Option<&str>,
) -> Result<(PathBuf, Vec<String>), String> {
    if provider == "claude" {
        if !matches!(scope, "local" | "project" | "user") {
            return Err("Invalid Claude MCP scope".into());
        }
        let binary = resolve_mcp_binary("claude", binary_path)?;
        let config = serde_json::to_string(config).map_err(|e| e.to_string())?;
        return Ok((
            binary,
            vec![
                "mcp".into(),
                "add-json".into(),
                name.into(),
                config,
                "--scope".into(),
                scope.into(),
            ],
        ));
    }
    if provider == "codex" && scope != "user" {
        return Err("Codex CLI adds user-scoped servers only".into());
    }
    let binary = match provider {
        "codex" => resolve_mcp_binary("codex", binary_path)?,
        _ => return Err("Unsupported MCP provider".into()),
    };
    let object = config
        .as_object()
        .ok_or("Server configuration must be an object")?;
    let remote = object.get("url").and_then(serde_json::Value::as_str);
    let allowed: &[&str] = if remote.is_some() {
        &["type", "url", "bearerTokenEnvVar"]
    } else {
        &["type", "command", "args", "env"]
    };
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!(
            "{provider} add cannot preserve '{key}'; edit its config file instead"
        ));
    }
    let kind = object.get("type").and_then(serde_json::Value::as_str);
    if remote.is_some() && !matches!(kind, None | Some("http") | Some("remote")) {
        return Err(format!("{provider} CLI supports HTTP URLs only"));
    }
    if remote.is_none() && !matches!(kind, None | Some("stdio") | Some("local")) {
        return Err("Local server type must be stdio".into());
    }
    let mut args = vec!["mcp".into(), "add".into(), name.into()];
    if let Some(url) = remote {
        let parsed = url::Url::parse(url).map_err(|_| "Invalid server URL")?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("MCP URL must use HTTP or HTTPS".into());
        }
        args.extend(["--url".into(), url.into()]);
        if let Some(var) = object
            .get("bearerTokenEnvVar")
            .and_then(serde_json::Value::as_str)
        {
            args.extend(["--bearer-token-env-var".into(), var.into()]);
        }
    } else {
        args.extend(mcp_key_values(config, "env", "--env")?);
        let command = object
            .get("command")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("Local server needs a command")?;
        let parameters = object
            .get("args")
            .map(|value| value.as_array().ok_or("args must be an array"))
            .transpose()?;
        args.push("--".into());
        args.push(command.into());
        for parameter in parameters.into_iter().flatten() {
            args.push(
                parameter
                    .as_str()
                    .ok_or("args must contain strings")?
                    .into(),
            );
        }
    }
    Ok((binary, args))
}

fn mcp_key_values(
    config: &serde_json::Value,
    field: &str,
    flag: &str,
) -> Result<Vec<String>, String> {
    let Some(value) = config.get(field) else {
        return Ok(Vec::new());
    };
    let values = value
        .as_object()
        .ok_or_else(|| format!("{field} must be an object"))?;
    let mut args = Vec::new();
    for (key, value) in values {
        let value = value
            .as_str()
            .ok_or_else(|| format!("{field} values must be strings"))?;
        args.extend([flag.to_owned(), format!("{key}={value}")]);
    }
    Ok(args)
}

#[tauri::command]
pub async fn claude_mcp_remove(
    host: State<'_, HarnessHost>,
    cwd: String,
    name: String,
    scope: String,
) -> Result<(), String> {
    if !valid_mcp_name(&name) {
        return Err("Invalid MCP server name".into());
    }
    if !matches!(scope.as_str(), "local" | "project" | "user") {
        return Err("Invalid MCP scope".into());
    }
    let binary_path = host.runtime_binary_path("claude");
    tauri::async_runtime::spawn_blocking(move || {
        claude_mcp_command(
            vec!["mcp".into(), "remove".into(), name, "--scope".into(), scope],
            cwd,
            Duration::from_secs(30),
            binary_path.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

#[tauri::command]
pub async fn mcp_provider_login(
    host: State<'_, HarnessHost>,
    cwd: String,
    provider: String,
    name: String,
) -> Result<(), String> {
    let valid_name = if provider == "opencode" {
        !name.trim().is_empty() && !name.chars().any(char::is_control)
    } else {
        valid_mcp_name(&name)
    };
    if !valid_name {
        return Err("Invalid MCP server name".into());
    }
    let binary_path = host.runtime_binary_path(&provider);
    tauri::async_runtime::spawn_blocking(move || {
        let args = match provider.as_str() {
            "claude" | "codex" | "cursor" => vec!["mcp", "login"],
            "opencode" => vec!["mcp", "auth"],
            _ => return Err("Unsupported MCP provider".into()),
        };
        let binary = resolve_mcp_binary(&provider, binary_path.as_deref())?;
        let args = args.into_iter().map(String::from).chain([name]).collect();
        #[cfg(windows)]
        if provider == "claude" {
            return mcp_auth::login(binary, args, cwd, Duration::from_secs(180));
        }
        mcp_command(binary, args, cwd, Duration::from_secs(180))
            // OAuth stdout/stderr can contain callback URLs, state and challenges.
            // Never propagate that credential-bearing transcript to Settings.
            .map_err(|_| {
                "MCP sign-in did not complete. Retry and finish authorization in your browser."
                    .to_string()
            })?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn valid_mcp_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Resolve the Pi coding agent CLI (`pi`).
#[tauri::command]
pub async fn harness_resolve_pi() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_pi", move || {
        resolve_pi()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "Pi CLI not found. Install it with `npm install -g @earendil-works/pi-coding-agent` and authenticate, then retry."
                    .into()
            })
    })
    .await
}

/// Resolve the omp (oh-my-pi) coding agent CLI.
#[tauri::command]
pub async fn harness_resolve_omp() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_omp", move || {
        resolve_omp()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "omp CLI not found. Install it with `curl -fsSL https://omp.sh/install | sh` and authenticate, then retry."
                    .into()
            })
    })
    .await
}

/// Resolve the Vercel fx coding agent CLI (`fx`), never the JSON viewer of the same name.
#[tauri::command]
pub async fn harness_resolve_fx() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_fx", move || {
        resolve_fx()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "fx CLI not found. Install it from https://fx.sh and run `fx login`, then retry."
                    .into()
            })
    })
    .await
}

/// Resolve xAI Grok Build (`grok`).
#[tauri::command]
pub async fn harness_resolve_grok() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_grok", move || {
        resolve_grok()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "Grok Build CLI not found. Install it with `curl -fsSL https://x.ai/cli/install.sh | bash` and run `grok login`, then retry.".into()
            })
    })
    .await
}

/// Resolve Nous Research Hermes Agent (`hermes`).
#[tauri::command]
pub async fn harness_resolve_hermes() -> Result<CursorBinary, String> {
    crate::harness::run_blocking("harness_resolve_hermes", move || {
        resolve_hermes()
            .map(|path| CursorBinary {
                path: path.to_string_lossy().into_owned(),
            })
            .ok_or_else(|| {
                "Hermes Agent CLI not found. Install it from https://hermes-agent.nousresearch.com, run `hermes model`, then retry."
                    .into()
            })
    })
    .await
}

/// Antigravity's ACP server is separate from the interactive agy CLI; on
/// Windows only the CLI exists and Bycoda drives its headless stream-json mode.
#[tauri::command]
pub async fn harness_resolve_antigravity() -> Result<AntigravityBinary, String> {
    crate::harness::run_blocking("harness_resolve_antigravity", move || {
        resolve_antigravity()
            .map(|path| {
                let transport = antigravity_transport(&path);
                AntigravityBinary {
                    path: path.to_string_lossy().into_owned(),
                    args: antigravity_args(transport),
                    transport,
                }
            })
            .ok_or_else(|| {
                if cfg!(windows) {
                    "Antigravity CLI (agy.exe) not found. Install Antigravity, then run `agy` once in a terminal to sign in.".into()
                } else {
                    "Antigravity CLI (agy) not found. Install from https://antigravity.google/docs/cli/install/, then run `agy` in Terminal to sign in.".into()
                }
            })
    })
    .await
}

/// A bounded tail of a provider-reported shell task output file.
#[derive(Serialize)]
pub struct HarnessTaskOutput {
    text: String,
    truncated: bool,
}

#[tauri::command(async)]
pub fn harness_read_task_output(
    path: String,
    task_id: String,
) -> Result<HarnessTaskOutput, String> {
    use std::io::{Read, Seek, SeekFrom};
    let valid_id = !task_id.is_empty()
        && task_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
    let expected = format!("{task_id}.output");
    let valid_path = |p: &std::path::Path| {
        p.is_absolute()
            && p.file_name().and_then(|s| s.to_str()) == Some(expected.as_str())
            && p.parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                == Some("tasks")
    };
    let path = std::path::Path::new(&path);
    if !valid_id || !valid_path(path) {
        return Err("Invalid task output path".into());
    }
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    if !valid_path(&resolved) {
        return Err("Invalid task output target".into());
    }
    let mut file = std::fs::File::open(resolved).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Not a task output file".into());
    }
    let size = metadata.len();
    let limit = 32 * 1024;
    file.seek(SeekFrom::Start(size.saturating_sub(limit)))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(HarnessTaskOutput {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated: size > limit,
    })
}

#[cfg(test)]
mod task_output_tests {
    use super::harness_read_task_output;

    #[test]
    fn harness_task_output_is_bounded_and_task_scoped() {
        let root =
            std::env::temp_dir().join(format!("bycoda-output-test-{}", uuid::Uuid::new_v4()));
        let tasks = root.join("tasks");
        std::fs::create_dir_all(&tasks).unwrap();
        let path = tasks.join("b1.output");
        std::fs::write(&path, format!("{}\nlast line\n", "x".repeat(40000))).unwrap();
        let value =
            harness_read_task_output(path.to_string_lossy().into_owned(), "b1".into()).unwrap();
        assert!(value.truncated);
        assert_eq!(value.text.len(), 32768);
        assert!(value.text.ends_with("last line\n"));
        assert!(
            harness_read_task_output(path.to_string_lossy().into_owned(), "b2".into()).is_err()
        );
        assert!(harness_read_task_output(
            root.join("b1.output").to_string_lossy().into_owned(),
            "b1".into()
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// Prepare an isolated workspace for a tool-free text agent.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessTextWorkspace {
    cwd: String,
    log_path: String,
}

#[tauri::command]
pub fn harness_prepare_text_workspace(content: String) -> Result<HarnessTextWorkspace, String> {
    if content.len() > 20_000 {
        return Err("Invalid text agent profile".into());
    }
    // Directory age does not establish whether an agent still owns its cwd.
    let cwd =
        std::env::temp_dir().join(format!("bycoda-antigravity-text-{}", uuid::Uuid::new_v4()));
    let profile = cwd.join(".agents").join("agents");
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    std::fs::write(profile.join("bycoda-text.md"), content).map_err(|e| e.to_string())?;
    Ok(HarnessTextWorkspace {
        log_path: cwd.join("agent.log").to_string_lossy().into_owned(),
        cwd: cwd.to_string_lossy().into_owned(),
    })
}

/// Bind an ephemeral loopback port for `opencode serve`.
#[tauri::command]
pub fn harness_free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|e| format!("Failed to reserve a local port: {e}"))
}

fn exact_workspace_activity_enabled(app: &AppHandle, cwd: &Path) -> bool {
    // Plain checkouts/folders never needed the execution Host for process
    // admission. Only persisted managed directories need this policy lookup.
    app.try_state::<crate::session_store::SessionStore>()
        .and_then(|store| store.managed_workspace_paths().ok())
        .is_some_and(|paths| {
            paths
                .iter()
                .any(|path| crate::worktrees::contains_working_dir(Path::new(path), cwd))
        })
        && crate::session_store::rewind::exact_git_rewind_enabled(app)
}

/// Off the main thread: fork/exec, and `apply_gui_env` can wait on the first
/// login-shell read. Callers await this before writing to the child. Kill can
/// still race the fork, so a cancelled spawn must not reinsert the child.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn harness_spawn(
    app: AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    account: Option<HarnessAccount>,
    binary_provider: Option<String>,
    binary_path: Option<String>,
    generic_acp_id: Option<String>,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
    logical_session_id: Option<String>,
    control_turn: Option<crate::control::ControlTurnReceipt>,
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_process_purpose: Option<crate::session_store::canonical_store::NativeProcessPurpose>,
    native_management_token: Option<String>,
    native_management_route_id: Option<String>,
    native_management_purpose: Option<String>,
    launch_env: Option<std::collections::HashMap<String, String>>,
) -> Result<HarnessProcessReceipt, String> {
    let issuer = crate::control::receipts::capture(&window)?;
    let mut page_start = PageStart::new(&issuer)?;
    run_blocking("harness_spawn", move || {
        let host = app.state::<HarnessHost>();
        let result = harness_spawn_blocking(
            app.clone(),
            window,
            issuer,
            &page_start,
            host,
            session_id,
            command,
            args,
            cwd,
            account,
            binary_provider,
            binary_path,
            generic_acp_id,
            authority_environment_id,
            authority_generation,
            logical_session_id,
            control_turn,
            native_session_capability,
            native_process_purpose,
            native_management_token,
            native_management_route_id,
            native_management_purpose,
            launch_env,
        );
        page_start.complete();
        result
    })
    .await
}

#[allow(clippy::too_many_arguments)]
fn harness_spawn_blocking(
    app: AppHandle,
    window: tauri::WebviewWindow,
    issuer: Arc<crate::control::receipts::WindowIssuer>,
    page_start: &PageStart,
    host: State<'_, HarnessHost>,
    session_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    account: Option<HarnessAccount>,
    binary_provider: Option<String>,
    binary_path: Option<String>,
    generic_acp_id: Option<String>,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
    logical_session_id: Option<String>,
    control_turn: Option<crate::control::ControlTurnReceipt>,
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_process_purpose: Option<crate::session_store::canonical_store::NativeProcessPurpose>,
    native_management_token: Option<String>,
    native_management_route_id: Option<String>,
    native_management_purpose: Option<String>,
    launch_env: Option<std::collections::HashMap<String, String>>,
) -> Result<HarnessProcessReceipt, String> {
    let generic = generic_acp_id
        .as_deref()
        .map(|id| crate::generic_acp::launch_config(&app, id))
        .transpose()?;
    let (command, args) = if let Some(config) = &generic {
        (config.command.clone(), config.args.clone())
    } else {
        (command, args)
    };
    let workdir = crate::session_folder::resolve_session_cwd(&cwd);
    if !workdir.is_dir() {
        return Err(format!(
            "Working directory does not exist: {}",
            workdir.display()
        ));
    }
    if generic.is_none()
        && !is_resolved_harness_binary(&command, binary_provider.as_deref(), binary_path.as_deref())
    {
        return Err("harness_spawn: not a resolved harness CLI".to_string());
    }
    let management_input_policy = management_authority::spawn_input_policy(
        &window.as_ref().window(),
        native_management_token.as_deref(),
        native_management_route_id.as_deref(),
        native_management_purpose.as_deref(),
        &session_id,
        &command,
        &args,
        &cwd,
        account.as_ref(),
        binary_provider.as_deref(),
        binary_path.as_deref(),
    )?;
    if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
        && native_session_capability.is_none()
        && management_input_policy.is_none()
    {
        return Err("NATIVE_SESSION_CAPABILITY_REQUIRED".into());
    }

    let (source, explicit) = OutputSource::capture_or_unbound(
        &app,
        &window,
        &session_id,
        logical_session_id.as_deref(),
    )?;
    let source_target = source.target().to_owned();
    let authority_target = native_session_capability.as_ref().map_or_else(
        || source_target.clone(),
        |capability| capability.shell_id().to_owned(),
    );
    if authority_target != source_target && control_turn.is_none() {
        return Err("NATIVE_DERIVED_SESSION_CONTROL_REQUIRED".into());
    }
    // Serialize replacement across all routes of one logical conversation.
    let spawn_gate = session_spawn_gate(&authority_target);
    // Back-to-back starts (resend after a failed start, model switch, warm
    // respawn) queue behind the running start instead of being refused. The
    // wait is bounded a little above the previous start's own retire deadline.
    let _spawn_guard = {
        let deadline = Instant::now() + SPAWN_GATE_WAIT;
        loop {
            match spawn_gate.try_lock() {
                Ok(guard) => break guard,
                Err(std::sync::TryLockError::Poisoned(poisoned)) => break poisoned.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => {
                    if Instant::now() >= deadline {
                        return Err("Another provider is still starting for this session; try again shortly".into());
                    }
                    thread::sleep(Duration::from_millis(25));
                }
            }
        }
    };
    // Optional until every management and conversation route carries an
    // explicit purpose/capability. Existing callers remain unchanged.
    let _session_admission = native_session_capability
        .as_ref()
        .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
        .map(|capability| {
            crate::session_store::canonical_store::admit_session_effect(
                &app,
                &window.as_ref().window(),
                &authority_target,
                capability,
            )
        })
        .transpose()?;
    let _purpose_admission = native_process_purpose
        .as_ref()
        .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
        .map(|purpose| {
            crate::session_store::canonical_store::admit_process_purpose(
                &window.as_ref().window(),
                purpose,
            )
        })
        .transpose()?;
    let mut window_claim = issuer.with_live(|| {
        crate::session_window_ownership::reserve_spawn(&authority_target, &issuer, window.label())
    })?;
    let control_turn = crate::control::capture_child_turn(
        &app,
        &issuer,
        window.label(),
        &authority_target,
        &workdir,
        control_turn,
    )?;
    // Claim bounded original ownership before begin_spawn can retire A. A
    // capacity refusal therefore leaves the currently executing child intact.
    host.retire_managed_session_for_spawn(&source_target, &issuer)?;
    let mut process_start = host.reserve_process(&session_id)?;
    let gate = source.control_gate(&app)?;
    let scope = match (authority_environment_id, authority_generation) {
        (Some(environment_id), Some(generation)) => {
            Some(crate::session_store::authority::NativeScope {
                environment_id,
                generation,
            })
        }
        (None, None) => None,
        _ => return Err("NATIVE_AUTHORITY_STALE_GENERATION".into()),
    };
    let mut authority_lease = gate.reserve(&authority_target, "provider", scope.as_ref())?;
    let mut workspace_activity = if exact_workspace_activity_enabled(&app, &workdir) {
        crate::native_workspace::Activity::start(
            &app,
            &workdir,
            "provider",
            Some(&authority_target),
        )?
    } else {
        None
    };
    let _reservation = crate::worktree_lifecycle::reserve_spawn(&workdir)?;
    let (epoch, kill_all, prev) = issuer.with_live(|| Ok(host.begin_spawn(&session_id)))?;
    let mut tool_spawn =
        crate::session_tools_bridge::SpawnGuard::new(&session_id, (epoch, kill_all));
    if let Some(prev) = prev {
        if let Some(output) = &prev.output {
            output.cancelled();
        }
        let _ = prev.request_stop();
    }

    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .current_dir(&workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_child(&mut cmd, &command);
    if let Some(config) = generic {
        cmd.envs(config.env);
    }
    apply_launch_env(&mut cmd, launch_env.as_ref());
    apply_provider_account(&app, &mut cmd, account.as_ref())?;

    // Legacy/default-profile children still need an account owner for removal.
    let account = account.or_else(|| {
        binary_provider
            .as_deref()
            .filter(|provider| matches!(*provider, "claude" | "codex"))
            .map(|provider| HarnessAccount {
                provider: provider.into(),
                id: DEFAULT_PROVIDER_ACCOUNT_ID.into(),
            })
    });

    let mut scratch =
        crate::control::configure_child(&app, &session_id, &mut cmd, control_turn.as_ref());
    tool_grants::configure_optional_tool_grants(
        &app,
        &session_id,
        &mut cmd,
        (epoch, kill_all),
        tool_grants::sessionless(
            management_input_policy.is_some(),
            &authority_target,
            &source_target,
        ),
    );

    // Hold this child's redaction values through its final output drain, even
    // after a replacement has revoked and removed its native grant cache.
    let tool_credentials = crate::session_tools_bridge::redaction_tokens(&cmd);

    source.check_target_before_start(explicit)?;
    let spawn = || {
        host.spawn_tracked_reserved(
            &session_id,
            &authority_target,
            epoch,
            kill_all,
            &mut cmd,
            Some(&mut authority_lease),
            &mut process_start,
        )
    };
    let (mut child, managed_exit) = if control_turn.is_some() {
        crate::control::with_child_turn(&app, control_turn.as_ref(), spawn)
    } else {
        issuer.with_live(spawn)
    }
    .inspect_err(|_| {
        crate::session_tools_bridge::revoke_spawn(&session_id, (epoch, kill_all));
    })?;
    // Registration happens before the pending start is settled, including the
    // interval before the physical child is installed in the live map.
    if let Some(scratch) = scratch.as_mut() {
        scratch.started();
    }
    let _ = page_start.attach(managed_exit.clone());
    let pid = child.id();
    if let Some(activity) = workspace_activity.as_mut() {
        activity.started();
    }

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open harness stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open harness stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open harness stderr".to_string())?;

    // The spawning window consumes the output; its JS state owns the turn.
    let owners = Arc::new(Owners::for_source(&window, &source));
    let (current, notice) = output_callbacks(&app, &owners);
    let (output, child) = host.output.begin_process(source, child, current, notice);
    let live = Arc::new(LiveChild {
        cwd: workdir.clone(),
        stdin: Mutex::new(stdin),
        pid,
        construction_id: output.epoch().to_owned(),
        issuer: Some(issuer.clone()),
        _control_turn: control_turn.clone(),
        native_session_capability: native_session_capability.clone(),
        native_process_purpose: native_process_purpose.clone(),
        management_input_policy,
        management_route_id: management_input_policy.and(native_management_route_id.clone()),
        utility_executable: Some(command.clone()),
        utility_endpoint: if binary_provider.as_deref() == Some("opencode")
            && args.len() == 3
            && args[0] == "serve"
            && args[1] == "--hostname=127.0.0.1"
        {
            args[2]
                .strip_prefix("--port=")
                .map(|port| format!("http://127.0.0.1:{port}"))
        } else {
            None
        },
        account,
        owners: Arc::clone(&owners),
        output: Some(output.clone()),
        process: Some(child.clone()),
        exit: Some(managed_exit.clone()),
        writers: WriteGate::new(),
        order: WriteOrder::new(),
    });
    let receipt = live.receipt(&session_id);
    let binding_rejected = control_turn
        .as_ref()
        .is_some_and(|turn| turn.bind_output(output.clone()).is_err());
    let rejected = if binding_rejected {
        // Still retain/close this actual child; no caller receives its receipt.
        let _ = host.lock_inner().receipts.bind(&session_id, &live);
        Some(live.clone())
    } else {
        match issuer
            .with_live(|| Ok(host.install_spawn(session_id.clone(), epoch, kill_all, live.clone())))
        {
            Ok(rejected) => rejected,
            Err(_) => Some(live.clone()),
        }
    };
    if let Some(rejected) = rejected {
        crate::session_tools_bridge::revoke_spawn(&session_id, (epoch, kill_all));
        // A kill, or a newer spawn, won the race while this one was forking.
        // Returning `Ok` here would hand the caller a dead pid to store as the
        // session's live child, and this child's stdout would be parsed as the
        // stream that replaced it. Reap it without emitting anything.
        let _ = rejected.request_stop();
        output.cancelled();
        let rejected_output = output.clone();
        thread::spawn(move || {
            let exited = child.wait(&rejected_output, true);
            let waited = exited.is_ok();
            let retirement = Ok(());
            let result = exited
                .map_err(|e| e.to_string())
                .and(retirement)
                .and_then(|_| workspace_activity.map_or(Ok(()), |activity| activity.settled()));
            let finished = if waited {
                finish_spawn_authority(authority_lease)
            } else {
                Err("Provider wait failed; admission retained".into())
            };
            let settlement = result.and(finished);
            if settlement.is_ok() && child.retirement().require_verified().is_ok() {
                if let Some(scratch) = scratch.as_mut() {
                    scratch.settled();
                }
            }
            managed_exit.finish(settlement);
        });
        return Err(SPAWN_CANCELLED.to_string());
    }
    let window_lifetime = window_claim
        .commit()
        .map_err(|error| log::warn!("ownership tracking unavailable: {error}"))
        .ok();
    tool_spawn.disarm();

    // Each reader drops its `done` sender only after its last batch is emitted,
    // so the wait thread can order the exit event after all output.
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let stdout_app = app.clone();
    let stdout_id = session_id.clone();
    let stdout_construction_id = receipt.construction_id.clone();
    let stdout_done = done_tx.clone();
    let stdout_owners = Arc::clone(&owners);
    let stdout_credentials = tool_credentials.clone();
    let stdout_output = output.clone();
    let stdout_reader = output.reader(0);
    let stdout_thread = thread::spawn(move || {
        let _done = stdout_done;
        read_provider_lines(stdout, stdout_reader, move |lines| {
            let lines = crate::session_tools_bridge::redact_lines(&stdout_credentials, lines);
            emit_output_batch(
                &stdout_app,
                &stdout_owners,
                &stdout_output,
                STDOUT_EVENT,
                OutputChannel::Stdout,
                &lines,
                |native_output| HarnessLines {
                    session_id: stdout_id.clone(),
                    construction_id: stdout_construction_id.clone(),
                    lines: lines.clone(),
                    native_output,
                },
            );
        });
    });

    let stderr_app = app.clone();
    let stderr_id = session_id.clone();
    let stderr_construction_id = receipt.construction_id.clone();
    let stderr_owners = Arc::clone(&owners);
    let stderr_output = output.clone();
    let stderr_reader = output.reader(1);
    let stderr_thread = thread::spawn(move || {
        let _done = done_tx;
        read_provider_lines(stderr, stderr_reader, move |lines| {
            let lines = crate::session_tools_bridge::redact_lines(&tool_credentials, lines);
            emit_output_batch(
                &stderr_app,
                &stderr_owners,
                &stderr_output,
                STDERR_EVENT,
                OutputChannel::Stderr,
                &lines,
                |native_output| HarnessLines {
                    session_id: stderr_id.clone(),
                    construction_id: stderr_construction_id.clone(),
                    lines: lines.clone(),
                    native_output,
                },
            );
        });
    });

    let wait_app = app.clone();
    let wait_id = session_id;
    let wait_pid = pid;
    let wait_live = live;
    let wait_construction_id = receipt.construction_id.clone();
    thread::spawn(move || {
        let exit = child.wait(&output, false);
        let code = exit.as_ref().ok().and_then(|status| status.code());
        let waited = exit.is_ok();
        let retirement = Ok(());
        let settlement = exit.map_err(|e| e.to_string()).and(retirement);
        if let Some(host) = wait_app.try_state::<HarnessHost>() {
            host.remove_if_child(&wait_id, &wait_live);
        }
        // Join the actual readers. Original process control retains inherited
        // pipe work and starts original cleanup after the drain grace.
        let readers_closed = stdout_thread.join().is_ok() & stderr_thread.join().is_ok();
        drop(done_rx);
        let writers = wait_live.writers.drain();
        if let Err(error) = &writers {
            log::warn!("provider writer settled with failure: {error}");
        }
        let settlement = settlement
            .and_then(|_| workspace_activity.map_or(Ok(()), |activity| activity.settled()));
        let finished = if readers_closed && waited {
            finish_spawn_authority(authority_lease)
        } else {
            Err("NATIVE_AUTHORITY_UNKNOWN_PROVIDER_OUTPUT: retained process admission".into())
        };
        let settlement = settlement.and(finished);
        let terminal_sent = route_output_state(
            &wait_app,
            &owners,
            output.observation(),
            EXIT_EVENT,
            |native_output_state| HarnessExit {
                session_id: wait_id.clone(),
                construction_id: wait_construction_id.clone(),
                code,
                pid: wait_pid,
                native_output_state: Some(native_output_state),
            },
        );
        output.terminal_delivery(terminal_sent);
        // Final native callback belongs to this same original owner too.
        let confirmed = settlement.is_ok();
        if confirmed && writers.is_ok() && child.retirement().require_verified().is_ok() {
            if let Some(scratch) = scratch.as_mut() {
                scratch.settled();
            }
        }
        managed_exit.finish(settlement);
        if confirmed {
            if let Some(lifetime) = window_lifetime {
                lifetime.finish();
            }
        }
    });

    Ok(receipt)
}

pub(crate) fn provider_account_dir(
    app: &AppHandle,
    provider: &str,
    account_id: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(account_id) = account_id.filter(|id| *id != DEFAULT_PROVIDER_ACCOUNT_ID) else {
        return Ok(None);
    };
    let dir = provider_account_path(app, provider, account_id)?;
    if crate::provider_terminal_profiles::is_terminal_id(account_id) {
        return Ok(Some(dir));
    }
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Could not create the {provider} account directory {}: {error}",
            dir.display()
        )
    })?;
    Ok(Some(dir))
}

pub(crate) fn provider_account_path(
    app: &AppHandle,
    provider: &str,
    account_id: &str,
) -> Result<PathBuf, String> {
    if provider != "claude" && provider != "codex" {
        return Err("Provider account profiles are not supported for this provider".into());
    }
    if account_id == DEFAULT_PROVIDER_ACCOUNT_ID {
        return Err("The default provider account cannot be removed".into());
    }
    if account_id.is_empty()
        || account_id.len() > 80
        || !account_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid provider account id".into());
    }
    if let Some(path) = crate::provider_terminal_profiles::resolve(app, provider, account_id)? {
        return Ok(path);
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("provider-accounts")
        .join(provider)
        .join(account_id))
}

#[tauri::command]
pub async fn provider_account_remove(
    app: AppHandle,
    provider: String,
    account_id: String,
    credentials_only: Option<bool>,
) -> Result<(), String> {
    run_blocking("provider_account_remove", move || {
        let host = app.state::<HarnessHost>();
        provider_account_remove_blocking(app.clone(), host, provider, account_id, credentials_only)
    })
    .await
}

fn provider_account_remove_blocking(
    app: AppHandle,
    host: State<'_, HarnessHost>,
    provider: String,
    account_id: String,
    credentials_only: Option<bool>,
) -> Result<(), String> {
    if crate::provider_terminal_profiles::is_terminal_id(&account_id) {
        if credentials_only == Some(true) {
            return Err("Sign out of linked terminal profiles from the terminal".into());
        }
        crate::provider_terminal_profiles::disconnect(&app, &provider, &account_id)?;
        host.kill_account(&provider, &account_id);
        return Ok(());
    }
    if account_id == DEFAULT_PROVIDER_ACCOUNT_ID || credentials_only == Some(true) {
        if !matches!(provider.as_str(), "claude" | "codex") {
            return Err("Unsupported provider account".into());
        }
        let binary = resolve_mcp_binary(&provider, host.runtime_binary_path(&provider).as_deref())?;
        host.kill_account(&provider, &account_id);
        let args: Vec<String> = if provider == "claude" {
            vec!["auth".into(), "logout".into()]
        } else {
            vec!["logout".into()]
        };
        // Let the CLI clear its own credential store, including OS keychains.
        // Never delete a shared CLI home: it also contains settings and history.
        let command = binary.to_string_lossy();
        let mut cmd = Command::new(command.as_ref());
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        prepare_child(&mut cmd, &command);
        apply_provider_account(
            &app,
            &mut cmd,
            Some(&HarnessAccount {
                provider: provider.clone(),
                id: account_id.clone(),
            }),
        )?;
        if let Some(home) = crate::dirs_home() {
            cmd.current_dir(home);
        }
        let output = exec_command_output(cmd, &command, Duration::from_secs(30))?;
        return if output.status.success() {
            Ok(())
        } else {
            Err(format!("Could not sign out of the {provider} CLI profile"))
        };
    }
    let dir = provider_account_path(&app, &provider, &account_id)?;
    host.kill_account(&provider, &account_id);

    #[cfg(target_os = "macos")]
    if provider == "claude" {
        crate::rate_limits::delete_claude_keychain_credentials(&dir)?;
    }

    let metadata = match std::fs::symlink_metadata(&dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Could not inspect the {provider} account directory {}: {error}",
                dir.display()
            ));
        }
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(&dir)
    } else {
        std::fs::remove_dir_all(&dir)
    }
    .map_err(|error| {
        format!(
            "Could not remove the {provider} account directory {}: {error}",
            dir.display()
        )
    })
}

/// Only the provider's own status command can establish a sign-in. Never return
/// raw stdout/stderr: some CLI versions print API-key details there.
#[tauri::command]
pub async fn harness_auth_status(
    app: AppHandle,
    host: State<'_, HarnessHost>,
    provider: String,
    account_id: Option<String>,
) -> Result<String, String> {
    let args: &[&str] = match provider.as_str() {
        "claude" => &["auth", "status", "--json"],
        "codex" => &["login", "status"],
        _ => return Ok("unknown".into()),
    };
    let configured = host.runtime_binary_path(&provider);
    tauri::async_runtime::spawn_blocking(move || {
        let binary = resolve_mcp_binary(&provider, configured.as_deref())?;
        let command = binary.to_string_lossy();
        let mut cmd = Command::new(command.as_ref());
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        prepare_child(&mut cmd, &command);
        apply_provider_account(
            &app,
            &mut cmd,
            Some(&HarnessAccount {
                provider: provider.clone(),
                id: account_id.unwrap_or_else(|| DEFAULT_PROVIDER_ACCOUNT_ID.into()),
            }),
        )?;
        if let Some(home) = dirs_home() {
            cmd.current_dir(home);
        }
        let output = exec_command_output(cmd, &command, Duration::from_secs(10))?;
        Ok(parse_auth_status(
            &provider,
            output.status.success(),
            &String::from_utf8_lossy(&output.stdout),
            &String::from_utf8_lossy(&output.stderr),
        )
        .into())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn parse_auth_status(provider: &str, success: bool, stdout: &str, stderr: &str) -> &'static str {
    if provider == "claude" {
        let logged_in = serde_json::from_str::<serde_json::Value>(stdout)
            .ok()
            .and_then(|value| value.get("loggedIn").and_then(|value| value.as_bool()));
        return match logged_in {
            Some(true) if success => "signedIn",
            Some(false) => "signedOut",
            _ => "unknown",
        };
    }
    if provider == "codex" {
        for line in stdout.lines().chain(stderr.lines()).map(str::trim) {
            if line.eq_ignore_ascii_case("Not logged in") {
                return "signedOut";
            }
            if success && line.starts_with("Logged in using ") {
                return "signedIn";
            }
        }
    }
    "unknown"
}

#[cfg(test)]
mod auth_status_tests {
    use super::parse_auth_status;

    #[test]
    fn auth_status_never_assumes_errors_or_cached_identity_are_sign_outs() {
        assert_eq!(
            parse_auth_status("claude", true, r#"{"loggedIn":true}"#, ""),
            "signedIn"
        );
        assert_eq!(
            parse_auth_status("claude", false, r#"{"loggedIn":false}"#, ""),
            "signedOut"
        );
        assert_eq!(
            parse_auth_status("claude", true, r#"{"email":"cached@example.test"}"#, ""),
            "unknown"
        );
        assert_eq!(
            parse_auth_status("claude", false, r#"{"loggedIn":true}"#, ""),
            "unknown"
        );
        assert_eq!(
            parse_auth_status("codex", true, "", "Logged in using ChatGPT\n"),
            "signedIn"
        );
        assert_eq!(
            parse_auth_status(
                "codex",
                true,
                "",
                "Logged in using an API key - synthetic-secret"
            ),
            "signedIn"
        );
        assert_eq!(
            parse_auth_status("codex", false, "", "Not logged in\n"),
            "signedOut"
        );
        assert_eq!(
            parse_auth_status("codex", false, "", "Network unavailable"),
            "unknown"
        );
        assert_eq!(
            parse_auth_status("pi", true, "Logged in using ChatGPT", ""),
            "unknown"
        );
    }
}

/// Custom subagents are defined in the user's own `~/.claude/agents` or
/// `~/.codex/agents`. An added account runs its CLI against its own profile,
/// which would hide every one of them ("Agent type ... not found"), so the
/// profile gets a link to the shared folder. A real `agents` folder the
/// profile already has is left alone, and credentials are never shared.
fn link_shared_agents(shared_dir: &Path, account_dir: &Path) {
    let source = shared_dir.join("agents");
    let link = account_dir.join("agents");
    if !source.is_dir()
        || std::fs::symlink_metadata(&link).is_ok()
        || std::fs::canonicalize(shared_dir).ok() == std::fs::canonicalize(account_dir).ok()
    {
        return;
    }
    if let Err(error) = link_dir(&source, &link) {
        log::warn!(
            "could not share {} with {}: {error}",
            source.display(),
            link.display()
        );
    }
}

#[cfg(unix)]
fn link_dir(source: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(windows)]
mod junction;

/// Directory symlinks need Developer Mode on Windows; a junction does not.
#[cfg(windows)]
fn link_dir(source: &Path, link: &Path) -> std::io::Result<()> {
    if std::os::windows::fs::symlink_dir(source, link).is_ok() {
        return Ok(());
    }
    junction::create(source, link)
}

#[cfg(test)]
mod shared_agents_tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bycoda-agents-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn links_the_shared_agents_folder_into_an_account_profile() {
        let shared = temp("shared");
        let account = temp("account");
        std::fs::create_dir_all(shared.join("agents")).unwrap();
        std::fs::write(
            shared.join("agents").join("worker.md"),
            "---\nname: worker\n---\n",
        )
        .unwrap();

        link_shared_agents(&shared, &account);
        link_shared_agents(&shared, &account);

        let seen = std::fs::read_to_string(account.join("agents").join("worker.md")).unwrap();
        assert!(seen.contains("name: worker"));
        // Removing the profile must drop the link, not the user's agents.
        std::fs::remove_dir_all(&account).unwrap();
        assert!(shared.join("agents").join("worker.md").is_file());
        let _ = std::fs::remove_dir_all(&shared);
    }

    #[test]
    fn keeps_a_profile_own_agents_folder_and_skips_missing_sources() {
        let shared = temp("shared-own");
        let account = temp("account-own");
        link_shared_agents(&shared, &account);
        assert!(std::fs::symlink_metadata(account.join("agents")).is_err());

        std::fs::create_dir_all(shared.join("agents")).unwrap();
        std::fs::create_dir_all(account.join("agents")).unwrap();
        link_shared_agents(&shared, &account);
        assert!(!std::fs::symlink_metadata(account.join("agents"))
            .unwrap()
            .file_type()
            .is_symlink());
        let _ = std::fs::remove_dir_all(&shared);
        let _ = std::fs::remove_dir_all(&account);
    }
}

/// Whole provider-stdin write budget, including the authority lease wait.
const PROVIDER_WRITE_BUDGET: Duration = Duration::from_secs(12);
/// The authority lease shares the transcript write connection, which a large
/// upsert or delete can hold for seconds. Bound the wait so the write still has
/// most of its budget left.
const AUTHORITY_LEASE_WAIT: Duration = Duration::from_secs(5);
const SPAWN_GATE_WAIT: Duration = Duration::from_secs(30);

/// Reserves a native authority lease, waiting at most `wait`. On timeout
/// nothing has been dispatched, so the caller refuses and a retry cannot
/// duplicate the write. A reservation that completes after the timeout is
/// dropped unstarted, which releases it.
fn reserve_authority_within(
    gate: crate::session_store::authority::ExecutionGate,
    target: String,
    kind: &'static str,
    scope: Option<crate::session_store::authority::NativeScope>,
    existing_control: bool,
    wait: Duration,
) -> Result<crate::session_store::authority::NativeLease, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name("authority-lease".into())
        .spawn(move || {
            let _ = tx.send(gate.reserve_existing(&target, kind, scope.as_ref(), existing_control));
        })
        .map_err(|e| format!("Failed to reserve the session lease: {e}"))?;
    match rx.recv_timeout(wait) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(
            "Session storage is busy, so this was not sent to the provider. Try again in a moment."
                .into(),
        ),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Session lease reservation failed before it completed".into())
        }
    }
}

/// A child that stops draining stdin can block `write_all` for minutes, so the
/// write runs on the blocking pool — never on an async worker or the IPC path,
/// where it would starve `harness_kill` and make the wedged child unrecoverable.
#[tauri::command]
pub async fn harness_write(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, HarnessHost>,
    session_id: String,
    line: String,
    construction_id: Option<String>,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_process_purpose: Option<crate::session_store::canonical_store::NativeProcessPurpose>,
) -> Result<(), String> {
    let live = host.get_original(&session_id, construction_id.as_deref())?;
    if live.management_input_policy.is_some() != live.management_route_id.is_some() {
        return Err("NATIVE_MANAGEMENT_ROUTE_INVALID".into());
    }
    if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
        && live.native_session_capability.is_none()
        && live.management_input_policy.is_none()
    {
        return Err("NATIVE_SESSION_CAPABILITY_REQUIRED".into());
    }
    if let Some(policy) = live.management_input_policy {
        management_authority::validate_input(policy, &line, &live.cwd)?;
    }
    let mut admission = live.admit_write()?;
    let gate = if let Some(output) = &live.output {
        output.control_gate(&app)?
    } else {
        app.try_state::<crate::session_store::SessionStore>()
            .ok_or("NATIVE_AUTHORITY_STORE_UNAVAILABLE")?
            .authority_execution_gate()
    };
    let target = live.native_session_capability.as_ref().map_or_else(
        || {
            live.output
                .as_ref()
                .map_or(session_id.as_str(), |output| output.target())
                .to_owned()
        },
        |capability| capability.shell_id().to_owned(),
    );
    let scope = native_authority_scope(authority_environment_id, authority_generation)?;
    let finishing = finishing_native_frame(&line);
    let line_session = session_id.clone();
    let original = Arc::clone(&live);
    // Lease SQL (store mutex + write transaction) must not run on the async
    // command thread: reserve inside the blocking task together with the write.
    let result = tauri::async_runtime::spawn_blocking(move || {
        if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
            && live.native_session_capability != native_session_capability
        {
            return Err("CANONICAL_SESSION_CONSTRUCTION_MISMATCH".into());
        }
        if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
            && live.native_process_purpose != native_process_purpose
        {
            return Err("NATIVE_PROCESS_PURPOSE_MISMATCH".into());
        }
        let _purpose_admission = native_process_purpose
            .as_ref()
            .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
            .map(|purpose| {
                crate::session_store::canonical_store::admit_process_purpose(&window, purpose)
            })
            .transpose()?;
        let _session_admission = native_session_capability
            .as_ref()
            .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
            .map(|capability| {
                crate::session_store::canonical_store::admit_session_effect(
                    &app, &window, &target, capability,
                )
            })
            .transpose()?;
        // The write deadline starts before the lease wait.
        let deadline = Instant::now() + PROVIDER_WRITE_BUDGET;
        // Queue behind earlier writes to this child (FIFO) before taking a lease.
        admission.acquire(deadline)?;
        let lease = reserve_authority_within(
            gate,
            target,
            "provider-stdin",
            scope,
            finishing,
            AUTHORITY_LEASE_WAIT.min(deadline.saturating_duration_since(Instant::now())),
        )?;
        let line = crate::social_bridge::authorize_acp_frame(&line_session, line);
        let line = crate::runtime_logs_bridge::authorize_acp_frame(&line_session, line);
        let line = crate::conversation_tools_bridge::authorize_acp_frame(&line_session, line);
        write_child_with_deadline_admitted(
            live,
            line,
            deadline.saturating_duration_since(Instant::now()),
            Some(lease),
            admission,
        )
    })
    .await
    .map_err(|e| format!("Harness write task failed: {e}"))?;
    if result.is_err() && original.writers.is_closing() {
        // An old writer must not remove a replacement generation.
        host.remove_if_child(&session_id, &original);
    }
    result
}

#[cfg(all(test, unix))]
fn write_child_with_deadline(
    live: Arc<LiveChild>,
    line: String,
    timeout: Duration,
) -> Result<(), String> {
    write_child_with_deadline_guarded(live, line, timeout, None)
}

#[cfg(test)]
fn write_child_with_deadline_guarded(
    live: Arc<LiveChild>,
    line: String,
    timeout: Duration,
    authority: Option<crate::session_store::authority::NativeLease>,
) -> Result<(), String> {
    let admission = live.admit_write()?;
    write_child_with_deadline_admitted(live, line, timeout, authority, admission)
}

fn write_child_with_deadline_admitted(
    live: Arc<LiveChild>,
    line: String,
    timeout: Duration,
    authority: Option<crate::session_store::authority::NativeLease>,
    admission: LiveWrite,
) -> Result<(), String> {
    write_child_with_deadline_observed(live, line, timeout, authority, admission, || {})
}

fn write_child_with_deadline_observed(
    live: Arc<LiveChild>,
    line: String,
    timeout: Duration,
    authority: Option<crate::session_store::authority::NativeLease>,
    admission: LiveWrite,
    after_io: impl FnOnce() + Send + 'static,
) -> Result<(), String> {
    write_child_with_deadline_waiter(
        live,
        line,
        timeout,
        authority,
        admission,
        after_io,
        |rx, timeout| rx.recv_timeout(timeout),
    )
}

fn write_child_with_deadline_waiter(
    live: Arc<LiveChild>,
    line: String,
    timeout: Duration,
    mut authority: Option<crate::session_store::authority::NativeLease>,
    mut admission: LiveWrite,
    after_io: impl FnOnce() + Send + 'static,
    wait_result: impl FnOnce(
        &mpsc::Receiver<Result<(), String>>,
        Duration,
    ) -> Result<Result<(), String>, mpsc::RecvTimeoutError>,
) -> Result<(), String> {
    // Idempotent; a no-op when the command already queued before its lease.
    let deadline = Instant::now() + timeout;
    admission.acquire(deadline)?;
    let timeout = deadline.saturating_duration_since(Instant::now());
    admission.started = true;
    if let Some(lease) = authority.as_mut() {
        if let Err(error) = lease.begin_external() {
            // Authority refusal before external I/O authorizes no stop or
            // routing removal. The original source remains explicitly owned.
            admission.started = false;
            admission.finish(&Ok(()));
            return Err(error);
        }
    }
    let pid = live.pid;
    let bytes = line.len();
    let (tx, rx) = mpsc::channel();
    let writing = live.clone();
    let writer = thread::spawn(move || {
        let mut stdin = match writing.stdin.try_lock() {
            Ok(stdin) => stdin,
            Err(_) => {
                // Writes are serialized before this point, so this only means the
                // stdin owner is wedged outside the queue.
                let result = Err(PROVIDER_NOT_READING.into());
                if let Some(lease) = authority {
                    let _ = lease.finish();
                }
                admission.finish(&result);
                let _ = tx.send(result);
                return;
            }
        };
        let result = stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("Failed to write to harness (pid {pid}, {bytes} bytes): {e}"));
        // Unlock stdin before the queue slot is released so the next write cannot
        // observe it locked.
        drop(stdin);
        after_io();
        let cleanup = authority.map_or(Ok(()), |lease| lease.finish());
        let result = result.and(cleanup);
        admission.finish(&result);
        let _ = tx.send(result);
    });
    let mut write_timed_out = false;
    let result = match wait_result(&rx, timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // A slow write alone does not prove the provider is dead: report the
            // error but keep the child. The detached writer ends with the pipe.
            write_timed_out = true;
            Err(format!(
                "Harness stdin delivery outcome unknown after {} ms (pid {pid}, {bytes} bytes); do not retry",
                timeout.as_millis()
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(format!("Harness writer exited (pid {pid})"))
        }
    };
    if write_timed_out {
        return result;
    }
    let joined = writer
        .join()
        .map_err(|_| format!("Harness writer panicked (pid {pid})"));
    let result = joined.and(result);
    if result.is_err() {
        let stopping = live.request_stop();
        if stopping.is_ok() {
            let _ = live
                .process
                .as_ref()
                .unwrap()
                .wait_actual_timeout(STOP_WAIT);
        }
    }
    result
}

fn native_authority_scope(
    environment_id: Option<String>,
    generation: Option<u64>,
) -> Result<Option<crate::session_store::authority::NativeScope>, String> {
    match (environment_id, generation) {
        (Some(environment_id), Some(generation)) => {
            Ok(Some(crate::session_store::authority::NativeScope {
                environment_id,
                generation,
            }))
        }
        (None, None) => Ok(None),
        _ => Err("NATIVE_AUTHORITY_STALE_GENERATION".into()),
    }
}

fn finishing_native_frame(line: &str) -> bool {
    let Ok(frame) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    if frame.get("id").is_some()
        && frame.get("method").is_none()
        && (frame.get("result").is_some() || frame.get("error").is_some())
    {
        return true;
    }
    if matches!(
        frame.get("method").and_then(serde_json::Value::as_str),
        Some("turn/interrupt" | "session/cancel")
    ) {
        return true;
    }
    if matches!(
        frame.get("type").and_then(serde_json::Value::as_str),
        Some("control_response" | "permission_response" | "abort")
    ) {
        return true;
    }
    frame.get("type").and_then(serde_json::Value::as_str) == Some("user")
        && frame["message"]["content"]
            .as_array()
            .is_some_and(|content| {
                !content.is_empty() && content.iter().all(|part| part["type"] == "tool_result")
            })
}

#[cfg(test)]
mod authority_tests {
    use super::*;
    use crate::session_store::SessionStore;

    fn store() -> SessionStore {
        SessionStore::open_in_memory().unwrap()
    }

    #[test]
    fn quiescing_admits_completion_frames_and_rejects_new_prompts() {
        for frame in [
            r#"{"id":1,"result":{}}"#,
            r#"{"id":1,"error":{"code":1}}"#,
            r#"{"method":"turn/interrupt","params":{}}"#,
            r#"{"method":"session/cancel"}"#,
            r#"{"type":"control_response","response":{}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"completed"}]}}"#,
        ] {
            assert!(finishing_native_frame(frame), "{frame}");
        }
        for frame in [
            r#"{"id":1,"method":"turn/start","params":{"prompt":"new"}}"#,
            r#"{"method":"session/prompt"}"#,
            r#"{"type":"user","message":{"content":[{"type":"text","text":"new"}]}}"#,
            r#"{"type":"user","message":{"content":[]}}"#,
            "unparsed",
            "{}\n{}",
        ] {
            assert!(!finishing_native_frame(frame), "{frame}");
        }
    }

    #[test]
    fn catalog_probes_stay_read_only_while_mutating_service_and_delete_require_provenance() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        assert!(exec_requires_session_provenance(
            Some("opencode"),
            &args(&["service", "start"])
        ));
        assert!(!exec_requires_session_provenance(
            Some("grok"),
            &args(&["--no-auto-update", "sessions", "delete", "id"])
        ));
        for values in [
            vec!["--version"],
            vec!["models"],
            vec!["service", "status"],
            vec!["service", "get", "password"],
        ] {
            assert!(!exec_requires_session_provenance(
                Some("opencode"),
                &args(&values)
            ));
        }
    }

    #[test]
    fn idle_requires_known_provider_settlement_and_closed_event_stream() {
        let host = HarnessHost::new();
        let exit = Arc::new(ManagedProviderExit::default());
        host.inner
            .lock()
            .unwrap()
            .managed_exits
            .insert("native".into(), vec![exit.clone()]);
        assert!(host.authority_idle("native").is_err());
        exit.finish(Err("unknown process exit".into()));
        assert!(host.authority_idle("native").is_err());
        exit.finish(Ok(()));
        assert!(host.authority_idle("native").is_ok());
        host.sse.lock().unwrap().insert(
            "native".into(),
            Arc::new(LiveSse {
                stop: Arc::new(AtomicBool::new(false)),
                issuer: None,
                owners: Arc::new(Owners::new("isolated")),
                output: None,
                native_session_capability: None,
            }),
        );
        assert!(host.authority_idle("native").is_err());
        host.sse.lock().unwrap().remove("native");
        assert!(host.authority_idle("native").is_ok());
    }

    #[test]
    fn reader_timeout_is_unknown_and_cannot_prove_process_quiescence() {
        let (tx, rx) = mpsc::channel();
        assert!(!wait_for_readers(&rx, Duration::from_millis(1)));
        drop(tx);
        assert!(wait_for_readers(&rx, Duration::from_millis(1)));
    }

    #[test]
    fn persisted_fence_is_checked_at_the_actual_fork_boundary() {
        let store = store();
        let gate = store.authority_execution_gate();
        let mut lease = gate.reserve("native", "provider-spawn", None).unwrap();
        // Simulate recovery observing a fence after admission but before fork.
        // A legitimate coordinator cannot fence with the reservation present.
        store.lock_conn().unwrap().execute("INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol) VALUES('env','native',1,'FENCED','migration',2)",[]).unwrap();
        let host = HarnessHost::new();
        let (epoch, kill_all, _) = host.begin_spawn("native");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.arg("--list");
        isolate_child(&mut command);
        assert!(host
            .spawn_tracked_guarded("native", epoch, kill_all, &mut command, Some(&mut lease))
            .is_err());
        assert!(!host
            .inner
            .lock()
            .unwrap()
            .managed_exits
            .contains_key("native"));
    }

    #[test]
    fn generated_route_fork_receipt_and_late_floor_belong_to_exact_logical_target() {
        let store = store();
        let gate = store.authority_execution_gate();
        let host = HarnessHost::new();
        let route = "logical#generated-child";
        let mut lease = gate.reserve("logical", "provider-spawn", None).unwrap();
        let (epoch, kill_all, _) = host.begin_spawn(route);
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_child(&mut command);
        let (mut child, receipt) = host
            .spawn_tracked_for_target(
                route,
                "logical",
                epoch,
                kill_all,
                &mut command,
                Some(&mut lease),
            )
            .unwrap();
        assert!(host.authority_idle("logical").is_err());
        assert!(!host.lock_inner().managed_exits.contains_key(route));
        assert!(child.wait().unwrap().success());
        assert!(host.authority_idle("logical").is_err());
        lease.finish().unwrap();
        receipt.finish(Ok(()));
        assert!(host.authority_idle("logical").is_ok());

        let mut blocked = gate.reserve("logical", "provider-spawn", None).unwrap();
        store.lock_conn().unwrap().execute("INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol) VALUES('env','logical',1,'FENCED','migration',2)", []).unwrap();
        let (epoch, kill_all, _) = host.begin_spawn(route);
        assert!(host
            .spawn_tracked_for_target(
                route,
                "logical",
                epoch,
                kill_all,
                &mut command,
                Some(&mut blocked)
            )
            .is_err());
        assert!(host.lock_inner().managed_exits["logical"]
            .iter()
            .all(|receipt| receipt.succeeded()));
    }

    #[test]
    fn known_spawn_failure_releases_admission_and_real_fork_stays_reserved_until_exit() {
        let store = store();
        let gate = store.authority_execution_gate();
        let host = HarnessHost::new();
        let mut failed = gate.reserve("missing", "provider-spawn", None).unwrap();
        let (epoch, kill_all, _) = host.begin_spawn("missing");
        let mut missing = Command::new(
            std::env::temp_dir().join(format!("absent-provider-{}", uuid::Uuid::new_v4())),
        );
        isolate_child(&mut missing);
        assert!(host
            .spawn_tracked_guarded("missing", epoch, kill_all, &mut missing, Some(&mut failed))
            .is_err());
        drop(failed);
        let mut lease = gate.reserve("real", "provider-spawn", None).unwrap();
        let (epoch, kill_all, _) = host.begin_spawn("real");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_child(&mut command);
        let (mut child, exit) = host
            .spawn_tracked_guarded("real", epoch, kill_all, &mut command, Some(&mut lease))
            .unwrap();
        assert!(host.authority_idle("real").is_err());
        let phase: String = store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT phase FROM native_authority_reservations WHERE session_id='real'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(phase, "RUNNING");
        assert!(child.wait().unwrap().success());
        assert!(host.authority_idle("real").is_err());
        lease.finish().unwrap();
        exit.finish(Ok(()));
        assert!(host.authority_idle("real").is_ok());
        assert_eq!(
            store
                .lock_conn()
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM native_authority_reservations",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}

/// Async dispatch plus the blocking pool keeps kill executable while a sibling
/// `harness_write` is blocked on a wedged child's stdin, and while other
/// commands wait on a hung Host.
#[tauri::command]
pub async fn harness_kill(
    window: tauri::WebviewWindow,
    session_id: String,
    construction_id: Option<String>,
) -> Result<(), String> {
    run_blocking("harness_kill", move || {
        let app = window.app_handle().clone();
        let host = app.state::<HarnessHost>();
        harness_kill_blocking(window, host, session_id, construction_id)
    })
    .await
}

fn harness_kill_blocking(
    window: tauri::WebviewWindow,
    host: State<'_, HarnessHost>,
    session_id: String,
    construction_id: Option<String>,
) -> Result<(), String> {
    // Stale/closed/changed targets have nothing of ours left to kill.
    let issuer = match crate::control::receipts::existing(&window) {
        Ok(issuer) => issuer,
        Err(error) if kill_target_gone(&error) => return Ok(()),
        Err(error) => return Err(error),
    };
    let live = match issuer.with_live(|| {
        host.select_original_for_stop(&session_id, construction_id.as_deref(), Some(&issuer))
    }) {
        Ok(live) => live,
        Err(error) if kill_target_gone(&error) => return Ok(()),
        Err(error) => return Err(error),
    };
    live.stop_and_drain()
}

fn kill_target_gone(error: &str) -> bool {
    matches!(
        error,
        "NATIVE_PROCESS_CONSTRUCTION_STALE"
            | "NATIVE_CONTROL_WINDOW_UNKNOWN"
            | "NATIVE_CONTROL_WINDOW_CLOSED"
    )
}

/// Native administrative cleanup intentionally addresses the current session.
/// This is not a receipt-free IPC fallback for callbacks from old children.
pub(crate) fn kill_current_harness(host: &HarnessHost, session_id: &str) -> Result<(), String> {
    host.stop_sse(session_id);
    if let Some(live) = host.kill_session(session_id) {
        let _ = live.stop_and_drain();
    }
    Ok(())
}

/// Explicit ownership transfer waits for physical process exit and, when enabled,
/// the execution Host's activity acknowledgement. Ordinary idle turns stay warm.
#[tauri::command]
pub async fn harness_retire(app: AppHandle, session_id: String) -> Result<(), String> {
    run_blocking("harness_retire", move || {
        app.state::<HarnessHost>()
            .retire_managed_session(&session_id)
    })
    .await
}

/// Off the main thread: `kill_all` waits for the children to die before it
/// returns, and a window close calls this while the app keeps running.
#[tauri::command]
pub async fn harness_kill_all(app: AppHandle) -> Result<(), String> {
    run_blocking("harness_kill_all", move || {
        app.state::<HarnessHost>().kill_all();
        Ok(())
    })
    .await
}

static HTTP_AGENT: OnceLock<ureq::Agent> = OnceLock::new();

/// One agent so calls to the local provider server reuse connections. The
/// per-call timeout is set on each request.
fn http_agent() -> &'static ureq::Agent {
    HTTP_AGENT.get_or_init(|| localhost_http_agent_builder().build())
}

fn localhost_http_agent_builder() -> ureq::AgentBuilder {
    // A local provider response cannot redirect native requests to another host.
    ureq::AgentBuilder::new().redirects(0)
}

#[tauri::command]
// AppHandle plus the existing flat IPC fields and optional authority provenance.
pub async fn harness_http(
    app: AppHandle,
    window: tauri::Window,
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    session_id: Option<String>,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_owned_service: Option<owned_opencode::ServiceHandle>,
) -> Result<HarnessHttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        assert_loopback(&url)?;
        let _legacy_utility_pin =
            if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
                && native_owned_service.is_none()
            {
                let route = session_id
                    .as_deref()
                    .ok_or("NATIVE_SESSION_CAPABILITY_REQUIRED")?;
                let child = app
                    .state::<HarnessHost>()
                    .get(route)
                    .ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?;
                let webview = app
                    .get_webview_window(window.label())
                    .ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
                let issuer = crate::control::receipts::capture(&webview)?;
                let endpoint = child
                    .utility_endpoint
                    .as_ref()
                    .ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?;
                let parsed =
                    url::Url::parse(&url).map_err(|_| "NATIVE_UTILITY_ENDPOINT_INVALID")?;
                if !child
                    .issuer
                    .as_ref()
                    .is_some_and(|owner| Arc::ptr_eq(owner, &issuer))
                    || child.native_session_capability != native_session_capability
                    || parsed.origin().ascii_serialization() != *endpoint
                {
                    return Err("NATIVE_UTILITY_ENDPOINT_INVALID".into());
                }
                Some(
                    child
                        .process
                        .as_ref()
                        .ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?
                        .pin()
                        .map_err(|e| e.to_string())?,
                )
            } else {
                None
            };
        let parent = native_owned_service.as_ref().and_then(|_| {
            native_session_capability
                .as_ref()
                .map(|capability| capability.shell_id().to_owned())
        });
        let parent_gate = parent.as_deref().map(session_spawn_gate);
        let gate_guard = parent_gate
            .as_ref()
            .map(|gate| gate.lock().map_err(|_| "OWNED_OPENCODE_GATE_UNAVAILABLE"))
            .transpose()?;
        let mut owned = match &native_owned_service {
            Some(handle) => Some(match native_session_capability.as_ref() {
                Some(capability) => {
                    owned_opencode::capture_endpoint(&app, &window, handle, capability, &url)?
                }
                None => owned_opencode::capture_unscoped_endpoint(
                    &window,
                    handle,
                    &method,
                    &url,
                    body.as_deref(),
                )?,
            }),
            None => None,
        };
        let mut owned_completion = if let Some(parent) = parent {
            let exit = Arc::new(ManagedProviderExit::default());
            let host = app.state::<HarnessHost>();
            let mut inner = host.lock_inner();
            let exits = inner.managed_exits.entry(parent).or_default();
            exits.retain(|entry| !entry.succeeded());
            exits.push(exit.clone());
            Some(OwnedHttpCompletion {
                exit,
                complete: false,
            })
        } else {
            None
        };
        drop(gate_guard);
        let _session_admission =
            if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED {
                if let Some(capability) = native_session_capability.as_ref() {
                    session_id
                        .as_deref()
                        .ok_or("CANONICAL_SESSION_SCOPE_REQUIRED")?;
                    let target = capability.shell_id();
                    Some(crate::session_store::canonical_store::admit_session_effect(
                        &app, &window, target, capability,
                    )?)
                } else {
                    None
                }
            } else {
                None
            };
        let mut authority = if !matches!(method.as_str(), "GET" | "HEAD" | "OPTIONS") {
            if let Some(session_id) = session_id.as_deref() {
                let source = app
                    .try_state::<HarnessHost>()
                    .map(|host| host.output_for_route(session_id))
                    .transpose()?
                    .flatten();
                let gate = match &source {
                    Some(output) => output.control_gate(&app)?,
                    None => app
                        .try_state::<crate::session_store::SessionStore>()
                        .ok_or("NATIVE_AUTHORITY_STORE_UNAVAILABLE")?
                        .authority_execution_gate(),
                };
                let target = match native_session_capability.as_ref() {
                    Some(capability) => capability.shell_id(),
                    None => source.as_ref().map_or(session_id, |output| output.target()),
                };
                gate.assert_provider_target(target, &url)?;
                let scope = native_authority_scope(authority_environment_id, authority_generation)?;
                let path = url::Url::parse(&url)
                    .map_err(|_| "NATIVE_AUTHORITY_INVALID_PROVIDER_TARGET")?
                    .path()
                    .to_owned();
                let finishing = method == "POST"
                    && (path.ends_with("/abort")
                        || path.ends_with("/interrupt")
                        || path.ends_with("/reply")
                        || path.ends_with("/reject"));
                Some(gate.reserve_existing(target, "provider-http", scope.as_ref(), finishing)?)
            } else {
                // Retain ordinary legacy probes, but never qualify an unknown
                // mutating caller for a later authority promotion.
                app.try_state::<crate::session_store::SessionStore>()
                    .ok_or("NATIVE_AUTHORITY_STORE_UNAVAILABLE")?
                    .authority_execution_gate()
                    .note_unknown_ingress("sessionless-provider-http")?;
                None
            }
        } else {
            None
        };
        if let Some(lease) = authority.as_mut() {
            lease.begin_external()?;
        }
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).max(1));
        let mut request = http_agent().request(&method, &url).timeout(timeout);
        if let Some(headers) = &headers {
            for (key, value) in headers {
                if owned.is_some() && key.eq_ignore_ascii_case("authorization") {
                    return Err("OWNED_OPENCODE_AUTH_HEADER_FORBIDDEN".into());
                }
                request = request.set(key, value);
            }
        }
        let authorization = owned.as_ref().map(|service| service.authorization());
        if let Some(value) = authorization.as_ref() {
            request = request.set("Authorization", value.as_str());
        }
        let result = match body {
            Some(payload) => request.send_string(&payload),
            None => request.call(),
        };
        let response = match result {
            Ok(response) => read_http_response(response),
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                Ok(HarnessHttpResponse { status, body })
            }
            Err(error) => Err(format!("OpenCode HTTP failed: {error}")),
        }?;
        if let Some(service) = owned.as_mut() {
            service.settle_utility(response.status, &response.body)?;
        }
        if let Some(lease) = authority {
            lease.finish()?;
        }
        drop(authorization);
        drop(owned);
        if let Some(completion) = owned_completion.as_mut() {
            completion.exit.finish(Ok(()));
            completion.complete = true;
        }
        Ok(response)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lets the calling window also receive a running child's output (and its SSE
/// stream). Call it before expecting output; the spawning window keeps its own
/// registration. Nothing hands a live child to another window today: a busy
/// session cannot be popped out (`busySessionsInTabs`), and a window closed
/// while busy is hidden, not destroyed.
#[tauri::command]
pub fn harness_set_owner(
    host: State<'_, HarnessHost>,
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    if let Some(live) = host.get(&session_id) {
        live.owners.add_window(&window);
    }
    if let Some(sse) = host
        .sse
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&session_id)
    {
        sse.owners.add_window(&window);
    }
    Ok(())
}

/// Off the main thread: the authority lease shares the transcript write
/// connection and must never freeze the UI while another write holds it.
#[tauri::command]
// Window/AppHandle/State are injected natively; retain the existing flat IPC shape.
pub async fn harness_sse_open(
    app: AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
    logical_session_id: Option<String>,
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_owned_service: Option<owned_opencode::ServiceHandle>,
) -> Result<(), String> {
    let issuer = crate::control::receipts::capture(&window)?;
    run_blocking("harness_sse_open", move || {
        let host = app.state::<HarnessHost>();
        harness_sse_open_blocking(
            app.clone(),
            window,
            issuer,
            host,
            session_id,
            url,
            headers,
            authority_environment_id,
            authority_generation,
            logical_session_id,
            native_session_capability,
            native_owned_service,
        )
    })
    .await
}

fn harness_sse_open_blocking(
    app: AppHandle,
    window: tauri::WebviewWindow,
    issuer: Arc<crate::control::receipts::WindowIssuer>,
    host: State<HarnessHost>,
    session_id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
    logical_session_id: Option<String>,
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_owned_service: Option<owned_opencode::ServiceHandle>,
) -> Result<(), String> {
    assert_loopback(&url)?;
    let _legacy_utility_pin = if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
        && native_owned_service.is_none()
    {
        let child = host
            .get(&session_id)
            .ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?;
        let endpoint = child
            .utility_endpoint
            .as_ref()
            .ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?;
        let parsed = url::Url::parse(&url).map_err(|_| "NATIVE_UTILITY_ENDPOINT_INVALID")?;
        if !child
            .issuer
            .as_ref()
            .is_some_and(|owner| Arc::ptr_eq(owner, &issuer))
            || child.native_session_capability != native_session_capability
            || parsed.origin().ascii_serialization() != *endpoint
        {
            return Err("NATIVE_UTILITY_ENDPOINT_INVALID".into());
        }
        Some(
            child
                .process
                .as_ref()
                .ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?
                .pin()
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    let (source, explicit) = OutputSource::capture_or_unbound(
        &app,
        &window,
        &session_id,
        logical_session_id.as_deref(),
    )?;
    let target = native_session_capability.as_ref().map_or_else(
        || source.target().to_owned(),
        |capability| capability.shell_id().to_owned(),
    );
    let spawn_gate = session_spawn_gate(&target);
    let _spawn_guard = spawn_gate
        .try_lock()
        .map_err(|_| "Conversation is still starting; retry")?;
    let owned = match &native_owned_service {
        Some(handle) => Some(match native_session_capability.as_ref() {
            Some(capability) => owned_opencode::capture_endpoint(
                &app,
                &window.as_ref().window(),
                handle,
                capability,
                &url,
            )?,
            None => owned_opencode::capture_utility_endpoint(
                &window.as_ref().window(),
                handle,
                "GET",
                &url,
                None,
            )?,
        }),
        None => None,
    };
    if owned.is_some()
        && headers.as_ref().is_some_and(|values| {
            values
                .keys()
                .any(|key| key.eq_ignore_ascii_case("authorization"))
        })
    {
        return Err("OWNED_OPENCODE_AUTH_HEADER_FORBIDDEN".into());
    }
    let _session_admission = native_session_capability
        .as_ref()
        .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
        .map(|capability| {
            crate::session_store::canonical_store::admit_session_effect(
                &app,
                &window.as_ref().window(),
                &target,
                capability,
            )
        })
        .transpose()?;
    let mut window_claim = issuer.with_live(|| {
        crate::session_window_ownership::reserve_spawn(&target, &issuer, window.label())
    })?;
    let gate = source.control_gate(&app)?;
    gate.assert_provider_target(&target, &url)?;
    let scope = native_authority_scope(authority_environment_id, authority_generation)?;
    let mut authority = reserve_authority_within(
        gate,
        target.clone(),
        "provider-events",
        scope,
        false,
        AUTHORITY_LEASE_WAIT,
    )?;
    source.check_target_before_start(explicit)?;
    let stop = Arc::new(AtomicBool::new(false));
    let owned_stream_exit = owned
        .as_ref()
        .map(|_| Arc::new(ManagedProviderExit::default()));
    let owners = Arc::new(Owners::for_source(&window, &source));
    let (current, notice) = output_callbacks(&app, &owners);
    let output = issuer.with_live(|| {
        host.assert_spawn_owner(&target, &issuer)?;
        // Closing an SSE reader does not prove its external provider turn
        // stopped. Keep same-process recovery unverified for this page.
        mark_page_external_unverified(&issuer)?;
        authority.begin_external()?;
        host.stop_sse(&session_id);
        let output = host.output.begin_sse(source, current, notice);
        host.insert_sse(
            session_id.clone(),
            Arc::new(LiveSse {
                stop: Arc::clone(&stop),
                issuer: Some(issuer.clone()),
                owners: Arc::clone(&owners),
                output: Some(output.clone()),
                native_session_capability: native_session_capability.clone(),
            }),
        );
        if let Some(exit) = &owned_stream_exit {
            let mut inner = host.lock_inner();
            let exits = inner.managed_exits.entry(target.clone()).or_default();
            exits.retain(|entry| !entry.succeeded());
            exits.push(exit.clone());
        }
        Ok(output)
    })?;
    let window_lifetime = window_claim
        .commit()
        .map_err(|error| log::warn!("ownership tracking unavailable: {error}"))
        .ok();

    let output_reader = output.reader(0);
    thread::spawn(move || {
        let owned = owned;
        let _legacy_utility_pin = _legacy_utility_pin;
        let _session_admission = _session_admission;
        let agent = localhost_http_agent_builder()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(60 * 60 * 6))
            .timeout_write(Duration::from_secs(30))
            .build();
        let mut request = agent.get(&url).set("Accept", "text/event-stream");
        if let Some(headers) = &headers {
            for (key, value) in headers {
                if owned.is_some() && key.eq_ignore_ascii_case("authorization") {
                    continue;
                }
                request = request.set(key, value);
            }
        }
        let authorization = owned.as_ref().map(|service| service.authorization());
        if let Some(value) = authorization.as_ref() {
            request = request.set("Authorization", value.as_str());
        }
        let result = request.call();
        if stop.load(Ordering::SeqCst) {
            drop(result);
            output_reader.finish(false, true);
            output.terminal_complete(true, true);
            let confirmed = authority.finish().is_ok();
            if confirmed {
                if let Some(lifetime) = window_lifetime {
                    lifetime.finish();
                }
            }
            emit_sse_end(&app, &owners, &session_id, None, &output);
            drop(authorization);
            drop(owned);
            if let Some(exit) = &owned_stream_exit {
                exit.finish(if confirmed {
                    Ok(())
                } else {
                    Err("OWNED_OPENCODE_SSE_RETIREMENT_UNKNOWN".into())
                });
            }
            return;
        }
        let success = match result {
            Ok(response) => {
                let reader = BufReader::new(response.into_reader());
                let success = read_sse(
                    reader,
                    &app,
                    &owners,
                    &session_id,
                    &stop,
                    output.clone(),
                    owned
                        .as_ref()
                        .and_then(|service| service.utility_session.as_deref()),
                );
                output_reader.finish(success, stop.load(Ordering::Acquire));
                output.terminal_complete(success, stop.load(Ordering::Acquire));
                emit_sse_end(&app, &owners, &session_id, None, &output);
                success
            }
            Err(error) => {
                output_reader.finish(false, false);
                output.terminal_complete(false, false);
                emit_sse_end(
                    &app,
                    &owners,
                    &session_id,
                    Some(format!("OpenCode event stream failed: {error}")),
                    &output,
                );
                false
            }
        };
        let mut confirmed = false;
        if success || stop.load(Ordering::Acquire) {
            confirmed = authority.finish().is_ok();
            if confirmed {
                if let Some(lifetime) = window_lifetime {
                    lifetime.finish();
                }
            }
        }
        drop(authorization);
        drop(owned);
        if let Some(exit) = &owned_stream_exit {
            exit.finish(if confirmed {
                Ok(())
            } else {
                Err("OWNED_OPENCODE_SSE_RETIREMENT_UNKNOWN".into())
            });
        }
    });

    Ok(())
}

#[tauri::command]
pub fn harness_sse_close(host: State<HarnessHost>, session_id: String) -> Result<(), String> {
    host.stop_sse(&session_id);
    Ok(())
}

/// Longest a line waits behind the previous emit; the first line after a quiet
/// spell is not held at all.
const LINE_BATCH_WINDOW: Duration = Duration::from_millis(8);
const LINE_BATCH_BYTES: usize = 64 * 1024;
const LINE_BATCH_LINES: usize = 512;
/// Bounds what the reader can run ahead of the emitter; a full queue blocks the
/// reader, which backs up the child's pipe.
const LINE_QUEUE: usize = 256;
/// How long the exit event waits for the readers to flush after the child exits.
const EXIT_DRAIN_GRACE: Duration = Duration::from_secs(1);

/// Merges what `rx` delivers into few emits, in order. The first line after a
/// quiet spell goes out at once; otherwise a batch waits until `window` has
/// passed since the last emit, or until it holds `max_bytes` or `max_lines`.
/// Lines are never split or merged, and one that would push a batch past
/// `max_bytes` starts the next batch (an oversized line is a batch of its own).
/// Returns after the channel closes and the last lines are emitted.
fn coalesce_lines<F: FnMut(Vec<String>)>(
    rx: &mpsc::Receiver<String>,
    window: Duration,
    max_bytes: usize,
    max_lines: usize,
    mut emit: F,
) {
    use mpsc::{RecvTimeoutError, TryRecvError};

    let mut last_emit: Option<Instant> = None;
    let mut carry: Option<String> = None;
    loop {
        let first = match carry.take() {
            Some(line) => line,
            None => match rx.recv() {
                Ok(line) => line,
                Err(_) => return,
            },
        };
        let mut bytes = first.len();
        let mut batch = vec![first];
        let deadline = last_emit.map(|at| at + window);
        let mut closed = false;
        while bytes < max_bytes && batch.len() < max_lines {
            let next = match rx.try_recv() {
                Ok(line) => line,
                Err(TryRecvError::Disconnected) => {
                    closed = true;
                    break;
                }
                Err(TryRecvError::Empty) => {
                    let Some(wait) =
                        deadline.map(|at| at.saturating_duration_since(Instant::now()))
                    else {
                        break;
                    };
                    if wait.is_zero() {
                        break;
                    }
                    match rx.recv_timeout(wait) {
                        Ok(line) => line,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => {
                            closed = true;
                            break;
                        }
                    }
                }
            };
            if bytes + next.len() > max_bytes {
                carry = Some(next);
                break;
            }
            bytes += next.len();
            batch.push(next);
        }
        emit(batch);
        last_emit = Some(Instant::now());
        if closed {
            return;
        }
    }
}

/// Feeds lines to a worker thread that emits them in batches. Dropping it
/// closes the queue and waits for the last batch to go out.
struct LineBatcher {
    tx: Option<mpsc::SyncSender<String>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl LineBatcher {
    fn new<F: FnMut(Vec<String>) + Send + 'static>(emit: F) -> Self {
        let (tx, rx) = mpsc::sync_channel::<String>(LINE_QUEUE);
        let worker = thread::spawn(move || {
            coalesce_lines(
                &rx,
                LINE_BATCH_WINDOW,
                LINE_BATCH_BYTES,
                LINE_BATCH_LINES,
                emit,
            )
        });
        Self {
            tx: Some(tx),
            worker: Some(worker),
        }
    }

    fn push(&self, line: String) -> bool {
        if let Some(tx) = &self.tx {
            return tx.send(line).is_ok();
        }
        false
    }

    fn finish(mut self) -> bool {
        self.tx.take();
        self.worker
            .take()
            .is_none_or(|worker| worker.join().is_ok())
    }
}

impl Drop for LineBatcher {
    fn drop(&mut self) {
        self.tx.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Reads `reader` to EOF and emits its lines in batches; returns once the
/// last batch is out. Each line is decoded lossily (rule rust-bufreader-lines-on-stream): an invalid byte
/// replaces one character and the reader keeps draining, so Windows
/// code-page output or a chunk split inside a multibyte character never
/// drops the rest of the provider stream. Only EOF or a real I/O error ends
/// the read.
fn read_lines_batched<R: Read, F: FnMut(Vec<String>) + Send + 'static>(reader: R, emit: F) -> bool {
    let batcher = LineBatcher::new(emit);
    let mut reader = BufReader::new(reader);
    let mut success = true;
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) => break,
            Ok(_) => success &= batcher.push(decode_output_line(&raw)),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                success = false;
                break;
            }
        }
    }
    batcher.finish() && success
}

/// Decodes one raw provider line: replaces invalid UTF-8 with U+FFFD instead
/// of failing and strips the trailing `\n` or `\r\n`, matching what
/// `BufRead::lines` used to hand out for valid input.
fn decode_output_line(raw: &[u8]) -> String {
    let mut end = raw.len();
    if raw[..end].ends_with(b"\n") {
        end -= 1;
    }
    if raw[..end].ends_with(b"\r") {
        end -= 1;
    }
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

fn read_provider_lines<R: Read, F: FnMut(Vec<String>) + Send + 'static>(
    reader: R,
    receipt: crate::native_provider_output::Reader,
    emit: F,
) -> bool {
    let success = read_lines_batched(reader, emit);
    receipt.finish(success, false);
    success
}

/// Returns once every reader has dropped its sender, or after `grace`.
#[cfg(test)]
fn wait_for_readers(done: &mpsc::Receiver<()>, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        match done.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(()) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return true,
            Err(mpsc::RecvTimeoutError::Timeout) => return false,
        }
    }
}

fn read_http_response(response: ureq::Response) -> Result<HarnessHttpResponse, String> {
    let status = response.status();
    let body = response
        .into_string()
        .map_err(|e| format!("Failed to read OpenCode response: {e}"))?;
    Ok(HarnessHttpResponse { status, body })
}

/// Returns after every event read has been emitted, so the caller can send the
/// end event behind them.
fn read_sse<R: BufRead>(
    reader: R,
    app: &AppHandle,
    owners: &Arc<Owners>,
    session_id: &str,
    stop: &AtomicBool,
    output: Arc<NativeOutputStream>,
    utility_session: Option<&str>,
) -> bool {
    let emit_app = app.clone();
    let emit_owners = Arc::clone(owners);
    let emit_id = session_id.to_string();
    let utility_session = utility_session.map(str::to_owned);
    read_sse_batches(reader, stop, move |mut data| {
        if let Some(session) = &utility_session {
            data.retain(|raw| {
                serde_json::from_str::<serde_json::Value>(raw)
                    .ok()
                    .is_some_and(|event| {
                        event
                            .pointer("/data/sessionID")
                            .or_else(|| event.pointer("/properties/sessionID"))
                            .and_then(|value| value.as_str())
                            == Some(session.as_str())
                    })
            });
            if data.is_empty() {
                return;
            }
        }
        emit_output_batch(
            &emit_app,
            &emit_owners,
            &output,
            SSE_EVENT,
            OutputChannel::Sse,
            &data,
            |native_output| HarnessSseBatch {
                session_id: emit_id.clone(),
                data: data.clone(),
                native_output,
            },
        );
    })
}

fn read_sse_batches<R: BufRead, F: FnMut(Vec<String>) + Send + 'static>(
    reader: R,
    stop: &AtomicBool,
    emit: F,
) -> bool {
    let batcher = LineBatcher::new(emit);
    let mut data = String::new();
    let mut success = true;
    for line in reader.lines() {
        if stop.load(Ordering::SeqCst) {
            success = false;
            break;
        }
        let Ok(line) = line else {
            success = false;
            break;
        };
        if line.starts_with(':') {
            continue;
        }
        if line.is_empty() {
            if data.is_empty() {
                continue;
            }
            success &= batcher.push(std::mem::take(&mut data));
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            let piece = rest.strip_prefix(' ').unwrap_or(rest);
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(piece);
        }
    }
    // Keep the existing SSE wire behavior: an unterminated trailing message is
    // not invented as delivered. Its presence prevents an emission seal.
    if !data.is_empty() {
        success = false;
    }
    batcher.finish() && success
}

fn emit_sse_end(
    app: &AppHandle,
    owners: &Owners,
    session_id: &str,
    error: Option<String>,
    output: &NativeOutputStream,
) {
    let sent = route_output_state(
        app,
        owners,
        output.observation(),
        SSE_END_EVENT,
        |native_output_state| HarnessSseEnd {
            session_id: session_id.to_string(),
            error: error.clone(),
            native_output_state: Some(native_output_state),
        },
    );
    output.terminal_delivery(sent);
}

fn assert_loopback(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "OpenCode HTTP is limited to localhost")?;
    if parsed.scheme() == "http"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"))
    {
        return Ok(());
    }
    Err("OpenCode HTTP is limited to localhost".into())
}

const EXEC_ALLOWED_ARGS: &[&[&str]] = &[
    &["--version"],
    &["--list-models"],
    &["models", "--verbose"],
    &["models", "--json"],
    &["models"],
    &["status", "--json"],
    &["agent", "list"],
];

// OpenCode 2.x runs as a background service; other providers' CLIs may give
// these subcommands unrelated meanings, so they stay OpenCode-only.
const OPENCODE_EXEC_ALLOWED_ARGS: &[&[&str]] = &[
    &["service", "status"],
    &["service", "start"],
    &["service", "get", "password"],
];

fn exec_args_allowed(binary_provider: Option<&str>, args: &[String]) -> bool {
    let matches = |a: &&[&str]| a.len() == args.len() && a.iter().zip(args).all(|(x, y)| x == y);
    EXEC_ALLOWED_ARGS.iter().any(matches)
        || (binary_provider == Some("opencode") && OPENCODE_EXEC_ALLOWED_ARGS.iter().any(matches))
        || (binary_provider == Some("grok")
            && args.len() == 4
            && args[0] == "--no-auto-update"
            && args[1] == "sessions"
            && args[2] == "delete"
            && args[3].len() == 36
            && uuid::Uuid::parse_str(&args[3]).is_ok())
}

fn exec_requires_session_provenance(binary_provider: Option<&str>, args: &[String]) -> bool {
    binary_provider == Some("opencode") && args == ["service", "start"]
}

/// Must be a path a resolver would hand back, not an arbitrary binary
/// that merely shares a file name.
pub(crate) fn is_resolved_harness_binary(
    command: &str,
    binary_provider: Option<&str>,
    binary_path: Option<&str>,
) -> bool {
    let Some(provider) = binary_provider else {
        return false;
    };
    let resolved = match binary_path {
        Some(binary_path) => resolve_harness_binary_override(provider, binary_path),
        None => return default_binary_matches(provider, Path::new(command)),
    };
    resolved.is_ok_and(|path| path == Path::new(command))
}

const DEFAULT_BINARY_TTL: Duration = Duration::from_secs(30);
type DefaultBinaryCache = HashMap<(String, Option<String>), (Instant, Option<PathBuf>)>;
static DEFAULT_BINARIES: OnceLock<Mutex<DefaultBinaryCache>> = OnceLock::new();

/// The PATH walk behind a default resolution runs on every spawn. A cached hit
/// skips it for `DEFAULT_BINARY_TTL`; anything else (a miss, a different
/// path) re-resolves and refreshes the entry, so an install or move is never
/// rejected for up to a TTL. User-configured paths do not come through here.
fn default_binary_matches(provider: &str, command: &Path) -> bool {
    let key = (provider.to_string(), std::env::var("PATH").ok());
    let cache = DEFAULT_BINARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let hit = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&key)
        .is_some_and(|(at, path)| {
            at.elapsed() < DEFAULT_BINARY_TTL && path.as_deref() == Some(command)
        });
    if hit {
        return true;
    }
    let resolved = resolve_harness_binary_default(provider);
    let matches = resolved.as_deref() == Some(command);
    cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(key, (Instant::now(), resolved));
    matches
}

/// One-shot capture of stdout (used for `cursor-agent --list-models`).
#[tauri::command]
pub async fn harness_exec(
    app: AppHandle,
    window: tauri::Window,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    binary_provider: Option<String>,
    binary_path: Option<String>,
    native_process_purpose: Option<crate::session_store::canonical_store::NativeProcessPurpose>,
    native_management_token: Option<String>,
    native_management_route_id: Option<String>,
) -> Result<String, String> {
    if !exec_args_allowed(binary_provider.as_deref(), &args) {
        return Err("harness_exec: unsupported arguments".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        match (
            native_management_token.as_deref(),
            native_management_route_id.as_deref(),
        ) {
            (Some(token), Some(route)) => management_authority::consume(
                &window,
                token,
                route,
                &command,
                &args,
                cwd.as_deref(),
                binary_provider.as_deref(),
                binary_path.as_deref(),
            )?,
            (None, None) => {}
            _ => return Err("NATIVE_MANAGEMENT_GRANT_INVALID".into()),
        }
        let _purpose_admission = native_process_purpose
            .as_ref()
            .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
            .map(|purpose| {
                crate::session_store::canonical_store::admit_process_purpose(&window, purpose)
            })
            .transpose()?;
        if !is_resolved_harness_binary(&command, binary_provider.as_deref(), binary_path.as_deref())
        {
            return Err("harness_exec: not a resolved harness CLI".to_string());
        }
        let mutating = exec_requires_session_provenance(binary_provider.as_deref(), &args);
        if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
            && (mutating
                || (binary_provider.as_deref() == Some("grok")
                    && args.get(1).is_some_and(|arg| arg == "sessions")))
            && native_management_token.is_none()
        {
            return Err("NATIVE_MANAGEMENT_GRANT_REQUIRED".into());
        }
        if mutating {
            app.try_state::<crate::session_store::SessionStore>()
                .ok_or("NATIVE_AUTHORITY_STORE_UNAVAILABLE")?
                .authority_execution_gate()
                .note_unknown_ingress("legacy-provider-cli-mutation")?;
        }
        if mutating {
            exec_capture(&command, &args, cwd.as_deref())
        } else {
            exec_capture_read(&command, &args, cwd.as_deref())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn exec_capture(command: &str, args: &[String], cwd: Option<&str>) -> Result<String, String> {
    let output = exec_output(command, args, cwd, EXEC_TIMEOUT)?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() || !stdout.trim().is_empty() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(stderr.trim().to_string())
}

fn exec_capture_read(command: &str, args: &[String], cwd: Option<&str>) -> Result<String, String> {
    let output = exec_output_read(command, args, cwd, EXEC_TIMEOUT)?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() || !stdout.trim().is_empty() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(stderr.trim().to_string())
}

const EXEC_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) fn exec_output(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    exec_output_with_env(command, args, cwd, timeout, &[])
}

pub(crate) fn exec_output_with_env(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    timeout: Duration,
    env: &[(&str, &str)],
) -> Result<std::process::Output, String> {
    exec_command_output(
        configured_exec_command(command, args, cwd, env),
        command,
        timeout,
    )
}

fn exec_output_read(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    exec_command_output(
        configured_exec_command(command, args, cwd, &[]),
        command,
        timeout,
    )
}

/// A read whose printed lines stay useful when the command outlives `timeout`:
/// the process tree is stopped and its output so far is returned with `true`.
fn exec_output_read_partial(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<(std::process::Output, bool), String> {
    let mut cmd = configured_exec_command(command, args, cwd, &[]);
    let rx = spawn_output_wait(&mut cmd).map_err(|e| format!("Failed to run {command}: {e}"))?;
    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok((output, false)),
        Ok(Err(e)) => Err(format!("Failed to run {command}: {e}")),
        Err(_) => {
            rx.stop_and_drain();
            match rx.recv_timeout(KILL_ESCALATE * 2) {
                Ok(Ok(output)) => Ok((output, true)),
                _ => Err(format!(
                    "{command} timed out after {} seconds",
                    timeout.as_secs()
                )),
            }
        }
    }
}

fn configured_exec_command(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    env: &[(&str, &str)],
) -> Command {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_child(&mut cmd, command);
    cmd.envs(env.iter().copied());
    if let Some(dir) = cwd {
        let workdir = crate::session_folder::resolve_session_cwd(dir);
        if workdir.is_dir() {
            cmd.current_dir(workdir);
        }
    }

    cmd
}

struct OutputWait {
    receiver: mpsc::Receiver<std::io::Result<std::process::Output>>,
    owner: Arc<process_lifecycle::ProcessOwner>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}
impl OutputWait {
    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<std::io::Result<std::process::Output>, mpsc::RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }
    fn stop_and_drain(&self) {
        let _ = self.owner.request_stop();
        if let Some(worker) = self.worker.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = worker.join();
        }
    }
}
impl Drop for OutputWait {
    fn drop(&mut self) {
        self.stop_and_drain();
    }
}

/// One-shot readers and waiters retain the same original OS owner as providers.
fn spawn_output_wait(cmd: &mut Command) -> Result<OutputWait, std::io::Error> {
    OwnedChild::spawn(cmd).map(output_wait)
}

fn output_wait<C: Into<OwnedChild>>(child: C) -> OutputWait {
    let mut child = child.into();
    drop(child.stdin.take());
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let owner = Arc::new(process_lifecycle::ProcessOwner::new(child));
    let capture = |reader: Option<Box<dyn Read + Send>>,
                   owner: &Arc<process_lifecycle::ProcessOwner>| {
        let pin = owner.pin().expect("new original output owner");
        thread::spawn(move || {
            let _pin = pin;
            let mut bytes = Vec::new();
            if let Some(mut reader) = reader {
                reader.read_to_end(&mut bytes)?;
            }
            Ok::<_, std::io::Error>(bytes)
        })
    };
    let stdout = capture(stdout.map(|v| Box::new(v) as Box<dyn Read + Send>), &owner);
    let stderr = capture(stderr.map(|v| Box::new(v) as Box<dyn Read + Send>), &owner);
    let (tx, receiver) = mpsc::channel();
    let waiting = owner.clone();
    let worker = thread::spawn(move || {
        waiting.activate();
        let status = waiting.wait();
        let stdout = stdout
            .join()
            .map_err(|_| std::io::Error::other("stdout reader panicked"))
            .and_then(|r| r);
        let stderr = stderr
            .join()
            .map_err(|_| std::io::Error::other("stderr reader panicked"))
            .and_then(|r| r);
        let result = status.and_then(|status| {
            Ok(std::process::Output {
                status,
                stdout: stdout?,
                stderr: stderr?,
            })
        });
        let _ = tx.send(result);
    });
    OutputWait {
        receiver,
        owner,
        worker: Mutex::new(Some(worker)),
    }
}

/// Data observation only: the output never certifies retirement. The process
/// owner reports an unverified retirement itself.
fn exec_command_output(
    mut cmd: Command,
    command: &str,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let rx = spawn_output_wait(&mut cmd).map_err(|e| format!("Failed to run {command}: {e}"))?;

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("Failed to run {command}: {e}")),
        Err(_) => {
            rx.stop_and_drain();
            let mut error = format!("{command} timed out after {} seconds", timeout.as_secs());
            // Reap the terminated tree and retain diagnostics printed before it stalled.
            if let Ok(Ok(output)) = rx.recv_timeout(KILL_ESCALATE * 2) {
                for (label, bytes) in [("stdout", output.stdout), ("stderr", output.stderr)] {
                    let text = String::from_utf8_lossy(&bytes);
                    let tail: String = text
                        .chars()
                        .skip(text.chars().count().saturating_sub(2000))
                        .collect();
                    if !tail.trim().is_empty() {
                        error.push_str(&format!("\n{label}:\n{}", tail.trim()));
                    }
                }
            }
            Err(error)
        }
    }
}

/// What a `!command` from the composer printed, and how it ended.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandOutput {
    pub output: String,
    /// None when the process was killed.
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    #[serde(skip)]
    retirement: process_lifecycle::Retirement,
}
impl ShellCommandOutput {
    fn require_activity_retirement(&self) -> Result<(), String> {
        if self.timed_out {
            return Err("Shell command timed out; retirement remains uncertain".into());
        }
        self.retirement.require_verified()
    }
}

const SHELL_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
/// Far above what the transcript keeps; only bounds the reply to the webview.
const SHELL_COMMAND_MAX_OUTPUT: usize = 512 * 1024;

/// Run a command line the user typed, in the user's shell, and return what it
/// printed. Unlike `harness_exec` this runs arbitrary input by design: the
/// composer's `!command` is the user's own terminal line.
/// `profile` is a terminal profile id (see `terminal_profiles`); without one,
/// or when that shell is gone, the default profile runs it.
#[tauri::command]
pub async fn run_shell_command(
    app: AppHandle,
    cwd: String,
    command: String,
    profile: Option<String>,
) -> Result<ShellCommandOutput, String> {
    if command.trim().is_empty() || command.contains('\0') {
        return Err("Enter a command to run".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let activity_root = crate::session_folder::resolve_session_cwd(&cwd);
        let mut activity = if exact_workspace_activity_enabled(&app, &activity_root) {
            crate::native_workspace::Activity::start(&app, &activity_root, "shell", None)?
        } else {
            None
        };
        if let Some(activity) = activity.as_mut() {
            activity.started();
        }
        let output = run_shell_command_sync(&cwd, &command, profile.as_deref());
        if output
            .as_ref()
            .is_ok_and(|result| result.require_activity_retirement().is_ok())
        {
            if let Some(activity) = activity {
                let _ = activity.settled();
            }
        }
        output
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run_shell_command_sync(
    cwd: &str,
    command: &str,
    profile: Option<&str>,
) -> Result<ShellCommandOutput, String> {
    let shell = crate::terminal_profiles::resolve(profile)
        .ok_or_else(|| "No shell was found on this computer".to_string())?;
    let mut cmd = crate::terminal_profiles::command_for(&shell, command);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_gui_child(&mut cmd);
    let workdir = crate::session_folder::resolve_session_cwd(cwd);
    if !workdir.is_dir() {
        return Err(format!("{}: No such directory", workdir.display()));
    }
    cmd.current_dir(workdir);

    let rx = spawn_output_wait(&mut cmd).map_err(|e| format!("Failed to run the command: {e}"))?;
    let (result, timed_out) = match rx.recv_timeout(SHELL_COMMAND_TIMEOUT) {
        Ok(result) => (Some(result), false),
        Err(_) => {
            rx.stop_and_drain();
            // The killed process still hands back what it printed so far.
            (rx.recv_timeout(KILL_ESCALATE * 2).ok(), true)
        }
    };
    let output = match result {
        Some(Ok(output)) => output,
        Some(Err(e)) => return Err(format!("Failed to run the command: {e}")),
        None => {
            return Ok(ShellCommandOutput {
                output: String::new(),
                exit_code: None,
                timed_out,
                retirement: rx.owner.retirement(),
            })
        }
    };
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    if text.len() > SHELL_COMMAND_MAX_OUTPUT {
        // Keep the end, where a failing command says why.
        let mut start = text.len() - SHELL_COMMAND_MAX_OUTPUT;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        text = text[start..].to_string();
    }
    Ok(ShellCommandOutput {
        output: text,
        exit_code: if timed_out {
            None
        } else {
            output.status.code()
        },
        timed_out,
        retirement: rx.owner.retirement(),
    })
}

#[cfg(test)]
mod shell_command_tests {
    use super::*;

    #[test]
    fn exec_timeout_retains_both_diagnostic_streams() {
        let mut cmd = if cfg!(windows) {
            let mut command = Command::new("cmd.exe");
            command.args([
                "/D",
                "/C",
                "echo checking & echo download-stalled 1>&2 & ping -n 30 127.0.0.1 >nul",
            ]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "echo checking; echo download-stalled >&2; sleep 30"]);
            command
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        isolate_child(&mut cmd);
        let started = Instant::now();
        let error = exec_command_output(cmd, "test updater", Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("timed out after 1 seconds"), "{error}");
        assert!(error.contains("checking"), "{error}");
        assert!(error.contains("download-stalled"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn codex_mcp_auth_keeps_only_names_and_status() {
        let parsed = parse_codex_mcp_auth(
            r#"[{"name":"cloudflare","transport":{"env":{"TOKEN":"secret"}},"auth_status":"o_auth"},
                {"name":"arc","auth_status":"not_logged_in"},{"auth_status":"o_auth"}]"#,
        )
        .unwrap();
        let json = serde_json::to_string(&parsed).unwrap();
        assert_eq!(
            json,
            r#"[{"name":"cloudflare","authStatus":"o_auth"},{"name":"arc","authStatus":"not_logged_in"}]"#
        );
        assert!(parse_codex_mcp_auth("not json").is_err());
    }

    #[test]
    fn gui_path_deduplicates_login_and_inherited_directories_without_reordering() {
        let first = PathBuf::from("first-bin");
        let second = PathBuf::from("second-bin");
        let login = std::env::join_paths([&first, &second])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let inherited = std::env::join_paths([&second, &first])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let path = gui_search_path_from(Some(login), None, Some(inherited));
        let parts = std::env::split_paths(&path).collect::<Vec<_>>();
        assert_eq!(&parts[..2], &[first.clone(), second.clone()]);
        assert_eq!(parts.iter().filter(|part| **part == first).count(), 1);
        assert_eq!(parts.iter().filter(|part| **part == second).count(), 1);
    }

    #[test]
    fn partial_read_keeps_lines_printed_before_timeout() {
        let (command, args): (&str, Vec<String>) = if cfg!(windows) {
            (
                "cmd.exe",
                [
                    "/D",
                    "/C",
                    "echo arc: https://x - ! Needs authentication & ping -n 30 127.0.0.1 >nul",
                ]
                .map(String::from)
                .to_vec(),
            )
        } else {
            (
                "sh",
                [
                    "-c",
                    "echo 'arc: https://x - ! Needs authentication'; sleep 30",
                ]
                .map(String::from)
                .to_vec(),
            )
        };
        let started = Instant::now();
        let (output, timed_out) =
            exec_output_read_partial(command, &args, None, Duration::from_secs(1)).unwrap();
        assert!(timed_out, "unexpected early exit: status={}, stdout={:?}, stderr={:?}, gui_path_length={}, contains_system32={}", output.status, String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr), gui_search_path().len(), gui_search_path().to_ascii_lowercase().contains("system32"));
        assert!(String::from_utf8_lossy(&output.stdout).contains("arc: https://x"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    fn cwd() -> String {
        std::env::temp_dir().to_string_lossy().into_owned()
    }

    #[test]
    fn returns_output_and_exit_code() {
        let ran = run_shell_command_sync(&cwd(), "echo hello", None).unwrap();
        assert_eq!(ran.output.trim(), "hello");
        assert_eq!(ran.exit_code, Some(0));
        assert!(!ran.timed_out);
    }

    #[test]
    fn reports_a_failing_exit_code() {
        let ran = run_shell_command_sync(&cwd(), "exit 3", None).unwrap();
        assert_eq!(ran.exit_code, Some(3));
    }

    #[test]
    fn rejects_a_missing_working_directory() {
        assert!(run_shell_command_sync("/no/such/bycoda/dir", "echo hi", None).is_err());
    }

    #[test]
    fn runs_bash_commands_in_git_bash_from_the_working_directory() {
        let Some(bash) = crate::terminal_profiles::resolve(Some("git-bash"))
            .filter(|profile| profile.id == "git-bash")
        else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("bycoda-git-bash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("marker.txt"), "x").unwrap();
        let ran = run_shell_command_sync(
            &dir.to_string_lossy(),
            "ls | grep marker && echo $((2 + 3))",
            Some(&bash.id),
        )
        .unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(ran.exit_code, Some(0), "{}", ran.output);
        assert!(ran.output.contains("marker.txt"), "{}", ran.output);
        assert!(ran.output.contains('5'), "{}", ran.output);
    }
}

const KILL_ESCALATE: Duration = Duration::from_secs(2);
/// Quit and `Drop` cannot wait on a detached escalate thread — the process
/// exits first and isolated harness groups stay behind as PID-1 orphans.
#[cfg(not(windows))]
const KILL_ALL_GRACE: Duration = Duration::from_millis(300);
#[cfg(not(windows))]
const KILL_ALL_KILL_WAIT: Duration = Duration::from_millis(150);
const HARNESS_PARENT_ENV: &str = "BYCODA_HARNESS_PARENT";

/// An interactive shell has to source the user's whole rc file; nvm alone can
/// take a second.
#[cfg(not(windows))]
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// A spawn that was cancelled mid-fork. The session it was starting is already
/// gone or already replaced, so callers must not register this child.
const SPAWN_CANCELLED: &str = "Harness start was cancelled";

/// Its own process group, so one signal reaches the whole tree, plus the
/// marker a later launch reads to recognise what this run left behind. Every
/// harness spawn goes through here, probes included: a `--help` probe that
/// hangs is a `node` process too, and an unmarked one is unreapable.
fn isolate_child(cmd: &mut Command) {
    cmd.env(HARNESS_PARENT_ENV, std::process::id().to_string());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = cmd;
    }
}

/// Linux refuses to `execve` a file that any process holds open for writing,
/// and whether one does is not ours to decide: a sibling thread's spawn
/// inherits our write handles for the moment before it execs its own program.
/// So a binary written seconds ago — a CLI mid-upgrade, or a `--version` probe
/// of a path the user just pointed us at — can be briefly unrunnable rather
/// than wrong, and reporting it as invalid is the wrong answer.
#[cfg(unix)]
fn spawn_retrying_text_file_busy(cmd: &mut Command) -> std::io::Result<std::process::Child> {
    const ATTEMPTS: u32 = 4;
    for attempt in 1..ATTEMPTS {
        match cmd.spawn() {
            Err(e) if is_text_file_busy(&e) => thread::sleep(Duration::from_millis(20) * attempt),
            settled => return settled,
        }
    }
    cmd.spawn()
}

#[cfg(test)]
mod managed_retirement_tests {
    use super::*;

    fn sleeping_command() -> Command {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("ping");
            command.args(["-n", "60", "127.0.0.1"]);
            command
        } else {
            let mut command = Command::new("sleep");
            command.arg("60");
            command
        };
        prepare_gui_child(&mut command);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    #[test]
    fn lightweight_retirement_tracks_actual_process_without_host_activity() {
        let host = Arc::new(HarnessHost::new());
        let (epoch, kill_all, _) = host.begin_spawn("lightweight");
        let (mut child, exit) = host
            .spawn_tracked("lightweight", epoch, kill_all, &mut sleeping_command())
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let (output, process) = host.output.begin_process(
            OutputSource::fixture("lightweight"),
            child,
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        output.reader(0).finish(true, false);
        output.reader(1).finish(true, false);
        let live = Arc::new(LiveChild {
            cwd: std::env::temp_dir(),
            stdin: Mutex::new(stdin),
            pid: process.id(),
            construction_id: output.epoch().into(),
            issuer: None,
            _control_turn: None,
            native_session_capability: None,
            native_process_purpose: None,
            management_input_policy: None,
            management_route_id: None,
            utility_executable: None,
            utility_endpoint: None,
            account: None,
            owners: Arc::new(Owners::default()),
            output: Some(output.clone()),
            process: Some(process.clone()),
            exit: Some(exit.clone()),
            writers: WriteGate::new(),
            order: WriteOrder::new(),
        });
        assert!(host
            .install_spawn("lightweight".into(), epoch, kill_all, live)
            .is_none());
        assert!(exit.wait(Duration::from_millis(1)).is_err());
        let waiter = thread::spawn(move || {
            exit.finish(
                process
                    .wait(&output, false)
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
            );
        });
        host.retire_managed_session("lightweight").unwrap();
        waiter.join().unwrap();
        assert!(host.get("lightweight").is_none());
        assert!(!host.lock_inner().managed_exits.contains_key("lightweight"));
        host.retire_managed_session("lightweight").unwrap();
        // An already admitted spawn may not create a process after transfer.
        assert_eq!(
            host.spawn_tracked("lightweight", epoch, kill_all, &mut sleeping_command())
                .err()
                .unwrap(),
            SPAWN_CANCELLED
        );
    }

    #[test]
    fn lightweight_spawn_prunes_settled_older_process_receipts_and_keeps_pending() {
        let host = HarnessHost::new();
        let success = Arc::new(ManagedProviderExit::default());
        success.finish(Ok(()));
        let failed = Arc::new(ManagedProviderExit::default());
        failed.finish(Err("Process retirement outcome is unknown".into()));
        let pending = Arc::new(ManagedProviderExit::default());
        host.lock_inner().managed_exits.insert(
            "lightweight".into(),
            vec![success, Arc::clone(&failed), Arc::clone(&pending)],
        );
        let (epoch, kill_all, _) = host.begin_spawn("lightweight");
        let (mut child, exit) = host
            .spawn_tracked("lightweight", epoch, kill_all, &mut sleeping_command())
            .unwrap();
        {
            let inner = host.lock_inner();
            let receipts = &inner.managed_exits["lightweight"];
            // Only successful retirement is pruned; uncertain exits remain owned.
            assert_eq!(receipts.len(), 3);
            assert!(receipts.iter().any(|entry| Arc::ptr_eq(entry, &failed)));
            assert!(receipts.iter().any(|entry| Arc::ptr_eq(entry, &pending)));
        }
        terminate(child.id());
        exit.finish(child.wait().map(|_| ()).map_err(|e| e.to_string()));
    }

    #[test]
    fn managed_retirement_waits_for_process_exit_and_host_activity_ack() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("ping");
            command.args(["-n", "60", "127.0.0.1"]);
            command
        } else {
            let mut command = Command::new("sleep");
            command.arg("60");
            command
        };
        prepare_gui_child(&mut command);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let host = Arc::new(HarnessHost::new());
        let (epoch, kill_all, _) = host.begin_spawn("managed");
        let exit = Arc::new(ManagedProviderExit::default());
        host.lock_inner()
            .managed_exits
            .insert("managed".into(), vec![Arc::clone(&exit)]);
        let stdin = child.stdin.take().unwrap();
        let (output, process) = host.output.begin_process(
            OutputSource::fixture("managed"),
            child,
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        output.reader(0).finish(true, false);
        output.reader(1).finish(true, false);
        let live = Arc::new(LiveChild {
            cwd: std::env::temp_dir(),
            stdin: Mutex::new(stdin),
            pid: process.id(),
            construction_id: output.epoch().into(),
            issuer: None,
            _control_turn: None,
            native_session_capability: None,
            native_process_purpose: None,
            management_input_policy: None,
            management_route_id: None,
            utility_executable: None,
            utility_endpoint: None,
            account: None,
            owners: Arc::new(Owners::default()),
            output: Some(output.clone()),
            process: Some(process.clone()),
            exit: Some(exit.clone()),
            writers: WriteGate::new(),
            order: WriteOrder::new(),
        });
        assert!(host
            .install_spawn("managed".into(), epoch, kill_all, live)
            .is_none());
        let (exited, process_exit) = mpsc::channel();
        let (ack, host_ack) = mpsc::channel();
        let waiter = thread::spawn(move || {
            let result = process
                .wait(&output, false)
                .map(|_| ())
                .map_err(|e| e.to_string());
            exited.send(()).unwrap();
            // Model an activity-release RPC still waiting for its durable receipt.
            host_ack.recv_timeout(Duration::from_secs(5)).unwrap();
            exit.finish(result);
        });
        let retiring = Arc::clone(&host);
        let (finished, completion) = mpsc::channel();
        let retirement = thread::spawn(move || {
            finished
                .send(retiring.retire_managed_session("managed"))
                .unwrap();
        });
        process_exit.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(matches!(
            completion.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        ack.send(()).unwrap();
        completion
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        waiter.join().unwrap();
        retirement.join().unwrap();
        assert!(host.get("managed").is_none());
        assert!(!host.lock_inner().managed_exits.contains_key("managed"));
    }

    #[test]
    fn managed_retirement_consumes_failed_exit_best_effort() {
        let host = HarnessHost::new();
        let exit = Arc::new(ManagedProviderExit::default());
        exit.finish(Err("Host activity release outcome is unknown".into()));
        host.lock_inner()
            .managed_exits
            .insert("managed".into(), vec![exit]);
        // Unknown retirement cannot authorize a checkpoint while a writer may remain.
        assert!(host.retire_managed_session("managed").is_err());
        assert!(host.lock_inner().managed_exits.contains_key("managed"));
        assert!(host.retire_managed_session("managed").is_err());
    }
}

#[cfg(unix)]
fn is_text_file_busy(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::ETXTBSY)
}

#[cfg(test)]
fn terminate(pid: u32) {
    terminate_after(pid, KILL_ESCALATE);
}

#[cfg(test)]
fn terminate_after(pid: u32, escalate: Duration) {
    if pid == 0 || pid == 1 {
        return;
    }
    #[cfg(windows)]
    {
        let _ = escalate;
        signal_tree(pid, TreeSignal::Kill);
    }
    #[cfg(not(windows))]
    {
        signal_tree(pid, TreeSignal::Term);
        thread::spawn(move || {
            thread::sleep(escalate);
            if tree_alive(pid) {
                signal_tree(pid, TreeSignal::Kill);
            }
        });
    }
}

/// SIGTERM every tree, then SIGKILL whatever is still standing, before return.
pub(crate) fn terminate_all(pids: &[u32]) {
    let pids: Vec<u32> = pids.iter().copied().filter(|pid| *pid > 1).collect();
    #[cfg(windows)]
    taskkill_trees_until(&pids, Instant::now() + WINDOWS_KILL_DEADLINE);
    #[cfg(not(windows))]
    {
        if pids.is_empty() {
            return;
        }
        for pid in &pids {
            signal_tree(*pid, TreeSignal::Term);
        }
        wait_until_dead(&pids, Instant::now() + KILL_ALL_GRACE);
        let remaining: Vec<u32> = pids
            .iter()
            .copied()
            .filter(|pid| tree_alive(*pid))
            .collect();
        if remaining.is_empty() {
            return;
        }
        for pid in &remaining {
            signal_tree(*pid, TreeSignal::Kill);
        }
        wait_until_dead(&remaining, Instant::now() + KILL_ALL_KILL_WAIT);
    }
}

/// Upper bound on the Windows tree kill. Past it, the taskkill helpers are
/// abandoned so quit and window teardown never wait on a wedged process.
#[cfg(windows)]
const WINDOWS_KILL_DEADLINE: Duration = Duration::from_secs(3);

/// Starts `taskkill /T /F` for every pid at once, then waits for all of them
/// together. Waiting per pid cost ~0.2 s each, so 27 ConPTY shells stalled the
/// caller for seconds.
#[cfg(windows)]
fn taskkill_trees_until(pids: &[u32], deadline: Instant) {
    let children: Vec<std::process::Child> = pids
        .iter()
        .filter_map(|pid| {
            let mut cmd = Command::new("taskkill");
            crate::hide_window_console(&mut cmd);
            cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok()
        })
        .collect();
    wait_children_until(children, deadline);
}

/// Polls all children together until each exits or `deadline` passes, then
/// kills and reaps the stragglers. Returns how many had to be killed.
#[cfg(any(windows, test))]
fn wait_children_until(mut children: Vec<std::process::Child>, deadline: Instant) -> usize {
    while !children.is_empty() {
        children.retain_mut(|child| matches!(child.try_wait(), Ok(None)));
        if children.is_empty() || Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let stragglers = children.len();
    for child in &mut children {
        let _ = child.kill();
        let _ = child.wait();
    }
    stragglers
}

#[cfg(test)]
mod wait_children_tests {
    use super::*;

    fn long_sleeper() -> std::process::Child {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("ping");
            cmd.args(["-n", "60", "127.0.0.1"]);
            cmd
        } else {
            let mut cmd = Command::new("sleep");
            cmd.arg("60");
            cmd
        };
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleeper")
    }

    fn quick_exit() -> std::process::Child {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "exit 0"]);
            cmd
        } else {
            Command::new("true")
        };
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn quick exit")
    }

    #[test]
    fn wait_children_until_kills_every_straggler_at_the_deadline() {
        let children: Vec<_> = (0..4).map(|_| long_sleeper()).collect();
        let started = Instant::now();
        let killed = wait_children_until(children, started + Duration::from_millis(300));
        assert_eq!(killed, 4, "all four sleepers outlive the deadline");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "waiting must stop at the deadline, not on the children"
        );
    }

    #[test]
    fn wait_children_until_returns_once_children_exit() {
        let children: Vec<_> = (0..4).map(|_| quick_exit()).collect();
        let started = Instant::now();
        let killed = wait_children_until(children, started + Duration::from_secs(20));
        assert_eq!(killed, 0, "quick exits are reaped, not killed");
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}

/// The thread that owns each `Child` reaps it, so a killed leader stops
/// answering `kill(pid, 0)` within a poll or two. Reaping here instead would
/// race that thread for the exit status and free the pid while we still signal
/// it.
#[cfg(not(windows))]
fn wait_until_dead(pids: &[u32], until: Instant) {
    while Instant::now() < until {
        if pids.iter().all(|pid| !tree_alive(*pid)) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(any(not(windows), test))]
enum TreeSignal {
    #[cfg(not(windows))]
    Term,
    Kill,
}

#[cfg(any(not(windows), test))]
fn signal_tree(pid: u32, signal: TreeSignal) {
    #[cfg(unix)]
    {
        let sig = match signal {
            TreeSignal::Term => libc::SIGTERM,
            TreeSignal::Kill => libc::SIGKILL,
        };
        let ipid = pid as i32;
        unsafe {
            // Every child is isolated with process_group(0), so its pid is the
            // stable group id even after the leader exits. Signal the group
            // first; looking it up through a dead leader loses descendants
            // that ignored SIGTERM and prevents the SIGKILL escalation.
            libc::kill(-ipid, sig);
            libc::kill(ipid, sig);
        }
    }
    #[cfg(windows)]
    {
        let _ = signal;
        let mut cmd = Command::new("taskkill");
        crate::hide_window_console(&mut cmd);
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cmd.status();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = signal;
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

#[cfg(not(windows))]
fn tree_alive(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        proc_group_running(pid as i32)
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let ipid = pid as i32;
        unsafe { libc::kill(ipid, 0) == 0 || libc::kill(-ipid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// Linux liveness from procfs. A zombie has exited and runs nothing, but
/// `kill(2)` still reports it, so an orphan that an init which never reaps
/// (common in containers) leaves behind would look like a live tree.
#[cfg(target_os = "linux")]
fn proc_group_running(pid: i32) -> bool {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return unsafe { libc::kill(pid, 0) == 0 || libc::kill(-pid, 0) == 0 };
    };
    entries.flatten().any(|entry| {
        let Some(member) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<i32>().ok())
        else {
            return false;
        };
        let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
            return false;
        };
        // Fields after the parenthesised command name: state, ppid, pgrp.
        let Some((_, rest)) = stat.rsplit_once(')') else {
            return false;
        };
        let mut fields = rest.split_whitespace();
        let state = fields.next().unwrap_or("Z");
        let group = fields.nth(1).and_then(|field| field.parse::<i32>().ok());
        !matches!(state, "Z" | "X") && (member == pid || group == Some(pid))
    })
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

#[cfg(any(unix, test))]
#[derive(Debug, Clone)]
struct ProcessSnapshot {
    pid: u32,
    ppid: u32,
    args: String,
    harness_parent: Option<u32>,
}

/// Kill harness trees left behind by a previous Bycoda that exited
/// before SIGKILL ran (crash, force-quit, or the detached escalate thread).
/// Off-thread: the sweep shells out to `ps` and then waits on a SIGKILL, and
/// launch would otherwise hold the first window for both. Nothing this run
/// spawns can be caught by it — our own children carry our pid as the marker.
pub(crate) fn reap_orphaned_harness_processes() {
    #[cfg(unix)]
    {
        let our_pid = std::process::id();
        thread::spawn(move || reap_snapshots(&snapshot_processes(), our_pid));
    }
}

#[cfg(unix)]
fn reap_snapshots(rows: &[ProcessSnapshot], our_pid: u32) {
    let pids: Vec<u32> = rows
        .iter()
        .filter(|row| should_reap_process(row, our_pid, process_alive))
        .map(|row| row.pid)
        .collect();
    terminate_all(&pids);
}

#[cfg(any(unix, test))]
fn should_reap_process(
    proc: &ProcessSnapshot,
    our_pid: u32,
    parent_alive: impl Fn(u32) -> bool,
) -> bool {
    if proc.pid == our_pid || proc.pid <= 1 || proc.ppid == our_pid {
        return false;
    }
    if let Some(parent) = proc.harness_parent {
        return looks_like_harness_argv(&proc.args) && parent != our_pid && !parent_alive(parent);
    }
    proc.ppid == 1 && is_legacy_orphaned_cursor_acp(&proc.args)
}

/// Pre-marker leftovers: `cursor-agent acp` reparented to launchd.
#[cfg(any(unix, test))]
fn is_legacy_orphaned_cursor_acp(args: &str) -> bool {
    if !args.contains("cursor-agent") {
        return false;
    }
    args.split_whitespace().any(|part| part == "acp")
}

/// Argv of an agent CLI we spawned — not a shell, tmux, or `npm start`.
/// Used to decide whose environment is worth opening; the marker still
/// decides what actually dies.
#[cfg(any(unix, test))]
fn looks_like_harness_argv(args: &str) -> bool {
    if is_legacy_orphaned_cursor_acp(args) {
        return true;
    }
    args.split_whitespace().any(is_harness_argv_token)
}

#[cfg(any(unix, test))]
fn is_harness_argv_token(part: &str) -> bool {
    let name = Path::new(part)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(part);
    matches!(
        name,
        "cursor-agent"
            | "pi-coding-agent"
            | "claude"
            | "codex"
            | "opencode"
            | "grok"
            | "omp"
            | "fx"
            | "hermes"
            | "agy_acp_server.par"
            | "pi"
            | "worker-server"
            | "app-server"
    )
}

#[cfg(any(all(unix, not(target_os = "linux")), test))]
fn parse_ps_row(line: &str) -> Option<ProcessSnapshot> {
    let s = line.trim();
    let pid_end = s.find(char::is_whitespace)?;
    let pid: u32 = s[..pid_end].parse().ok()?;
    let rest = s[pid_end..].trim_start();
    let ppid_end = rest.find(char::is_whitespace)?;
    let ppid: u32 = rest[..ppid_end].parse().ok()?;
    let args = rest[ppid_end..].trim_start();
    if args.is_empty() {
        return None;
    }
    Some(ProcessSnapshot {
        pid,
        ppid,
        args: args.to_string(),
        harness_parent: harness_parent_from_bytes(args.as_bytes()),
    })
}

#[cfg(any(unix, test))]
fn harness_parent_from_bytes(buf: &[u8]) -> Option<u32> {
    let mut needle = Vec::with_capacity(HARNESS_PARENT_ENV.len() + 1);
    needle.extend_from_slice(HARNESS_PARENT_ENV.as_bytes());
    needle.push(b'=');
    let pos = buf
        .windows(needle.len())
        .position(|chunk| chunk == needle)?;
    let start = pos + needle.len();
    let digits = buf[start..]
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .count();
    std::str::from_utf8(&buf[start..start + digits])
        .ok()?
        .parse()
        .ok()
}

/// List processes by argv, then open environ only for agent CLIs. Linux
/// orphans sit under `systemd --user`, not pid 1, so the marker (not ppid)
/// is what identifies them.
#[cfg(unix)]
fn snapshot_processes() -> Vec<ProcessSnapshot> {
    #[cfg(target_os = "linux")]
    {
        snapshot_from_proc()
    }
    #[cfg(not(target_os = "linux"))]
    {
        snapshot_from_ps()
    }
}

/// `ps -E`/`-e` dumps every process environment; skip that. List argv only,
/// then open environ for agent CLIs. Linux orphans sit under `systemd --user`,
/// not pid 1, so the marker (not ppid) is what identifies them.
#[cfg(all(unix, not(target_os = "linux")))]
fn snapshot_from_ps() -> Vec<ProcessSnapshot> {
    let mut cmd = Command::new("ps");
    #[cfg(target_os = "macos")]
    {
        cmd.args(["-axww", "-o", "pid=", "-o", "ppid=", "-o", "command="]);
    }
    #[cfg(not(target_os = "macos"))]
    {
        cmd.args(["-axww", "-o", "pid=", "-o", "ppid=", "-o", "args="]);
    }
    let Ok(output) = cmd.output() else {
        return Vec::new();
    };
    let mut rows: Vec<ProcessSnapshot> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_ps_row)
        .collect();
    attach_markers_from_env(&mut rows);
    rows
}

#[cfg(target_os = "linux")]
fn snapshot_from_proc() -> Vec<ProcessSnapshot> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut rows: Vec<ProcessSnapshot> = entries
        .flatten()
        .filter_map(|entry| {
            let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
            let dir = entry.path();
            let cmdline = std::fs::read(dir.join("cmdline")).ok()?;
            if cmdline.is_empty() {
                return None;
            }
            Some(ProcessSnapshot {
                pid,
                ppid: proc_ppid(&dir)?,
                args: String::from_utf8_lossy(&cmdline).replace('\0', " "),
                harness_parent: None,
            })
        })
        .collect();
    attach_markers_from_env(&mut rows);
    rows
}

#[cfg(unix)]
fn attach_markers_from_env(rows: &mut [ProcessSnapshot]) {
    let pids: Vec<u32> = rows
        .iter()
        .filter(|row| row.harness_parent.is_none() && looks_like_harness_argv(&row.args))
        .map(|row| row.pid)
        .collect();
    if pids.is_empty() {
        return;
    }
    let parents = read_harness_parents(&pids);
    for row in rows {
        if row.harness_parent.is_some() {
            continue;
        }
        if let Some(parent) = parents.get(&row.pid).copied() {
            row.harness_parent = Some(parent);
        }
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
fn read_harness_parents(pids: &[u32]) -> HashMap<u32, u32> {
    let mut found = HashMap::new();
    if pids.is_empty() {
        return found;
    }
    let list = pids
        .iter()
        .map(|pid| pid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut cmd = Command::new("ps");
    #[cfg(target_os = "macos")]
    {
        cmd.args(["-Eww", "-p", &list, "-o", "pid=", "-o", "command="]);
    }
    #[cfg(not(target_os = "macos"))]
    {
        cmd.args(["-eww", "-p", &list, "-o", "pid=", "-o", "args="]);
    }
    let Ok(output) = cmd.output() else {
        return found;
    };
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid, command)) = parse_ps_pid_command(line) else {
            continue;
        };
        if let Some(parent) = harness_parent_from_bytes(command.as_bytes()) {
            found.insert(pid, parent);
        }
    }
    found
}

#[cfg(any(all(unix, not(target_os = "linux")), test))]
fn parse_ps_pid_command(line: &str) -> Option<(u32, String)> {
    let s = line.trim();
    let pid_end = s.find(char::is_whitespace)?;
    let pid: u32 = s[..pid_end].parse().ok()?;
    let command = s[pid_end..].trim_start();
    if command.is_empty() {
        return None;
    }
    Some((pid, command.to_string()))
}

#[cfg(target_os = "linux")]
fn read_harness_parents(pids: &[u32]) -> HashMap<u32, u32> {
    pids.iter()
        .filter_map(|pid| {
            let buf = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
            Some((*pid, harness_parent_from_bytes(&buf)?))
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn proc_ppid(dir: &Path) -> Option<u32> {
    parse_proc_ppid(&std::fs::read_to_string(dir.join("stat")).ok()?)
}

/// Field 4 of `stat`, counted from the last closing paren: `comm` is unquoted
/// and can hold spaces and parens of its own.
#[cfg(any(target_os = "linux", test))]
fn parse_proc_ppid(stat: &str) -> Option<u32> {
    stat.get(stat.rfind(')')? + 1..)?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

fn resolve_cursor_agent() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Stable shims first. `command -v` often returns a versioned path
    // (`…/versions/<build>/cursor-agent`); macOS TCC then treats each
    // upgrade as a new binary.
    if let Some(home) = &home {
        candidates.push(home.join(".local/bin/cursor-agent"));
        candidates.push(home.join(".local/bin/agent"));
        candidates.push(home.join(".cargo/bin/cursor-agent"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/cursor-agent"));
    candidates.push(PathBuf::from("/usr/local/bin/cursor-agent"));
    candidates.push(PathBuf::from("/usr/bin/cursor-agent"));
    candidates.push(PathBuf::from("/snap/bin/cursor-agent"));
    if let Some(from_shell) = which_via_login_shell("cursor-agent") {
        candidates.push(from_shell);
    }

    first_binary_matching(candidates, is_cursor_agent)
}

fn resolve_harness_binary_default(provider: &str) -> Option<PathBuf> {
    match provider {
        "claude" => resolve_claude(),
        "codex" => resolve_codex(),
        "cursor" => resolve_cursor_agent(),
        "grok" => resolve_grok(),
        "opencode" => resolve_opencode(),
        "pi" => resolve_pi(),
        "omp" => resolve_omp(),
        "fx" => resolve_fx(),
        "hermes" => resolve_hermes(),
        "antigravity" => resolve_antigravity(),
        _ => None,
    }
}

const MAX_CONFIGURED_BINARY_VALIDATIONS: usize = 32;
type ConfiguredBinaryValidation = (String, PathBuf);
type ConfiguredBinaryValidationCache = HashMap<(String, String), ConfiguredBinaryValidation>;

static CONFIGURED_BINARY_VALIDATIONS: OnceLock<Mutex<ConfiguredBinaryValidationCache>> =
    OnceLock::new();

fn configured_binary_fingerprint(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(format!(
            "{}:{}:{}:{:?}",
            metadata.len(),
            metadata.dev(),
            metadata.ino(),
            metadata.modified().ok()
        ))
    }
    #[cfg(not(unix))]
    {
        Some(format!("{}:{:?}", metadata.len(), metadata.modified().ok()))
    }
}

fn resolve_harness_binary_override(provider: &str, binary_path: &str) -> Result<PathBuf, String> {
    let names: &[&str] = match provider {
        "claude" => &["claude"],
        "codex" => &["codex"],
        "cursor" => &["cursor-agent", "agent"],
        "grok" => &["grok"],
        "opencode" => &["opencode"],
        "pi" => &["pi", "pi-coding-agent"],
        "omp" => &["omp"],
        "fx" => &["fx"],
        "hermes" => &["hermes"],
        "antigravity" if cfg!(windows) => &["agy_acp_server", "agy"],
        "antigravity" => &["agy_acp_server.par", "agy"],
        _ => {
            return Err(format!(
                "Unsupported configured harness provider: {provider}"
            ))
        }
    };
    let path = resolve_configured_harness_binary(binary_path, provider, names)?;
    let fingerprint = configured_binary_fingerprint(&path);
    let key = (provider.to_string(), binary_path.to_string());
    let cache = CONFIGURED_BINARY_VALIDATIONS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(fingerprint) = fingerprint.as_deref() {
        if let Ok(cache) = cache.lock() {
            if cache
                .get(&key)
                .is_some_and(|(cached, _)| Some(cached.as_str()) == Some(fingerprint))
            {
                return Ok(path);
            }
        }
    }
    validate_configured_harness_binary_identity(provider, &path, binary_path)?;
    validate_harness_binary_version(provider, &path)?;
    if let Some(fingerprint) = fingerprint {
        if let Ok(mut cache) = cache.lock() {
            if cache.len() >= MAX_CONFIGURED_BINARY_VALIDATIONS {
                if let Some(oldest) = cache.keys().next().cloned() {
                    cache.remove(&oldest);
                }
            }
            cache.insert(key, (fingerprint, path.clone()));
        }
    }
    Ok(path)
}

fn is_supported_harness_version(version: &str) -> bool {
    version.split_whitespace().any(|token| {
        let token = token
            .strip_prefix('v')
            .or_else(|| token.strip_prefix('V'))
            .unwrap_or(token);
        let (version, build) = match token.split_once('-') {
            Some((version, build)) => (version, Some(build)),
            None => (token, None),
        };
        let mut parts = version.split('.');
        let digits = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit());
        let valid = parts.next().is_some_and(digits)
            && parts.next().is_some_and(digits)
            && parts.next().is_some_and(digits)
            && parts.next().is_none();
        let valid_build = build.is_none_or(|build| {
            !build.is_empty()
                && build
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
        });
        valid && valid_build
    })
}

fn validate_harness_binary_version(provider: &str, path: &Path) -> Result<(), String> {
    if provider == "antigravity" {
        return Ok(());
    }
    let version = exec_capture_read(&path.to_string_lossy(), &["--version".to_string()], None)?;
    let lower = version.to_ascii_lowercase();
    let has_version = is_supported_harness_version(&version);
    let provider_marker = match provider {
        "claude" => lower.contains("claude"),
        "codex" => lower.contains("codex"),
        "hermes" => lower.contains("hermes"),
        _ => true,
    };
    if has_version && provider_marker {
        Ok(())
    } else {
        Err(format!(
            "Configured {provider} binary returned an invalid version."
        ))
    }
}

fn resolve_configured_harness_binary(
    binary_path: &str,
    provider: &str,
    names: &[&str],
) -> Result<PathBuf, String> {
    let binary_path = binary_path.trim();
    if binary_path.is_empty() {
        return Err(format!("Configured {provider} binary path is empty."));
    }
    if binary_path.contains('\0') {
        return Err(format!("Invalid configured {provider} binary path."));
    }
    if !Path::new(binary_path).is_absolute() {
        return Err(format!(
            "Configured {provider} binary path must be absolute."
        ));
    }
    let path = existing_binary(expand_home(binary_path))
        .ok_or_else(|| format!("Configured {provider} binary is not executable: {binary_path}"))?;
    if !names
        .iter()
        .any(|name| configured_binary_name_eq(&path, name))
    {
        return Err(format!(
            "Configured path is not a {provider} binary: {binary_path}"
        ));
    }
    Ok(path)
}

fn validate_configured_harness_binary_identity(
    provider: &str,
    path: &Path,
    binary_path: &str,
) -> Result<(), String> {
    let identity_valid = match provider {
        "cursor" => is_cursor_agent(path),
        "pi" => is_pi_coding_agent(path),
        "omp" => is_omp_agent(path),
        "fx" => is_fx_agent(path),
        "grok" => is_grok_agent(path),
        _ => true,
    };
    if identity_valid {
        Ok(())
    } else {
        Err(format!(
            "Configured path is not a valid {provider} binary: {binary_path}"
        ))
    }
}

fn resolve_codex() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    first_binary(codex_candidates(
        home.as_deref(),
        which_via_login_shell("codex"),
    ))
}

fn codex_candidates(home: Option<&Path>, from_shell: Option<PathBuf>) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // The user's login shell selects the active installation/version.
    if let Some(from_shell) = from_shell {
        candidates.push(from_shell);
    }

    if let Some(home) = &home {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".bun/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
        candidates.push(home.join(".cargo/bin/codex"));
        candidates.push(home.join("n/bin/codex"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));
    candidates.push(PathBuf::from("/usr/bin/codex"));
    candidates.push(PathBuf::from("/snap/bin/codex"));
    // Last resort: the Codex app bundles its own CLI, but never puts it on
    // PATH. It is pinned to the app release (often a prerelease), so a real
    // CLI install always wins.
    if let Some(home) = &home {
        candidates.push(home.join("Applications/Codex.app/Contents/Resources/codex"));
    }
    candidates.push(PathBuf::from(
        "/Applications/Codex.app/Contents/Resources/codex",
    ));

    candidates
}

#[cfg(test)]
#[path = "harness/codex_discovery_tests.rs"]
mod codex_discovery_tests;

fn resolve_opencode() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(home) = &home {
        candidates.push(home.join(".opencode/bin/opencode"));
        candidates.push(home.join(".local/bin/opencode"));
        candidates.push(home.join(".npm-global/bin/opencode"));
        candidates.push(home.join(".cargo/bin/opencode"));
        candidates.push(home.join("n/bin/opencode"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/opencode"));
    candidates.push(PathBuf::from("/usr/local/bin/opencode"));
    candidates.push(PathBuf::from("/usr/bin/opencode"));
    candidates.push(PathBuf::from("/snap/bin/opencode"));
    if let Some(from_shell) = which_via_login_shell("opencode") {
        candidates.push(from_shell);
    }

    first_binary(candidates)
}

/// Prefers whatever `claude` the user's own shell resolves.
///
/// The fixed paths below are a fallback for a GUI launch that never sees the
/// shell. Trying them first picks an install the user may have long since
/// replaced: an abandoned `~/.local/bin/claude` silently wins over the one on
/// their PATH, and the app then runs a different, older CLI than the terminal
/// does — with features the newer one has simply absent.
fn resolve_claude() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(from_shell) = which_via_login_shell("claude") {
        candidates.push(from_shell);
    }
    if let Some(home) = &home {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
        candidates.push(home.join(".local/share/claude/claude"));
        candidates.push(home.join(".npm-global/bin/claude"));
        candidates.push(home.join(".cargo/bin/claude"));
        candidates.push(home.join("n/bin/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.push(PathBuf::from("/usr/bin/claude"));
    candidates.push(PathBuf::from("/snap/bin/claude"));

    first_binary(candidates)
}

fn resolve_pi() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(home) = &home {
        for name in ["pi-coding-agent", "pi"] {
            candidates.push(home.join(".local/bin").join(name));
            candidates.push(home.join(".npm-global/bin").join(name));
            candidates.push(home.join(".cargo/bin").join(name));
            candidates.push(home.join("n/bin").join(name));
        }
    }
    for name in ["pi-coding-agent", "pi"] {
        #[cfg(target_os = "macos")]
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(name));
        candidates.push(PathBuf::from("/usr/local/bin").join(name));
        candidates.push(PathBuf::from("/usr/bin").join(name));
        candidates.push(PathBuf::from("/snap/bin").join(name));
    }
    if let Some(from_shell) = which_via_login_shell("pi-coding-agent") {
        candidates.push(from_shell);
    }
    if let Some(from_shell) = which_via_login_shell("pi") {
        candidates.push(from_shell);
    }

    first_binary_matching(candidates, is_pi_coding_agent)
}

fn resolve_omp() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Installer default first, then bun/brew, then anything on the login PATH.
    if let Some(home) = &home {
        candidates.push(home.join(".local/bin/omp"));
        candidates.push(home.join(".bun/bin/omp"));
        candidates.push(home.join(".npm-global/bin/omp"));
        candidates.push(home.join(".cargo/bin/omp"));
        candidates.push(home.join("n/bin/omp"));
    }
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from("/opt/homebrew/bin/omp"));
    candidates.push(PathBuf::from("/usr/local/bin/omp"));
    candidates.push(PathBuf::from("/usr/bin/omp"));
    candidates.push(PathBuf::from("/snap/bin/omp"));
    if let Some(from_shell) = which_via_login_shell("omp") {
        candidates.push(from_shell);
    }

    first_binary_matching(candidates, is_omp_agent)
}

/// omp ships as a ~126MB compiled binary, so the cheap string scan that
/// identifies the npm-installed Pi CLI finds nothing in its Mach-O header.
/// Identify it by name plus a `--help` probe instead.
fn is_omp_agent(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if !binary_name_eq(path, "omp") {
        return false;
    }
    help_mentions_rpc_mode(path)
}

fn resolve_fx() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Installer default first so a Homebrew JSON-viewer `fx` does not win.
    if let Some(home) = &home {
        candidates.push(home.join(".local/bin/fx"));
        candidates.push(home.join(".fx/bin/fx"));
        candidates.push(home.join(".npm-global/bin/fx"));
        candidates.push(home.join(".cargo/bin/fx"));
        candidates.push(home.join("n/bin/fx"));
    }
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from("/opt/homebrew/bin/fx"));
    candidates.push(PathBuf::from("/usr/local/bin/fx"));
    candidates.push(PathBuf::from("/usr/bin/fx"));
    candidates.push(PathBuf::from("/snap/bin/fx"));
    if let Some(from_shell) = which_via_login_shell("fx") {
        candidates.push(from_shell);
    }

    first_binary_matching(candidates, is_fx_agent)
}

fn resolve_grok() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(home) = &home {
        candidates.push(home.join(".grok/bin/grok"));
        candidates.push(home.join(".local/bin/grok"));
        candidates.push(home.join(".npm-global/bin/grok"));
        candidates.push(home.join(".cargo/bin/grok"));
        candidates.push(home.join("n/bin/grok"));
    }
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from("/opt/homebrew/bin/grok"));
    candidates.push(PathBuf::from("/usr/local/bin/grok"));
    candidates.push(PathBuf::from("/usr/bin/grok"));
    candidates.push(PathBuf::from("/snap/bin/grok"));
    if let Some(from_shell) = which_via_login_shell("grok") {
        candidates.push(from_shell);
    }

    first_binary_matching(candidates, is_grok_agent)
}

fn resolve_hermes() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(home) = &home {
        // Official per-user installer, then its underlying virtualenv in case
        // the launcher symlink has not been added to PATH yet.
        candidates.push(home.join(".local/bin/hermes"));
        candidates.push(home.join(".hermes/hermes-agent/venv/bin/hermes"));
        candidates.push(home.join(".hermes/hermes-agent/.venv/bin/hermes"));
        candidates.push(home.join(".npm-global/bin/hermes"));
        candidates.push(home.join(".cargo/bin/hermes"));
        candidates.push(home.join("n/bin/hermes"));
    }
    #[cfg(windows)]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        // Native Windows installer launchers, then the underlying virtualenv.
        candidates.push(local_app_data.join("hermes/bin/hermes"));
        candidates.push(local_app_data.join("hermes/hermes-agent/venv/Scripts/hermes"));
    }
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from("/opt/homebrew/bin/hermes"));
    candidates.push(PathBuf::from("/usr/local/bin/hermes"));
    candidates.push(PathBuf::from("/usr/bin/hermes"));
    candidates.push(PathBuf::from("/snap/bin/hermes"));
    if let Some(from_shell) = which_via_login_shell("hermes") {
        candidates.push(from_shell);
    }

    first_binary(candidates)
}

/// Where the Windows installer puts `agy.exe`, then wherever PATH finds it.
fn agy_cli_candidates(local_app_data: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = local_app_data {
        candidates.push(dir.join("agy/bin/agy"));
    }
    if let Some(from_path) = which_via_login_shell("agy") {
        candidates.push(from_path);
    }
    candidates
}

fn resolve_antigravity() -> Option<PathBuf> {
    // The .par wrapper is a POSIX self-extracting archive. On Windows the
    // official ACP server (a separate download, extracted to
    // %LOCALAPPDATA%\agy-acp) is preferred when present, since it can ask for
    // approval; otherwise the agy CLI's headless stream-json mode is driven.
    if cfg!(windows) {
        let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let mut candidates = Vec::new();
        if let Some(dir) = local_app_data.as_deref() {
            candidates.push(dir.join("agy-acp/agy_acp_server"));
        }
        if let Some(from_path) = which_via_login_shell("agy_acp_server") {
            candidates.push(from_path);
        }
        candidates.extend(agy_cli_candidates(local_app_data.as_deref()));
        return first_binary(candidates);
    }
    let mut candidates = Vec::new();
    if let Some(home) = dirs_home().map(PathBuf::from) {
        // Prefer the wrapper: it sets the server's required resource directory.
        candidates.push(home.join(".local/bin/agy_acp_server.par"));
        candidates.push(home.join(".local/share/agy-acp/agy_acp_server.par"));
    }
    if let Some(from_shell) = which_via_login_shell("agy_acp_server.par") {
        candidates.push(from_shell);
    }
    if let Some(home) = dirs_home().map(PathBuf::from) {
        candidates.push(home.join(".local/bin/agy"));
    }
    if let Some(from_shell) = which_via_login_shell("agy") {
        candidates.push(from_shell);
    }
    first_binary(candidates)
}

fn is_pi_coding_agent(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if binary_name_eq(path, "pi-coding-agent") {
        return true;
    }
    if !binary_name_eq(path, "pi") {
        return false;
    }
    file_mentions_pi_coding_agent(path) || help_mentions_rpc_mode(path)
}

fn file_mentions_pi_coding_agent(path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut buf = vec![0u8; 64 * 1024];
    let Ok(n) = file.read(&mut buf) else {
        return false;
    };
    let text = String::from_utf8_lossy(&buf[..n]);
    text.contains("pi-coding-agent")
        || text.contains("@earendil-works/pi")
        || text.contains("@mariozechner/pi-coding-agent")
        || text.contains("PI_CODING_AGENT")
}

fn help_mentions_rpc_mode(path: &Path) -> bool {
    let mut cmd = Command::new(path);
    cmd.arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // npm-installed harnesses are `#!/usr/bin/env node` scripts, so this probe
    // fails outright without a PATH that has node on it.
    prepare_gui_child(&mut cmd);
    let Ok(rx) = spawn_output_wait(&mut cmd) else {
        return false;
    };
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(output)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .to_ascii_lowercase();
            text.contains("--mode") && text.contains("rpc")
        }
        _ => {
            rx.stop_and_drain();
            false
        }
    }
}

fn is_fx_agent(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if !binary_name_eq(path, "fx") {
        return false;
    }
    file_mentions_fx_agent(path) || fx_help_mentions_acp(path)
}

fn is_grok_agent(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if !binary_name_eq(path, "grok") {
        return false;
    }
    // Official installer: ~/.grok/bin/grok
    if path_has_component(path, ".grok") {
        return true;
    }
    file_mentions_grok_agent(path) || grok_help_mentions_agent(path)
}

/// The fx markers sit megabytes into the compiled binary, so a small head-read
/// never matched and every resolve fell through to spawning `fx --help`. Scan
/// the whole file in chunks instead, overlapping enough to catch a marker that
/// straddles a boundary.
fn file_mentions_fx_agent(path: &Path) -> bool {
    const MARKERS: [&str; 4] = ["vercel-labs/fx", "FX_MODEL", "createFxAgent", "fx acp"];
    const CHUNK: usize = 1024 * 1024;
    const OVERLAP: usize = 64;

    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut reader = BufReader::new(file);
    let mut buf = vec![0u8; CHUNK + OVERLAP];
    let mut carry = 0usize;
    loop {
        let Ok(n) = reader.read(&mut buf[carry..]) else {
            return false;
        };
        if n == 0 {
            return false;
        }
        let filled = carry + n;
        let text = String::from_utf8_lossy(&buf[..filled]);
        if MARKERS.iter().any(|marker| text.contains(marker)) {
            return true;
        }
        carry = filled.min(OVERLAP);
        buf.copy_within(filled - carry..filled, 0);
    }
}

fn fx_help_mentions_acp(path: &Path) -> bool {
    let mut cmd = Command::new(path);
    cmd.arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // npm-installed harnesses are `#!/usr/bin/env node` scripts, so this probe
    // fails outright without a PATH that has node on it.
    prepare_gui_child(&mut cmd);
    let Ok(rx) = spawn_output_wait(&mut cmd) else {
        return false;
    };
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(output)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .to_ascii_lowercase();
            text.contains("acp") && (text.contains("ask") || text.contains("gateway"))
        }
        _ => {
            rx.stop_and_drain();
            false
        }
    }
}

fn file_mentions_grok_agent(path: &Path) -> bool {
    const MARKERS: [&str; 4] = ["xai-grok", "Grok Build", "docs.x.ai/build", "grok agent"];
    const CHUNK: usize = 1024 * 1024;
    const OVERLAP: usize = 64;

    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut reader = BufReader::new(file);
    let mut buf = vec![0u8; CHUNK + OVERLAP];
    let mut carry = 0usize;
    loop {
        let Ok(n) = reader.read(&mut buf[carry..]) else {
            return false;
        };
        if n == 0 {
            return false;
        }
        let filled = carry + n;
        let text = String::from_utf8_lossy(&buf[..filled]);
        if MARKERS.iter().any(|marker| text.contains(marker)) {
            return true;
        }
        carry = filled.min(OVERLAP);
        buf.copy_within(filled - carry..filled, 0);
    }
}

fn grok_help_mentions_agent(path: &Path) -> bool {
    let mut cmd = Command::new(path);
    cmd.arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_gui_child(&mut cmd);
    let Ok(rx) = spawn_output_wait(&mut cmd) else {
        return false;
    };
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(output)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .to_ascii_lowercase();
            text.contains("grok build") || (text.contains("agent") && text.contains("stdio"))
        }
        _ => {
            rx.stop_and_drain();
            false
        }
    }
}

fn is_cursor_agent(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if path_has_component(path, ".grok") {
        return false;
    }
    if binary_name_eq(path, "cursor-agent") {
        return true;
    }
    if binary_name_eq(path, "agent") {
        // One symlink hop. canonicalize() can walk into another .app
        // and trip macOS "data from other apps" TCC.
        if let Ok(target) = std::fs::read_link(path) {
            let resolved = if target.is_absolute() {
                target
            } else {
                path.parent().unwrap_or(path).join(target)
            };
            return path_has_component(&resolved, "cursor-agent")
                || resolved
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains("cursor-agent");
        }
    }
    false
}

/// Look `name` up in the interactive login shell's PATH.
///
/// Reads the cached PATH rather than spawning a shell per lookup: six
/// resolvers each asking `command -v` meant six shell startups per probe.
fn which_via_login_shell(name: &str) -> Option<PathBuf> {
    which_in_path(&gui_search_path(), name)
}

fn which_in_path(path: &str, name: &str) -> Option<PathBuf> {
    std::env::split_paths(std::ffi::OsStr::new(path)).find_map(|dir| {
        if dir.as_os_str().is_empty() {
            return None;
        }
        existing_binary(dir.join(name))
    })
}

fn first_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find_map(existing_binary)
}

fn first_binary_matching(
    candidates: Vec<PathBuf>,
    pred: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    candidates.into_iter().find_map(|path| {
        let path = existing_binary(path)?;
        pred(&path).then_some(path)
    })
}

fn existing_binary(path: PathBuf) -> Option<PathBuf> {
    #[cfg(windows)]
    if path.extension().is_none() {
        for ext in ["exe", "cmd", "bat", "com"] {
            let candidate = path.with_extension(ext);
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    is_executable_file(&path).then_some(path)
}

#[cfg(all(test, windows))]
mod windows_launcher_tests {
    use super::*;

    #[test]
    fn npm_shell_shim_does_not_hide_windows_launcher() {
        let dir = std::env::temp_dir().join(format!("bycoda-launcher-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bare = dir.join("agent");
        let cmd = dir.join("agent.cmd");
        std::fs::write(&bare, b"#!/bin/sh\n").unwrap();
        std::fs::write(&cmd, b"@echo off\n").unwrap();
        assert_eq!(existing_binary(bare.clone()), Some(cmd.clone()));
        std::fs::remove_file(&cmd).unwrap();
        assert_eq!(existing_binary(bare.clone()), None);
        std::fs::remove_file(bare).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}

fn configured_binary_name_eq(path: &Path, expected: &str) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if cfg!(windows) {
        return binary_name_eq(path, expected);
    }
    name == expected
}

fn binary_name_eq(path: &Path, expected: &str) -> bool {
    path.file_stem()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            if cfg!(windows) {
                name.eq_ignore_ascii_case(expected)
            } else {
                name == expected
            }
        })
}

fn path_has_component(path: &Path, needle: &str) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name == needle)
    })
}

fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    ["exe", "cmd", "bat", "com"]
                        .iter()
                        .any(|allowed| ext.eq_ignore_ascii_case(allowed))
                })
    }
}

/// Resolve `name` the way a terminal would, then fall back to common install
/// dirs. Finder-launched apps inherit launchd's PATH (`/usr/bin:/bin/…`), so
/// Homebrew / mise / `~/.local/bin` tools look missing unless we search here.
pub(crate) fn resolve_gui_binary(name: &str) -> Option<PathBuf> {
    which_in_path(&gui_search_path(), name)
}

pub(crate) fn gui_search_path() -> String {
    gui_search_path_from(login_shell_path(), dirs_home(), std::env::var("PATH").ok())
}

/// Never starts or waits for the login shell on frequent Git status/diff calls.
pub(crate) fn cached_gui_search_path() -> String {
    let login_path = LOGIN_SHELL_ENV
        .try_lock()
        .ok()
        .and_then(|cache| cache.as_ref().and_then(|env| env.get("PATH").cloned()));
    gui_search_path_from(login_path, dirs_home(), std::env::var("PATH").ok())
}

fn gui_search_path_from(
    login_path: Option<String>,
    home: Option<String>,
    existing: Option<String>,
) -> String {
    let mut parts: Vec<PathBuf> = Vec::new();
    // Login-shell PATH first so Homebrew, mise, nvm, and custom dirs match
    // the user's terminal. Our own PATH next: that read can fail or time out,
    // and an app started from a terminal still inherits the real thing, which
    // beats guessing. The fixed dirs come last — they are all a Finder launch
    // has, since launchd hands it a bare PATH, and preferring them over an
    // inherited PATH is how an abandoned `~/.local/bin` install wins.
    if let Some(path) = login_path {
        parts.extend(std::env::split_paths(&path));
    }
    if let Some(existing) = existing {
        parts.extend(std::env::split_paths(&existing));
    }
    if let Some(home) = home {
        parts.push(format!("{home}/.local/bin").into());
        parts.push(format!("{home}/.cargo/bin").into());
        parts.push(format!("{home}/.claude/local").into());
        parts.push(format!("{home}/.local/share/claude").into());
        parts.push(format!("{home}/.opencode/bin").into());
        parts.push(format!("{home}/.grok/bin").into());
        parts.push(format!("{home}/.npm-global/bin").into());
        parts.push(format!("{home}/.bun/bin").into());
        parts.push(format!("{home}/AppData/Roaming/npm").into());
        parts.push(format!("{home}/AppData/Local/Yarn/bin").into());
        parts.push(format!("{home}/scoop/shims").into());
    }
    parts.push("/opt/homebrew/bin".into());
    parts.push("/usr/local/bin".into());
    parts.push("/usr/bin".into());
    parts.push("/bin".into());
    parts.push("/snap/bin".into());
    #[cfg(windows)]
    {
        parts.push(r"C:\Program Files\Git\cmd".into());
        parts.push(r"C:\Program Files\nodejs".into());
    }
    // Windows reads the inherited PATH as its login-shell PATH too. Keeping
    // both copies can exceed cmd.exe's 8191-character expansion limit and hide
    // system tools from child shells. Preserve the first search position.
    let mut seen = std::collections::HashSet::new();
    parts.retain(|path| {
        #[cfg(windows)]
        let key = path.to_string_lossy().to_lowercase();
        #[cfg(not(windows))]
        let key = path.clone();
        seen.insert(key)
    });
    std::env::join_paths(parts)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn apply_gui_path(cmd: &mut Command) {
    cmd.env("PATH", gui_search_path());
}

/// Standard non-PTY GUI child setup; terminal sessions retain their own setsid policy.
pub(crate) fn prepare_gui_child(cmd: &mut Command) {
    apply_gui_env(cmd);
    isolate_child(cmd);
}

pub(crate) fn apply_gui_env(cmd: &mut Command) {
    apply_gui_path(cmd);
    crate::hide_window_console(cmd);
    if let Some(id) = passwd_identity() {
        if std::env::var_os("HOME").is_none() {
            cmd.env("HOME", &id.home);
        }
        if std::env::var_os("USER").is_none() {
            cmd.env("USER", &id.user);
            cmd.env("LOGNAME", &id.user);
        }
        if std::env::var_os("SHELL").is_none() && !id.shell.is_empty() {
            cmd.env("SHELL", &id.shell);
        }
    } else if let Some(home) = dirs_home() {
        cmd.env("HOME", &home);
        if std::env::var_os("USERPROFILE").is_none() {
            cmd.env("USERPROFILE", &home);
        }
        if std::env::var_os("USER").is_none() {
            if let Ok(username) = std::env::var("USERNAME") {
                cmd.env("USER", username);
            }
        }
    }
    if std::env::var_os("LANG").is_none() && std::env::var_os("LC_ALL").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
}

fn prepare_child(cmd: &mut Command, command: &str) {
    apply_gui_env(cmd);
    if command_basename(command) == "fx" {
        apply_fx_env(cmd);
    }
    if command_basename(command) == "grok" {
        apply_grok_env(cmd);
    }
    isolate_child(cmd);
}

/// fx keeps its Gateway credential in the macOS Keychain and reads it by
/// shelling out to `osascript`. From a bundled app that read can block on a
/// SecurityAgent prompt nobody ever sees, and fx then rejects `initialize`
/// outright. Forwarding an API key from the login shell skips the Keychain
/// entirely for users who have one set.
fn apply_fx_env(cmd: &mut Command) {
    for key in [
        "AI_GATEWAY_API_KEY",
        "FX_AI_GATEWAY_API_KEY",
        "VERCEL_OIDC_TOKEN",
    ] {
        if std::env::var_os(key).is_some() {
            continue;
        }
        if let Some(value) = login_shell_env(key) {
            cmd.env(key, value);
        }
    }
}

fn apply_grok_env(cmd: &mut Command) {
    for key in ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"] {
        if std::env::var_os(key).is_some() {
            continue;
        }
        if let Some(value) = login_shell_env(key) {
            cmd.env(key, value);
        }
    }
}

static LOGIN_SHELL_ENV: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Keys worth keeping out of `printenv`. PATH is the important one: a
/// Finder-launched app inherits only launchd's bare PATH.
const LOGIN_SHELL_KEYS: [&str; 6] = [
    "PATH",
    "AI_GATEWAY_API_KEY",
    "FX_AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
    "XAI_API_KEY",
    "GROK_CODE_XAI_API_KEY",
];

fn login_shell_path() -> Option<String> {
    login_shell_env("PATH")
}

fn login_shell_env(name: &str) -> Option<String> {
    let mut cache = LOGIN_SHELL_ENV.lock().ok()?;
    if cache.is_none() {
        *cache = Some(load_login_shell_env()).filter(|env| !env.is_empty());
    }
    cache
        .as_ref()
        .and_then(|map| map.get(name).cloned())
        .filter(|value| !value.is_empty())
}

fn load_login_shell_env() -> HashMap<String, String> {
    #[cfg(windows)]
    {
        LOGIN_SHELL_KEYS
            .into_iter()
            .filter_map(|key| {
                let value = std::env::var(key).ok()?;
                (!value.is_empty()).then(|| (key.to_string(), value))
            })
            .collect()
    }
    #[cfg(not(windows))]
    load_unix_login_shell_env()
}

/// Read the environment the user actually gets in a terminal.
///
/// `-lic`, not `-lc`: zsh reads `.zshrc` only for *interactive* shells, and
/// version managers (nvm, fnm, mise, volta) all initialize from there. A
/// login-but-not-interactive shell sees `.zshenv`/`.zprofile` only, so every
/// nvm-managed CLI looks uninstalled.
#[cfg(not(windows))]
fn load_unix_login_shell_env() -> HashMap<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".into()
        } else {
            "/bin/bash".into()
        }
    });
    let mut cmd = Command::new(&shell);
    cmd.args(["-lic", "printenv"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    isolate_child(&mut cmd);
    let Ok(child) = OwnedChild::spawn(&mut cmd) else {
        return HashMap::new();
    };
    let rx = output_wait(child);
    let output = match rx.recv_timeout(LOGIN_SHELL_TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => output,
        _ => {
            rx.stop_and_drain();
            return HashMap::new();
        }
    };
    let mut map = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if LOGIN_SHELL_KEYS.contains(&key) && !value.is_empty() {
            map.insert(key.to_string(), value.to_string());
        }
    }
    map
}

fn command_basename(command: &str) -> &str {
    Path::new(command)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
}

#[cfg(test)]
mod localhost_http_security_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn validates_parsed_host_and_rejects_url_credentials() {
        for value in [
            "http://127.0.0.1:1234/api",
            "http://localhost/api",
            "http://LOCALHOST:80/",
        ] {
            assert!(assert_loopback(value).is_ok(), "{value}");
        }
        for value in [
            "http://localhost:1@other.example/private",
            "http://127.0.0.1:1@other.example/private",
            "http://user:pass@localhost:1234/",
            "http://localhost.other.example/",
            "http://127.0.0.2:1234/",
            "https://localhost:1234/",
            "not a url",
        ] {
            assert!(assert_loopback(value).is_err(), "{value}");
        }
    }

    #[test]
    fn local_provider_http_does_not_follow_redirects() {
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let origin = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin_address = origin.local_addr().unwrap();
        let target_address = target.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut socket, _) = origin.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0_u8; 2048];
            assert!(socket.read(&mut bytes).unwrap() > 0);
            write!(socket, "HTTP/1.1 302 Found\r\nLocation: http://{target_address}/external\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let response = http_agent()
            .get(&format!("http://{origin_address}/api"))
            .timeout(Duration::from_secs(5))
            .call()
            .unwrap();
        assert_eq!(response.status(), 302);
        server.join().unwrap();
        assert_eq!(
            target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

#[cfg(unix)]
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    fn spawn_group(script: &str) -> std::process::Child {
        Command::new("sh")
            .args(["-c", script])
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test process")
    }

    fn wait_dead(pid: u32, child: &mut std::process::Child) -> bool {
        for _ in 0..40 {
            let _ = child.try_wait();
            // Same liveness rule as `tree_alive`: exited zombies do not count.
            if !tree_alive(pid) {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// A real child so `install_spawn` can be exercised directly, rather than
    /// through a helper that re-states its condition.
    fn live_child() -> (Arc<LiveChild>, TestOwnedChild) {
        let mut command = Command::new("sleep");
        command
            .arg("30")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_child(&mut command);
        owned_live_fixture(OwnedChild::spawn(&mut command).expect("spawn test process"))
    }
    trait ReapTestChild {
        fn reap(&mut self);
    }
    impl ReapTestChild for Child {
        fn reap(&mut self) {
            let _ = self.kill();
            let _ = self.wait();
        }
    }
    impl ReapTestChild for TestOwnedChild {
        fn reap(&mut self) {
            let _ = self.kill();
            let _ = self.wait();
        }
    }
    fn reap(mut child: impl ReapTestChild) {
        child.reap();
    }

    #[test]
    fn install_spawn_keeps_a_child_nothing_cancelled() {
        let host = HarnessHost::new();
        let (epoch, kill_all, _) = host.begin_spawn("s1");
        let (live, child) = live_child();
        let pid = live.pid;
        assert!(host
            .install_spawn("s1".into(), epoch, kill_all, live)
            .is_none());
        assert_eq!(host.get("s1").map(|live| live.pid), Some(pid));
        reap(child);
    }

    #[test]
    fn install_spawn_rejects_a_child_killed_mid_spawn() {
        let host = HarnessHost::new();
        let (epoch, kill_all, _) = host.begin_spawn("s1");
        host.kill_session("s1");
        let (live, child) = live_child();
        assert!(host
            .install_spawn("s1".into(), epoch, kill_all, live)
            .is_some());
        assert!(host.get("s1").is_none());
        reap(child);
    }

    #[test]
    fn install_spawn_rejects_a_child_after_kill_all() {
        let host = HarnessHost::new();
        let (epoch, kill_all, _) = host.begin_spawn("s1");
        host.kill_all();
        let (live, child) = live_child();
        assert!(host
            .install_spawn("s1".into(), epoch, kill_all, live)
            .is_some());
        assert!(host.get("s1").is_none());
        reap(child);
    }

    #[test]
    fn kill_during_spawn_invalidates_the_stamp() {
        let host = HarnessHost::new();
        let (epoch, kill_all, prev) = host.begin_spawn("s1");
        assert!(prev.is_none());
        assert!(host.spawn_stamp_current("s1", epoch, kill_all));
        host.kill_session("s1");
        assert!(!host.spawn_stamp_current("s1", epoch, kill_all));
    }

    #[test]
    fn overlapping_spawn_invalidates_the_earlier_one() {
        let host = HarnessHost::new();
        let first = host.begin_spawn("s1");
        let second = host.begin_spawn("s1");
        assert!(!host.spawn_stamp_current("s1", first.0, first.1));
        assert!(host.spawn_stamp_current("s1", second.0, second.1));
    }

    #[test]
    fn kill_all_rejects_an_in_flight_spawn() {
        let host = HarnessHost::new();
        let (epoch, kill_all, _) = host.begin_spawn("s1");
        host.kill_all();
        assert!(!host.spawn_stamp_current("s1", epoch, kill_all));
    }

    #[test]
    fn terminate_reaps_the_process_group() {
        let mut child = spawn_group("sleep 30 & sleep 30");
        let pid = child.id();
        assert!(tree_alive(pid));
        terminate_after(pid, Duration::from_millis(100));
        if !wait_dead(pid, &mut child) {
            let _ = child.kill();
            panic!("process group survived terminate");
        }
    }

    #[test]
    fn kill_completes_while_a_stdin_write_is_blocked() {
        use std::io::Write;
        let host = HarnessHost::new();
        // `sleep` never drains stdin: filling the pipe wedges the writer while
        // it holds the stdin mutex — the worst case recovery must survive.
        let (live, mut child) = live_child();
        host.lock_inner()
            .children
            .insert("wedged".to_string(), live.clone());
        let writer = thread::spawn(move || {
            let payload = vec![b'x'; 8 * 1024 * 1024];
            let mut stdin = live.stdin.lock().unwrap_or_else(|e| e.into_inner());
            let _ = stdin.write_all(&payload);
        });
        thread::sleep(Duration::from_millis(200));
        // Kill needs neither the stdin mutex nor the writer's thread.
        let live = host
            .kill_session("wedged")
            .expect("wedged child registered");
        live.request_stop().unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !writer.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(writer.is_finished(), "blocked write survived the kill");
        let _ = writer.join();
        let _ = child.wait();
    }

    #[test]
    fn write_deadline_reports_timeout_and_keeps_a_child_that_does_not_read_stdin() {
        let (live, mut child) = live_child();
        let retained = Arc::clone(&live);
        let started = Instant::now();
        let error = write_child_with_deadline(
            live,
            "x".repeat(2 * 1024 * 1024),
            Duration::from_millis(100),
        )
        .unwrap_err();
        // A timed-out write may have partially reached the provider: the outcome
        // is unknown and must not be retried.
        assert!(
            error.contains("stdin delivery outcome unknown") && error.contains("do not retry"),
            "{error}"
        );
        assert!(started.elapsed() < Duration::from_secs(3));
        // A pure timeout never stops the child; the caller stops it explicitly.
        assert!(!retained.writers.is_closing());
        retained.request_stop().unwrap();
        let _ = child.wait();
        let until = Instant::now() + Duration::from_secs(3);
        loop {
            if retained.stdin.try_lock().is_ok() {
                break;
            }
            assert!(
                Instant::now() < until,
                "timed out writer retained the stdin mutex"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn terminate_escalates_to_sigkill() {
        let mut child = spawn_group("trap '' TERM; while true; do sleep 1; done");
        let pid = child.id();
        assert!(tree_alive(pid));
        terminate_after(pid, Duration::from_millis(150));
        if !wait_dead(pid, &mut child) {
            let _ = child.kill();
            panic!("SIGTERM-ignoring process survived SIGKILL escalate");
        }
    }

    #[test]
    fn terminate_escalates_after_group_leader_exits() {
        let mut child = spawn_group(
            "trap 'exit 0' TERM; sh -c 'trap \"\" TERM; while true; do sleep 1; done' & wait",
        );
        let pid = child.id();
        assert!(tree_alive(pid));
        terminate_after(pid, Duration::from_millis(150));
        if !wait_dead(pid, &mut child) {
            let _ = child.kill();
            panic!("process group survived after its leader exited");
        }
    }

    fn live_group(script: &str) -> (Arc<LiveChild>, TestOwnedChild) {
        let mut command = Command::new("sh");
        command
            .args(["-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_child(&mut command);
        owned_live_fixture(OwnedChild::spawn(&mut command).expect("spawn grouped child"))
    }

    #[test]
    fn kill_all_reaps_term_ignoring_children_before_return() {
        let host = HarnessHost::new();
        let (epoch, kill_all, _) = host.begin_spawn("s1");
        let (live, child) = live_group("trap '' TERM; while true; do sleep 1; done");
        let pid = live.pid;
        // `harness_spawn` always leaves a thread owning the `Child`. Without one
        // the SIGKILLed leader lingers as a zombie that `kill(pid, 0)` still
        // answers, so the test would not be exercising the real shutdown.
        let waiter = thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
        assert!(host
            .install_spawn("s1".into(), epoch, kill_all, live)
            .is_none());
        host.kill_all();
        let alive = tree_alive(pid);
        let _ = waiter.join();
        assert!(
            !alive,
            "kill_all returned while the harness tree was still alive"
        );
    }

    #[test]
    fn reap_snapshots_kills_a_marked_orphan() {
        let mut child = Command::new("sh")
            .args(["-c", "trap '' TERM; while true; do sleep 1; done"])
            .process_group(0)
            .env(HARNESS_PARENT_ENV, "2147483646")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn marked orphan");
        let pid = child.id();
        reap_snapshots(
            &[ProcessSnapshot {
                pid,
                ppid: 1,
                args: "/Users/n/.local/bin/cursor-agent acp".into(),
                harness_parent: Some(2_147_483_646),
            }],
            std::process::id(),
        );
        if !wait_dead(pid, &mut child) {
            let _ = child.kill();
            panic!("marked orphan survived reap_snapshots");
        }
    }

    #[test]
    fn reap_snapshots_spares_children_of_this_process() {
        let mut child = Command::new("sleep")
            .arg("30")
            .process_group(0)
            .env(HARNESS_PARENT_ENV, std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn live child");
        let pid = child.id();
        reap_snapshots(
            &[ProcessSnapshot {
                pid,
                ppid: std::process::id(),
                args: "sleep 30".into(),
                harness_parent: Some(std::process::id()),
            }],
            std::process::id(),
        );
        if !tree_alive(pid) {
            let _ = child.try_wait();
            panic!("reap_snapshots killed a child of this process");
        }
        reap(child);
    }

    /// The marker is what lets the next launch tell a crashed run's leftovers
    /// from a live instance's children. Every spawn funnels through
    /// `isolate_child`, so losing it here silently un-reaps probes and shells.
    #[cfg(unix)]
    #[test]
    fn only_text_file_busy_is_worth_respawning_for() {
        assert!(is_text_file_busy(&std::io::Error::from_raw_os_error(
            libc::ETXTBSY
        )));
        assert!(!is_text_file_busy(&std::io::Error::from_raw_os_error(
            libc::ENOENT
        )));
        assert!(!is_text_file_busy(&std::io::Error::other("no errno")));
    }

    #[test]
    fn isolate_child_stamps_the_reap_marker() {
        let pid = std::process::id().to_string();
        let mut cmd = Command::new("true");
        isolate_child(&mut cmd);
        assert!(cmd.get_envs().any(|(key, value)| {
            key == std::ffi::OsStr::new(HARNESS_PARENT_ENV)
                && value == Some(std::ffi::OsStr::new(pid.as_str()))
        }));
    }

    #[test]
    fn runtime_binary_paths_stay_fixed_for_the_process() {
        let runtime = Mutex::new(None);
        let old = HashMap::from([("cursor".to_string(), "/old".to_string())]);
        let new = HashMap::from([("cursor".to_string(), "/new".to_string())]);

        assert_eq!(initialize_runtime_binary_paths(&runtime, old.clone()), old);
        assert_eq!(initialize_runtime_binary_paths(&runtime, new), old);
    }

    #[cfg(unix)]
    #[test]
    fn mcp_commands_use_active_configured_binaries() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("bycoda-mcp-binaries-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let host = HarnessHost::new();
        let mut paths = HashMap::new();
        for (provider, filename) in [
            ("claude", "claude"),
            ("codex", "codex"),
            ("cursor", "cursor-agent"),
            ("opencode", "opencode"),
        ] {
            let binary = root.join(filename);
            std::fs::write(
                &binary,
                format!("#!/bin/sh\nif [ \"$1\" = --version ]; then echo '{provider} 2.3.4'; else printf '%s\\n' \"$@\"; fi\n"),
            ).unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
            paths.insert(provider.to_string(), binary.to_string_lossy().into_owned());
        }
        initialize_runtime_binary_paths(&host.runtime_binary_paths, paths.clone());
        initialize_runtime_binary_paths(&host.runtime_binary_paths, HashMap::new());
        let cwd = root.to_string_lossy().into_owned();
        for (provider, path) in &paths {
            let active = host.runtime_binary_path(provider).unwrap();
            assert_eq!(&active, path);
            let binary = resolve_mcp_binary(provider, Some(&active)).unwrap();
            assert_eq!(binary, PathBuf::from(path));
            assert_eq!(
                mcp_command(
                    binary,
                    vec!["mcp".into(), "login".into(), "docs".into()],
                    cwd.clone(),
                    Duration::from_secs(5),
                )
                .unwrap(),
                "mcp\nlogin\ndocs"
            );
        }
        assert_eq!(
            claude_mcp_command(
                vec!["mcp".into(), "list".into()],
                cwd.clone(),
                Duration::from_secs(5),
                paths.get("claude").map(String::as_str),
            )
            .unwrap(),
            "mcp\nlist"
        );
        for provider in ["claude", "codex"] {
            let config = serde_json::json!({"command":"node","args":["docs"]});
            let (binary, args) = mcp_add_args(
                provider,
                "user",
                "docs",
                &config,
                paths.get(provider).map(String::as_str),
            )
            .unwrap();
            assert_eq!(binary, PathBuf::from(&paths[provider]));
            assert_eq!(
                &args[..3],
                [
                    "mcp",
                    if provider == "claude" {
                        "add-json"
                    } else {
                        "add"
                    },
                    "docs"
                ]
            );
            add_mcp_via_cli(
                provider,
                "user",
                &cwd,
                "docs",
                &config,
                paths.get(provider).map(String::as_str),
            )
            .unwrap();
        }
        assert_eq!(
            opencode_major_version(&cwd, paths.get("opencode").map(String::as_str)),
            Ok(2)
        );
        assert!(resolve_mcp_binary(
            "claude",
            Some(&root.join("missing/claude").to_string_lossy())
        )
        .is_err());
        assert!(resolve_mcp_binary("claude", paths.get("codex").map(String::as_str)).is_err());
        assert!(resolve_mcp_binary("pi", paths.get("claude").map(String::as_str)).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn configured_binary_paths_fail_closed_and_stay_exact() {
        use std::os::unix::fs::PermissionsExt;

        let dir =
            std::env::temp_dir().join(format!("bycoda-configured-binaries-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let codex = dir.join("codex");
        let opencode = dir.join("opencode");
        let cursor_agent = dir.join("cursor-agent");
        let decoy = dir.join("codex.sh");
        let antigravity = dir.join("agy_acp_server");
        let antigravity_wrapper = dir.join("agy_acp_server.par");
        for path in [
            &codex,
            &opencode,
            &cursor_agent,
            &decoy,
            &antigravity,
            &antigravity_wrapper,
        ] {
            let script: &[u8] =
                if path == &decoy || path == &antigravity || path == &antigravity_wrapper {
                    b"#!/bin/sh\n"
                } else if path == &codex {
                    b"#!/bin/sh\necho 'codex-cli 0.156.1'\n"
                } else if path == &cursor_agent {
                    b"#!/bin/sh\necho '2026.09.23-86fc751'\n"
                } else {
                    b"#!/bin/sh\necho '1.18.32-beta'\n"
                };
            std::fs::write(path, script).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let codex_path = codex.to_string_lossy().into_owned();
        let version_log = dir.join("version.log");
        std::fs::write(
            &codex,
            format!(
                "#!/bin/sh\necho check >> '{}'\necho 'codex-cli 0.156.1'\n",
                version_log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            resolve_harness_binary_override("codex", &codex_path),
            Ok(codex.clone())
        );
        let _ = std::fs::remove_file(&version_log);
        assert_eq!(
            resolve_harness_binary_override("codex", &codex_path),
            Ok(codex.clone())
        );
        assert!(!version_log.exists());
        std::fs::write(
            &codex,
            format!(
                "#!/bin/sh\necho check >> '{}'\necho 'codex-cli 0.157.0'\n",
                version_log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            resolve_harness_binary_override("codex", &codex_path),
            Ok(codex.clone())
        );
        assert!(version_log.exists());
        assert_eq!(
            resolve_harness_binary_override("opencode", &opencode.to_string_lossy()),
            Ok(opencode.clone())
        );
        assert_eq!(
            resolve_harness_binary_override("cursor", &cursor_agent.to_string_lossy()),
            Ok(cursor_agent.clone())
        );
        assert!(is_resolved_harness_binary(
            &codex_path,
            Some("codex"),
            Some(&codex_path)
        ));
        assert!(!is_resolved_harness_binary(
            &codex_path,
            Some("opencode"),
            Some(&codex_path)
        ));
        assert!(resolve_harness_binary_override("codex", &opencode.to_string_lossy()).is_err());
        assert!(resolve_harness_binary_override(
            "opencode",
            &dir.join("missing").to_string_lossy()
        )
        .is_err());
        assert!(resolve_harness_binary_override("codex", "codex").is_err());
        assert!(resolve_harness_binary_override("codex", &decoy.to_string_lossy()).is_err());
        assert!(
            resolve_harness_binary_override("antigravity", &antigravity.to_string_lossy()).is_err()
        );
        assert_eq!(
            resolve_harness_binary_override("antigravity", &antigravity_wrapper.to_string_lossy()),
            Ok(antigravity_wrapper.clone())
        );

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn which_in_path_takes_the_first_executable_hit() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("bycoda-which-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (empty, unreadable, real) = (dir.join("a"), dir.join("b"), dir.join("c"));
        for sub in [&empty, &unreadable, &real] {
            std::fs::create_dir_all(sub).unwrap();
        }

        // A same-named file that is not executable must not win.
        let decoy = unreadable.join("claude");
        std::fs::write(&decoy, b"not a program\n").unwrap();
        std::fs::set_permissions(&decoy, std::fs::Permissions::from_mode(0o644)).unwrap();

        let target = real.join("claude");
        std::fs::write(&target, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();

        let path = format!(
            "{}::{}:{}",
            empty.display(),
            unreadable.display(),
            real.display()
        );
        assert_eq!(which_in_path(&path, "claude"), Some(target));
        assert_eq!(which_in_path(&path, "codex"), None);
        assert_eq!(which_in_path("", "claude"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gui_search_path_puts_login_path_ahead_of_fallbacks() {
        let path = gui_search_path_from(
            Some("/custom/gh-dir:/usr/bin".into()),
            Some("/tmp/home".into()),
            Some("/inherited/bin".into()),
        );
        let parts: Vec<&str> = path.split(':').collect();
        let at = |dir: &str| parts.iter().position(|part| *part == dir).unwrap();
        assert_eq!(parts[0], "/custom/gh-dir");
        assert!(parts.contains(&"/tmp/home/.grok/bin"));
        assert!(parts.contains(&"/usr/local/bin"));
        assert!(at("/custom/gh-dir") < at("/inherited/bin"));
        assert!(at("/inherited/bin") < at("/tmp/home/.local/bin"));
        assert!(at("/tmp/home/.local/bin") < at("/opt/homebrew/bin"));
    }

    /// The login read can fail or time out, and the fixed dirs are guesses: a
    /// `claude` the user actually installed, on the PATH we were launched with,
    /// has to win over an abandoned `~/.local/bin` one.
    #[test]
    fn inherited_path_beats_fixed_dirs_when_the_login_read_fails() {
        let path = gui_search_path_from(
            None,
            Some("/tmp/home".into()),
            Some("/opt/mise/shims:/usr/bin".into()),
        );
        let parts: Vec<&str> = path.split(':').collect();
        let at = |dir: &str| parts.iter().position(|part| *part == dir).unwrap();
        assert_eq!(parts[0], "/opt/mise/shims");
        assert!(at("/opt/mise/shims") < at("/tmp/home/.local/bin"));
        assert!(at("/tmp/home/.local/bin") < at("/opt/homebrew/bin"));
    }

    #[test]
    fn resolve_gui_binary_finds_a_binary_on_the_gui_path() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("bycoda-gui-bin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("gh");
        std::fs::write(&target, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();

        let path = gui_search_path_from(Some(dir.to_string_lossy().into_owned()), None, None);
        assert_eq!(which_in_path(&path, "gh"), Some(target));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cursor_agent_accepts_symlink_named_agent() {
        let dir = std::env::temp_dir().join(format!("bycoda-agent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("cursor-agent-pack")).unwrap();
        let target = dir.join("cursor-agent-pack/cursor-agent");
        std::fs::write(&target, b"#!/bin/sh\n").unwrap();
        let agent = dir.join("agent");
        std::os::unix::fs::symlink(&target, &agent).unwrap();
        assert!(is_cursor_agent(&agent));
        assert!(!is_cursor_agent(&dir.join("missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pi_accepts_coding_agent_and_rejects_other_pi() {
        let dir = std::env::temp_dir().join(format!("bycoda-pi-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let named = dir.join("pi-coding-agent");
        std::fs::write(&named, b"#!/bin/sh\n").unwrap();
        assert!(is_pi_coding_agent(&named));

        let shim = dir.join("pi");
        std::fs::write(
            &shim,
            b"#!/usr/bin/env node\nrequire('@earendil-works/pi-coding-agent/cli.js');\n",
        )
        .unwrap();
        assert!(is_pi_coding_agent(&shim));

        let other = dir.join("pi");
        std::fs::write(&other, b"#!/bin/sh\necho 3.14159\n").unwrap();
        // Overwrite the shim: a calculator named `pi` must not match.
        assert!(!file_mentions_pi_coding_agent(&other));
        assert!(!is_pi_coding_agent(&other));

        assert!(!is_pi_coding_agent(&dir.join("missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn omp_accepts_rpc_capable_binary_and_rejects_other_names() {
        let dir = std::env::temp_dir().join(format!("bycoda-omp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // omp is a compiled binary, so identification leans on the --help probe.
        // A shell stub that answers `--help` the same way stands in for it here.
        let agent = dir.join("omp");
        std::fs::write(
            &agent,
            b"#!/bin/sh\necho '--mode=<value> Output mode: text, json, rpc, or rpc-ui'\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&agent, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(unix)]
        assert!(is_omp_agent(&agent));

        // oh-my-posh and friends must not win the name.
        let other = dir.join("oh-my-posh");
        std::fs::write(&other, b"#!/bin/sh\necho prompt theme engine\n").unwrap();
        assert!(!is_omp_agent(&other));

        assert!(!is_omp_agent(&dir.join("missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fx_accepts_vercel_agent_and_rejects_json_viewer() {
        let dir = std::env::temp_dir().join(format!("bycoda-fx-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let agent = dir.join("fx");
        std::fs::write(&agent, b"#!/bin/sh\necho vercel-labs/fx\n# FX_MODEL\n").unwrap();
        assert!(is_fx_agent(&agent));

        let viewer = dir.join("fx-viewer");
        std::fs::write(&viewer, b"#!/bin/sh\necho Terminal JSON viewer\n").unwrap();
        assert!(!is_fx_agent(&viewer));

        let other = dir.join("fx");
        std::fs::write(&other, b"#!/bin/sh\necho json viewer\n").unwrap();
        assert!(!file_mentions_fx_agent(&other));
        assert!(!is_fx_agent(&other));

        assert!(!is_fx_agent(&dir.join("missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The real fx binary carries its markers megabytes in. A head-only read
    /// missed them and silently fell back to spawning `fx --help`.
    #[test]
    fn fx_marker_is_found_past_the_first_chunk() {
        let dir = std::env::temp_dir().join(format!("bycoda-fx-deep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let agent = dir.join("fx");
        let mut blob = vec![b'\0'; 6 * 1024 * 1024];
        blob.extend_from_slice(b"https://github.com/vercel-labs/fx");
        std::fs::write(&agent, &blob).unwrap();
        assert!(file_mentions_fx_agent(&agent));

        // A marker straddling a chunk boundary must still be caught.
        let split = dir.join("fx-split");
        let mut edge = vec![b'\0'; 1024 * 1024 - 4];
        edge.extend_from_slice(b"vercel-labs/fx");
        std::fs::write(&split, &edge).unwrap();
        assert!(file_mentions_fx_agent(&split));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn grok_accepts_official_install_path_and_markers() {
        let dir = std::env::temp_dir().join(format!("bycoda-grok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let home = dir.join(".grok/bin");
        std::fs::create_dir_all(&home).unwrap();

        let agent = home.join("grok");
        std::fs::write(&agent, b"#!/bin/sh\necho other grok\n").unwrap();
        assert!(is_grok_agent(&agent));

        let marked = dir.join("grok");
        std::fs::write(&marked, b"#!/bin/sh\n# Grok Build\n# xai-grok\n").unwrap();
        assert!(is_grok_agent(&marked));

        let other = dir.join("grok-cli");
        std::fs::write(&other, b"#!/bin/sh\necho not grok\n").unwrap();
        assert!(!is_grok_agent(&other));

        assert!(!is_grok_agent(&dir.join("missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn antigravity_resolver_prefers_executable_wrapper_and_tracks_orphans() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("bycoda-agy-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let wrapper = dir.join("bin/agy_acp_server.par");
        let server = dir.join("agy_acp_server.par");
        std::fs::write(&wrapper, b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::write(&server, b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&server, std::fs::Permissions::from_mode(0o755)).unwrap();
        let candidates = vec![wrapper.clone(), server.clone()];
        assert_eq!(first_binary(candidates.clone()), Some(server));
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(first_binary(candidates), Some(wrapper));
        assert!(looks_like_harness_argv(
            "/home/user/.local/share/agy-acp/agy_acp_server.par"
        ));
        assert!(!looks_like_harness_argv("agy --help"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn command_basename_strips_path() {
        assert_eq!(command_basename("/Users/me/.local/bin/fx"), "fx");
        assert_eq!(command_basename("fx"), "fx");
        assert_eq!(command_basename("/Users/me/.grok/bin/grok"), "grok");
        assert_eq!(command_basename("fx.exe"), "fx");
    }

    #[test]
    fn passwd_identity_resolves_the_current_user() {
        let id = passwd_identity().expect("passwd");
        assert!(!id.user.is_empty());
        assert!(PathBuf::from(&id.home).is_dir());
    }
}

#[cfg(test)]
mod antigravity_binary_tests {
    use super::*;

    #[test]
    fn antigravity_launch_args_match_the_platform_registry() {
        if cfg!(target_os = "linux") {
            assert_eq!(antigravity_args(ANTIGRAVITY_ACP), vec!["--uid="]);
        } else {
            assert!(antigravity_args(ANTIGRAVITY_ACP).is_empty());
        }
        // The CLI is never given the ACP server's launch flags.
        assert!(antigravity_args(ANTIGRAVITY_STREAM_JSON).is_empty());
    }

    #[test]
    fn antigravity_transport_follows_the_binary_name() {
        assert_eq!(
            antigravity_transport(Path::new("/opt/agy/bin/agy")),
            ANTIGRAVITY_STREAM_JSON
        );
        for acp in [
            "/home/u/.local/bin/agy_acp_server.par",
            "/home/u/.local/share/agy-acp/agy_acp_server",
        ] {
            assert_eq!(
                antigravity_transport(Path::new(acp)),
                ANTIGRAVITY_ACP,
                "{acp}"
            );
        }
    }

    #[test]
    fn agy_cli_candidates_prefer_the_installer_directory() {
        let candidates = agy_cli_candidates(Some(Path::new("/local")));
        assert_eq!(candidates[0], Path::new("/local").join("agy/bin/agy"));
        assert!(agy_cli_candidates(None)
            .iter()
            .all(|path| !path.starts_with("/local")));
    }

    #[test]
    #[cfg(windows)]
    fn windows_resolves_agy_exe_from_the_installer_directory() {
        let dir = std::env::temp_dir().join(format!("bycoda-agy-win-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("agy/bin")).unwrap();
        let exe = dir.join("agy/bin/agy.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        assert_eq!(
            first_binary(agy_cli_candidates(Some(&dir))).as_deref(),
            Some(exe.as_path())
        );
        assert_eq!(antigravity_transport(&exe), ANTIGRAVITY_STREAM_JSON);
        // A configured override is accepted on Windows, and only for `agy`.
        assert_eq!(
            resolve_configured_harness_binary(&exe.to_string_lossy(), "antigravity", &["agy"]),
            Ok(exe.clone())
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod exec_allowlist_tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn allows_known_catalog_args() {
        for provider in [None, Some("cursor"), Some("opencode")] {
            assert!(exec_args_allowed(provider, &args(&["--version"])));
            assert!(exec_args_allowed(provider, &args(&["--list-models"])));
            assert!(exec_args_allowed(provider, &args(&["models", "--verbose"])));
            assert!(exec_args_allowed(provider, &args(&["models", "--json"])));
            assert!(exec_args_allowed(provider, &args(&["models"])));
            assert!(exec_args_allowed(provider, &args(&["status", "--json"])));
            assert!(exec_args_allowed(provider, &args(&["agent", "list"])));
        }
    }

    #[test]
    fn allows_service_args_only_for_opencode() {
        for service in [
            &["service", "status"][..],
            &["service", "start"][..],
            &["service", "get", "password"][..],
        ] {
            assert!(exec_args_allowed(Some("opencode"), &args(service)));
            assert!(!exec_args_allowed(None, &args(service)));
            assert!(!exec_args_allowed(Some("cursor"), &args(service)));
        }
    }

    #[test]
    fn allows_grok_cleanup_only_for_one_valid_session_id() {
        let cleanup = args(&[
            "--no-auto-update",
            "sessions",
            "delete",
            "550e8400-e29b-41d4-a716-446655440000",
        ]);
        assert!(exec_args_allowed(Some("grok"), &cleanup));
        for provider in [None, Some("cursor"), Some("opencode")] {
            assert!(!exec_args_allowed(provider, &cleanup));
        }
        for id in ["", "--all", "../sessions", "invalid"] {
            let mut rejected = cleanup.clone();
            rejected[3] = id.to_string();
            assert!(!exec_args_allowed(Some("grok"), &rejected));
        }
        let mut extra = cleanup;
        extra.push("--all".to_string());
        assert!(!exec_args_allowed(Some("grok"), &extra));
    }

    #[test]
    fn rejects_other_args() {
        for rejected in [
            &[][..],
            &["--help"][..],
            &["--version", "--json"][..],
            &["-c", "id"][..],
            &["agent", "list", "--json"][..],
            &["service", "stop"][..],
            &["service", "get"][..],
            &["service", "status", "--json"][..],
        ] {
            assert!(!exec_args_allowed(Some("opencode"), &args(rejected)));
        }
    }
}

#[cfg(all(windows, test))]
mod windows_binary_tests {
    use super::*;

    #[test]
    fn configured_binary_path_accepts_windows_shim_extension() {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-configured-windows-binary-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let shim = dir.join("codex.cmd");
        std::fs::write(&shim, b"@echo off\r\necho codex-cli 0.156.1\r\n").unwrap();
        let shim_path = shim.to_string_lossy().into_owned();

        assert_eq!(
            resolve_harness_binary_override("codex", &shim_path),
            Ok(shim.clone())
        );
        assert!(is_resolved_harness_binary(
            &shim_path,
            Some("codex"),
            Some(&shim_path)
        ));

        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod reap_logic_tests {
    use super::*;

    fn row(pid: u32, ppid: u32, args: &str, parent: Option<u32>) -> ProcessSnapshot {
        ProcessSnapshot {
            pid,
            ppid,
            args: args.into(),
            harness_parent: parent,
        }
    }

    #[test]
    fn parse_ps_row_reads_pid_ppid_and_args() {
        let parsed = parse_ps_row(
            " 2436     1 /Users/n/.local/bin/cursor-agent --use-system-ca index.js acp",
        )
        .unwrap();
        assert_eq!(parsed.pid, 2436);
        assert_eq!(parsed.ppid, 1);
        assert!(parsed.args.contains("cursor-agent"));
        assert!(parsed.args.ends_with(" acp") || parsed.args.ends_with("acp"));
        assert_eq!(parsed.harness_parent, None);
    }

    #[test]
    fn parse_ps_row_reads_harness_parent_from_env_tail() {
        let parsed = parse_ps_row(
            " 27129 21504 /Users/n/cursor-agent acp PATH=/usr/bin BYCODA_HARNESS_PARENT=21504 HOME=/tmp",
        )
        .unwrap();
        assert_eq!(parsed.pid, 27129);
        assert_eq!(parsed.ppid, 21504);
        assert_eq!(parsed.harness_parent, Some(21504));
    }

    #[test]
    fn parse_proc_ppid_skips_a_comm_holding_spaces_and_parens() {
        assert_eq!(
            parse_proc_ppid("2436 (cursor-agent) S 1 2436 2436 0 -1"),
            Some(1)
        );
        assert_eq!(
            parse_proc_ppid("2436 (Web Content (x)) S 21504 2436 0 -1"),
            Some(21504)
        );
        assert_eq!(parse_proc_ppid("2436 no-parens S 1"), None);
    }

    #[test]
    fn harness_parent_from_bytes_reads_the_marker() {
        let mut buf = b"PATH=/usr/bin\0".to_vec();
        buf.extend_from_slice(HARNESS_PARENT_ENV.as_bytes());
        buf.extend_from_slice(b"=21504\0HOME=/tmp\0");
        assert_eq!(harness_parent_from_bytes(&buf), Some(21504));
    }

    #[test]
    fn should_reap_marked_child_of_a_dead_parent() {
        let proc = row(
            10,
            1,
            "/Users/n/.local/bin/cursor-agent --use-system-ca index.js acp",
            Some(999),
        );
        assert!(should_reap_process(&proc, 42, |_| false));
        assert!(!should_reap_process(&proc, 42, |_| true));
    }

    #[test]
    fn should_not_reap_our_own_marked_child() {
        let proc = row(10, 42, "/Users/n/.local/bin/cursor-agent acp", Some(42));
        assert!(!should_reap_process(&proc, 42, |_| true));
    }

    #[test]
    fn should_not_reap_a_terminal_program_even_if_marked() {
        assert!(!should_reap_process(
            &row(10, 1, "tmux new -s work", Some(999)),
            42,
            |_| false,
        ));
        assert!(!should_reap_process(
            &row(11, 1, "npm start", Some(999)),
            42,
            |_| false,
        ));
        assert!(!should_reap_process(
            &row(12, 1, "-zsh", Some(999)),
            42,
            |_| false,
        ));
    }

    #[test]
    fn looks_like_harness_argv_accepts_agent_clis_only() {
        assert!(looks_like_harness_argv(
            "/Users/n/.local/bin/cursor-agent --use-system-ca index.js acp"
        ));
        assert!(looks_like_harness_argv(
            "/opt/homebrew/bin/node /Users/n/.local/share/cursor-agent/versions/x/index.js worker-server"
        ));
        assert!(looks_like_harness_argv("/Users/n/.local/bin/claude --help"));
        assert!(looks_like_harness_argv("/Users/n/.local/bin/hermes acp"));
        assert!(!looks_like_harness_argv("tmux new -s work"));
        assert!(!looks_like_harness_argv("npm start"));
        assert!(!looks_like_harness_argv(
            "node /Users/n/code/app/node_modules/typescript/lib/tsserver.js"
        ));
    }

    #[test]
    fn parse_ps_pid_command_does_not_treat_the_binary_as_ppid() {
        let (pid, command) = parse_ps_pid_command(
            " 27129 /Users/n/cursor-agent acp PATH=/usr/bin BYCODA_HARNESS_PARENT=21504 HOME=/tmp",
        )
        .unwrap();
        assert_eq!(pid, 27129);
        assert_eq!(harness_parent_from_bytes(command.as_bytes()), Some(21504));
    }

    #[test]
    fn should_reap_legacy_cursor_acp_orphaned_to_launchd() {
        let args = "/Users/n/.local/bin/cursor-agent --use-system-ca /Users/n/index.js acp";
        assert!(should_reap_process(&row(10, 1, args, None), 42, |_| false));
        assert!(!should_reap_process(&row(10, 42, args, None), 42, |_| true));
        assert!(!is_legacy_orphaned_cursor_acp(
            "node /usr/local/bin/typescript-language-server --stdio"
        ));
    }
}

#[cfg(test)]
mod native_output_integration_tests {
    // Real production batching/reader paths and an isolated owned test child.
    // Source/owner fixtures do not attest an actual GUI or applied/SQL state.
    use super::*;
    use crate::native_provider_output::EmissionState;

    struct RecipientWire {
        registry: NativeProviderOutputRegistry,
        store: Arc<crate::session_store::SessionStore>,
        output: Arc<NativeOutputStream>,
        recipient_owner: Arc<OutputOwner>,
        sent_metadata: Arc<Mutex<Option<OutputMetadata>>>,
        original_resources: Arc<tauri::ResourceTable>,
        recipient_resources: Arc<tauri::ResourceTable>,
        original: Arc<crate::native_window_lifecycle::NativeCheckpointWindow>,
        recipient: Arc<crate::native_window_lifecycle::NativeCheckpointWindow>,
        instance: uuid::Uuid,
    }
    impl RecipientWire {
        fn new(bound: bool) -> Self {
            use crate::native_window_lifecycle::{
                capture_checkpoint_resources, test_buffer_resources, with_checkpoint_resources,
            };
            use crate::session_store::{window_barrier::WindowBarrier, SessionStore};
            let store = Arc::new(SessionStore::open_in_memory().unwrap());
            let instance = store.native_instance_id();
            if bound {
                store.lock_conn().unwrap().execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at)
                  VALUES('logical','/isolated','fixture','fixture','supervised','fixture',1,1)", []).unwrap();
            }
            let barrier = WindowBarrier::new();
            barrier.admit_window("original").unwrap();
            barrier.admit_window("recipient").unwrap();
            let original_resources = Arc::new(test_buffer_resources(&barrier, "original"));
            let recipient_resources = Arc::new(test_buffer_resources(&barrier, "recipient"));
            let original =
                Arc::new(capture_checkpoint_resources(&original_resources, instance).unwrap());
            let recipient =
                Arc::new(capture_checkpoint_resources(&recipient_resources, instance).unwrap());
            let source = OutputSource::capture_owned_physical(
                store.clone(),
                if bound { "logical#wire" } else { "probe" },
                bound.then_some("logical"),
                OutputOwner::capture_resources(original_resources.clone(), instance),
            )
            .unwrap();
            let actual_recipient = recipient.clone();
            let actual_resources = recipient_resources.clone();
            let registry = NativeProviderOutputRegistry::new();
            let output = registry.begin_sse(
                source,
                Arc::new(move || {
                    with_checkpoint_resources(
                        &actual_recipient,
                        &actual_resources,
                        instance,
                        |_, _| Ok(()),
                    )
                    .is_ok()
                }),
                Arc::new(|_| true),
            );
            Self {
                registry,
                store,
                output,
                recipient_owner: OutputOwner::capture_resources(
                    recipient_resources.clone(),
                    instance,
                ),
                sent_metadata: Arc::new(Mutex::new(None)),
                original_resources,
                recipient_resources,
                original,
                recipient,
                instance,
            }
        }
        fn recipient_epoch(&self) -> Option<String> {
            crate::native_window_lifecycle::with_checkpoint_resources(
                &self.recipient,
                &self.recipient_resources,
                self.instance,
                |_, _| Ok(self.recipient.incarnation().to_string()),
            )
            .ok()
        }
        fn packet(&self) -> serde_json::Value {
            let items = vec![r#"{"type":"context","used":1}"#.to_string()];
            let (sent, received) = mpsc::channel();
            let receipt = self.output.reader(0);
            let output = self.output.clone();
            let recipient = self.recipient.clone();
            let resources = self.recipient_resources.clone();
            let instance = self.instance;
            let physical = self.recipient_owner.clone();
            let sent_metadata = self.sent_metadata.clone();
            let success = read_sse_batches(
                std::io::Cursor::new(format!("data: {}\n\n", items[0])),
                &AtomicBool::new(false),
                move |parsed| {
                    assert_eq!(parsed, items);
                    output.emit(OutputChannel::Sse, &parsed, |raw| {
                        // Ledger data intentionally has no recipient before routing.
                        assert!(raw.as_ref().unwrap().owner_epoch.is_none());
                        let epoch = crate::native_window_lifecycle::with_checkpoint_resources(
                            &recipient,
                            &resources,
                            instance,
                            |_, _| Ok(recipient.incarnation().to_string()),
                        )
                        .ok();
                        let owner = physical.current().then(|| physical.clone());
                        let observed = recipient_output_metadata(raw.clone(), epoch);
                        *sent_metadata.lock().unwrap() = observed.clone();
                        let enqueued = sent
                            .send(serde_json::json!({
                                "sessionId":output.observation().session_id,
                                "items":parsed,
                                "nativeOutput":observed,
                            }))
                            .is_ok();
                        output.observe_recipient_delivery(raw.as_ref(), owner, &parsed, enqueued);
                        enqueued
                    });
                },
            );
            receipt.finish(success, false);
            self.output.terminal_complete(success, false);
            self.output.terminal_delivery(true);
            let raw = self.output.observation();
            assert!(raw.owner_epoch.is_none());
            serde_json::json!({
                "expected":{"recipientEpoch":self.recipient.incarnation().to_string(),
                    "originalEpoch":self.original.incarnation().to_string(),
                    "logicalSessionId":raw.logical_session_id},
                "batch":received.recv_timeout(Duration::from_secs(3)).unwrap(),
                "terminal":{"sessionId":raw.session_id,
                    "nativeOutputState":recipient_output_state(raw, self.recipient_epoch())},
            })
        }
    }

    #[test]
    fn production_recipient_stamps_use_actual_native_resources_on_batch_and_state() {
        let fixture = RecipientWire::new(true);
        let packet = fixture.packet();
        let recipient = fixture.recipient.incarnation().to_string();
        assert_ne!(recipient, fixture.original.incarnation().to_string());
        for metadata in [
            &packet["batch"]["nativeOutput"],
            &packet["terminal"]["nativeOutputState"],
        ] {
            assert_eq!(metadata["ownerEpoch"], recipient);
            assert_eq!(metadata["sessionId"], "logical#wire");
            assert_eq!(metadata["logicalSessionId"], "logical");
            assert_eq!(metadata["qualified"], false);
        }
        assert_eq!(packet["batch"]["nativeOutput"]["available"], true);
        assert_eq!(packet["terminal"]["nativeOutputState"]["state"], "sealed");
        assert!(fixture.output.verified_emit_seal().unwrap().is_current());
        let claim = crate::native_provider_output::NativeInputClaim {
            version: 1,
            qualified: false,
            kind: "native-output-item-comparison".into(),
            batch: fixture.sent_metadata.lock().unwrap().clone().unwrap(),
            item_index: 0,
        };
        let input = fixture
            .registry
            .compare_recipient_input(
                &fixture.store,
                &fixture.recipient,
                &fixture.recipient_resources,
                &claim,
            )
            .unwrap();
        assert!(input.is_current(
            &fixture.store,
            &fixture.recipient,
            &fixture.recipient_resources
        ));
        assert_eq!(input.scope().recipient_epoch.to_string(), recipient);
        crate::native_window_lifecycle::test_reload_buffer_resources(&fixture.original_resources);
        assert!(fixture.recipient_epoch().is_some());
        // A current consumer cannot replace the private original source owner.
        assert!(fixture.output.verified_emit_seal().is_err());
        assert!(!input.is_current(
            &fixture.store,
            &fixture.recipient,
            &fixture.recipient_resources
        ));
    }

    #[test]
    fn recipient_reload_and_unbound_source_never_gain_available_wire_observations() {
        let fixture = RecipientWire::new(true);
        crate::native_window_lifecycle::test_reload_buffer_resources(&fixture.recipient_resources);
        let packet = fixture.packet();
        assert!(packet["batch"]["nativeOutput"]["ownerEpoch"].is_null());
        assert_eq!(packet["batch"]["nativeOutput"]["available"], false);
        assert_eq!(
            packet["terminal"]["nativeOutputState"]["state"],
            "unavailable"
        );
        let unbound = RecipientWire::new(false).packet();
        assert!(unbound["batch"]["nativeOutput"]["ownerEpoch"].is_string());
        assert!(unbound["batch"]["nativeOutput"]
            .get("logicalSessionId")
            .is_none());
        assert_eq!(unbound["batch"]["nativeOutput"]["available"], false);
        assert_eq!(
            unbound["batch"]["nativeOutput"]["unavailableReason"],
            "session-unbound"
        );
    }

    #[test]
    #[ignore = "owned isolated Native wire fixture; Root consumes bytes via JS observer"]
    fn owned_native_recipient_wire_fixture() {
        let bound = RecipientWire::new(true).packet();
        let unknown = RecipientWire::new(true);
        crate::native_window_lifecycle::test_reload_buffer_resources(&unknown.recipient_resources);
        let unknown = unknown.packet();
        let unbound = RecipientWire::new(false).packet();
        println!("NATIVE_OUTPUT_RECIPIENT_WIRE");
        println!(
            "{}",
            serde_json::json!({"version":1,"qualified":false,"bound":bound,"unknownRecipient":unknown,"unbound":unbound})
        );
    }

    fn logical_source(route: &str) -> OutputSource {
        use crate::session_store::window_barrier::{NativeLane, WindowBarrier};
        let store = Arc::new(crate::session_store::SessionStore::open_in_memory().unwrap());
        store.lock_conn().unwrap().execute(
            "INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at)
             VALUES('logical','/isolated','antigravity','test','approval-required','test',1,1)", []
        ).unwrap();
        let barrier = WindowBarrier::new();
        let window = barrier.admit_window("physical-output-test").unwrap();
        barrier.confirm_created(&window).unwrap();
        OutputSource::capture_owned(
            store,
            route,
            Some("logical"),
            Arc::new(move || {
                barrier
                    .begin_native_write(&window, NativeLane::Buffers)
                    .is_ok_and(|work| work.finish::<_, ()>(Ok(())).is_ok())
            }),
        )
        .unwrap()
    }

    #[test]
    fn live_route_lookup_and_authority_idle_use_only_retained_logical_construction() {
        let host = HarnessHost::new();
        let output = host.output.begin_sse(
            logical_source("logical#sse"),
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        host.insert_sse(
            "logical#sse".into(),
            Arc::new(LiveSse {
                stop: Arc::new(AtomicBool::new(false)),
                issuer: None,
                owners: Arc::new(Owners::new("fixture")),
                output: Some(output.clone()),
                native_session_capability: None,
            }),
        );
        assert_eq!(
            host.output_for_route("logical#sse")
                .unwrap()
                .unwrap()
                .target(),
            "logical"
        );
        assert!(host.output_for_route("logical#another").unwrap().is_none());
        assert_eq!(host.native_output_target_streams("logical").len(), 1);
        assert!(host.native_output_streams("logical").is_empty());
        assert!(host.authority_idle("logical").is_err());
        assert!(host.authority_idle("unrelated").is_ok());
        host.stop_sse("logical#sse");
        assert!(host.output_for_route("logical#sse").unwrap().is_none());
        assert!(host.authority_idle("logical").is_ok());
        assert_eq!(output.observation().state, EmissionState::Unavailable);
    }

    #[test]
    fn exact_process_owner_cannot_settle_another_stream_even_with_same_route() {
        let host = HarnessHost::new();
        let spawn = || {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .arg("--list")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            isolate_child(&mut command);
            command.spawn().unwrap()
        };
        let (a, process_a) = host.output.begin_process(
            logical_source("logical#same"),
            spawn(),
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        let (b, process_b) = host.output.begin_process(
            logical_source("logical#same"),
            spawn(),
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        assert_ne!(a.epoch(), b.epoch());
        for output in [&a, &b] {
            output.reader(0).finish(true, false);
            output.reader(1).finish(true, false);
            output.terminal_delivery(true);
        }
        assert!(process_b.wait(&a, false).is_err());
        assert_eq!(a.observation().state, EmissionState::Unsealed);
        assert!(process_a.wait(&a, false).unwrap().success());
        assert!(a.verified_emit_seal().unwrap().is_current());
        assert_eq!(b.observation().state, EmissionState::Unsealed);
        assert!(process_b.wait(&b, false).unwrap().success());
        assert!(b.verified_emit_seal().unwrap().is_current());
    }

    fn stream(host: &HarnessHost, kind: StreamKind, pid: Option<u32>) -> Arc<NativeOutputStream> {
        host.output.begin(
            OutputSource::fixture("output-fixture"),
            kind,
            pid,
            if kind == StreamKind::Process { 2 } else { 1 },
            Arc::new(|| true),
            Arc::new(|_| true),
        )
    }

    #[test]
    fn ordinary_kill_all_preserves_tracking_for_later_actual_reader_lifetimes() {
        let host = HarnessHost::new();
        let old = stream(&host, StreamKind::Sse, None);
        host.kill_all();
        let new = stream(&host, StreamKind::Sse, None);
        assert_ne!(old.epoch(), new.epoch());
        new.reader(0).finish(true, false);
        new.terminal_complete(true, false);
        new.terminal_delivery(true);
        assert_eq!(new.observation().state, EmissionState::Sealed);
        assert_eq!(host.native_output_streams("output-fixture").len(), 2);
    }

    struct HeldReader {
        first: std::io::Cursor<Vec<u8>>,
        release: mpsc::Receiver<()>,
    }
    impl Read for HeldReader {
        fn read(&mut self, into: &mut [u8]) -> std::io::Result<usize> {
            let read = self.first.read(into)?;
            if read == 0 {
                self.release
                    .recv()
                    .map_err(|_| std::io::Error::other("fixture release lost"))?;
            }
            Ok(read)
        }
    }

    #[test]
    fn real_reader_retains_pending_after_terminal_and_legacy_grace_until_actual_eof() {
        let host = HarnessHost::new();
        let output = stream(&host, StreamKind::Process, Some(123));
        let (release, held) = mpsc::channel();
        let (emitted, delivery) = mpsc::channel();
        let (done, all_done) = mpsc::channel();
        let receipt = output.reader(0);
        output.reader(1).finish(true, false);
        let worker_stream = output.clone();
        let worker = thread::spawn(move || {
            let completed = read_provider_lines(
                HeldReader {
                    first: std::io::Cursor::new(b"exact retained\n".to_vec()),
                    release: held,
                },
                receipt,
                move |items| {
                    worker_stream.emit(OutputChannel::Stdout, &items, |metadata| {
                        emitted.send((items.clone(), metadata.unwrap())).is_ok()
                    })
                },
            );
            drop(done);
            completed
        });
        let (items, metadata) = delivery.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(items, ["exact retained"]);
        assert_eq!(metadata.sequence, 1);
        output.terminal_complete(true, false);
        output.terminal_delivery(true);
        assert!(!wait_for_readers(&all_done, Duration::from_millis(10)));
        assert_eq!(output.observation().state, EmissionState::Unsealed);
        assert!(output.verified_emit_seal().is_err());
        release.send(()).unwrap();
        assert!(worker.join().unwrap());
        assert!(output.verified_emit_seal().unwrap().is_current());
    }

    struct FailedReader;
    impl Read for FailedReader {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("fixture read failure"))
        }
    }

    #[test]
    fn actual_read_error_and_batch_worker_panic_never_claim_successful_flush() {
        for panic in [false, true] {
            let host = HarnessHost::new();
            let output = stream(&host, StreamKind::Process, Some(123));
            let receipt = output.reader(0);
            output.reader(1).finish(true, false);
            let success = if panic {
                read_provider_lines(std::io::Cursor::new("line\n"), receipt, |_| {
                    panic!("fixture enqueue panic")
                })
            } else {
                read_provider_lines(FailedReader, receipt, |_| unreachable!())
            };
            assert!(!success);
            output.terminal_complete(true, false);
            output.terminal_delivery(true);
            assert_eq!(output.observation().state, EmissionState::Unavailable);
        }
    }

    #[test]
    fn production_sse_parser_flushes_exact_events_and_reports_trailing_loss_or_cancel() {
        for (input, cancelled, expected, success) in [
            (
                ": comment\ndata: 漢\ndata: second\n\ndata: [DONE]\n\n",
                false,
                vec!["漢\nsecond", "[DONE]"],
                true,
            ),
            (
                "data: retained\n\ndata: not terminated\n",
                false,
                vec!["retained"],
                false,
            ),
            ("data: cancelled\n\n", true, vec![], false),
        ] {
            let host = HarnessHost::new();
            let output = stream(&host, StreamKind::Sse, None);
            let receipt = output.reader(0);
            let sending = output.clone();
            let (sent, received) = mpsc::channel();
            let result = read_sse_batches(
                std::io::Cursor::new(input),
                &AtomicBool::new(cancelled),
                move |items| {
                    sending.emit(OutputChannel::Sse, &items, |metadata| {
                        sent.send((items.clone(), metadata.unwrap())).is_ok()
                    });
                },
            );
            assert_eq!(result, success);
            receipt.finish(result, cancelled);
            output.terminal_complete(result, cancelled);
            output.terminal_delivery(true);
            let received: Vec<_> = received
                .try_iter()
                .flat_map(|(items, metadata)| {
                    assert_eq!(metadata.channel, OutputChannel::Sse);
                    items
                })
                .collect();
            assert_eq!(received, expected);
            assert_eq!(
                output.observation().state,
                if success {
                    EmissionState::Sealed
                } else {
                    EmissionState::Unavailable
                }
            );
        }
    }

    #[test]
    #[ignore = "owned isolated child entry; invoked only by actual_output_child_pipes_settle"]
    fn owned_output_child() {
        println!("NATIVE_OUTPUT_STDOUT 漢🦀");
        eprintln!("NATIVE_OUTPUT_STDERR preserved");
    }

    #[test]
    fn actual_output_child_pipes_settle_only_with_real_wait_and_both_eof() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "harness::native_output_integration_tests::owned_output_child",
                "--ignored",
                "--nocapture",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let native = RecipientWire::new(true);
        let original =
            OutputOwner::capture_resources(native.original_resources.clone(), native.instance);
        let source = OutputSource::capture_owned_physical(
            native.store.clone(),
            "logical#actual-owned-child",
            Some("logical"),
            original,
        )
        .unwrap();
        let mut child = command.spawn().unwrap();
        let host = HarnessHost::new();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let current = native.recipient_owner.clone();
        let (output, child) = host.output.begin_process(
            source,
            child,
            Arc::new(move || current.current()),
            Arc::new(|_| true),
        );
        let (sent, received) = mpsc::channel();
        let jobs = [
            (
                OutputChannel::Stdout,
                Box::new(stdout) as Box<dyn Read + Send>,
            ),
            (
                OutputChannel::Stderr,
                Box::new(stderr) as Box<dyn Read + Send>,
            ),
        ]
        .into_iter()
        .enumerate()
        .map(|(slot, (channel, reader))| {
            let receipt = output.reader(slot as u8);
            let output = output.clone();
            let sent = sent.clone();
            let recipient = native.recipient_owner.clone();
            thread::spawn(move || {
                read_provider_lines(reader, receipt, move |items| {
                    output.emit(channel, &items, |metadata| {
                        let raw = metadata.unwrap();
                        let owner = recipient.current().then(|| recipient.clone());
                        let observed = recipient_output_metadata(
                            Some(raw.clone()),
                            owner.as_ref().map(|owner| owner.epoch()),
                        )
                        .unwrap();
                        let enqueued = sent.send((channel, items.clone(), observed)).is_ok();
                        output.observe_recipient_delivery(Some(&raw), owner, &items, enqueued);
                        enqueued
                    })
                })
            })
        })
        .collect::<Vec<_>>();
        drop(sent);
        let exit = child.wait(&output, false).unwrap();
        assert!(exit.success());
        // This is a fixture queue acceptance, never a real GUI applied ACK.
        output.terminal_delivery(true);
        for job in jobs {
            assert!(job.join().unwrap());
        }
        let emitted: Vec<_> = received.into_iter().collect();
        assert!(emitted.iter().all(|(_, _, metadata)| metadata.session_id
            == "logical#actual-owned-child"
            && metadata.logical_session_id.as_deref() == Some("logical")
            && !metadata.qualified));
        assert!(emitted
            .iter()
            .any(|(channel, items, _)| *channel == OutputChannel::Stdout
                && items
                    .iter()
                    .any(|line| line.contains("NATIVE_OUTPUT_STDOUT 漢🦀"))));
        assert!(emitted
            .iter()
            .any(|(channel, items, _)| *channel == OutputChannel::Stderr
                && items
                    .iter()
                    .any(|line| line.contains("NATIVE_OUTPUT_STDERR preserved"))));
        assert_eq!(
            emitted
                .iter()
                .map(|(_, _, meta)| meta.sequence)
                .collect::<Vec<_>>(),
            (1..=emitted.len() as u64).collect::<Vec<_>>()
        );
        assert!(output.verified_emit_seal().unwrap().is_current());
        let claim = crate::native_provider_output::NativeInputClaim {
            version: 1,
            qualified: false,
            kind: "native-output-item-comparison".into(),
            batch: emitted[0].2.clone(),
            item_index: 0,
        };
        let input = host
            .output
            .compare_recipient_input(
                &native.store,
                &native.recipient,
                &native.recipient_resources,
                &claim,
            )
            .unwrap();
        assert!(input.is_current(
            &native.store,
            &native.recipient,
            &native.recipient_resources
        ));
        assert_eq!(input.scope().item_utf8_bytes, emitted[0].1[0].len());
        let prepared = host
            .prepare_native_output_inputs(&native.store, "logical", &native.recipient, &[claim])
            .unwrap();
        crate::native_window_lifecycle::with_checkpoint_owner_group(
            &prepared.owners(),
            native.instance,
            |owners| {
                prepared.with_stable_inputs(&owners, |stable| {
                    crate::session_store::authority::with_full_projection_transaction(
                        &native.store,
                        |tx| {
                            stable.validate_at(&native.store, &tx, |inputs| {
                                assert_eq!(inputs.logical_target(), "logical");
                                assert_eq!(inputs.len(), 1);
                                assert_eq!(inputs.scope(0).unwrap().stream_epoch, output.epoch());
                                assert_eq!(
                                    inputs.scope(0).unwrap().item_utf8_bytes,
                                    emitted[0].1[0].len()
                                );
                                Ok(())
                            })
                        },
                    )
                })
            },
        )
        .unwrap();
    }
}

#[cfg(test)]
mod line_batch_tests;
