use super::*;
use crate::native_window_lifecycle::{
    test_buffer_owner, test_buffer_resources, test_reload_buffer_resources,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use std::path::PathBuf;
use tauri::ResourceTable;

struct Fixture {
    store: SessionStore,
    barrier: WindowBarrier,
    resources: ResourceTable,
}
impl Fixture {
    fn new() -> Self {
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "main");
        Self {
            store: SessionStore::open_in_memory().unwrap(),
            barrier,
            resources,
        }
    }
    fn run<T>(
        &self,
        work: impl FnOnce(&NativeBufferOwner) -> Result<T, String>,
    ) -> Result<T, String> {
        let (owner, operation) =
            test_buffer_owner(&self.resources, self.store.native_instance_id())?;
        operation
            .finish(work(&owner))
            .map_err(|error| error.to_string())
    }
    fn put(&self, mut input: PutDraft) -> Result<DraftReceipt, String> {
        self.run(|owner| {
            if input.owner_epoch.is_empty() {
                input.owner_epoch = open_current(&self.store, owner)?.owner_epoch;
            }
            put(&self.store, owner, input)
        })
    }
    fn read(&self) -> DraftRead {
        self.run(|owner| {
            read_current(
                &self.store,
                owner,
                DraftDocument {
                    owner_epoch: owner.key(),
                    document_id: "document".into(),
                },
            )
        })
        .unwrap()
    }
    fn saved(&self, record: &DraftMetadata) -> SaveCoveredDraft {
        SaveCoveredDraft {
            owner_epoch: record.owner_id.clone(),
            document_id: record.document_id.clone(),
            revision: record.revision,
            payload_digest: record.payload_digest.clone(),
            saved_text_digest: record.serialized_text_digest.clone(),
        }
    }
    fn clear(&self, input: SaveCoveredDraft) -> Result<DraftReceipt, String> {
        self.run(|owner| clear_saved(&self.store, owner, input))
    }
}
fn capture(revision: u64, expected: Option<u64>, text: &str) -> PutDraft {
    PutDraft {
        owner_epoch: String::new(),
        document_id: "document".into(),
        path: std::env::temp_dir()
            .join("preserved-editor.txt")
            .to_string_lossy()
            .into_owned(),
        text: text.into(),
        eol: DraftEol::Crlf,
        serialized_text: None,
        disk_baseline: "original\r\n".into(),
        revision,
        expected_revision: expected,
    }
}
fn bound(owner: &NativeBufferOwner, mut input: PutDraft) -> PutDraft {
    input.owner_epoch = owner.key();
    input
}
fn all(store: &SessionStore) -> DraftInventory {
    inventory(
        store,
        DraftInventoryRequest {
            after: None,
            limit: 100,
        },
    )
    .unwrap()
}

#[test]
fn mixed_serialized_text_is_retained_and_bound_to_normalized_text() {
    let f = Fixture::new();
    let mut input = capture(1, None, "one\ntwo\nthree\n");
    input.serialized_text = Some("one\r\ntwo\nthree\r".into());
    let receipt = f.put(input).unwrap();
    assert_eq!(
        receipt.record.serialized_text_digest,
        sha(b"one\r\ntwo\nthree\r")
    );
    assert_eq!(
        f.read().record.unwrap().payload.serialized_text.as_deref(),
        Some("one\r\ntwo\nthree\r")
    );
    let mut invalid = capture(2, Some(1), "one\ntwo\nthree\n");
    invalid.serialized_text = Some("different\r\n".into());
    assert!(f.put(invalid).is_err());
    assert_eq!(f.read().record.unwrap().payload.revision, 1);
}

#[test]
fn oversized_mixed_capture_is_rejected_without_replacing_retained_draft() {
    let f = Fixture::new();
    f.put(capture(1, None, "retained")).unwrap();
    let text = "a\nb\n".repeat(250_000);
    let raw = "a\r\nb\n".repeat(250_000);
    let mut large = capture(2, Some(1), &text);
    large.disk_baseline = raw.clone();
    large.serialized_text = Some(raw);
    assert!(f.put(large).is_err());
    let retained = f.read().record.unwrap();
    assert_eq!(retained.payload.text, "retained");
    assert_eq!(retained.payload.revision, 1);
}

#[test]
fn exact_lf_text_empty_capture_eol_baseline_and_native_digests_round_trip() {
    let f = Fixture::new();
    let first = f.put(capture(1, None, "漢🦀\nnew")).unwrap();
    assert!(!first.qualified);
    assert_eq!(
        first.record.serialized_text_digest,
        sha("漢🦀\r\nnew".as_bytes())
    );
    assert_eq!(first.record.baseline_digest, sha(b"original\r\n"));
    let read = f.read().record.unwrap();
    assert_eq!(read.payload.text, "漢🦀\nnew");
    assert_eq!(read.payload.eol, DraftEol::Crlf);
    assert_eq!(read.payload.disk_baseline, "original\r\n");
    let empty = f.put(capture(2, Some(1), "")).unwrap();
    assert_eq!(empty.record.text_digest, sha(b""));
    assert_eq!(f.read().record.unwrap().payload.text, "");
}

#[test]
fn duplicate_exact_revision_is_idempotent_but_changed_and_stale_revisions_reject() {
    let f = Fixture::new();
    let input = capture(1, None, "retained");
    let first = f.put(input.clone()).unwrap().record;
    assert_eq!(f.put(input).unwrap().record, first);
    assert!(f
        .put(capture(1, None, "replacement"))
        .unwrap_err()
        .contains("REVISION_CONFLICT"));
    assert!(f
        .put(capture(2, None, "replacement"))
        .unwrap_err()
        .contains("REVISION_CONFLICT"));
    let second = f.put(capture(2, Some(1), "newer")).unwrap();
    assert!(f
        .put(capture(1, None, "retained"))
        .unwrap_err()
        .contains("REVISION_CONFLICT"));
    assert_eq!(f.read().record.unwrap().metadata, second.record);
}

#[test]
fn save_report_cas_preserves_payload_bytes_and_its_idempotent_receipt() {
    let f = Fixture::new();
    let original = f.put(capture(1, None, "dirty\ntext")).unwrap().record;
    let saved = f.clear(f.saved(&original)).unwrap().record;
    assert_eq!(saved.state, "save-reported");
    assert!(saved.save_ack_id.is_some());
    assert_eq!(saved.retained_bytes, original.retained_bytes);
    assert_eq!(f.clear(f.saved(&original)).unwrap().record, saved);
    assert_eq!(
        f.put(capture(1, None, "dirty\ntext")).unwrap().record,
        saved
    );
    let restored = f.read().record.unwrap();
    assert_eq!(restored.payload.text, "dirty\ntext");
    assert_eq!(restored.metadata, saved);
    let new = f.put(capture(2, Some(1), "newer unsaved")).unwrap().record;
    assert_eq!(new.state, "retained");
    assert!(new.save_ack_id.is_none());
}

#[test]
fn old_save_ack_cannot_clear_a_later_edit_and_changed_digests_never_clear() {
    let f = Fixture::new();
    let first = f.put(capture(1, None, "old")).unwrap().record;
    let second = f.put(capture(2, Some(1), "latest")).unwrap().record;
    assert!(f
        .clear(f.saved(&first))
        .unwrap_err()
        .contains("REVISION_CONFLICT"));
    let mut wrong = f.saved(&second);
    wrong.payload_digest = "0".repeat(64);
    assert!(f.clear(wrong).unwrap_err().contains("REVISION_CONFLICT"));
    let mut wrong = f.saved(&second);
    wrong.saved_text_digest = "0".repeat(64);
    assert!(f.clear(wrong).unwrap_err().contains("REVISION_CONFLICT"));
    assert_eq!(f.read().record.unwrap().metadata, second);
}

#[test]
fn new_reload_incarnation_keeps_old_rows_and_current_owner_cannot_read_or_clear_them() {
    let f = Fixture::new();
    let old = f.put(capture(1, None, "old page")).unwrap().record;
    test_reload_buffer_resources(&f.resources);
    assert!(f.read().record.is_none());
    assert!(f
        .clear(f.saved(&old))
        .unwrap_err()
        .contains("OWNER_CHANGED"));
    let new = f.put(capture(1, None, "new page")).unwrap().record;
    assert_ne!(old.owner_id, new.owner_id);
    assert_ne!(old.window_incarnation, new.window_incarnation);
    assert_eq!(old.window_label, new.window_label);
    let rows = all(&f.store);
    assert_eq!(rows.records.len(), 2);
    assert!(!rows.qualified);
    let encoded = serde_json::to_value(rows).unwrap();
    assert!(encoded["records"]
        .as_array()
        .unwrap()
        .iter()
        .all(|record| record.get("payload").is_none() && record.get("text").is_none()));
}

#[test]
fn admitted_old_owner_is_not_replaced_by_reload_before_sql_settles() {
    let f = Fixture::new();
    let (old, operation) = test_buffer_owner(&f.resources, f.store.native_instance_id()).unwrap();
    test_reload_buffer_resources(&f.resources);
    let current = f.put(capture(1, None, "new page")).unwrap().record;
    let old_result = operation
        .finish(put(
            &f.store,
            &old,
            bound(&old, capture(1, None, "accepted old page")),
        ))
        .unwrap();
    assert_ne!(old_result.record.owner_id, current.owner_id);
    assert_eq!(f.read().record.unwrap().payload.text, "new page");
    assert_eq!(all(&f.store).records.len(), 2);
}

#[test]
fn same_label_replacement_and_another_store_instance_have_different_native_owners() {
    let f = Fixture::new();
    let first = f.put(capture(1, None, "original")).unwrap().record;
    let replacement = test_buffer_resources(&f.barrier, "main");
    assert!(test_buffer_owner(&f.resources, f.store.native_instance_id()).is_err());
    let (owner, operation) = test_buffer_owner(&replacement, f.store.native_instance_id()).unwrap();
    let replaced = operation
        .finish(put(
            &f.store,
            &owner,
            bound(&owner, capture(1, None, "replacement")),
        ))
        .unwrap()
        .record;
    assert_ne!(first.owner_id, replaced.owner_id);
    let another = SessionStore::open_in_memory().unwrap();
    let (owner, operation) = test_buffer_owner(&replacement, another.native_instance_id()).unwrap();
    let foreign = operation
        .finish(put(
            &another,
            &owner,
            bound(&owner, capture(1, None, "another store")),
        ))
        .unwrap()
        .record;
    assert_ne!(replaced.owner_id, foreign.owner_id);
    assert_ne!(replaced.store_instance, foreign.store_instance);
    let (wrong, operation) = test_buffer_owner(&replacement, f.store.native_instance_id()).unwrap();
    assert!(operation
        .finish(put(
            &another,
            &wrong,
            bound(&wrong, capture(2, Some(1), "wrong store"))
        ))
        .is_err());
}

#[test]
fn buffers_admission_precedes_effects_and_remains_pending_through_actual_sql() {
    let f = Fixture::new();
    let (owner, operation) = test_buffer_owner(&f.resources, f.store.native_instance_id()).unwrap();
    let closed = f.barrier.close_admission().unwrap();
    assert!(matches!(
        f.barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    assert!(
        test_buffer_owner(&f.resources, f.store.native_instance_id())
            .err()
            .unwrap()
            .contains("AdmissionClosed")
    );
    assert!(all(&f.store).records.is_empty());
    operation
        .finish(put(
            &f.store,
            &owner,
            bound(&owner, capture(1, None, "accepted before closure")),
        ))
        .unwrap();
    assert!(matches!(
        f.barrier.prove_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    assert_eq!(all(&f.store).records.len(), 1);
    f.barrier.reopen_admission(closed).unwrap();
    assert!(test_buffer_owner(&ResourceTable::default(), f.store.native_instance_id()).is_err());
}

#[test]
fn bounded_inventory_pages_are_nondestructive_and_cursor_scoped_without_content() {
    let f = Fixture::new();
    for document in ["a", "b", "c"] {
        let mut input = capture(1, None, document);
        input.document_id = document.into();
        f.put(input).unwrap();
    }
    let first = inventory(
        &f.store,
        DraftInventoryRequest {
            after: None,
            limit: 2,
        },
    )
    .unwrap();
    assert_eq!(
        first
            .records
            .iter()
            .map(|record| record.document_id.as_str())
            .collect::<Vec<_>>(),
        ["a", "b"]
    );
    let second = inventory(
        &f.store,
        DraftInventoryRequest {
            after: first.next,
            limit: 2,
        },
    )
    .unwrap();
    assert_eq!(second.records[0].document_id, "c");
    assert!(second.next.is_none());
    assert_eq!(all(&f.store).records.len(), 3);
    assert!(inventory(
        &f.store,
        DraftInventoryRequest {
            after: None,
            limit: 101
        }
    )
    .is_err());
}

#[test]
fn capture_limits_and_invalid_lf_or_revision_preserve_existing_data() {
    let f = Fixture::new();
    f.put(capture(1, None, "preserved")).unwrap();
    for mut invalid in [
        capture(2, Some(1), "wrong\r\n"),
        capture(0, Some(1), "bad"),
        capture(MAX_SAFE + 1, Some(1), "bad"),
        capture(2, Some(1), &"x".repeat(MAX_TEXT + 1)),
    ] {
        assert!(f.put(invalid.clone()).is_err());
        invalid.text.clear();
    }
    let mut baseline = capture(2, Some(1), "small");
    baseline.disk_baseline = "b".repeat(MAX_TEXT + 1);
    assert!(f.put(baseline).is_err());
    let mut escaped = capture(2, Some(1), &"\0".repeat(MAX_TEXT));
    escaped.disk_baseline.clear();
    assert!(f.put(escaped).unwrap_err().contains("DOCUMENT_LIMIT"));
    assert_eq!(f.read().record.unwrap().payload.text, "preserved");
}

#[test]
fn aggregate_profile_byte_limit_is_transactional_and_reported_saves_do_not_free_retained_bytes() {
    let f = Fixture::new();
    let text = "x".repeat(MAX_TEXT);
    let mut accepted = Vec::new();
    for index in 0..40 {
        let mut input = capture(1, None, &text);
        input.document_id = format!("document.{index}");
        input.disk_baseline.clear();
        match f.put(input) {
            Ok(receipt) => accepted.push(receipt.record),
            Err(error) => {
                assert!(error.contains("PROFILE_LIMIT"));
                break;
            }
        }
    }
    assert!(!accepted.is_empty() && accepted.len() < 40);
    let total: i64 = f
        .store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT SUM(retained_bytes) FROM native_editor_drafts",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(total <= MAX_PROFILE);
    for record in &accepted {
        f.clear(f.saved(record)).unwrap();
    }
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT SUM(retained_bytes) FROM native_editor_drafts",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        total
    );
    let mut extra = capture(1, None, &text);
    extra.document_id = "one.more".into();
    extra.disk_baseline.clear();
    assert!(f.put(extra).unwrap_err().contains("PROFILE_LIMIT"));
    assert_eq!(all(&f.store).records.len(), accepted.len());
}

#[test]
fn corrupt_stored_payload_metadata_or_undercharged_rows_never_become_absent_or_free_capacity() {
    for sql in [
        "UPDATE native_editor_drafts SET payload_json='{}'",
        "UPDATE native_editor_drafts SET payload_digest='bad'",
        "UPDATE native_editor_drafts SET path=CAST(zeroblob(4097) AS TEXT)",
        "UPDATE native_editor_drafts SET retained_bytes=1",
        "UPDATE native_editor_drafts SET state='save-reported'",
        "UPDATE native_editor_drafts SET document_id=CAST(zeroblob(513) AS TEXT)",
    ] {
        let f = Fixture::new();
        f.put(capture(1, None, "retained")).unwrap();
        f.store.lock_conn().unwrap().execute(sql, []).unwrap();
        let mut new = capture(1, None, "new");
        new.document_id = "new".into();
        assert!(f.put(new).is_ok(), "{sql}");
        assert!(
            f.run(|owner| read_current(
                &f.store,
                owner,
                DraftDocument {
                    owner_epoch: owner.key(),
                    document_id: "document".into()
                }
            ))
            .is_err()
                || inventory(
                    &f.store,
                    DraftInventoryRequest {
                        after: None,
                        limit: 100
                    }
                )
                .is_ok_and(|inventory| inventory
                    .records
                    .iter()
                    .all(|row| row.document_id != "document")),
            "{sql}"
        );
    }
}

struct Directory(PathBuf);

#[test]
fn inventory_rejects_under_and_overcharged_rows_without_materializing_payloads() {
    for sql in [
        "UPDATE native_editor_drafts SET retained_bytes=retained_bytes-1",
        "UPDATE native_editor_drafts SET retained_bytes=retained_bytes+1",
    ] {
        let f = Fixture::new();
        f.put(capture(1, None, "retained")).unwrap();
        f.store.lock_conn().unwrap().execute(sql, []).unwrap();
        assert!(
            inventory(
                &f.store,
                DraftInventoryRequest {
                    after: None,
                    limit: 100
                }
            )
            .is_ok_and(|inventory| inventory.records.is_empty()),
            "{sql}"
        );
    }
}
impl Directory {
    fn new() -> Self {
        let base = std::env::temp_dir().canonicalize().unwrap();
        let path = base.join(format!("bycoda-editor-drafts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        assert_eq!(
            self.0.parent(),
            Some(std::env::temp_dir().canonicalize().unwrap().as_path())
        );
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("bycoda-editor-drafts-"));
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[test]
fn reopen_preserves_exact_content_and_save_receipt_but_never_rebinds_an_old_owner_to_new_store() {
    let directory = Directory::new();
    let path = directory.0.join("native.db");
    let store = SessionStore::open(path.clone()).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let (owner, operation) = test_buffer_owner(&resources, store.native_instance_id()).unwrap();
    let saved = operation
        .finish(put(
            &store,
            &owner,
            bound(&owner, capture(1, None, "retained\n漢🦀")),
        ))
        .unwrap();
    let input = SaveCoveredDraft {
        owner_epoch: owner.key(),
        document_id: "document".into(),
        revision: 1,
        payload_digest: saved.record.payload_digest.clone(),
        saved_text_digest: saved.record.serialized_text_digest.clone(),
    };
    let old_receipt = clear_saved(&store, &owner, input).unwrap().record;
    drop(store);
    let reopened = SessionStore::open(path).unwrap();
    assert!(read_current(
        &reopened,
        &owner,
        DraftDocument {
            owner_epoch: owner.key(),
            document_id: "document".into()
        }
    )
    .is_err());
    let retained = all(&reopened);
    assert_eq!(retained.records[0], old_receipt);
    let conn = reopened.lock_conn().unwrap();
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred).unwrap();
    let (record, _) = read_record(&tx, &old_receipt.owner_id, "document")
        .unwrap()
        .unwrap();
    assert_eq!(record.payload.text, "retained\n漢🦀");
    assert_eq!(record.metadata.save_ack_id, old_receipt.save_ack_id);
}

#[test]
fn request_shapes_cannot_deserialize_a_native_owner_or_claim_save_authority() {
    let input = serde_json::to_value(capture(1, None, "retained")).unwrap();
    for key in [
        "ownerId",
        "storeInstance",
        "windowIncarnation",
        "qualified",
        "processId",
    ] {
        let mut changed = input.clone();
        changed[key] = serde_json::json!("forged");
        assert!(serde_json::from_value::<PutDraft>(changed).is_err());
    }
}

#[test]
fn concurrent_same_revision_cas_has_one_winner_and_later_edit_can_continue() {
    let f = Fixture::new();
    f.put(capture(1, None, "baseline")).unwrap();
    let (owner_a, operation_a) =
        test_buffer_owner(&f.resources, f.store.native_instance_id()).unwrap();
    let (owner_b, operation_b) =
        test_buffer_owner(&f.resources, f.store.native_instance_id()).unwrap();
    let start = std::sync::Arc::new(std::sync::Barrier::new(2));
    let results = std::thread::scope(|threads| {
        let store = &f.store;
        let a = start.clone();
        let first = threads.spawn(move || {
            a.wait();
            operation_a.finish(put(
                store,
                &owner_a,
                bound(&owner_a, capture(2, Some(1), "first")),
            ))
        });
        let second = threads.spawn(move || {
            start.wait();
            operation_b.finish(put(
                store,
                &owner_b,
                bound(&owner_b, capture(2, Some(1), "second")),
            ))
        });
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(f.read().record.unwrap().metadata.revision, 2);
    assert_eq!(
        f.put(capture(3, Some(2), "latest"))
            .unwrap()
            .record
            .revision,
        3
    );
}

#[test]
fn durable_record_quota_never_evicts_old_recovery_or_saved_rows() {
    let f = Fixture::new();
    for index in 0..MAX_RECORDS {
        let mut input = capture(1, None, "");
        input.document_id = format!("document.{index}");
        let saved = f.put(input).unwrap().record;
        if index == 0 {
            f.clear(f.saved(&saved)).unwrap();
        }
    }
    let mut extra = capture(1, None, "overflow");
    extra.document_id = "overflow".into();
    assert!(f.put(extra).unwrap_err().contains("PROFILE_LIMIT"));
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_editor_drafts", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        MAX_RECORDS
    );
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM native_editor_drafts WHERE state='save-reported'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn queued_first_put_read_or_save_report_cannot_bind_to_an_owner_created_after_reload() {
    let f = Fixture::new();
    let old_epoch = f
        .run(|owner| open_current(&f.store, owner))
        .unwrap()
        .owner_epoch;
    let mut held = capture(1, None, "old renderer first put");
    held.owner_epoch = old_epoch.clone();
    test_reload_buffer_resources(&f.resources);
    assert!(f.put(held).unwrap_err().contains("OWNER_CHANGED"));
    assert!(all(&f.store).records.is_empty());
    assert!(f
        .run(|owner| read_current(
            &f.store,
            owner,
            DraftDocument {
                owner_epoch: old_epoch.clone(),
                document_id: "document".into()
            }
        ))
        .is_err());
    let new = f.put(capture(1, None, "new renderer")).unwrap().record;
    let mut old_report = f.saved(&new);
    old_report.owner_epoch = old_epoch;
    assert!(f.clear(old_report).unwrap_err().contains("OWNER_CHANGED"));
    assert_eq!(f.read().record.unwrap().payload.text, "new renderer");
    let mut missing = capture(2, Some(1), "missing epoch");
    missing.owner_epoch = String::new();
    assert!(f
        .run(|owner| put(&f.store, owner, missing))
        .unwrap_err()
        .contains("OWNER_CHANGED"));
    let mut shape = serde_json::to_value(capture(1, None, "missing")).unwrap();
    shape.as_object_mut().unwrap().remove("ownerEpoch");
    assert!(serde_json::from_value::<PutDraft>(shape).is_err());
}

fn recovery_source(record: &DraftMetadata) -> DraftRecoverySource {
    DraftRecoverySource {
        owner_id: record.owner_id.clone(),
        document_id: record.document_id.clone(),
        revision: record.revision,
        payload_digest: record.payload_digest.clone(),
    }
}
fn recovery_request(owner: &NativeBufferOwner, source: DraftRecoverySource) -> ReadRecoveryDraft {
    ReadRecoveryDraft {
        owner_epoch: owner.key(),
        source,
    }
}

#[test]
fn recovery_read_discloses_exact_active_foreign_record_without_mutation_or_retirement() {
    let f = Fixture::new();
    let origin = f.put(capture(1, None, "origin\n漢🦀")).unwrap().record;
    let second = test_buffer_resources(&f.barrier, "second");
    let (current, operation) = test_buffer_owner(&second, f.store.native_instance_id()).unwrap();
    assert_ne!(current.key(), origin.owner_id);
    let before: i64 = f
        .store
        .lock_conn()
        .unwrap()
        .query_row("SELECT total_changes()", [], |row| row.get(0))
        .unwrap();
    let read = operation
        .finish(read_recovery(
            &f.store,
            &current,
            recovery_request(&current, recovery_source(&origin)),
        ))
        .unwrap();
    assert!(!read.qualified);
    assert_eq!(read.version, 1);
    assert_eq!(read.record.metadata, origin);
    assert_eq!(read.record.payload.text, "origin\n漢🦀");
    assert_eq!(read.record.payload.disk_baseline, "original\r\n");
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        before
    );
    assert_eq!(f.read().record.unwrap().metadata, origin);
    assert_eq!(all(&f.store).records.len(), 1);
    // Source can remain active. A target full capture is separate and cannot
    // resolve or erase a newer edit accepted by the original window.
    let newer = f
        .put(capture(2, Some(1), "new origin edit"))
        .unwrap()
        .record;
    let (current, operation) = test_buffer_owner(&second, f.store.native_instance_id()).unwrap();
    let payload = read.record.payload;
    let restored = operation
        .finish(put(
            &f.store,
            &current,
            PutDraft {
                owner_epoch: current.key(),
                document_id: payload.document_id,
                path: payload.path,
                text: payload.text,
                eol: payload.eol,
                serialized_text: payload.serialized_text.clone(),
                disk_baseline: payload.disk_baseline,
                revision: 1,
                expected_revision: None,
            },
        ))
        .unwrap()
        .record;
    assert_ne!(restored.owner_id, newer.owner_id);
    assert_eq!(f.read().record.unwrap().metadata, newer);
    assert_eq!(all(&f.store).records.len(), 2);
}

#[test]
fn recovery_read_rejects_changed_revision_digest_and_missing_source_instead_of_absent_success() {
    let f = Fixture::new();
    let original = f.put(capture(1, None, "original")).unwrap().record;
    let latest = f.put(capture(2, Some(1), "latest")).unwrap().record;
    assert!(f
        .run(|owner| read_recovery(
            &f.store,
            owner,
            recovery_request(owner, recovery_source(&original))
        ))
        .err()
        .unwrap()
        .contains("REVISION_CONFLICT"));
    let mut wrong = recovery_source(&latest);
    wrong.payload_digest = "0".repeat(64);
    assert!(f
        .run(|owner| read_recovery(&f.store, owner, recovery_request(owner, wrong)))
        .err()
        .unwrap()
        .contains("REVISION_CONFLICT"));
    let mut missing = recovery_source(&latest);
    missing.owner_id = "0".repeat(64);
    assert!(f
        .run(|owner| read_recovery(&f.store, owner, recovery_request(owner, missing)))
        .err()
        .unwrap()
        .contains("REVISION_CONFLICT"));
    assert_eq!(f.read().record.unwrap().metadata, latest);
}

#[test]
fn recovery_read_requires_current_native_epoch_after_reload_even_with_valid_source_locator() {
    let f = Fixture::new();
    let origin = f.put(capture(1, None, "retained old page")).unwrap().record;
    let old_request = f
        .run(|owner| Ok(recovery_request(owner, recovery_source(&origin))))
        .unwrap();
    test_reload_buffer_resources(&f.resources);
    assert!(f
        .run(|owner| read_recovery(&f.store, owner, old_request))
        .err()
        .unwrap()
        .contains("OWNER_CHANGED"));
    let fresh = f
        .run(|owner| {
            read_recovery(
                &f.store,
                owner,
                recovery_request(owner, recovery_source(&origin)),
            )
        })
        .unwrap();
    assert_eq!(fresh.record.payload.text, "retained old page");
    assert_eq!(fresh.record.metadata, origin);
    assert!(f.read().record.is_none());
    assert_eq!(all(&f.store).records.len(), 1);
}

#[test]
fn recovery_read_never_uses_foreign_store_or_caller_profile_selection() {
    let source = Fixture::new();
    let origin = source
        .put(capture(1, None, "source profile secret"))
        .unwrap()
        .record;
    let other = Fixture::new();
    assert!(other
        .run(|owner| read_recovery(
            &other.store,
            owner,
            recovery_request(owner, recovery_source(&origin))
        ))
        .err()
        .unwrap()
        .contains("REVISION_CONFLICT"));
    assert!(source
        .run(|owner| read_recovery(
            &other.store,
            owner,
            recovery_request(owner, recovery_source(&origin))
        ))
        .err()
        .unwrap()
        .contains("OWNER_UNAVAILABLE"));
    assert!(all(&other.store).records.is_empty());
    assert_eq!(source.read().record.unwrap().metadata, origin);
}

#[test]
fn recovery_read_applies_bounds_digest_and_exact_charge_checks_to_source_payload() {
    for sql in [
        "UPDATE native_editor_drafts SET payload_json='{}'",
        "UPDATE native_editor_drafts SET payload_json=CAST(zeroblob(4194305) AS TEXT)",
        "UPDATE native_editor_drafts SET path=CAST(zeroblob(4097) AS TEXT)",
        "UPDATE native_editor_drafts SET retained_bytes=1",
        "UPDATE native_editor_drafts SET retained_bytes=4194304",
        "UPDATE native_editor_drafts SET payload_digest=printf('%064d',0)",
    ] {
        let f = Fixture::new();
        let origin = f.put(capture(1, None, "preserved")).unwrap().record;
        f.store.lock_conn().unwrap().execute(sql, []).unwrap();
        let mut reference = recovery_source(&origin);
        if sql.contains("payload_digest=") {
            reference.payload_digest = "0".repeat(64);
        }
        assert!(
            f.run(|owner| read_recovery(&f.store, owner, recovery_request(owner, reference)))
                .is_err(),
            "{sql}"
        );
        let count: i64 = f
            .store
            .lock_conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_editor_drafts", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "{sql}");
    }
}

#[test]
fn recovery_read_preserves_reopened_reported_save_payload_and_receipt_for_separate_restore() {
    let directory = Directory::new();
    let path = directory.0.join("native.db");
    let source = SessionStore::open(path.clone()).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let (owner, operation) = test_buffer_owner(&resources, source.native_instance_id()).unwrap();
    let original = operation
        .finish(put(
            &source,
            &owner,
            bound(&owner, capture(1, None, "reported\n漢🦀")),
        ))
        .unwrap()
        .record;
    let saved = clear_saved(
        &source,
        &owner,
        SaveCoveredDraft {
            owner_epoch: owner.key(),
            document_id: original.document_id.clone(),
            revision: original.revision,
            payload_digest: original.payload_digest.clone(),
            saved_text_digest: original.serialized_text_digest.clone(),
        },
    )
    .unwrap()
    .record;
    drop(source);
    let reopened = SessionStore::open(path).unwrap();
    let next_barrier = WindowBarrier::new();
    let next_resources = test_buffer_resources(&next_barrier, "main");
    let (current, operation) =
        test_buffer_owner(&next_resources, reopened.native_instance_id()).unwrap();
    let read = operation
        .finish(read_recovery(
            &reopened,
            &current,
            recovery_request(&current, recovery_source(&saved)),
        ))
        .unwrap();
    assert!(!read.qualified);
    assert_ne!(current.key(), saved.owner_id);
    assert_eq!(read.record.metadata, saved);
    assert_eq!(read.record.payload.text, "reported\n漢🦀");
    assert_eq!(read.record.metadata.state, "save-reported");
    assert_eq!(all(&reopened).records[0], saved);
}

#[test]
fn recovery_request_is_closed_and_bounded_without_owner_or_path_authority_claims() {
    let f = Fixture::new();
    let original = f.put(capture(1, None, "original")).unwrap().record;
    for field in ["ownerId", "profilePath", "processId", "qualified"] {
        let mut value = f
            .run(|owner| {
                Ok(
                    serde_json::to_value(recovery_request(owner, recovery_source(&original)))
                        .unwrap(),
                )
            })
            .unwrap();
        value[field] = serde_json::json!("forged");
        assert!(serde_json::from_value::<ReadRecoveryDraft>(value).is_err());
    }
    let mut invalid = recovery_source(&original);
    invalid.document_id = "x".repeat(513);
    assert!(f
        .run(|owner| read_recovery(&f.store, owner, recovery_request(owner, invalid)))
        .err()
        .unwrap()
        .contains("INVALID_RECOVERY_SOURCE"));
    let mut invalid = recovery_source(&original);
    invalid.revision = MAX_SAFE + 1;
    assert!(f
        .run(|owner| read_recovery(&f.store, owner, recovery_request(owner, invalid)))
        .err()
        .unwrap()
        .contains("INVALID_RECOVERY_SOURCE"));
    let mut invalid = recovery_source(&original);
    invalid.owner_id = "not-an-owner".into();
    assert!(f
        .run(|owner| read_recovery(&f.store, owner, recovery_request(owner, invalid)))
        .err()
        .unwrap()
        .contains("INVALID_RECOVERY_SOURCE"));
    assert_eq!(f.read().record.unwrap().metadata, original);
}
