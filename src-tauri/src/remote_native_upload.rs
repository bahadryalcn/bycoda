//! Process-owned upload intents. Channel/window teardown releases a waiter, never
//! an uncertain upload identity or an already admitted Native buffer update.
use super::native_workspace_transport::{NativeWorkspaceChannel, NativeWorkspaceResponse};
use super::*;
use base64::Engine;
use std::io::{self, Write};
use std::time::{Duration, Instant};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const CHUNK_BYTES: usize = 65_536;
const MAX_INTENTS: usize = 128;
const MAX_ROUTE_INTENTS: usize = 32;
const MAX_ACTIVE: usize = 8;
const MAX_ROUTE_ACTIVE: usize = 2;
const STATUS_RESERVE: Duration = Duration::from_secs(2);

#[derive(Clone, Hash, PartialEq, Eq)]
struct UploadKey {
    route: String,
    digest: String,
    bytes: usize,
    original_id: Option<String>,
    delivery: Option<DeliveryBinding>,
}

#[derive(Clone, Hash, PartialEq, Eq)]
pub(super) struct DeliveryBinding {
    pub(super) original_id: String,
    pub(super) sha256: String,
    pub(super) byte_length: usize,
}
impl DeliveryBinding {
    pub(super) fn value(&self) -> Value {
        json!({"originalId":self.original_id,"sha256":self.sha256,"byteLength":self.byte_length})
    }
    fn matches(&self, value: &Value) -> bool {
        value["originalId"] == self.original_id
            && value["sha256"] == self.sha256
            && value["byteLength"] == self.byte_length
    }
}

pub(super) enum CommitTransition {
    Possible,
    DefinitelyUnsent,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    New,
    Staging,
    CommitPossible,
    Completed,
    Terminal,
}

#[derive(Clone)]
struct Intent {
    id: String,
    phase: Phase,
    in_flight: bool,
}

#[derive(Default)]
struct Registry {
    entries: HashMap<UploadKey, Intent>,
    active: usize,
    active_routes: HashMap<String, usize>,
}

#[derive(Default)]
pub(super) struct NativeUploads {
    registry: Mutex<Registry>,
}

struct ActiveSlot {
    owner: Arc<NativeUploads>,
    route: String,
}

impl NativeUploads {
    /// A later durable-status consumer may finish after the staging lease was
    /// dropped. Retire only its exact completed, no-longer-active metadata.
    pub(super) fn applied_original(&self, route: &str, binding: &DeliveryBinding) {
        if let Ok(mut state) = self.registry.lock() {
            state.entries.retain(|key, intent| {
                !(key.route == route
                    && key.delivery.as_ref() == Some(binding)
                    && intent.phase == Phase::Completed
                    && !intent.in_flight)
            });
        }
    }

    fn reserve(self: &Arc<Self>, route: String) -> Result<ActiveSlot, String> {
        let mut state = self.registry.lock().map_err(|_| locked())?;
        if state.active >= MAX_ACTIVE
            || state.active_routes.get(&route).copied().unwrap_or(0) >= MAX_ROUTE_ACTIVE
        {
            return Err(
                "Native buffer uploads are busy; retain the original report and retry".into(),
            );
        }
        state.active += 1;
        *state.active_routes.entry(route.clone()).or_default() += 1;
        Ok(ActiveSlot {
            owner: self.clone(),
            route,
        })
    }

    fn claim(self: &Arc<Self>, slot: ActiveSlot, bytes: &[u8]) -> Result<UploadLease, String> {
        self.claim_original(slot, bytes, None, None)
    }

    fn claim_original(
        self: &Arc<Self>,
        slot: ActiveSlot,
        bytes: &[u8],
        original_id: Option<String>,
        delivery: Option<DeliveryBinding>,
    ) -> Result<UploadLease, String> {
        let key = UploadKey {
            route: slot.route.clone(),
            digest: format!("{:x}", Sha256::digest(bytes)),
            bytes: bytes.len(),
            original_id,
            delivery,
        };
        if key.delivery.as_ref().is_some_and(|binding| {
            binding.byte_length != key.bytes
                || binding.sha256 != key.digest
                || key.original_id.as_deref() != Some(binding.original_id.as_str())
        }) {
            return Err("Native buffer original delivery bytes changed".into());
        }
        let mut state = self.registry.lock().map_err(|_| locked())?;
        if let Some(entry) = state.entries.get_mut(&key) {
            if entry.in_flight {
                return Err("The identical Native buffer upload is already in progress".into());
            }
            entry.in_flight = true;
        } else {
            if state.entries.len() >= MAX_INTENTS
                || state
                    .entries
                    .keys()
                    .filter(|entry| entry.route == key.route)
                    .count()
                    >= MAX_ROUTE_INTENTS
            {
                return Err("Native buffer upload recovery capacity is full; pending outcomes remain retained".into());
            }
            state.entries.insert(
                key.clone(),
                Intent {
                    id: key
                        .original_id
                        .clone()
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    phase: Phase::New,
                    in_flight: true,
                },
            );
        }
        let id = state.entries[&key].id.clone();
        drop(state);
        Ok(UploadLease { slot, key, id })
    }
}

impl Drop for ActiveSlot {
    fn drop(&mut self) {
        if let Ok(mut state) = self.owner.registry.lock() {
            state.active = state.active.saturating_sub(1);
            if let Some(count) = state.active_routes.get_mut(&self.route) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    state.active_routes.remove(&self.route);
                }
            }
        }
    }
}

pub(super) struct UploadLease {
    slot: ActiveSlot,
    key: UploadKey,
    id: String,
}

impl UploadLease {
    fn phase(&self) -> Result<Phase, String> {
        let state = self.slot.owner.registry.lock().map_err(|_| locked())?;
        state
            .entries
            .get(&self.key)
            .filter(|entry| entry.id == self.id)
            .map(|entry| entry.phase)
            .ok_or_else(locked)
    }

    fn set_phase(&self, phase: Phase) -> Result<(), String> {
        let mut state = self.slot.owner.registry.lock().map_err(|_| locked())?;
        let entry = state
            .entries
            .get_mut(&self.key)
            .filter(|entry| entry.id == self.id)
            .ok_or_else(locked)?;
        entry.phase = phase;
        Ok(())
    }

    /// Only the successful final Native consumer may retire this exact intent.
    pub(super) fn applied(self) {
        if let Ok(mut state) = self.slot.owner.registry.lock() {
            if state
                .entries
                .get(&self.key)
                .is_some_and(|entry| entry.id == self.id && entry.phase == Phase::Completed)
            {
                state.entries.remove(&self.key);
            }
        }
    }

    fn validate(&self, value: &Value) -> Result<Progress, String> {
        if value["uploadId"] != self.id
            || value["byteLength"] != self.key.bytes
            || value["sha256"] != self.key.digest
        {
            return Err("Native buffer upload identity changed".into());
        }
        match (&self.key.delivery, value.get("delivery")) {
            (Some(binding), Some(value)) if binding.matches(value) => {}
            (None, None) => {}
            _ => return Err("Native buffer upload original delivery changed".into()),
        }
        let received = value["receivedBytes"]
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value <= self.key.bytes)
            .ok_or("Native buffer upload byte count is invalid")?;
        let state = value["state"]
            .as_str()
            .ok_or("Native buffer upload state is invalid")?;
        let state = match state {
            "receiving" => UploadState::Receiving,
            "committing" => UploadState::Committing,
            "completed" => UploadState::Completed,
            "failed" | "aborted" => UploadState::Terminal,
            _ => return Err("Native buffer upload state is invalid".into()),
        };
        if matches!(state, UploadState::Committing | UploadState::Completed)
            && received != self.key.bytes
        {
            return Err("Native buffer upload has incomplete original bytes".into());
        }
        if state == UploadState::Completed {
            let result = &value["result"];
            let acknowledged = match &self.key.delivery {
                Some(binding) => {
                    binding.matches(result)
                        && result["state"] == "recorded"
                        && result["result"]["acknowledged"] == true
                }
                None => result["acknowledged"] == true,
            };
            if !acknowledged {
                return Err("Native buffer upload did not acknowledge its original update".into());
            }
        }
        Ok(Progress { state, received })
    }
}

impl Drop for UploadLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.slot.owner.registry.lock() {
            if let Some(entry) = state
                .entries
                .get_mut(&self.key)
                .filter(|entry| entry.id == self.id)
            {
                entry.in_flight = false;
            }
        }
    }
}

fn locked() -> String {
    "Native buffer upload recovery state is unavailable".into()
}
fn unknown() -> String {
    "Native buffer upload outcome remains unknown; its original identity is retained".into()
}

struct BoundedBytes(Vec<u8>);
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_BYTES.saturating_sub(self.0.len()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Native buffer upload limit exceeded",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn capture(params: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = BoundedBytes(Vec::new());
    serde_json::to_writer(&mut bytes, params)
        .map_err(|_| "Native buffer request exceeds its bounded original-byte limit")?;
    if bytes.0.is_empty() {
        return Err("Native buffer upload has no original bytes".into());
    }
    Ok(bytes.0)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UploadState {
    Receiving,
    Committing,
    Completed,
    Terminal,
}
struct Progress {
    state: UploadState,
    received: usize,
}

#[derive(Clone, Copy)]
struct Budget {
    deadline: Instant,
    work: Instant,
}
impl Budget {
    fn new(start: Instant) -> Self {
        Self {
            deadline: start + DEFAULT_RPC_TIMEOUT,
            work: start + DEFAULT_RPC_TIMEOUT - STATUS_RESERVE,
        }
    }
}

trait UploadPort {
    type Reply;
    fn wire(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<Self::Reply, WsFailure>;
    fn inspect<T>(
        &self,
        reply: &Self::Reply,
        project: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String>;
    fn acknowledged(&self, reply: Self::Reply) -> Self::Reply;
    fn current(&self) -> Result<(), String>;
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn pause(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

struct ChannelPort<'a>(&'a NativeWorkspaceChannel);
impl UploadPort for ChannelPort<'_> {
    type Reply = NativeRecoveryReply;
    fn wire(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<Self::Reply, WsFailure> {
        let deadline = options
            .absolute_deadline
            .unwrap_or_else(|| Instant::now() + DEFAULT_RPC_TIMEOUT);
        if self.0.caller.is_some() {
            match self.0.wire(method, params.clone(), options) {
                Ok(reply) => return Ok(reply),
                Err(error) if error.unsupported && !error.uncertain => {}
                Err(error) => return Err(error),
            }
        }
        self.0
            .selection
            .with_current(|| Ok(()))
            .map_err(|message| WsFailure::local("RPC_NATIVE_ROUTE_RETIRED", &message))?;
        let machine = &self.0.selection.machine;
        let value = rpc_until(
            &machine.endpoint,
            &machine.token,
            Some(&machine.environment_id),
            method,
            params,
            deadline,
        )
        .map_err(|message| {
            let mut error = WsFailure::local("RPC_NATIVE_HTTP_UNCONFIRMED", &message);
            error.uncertain = HostWsBroker::method_has_effect(method);
            error
        })?;
        Ok(NativeRecoveryReply {
            value,
            guard: None,
            selection: self.0.selection.clone(),
        })
    }
    fn inspect<T>(
        &self,
        reply: &Self::Reply,
        project: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        reply.inspect(project)
    }
    fn acknowledged(&self, mut reply: Self::Reply) -> Self::Reply {
        reply.value = reply.value["result"].clone();
        reply
    }
    fn current(&self) -> Result<(), String> {
        self.0.selection.with_current(|| Ok(()))
    }
}

fn call<P: UploadPort>(
    port: &P,
    method: &str,
    params: Value,
    deadline: Instant,
) -> Result<P::Reply, WsFailure> {
    let remaining = deadline
        .checked_duration_since(port.now())
        .filter(|value| !value.is_zero())
        .ok_or_else(|| WsFailure::local("RPC_NATIVE_UPLOAD_DEADLINE", &unknown()))?;
    port.wire(
        method,
        params,
        RequestOptions {
            response_timeout: Some(remaining),
            absolute_deadline: Some(deadline),
            ..RequestOptions::default()
        },
    )
}

fn progress<P: UploadPort>(
    port: &P,
    lease: &UploadLease,
    reply: &P::Reply,
) -> Result<Progress, String> {
    let progress = port.inspect(reply, |value| lease.validate(value))?;
    match progress.state {
        UploadState::Completed => lease.set_phase(Phase::Completed)?,
        UploadState::Committing => lease.set_phase(Phase::CommitPossible)?,
        UploadState::Terminal => lease.set_phase(Phase::Terminal)?,
        UploadState::Receiving if lease.phase()? == Phase::New => {
            lease.set_phase(Phase::Staging)?
        }
        UploadState::Receiving => {}
    }
    Ok(progress)
}

fn status<P: UploadPort>(
    port: &P,
    lease: &UploadLease,
    deadline: Instant,
) -> Result<P::Reply, String> {
    call(
        port,
        "native.buffers.upload.status",
        json!({"uploadId":lease.id}),
        deadline,
    )
    .map_err(native_ws_failure)
}

fn absent<P: UploadPort>(port: &P, reply: &P::Reply) -> Result<bool, String> {
    port.inspect(reply, |value| Ok(value.is_null()))
}

fn start<P: UploadPort>(port: &P, lease: &UploadLease, budget: Budget) -> Result<P::Reply, String> {
    lease.set_phase(Phase::Staging)?;
    let mut params = json!({
        "uploadId":lease.id,"byteLength":lease.key.bytes,"sha256":lease.key.digest,
    });
    if let Some(binding) = &lease.key.delivery {
        params["delivery"] = binding.value();
    }
    match call(port, "native.buffers.upload.start", params, budget.work) {
        Ok(reply) => Ok(reply),
        Err(error) => {
            if !error.uncertain {
                lease.set_phase(Phase::New)?;
            }
            // One mutation attempt per stage. A failed status or authoritative
            // absence retains the same identity for the next channel's recovery.
            let reply =
                status(port, lease, budget.deadline).map_err(|_| native_ws_failure(error))?;
            if absent(port, &reply)? {
                Err(unknown())
            } else {
                Ok(reply)
            }
        }
    }
}

fn settle<P: UploadPort>(
    port: &P,
    lease: &UploadLease,
    mut reply: P::Reply,
    budget: Budget,
) -> Result<P::Reply, String> {
    loop {
        if absent(port, &reply)? {
            return Err(unknown());
        }
        let state = progress(port, lease, &reply)?;
        if state.state == UploadState::Completed {
            return Ok(port.acknowledged(reply));
        }
        if state.state == UploadState::Terminal {
            return Err(unknown());
        }
        // Once commit could have reached the Host, even a receiving snapshot may
        // precede that request's admission. It never permits abort or commit replay.
        if lease.phase()? != Phase::CommitPossible {
            return Err(unknown());
        }
        port.current()?;
        let remaining = budget
            .deadline
            .checked_duration_since(port.now())
            .filter(|value| !value.is_zero())
            .ok_or_else(unknown)?;
        port.pause(remaining.min(Duration::from_millis(50)));
        reply = status(port, lease, budget.deadline)?;
    }
}

fn run<P: UploadPort>(
    port: &P,
    lease: UploadLease,
    bytes: &[u8],
    budget: Budget,
) -> Result<(P::Reply, UploadLease), String> {
    run_original(port, lease, bytes, budget, None)
}

fn run_original<P: UploadPort>(
    port: &P,
    lease: UploadLease,
    bytes: &[u8],
    budget: Budget,
    mut transition: Option<&mut dyn FnMut(CommitTransition) -> Result<(), String>>,
) -> Result<(P::Reply, UploadLease), String> {
    let mut reply = if lease.phase()? == Phase::New {
        start(port, &lease, budget)?
    } else {
        let reply = status(port, &lease, budget.deadline)?;
        if absent(port, &reply)? {
            // Null is an authenticated owner result, not an RPC/auth failure or
            // a local-clock inference. Never restart a possibly committed update.
            if lease.phase()? != Phase::Staging {
                return Err(unknown());
            }
            start(port, &lease, budget)?
        } else {
            reply
        }
    };
    let mut state = progress(port, &lease, &reply)?;
    if state.state != UploadState::Receiving
        || !matches!(lease.phase()?, Phase::New | Phase::Staging)
    {
        let reply = settle(port, &lease, reply, budget)?;
        return Ok((reply, lease));
    }
    while state.received < bytes.len() {
        let offset = state.received;
        let end = (offset + CHUNK_BYTES).min(bytes.len());
        reply = match call(
            port,
            "native.buffers.upload.write",
            json!({
                "uploadId":lease.id,"offset":offset,
                "data":base64::engine::general_purpose::STANDARD.encode(&bytes[offset..end]),
            }),
            budget.work,
        ) {
            Ok(reply) => reply,
            Err(error) => {
                status(port, &lease, budget.deadline).map_err(|_| native_ws_failure(error))?
            }
        };
        state = progress(port, &lease, &reply)?;
        if state.state != UploadState::Receiving || state.received != end {
            return Err(unknown());
        }
    }
    if let Some(transition) = transition.as_mut() {
        transition(CommitTransition::Possible)?;
    }
    lease.set_phase(Phase::CommitPossible)?;
    reply = match call(
        port,
        "native.buffers.upload.commit",
        json!({"uploadId":lease.id}),
        budget.work,
    ) {
        Ok(reply) => reply,
        Err(error) => {
            // Only a proven pre-dispatch rejection permits a later same-ID commit.
            // This invocation still uses status rather than retrying the mutation.
            if !error.uncertain {
                lease.set_phase(Phase::Staging)?;
                if let Some(transition) = transition.as_mut() {
                    transition(CommitTransition::DefinitelyUnsent)?;
                }
            }
            status(port, &lease, budget.deadline).map_err(|_| native_ws_failure(error))?
        }
    };
    let reply = settle(port, &lease, reply, budget)?;
    Ok((reply, lease))
}

pub(super) fn upload_buffers(
    channel: &NativeWorkspaceChannel,
    params: Value,
) -> Result<NativeWorkspaceResponse, String> {
    let budget = Budget::new(Instant::now());
    channel.selection.with_current(|| Ok(()))?;
    // The fingerprint covers actual saved machine/environment/endpoint/credential
    // context. Route retirement epochs are not new upload identities on reconnect.
    let route = ws_fingerprint(&channel.selection.machine);
    let slot = channel.pending.reserve(route)?;
    let bytes = capture(&params)?;
    let lease = channel.pending.claim(slot, &bytes)?;
    let (reply, lease) = run(&ChannelPort(channel), lease, &bytes, budget)?;
    Ok(NativeWorkspaceResponse {
        reply,
        upload: Some(lease),
    })
}

/// The durable original remains outside this process-only staging registry.
/// Only original raw bytes are staged; wrapper JSON escaping never shrinks the
/// old payload limit. The caller commits its FULL intent before commit dispatch.
pub(super) fn upload_buffers_original(
    channel: &NativeWorkspaceChannel,
    bytes: &[u8],
    original_id: &str,
    delivery: Option<DeliveryBinding>,
    transition: &mut dyn FnMut(CommitTransition) -> Result<(), String>,
) -> Result<NativeWorkspaceResponse, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Native buffer request exceeds its bounded original-byte limit".into());
    }
    let budget = Budget::new(Instant::now());
    channel.selection.with_current(|| Ok(()))?;
    let slot = channel
        .pending
        .reserve(ws_fingerprint(&channel.selection.machine))?;
    let lease = channel
        .pending
        .claim_original(slot, bytes, Some(original_id.into()), delivery)?;
    let (reply, lease) = run_original(
        &ChannelPort(channel),
        lease,
        bytes,
        budget,
        Some(transition),
    )?;
    Ok(NativeWorkspaceResponse {
        reply,
        upload: Some(lease),
    })
}

#[cfg(test)]
#[path = "remote_native_upload_tests.rs"]
mod tests;
