//! Exact current editor-row comparison inside the original checked FULL write.
//! This validates a subset of captured data, never a roster or Buffers closure.
use super::{check_owner, failure, read_record, sha, DraftEol, MAX_SAFE};
use crate::native_authority_checkpoint::CheckpointUnqualified;
use crate::native_window_lifecycle::CheckedCheckpointWindow;
use crate::session_store::authority::CheckedStoreTransaction;
use crate::session_store::native_raw_capture::RawCaptureArtifact;
use crate::session_store::SessionStore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorDraftValidationReceipt {
    version: u8,
    qualified: CheckpointUnqualified,
    roster_complete: CheckpointUnqualified,
    validated_count: u64,
    unverified_count: u64,
    raw_sha256: String,
    sha256: String,
}

/// Only this module constructs the result after comparing actual current rows.
/// It does not retain window authority or expose a deserializable capability.
pub(crate) struct ValidatedEditorCapture {
    receipt: EditorDraftValidationReceipt,
}
impl ValidatedEditorCapture {
    pub(crate) fn receipt(&self) -> EditorDraftValidationReceipt {
        self.receipt.clone()
    }
}

// The immutable RawCaptureArtifact has already checked the entire envelope,
// duplicate keys, size, nodes and depth. Ignore unrelated families and fields.
#[derive(Deserialize)]
struct Envelope {
    version: u8,
    #[serde(default)]
    producers: Vec<Producer>,
}
#[derive(Deserialize)]
struct Producer {
    id: u64,
    revision: u64,
    kind: String,
    snapshot: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditorSnapshot {
    version: u8,
    qualified: CheckpointUnqualified,
    document_id: String,
    path: String,
    origin: String,
    text: String,
    eol: DraftEol,
    #[serde(default)]
    serialized_text: Option<String>,
    disk_baseline: String,
    dirty: bool,
    read_only: bool,
    view_ready: bool,
    composing: bool,
    #[serde(default)]
    editor_kind: Option<EditorKind>,
    #[serde(default)]
    merge_state: Option<MergeState>,
    disk_conflict: bool,
    recovery_review: bool,
    draft_binding: Binding,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum EditorKind {
    Source,
    Merge,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MergeState {
    active: u64,
    regions: Vec<MergeRegion>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MergeRegion {
    id: u64,
    from: u64,
    to: u64,
    ours: String,
    theirs: String,
    initial: String,
    origin: MergeOrigin,
    choice: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum MergeOrigin {
    Base,
    Ours,
}
fn validate_editor_state(snapshot: &EditorSnapshot, present: (bool, bool)) -> Result<(), String> {
    match (present, &snapshot.editor_kind, &snapshot.merge_state) {
        ((false, false), None, None) | ((true, true), Some(EditorKind::Source), None) => Ok(()),
        ((true, true), Some(EditorKind::Merge), Some(state)) => {
            let mut ids = HashSet::new();
            for region in &state.regions {
                if region.id > MAX_SAFE
                    || region.from > region.to
                    || region.to > MAX_SAFE
                    || !ids.insert(region.id)
                    || !(region.choice.is_null()
                        || matches!(
                            region.choice.as_str(),
                            Some("ours" | "theirs" | "both" | "manual")
                        ))
                {
                    return Err(invalid());
                }
                // Exact capture data only; no Native merge/history attestation.
                let _ = (
                    &region.ours,
                    &region.theirs,
                    &region.initial,
                    &region.origin,
                );
            }
            if state.active > MAX_SAFE
                || if ids.is_empty() {
                    state.active != 0
                } else {
                    !ids.contains(&state.active)
                }
            {
                return Err(invalid());
            }
            Ok(())
        }
        _ => Err(invalid()),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    owner_epoch: String,
    document_id: String,
    path: String,
    phase: String,
    pending: bool,
    disposed: bool,
    initialization_decision_required: bool,
    error: Value,
    known_revision: u64,
    known_state: String,
    exact_body_acknowledged: bool,
    receipt: Value,
}

fn invalid() -> String {
    failure("CHECKPOINT_CAPTURE_CHANGED")
}

pub(crate) fn validate_capture_at(
    checked: &CheckedStoreTransaction<'_>,
    store: &SessionStore,
    owner: &CheckedCheckpointWindow<'_>,
    raw: &RawCaptureArtifact,
) -> Result<Option<ValidatedEditorCapture>, String> {
    if !checked.is_for(store)
        || checked.native_instance_id() != store.native_instance_id()
        || !owner.matches_store_instance(store.native_instance_id())
        || checked.connection().is_autocommit()
        || checked
            .connection()
            .pragma_query_value::<i64, _>(None, "synchronous", |row| row.get(0))
            .map_err(|_| invalid())?
            != 2
    {
        return Err(invalid());
    }
    let envelope: Envelope = serde_json::from_str(raw.raw()).map_err(|_| invalid())?;
    if envelope.version == 1 {
        return Ok(None);
    }
    if !matches!(envelope.version, 2 | 3) {
        return Err(invalid());
    }
    let actual_owner = owner.buffer_owner();
    check_owner(store, &actual_owner)?;
    let owner_key = actual_owner.key();
    let mut validated = Vec::new();
    let mut unverified = 0u64;
    for producer in envelope.producers {
        if producer.kind != "file-editor" {
            continue;
        }
        if producer
            .snapshot
            .get("draftBinding")
            .and_then(|binding| binding.get("exactBodyAcknowledged"))
            != Some(&Value::Bool(true))
        {
            // Missing binding, remote/web/profile state and false/null claims
            // retain their original data without becoming a validated row.
            unverified += 1;
            continue;
        }
        let editor_state_present = (
            producer.snapshot.get("editorKind").is_some(),
            producer.snapshot.get("mergeState").is_some(),
        );
        let snapshot: EditorSnapshot =
            serde_json::from_value(producer.snapshot).map_err(|_| invalid())?;
        validate_editor_state(&snapshot, editor_state_present)?;
        let binding = &snapshot.draft_binding;
        if snapshot.version != 1
            || snapshot.origin != "local-native"
            || !snapshot.view_ready
            || snapshot.composing
            || binding.pending
            || binding.disposed
            || binding.initialization_decision_required
            || !binding.error.is_null()
            || !binding.exact_body_acknowledged
            || binding.owner_epoch != owner_key
            || binding.document_id != snapshot.document_id
            || binding.path != snapshot.path
            || !matches!(
                binding.phase.as_str(),
                "ready" | "retained" | "save-reported"
            )
        {
            return Err(invalid());
        }
        let (record, original_row) =
            read_record(checked.connection(), &owner_key, &snapshot.document_id)?
                .ok_or_else(invalid)?;
        let metadata = &record.metadata;
        if metadata.owner_id != owner_key
            || metadata.store_instance != actual_owner.store_instance().to_string()
            || metadata.window_incarnation != actual_owner.incarnation().to_string()
            || metadata.window_label != actual_owner.label()
            || record.payload.document_id != snapshot.document_id
            || record.payload.path != snapshot.path
            || record.payload.text != snapshot.text
            || record.payload.eol != snapshot.eol
            || snapshot
                .serialized_text
                .as_ref()
                .map_or(record.payload.serialized_text.is_some(), |text| {
                    *text != super::serialized_text(&record.payload)
                })
            || record.payload.disk_baseline != snapshot.disk_baseline
            || binding.known_revision != metadata.revision
            || binding.known_state != metadata.state
            || (binding.phase != "ready" && binding.phase != metadata.state)
            || serde_json::to_value(metadata).map_err(|_| invalid())? != binding.receipt
        {
            return Err(invalid());
        }
        // These are captured state, not independently verified disk/UI facts.
        let _ = (
            snapshot.qualified,
            snapshot.dirty,
            snapshot.read_only,
            snapshot.disk_conflict,
            snapshot.recovery_review,
        );
        // Keep original producer identity/revision and actual raw row digest in
        // the commitment. Coalesced bodies cannot inherit an older ACK.
        validated.push((
            producer.id,
            producer.revision,
            sha(original_row.as_bytes()),
            record.metadata,
        ));
    }
    let sha256 = sha(&serde_json::to_vec(&(
        "native-editor-draft-validation-v1",
        raw.sha256(),
        &validated,
        unverified,
    ))
    .map_err(|_| invalid())?);
    Ok(Some(ValidatedEditorCapture {
        receipt: EditorDraftValidationReceipt {
            version: 1,
            qualified: CheckpointUnqualified,
            roster_complete: CheckpointUnqualified,
            validated_count: validated.len() as u64,
            unverified_count: unverified,
            raw_sha256: raw.sha256().into(),
            sha256,
        },
    }))
}

#[cfg(test)]
mod tests;
