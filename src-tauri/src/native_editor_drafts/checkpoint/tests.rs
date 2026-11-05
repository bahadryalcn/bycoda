use super::super::{clear_saved, digest, put, DraftMetadata, PutDraft, SaveCoveredDraft};
use super::*;
use crate::native_authority_checkpoint::{
    ExpectedSqlBlob, NativeCheckpointCommit, NativeCheckpointExpectation, NativeCheckpointScope,
    NativeSqlCheckpointReceipt,
};
use crate::native_window_lifecycle::{
    capture_checkpoint_resources, test_buffer_owner, test_buffer_resources,
    test_reload_buffer_resources, with_checkpoint_owner_group,
};
use crate::session_store::authority;
use crate::session_store::native_raw_capture;
use crate::session_store::row_identity::SessionRowIdentity;
use crate::session_store::window_barrier::WindowBarrier;
use serde_json::json;
use std::path::PathBuf;
use tauri::ResourceTable;

mod browser_raw_v3;

struct Fixture {
    store: SessionStore,
    resources: ResourceTable,
    root: PathBuf,
    _directory: Directory,
}
struct Directory {
    root: PathBuf,
    base: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-29-parent-buffers-native/fixtures");
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(format!("editor-checkpoint-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let store = SessionStore::open(root.join("sessions.db")).unwrap();
        let resources = test_buffer_resources(&WindowBarrier::new(), "main");
        store.lock_conn().unwrap().execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES('A','.','codex','fixture','approve','editor fixture',1,1,'[]')",[]).unwrap();
        let directory = Directory {
            root: root.clone(),
            base,
        };
        Self {
            store,
            resources,
            root,
            _directory: directory,
        }
    }
    fn put_exact(&self, text: &str, serialized: &str) -> DraftMetadata {
        let (owner, operation) =
            test_buffer_owner(&self.resources, self.store.native_instance_id()).unwrap();
        operation
            .finish(put(
                &self.store,
                &owner,
                PutDraft {
                    owner_epoch: owner.key(),
                    document_id: "document".into(),
                    path: self.root.join("document.rs").to_string_lossy().into_owned(),
                    text: text.into(),
                    eol: DraftEol::Crlf,
                    serialized_text: Some(serialized.into()),
                    disk_baseline: "original\r\n".into(),
                    revision: 1,
                    expected_revision: None,
                },
            ))
            .unwrap()
            .record
    }
    fn put(&self, revision: u64, text: &str) -> DraftMetadata {
        let (owner, operation) =
            test_buffer_owner(&self.resources, self.store.native_instance_id()).unwrap();
        operation
            .finish(put(
                &self.store,
                &owner,
                PutDraft {
                    owner_epoch: owner.key(),
                    document_id: "document".into(),
                    path: self.root.join("document.rs").to_string_lossy().into_owned(),
                    text: text.into(),
                    eol: DraftEol::Crlf,
                    serialized_text: None,
                    disk_baseline: "original\r\n".into(),
                    revision,
                    expected_revision: (revision > 1).then_some(revision - 1),
                },
            ))
            .unwrap()
            .record
    }
    fn full<T>(
        &self,
        resources: &ResourceTable,
        raw: &RawCaptureArtifact,
        consume: impl FnOnce(
            &CheckedStoreTransaction<'_>,
            Option<ValidatedEditorCapture>,
        ) -> Result<T, String>,
    ) -> Result<T, String> {
        let owner = capture_checkpoint_resources(resources, self.store.native_instance_id())?;
        with_checkpoint_owner_group(&[&owner], self.store.native_instance_id(), |group| {
            let checked_owner = group.checked_window(&owner).ok_or_else(invalid)?;
            authority::with_full_projection_transaction(&self.store, |tx| {
                let validated = validate_capture_at(&tx, &self.store, &checked_owner, raw)?;
                consume(&tx, validated)
            })
        })
    }
    fn validate(&self, raw: &RawCaptureArtifact) -> Result<Option<Value>, String> {
        self.full(&self.resources, raw, |_, validated| {
            validated
                .map(|value| serde_json::to_value(value.receipt()).map_err(|_| invalid()))
                .transpose()
        })
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        // Fixture field order releases SQLite handles before this final guard.
        let target = self.root.canonicalize().unwrap();
        assert_eq!(target.parent(), Some(self.base.as_path()));
        assert!(target
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("editor-checkpoint-"));
        std::fs::remove_dir_all(target).unwrap();
    }
}

fn raw(value: Value) -> RawCaptureArtifact {
    RawCaptureArtifact::parse(value.to_string(), "A").unwrap()
}

#[test]
fn v3_notes_candidates_never_supply_file_ack_or_complete_the_editor_roster() {
    let f = Fixture::new();
    let metadata = f.put(1, "actual file\n");
    let mut value = captured(&metadata, "actual file\n");
    value["version"] = json!(3);
    value["producerEpochs"]["notes"] = json!(2);
    value["producers"][0]["id"] = json!(4);
    let mut forged_note = value["producers"][0].clone();
    forged_note["id"] = json!(5);
    forged_note["kind"] = json!("note-editor");
    forged_note["snapshot"]["text"] = json!("dirty Notes body must not bind the file\r\n");
    value["producers"]
        .as_array_mut()
        .unwrap()
        .push(forged_note.clone());
    let receipt = f.validate(&raw(value.clone())).unwrap().unwrap();
    assert_eq!(receipt["validatedCount"], 1);
    assert_eq!(receipt["unverifiedCount"], 0);
    assert_eq!(receipt["qualified"], false);
    assert_eq!(receipt["rosterComplete"], false);

    value["producers"] = json!([forged_note]);
    let notes_only = raw(value);
    let receipt = f.validate(&notes_only).unwrap().unwrap();
    assert_eq!(receipt["validatedCount"], 0);
    assert_eq!(receipt["unverifiedCount"], 0);
    assert_eq!(receipt["qualified"], false);
    assert_eq!(receipt["rosterComplete"], false);
    assert!(notes_only
        .raw()
        .contains("dirty Notes body must not bind the file"));
}
fn captured(metadata: &DraftMetadata, text: &str) -> Value {
    json!({"version":2,"kind":"mounted-native-input-capture","qualified":false,"sessionId":"A",
        "snapshots":[],"producerCoverage":"unknown","producerEpochs":{"parent":0,"editor":1},
        "producers":[{"id":9,"revision":12,"kind":"file-editor","snapshot":{
            "version":1,"qualified":false,"documentId":metadata.document_id,"path":metadata.path,
            "origin":"local-native","text":text,"eol":"crlf","diskBaseline":"original\r\n",
            "dirty":true,"readOnly":false,"viewReady":true,"composing":false,
            "diskConflict":false,"recoveryReview":false,
            "draftBinding":{"ownerEpoch":metadata.owner_id,"documentId":metadata.document_id,"path":metadata.path,
                "phase":metadata.state,"pending":false,"disposed":false,"initializationDecisionRequired":false,"error":null,
                "knownRevision":metadata.revision,"knownState":metadata.state,"exactBodyAcknowledged":true,"receipt":metadata}}}]})
}
fn parent(
    checked: &CheckedStoreTransaction<'_>,
    store: &SessionStore,
    artifact: &RawCaptureArtifact,
    window_epoch: &str,
    row: &SessionRowIdentity,
) -> Result<NativeSqlCheckpointReceipt, String> {
    let expected = NativeCheckpointExpectation {
        revision: 0,
        updated_at: 1,
        transcript_sha256: sha(b"[]"),
        draft: ExpectedSqlBlob::Absent,
        queue: ExpectedSqlBlob::Absent,
    };
    store.renderer_checkpoint_commit_at_with_raw(
        checked,
        NativeCheckpointCommit {
            nonce: &uuid::Uuid::new_v4().to_string(),
            service_epoch: &uuid::Uuid::new_v4().to_string(),
            round_id: &uuid::Uuid::new_v4().to_string(),
            window_epoch,
            scope: &NativeCheckpointScope::new(
                "environment",
                artifact.session_id(),
                "migration",
                0,
            )?,
            row_identity: row,
            expected: &expected,
            fingerprint: &expected.fingerprint()?,
        },
        Some(artifact.descriptor(&sha(b"actual comparison"))?),
    )
}

#[test]
fn exact_current_row_and_original_capture_are_validated_in_actual_file_store_full_commit() {
    let f = Fixture::new();
    let metadata = f.put(1, "  \n漢🦀\n");
    let artifact = raw(captured(&metadata, "  \n漢🦀\n"));
    let row = f.store.capture_session_row_identity("A").unwrap().unwrap();
    let (receipt, retained) = f
        .full(&f.resources, &artifact, |tx, validated| {
            let receipt = validated.ok_or_else(invalid)?.receipt();
            let sql = parent(tx, &f.store, &artifact, &metadata.window_incarnation, &row)?;
            let retained = native_raw_capture::retain_at(tx, &f.store, &sql, &artifact)?;
            Ok((receipt, retained))
        })
        .unwrap();
    let result = serde_json::to_value(receipt).unwrap();
    assert_eq!(result["version"], 1);
    assert_eq!(result["qualified"], false);
    assert_eq!(result["rosterComplete"], false);
    assert_eq!(result["validatedCount"], 1);
    assert_eq!(result["unverifiedCount"], 0);
    assert_eq!(result["rawSha256"], artifact.sha256());
    assert!(digest(result["sha256"].as_str().unwrap()));
    let conn = f.store.lock_conn().unwrap();
    assert_eq!(
        native_raw_capture::read_at(&conn, &f.store, &retained).unwrap(),
        retained
    );
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "synchronous", |row| row.get(0))
            .unwrap(),
        1
    );
}

#[test]
fn checkpoint_requires_exact_mixed_serialized_body() {
    let f = Fixture::new();
    let text = "a\nb\n";
    let metadata = f.put_exact(text, "a\r\nb\n");
    let mut value = captured(&metadata, text);
    value["producers"][0]["snapshot"]["serializedText"] = json!("a\r\nb\n");
    assert_eq!(
        f.validate(&raw(value.clone())).unwrap().unwrap()["validatedCount"],
        1
    );
    value["producers"][0]["snapshot"]["serializedText"] = json!("a\r\nb\r\n");
    assert!(f.validate(&raw(value)).is_err());
}

#[test]
fn legacy_and_missing_false_null_remote_ack_remain_unverified_without_row_access() {
    let f = Fixture::new();
    let legacy = raw(
        json!({"version":1,"kind":"mounted-composer-raw-capture","qualified":false,"sessionId":"A","snapshots":[]}),
    );
    assert!(f.validate(&legacy).unwrap().is_none());
    let mut value = json!({"version":2,"kind":"mounted-native-input-capture","qualified":false,"sessionId":"A","snapshots":[],"producerCoverage":"unknown","producerEpochs":{"parent":0,"editor":0},"producers":[
        {"id":1,"revision":0,"kind":"file-editor","snapshot":{}},
        {"id":3,"revision":0,"kind":"file-editor","snapshot":{"origin":"remote","draftBinding":{"exactBodyAcknowledged":false,"receipt":{"forged":"data only"}}}},
        {"id":5,"revision":0,"kind":"file-editor","snapshot":{"origin":"web","draftBinding":{"exactBodyAcknowledged":null}}},
        {"id":6,"revision":0,"kind":"session-parent","snapshot":{"draftBinding":{"exactBodyAcknowledged":true}}}
    ]});
    let result = f.validate(&raw(value.clone())).unwrap().unwrap();
    assert_eq!(result["validatedCount"], 0);
    assert_eq!(result["unverifiedCount"], 3);
    value["producers"][0]["snapshot"]["draftBinding"] = json!({"exactBodyAcknowledged":true});
    assert!(f.validate(&raw(value)).is_err());
}

#[test]
fn wrong_window_runtime_store_and_reloaded_owner_cannot_validate_claimed_exact_row() {
    let f = Fixture::new();
    let metadata = f.put(1, "preserved");
    let artifact = raw(captured(&metadata, "preserved"));
    let other_window = test_buffer_resources(&WindowBarrier::new(), "other");
    assert!(f
        .full(&other_window, &artifact, |_, value| Ok(value))
        .is_err());
    let other_store = Fixture::new();
    let owner = capture_checkpoint_resources(&f.resources, f.store.native_instance_id()).unwrap();
    with_checkpoint_owner_group(&[&owner], f.store.native_instance_id(), |group| {
        let checked_owner = group.checked_window(&owner).unwrap();
        authority::with_full_projection_transaction(&other_store.store, |tx| {
            assert!(validate_capture_at(&tx, &f.store, &checked_owner, &artifact).is_err());
            assert!(
                validate_capture_at(&tx, &other_store.store, &checked_owner, &artifact).is_err()
            );
            Ok(())
        })
    })
    .unwrap();
    test_reload_buffer_resources(&f.resources);
    assert!(
        with_checkpoint_owner_group(&[&owner], f.store.native_instance_id(), |_| Ok(())).is_err()
    );
}

#[test]
fn changed_or_coalesced_body_cannot_inherit_original_ack_and_capture_identity_is_committed() {
    let f = Fixture::new();
    let first = f.put(1, "original");
    let original = captured(&first, "original");
    let original_result = f.validate(&raw(original.clone())).unwrap().unwrap();
    let mut identity = original.clone();
    identity["producers"][0]["id"] = json!(11);
    identity["producers"][0]["revision"] = json!(13);
    let new_identity = f.validate(&raw(identity)).unwrap().unwrap();
    assert_ne!(new_identity["sha256"], original_result["sha256"]);
    let mut forged_body = original.clone();
    forged_body["producers"][0]["snapshot"]["text"] = json!("newer coalesced body");
    assert!(f.validate(&raw(forged_body)).is_err());
    let second = f.put(2, "newer coalesced body");
    assert!(f.validate(&raw(original)).is_err());
    let mut old_ack = captured(&second, "newer coalesced body");
    old_ack["producers"][0]["snapshot"]["draftBinding"]["receipt"] =
        serde_json::to_value(first).unwrap();
    assert!(f.validate(&raw(old_ack)).is_err());
    assert_eq!(
        f.validate(&raw(captured(&second, "newer coalesced body")))
            .unwrap()
            .unwrap()["validatedCount"],
        1
    );
}

#[test]
fn every_native_receipt_field_and_exact_binding_flags_are_checked() {
    let f = Fixture::new();
    let metadata = f.put(1, "body\n");
    let original = captured(&metadata, "body\n");
    let receipt = original["producers"][0]["snapshot"]["draftBinding"]["receipt"]
        .as_object()
        .unwrap();
    for field in receipt.keys() {
        let mut value = original.clone();
        value["producers"][0]["snapshot"]["draftBinding"]["receipt"][field] =
            json!("mismatched actual metadata");
        assert!(f.validate(&raw(value)).is_err(), "{field}");
    }
    for (field, changed) in [
        ("ownerEpoch", json!("0".repeat(64))),
        ("documentId", json!("other-document")),
        ("path", json!("other-path")),
        ("phase", json!("writing")),
        ("pending", json!(true)),
        ("disposed", json!(true)),
        ("initializationDecisionRequired", json!(true)),
        ("error", json!("unknown-reply")),
        ("knownRevision", json!(2)),
        ("knownState", json!("save-reported")),
    ] {
        let mut value = original.clone();
        value["producers"][0]["snapshot"]["draftBinding"][field] = changed;
        assert!(f.validate(&raw(value)).is_err(), "{field}");
    }
    for (field, changed) in [
        ("version", json!(2)),
        ("qualified", json!(true)),
        ("documentId", json!("other-document")),
        ("path", json!("other-path")),
        ("origin", json!("remote")),
        ("text", json!("changed body")),
        ("eol", json!("lf")),
        ("diskBaseline", json!("different baseline")),
        ("viewReady", json!(false)),
        ("composing", json!(true)),
        ("extra", json!(true)),
    ] {
        let mut value = original.clone();
        value["producers"][0]["snapshot"][field] = changed;
        assert!(f.validate(&raw(value)).is_err(), "{field}");
    }
}

#[test]
fn source_and_merge_state_are_captured_data_beside_the_same_exact_native_body() {
    let f = Fixture::new();
    let metadata = f.put(1, "body");
    let legacy = captured(&metadata, "body");
    assert_eq!(
        f.validate(&raw(legacy.clone())).unwrap().unwrap()["validatedCount"],
        1
    );
    let mut source = legacy.clone();
    source["producers"][0]["snapshot"]["editorKind"] = json!("source");
    source["producers"][0]["snapshot"]["mergeState"] = Value::Null;
    let source_result = f.validate(&raw(source)).unwrap().unwrap();
    let mut merge = legacy;
    merge["producers"][0]["snapshot"]["editorKind"] = json!("merge");
    merge["producers"][0]["snapshot"]["mergeState"] = json!({"active":0,"regions":[{
        "id":0,"from":0,"to":4,"ours":"body","theirs":"different","initial":"unresolved original",
        "origin":"base","choice":null
    }]});
    for choice in [
        Value::Null,
        json!("ours"),
        json!("theirs"),
        json!("both"),
        json!("manual"),
    ] {
        merge["producers"][0]["snapshot"]["mergeState"]["regions"][0]["choice"] = choice;
        let result = f.validate(&raw(merge.clone())).unwrap().unwrap();
        assert_eq!(result["validatedCount"], 1);
        assert_eq!(result["qualified"], false);
        assert_eq!(result["rosterComplete"], false);
        assert_ne!(result["sha256"], source_result["sha256"]);
    }
    merge["producers"][0]["snapshot"]["text"] = json!("different editor body");
    assert!(f.validate(&raw(merge)).is_err());
}

#[test]
fn inconsistent_or_malformed_source_merge_state_cannot_accompany_claimed_exact_ack() {
    let f = Fixture::new();
    let metadata = f.put(1, "body");
    let mut original = captured(&metadata, "body");
    original["producers"][0]["snapshot"]["editorKind"] = json!("merge");
    original["producers"][0]["snapshot"]["mergeState"] = json!({"active":0,"regions":[{
        "id":0,"from":0,"to":4,"ours":"body","theirs":"different","initial":"original","origin":"ours","choice":"ours"
    }]});
    let mut invalid_states = Vec::new();
    for kind in [Value::Null, json!("source"), json!("unknown")] {
        let mut value = original.clone();
        value["producers"][0]["snapshot"]["editorKind"] = kind;
        invalid_states.push(value);
    }
    for state in [
        Value::Null,
        json!({}),
        json!({"active":0,"regions":[],"history":"unsupported"}),
        json!({"active":1,"regions":[]}),
    ] {
        let mut value = original.clone();
        value["producers"][0]["snapshot"]["mergeState"] = state;
        invalid_states.push(value);
    }
    for field in ["editorKind", "mergeState"] {
        let mut value = original.clone();
        value["producers"][0]["snapshot"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        invalid_states.push(value);
    }
    for (field, changed) in [
        ("id", json!(-1)),
        ("id", json!(MAX_SAFE + 1)),
        ("from", json!(5)),
        ("to", json!(MAX_SAFE + 1)),
        ("ours", Value::Null),
        ("origin", json!("theirs")),
        ("choice", json!("reset")),
        ("extra", json!(true)),
    ] {
        let mut value = original.clone();
        value["producers"][0]["snapshot"]["mergeState"]["regions"][0][field] = changed;
        invalid_states.push(value);
    }
    let mut value = original.clone();
    value["producers"][0]["snapshot"]["mergeState"]["active"] = json!(1);
    invalid_states.push(value);
    let mut value = original;
    let duplicate = value["producers"][0]["snapshot"]["mergeState"]["regions"][0].clone();
    value["producers"][0]["snapshot"]["mergeState"]["regions"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    invalid_states.push(value);
    for value in invalid_states {
        assert!(f.validate(&raw(value)).is_err());
    }
}

#[test]
fn changed_save_ack_and_missing_actual_row_fail_exact_claim_without_discarding_recovery_data() {
    let f = Fixture::new();
    let metadata = f.put(1, "kept\n");
    let original = raw(captured(&metadata, "kept\n"));
    let (owner, operation) = test_buffer_owner(&f.resources, f.store.native_instance_id()).unwrap();
    let saved = operation
        .finish(clear_saved(
            &f.store,
            &owner,
            SaveCoveredDraft {
                owner_epoch: owner.key(),
                document_id: metadata.document_id.clone(),
                revision: metadata.revision,
                payload_digest: metadata.payload_digest.clone(),
                saved_text_digest: metadata.serialized_text_digest.clone(),
            },
        ))
        .unwrap()
        .record;
    assert!(f.validate(&original).is_err());
    let artifact = raw(captured(&saved, "kept\n"));
    assert_eq!(f.validate(&artifact).unwrap().unwrap()["validatedCount"], 1);
    let conn = f.store.lock_conn().unwrap();
    let actual = read_record(&conn, &saved.owner_id, &saved.document_id)
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(actual.payload.text, "kept\n");
    conn.execute("DELETE FROM native_editor_drafts", [])
        .unwrap();
    drop(conn);
    assert!(f.validate(&artifact).is_err());
}

#[test]
fn failed_exact_comparison_rolls_back_actual_parent_and_child_in_same_full_transaction() {
    let f = Fixture::new();
    let metadata = f.put(1, "body");
    let mut bad = captured(&metadata, "body");
    bad["producers"][0]["snapshot"]["diskBaseline"] = json!("not the actual baseline");
    let artifact = raw(bad);
    let row = f.store.capture_session_row_identity("A").unwrap().unwrap();
    let owner = capture_checkpoint_resources(&f.resources, f.store.native_instance_id()).unwrap();
    let failed = with_checkpoint_owner_group(&[&owner], f.store.native_instance_id(), |group| {
        let checked_owner = group.checked_window(&owner).unwrap();
        authority::with_full_projection_transaction(&f.store, |tx| {
            // Demonstrate rollback even if a future caller inserts first. Root's
            // production integration validates before either immutable insert.
            let sql = parent(&tx, &f.store, &artifact, &metadata.window_incarnation, &row)?;
            native_raw_capture::retain_at(&tx, &f.store, &sql, &artifact)?;
            validate_capture_at(&tx, &f.store, &checked_owner, &artifact)
        })
    });
    assert!(failed.is_err());
    let conn = f.store.lock_conn().unwrap();
    for table in ["native_renderer_checkpoint_receipts", "native_raw_captures"] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
    let row = read_record(&conn, &metadata.owner_id, &metadata.document_id)
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(row.payload.text, "body");
}
