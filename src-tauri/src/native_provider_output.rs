//! Native emission receipts. These never attest renderer application or SQL.
//! Public DTOs are observations; only retained, revalidated native handles can
//! produce an opaque emit seal. No type here can qualify actors or writers.
#![allow(dead_code)] // Applied/checkpoint composition is separately owned.

use crate::native_window_lifecycle::{self, NativeCheckpointWindow};
use crate::session_store::{authority::StoreIdentity, SessionStore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::process::ExitStatus;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::Manager;

const MAX_STREAMS: usize = 512;
const MAX_RECORDS: usize = 4096;
const MAX_TOTAL_RECORDS: usize = 32768;
const MAX_BATCH_BYTES: usize = 1024 * 1024;
const MAX_BATCH_ITEMS: usize = 4096;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
static RECORDS: AtomicUsize = AtomicUsize::new(0);
const MAX_INPUT_ITEMS: usize = 8192;
const MAX_TOTAL_INPUT_ITEMS: usize = 65536;
const MAX_DELIVERIES: usize = 8192;
const MAX_TOTAL_DELIVERIES: usize = 65536;
const MAX_BATCH_RECIPIENTS: usize = 64;
const MAX_COMPARISONS: usize = 32;
const MAX_TOTAL_COMPARISONS: usize = 128;
static INPUT_ITEMS: AtomicUsize = AtomicUsize::new(0);
static DELIVERIES: AtomicUsize = AtomicUsize::new(0);
static COMPARISONS: AtomicUsize = AtomicUsize::new(0);
const MAX_GROUP_ITEMS: usize = 4096;
const MAX_GROUP_STREAMS: usize = 64;
const MAX_GROUPS: usize = 16;
const MAX_STREAM_GROUPS: usize = 4;
static GROUPS: AtomicUsize = AtomicUsize::new(0);

fn reserve(counter: &AtomicUsize, amount: usize, limit: usize) -> bool {
    counter
        .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
            value.checked_add(amount).filter(|next| *next <= limit)
        })
        .is_ok()
}

/// Locators/commitments only. No Deserialize and no authority from this value.
#[derive(Clone)]
pub(crate) struct NativeInputClaim {
    pub(crate) version: u8,
    pub(crate) qualified: bool,
    pub(crate) kind: String,
    // Reuse native source-field storage. available/unavailable_reason are NOT
    // descriptor fields or trusted eligibility; only retained delivery decides.
    pub(crate) batch: OutputMetadata,
    pub(crate) item_index: usize,
}
impl NativeInputClaim {
    /// Closed untrusted JS descriptor parser, not a proof constructor. The
    /// availability observation fields are deliberately absent from this shape.
    pub(crate) fn parse_json(value: &serde_json::Value) -> Result<Self, InputComparisonError> {
        use InputComparisonError::InvalidClaim as Invalid;
        fn closed<'a>(
            value: &'a serde_json::Value,
            required: &[&str],
            optional: &[&str],
        ) -> Result<&'a serde_json::Map<String, serde_json::Value>, InputComparisonError> {
            let object = value.as_object().ok_or(Invalid)?;
            if required.iter().any(|key| !object.contains_key(*key))
                || object.keys().any(|key| {
                    !required.contains(&key.as_str()) && !optional.contains(&key.as_str())
                })
            {
                return Err(Invalid);
            }
            Ok(object)
        }
        fn text(value: &serde_json::Value) -> Result<String, InputComparisonError> {
            let value = value.as_str().ok_or(Invalid)?;
            if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
                return Err(Invalid);
            }
            Ok(value.into())
        }
        fn nullable(value: &serde_json::Value) -> Result<Option<String>, InputComparisonError> {
            if value.is_null() {
                Ok(None)
            } else {
                text(value).map(Some)
            }
        }
        fn counter(value: &serde_json::Value) -> Result<u64, InputComparisonError> {
            value
                .as_u64()
                .filter(|value| *value <= MAX_SAFE)
                .ok_or(Invalid)
        }
        let outer = closed(
            value,
            &["version", "qualified", "kind", "batch", "itemIndex"],
            &[],
        )?;
        if outer["version"].as_u64() != Some(1)
            || outer["qualified"].as_bool() != Some(false)
            || outer["kind"].as_str() != Some("native-output-item-comparison")
        {
            return Err(Invalid);
        }
        let batch = closed(
            &outer["batch"],
            &[
                "version",
                "qualified",
                "processEpoch",
                "streamEpoch",
                "streamKind",
                "sessionId",
                "sourceStoreId",
                "sourceProfileId",
                "storeInstance",
                "processId",
                "ownerEpoch",
                "sequence",
                "channel",
                "itemCount",
                "utf8Bytes",
                "payloadSha256",
                "digestEncoding",
            ],
            &["logicalSessionId"],
        )?;
        if batch["version"].as_u64() != Some(1)
            || batch["qualified"].as_bool() != Some(false)
            || batch["digestEncoding"].as_str() != Some("bycoda-output-items-le/v1")
        {
            return Err(Invalid);
        }
        let process_epoch = text(&batch["processEpoch"])?;
        let stream_epoch = text(&batch["streamEpoch"])?;
        let store_instance = nullable(&batch["storeInstance"])?;
        let owner_epoch = nullable(&batch["ownerEpoch"])?;
        for value in [
            Some(&process_epoch),
            Some(&stream_epoch),
            store_instance.as_ref(),
            owner_epoch.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            let uuid = uuid::Uuid::parse_str(value).map_err(|_| Invalid)?;
            if uuid.get_version() != Some(uuid::Version::Random) || uuid.to_string() != *value {
                return Err(Invalid);
            }
        }
        let stream_kind = match batch["streamKind"].as_str() {
            Some("process") => StreamKind::Process,
            Some("sse") => StreamKind::Sse,
            _ => return Err(Invalid),
        };
        let channel = match batch["channel"].as_str() {
            Some("stdout") => OutputChannel::Stdout,
            Some("stderr") => OutputChannel::Stderr,
            Some("sse") => OutputChannel::Sse,
            _ => return Err(Invalid),
        };
        if (stream_kind == StreamKind::Sse) != (channel == OutputChannel::Sse) {
            return Err(Invalid);
        }
        let sequence = counter(&batch["sequence"])?;
        let item_count = usize::try_from(counter(&batch["itemCount"])?).map_err(|_| Invalid)?;
        let utf8_bytes = usize::try_from(counter(&batch["utf8Bytes"])?).map_err(|_| Invalid)?;
        let item_index = usize::try_from(counter(&outer["itemIndex"])?).map_err(|_| Invalid)?;
        if sequence == 0
            || item_count == 0
            || item_count > MAX_BATCH_ITEMS
            || utf8_bytes > MAX_BATCH_BYTES
            || item_index >= item_count
        {
            return Err(Invalid);
        }
        let payload_sha256 = text(&batch["payloadSha256"])?;
        if payload_sha256.len() != 64
            || !payload_sha256
                .bytes()
                .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
        {
            return Err(Invalid);
        }
        let process_id = if batch["processId"].is_null() {
            None
        } else {
            Some(
                u32::try_from(counter(&batch["processId"])?)
                    .ok()
                    .filter(|value| *value > 0)
                    .ok_or(Invalid)?,
            )
        };
        Ok(Self {
            version: 1,
            qualified: false,
            kind: "native-output-item-comparison".into(),
            item_index,
            batch: OutputMetadata {
                version: 1,
                qualified: false,
                process_epoch,
                stream_epoch,
                stream_kind,
                session_id: text(&batch["sessionId"])?,
                logical_session_id: batch.get("logicalSessionId").map(text).transpose()?,
                source_store_id: nullable(&batch["sourceStoreId"])?,
                source_profile_id: nullable(&batch["sourceProfileId"])?,
                store_instance,
                process_id,
                owner_epoch,
                sequence,
                channel,
                item_count,
                utf8_bytes,
                payload_sha256,
                digest_encoding: "bycoda-output-items-le/v1",
                available: false,
                unavailable_reason: None,
            },
        })
    }
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum InputComparisonError {
    InvalidClaim,
    Unknown,
    ScopeChanged,
    Capacity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeInputComparisonScope {
    pub(crate) logical_session_id: String,
    pub(crate) routing_session_id: String,
    pub(crate) process_epoch: String,
    pub(crate) stream_epoch: String,
    pub(crate) store_instance: uuid::Uuid,
    pub(crate) source_store_id: String,
    pub(crate) source_profile_id: String,
    pub(crate) recipient_epoch: uuid::Uuid,
    pub(crate) sequence: u64,
    pub(crate) channel: OutputChannel,
    pub(crate) item_index: usize,
    pub(crate) item_utf8_bytes: usize,
    pub(crate) item_sha256: String,
    pub(crate) batch_sha256: String,
}
struct ComparisonPermit {
    stream: Arc<AtomicUsize>,
}
impl Drop for ComparisonPermit {
    fn drop(&mut self) {
        self.stream.fetch_sub(1, Ordering::AcqRel);
        COMPARISONS.fetch_sub(1, Ordering::AcqRel);
    }
}
/// Native eligibility comparison only. Neither application nor FULL SQL proof.
/// No Clone/Serialize/Deserialize; actual permits/owners live until real drop.
pub(crate) struct VerifiedNativeInputComparison {
    seal: VerifiedNativeEmitSeal,
    recipient: Arc<OutputOwner>,
    scope: NativeInputComparisonScope,
    _permit: ComparisonPermit,
}
impl VerifiedNativeInputComparison {
    pub(crate) fn scope(&self) -> &NativeInputComparisonScope {
        &self.scope
    }
    /// Independent preflight revalidation. Never call while holding Store or
    /// resource locks; this is not the separate atomic FULL composition port.
    pub(crate) fn is_current(
        &self,
        store: &SessionStore,
        recipient: &NativeCheckpointWindow,
        resources: &tauri::ResourceTable,
    ) -> bool {
        self.seal.stream.source.matches_store(store)
            && self.seal.is_current()
            && self
                .recipient
                .matches_recipient(recipient, resources, store.native_instance_id())
    }
}

struct InputGroupPermit {
    streams: Vec<Arc<AtomicUsize>>,
}
impl Drop for InputGroupPermit {
    fn drop(&mut self) {
        for stream in &self.streams {
            stream.fetch_sub(1, Ordering::AcqRel);
        }
        GROUPS.fetch_sub(1, Ordering::AcqRel);
    }
}
struct PreparedInputStream {
    stream: Arc<NativeOutputStream>,
    recipient: Arc<OutputOwner>,
    original: Arc<OutputOwner>,
}
struct PreparedInputItem {
    stream_index: usize,
    scope: NativeInputComparisonScope,
    recipient: Arc<OutputOwner>,
}
/// Native retained group, not an application/FULL receipt. One bounded group
/// permit covers many items; it does not allocate one single-item permit each.
pub(crate) struct PreparedNativeInputGroup {
    streams: Vec<PreparedInputStream>,
    items: Vec<PreparedInputItem>,
    target: String,
    instance: uuid::Uuid,
    gate: Arc<RwLock<()>>,
    _permit: InputGroupPermit,
}
/// Lifetime bound to held stream states and Root's physical-owner group. It
/// cannot escape the HRTB callback or be reconstructed from a JSON descriptor.
pub(crate) struct NativeCheckedInputs<'scope> {
    group: &'scope PreparedNativeInputGroup,
    _states: &'scope [std::sync::MutexGuard<'scope, State>],
}
pub(crate) struct StableNativeInputs<'scope> {
    group: &'scope PreparedNativeInputGroup,
    states: &'scope [std::sync::MutexGuard<'scope, State>],
}
impl NativeCheckedInputs<'_> {
    pub(crate) fn logical_target(&self) -> &str {
        &self.group.target
    }
    pub(crate) fn len(&self) -> usize {
        self.group.items.len()
    }
    pub(crate) fn scope(&self, index: usize) -> Option<&NativeInputComparisonScope> {
        self.group.items.get(index).map(|item| &item.scope)
    }
}
impl PreparedNativeInputGroup {
    pub(crate) fn logical_target(&self) -> &str {
        &self.target
    }
    /// Borrow actual captured native owners. Root deduplicates/locks their slots
    /// in one sorted group and checks closed roster separately before SQL work.
    pub(crate) fn owners(&self) -> Vec<&NativeCheckpointWindow> {
        self.streams
            .iter()
            .flat_map(|stream| [&stream.original.owner, &stream.recipient.owner])
            .collect()
    }
    /// Correct nesting: held physical owners -> stable inputs -> FULL SQL
    /// helper -> validate_at -> COMMIT -> release inputs/owners. No SQL here.
    pub(crate) fn with_stable_inputs<T>(
        &self,
        owners: &crate::native_window_lifecycle::CheckedCheckpointGroup<'_>,
        consume: impl for<'scope> FnOnce(StableNativeInputs<'scope>) -> Result<T, String>,
    ) -> Result<T, String> {
        if !owners.matches_store_instance(self.instance)
            || self.streams.iter().any(|input| {
                !owners.matches(&input.original.owner) || !owners.matches(&input.recipient.owner)
            })
            || self
                .items
                .iter()
                .any(|item| !owners.matches(&item.recipient.owner))
        {
            return Err("NATIVE_INPUT_SCOPE_CHANGED".into());
        }
        let _gate = self.gate.read().map_err(|_| "NATIVE_INPUT_UNKNOWN")?;
        let states = self
            .streams
            .iter()
            .map(|input| {
                input
                    .stream
                    .state
                    .lock()
                    .map_err(|_| "NATIVE_INPUT_UNKNOWN".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        for (index, input) in self.streams.iter().enumerate() {
            if !input.stream.sealed_state(&states[index]) {
                return Err("NATIVE_INPUT_UNKNOWN".into());
            }
        }
        consume(StableNativeInputs {
            group: self,
            states: &states,
        })
    }
}
impl StableNativeInputs<'_> {
    fn validate_source_at(
        &self,
        store: &SessionStore,
        transaction: &crate::session_store::authority::CheckedStoreTransaction<'_>,
    ) -> Result<(), String> {
        let group = self.group;
        if store.native_instance_id() != group.instance
            || !transaction.is_for(store)
            || transaction.native_instance_id() != group.instance
            || transaction.connection().is_autocommit()
        {
            return Err("NATIVE_INPUT_SCOPE_CHANGED".into());
        }
        let identity: StoreIdentity = transaction.connection().query_row(
            "SELECT source_store_id,source_profile_id FROM native_authority_identity WHERE id=1", [],
            |row| Ok(StoreIdentity { source_store_id:row.get(0)?,source_profile_id:row.get(1)? }),
        ).map_err(|_| "NATIVE_INPUT_SCOPE_CHANGED")?;
        for input in &group.streams {
            if !input.stream.source.matches_managed_construction(store)
                || input.stream.source.identity.as_ref() != Some(&identity)
                || input.stream.source.logical.as_deref() != Some(group.target.as_str())
            {
                return Err("NATIVE_INPUT_SCOPE_CHANGED".into());
            }
            let row = input
                .stream
                .source
                .row
                .as_ref()
                .ok_or("NATIVE_INPUT_SCOPE_CHANGED")?;
            if !store
                .session_row_identity_current_at(transaction.connection(), row, &group.target)
                .map_err(|_| "NATIVE_INPUT_SCOPE_CHANGED")?
            {
                return Err("NATIVE_INPUT_SCOPE_CHANGED".into());
            }
        }
        Ok(())
    }
    /// No Store/resource/State relock. This validates the original row against
    /// the genuine supplied transaction while the outer stable guard survives
    /// until that transaction's commit or rollback actually settles.
    pub(crate) fn validate_at<T>(
        &self,
        store: &SessionStore,
        transaction: &crate::session_store::authority::CheckedStoreTransaction<'_>,
        consume: impl for<'scope> FnOnce(NativeCheckedInputs<'scope>) -> Result<T, String>,
    ) -> Result<T, String> {
        let group = self.group;
        self.validate_source_at(store, transaction)?;
        for (index, input) in group.streams.iter().enumerate() {
            let state = &self.states[index];
            if !input.stream.sealed_state(state) {
                return Err("NATIVE_INPUT_UNKNOWN".into());
            }
        }
        for item in &group.items {
            let batch = self.states[item.stream_index]
                .input_batches
                .get(&item.scope.sequence)
                .ok_or("NATIVE_INPUT_UNKNOWN")?;
            let actual = batch
                .items
                .get(item.scope.item_index)
                .ok_or("NATIVE_INPUT_INVALID_CLAIM")?;
            if batch.record.channel != item.scope.channel
                || batch.record.payload_sha256 != item.scope.batch_sha256
                || actual.bytes != item.scope.item_utf8_bytes
                || actual
                    .sha256
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
                    != item.scope.item_sha256
                || !batch.recipients.iter().any(|delivery| {
                    delivery.known_enqueue
                        && delivery
                            .owner
                            .as_ref()
                            .is_some_and(|owner| Arc::ptr_eq(owner, &item.recipient))
                })
            {
                return Err("NATIVE_INPUT_UNKNOWN".into());
            }
        }
        let result = consume(NativeCheckedInputs {
            group,
            _states: self.states,
        })?;
        // SQL callbacks may consume a nonce/receipt but cannot replace the
        // compared row or durable Store identity before that transaction commits.
        self.validate_source_at(store, transaction)?;
        Ok(result)
    }
}

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
    fn matches_managed_construction(&self, store: &SessionStore) -> bool {
        if self.instance != Some(store.native_instance_id()) {
            return false;
        }
        if let Some(app) = &self.app {
            return app
                .try_state::<SessionStore>()
                .is_some_and(|actual| actual.native_instance_id() == store.native_instance_id());
        }
        #[cfg(test)]
        {
            self.owned
                .as_ref()
                .is_some_and(|actual| actual.native_instance_id() == store.native_instance_id())
        }
        #[cfg(not(test))]
        false
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
    pub(crate) fn capture_owned_physical(
        store: Arc<SessionStore>,
        route: &str,
        logical: Option<&str>,
        original: Arc<OutputOwner>,
    ) -> Result<Self, String> {
        if original.instance != store.native_instance_id() {
            return Err("NATIVE_OUTPUT_SOURCE_CHANGED".into());
        }
        let current = original.clone();
        let mut source =
            Self::capture_owned(store, route, logical, Arc::new(move || current.current()))?;
        source.origin = Some(original);
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
    owner: Arc<crate::harness::process_lifecycle::ProcessOwner>,
    pid: u32,
}
impl NativeOutputChild {
    pub(crate) fn retirement(&self) -> crate::harness::process_lifecycle::Retirement {
        self.owner.retirement()
    }
    #[cfg(test)]
    pub(crate) fn signals_closed(&self) -> bool {
        self.owner.signals_closed()
    }
    #[cfg(test)]
    pub(crate) fn exit_observed(&self) -> bool {
        self.owner.exit_observed()
    }
    #[cfg(test)]
    pub(crate) fn id(&self) -> u32 {
        self.pid
    }
    #[cfg(test)]
    pub(crate) fn try_wait(&self) -> std::io::Result<Option<ExitStatus>> {
        self.owner.try_result()
    }
    pub(crate) fn pin(&self) -> std::io::Result<crate::harness::process_lifecycle::ProcessPin> {
        self.owner.pin()
    }
    pub(crate) fn request_stop(&self) -> std::io::Result<()> {
        self.owner.request_stop()
    }
    pub(crate) fn wait_actual(&self) -> std::io::Result<ExitStatus> {
        self.owner.wait()
    }
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
        self.owner.activate();
        let result = self.owner.wait();
        if self.retirement().require_verified().is_err() {
            // Retain unknown before terminal publication; a real leader status
            // must never briefly mint an eligible emit/retirement seal.
            output.invalidate(UnavailableReason::TerminalError);
        }
        output.terminal_complete(result.is_ok(), cancelled);
        result
    }
}

/// Native physical resource capture. Window labels are routing hints only.
pub(crate) struct OutputOwner {
    window: Option<tauri::WebviewWindow>,
    owner: NativeCheckpointWindow,
    instance: uuid::Uuid,
    #[cfg(test)]
    resources: Option<Arc<tauri::ResourceTable>>,
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
            window: Some(window.clone()),
            owner,
            instance,
            #[cfg(test)]
            resources: None,
        }))
    }
    pub(crate) fn current(&self) -> bool {
        #[cfg(test)]
        if let Some(resources) = &self.resources {
            return native_window_lifecycle::with_checkpoint_resources(
                &self.owner,
                resources,
                self.instance,
                |_, _| Ok(()),
            )
            .is_ok();
        }
        let Some(window) = &self.window else {
            return false;
        };
        let Some(current) = window.app_handle().get_webview_window(window.label()) else {
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
    fn matches_recipient(
        &self,
        recipient: &NativeCheckpointWindow,
        resources: &tauri::ResourceTable,
        instance: uuid::Uuid,
    ) -> bool {
        self.instance == instance
            && self.current()
            && native_window_lifecycle::with_checkpoint_resources(
                &self.owner,
                resources,
                instance,
                |_, _| Ok(()),
            )
            .is_ok()
            && native_window_lifecycle::with_checkpoint_resources(
                recipient,
                resources,
                instance,
                |_, _| Ok(()),
            )
            .is_ok()
    }
    #[cfg(test)]
    pub(crate) fn capture_resources(
        resources: Arc<tauri::ResourceTable>,
        instance: uuid::Uuid,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner: native_window_lifecycle::capture_checkpoint_resources(&resources, instance)
                .unwrap(),
            window: None,
            instance,
            resources: Some(resources),
        })
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
#[derive(Clone)]
struct ItemCommitment {
    bytes: usize,
    sha256: [u8; 32],
}
struct RecipientDelivery {
    owner: Option<Arc<OutputOwner>>,
    known_enqueue: bool,
}
struct InputBatch {
    record: BatchRecord,
    items: Vec<ItemCommitment>,
    recipients: Vec<RecipientDelivery>,
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
    input_batches: HashMap<u64, InputBatch>,
    input_items: usize,
    deliveries: usize,
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
    comparisons: Arc<AtomicUsize>,
    groups: Arc<AtomicUsize>,
}
impl Drop for NativeOutputStream {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        RECORDS.fetch_sub(state.records.len(), Ordering::AcqRel);
        INPUT_ITEMS.fetch_sub(state.input_items, Ordering::AcqRel);
        DELIVERIES.fetch_sub(state.deliveries, Ordering::AcqRel);
    }
}

pub(crate) struct NativeProviderOutputRegistry {
    epoch: String,
    closed: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    streams: Mutex<HashMap<String, Arc<NativeOutputStream>>>,
    composition_gate: Arc<RwLock<()>>,
}
impl NativeProviderOutputRegistry {
    pub(crate) fn new() -> Self {
        Self {
            epoch: uuid::Uuid::new_v4().to_string(),
            closed: Arc::new(AtomicBool::new(false)),
            overflow: Arc::new(AtomicBool::new(false)),
            streams: Mutex::new(HashMap::new()),
            composition_gate: Arc::new(RwLock::new(())),
        }
    }
    pub(crate) fn begin_process<C: Into<crate::harness::process_lifecycle::OwnedChild>>(
        &self,
        source: OutputSource,
        child: C,
        owners_current: Arc<dyn Fn() -> bool + Send + Sync>,
        notice: Arc<dyn Fn(OutputState) -> bool + Send + Sync>,
    ) -> (Arc<NativeOutputStream>, Arc<NativeOutputChild>) {
        let child = child.into();
        let process = Arc::new(NativeOutputChild {
            pid: child.id(),
            owner: Arc::new(crate::harness::process_lifecycle::ProcessOwner::new(child)),
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
        // Never hold this write gate while binding (which reads SQL/resources).
        // Stable composition holds the read gate before taking the SQL lock.
        let _composition = self
            .composition_gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
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
                input_batches: HashMap::new(),
                input_items: 0,
                deliveries: 0,
                published: None,
            }),
            comparisons: Arc::new(AtomicUsize::new(0)),
            groups: Arc::new(AtomicUsize::new(0)),
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
    /// Exact construction-bound logical association, never a parsed route.
    /// Unavailable/cancelled retained handles stay visible as negative evidence;
    /// callers must revalidate them, not interpret this query as a completeness proof.
    pub(crate) fn retained_for_target(&self, target: &str) -> Vec<Arc<NativeOutputStream>> {
        self.streams
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .filter(|stream| {
                stream.target() == target && stream.source.logical.as_deref() == Some(target)
            })
            .cloned()
            .collect()
    }
    pub(crate) fn shutdown(&self) {
        let _composition = self
            .composition_gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        self.closed.store(true, Ordering::Release);
        self.streams
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
    /// Claim fields never grant eligibility. Requires the actual native Store
    /// and exact physical checkpoint recipient, outside held Store/resource locks.
    pub(crate) fn compare_recipient_input(
        &self,
        store: &SessionStore,
        recipient: &NativeCheckpointWindow,
        resources: &tauri::ResourceTable,
        claim: &NativeInputClaim,
    ) -> Result<VerifiedNativeInputComparison, InputComparisonError> {
        // Compatibility preflight for isolated/adapted resource tables only.
        // Production group callers must drop the real Tauri ResourceTable
        // guard first and use the capture-only preparation method below.
        self.compare_input_with(store, recipient, claim, |owner| {
            owner.matches_recipient(recipient, resources, store.native_instance_id())
        })
    }
    fn compare_input_with(
        &self,
        store: &SessionStore,
        recipient: &NativeCheckpointWindow,
        claim: &NativeInputClaim,
        matches: impl Fn(&OutputOwner) -> bool,
    ) -> Result<VerifiedNativeInputComparison, InputComparisonError> {
        if claim.version != 1
            || claim.qualified
            || claim.kind != "native-output-item-comparison"
            || claim.batch.process_epoch != self.epoch
            || claim.batch.owner_epoch.as_deref() != Some(&recipient.incarnation().to_string())
        {
            return Err(InputComparisonError::InvalidClaim);
        }
        let stream = self
            .streams
            .lock()
            .map_err(|_| InputComparisonError::Unknown)?
            .get(&claim.batch.stream_epoch)
            .cloned()
            .ok_or(InputComparisonError::Unknown)?;
        if !stream.metadata_matches(&claim.batch) || stream.source.logical.is_none() {
            return Err(InputComparisonError::InvalidClaim);
        }
        if stream.kind == StreamKind::Process
            && !stream
                .process
                .as_ref()
                .is_some_and(|actual| stream.process_id == Some(actual.pid))
        {
            return Err(InputComparisonError::Unknown);
        }
        if !stream.source.matches_store(store) {
            return Err(InputComparisonError::ScopeChanged);
        }
        let seal = stream
            .verified_emit_seal()
            .map_err(|_| InputComparisonError::Unknown)?;
        let (record, item, recipients) = {
            let state = stream.lock_state();
            let batch = state
                .input_batches
                .get(&claim.batch.sequence)
                .ok_or(InputComparisonError::Unknown)?;
            if !record_matches(&batch.record, &claim.batch) {
                return Err(InputComparisonError::InvalidClaim);
            }
            let item = batch
                .items
                .get(claim.item_index)
                .cloned()
                .ok_or(InputComparisonError::InvalidClaim)?;
            (
                batch.record.clone(),
                item,
                batch
                    .recipients
                    .iter()
                    .filter(|delivery| delivery.known_enqueue)
                    .filter_map(|delivery| delivery.owner.clone())
                    .collect::<Vec<_>>(),
            )
        };
        let actual = recipients
            .into_iter()
            .find(|owner| matches(owner))
            .ok_or(InputComparisonError::ScopeChanged)?;
        if !seal.is_current() {
            return Err(InputComparisonError::ScopeChanged);
        }
        if !reserve(&stream.comparisons, 1, MAX_COMPARISONS) {
            return Err(InputComparisonError::Capacity);
        }
        if !reserve(&COMPARISONS, 1, MAX_TOTAL_COMPARISONS) {
            stream.comparisons.fetch_sub(1, Ordering::AcqRel);
            return Err(InputComparisonError::Capacity);
        }
        let permit = ComparisonPermit {
            stream: stream.comparisons.clone(),
        };
        let identity = stream
            .source
            .identity
            .as_ref()
            .ok_or(InputComparisonError::ScopeChanged)?;
        let scope = NativeInputComparisonScope {
            logical_session_id: stream.target().into(),
            routing_session_id: stream.source.session.clone(),
            process_epoch: stream.process_epoch.clone(),
            stream_epoch: stream.epoch.clone(),
            store_instance: store.native_instance_id(),
            source_store_id: identity.source_store_id.clone(),
            source_profile_id: identity.source_profile_id.clone(),
            recipient_epoch: recipient.incarnation(),
            sequence: record.sequence,
            channel: record.channel,
            item_index: claim.item_index,
            item_utf8_bytes: item.bytes,
            item_sha256: item
                .sha256
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
            batch_sha256: record.payload_sha256,
        };
        Ok(VerifiedNativeInputComparison {
            seal,
            recipient: actual,
            scope,
            _permit: permit,
        })
    }
    /// Prepares independently; do not call while holding Store/resources. The
    /// later atomic port re-resolves everything under actual held guards.
    pub(crate) fn prepare_input_group(
        &self,
        store: &SessionStore,
        target: &str,
        recipient: &NativeCheckpointWindow,
        claims: &[NativeInputClaim],
    ) -> Result<PreparedNativeInputGroup, InputComparisonError> {
        if claims.is_empty() || claims.len() > MAX_GROUP_ITEMS || target.is_empty() {
            return Err(InputComparisonError::InvalidClaim);
        }
        if !reserve(&GROUPS, 1, MAX_GROUPS) {
            return Err(InputComparisonError::Capacity);
        }
        let mut permit = InputGroupPermit {
            streams: Vec::new(),
        };
        let mut streams: Vec<PreparedInputStream> = Vec::new();
        let mut items = Vec::with_capacity(claims.len());
        let mut distinct = HashSet::new();
        for claim in claims {
            if claim.batch.logical_session_id.as_deref() != Some(target)
                || !distinct.insert((
                    claim.batch.stream_epoch.clone(),
                    claim.batch.sequence,
                    claim.item_index,
                ))
            {
                return Err(InputComparisonError::InvalidClaim);
            }
            // At most one transient single-item handle is alive; 64+ items on a
            // stream never consume 64 of its 32 single-comparison permits.
            let compared = self.compare_input_with(store, recipient, claim, |owner| {
                owner.current() && owner.owner.same_capture(recipient)
            })?;
            let stream = &compared.seal.stream;
            let index = if let Some(index) = streams
                .iter()
                .position(|input| Arc::ptr_eq(&input.stream, stream))
            {
                index
            } else {
                if streams.len() >= MAX_GROUP_STREAMS {
                    return Err(InputComparisonError::Capacity);
                }
                let original = stream
                    .source
                    .origin
                    .clone()
                    .ok_or(InputComparisonError::ScopeChanged)?;
                if !original.current() {
                    return Err(InputComparisonError::ScopeChanged);
                }
                if !reserve(&stream.groups, 1, MAX_STREAM_GROUPS) {
                    return Err(InputComparisonError::Capacity);
                }
                permit.streams.push(stream.groups.clone());
                streams.push(PreparedInputStream {
                    stream: stream.clone(),
                    recipient: compared.recipient.clone(),
                    original,
                });
                streams.len() - 1
            };
            items.push(PreparedInputItem {
                stream_index: index,
                scope: compared.scope.clone(),
                recipient: compared.recipient.clone(),
            });
        }
        // Every group acquires overlapping stream locks in this same order.
        let mut order: Vec<usize> = (0..streams.len()).collect();
        order.sort_by(|a, b| streams[*a].stream.epoch.cmp(&streams[*b].stream.epoch));
        let mut remap = vec![0; streams.len()];
        for (new, old) in order.iter().enumerate() {
            remap[*old] = new;
        }
        let mut unsorted: Vec<Option<PreparedInputStream>> =
            streams.into_iter().map(Some).collect();
        let streams = order
            .into_iter()
            .map(|index| unsorted[index].take().unwrap())
            .collect();
        for item in &mut items {
            item.stream_index = remap[item.stream_index];
        }
        Ok(PreparedNativeInputGroup {
            streams,
            items,
            target: target.into(),
            instance: store.native_instance_id(),
            gate: self.composition_gate.clone(),
            _permit: permit,
        })
    }
}

fn record_matches(record: &BatchRecord, metadata: &OutputMetadata) -> bool {
    record.sequence == metadata.sequence
        && record.channel == metadata.channel
        && record.item_count == metadata.item_count
        && record.utf8_bytes == metadata.utf8_bytes
        && record.payload_sha256 == metadata.payload_sha256
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
    fn sealed_state(&self, state: &State) -> bool {
        !self.closed.load(Ordering::Acquire)
            && !self.overflow.load(Ordering::Acquire)
            && state.reason.is_none()
            && state.terminal
            && state.terminal_enqueued
            && state.readers == 0
            && state.in_flight == 0
            && (self.kind != StreamKind::Process
                || self
                    .process
                    .as_ref()
                    .is_some_and(|actual| self.process_id == Some(actual.pid)))
    }
    fn metadata_matches(&self, batch: &OutputMetadata) -> bool {
        batch.version == 1
            && !batch.qualified
            && batch.process_epoch == self.process_epoch
            && batch.stream_epoch == self.epoch
            && batch.stream_kind == self.kind
            && batch.session_id == self.source.session
            && batch.logical_session_id == self.source.logical
            && batch.store_instance == self.source.instance.map(|value| value.to_string())
            && batch.process_id == self.process_id
            && batch.source_store_id.as_deref()
                == self
                    .source
                    .identity
                    .as_ref()
                    .map(|value| value.source_store_id.as_str())
            && batch.source_profile_id.as_deref()
                == self
                    .source
                    .identity
                    .as_ref()
                    .map(|value| value.source_profile_id.as_str())
            && batch.digest_encoding == "bycoda-output-items-le/v1"
            && batch.sequence > 0
            && batch.sequence <= MAX_SAFE
            && batch.item_count > 0
            && batch.item_count <= MAX_BATCH_ITEMS
            && batch.utf8_bytes <= MAX_BATCH_BYTES
    }
    /// Called only from the real final send boundary, with its captured native
    /// recipient and actual enqueue result. No caller epoch/DTO can mint this.
    pub(crate) fn observe_recipient_delivery(
        &self,
        metadata: Option<&OutputMetadata>,
        owner: Option<Arc<OutputOwner>>,
        items: &[String],
        enqueued: bool,
    ) {
        let Some(metadata) = metadata else {
            return;
        };
        // No extra SQL wait on ordinary output. These are construction/send
        // facts only; the seal/resolver/handle independently revalidate source.
        let owner_current = owner.as_ref().is_some_and(|owner| owner.current());
        let mut state = self.lock_state();
        let record = state
            .records
            .iter()
            .find(|record| record.sequence == metadata.sequence)
            .cloned();
        let Some(record) = record else {
            state
                .reason
                .get_or_insert(UnavailableReason::RetentionCapacity);
            return;
        };
        if !self.metadata_matches(metadata)
            || metadata.owner_epoch.is_some()
            || state.in_flight == 0
            || !record_matches(&record, metadata)
            || payload_digest(metadata.channel, items).as_ref()
                != Some(&(metadata.utf8_bytes, metadata.payload_sha256.clone()))
        {
            state.reason.get_or_insert(UnavailableReason::EmitFailed);
            return;
        }
        if !state.input_batches.contains_key(&record.sequence) {
            if state.input_items.saturating_add(items.len()) > MAX_INPUT_ITEMS
                || !reserve(&INPUT_ITEMS, items.len(), MAX_TOTAL_INPUT_ITEMS)
            {
                state
                    .reason
                    .get_or_insert(UnavailableReason::RetentionCapacity);
                return;
            }
            let commitments = items
                .iter()
                .map(|item| ItemCommitment {
                    bytes: item.len(),
                    sha256: Sha256::digest(item.as_bytes()).into(),
                })
                .collect();
            state.input_items += items.len();
            state.input_batches.insert(
                record.sequence,
                InputBatch {
                    record: record.clone(),
                    items: commitments,
                    recipients: Vec::new(),
                },
            );
        }
        let batch = &state.input_batches[&record.sequence];
        if batch.recipients.len() >= MAX_BATCH_RECIPIENTS || state.deliveries >= MAX_DELIVERIES {
            state
                .reason
                .get_or_insert(UnavailableReason::RetentionCapacity);
            return;
        }
        if batch
            .recipients
            .iter()
            .any(|prior| match (&prior.owner, &owner) {
                (Some(a), Some(b)) => {
                    a.instance == b.instance && a.owner.incarnation() == b.owner.incarnation()
                }
                (None, None) => true,
                _ => false,
            })
        {
            state.reason.get_or_insert(UnavailableReason::EmitFailed);
            return;
        }
        if !reserve(&DELIVERIES, 1, MAX_TOTAL_DELIVERIES) {
            state
                .reason
                .get_or_insert(UnavailableReason::RetentionCapacity);
            return;
        }
        let known_enqueue = enqueued
            && owner_current
            && metadata.available
            && metadata.unavailable_reason.is_none();
        state.deliveries += 1;
        state
            .input_batches
            .get_mut(&record.sequence)
            .unwrap()
            .recipients
            .push(RecipientDelivery {
                owner,
                known_enqueue,
            });
        if !enqueued {
            state.reason.get_or_insert(UnavailableReason::EmitFailed);
        } else if !owner_current {
            state
                .reason
                .get_or_insert(UnavailableReason::OwnerUnavailable);
        }
    }
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
        let process_pin = self.process.as_ref().map(|process| process.pin());
        let process_valid = !matches!(&process_pin, Some(Err(_)));
        let valid = {
            let mut state = self.lock_state();
            let valid = (slot as usize) < state.expected_readers && state.reader_slots.insert(slot);
            if !valid || !process_valid {
                state.reason.get_or_insert(UnavailableReason::ReaderError);
            }
            valid
        };
        Reader {
            stream: self.clone(),
            valid,
            finished: false,
            process_pin: process_pin.and_then(Result::ok),
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
    process_pin: Option<crate::harness::process_lifecycle::ProcessPin>,
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
