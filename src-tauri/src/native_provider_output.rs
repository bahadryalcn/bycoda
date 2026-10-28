//! Native emission receipts. These never attest renderer application or SQL.
//! Public DTOs are observations; only retained, revalidated native handles can
//! produce an opaque emit seal. No type here can qualify actors or writers.
#![allow(dead_code)] // Applied/checkpoint composition is separately owned.

use crate::native_window_lifecycle::{self, NativeCheckpointWindow};
use crate::session_store::{authority::StoreIdentity, SessionStore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::process::{Child, ExitStatus};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const MAX_STREAMS: usize = 512;
const MAX_RECORDS: usize = 4096;
const MAX_TOTAL_RECORDS: usize = 32768;
const MAX_BATCH_BYTES: usize = 1024 * 1024;
const MAX_BATCH_ITEMS: usize = 4096;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
static RECORDS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum UnavailableReason {
    SourceUnavailable,
    SourceChanged,
    SessionUnbound,
    OwnerUnavailable,
    BroadcastOwner,
    EmitFailed,
    ReaderError,
    ReaderAbandoned,
    TerminalError,
    TerminalCancelled,
    BatchCapacity,
    SequenceExhausted,
    RetentionCapacity,
    StatePoisoned,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum OutputChannel {
    Stdout,
    Stderr,
    Sse,
}
impl OutputChannel {
    fn byte(self) -> u8 {
        match self {
            Self::Stdout => 1,
            Self::Stderr => 2,
            Self::Sse => 3,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StreamKind {
    Process,
    Sse,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputMetadata {
    pub(crate) version: u8,
    pub(crate) qualified: bool,
    pub(crate) process_epoch: String,
    pub(crate) stream_epoch: String,
    pub(crate) stream_kind: StreamKind,
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) logical_session_id: Option<String>,
    pub(crate) source_store_id: Option<String>,
    pub(crate) source_profile_id: Option<String>,
    pub(crate) store_instance: Option<String>,
    pub(crate) process_id: Option<u32>,
    pub(crate) owner_epoch: Option<String>,
    pub(crate) sequence: u64,
    pub(crate) channel: OutputChannel,
    pub(crate) item_count: usize,
    pub(crate) utf8_bytes: usize,
    pub(crate) payload_sha256: String,
    pub(crate) digest_encoding: &'static str,
    pub(crate) available: bool,
    pub(crate) unavailable_reason: Option<UnavailableReason>,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum EmissionState {
    Sealed,
    Unsealed,
    Unavailable,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputState {
    pub(crate) version: u8,
    pub(crate) qualified: bool,
    pub(crate) process_epoch: String,
    pub(crate) stream_epoch: String,
    pub(crate) stream_kind: StreamKind,
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) logical_session_id: Option<String>,
    pub(crate) source_store_id: Option<String>,
    pub(crate) source_profile_id: Option<String>,
    pub(crate) store_instance: Option<String>,
    pub(crate) process_id: Option<u32>,
    pub(crate) owner_epoch: Option<String>,
    pub(crate) last_sequence: u64,
    pub(crate) state: EmissionState,
    pub(crate) reason: Option<UnavailableReason>,
}

/// Actual retained managed Store; no DTO/path/PID constructor.
pub(crate) struct OutputSource {
    app: Option<tauri::AppHandle>,
    identity: Option<StoreIdentity>,
    row: Option<crate::session_store::row_identity::SessionRowIdentity>,
    instance: Option<uuid::Uuid>,
    session: String,
    target: String,
    logical: Option<String>,
    origin: Option<Arc<OutputOwner>>,
    gate: Option<crate::session_store::authority::ExecutionGate>,
    #[cfg(test)]
    owned: Option<Arc<SessionStore>>,
    #[cfg(test)]
    test_owner: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    initial: Option<UnavailableReason>,
}
impl OutputSource {
    pub(crate) fn capture(
        app: &tauri::AppHandle,
        window: &tauri::WebviewWindow,
        session: &str,
        logical: Option<&str>,
    ) -> Result<Self, String> {
        let store = app
            .try_state::<SessionStore>()
            .ok_or("NATIVE_AUTHORITY_STORE_UNAVAILABLE")?;
        let mut source = Self::capture_store(store.inner(), session, logical)?;
        source.app = Some(app.clone());
        source.origin = source
            .instance
            .and_then(|instance| OutputOwner::capture(window, instance));
        Ok(source)
    }
    fn capture_store(
        store: &SessionStore,
        session: &str,
        logical: Option<&str>,
    ) -> Result<Self, String> {
        let valid = |value: &str| {
            !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
        };
        if !valid(session) || logical.is_some_and(|value| !valid(value)) {
            return Err("NATIVE_OUTPUT_INVALID_SESSION".into());
        }
        let target = logical.unwrap_or(session);
        let mut source = Self {
            app: None,
            identity: None,
            row: None,
            instance: Some(store.native_instance_id()),
            session: session.into(),
            target: target.into(),
            logical: None,
            origin: None,
            gate: Some(store.authority_execution_gate()),
            #[cfg(test)]
            owned: None,
            #[cfg(test)]
            test_owner: None,
            initial: Some(UnavailableReason::SourceUnavailable),
        };
        if let Ok(identity) = store.authority_identity() {
            source.identity = Some(identity);
            source.initial = match store.capture_session_row_identity(target) {
                Ok(Some(row)) => {
                    source.row = Some(row);
                    None
                }
                Ok(None) => Some(UnavailableReason::SessionUnbound),
                Err(_) => Some(UnavailableReason::SourceUnavailable),
            };
        }
        if logical.is_some() && source.initial.is_some() {
            return Err("NATIVE_OUTPUT_LOGICAL_SESSION_UNAVAILABLE".into());
        }
        Ok(source)
    }
    pub(crate) fn instance(&self) -> Option<uuid::Uuid> {
        self.instance
    }
    pub(crate) fn target(&self) -> &str {
        &self.target
    }
    pub(crate) fn owner(&self) -> Option<Arc<OutputOwner>> {
        self.origin.clone()
    }
    fn matches_store(&self, store: &SessionStore) -> bool {
        store.native_instance_id() == self.instance.unwrap_or_default()
            && store.authority_identity().ok().as_ref() == self.identity.as_ref()
            && self
                .row
                .as_ref()
                .is_some_and(|row| store.session_row_identity_current(row).unwrap_or(false))
    }
    fn store_current(&self) -> bool {
        #[cfg(test)]
        if self.app.is_none() {
            return self
                .owned
                .as_ref()
                .map_or(self.initial.is_none(), |store| self.matches_store(store));
        }
        let Some(app) = &self.app else {
            return false;
        };
        let Some(store) = app.try_state::<SessionStore>() else {
            return false;
        };
        self.matches_store(store.inner())
    }
    fn owner_current(&self) -> bool {
        #[cfg(test)]
        if let Some(check) = &self.test_owner {
            return check();
        }
        #[cfg(test)]
        if self.app.is_none() && self.owned.is_none() {
            return true;
        }
        self.origin.as_ref().is_some_and(|owner| owner.current())
    }
    fn current(&self) -> bool {
        self.initial.is_none() && self.store_current() && self.owner_current()
    }
    /// Invoked only by a real process/SSE construction, never by a later attach.
    fn bind(&mut self) {
        if self.current() {
            self.logical = Some(self.target.clone());
        } else {
            self.logical = None;
            self.initial
                .get_or_insert(UnavailableReason::SourceUnavailable);
        }
    }
    pub(crate) fn assert_explicit_target_current(&self, explicit: bool) -> Result<(), String> {
        if ((explicit || self.row.is_some()) && !self.store_current())
            || (explicit && !self.owner_current())
        {
            return Err("NATIVE_OUTPUT_LOGICAL_SESSION_UNAVAILABLE".into());
        }
        Ok(())
    }
    pub(crate) fn control_gate(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<crate::session_store::authority::ExecutionGate, String> {
        let store = app
            .try_state::<SessionStore>()
            .ok_or("NATIVE_AUTHORITY_STORE_UNAVAILABLE")?;
        if store.native_instance_id() != self.instance.unwrap_or_default()
            || store.authority_identity().ok().as_ref() != self.identity.as_ref()
        {
            return Err("NATIVE_OUTPUT_SOURCE_CHANGED".into());
        }
        if self.row.is_some() && !self.matches_store(store.inner()) {
            return Err("NATIVE_OUTPUT_SOURCE_CHANGED".into());
        }
        self.gate
            .clone()
            .ok_or_else(|| "NATIVE_OUTPUT_SOURCE_UNAVAILABLE".into())
    }
    #[cfg(test)]
    pub(crate) fn capture_owned(
        store: Arc<SessionStore>,
        route: &str,
        logical: Option<&str>,
        current_owner: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<Self, String> {
        let mut source = Self::capture_store(&store, route, logical)?;
        source.owned = Some(store);
        source.test_owner = Some(current_owner);
        Ok(source)
    }
    #[cfg(test)]
    pub(crate) fn fixture(session: &str) -> Self {
        Self {
            app: None,
            identity: Some(StoreIdentity {
                source_store_id: "fixture-store".into(),
                source_profile_id: "fixture-profile".into(),
            }),
            row: None,
            instance: Some(uuid::Uuid::new_v4()),
            session: session.into(),
            target: session.into(),
            logical: Some(session.into()),
            origin: None,
            gate: None,
            owned: None,
            test_owner: None,
            initial: None,
        }
    }
}

/// The real Child object/OS handle is retained, including after wait. Neither a
/// PID nor a serialized epoch can construct this lifetime or settle another one.
pub(crate) struct NativeOutputChild {
    child: Mutex<Child>,
    pid: u32,
}
impl NativeOutputChild {
    pub(crate) fn wait(
        self: &Arc<Self>,
        output: &Arc<NativeOutputStream>,
        cancelled: bool,
    ) -> std::io::Result<ExitStatus> {
        if !output
            .process
            .as_ref()
            .is_some_and(|actual| Arc::ptr_eq(actual, self))
        {
            return Err(std::io::Error::other(
                "Native output process construction changed",
            ));
        }
        let result = self
            .child
            .lock()
            .map_err(|_| std::io::Error::other("Native output process unavailable"))?
            .wait();
        output.terminal_complete(result.is_ok(), cancelled);
        result
    }
}

/// Native physical resource capture. Window labels are routing hints only.
pub(crate) struct OutputOwner {
    window: tauri::WebviewWindow,
    owner: NativeCheckpointWindow,
    instance: uuid::Uuid,
}
impl OutputOwner {
    pub(crate) fn capture(
        window: &tauri::WebviewWindow,
        instance: uuid::Uuid,
    ) -> Option<Arc<Self>> {
        let owner = native_window_lifecycle::capture_checkpoint_resources(
            &window.resources_table(),
            instance,
        )
        .ok()?;
        Some(Arc::new(Self {
            window: window.clone(),
            owner,
            instance,
        }))
    }
    pub(crate) fn current(&self) -> bool {
        let Some(current) = self
            .window
            .app_handle()
            .get_webview_window(self.window.label())
        else {
            return false;
        };
        let resources = current.resources_table();
        native_window_lifecycle::with_checkpoint_resources(
            &self.owner,
            &resources,
            self.instance,
            |_, _| Ok(()),
        )
        .is_ok()
    }
    pub(crate) fn epoch(&self) -> String {
        self.owner.incarnation().to_string()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct BatchRecord {
    pub(crate) sequence: u64,
    pub(crate) channel: OutputChannel,
    pub(crate) item_count: usize,
    pub(crate) utf8_bytes: usize,
    pub(crate) payload_sha256: String,
}
struct State {
    sequence: u64,
    expected_readers: usize,
    readers: usize,
    reader_slots: HashSet<u8>,
    terminal: bool,
    terminal_enqueued: bool,
    in_flight: usize,
    reason: Option<UnavailableReason>,
    records: Vec<BatchRecord>,
    published: Option<(EmissionState, Option<UnavailableReason>, u64)>,
}

pub(crate) struct NativeOutputStream {
    process_epoch: String,
    epoch: String,
    kind: StreamKind,
    process_id: Option<u32>,
    process: Option<Arc<NativeOutputChild>>,
    source: OutputSource,
    owners_current: Arc<dyn Fn() -> bool + Send + Sync>,
    notice: Arc<dyn Fn(OutputState) -> bool + Send + Sync>,
    closed: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    emit_gate: Mutex<()>,
    notice_gate: Mutex<()>,
    state: Mutex<State>,
}
impl Drop for NativeOutputStream {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        RECORDS.fetch_sub(state.records.len(), Ordering::AcqRel);
    }
}

pub(crate) struct NativeProviderOutputRegistry {
    epoch: String,
    closed: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    streams: Mutex<HashMap<String, Arc<NativeOutputStream>>>,
}
impl NativeProviderOutputRegistry {
    pub(crate) fn new() -> Self {
        Self {
            epoch: uuid::Uuid::new_v4().to_string(),
            closed: Arc::new(AtomicBool::new(false)),
            overflow: Arc::new(AtomicBool::new(false)),
            streams: Mutex::new(HashMap::new()),
        }
    }
    pub(crate) fn begin_process(
        &self,
        source: OutputSource,
        child: Child,
        owners_current: Arc<dyn Fn() -> bool + Send + Sync>,
        notice: Arc<dyn Fn(OutputState) -> bool + Send + Sync>,
    ) -> (Arc<NativeOutputStream>, Arc<NativeOutputChild>) {
        let process = Arc::new(NativeOutputChild {
            pid: child.id(),
            child: Mutex::new(child),
        });
        let output = self.begin_inner(
            source,
            StreamKind::Process,
            Some(process.pid),
            2,
            owners_current,
            notice,
            Some(process.clone()),
        );
        (output, process)
    }
    pub(crate) fn begin_sse(
        &self,
        source: OutputSource,
        owners_current: Arc<dyn Fn() -> bool + Send + Sync>,
        notice: Arc<dyn Fn(OutputState) -> bool + Send + Sync>,
    ) -> Arc<NativeOutputStream> {
        self.begin_inner(
            source,
            StreamKind::Sse,
            None,
            1,
            owners_current,
            notice,
            None,
        )
    }
    #[cfg(test)]
    pub(crate) fn begin(
        &self,
        source: OutputSource,
        kind: StreamKind,
        process_id: Option<u32>,
        readers: usize,
        owners_current: Arc<dyn Fn() -> bool + Send + Sync>,
        notice: Arc<dyn Fn(OutputState) -> bool + Send + Sync>,
    ) -> Arc<NativeOutputStream> {
        self.begin_inner(
            source,
            kind,
            process_id,
            readers,
            owners_current,
            notice,
            None,
        )
    }
    #[allow(clippy::too_many_arguments)] // Private actual construction plus bounded test-only adapter.
    fn begin_inner(
        &self,
        mut source: OutputSource,
        kind: StreamKind,
        process_id: Option<u32>,
        readers: usize,
        owners_current: Arc<dyn Fn() -> bool + Send + Sync>,
        notice: Arc<dyn Fn(OutputState) -> bool + Send + Sync>,
        process: Option<Arc<NativeOutputChild>>,
    ) -> Arc<NativeOutputStream> {
        source.bind();
        let mut streams = self.streams.lock().unwrap_or_else(|error| {
            self.overflow.store(true, Ordering::Release);
            error.into_inner()
        });
        if streams.len() >= MAX_STREAMS {
            self.overflow.store(true, Ordering::Release);
        }
        let reason = if self.closed.load(Ordering::Acquire) || self.overflow.load(Ordering::Acquire)
        {
            Some(UnavailableReason::RetentionCapacity)
        } else if readers
            != match kind {
                StreamKind::Process => 2,
                StreamKind::Sse => 1,
            }
        {
            Some(UnavailableReason::ReaderError)
        } else {
            source.initial
        };
        let stream = Arc::new(NativeOutputStream {
            process_epoch: self.epoch.clone(),
            epoch: uuid::Uuid::new_v4().to_string(),
            kind,
            process_id,
            process,
            source,
            owners_current,
            notice,
            closed: self.closed.clone(),
            overflow: self.overflow.clone(),
            emit_gate: Mutex::new(()),
            notice_gate: Mutex::new(()),
            state: Mutex::new(State {
                sequence: 0,
                expected_readers: readers,
                readers,
                reader_slots: HashSet::new(),
                terminal: false,
                terminal_enqueued: false,
                in_flight: 0,
                reason,
                records: Vec::new(),
                published: None,
            }),
        });
        if streams.len() < MAX_STREAMS && !self.closed.load(Ordering::Acquire) {
            streams.insert(stream.epoch.clone(), stream.clone());
        }
        stream
    }
    pub(crate) fn retained(&self, session: &str) -> Vec<Arc<NativeOutputStream>> {
        self.streams
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .filter(|stream| stream.source.session == session)
            .cloned()
            .collect()
    }
    pub(crate) fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        self.streams
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
}

/// Streaming framed digest: no allocation proportional to payload content.
pub(crate) fn payload_digest(channel: OutputChannel, items: &[String]) -> Option<(usize, String)> {
    if items.is_empty() || items.len() > MAX_BATCH_ITEMS {
        return None;
    }
    let bytes = items
        .iter()
        .try_fold(0usize, |sum, item| sum.checked_add(item.len()))?;
    if bytes > MAX_BATCH_BYTES {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(b"bycoda-native-output-items-v1\0");
    hash.update([channel.byte()]);
    hash.update((items.len() as u32).to_le_bytes());
    for item in items {
        hash.update((item.len() as u64).to_le_bytes());
        hash.update(item.as_bytes());
    }
    Some((bytes, format!("{:x}", hash.finalize())))
}

impl NativeOutputStream {
    pub(crate) fn target(&self) -> &str {
        self.source.target()
    }
    pub(crate) fn control_gate(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<crate::session_store::authority::ExecutionGate, String> {
        self.source.control_gate(app)
    }
    fn lock_state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|error| {
            let mut state = error.into_inner();
            state.reason.get_or_insert(UnavailableReason::StatePoisoned);
            state
        })
    }
    pub(crate) fn epoch(&self) -> &str {
        &self.epoch
    }
    pub(crate) fn invalidate(&self, reason: UnavailableReason) {
        let mut state = self.lock_state();
        state.reason.get_or_insert(reason);
    }
    pub(crate) fn emit(
        &self,
        channel: OutputChannel,
        items: &[String],
        enqueue: impl FnOnce(Option<OutputMetadata>) -> bool,
    ) {
        let _serial = self.emit_gate.lock().unwrap_or_else(|error| {
            self.invalidate(UnavailableReason::StatePoisoned);
            error.into_inner()
        });
        if !(self.owners_current)() {
            self.invalidate(UnavailableReason::OwnerUnavailable);
        }
        let computed = payload_digest(channel, items);
        let metadata = {
            let mut state = self.lock_state();
            if state.terminal && state.readers == 0 {
                state.reason.get_or_insert(UnavailableReason::ReaderError);
            }
            let sequence = state
                .sequence
                .checked_add(1)
                .filter(|value| *value <= MAX_SAFE);
            if let Some(sequence) = sequence {
                state.sequence = sequence;
            } else {
                state
                    .reason
                    .get_or_insert(UnavailableReason::SequenceExhausted);
            }
            state.in_flight += 1;
            match (sequence, computed) {
                (Some(sequence), Some((bytes, digest))) => {
                    if state.records.len() < MAX_RECORDS
                        && RECORDS
                            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                                (value < MAX_TOTAL_RECORDS).then_some(value + 1)
                            })
                            .is_ok()
                    {
                        state.records.push(BatchRecord {
                            sequence,
                            channel,
                            item_count: items.len(),
                            utf8_bytes: bytes,
                            payload_sha256: digest.clone(),
                        });
                    } else {
                        state
                            .reason
                            .get_or_insert(UnavailableReason::RetentionCapacity);
                    }
                    Some(OutputMetadata {
                        version: 1,
                        qualified: false,
                        process_epoch: self.process_epoch.clone(),
                        stream_epoch: self.epoch.clone(),
                        stream_kind: self.kind,
                        session_id: self.source.session.clone(),
                        logical_session_id: self.source.logical.clone(),
                        source_store_id: self
                            .source
                            .identity
                            .as_ref()
                            .map(|identity| identity.source_store_id.clone()),
                        source_profile_id: self
                            .source
                            .identity
                            .as_ref()
                            .map(|identity| identity.source_profile_id.clone()),
                        store_instance: self.source.instance.map(|id| id.to_string()),
                        process_id: self.process_id,
                        owner_epoch: None,
                        sequence,
                        channel,
                        item_count: items.len(),
                        utf8_bytes: bytes,
                        payload_sha256: digest,
                        digest_encoding: "bycoda-output-items-le/v1",
                        available: state.reason.is_none(),
                        unavailable_reason: state.reason,
                    })
                }
                _ => {
                    state.reason.get_or_insert(UnavailableReason::BatchCapacity);
                    None
                }
            }
        };
        let mut actual = Emission {
            stream: self,
            completed: false,
        };
        let success = enqueue(metadata);
        actual.finish(success);
    }
    pub(crate) fn reader(self: &Arc<Self>, slot: u8) -> Reader {
        let valid = {
            let mut state = self.lock_state();
            let valid = (slot as usize) < state.expected_readers && state.reader_slots.insert(slot);
            if !valid {
                state.reason.get_or_insert(UnavailableReason::ReaderError);
            }
            valid
        };
        Reader {
            stream: self.clone(),
            valid,
            finished: false,
        }
    }
    pub(crate) fn terminal_complete(&self, success: bool, cancelled: bool) {
        {
            let mut state = self.lock_state();
            if state.terminal {
                state.reason.get_or_insert(UnavailableReason::TerminalError);
            }
            state.terminal = true;
            if cancelled {
                state
                    .reason
                    .get_or_insert(UnavailableReason::TerminalCancelled);
            } else if !success {
                state.reason.get_or_insert(UnavailableReason::TerminalError);
            }
        }
        self.publish();
    }
    pub(crate) fn cancelled(&self) {
        self.invalidate(UnavailableReason::TerminalCancelled);
        self.publish();
    }
    pub(crate) fn terminal_delivery(&self, success: bool) {
        {
            let mut state = self.lock_state();
            state.terminal_enqueued = true;
            if !success {
                state.reason.get_or_insert(UnavailableReason::EmitFailed);
            }
        }
        self.publish();
    }
    pub(crate) fn observation(&self) -> OutputState {
        if self.overflow.load(Ordering::Acquire) {
            self.invalidate(UnavailableReason::RetentionCapacity);
        }
        if self.closed.load(Ordering::Acquire) || !self.source.current() {
            self.invalidate(UnavailableReason::SourceChanged);
        }
        if !(self.owners_current)() {
            self.invalidate(UnavailableReason::OwnerUnavailable);
        }
        let state = self.lock_state();
        let status = if state.reason.is_some() {
            EmissionState::Unavailable
        } else if state.terminal
            && state.terminal_enqueued
            && state.readers == 0
            && state.in_flight == 0
        {
            EmissionState::Sealed
        } else {
            EmissionState::Unsealed
        };
        OutputState {
            version: 1,
            qualified: false,
            process_epoch: self.process_epoch.clone(),
            stream_epoch: self.epoch.clone(),
            stream_kind: self.kind,
            session_id: self.source.session.clone(),
            logical_session_id: self.source.logical.clone(),
            source_store_id: self
                .source
                .identity
                .as_ref()
                .map(|identity| identity.source_store_id.clone()),
            source_profile_id: self
                .source
                .identity
                .as_ref()
                .map(|identity| identity.source_profile_id.clone()),
            store_instance: self.source.instance.map(|id| id.to_string()),
            process_id: self.process_id,
            owner_epoch: None,
            last_sequence: state.sequence,
            state: status,
            reason: state.reason,
        }
    }
    fn publish(&self) {
        // Keep the observation, deduplication and actual enqueue in one order.
        // Reader EOF and terminal completion may publish from different threads.
        // The state mutex must never be held across the external callback.
        let _notice = self.notice_gate.lock().unwrap_or_else(|error| {
            self.invalidate(UnavailableReason::StatePoisoned);
            error.into_inner()
        });
        let snapshot = self.observation();
        {
            let mut state = self.lock_state();
            let key = (snapshot.state, snapshot.reason, snapshot.last_sequence);
            if state.published == Some(key) {
                return;
            }
            state.published = Some(key);
        }
        if !(self.notice)(snapshot) {
            self.invalidate(UnavailableReason::EmitFailed);
        }
    }
    pub(crate) fn verified_emit_seal(
        self: &Arc<Self>,
    ) -> Result<VerifiedNativeEmitSeal, UnavailableReason> {
        let snapshot = self.observation();
        if snapshot.state != EmissionState::Sealed {
            return Err(snapshot
                .reason
                .unwrap_or(UnavailableReason::ReaderAbandoned));
        }
        Ok(VerifiedNativeEmitSeal {
            stream: self.clone(),
            sequence: snapshot.last_sequence,
        })
    }
    pub(crate) fn records(&self) -> Vec<BatchRecord> {
        self.lock_state().records.clone()
    }
}

struct Emission<'a> {
    stream: &'a NativeOutputStream,
    completed: bool,
}
impl Emission<'_> {
    fn finish(&mut self, success: bool) {
        let mut state = self.stream.lock_state();
        state.in_flight = state.in_flight.saturating_sub(1);
        if !success {
            state.reason.get_or_insert(UnavailableReason::EmitFailed);
        }
        self.completed = true;
    }
}
impl Drop for Emission<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.finish(false);
        }
    }
}
pub(crate) struct Reader {
    stream: Arc<NativeOutputStream>,
    valid: bool,
    finished: bool,
}
impl Reader {
    pub(crate) fn finish(mut self, eof_and_flushed: bool, cancelled: bool) {
        self.complete(eof_and_flushed, cancelled, false);
    }
    fn complete(&mut self, success: bool, cancelled: bool, abandoned: bool) {
        {
            let mut state = self.stream.lock_state();
            if self.valid {
                state.readers = state.readers.saturating_sub(1);
            }
            if cancelled {
                state
                    .reason
                    .get_or_insert(UnavailableReason::TerminalCancelled);
            } else if abandoned {
                state
                    .reason
                    .get_or_insert(UnavailableReason::ReaderAbandoned);
            } else if !success {
                state.reason.get_or_insert(UnavailableReason::ReaderError);
            }
        }
        self.finished = true;
        self.stream.publish();
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        if !self.finished {
            self.complete(false, false, true);
        }
    }
}

/// Native-only handle; cannot be deserialized from a public sealed observation.
pub(crate) struct VerifiedNativeEmitSeal {
    stream: Arc<NativeOutputStream>,
    sequence: u64,
}
impl VerifiedNativeEmitSeal {
    pub(crate) fn is_current(&self) -> bool {
        let current = self.stream.observation();
        current.state == EmissionState::Sealed && current.last_sequence == self.sequence
    }
}

#[cfg(test)]
#[path = "native_provider_output_tests.rs"]
mod tests;
