//! Actual in-memory Quick launch admission/receipt ledger. No durable proof.
use super::{LaunchScope, QuickLaunch, MAX_SEQUENCE};
use crate::native_window_lifecycle::NativeWriteAdmission;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RECORDS: usize = 128;

#[derive(Clone)]
pub(crate) struct IntentRequest {
    pub(crate) version: u8,
    pub(crate) scope: LaunchScope,
    pub(crate) sequence: u64,
    pub(crate) intent_id: String,
    pub(crate) request: QuickLaunch,
}
impl<'de> Deserialize<'de> for IntentRequest {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            version: u8,
            scope: LaunchScope,
            sequence: u64,
            intent_id: String,
            request: Value,
        }
        let wire = Wire::deserialize(deserializer)?;
        let allowed = [
            "prompt",
            "draft",
            "intent",
            "cwd",
            "harness",
            "model",
            "modelSettings",
            "runtimeMode",
            "workspaceMode",
            "worktreeBase",
            "worktreeCwd",
            "attachments",
            "reveal",
        ];
        let object = wire
            .request
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("Invalid Quick launch request"))?;
        if object.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err(serde::de::Error::custom("Unknown Quick launch field"));
        }
        if let Some(files) = object.get("attachments").and_then(Value::as_array) {
            let allowed = ["id", "name", "mimeType", "kind", "size", "path"];
            if files.iter().any(|file| {
                file.as_object()
                    .is_none_or(|object| object.keys().any(|key| !allowed.contains(&key.as_str())))
            }) {
                return Err(serde::de::Error::custom("Unknown Quick attachment field"));
            }
        }
        Ok(Self {
            version: wire.version,
            scope: wire.scope,
            sequence: wire.sequence,
            intent_id: wire.intent_id,
            request: serde_json::from_value(wire.request).map_err(serde::de::Error::custom)?,
        })
    }
}

struct BoundedBytes(Vec<u8>);
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_REQUEST_BYTES.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("Quick launch request is too large"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn canonical(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .map(|(key, value)| (key, canonical(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
        value => value,
    }
}
impl IntentRequest {
    pub(crate) fn digest(&self) -> Result<String, String> {
        let id =
            uuid::Uuid::parse_str(&self.intent_id).map_err(|_| "Invalid Quick intent identity")?;
        if self.version != 1
            || id.get_version_num() != 4
            || id.to_string() != self.intent_id
            || self.sequence == 0
            || self.sequence > MAX_SEQUENCE
        {
            return Err("Invalid Quick launch envelope".into());
        }
        if self.request.prompt.len() > 256 * 1024
            || self.request.attachments.len() > 20
            || self.request.model_settings.len() > 64
        {
            return Err("Quick launch request is too large".into());
        }
        // Reject oversized strings before cloning into serde_json::Value or
        // canonical bytes. IPC parsing already happened; this bounds our own
        // digest materialization, not the webview/IPC implementation's heap.
        let request = &self.request;
        let mut remaining = MAX_REQUEST_BYTES;
        let mut charge = |value: &str| -> Result<(), String> {
            remaining = remaining
                .checked_sub(value.len())
                .ok_or("Quick launch request is too large")?;
            Ok(())
        };
        for value in [&request.prompt, &request.cwd, &request.harness] {
            charge(value)?;
        }
        for value in [
            &request.intent,
            &request.model,
            &request.runtime_mode,
            &request.workspace_mode,
            &request.worktree_base,
            &request.worktree_cwd,
        ]
        .into_iter()
        .flatten()
        {
            charge(value)?;
        }
        for (key, value) in &request.model_settings {
            charge(key)?;
            charge(value)?;
        }
        for attachment in &request.attachments {
            for value in [
                &attachment.id,
                &attachment.name,
                &attachment.mime_type,
                &attachment.kind,
                &attachment.path,
            ] {
                charge(value)?;
            }
        }
        let mut bytes = BoundedBytes(Vec::new());
        serde_json::to_writer(
            &mut bytes,
            &canonical(serde_json::to_value(&self.request).map_err(|error| error.to_string())?),
        )
        .map_err(|error| error.to_string())?;
        Ok(format!("{:x}", Sha256::digest(bytes.0)))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReceiptState {
    Pending,
    Queued,
    Acknowledged,
    Unknown,
    Unavailable,
    Failed,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    pub(crate) version: u8,
    pub(crate) scope: LaunchScope,
    pub(crate) sequence: u64,
    pub(crate) intent_id: String,
    pub(crate) request_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) delivery_id: Option<String>,
    pub(crate) state: ReceiptState,
    pub(crate) qualified: bool,
}
impl Receipt {
    pub(crate) fn unavailable(request: &IntentRequest, digest: &str) -> Self {
        Self::new(request, digest, None, ReceiptState::Unavailable)
    }
    fn new(
        request: &IntentRequest,
        digest: &str,
        delivery_id: Option<String>,
        state: ReceiptState,
    ) -> Self {
        Self {
            version: 1,
            scope: request.scope.clone(),
            sequence: request.sequence,
            intent_id: request.intent_id.clone(),
            request_digest: digest.into(),
            delivery_id,
            state,
            qualified: false,
        }
    }
}
struct Record {
    receipt: Receipt,
    failed_observed: bool,
}
#[derive(Default)]
pub(crate) struct LaunchLedger {
    records: VecDeque<Record>,
}

/// Private, non-Clone ownership of one reserved execution attempt. Not a grant.
pub(crate) struct Ticket {
    receipt: Receipt,
}
impl Ticket {
    pub(crate) fn delivery_id(&self) -> &str {
        self.receipt
            .delivery_id
            .as_deref()
            .expect("reserved Native delivery")
    }
    pub(crate) fn scope(&self) -> &LaunchScope {
        &self.receipt.scope
    }
}
pub(crate) enum Admission {
    Start(Ticket),
    Existing(Receipt),
}
impl LaunchLedger {
    fn existing(&self, request: &IntentRequest) -> Option<usize> {
        self.records.iter().position(|record| {
            record.receipt.scope == request.scope && record.receipt.sequence == request.sequence
        })
    }
    fn exact(receipt: &Receipt, request: &IntentRequest, digest: &str) -> Result<(), String> {
        if receipt.intent_id != request.intent_id || receipt.request_digest != digest {
            return Err("QUICK_LAUNCH_INTENT_CONFLICT".into());
        }
        Ok(())
    }
    pub(crate) fn reserve(
        &mut self,
        next: &mut u64,
        request: &IntentRequest,
        digest: &str,
    ) -> Result<Admission, String> {
        if let Some(index) = self.existing(request) {
            let record = &self.records[index];
            Self::exact(&record.receipt, request, digest)?;
            // Terminal tuples are immutable. Verified no-effect correction
            // requires a fresh caller intent and the exact next sequence.
            return Ok(Admission::Existing(record.receipt.clone()));
        }
        if request.sequence < *next {
            return Ok(Admission::Existing(Receipt::new(
                request,
                digest,
                None,
                ReceiptState::Unknown,
            )));
        }
        if request.sequence != *next || *next >= MAX_SEQUENCE {
            return Ok(Admission::Existing(Receipt::unavailable(request, digest)));
        }
        if self.records.len() == MAX_RECORDS {
            if let Some(index) = self.records.iter().position(|record| {
                record.receipt.state == ReceiptState::Acknowledged
                    || (record.receipt.state == ReceiptState::Failed && record.failed_observed)
            }) {
                self.records.remove(index);
            } else {
                return Ok(Admission::Existing(Receipt::unavailable(request, digest)));
            }
        }
        let receipt = Receipt::new(
            request,
            digest,
            Some(uuid::Uuid::new_v4().to_string()),
            ReceiptState::Pending,
        );
        // Counter and Pending publication are under the caller's actual scope
        // lock plus ledger mutex, before any scheduling/create/copy/enqueue.
        *next += 1;
        self.records.push_back(Record {
            receipt: receipt.clone(),
            failed_observed: false,
        });
        Ok(Admission::Start(Ticket { receipt }))
    }
    pub(crate) fn status(
        &mut self,
        request: &IntentRequest,
        digest: &str,
    ) -> Result<Receipt, String> {
        if let Some(index) = self.existing(request) {
            let record = &mut self.records[index];
            Self::exact(&record.receipt, request, digest)?;
            if record.receipt.state == ReceiptState::Failed {
                record.failed_observed = true;
            }
            return Ok(record.receipt.clone());
        }
        // Missing includes compacted history: never infer absent/not admitted.
        Ok(Receipt::new(request, digest, None, ReceiptState::Unknown))
    }
    pub(crate) fn settle(
        &mut self,
        ticket: Ticket,
        state: ReceiptState,
    ) -> Result<Receipt, String> {
        let record = self
            .records
            .iter_mut()
            .find(|record| {
                record.receipt.scope == ticket.receipt.scope
                    && record.receipt.sequence == ticket.receipt.sequence
            })
            .ok_or("QUICK_LAUNCH_UNAVAILABLE")?;
        if record.receipt.delivery_id != ticket.receipt.delivery_id {
            return Err("QUICK_LAUNCH_STALE_ATTEMPT".into());
        }
        if !matches!(record.receipt.state, ReceiptState::Pending)
            || !matches!(
                state,
                ReceiptState::Queued | ReceiptState::Unknown | ReceiptState::Failed
            )
        {
            return Err("QUICK_LAUNCH_STALE_ATTEMPT".into());
        }
        record.receipt.state = state;
        Ok(record.receipt.clone())
    }
    pub(crate) fn acknowledge_existing(&mut self, delivery: &str) {
        if let Some(record) = self.records.iter_mut().find(|record| {
            record.receipt.delivery_id.as_deref() == Some(delivery)
                && record.receipt.state == ReceiptState::Queued
        }) {
            record.receipt.state = ReceiptState::Acknowledged;
        }
    }
}

/// Owned by the actual scheduled job, never by its detachable response waiter.
pub(crate) struct LaunchWork {
    ledger: Arc<Mutex<LaunchLedger>>,
    ticket: Option<Ticket>,
    admission: Option<NativeWriteAdmission>,
}
impl LaunchWork {
    pub(crate) fn new(ledger: Arc<Mutex<LaunchLedger>>, ticket: Ticket) -> Self {
        Self {
            ledger,
            ticket: Some(ticket),
            admission: None,
        }
    }
    pub(crate) fn admitted(&mut self, admission: NativeWriteAdmission) {
        self.admission = Some(admission);
    }
    pub(crate) fn delivery_id(&self) -> &str {
        self.ticket
            .as_ref()
            .expect("owned launch ticket")
            .delivery_id()
    }
    pub(crate) fn scope(&self) -> &LaunchScope {
        self.ticket.as_ref().expect("owned launch ticket").scope()
    }
    pub(crate) fn finish(mut self, state: ReceiptState) -> Result<Receipt, String> {
        let result = self
            .ledger
            .lock()
            .map_err(|_| "QUICK_LAUNCH_UNAVAILABLE".to_string())?
            .settle(self.ticket.take().expect("owned launch ticket"), state);
        if let Some(admission) = self.admission.take() {
            let outcome = if result.is_ok() && state == ReceiptState::Queued {
                Ok(())
            } else {
                Err(())
            };
            let _ = admission.finish(outcome);
        }
        result
    }
}
impl Drop for LaunchWork {
    fn drop(&mut self) {
        if let Some(ticket) = self.ticket.take() {
            if let Ok(mut ledger) = self.ledger.lock() {
                let _ = ledger.settle(ticket, ReceiptState::Unknown);
            }
        }
        // Unfinished admission drops unknown. Neither wait cancellation nor
        // dispatch failure certifies that earlier effects did not happen.
    }
}
