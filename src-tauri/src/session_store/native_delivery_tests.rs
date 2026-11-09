use super::*;
use std::collections::HashSet;
use std::path::PathBuf;

const ROUTE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ROUTE: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUFFER: &str = "native.buffers.update";
const FORMAT: &str = "native.services.workspace.format";

struct FileStore {
    directory: PathBuf,
    path: PathBuf,
}
impl FileStore {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("bycoda-native-delivery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        Self {
            path: directory.join("sessions.sqlite"),
            directory,
        }
    }
    fn open(&self) -> SessionStore {
        SessionStore::open(self.path.clone()).unwrap()
    }
}
impl Drop for FileStore {
    fn drop(&mut self) {
        if let (Ok(root), Ok(target)) = (
            std::env::temp_dir().canonicalize(),
            self.directory.canonicalize(),
        ) {
            if target.parent() == Some(root.as_path())
                && target.file_name().is_some_and(|name| {
                    name.to_string_lossy()
                        .starts_with("bycoda-native-delivery-")
                })
            {
                let _ = std::fs::remove_dir_all(target);
            }
        }
    }
}
fn prepared(store: &SessionStore, key: &str) -> Original {
    prepare(
        store,
        key,
        ROUTE,
        BUFFER,
        r#"{"owners":[],"instanceId":"native-original"}"#,
    )
    .unwrap()
}
fn rows(store: &SessionStore) -> i64 {
    let conn = store.lock_conn().unwrap();
    if !exists(&conn).unwrap() {
        return 0;
    }
    conn.query_row("SELECT COUNT(*) FROM native_delivery_originals", [], |r| {
        r.get(0)
    })
    .unwrap()
}
fn synchronous(store: &SessionStore) -> i64 {
    store
        .lock_conn()
        .unwrap()
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .unwrap()
}

#[test]
fn preparation_preserves_exact_large_original_bytes_across_file_reopen() {
    let file = FileStore::new();
    let store = file.open();
    let raw = format!(
        " {{\n  \"content\":\"{}\",\"path\":\"çalışma/文件.rs\"\n}} ",
        "x".repeat(2 * 1024 * 1024)
    );
    let original = prepare(
        &store,
        "buffer:owner:17:physical-nonce",
        ROUTE,
        BUFFER,
        &raw,
    )
    .unwrap();
    let id = original.id().to_owned();
    assert_eq!(original.payload_bytes(), raw.len());
    assert_eq!(original.payload_sha256(), digest(&raw));
    assert_eq!(params_json(&store, &original).unwrap(), raw);
    assert!(original.can_dispatch());
    assert_eq!(
        synchronous(&store),
        1,
        "FULL must restore the Store's NORMAL mode"
    );
    drop(store);
    let reopened = file.open();
    let page = pending(&reopened, ROUTE, None, 4).unwrap();
    assert_eq!(page.originals.len(), 1);
    let recovered = &page.originals[0];
    assert_eq!(recovered.id(), id);
    assert_eq!(recovered.phase(), Phase::Prepared);
    assert!(
        !recovered.can_dispatch(),
        "a journal row cannot recreate the retired source runtime"
    );
    assert_eq!(params_json(&reopened, recovered).unwrap(), raw);
    assert!(mark_possible(&reopened, recovered)
        .unwrap_err()
        .contains("STATUS_ONLY"));
    assert!(params_json(&reopened, &original)
        .unwrap_err()
        .contains("STALE"));
    assert_eq!(rows(&reopened), 1);
}

#[test]
fn distinct_physical_nonces_versions_and_same_bytes_are_distinct_originals() {
    let store = SessionStore::open_in_memory().unwrap();
    let one = prepared(&store, "buffer:owner:17:nonce-one");
    let two = prepared(&store, "buffer:owner:18:nonce-two");
    assert_ne!(one.id(), two.id());
    assert_eq!(one.payload_sha256(), two.payload_sha256());
    assert_eq!(rows(&store), 2);
}

#[test]
fn original_key_cannot_retarget_change_method_or_alias_different_exact_bytes() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:17:nonce");
    let raw = params_json(&store, &original).unwrap();
    assert_eq!(
        prepare(&store, original.semantic_key(), ROUTE, BUFFER, &raw)
            .unwrap()
            .id(),
        original.id()
    );
    for (route, method, bytes) in [
        (OTHER_ROUTE, BUFFER, raw.clone()),
        (ROUTE, FORMAT, raw.clone()),
        (ROUTE, BUFFER, format!(" {raw}")),
    ] {
        assert!(
            prepare(&store, original.semantic_key(), route, method, &bytes)
                .unwrap_err()
                .contains("CONFLICT")
        );
    }
    assert_eq!(rows(&store), 1);
    assert_eq!(params_json(&store, &original).unwrap(), raw);
}

#[test]
fn dispatch_cas_is_single_winner_and_never_idempotently_grants_second_send() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:1:nonce");
    let barrier = std::sync::Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let a = scope.spawn(|| {
            barrier.wait();
            mark_possible(&store, &original)
        });
        let b = scope.spawn(|| {
            barrier.wait();
            mark_possible(&store, &original)
        });
        [a.join().unwrap(), b.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|r| r.is_err()).count(), 1);
    let current = pending(&store, ROUTE, None, 4)
        .unwrap()
        .originals
        .pop()
        .unwrap();
    assert_eq!(current.phase(), Phase::Possible);
    assert!(!current.can_dispatch());
    assert!(mark_possible(&store, &original).is_err());
}

#[test]
fn only_current_definite_unsent_can_restore_prepared_state() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:1:nonce");
    let possible = mark_possible(&store, &original).unwrap();
    let unsent = definitely_unsent(&store, &possible).unwrap();
    assert!(unsent.can_dispatch());
    let second = mark_possible(&store, &unsent).unwrap();
    assert!(definitely_unsent(&store, &possible)
        .unwrap_err()
        .contains("STATUS_ONLY"));
    assert_eq!(second.phase(), Phase::Possible);
    let recorded = record_result(&store, &second, r#"{"acknowledged":true}"#).unwrap();
    assert!(definitely_unsent(&store, &second).is_err());
    assert_eq!(recorded.phase(), Phase::Recorded);
}

#[test]
fn possible_dispatch_reopens_status_only_and_authoritative_outcome_stays_separate() {
    let file = FileStore::new();
    let store = file.open();
    let original = prepared(&store, "buffer:owner:2:nonce");
    let possible = mark_possible(&store, &original).unwrap();
    let id = possible.id().to_owned();
    drop(store);
    let reopened = file.open();
    let recovered = pending(&reopened, ROUTE, None, 1)
        .unwrap()
        .originals
        .pop()
        .unwrap();
    assert_eq!(recovered.id(), id);
    assert_eq!(recovered.phase(), Phase::Possible);
    assert!(!recovered.can_dispatch());
    assert!(mark_possible(&reopened, &recovered).is_err());
    assert!(definitely_unsent(&reopened, &recovered).is_err());
    let recorded = record_result(&reopened, &recovered, r#"{"acknowledged":true}"#).unwrap();
    assert_eq!(recorded.phase(), Phase::Recorded);
    assert_eq!(
        result_json(&reopened, &recorded).unwrap().as_deref(),
        Some(r#"{"acknowledged":true}"#)
    );
    assert!(!recorded.can_dispatch());
    assert_eq!(rows(&reopened), 1);
}

#[test]
fn recorded_result_is_immutable_and_repeated_verified_result_is_read_only() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:3:nonce");
    assert!(record_result(&store, &original, "null").is_err());
    let possible = mark_possible(&store, &original).unwrap();
    let recorded = record_result(&store, &possible, "null").unwrap();
    let same = record_result(&store, &possible, "null").unwrap();
    assert_eq!(same.revision, recorded.revision);
    assert!(record_result(&store, &recorded, "true")
        .unwrap_err()
        .contains("RESULT_CONFLICT"));
    assert_eq!(
        result_json(&store, &recorded).unwrap().as_deref(),
        Some("null")
    );
}

#[test]
fn failed_source_ack_rolls_back_journal_consumption_and_success_releases_bytes_atomically() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:3:nonce");
    let possible = mark_possible(&store, &original).unwrap();
    let recorded = record_result(&store, &possible, "null").unwrap();
    let before = params_json(&store, &recorded).unwrap();
    let failed: Result<(), String> = authority::with_full_projection_transaction(&store, |tx| {
        acknowledge_tx(tx.connection(), &recorded)?;
        Err("exact source CAS did not confirm".into())
    });
    assert!(failed.is_err());
    assert_eq!(params_json(&store, &recorded).unwrap(), before);
    assert_eq!(
        result_json(&store, &recorded).unwrap().as_deref(),
        Some("null")
    );
    let admission = completion_admission(&store).unwrap();
    admission
        .finish(authority::with_full_projection_transaction(&store, |tx| {
            acknowledge_tx(tx.connection(), &recorded)
        }))
        .unwrap();
    let terminal = prepare(&store, original.semantic_key(), ROUTE, BUFFER, &before).unwrap();
    assert_eq!(terminal.phase(), Phase::Acknowledged);
    assert!(!terminal.can_dispatch());
    assert!(params_json(&store, &terminal).is_err());
    assert!(result_json(&store, &terminal).unwrap().is_none());
    assert!(pending(&store, ROUTE, None, 1)
        .unwrap()
        .originals
        .is_empty());
    assert_eq!(rows(&store), 1, "small no-replay metadata is retained");
    assert_eq!(terminal.payload_sha256(), original.payload_sha256());
}

#[test]
fn full_transaction_required_for_result_or_ack_and_foreign_store_handle_rejected() {
    let store = SessionStore::open_in_memory().unwrap();
    let other = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:3:nonce");
    let possible = mark_possible(&store, &original).unwrap();
    {
        let conn = store.lock_conn().unwrap();
        assert!(record_result_tx(&conn, &possible, "null")
            .unwrap_err()
            .contains("FULL_TRANSACTION_REQUIRED"));
        assert!(acknowledge_tx(&conn, &possible)
            .unwrap_err()
            .contains("FULL_TRANSACTION_REQUIRED"));
    }
    assert!(mark_possible(&other, &original)
        .unwrap_err()
        .contains("STALE"));
    assert!(params_json(&other, &original)
        .unwrap_err()
        .contains("STALE"));
    assert!(
        authority::with_full_projection_transaction(&other, |tx| record_result_tx(
            tx.connection(),
            &possible,
            "null"
        ))
        .unwrap_err()
        .contains("STALE")
    );
}

#[test]
fn possible_result_tx_participates_in_caller_full_rollback() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:4:nonce");
    let possible = mark_possible(&store, &original).unwrap();
    let rolled_back: Result<(), String> =
        authority::with_full_projection_transaction(&store, |tx| {
            let recorded = record_result_tx(tx.connection(), &possible, "null")?;
            assert_eq!(recorded.phase(), Phase::Recorded);
            Err("actual consumer failed".into())
        });
    assert!(rolled_back.is_err());
    assert!(result_json(&store, &possible).unwrap().is_none());
    assert_eq!(
        pending(&store, ROUTE, None, 1).unwrap().originals[0].phase(),
        Phase::Possible
    );
}

#[test]
fn full_commit_failure_is_uncertain_and_normal_synchronous_is_restored() {
    let file = FileStore::new();
    let store = file.open();
    let original = prepared(&store, "buffer:owner:5:nonce");
    store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    let error = mark_possible(&store, &original).unwrap_err();
    store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert!(error.contains("COMMIT_UNCERTAIN"), "{error}");
    assert_eq!(synchronous(&store), 1);
    let current = pending(&store, ROUTE, None, 1)
        .unwrap()
        .originals
        .pop()
        .unwrap();
    assert_eq!(
        current.phase(),
        Phase::Prepared,
        "the injected commit hook rolls back"
    );
    assert_eq!(current.revision, original.revision);
}

#[test]
fn closed_process_admission_rejects_before_creating_journal_or_dispatch_state() {
    let mut store = SessionStore::open_in_memory().unwrap();
    let barrier = super::super::window_barrier::WindowBarrier::new();
    let _closed = barrier.close_admission().unwrap();
    store.native_writer_barrier = Some(barrier);
    assert!(prepare(&store, "buffer:owner:1:nonce", ROUTE, BUFFER, "{}")
        .unwrap_err()
        .contains("AdmissionClosed"));
    assert_eq!(rows(&store), 0);
}

#[test]
fn pending_is_metadata_only_bounded_paged_and_route_isolated() {
    let store = SessionStore::open_in_memory().unwrap();
    let mut expected = HashSet::new();
    for i in 0..5 {
        expected.insert(
            prepared(&store, &format!("buffer:owner:{i}:nonce"))
                .id()
                .to_owned(),
        );
    }
    prepare(&store, "buffer:other:1:nonce", OTHER_ROUTE, BUFFER, "{}").unwrap();
    let mut found = HashSet::new();
    let mut after = None;
    loop {
        let page = pending(&store, ROUTE, after.as_deref(), 2).unwrap();
        assert!(page.originals.len() <= 2);
        for item in page.originals {
            assert_eq!(item.route_fingerprint(), ROUTE);
            found.insert(item.id().to_owned());
        }
        if page.next.is_none() {
            break;
        }
        after = page.next;
    }
    assert_eq!(found, expected);
    assert!(pending(&store, ROUTE, None, 0).is_err());
    assert!(pending(&store, ROUTE, None, MAX_PAGE + 1).is_err());
}

#[test]
fn corrupt_same_length_params_or_result_stay_held_and_never_ack() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepare(&store, "buffer:owner:6:nonce", ROUTE, BUFFER, "{}").unwrap();
    let possible = mark_possible(&store, &original).unwrap();
    {
        let conn = store.lock_conn().unwrap();
        conn.execute_batch("DROP TRIGGER native_delivery_params_immutable")
            .unwrap();
        conn.execute(
            "UPDATE native_delivery_originals SET params_json='[]' WHERE original_id=?1",
            [original.id()],
        )
        .unwrap();
    }
    assert!(params_json(&store, &possible).is_err());
    assert!(record_result(&store, &possible, "null").is_err());
    let different = prepared(&store, "buffer:owner:7:nonce");
    let possible = mark_possible(&store, &different).unwrap();
    let recorded = record_result(&store, &possible, "null").unwrap();
    {
        let conn = store.lock_conn().unwrap();
        conn.execute_batch("DROP TRIGGER native_delivery_result_immutable")
            .unwrap();
        conn.execute(
            "UPDATE native_delivery_originals SET result_json='true' WHERE original_id=?1",
            [recorded.id()],
        )
        .unwrap();
    }
    assert!(result_json(&store, &recorded).is_err());
    assert!(acknowledge(&store, &recorded).is_err());
    assert_eq!(rows(&store), 2);
}

#[test]
fn oversized_retained_blob_is_rejected_in_sql_before_rust_disclosure() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:8:nonce");
    {
        let conn = store.lock_conn().unwrap();
        conn.execute_batch("DROP TRIGGER native_delivery_params_immutable")
            .unwrap();
        conn.execute("UPDATE native_delivery_originals SET params_json=CAST(zeroblob(?1) AS TEXT) WHERE original_id=?2",params![(MAX_PARAMS_BYTES+1) as i64,original.id()]).unwrap();
    }
    assert!(params_json(&store, &original).is_err());
    assert!(pending(&store, ROUTE, None, 1).is_err());
    assert!(mark_possible(&store, &original).is_err());
    assert_eq!(rows(&store), 1);
}

#[test]
fn active_capacity_does_not_evict_originals_and_consumption_frees_reservation() {
    let store = SessionStore::open_in_memory().unwrap();
    let first = prepared(&store, "buffer:owner:0:nonce");
    for i in 1..MAX_ACTIVE_ROWS {
        prepared(&store, &format!("buffer:owner:{i}:nonce"));
    }
    assert!(
        prepare(&store, "buffer:overflow:nonce", ROUTE, BUFFER, "{}")
            .unwrap_err()
            .contains("CAPACITY")
    );
    assert_eq!(rows(&store), MAX_ACTIVE_ROWS as i64);
    assert!(params_json(&store, &first).is_ok());
    let possible = mark_possible(&store, &first).unwrap();
    let recorded = record_result(&store, &possible, "null").unwrap();
    acknowledge(&store, &recorded).unwrap();
    assert!(prepare(&store, "buffer:overflow:nonce", ROUTE, BUFFER, "{}").is_ok());
    assert_eq!(rows(&store), (MAX_ACTIVE_ROWS + 1) as i64);
}

#[test]
fn original_and_result_bounds_are_checked_before_state_changes() {
    let store = SessionStore::open_in_memory().unwrap();
    assert!(prepare(
        &store,
        "buffer:owner:9:nonce",
        ROUTE,
        BUFFER,
        &"x".repeat(MAX_PARAMS_BYTES + 1)
    )
    .is_err());
    assert!(prepare(
        &store,
        "buffer:owner:9:nonce",
        ROUTE,
        "arbitrary.method",
        "{}"
    )
    .is_err());
    assert!(prepare(&store, "buffer:owner:9:nonce", "not-a-hash", BUFFER, "{}").is_err());
    assert_eq!(rows(&store), 0);
    let original = prepared(&store, "buffer:owner:9:nonce");
    let possible = mark_possible(&store, &original).unwrap();
    let oversized = serde_json::to_string(&"x".repeat(64 * 1024)).unwrap();
    assert!(record_result(&store, &possible, &oversized).is_err());
    assert!(result_json(&store, &possible).unwrap().is_none());
    assert_eq!(
        pending(&store, ROUTE, None, 1).unwrap().originals[0].phase(),
        Phase::Possible
    );
}

#[test]
fn result_capacity_is_reserved_before_dispatch_not_after_effect_completion() {
    let store = SessionStore::open_in_memory().unwrap();
    let raw =
        serde_json::to_string(&serde_json::json!({"content":"x".repeat(MAX_PARAMS_BYTES-100)}))
            .unwrap();
    let first = prepare(&store, "service.format:first", ROUTE, FORMAT, &raw).unwrap();
    let second = prepare(&store, "service.format:second", ROUTE, FORMAT, &raw).unwrap();
    assert!(first.can_dispatch() && second.can_dispatch());
    assert!(prepare(&store, "service.format:third", ROUTE, FORMAT, &raw)
        .unwrap_err()
        .contains("CAPACITY"));
    assert_eq!(rows(&store), 2);
    let first = mark_possible(&store, &first).unwrap();
    let recorded = record_result(&store, &first, "null").unwrap();
    assert!(
        prepare(&store, "service.format:third", ROUTE, FORMAT, &raw).is_err(),
        "a small actual result does not prematurely free its retained reservation"
    );
    acknowledge(&store, &recorded).unwrap();
    assert!(prepare(&store, "service.format:third", ROUTE, FORMAT, &raw).is_ok());
}

#[test]
fn bounded_format_admission_isolated_from_legacy_uncertainty_and_control() {
    let file = FileStore::new();
    let store = file.open();
    for index in 0..3 {
        let original = prepare(
            &store,
            &format!("legacy-format-{index}"),
            ROUTE,
            FORMAT,
            "{}",
        )
        .unwrap();
        mark_possible(&store, &original).unwrap();
    }
    assert!(prepare(&store, "legacy-fourth", ROUTE, FORMAT, "{}")
        .unwrap_err()
        .contains("CAPACITY"));
    let bounded = prepare_with_budget(
        &store,
        "bounded-format",
        ROUTE,
        FORMAT,
        "{}",
        FORMAT_RESULT_BYTES,
    )
    .unwrap();
    assert_eq!(bounded.result_budget(), 4 * 1024 * 1024);
    let bounded = mark_possible(&store, &bounded).unwrap();
    let over_limit = format!("\"{}\"", "x".repeat(FORMAT_RESULT_BYTES));
    assert!(record_result(&store, &bounded, &over_limit).is_err());
    let bounded = record_result(&store, &bounded, "null").unwrap();
    acknowledge(&store, &bounded).unwrap();
    assert!(prepared(&store, "independent-control").can_dispatch());
    drop(store);
    let reopened = file.open();
    let old = pending(&reopened, ROUTE, None, 32).unwrap().originals;
    assert_eq!(
        old.iter()
            .filter(|row| row.method() == FORMAT
                && row.phase() == Phase::Possible
                && row.result_budget() == MAX_RESULT_BYTES)
            .count(),
        3
    );
    assert!(prepare_with_budget(
        &reopened,
        "after-restart",
        ROUTE,
        FORMAT,
        "{}",
        FORMAT_RESULT_BYTES
    )
    .is_ok());
}

#[test]
fn unavailable_result_proof_releases_only_reservation_and_permanently_fences_result() {
    let file = FileStore::new();
    let store = file.open();
    let mut originals = Vec::new();
    for index in 0..3 {
        let original =
            prepare(&store, &format!("old-format-{index}"), ROUTE, FORMAT, "{}").unwrap();
        originals.push(mark_possible(&store, &original).unwrap());
    }
    assert!(prepare(&store, "no-proof", ROUTE, FORMAT, "{}").is_err());
    let rolled_back: Result<(), String> =
        authority::with_full_projection_transaction(&store, |tx| {
            release_unavailable_result_tx(tx.connection(), &originals[0])?;
            Err("rollback".into())
        });
    assert!(rolled_back.is_err());
    assert!(prepare(&store, "no-proof", ROUTE, FORMAT, "{}").is_err());
    authority::with_full_projection_transaction(&store, |tx| {
        release_unavailable_result_tx(tx.connection(), &originals[0])
    })
    .unwrap();
    assert!(prepare(&store, "after-proof", ROUTE, FORMAT, "{}").is_ok());
    assert_eq!(params_json(&store, &originals[0]).unwrap(), "{}");
    assert!(record_result(&store, &originals[0], "null")
        .unwrap_err()
        .contains("RESULT_UNAVAILABLE"));
    assert!(definitely_unsent(&store, &originals[0])
        .unwrap_err()
        .contains("RESULT_UNAVAILABLE"));
    let id = originals[0].id().to_owned();
    drop(store);
    let reopened = file.open();
    let original = pending(&reopened, ROUTE, None, 32)
        .unwrap()
        .originals
        .into_iter()
        .find(|item| item.id() == id)
        .unwrap();
    assert_eq!(original.phase(), Phase::Possible);
    assert!(!original.can_dispatch());
    assert!(record_result(&reopened, &original, "null")
        .unwrap_err()
        .contains("RESULT_UNAVAILABLE"));
    let conn = reopened.lock_conn().unwrap();
    assert!(conn
        .execute("DELETE FROM native_delivery_unavailable_results", [])
        .is_err());
    assert!(conn
        .execute(
            "UPDATE native_delivery_unavailable_results SET original_id='other'",
            []
        )
        .is_err());
}

#[test]
fn bounded_formatter_lane_stays_bounded_without_starving_control_delivery() {
    let store = SessionStore::open_in_memory().unwrap();
    for index in 0..15 {
        let original = prepare_with_budget(
            &store,
            &format!("bounded-{index}"),
            ROUTE,
            FORMAT,
            "{}",
            FORMAT_RESULT_BYTES,
        )
        .unwrap();
        mark_possible(&store, &original).unwrap();
    }
    assert!(prepare_with_budget(
        &store,
        "full-bounded",
        ROUTE,
        FORMAT,
        "{}",
        FORMAT_RESULT_BYTES
    )
    .unwrap_err()
    .contains("CAPACITY"));
    assert_eq!(rows(&store), 15);
    assert!(prepared(&store, "control-remains-available").can_dispatch());
    assert_eq!(
        pending(&store, ROUTE, None, 32)
            .unwrap()
            .originals
            .iter()
            .filter(|row| row.method() == FORMAT)
            .count(),
        15
    );
}

#[test]
fn unconfirmed_buffer_snapshots_do_not_starve_relay_finish_delivery() {
    const FINISH: &str = "native.services.conversation.desktop.finish";
    let store = SessionStore::open_in_memory().unwrap();
    for i in 0..MAX_ACTIVE_ROWS {
        mark_possible(
            &store,
            &prepared(&store, &format!("buffer:owner:{i}:nonce")),
        )
        .unwrap();
    }
    assert!(
        prepare(&store, "buffer:overflow:nonce", ROUTE, BUFFER, "{}")
            .unwrap_err()
            .contains("CAPACITY")
    );
    let finish = prepare(
        &store,
        "finish:relay-1",
        ROUTE,
        FINISH,
        r#"{"id":"relay-1"}"#,
    )
    .unwrap();
    assert!(finish.can_dispatch());
    for i in 2..=MAX_ACTIVE_ROWS {
        prepare(&store, &format!("finish:relay-{i}"), ROUTE, FINISH, "{}").unwrap();
    }
    assert!(
        prepare(&store, "finish:overflow", ROUTE, FINISH, "{}")
            .unwrap_err()
            .contains("CAPACITY"),
        "the control lane stays bounded on its own"
    );
}

#[test]
fn schema_rejects_original_identity_rewrite_and_retained_metadata_delete() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = prepared(&store, "buffer:owner:10:nonce");
    let conn = store.lock_conn().unwrap();
    assert!(conn
        .execute(
            "UPDATE native_delivery_originals SET route_fingerprint=?1 WHERE original_id=?2",
            params![OTHER_ROUTE, original.id()]
        )
        .is_err());
    assert!(conn
        .execute(
            "DELETE FROM native_delivery_originals WHERE original_id=?1",
            [original.id()]
        )
        .is_err());
    assert!(conn.execute("UPDATE native_delivery_originals SET phase='recorded',revision=revision+1 WHERE original_id=?1",[original.id()]).is_err());
}

fn locally_consumed(
    store: &SessionStore,
    key: &str,
    route: &str,
    method: &str,
    raw: &str,
    result: &str,
) -> Original {
    let original = prepare(store, key, route, method, raw).unwrap();
    let possible = mark_possible(store, &original).unwrap();
    let recorded = record_result(store, &possible, result).unwrap();
    acknowledge(store, &recorded).unwrap();
    remote_ack_candidate(store, &recorded).unwrap().unwrap()
}

fn finish_remote_ack(store: &SessionStore, original: &Original) -> Result<(), String> {
    // The real caller must admit before acquiring reply/route/SQL gates. The
    // private write wrapper exercises that same process admission + FULL lane.
    write(store, |conn| mark_remote_acked_tx(conn, original))
}

fn schema_and_changes(store: &SessionStore) -> (i64, i64) {
    let conn = store.lock_conn().unwrap();
    (
        conn.pragma_query_value(None, "schema_version", |row| row.get(0))
            .unwrap(),
        conn.query_row("SELECT total_changes()", [], |row| row.get(0))
            .unwrap(),
    )
}

#[test]
fn remote_ack_outbox_reopens_consumed_original_without_retaining_large_bodies() {
    let file = FileStore::new();
    let store = file.open();
    let raw = serde_json::to_string(&serde_json::json!({
        "content": "çalışma/文件".repeat(150_000)
    }))
    .unwrap();
    let result = serde_json::to_string(&"formatted ✓".repeat(100_000)).unwrap();
    let original = locally_consumed(
        &store,
        "service.format:remote-ack-reopen",
        ROUTE,
        FORMAT,
        &raw,
        &result,
    );
    let id = original.id().to_owned();
    let revision = original.revision;
    let result_binding = (digest(&result), result.len());
    assert_eq!(original.consumed_result().unwrap(), result_binding);
    {
        let conn = store.lock_conn().unwrap();
        let bodies: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT params_json,result_json FROM native_delivery_originals WHERE original_id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(bodies, (None, None));
        assert!(!remote_ack_table_exists(&conn).unwrap());
    }
    drop(store);

    let reopened = file.open();
    let page = pending_remote_acks(&reopened, ROUTE, None, 1).unwrap();
    assert!(page.next.is_none());
    assert_eq!(page.originals.len(), 1);
    let recovered = &page.originals[0];
    assert_eq!(recovered.id(), id);
    assert_eq!(recovered.phase(), Phase::Acknowledged);
    assert_eq!(recovered.revision, revision);
    assert_eq!(recovered.payload_sha256(), digest(&raw));
    assert_eq!(recovered.payload_bytes(), raw.len());
    assert_eq!(recovered.consumed_result().unwrap(), result_binding);
    assert!(!recovered.can_dispatch());
    assert!(params_json(&reopened, recovered).is_err());
    assert!(result_json(&reopened, recovered).unwrap().is_none());
    assert!(pending(&reopened, ROUTE, None, 1)
        .unwrap()
        .originals
        .is_empty());
    assert!(remote_ack_candidate(&reopened, &original)
        .unwrap_err()
        .contains("STALE"));
    let reused = prepare(&reopened, recovered.semantic_key(), ROUTE, FORMAT, &raw).unwrap();
    assert_eq!(reused.id(), id);
    assert_eq!(reused.phase(), Phase::Acknowledged);
    assert!(!reused.can_dispatch());
    assert_eq!(rows(&reopened), 1);
}

#[test]
fn remote_ack_metadata_reads_never_create_missing_schema_even_on_query_only_store() {
    let file = FileStore::new();
    let store = file.open();
    let original = locally_consumed(
        &store,
        "buffer:remote-ack:read-only",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    let before = schema_and_changes(&store);
    {
        let conn = store.lock_conn().unwrap();
        assert!(!remote_ack_table_exists(&conn).unwrap());
        conn.pragma_update(None, "query_only", true).unwrap();
    }
    let candidate = remote_ack_candidate(&store, &original).unwrap().unwrap();
    assert_eq!(candidate.id(), original.id());
    let page = pending_remote_acks(&store, ROUTE, None, 1).unwrap();
    assert_eq!(page.originals.len(), 1);
    assert_eq!(page.originals[0].id(), original.id());
    assert!(pending_remote_acks(&store, OTHER_ROUTE, None, 1)
        .unwrap()
        .originals
        .is_empty());
    assert_eq!(schema_and_changes(&store), before);
    {
        let conn = store.lock_conn().unwrap();
        assert!(!remote_ack_table_exists(&conn).unwrap());
        conn.pragma_update(None, "query_only", false).unwrap();
    }
}

#[test]
fn successful_remote_ack_is_full_durable_idempotent_and_keeps_original_tombstone() {
    let file = FileStore::new();
    let store = file.open();
    let original = locally_consumed(
        &store,
        "buffer:remote-ack:success",
        ROUTE,
        BUFFER,
        "{}",
        r#"{"acknowledged":true}"#,
    );
    let revision = original.revision;
    let result_binding = original.consumed_result().unwrap();
    let admission = completion_admission(&store).unwrap();
    admission
        .finish(authority::with_full_projection_transaction(&store, |tx| {
            assert!(!tx.connection().is_autocommit());
            let mode: i64 = tx
                .connection()
                .pragma_query_value(None, "synchronous", |row| row.get(0))
                .map_err(|error| error.to_string())?;
            assert_eq!(mode, 2);
            mark_remote_acked_tx(tx.connection(), &original)
        }))
        .unwrap();
    assert_eq!(synchronous(&store), 1);
    assert!(remote_ack_candidate(&store, &original).unwrap().is_none());
    assert!(pending_remote_acks(&store, ROUTE, None, 1)
        .unwrap()
        .originals
        .is_empty());
    let before = schema_and_changes(&store);
    finish_remote_ack(&store, &original).unwrap();
    assert_eq!(schema_and_changes(&store), before);
    {
        let conn = store.lock_conn().unwrap();
        let stored: (String, i64) = conn
            .query_row(
                "SELECT result_sha256,result_bytes FROM native_delivery_remote_acks WHERE original_id=?1",
                [original.id()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored, (result_binding.0.clone(), result_binding.1 as i64));
        assert!(conn
            .execute(
                "UPDATE native_delivery_remote_acks SET result_bytes=result_bytes+1 WHERE original_id=?1",
                [original.id()],
            )
            .is_err());
        assert!(conn
            .execute(
                "DELETE FROM native_delivery_remote_acks WHERE original_id=?1",
                [original.id()],
            )
            .is_err());
    }
    drop(store);

    let reopened = file.open();
    assert!(pending_remote_acks(&reopened, ROUTE, None, 1)
        .unwrap()
        .originals
        .is_empty());
    let terminal = prepare(&reopened, original.semantic_key(), ROUTE, BUFFER, "{}").unwrap();
    assert_eq!(terminal.id(), original.id());
    assert_eq!(terminal.phase(), Phase::Acknowledged);
    assert_eq!(terminal.revision, revision);
    assert_eq!(terminal.consumed_result().unwrap(), result_binding);
    assert!(!terminal.can_dispatch());
    assert!(remote_ack_candidate(&reopened, &terminal)
        .unwrap()
        .is_none());
    assert_eq!(rows(&reopened), 1);
}

#[test]
fn remote_ack_rejects_every_unconsumed_phase_and_stale_pre_ack_handle() {
    let file = FileStore::new();
    let store = file.open();
    let prepared = prepared(&store, "buffer:remote-ack:prepared");
    let possible = mark_possible(
        &store,
        &prepare(&store, "buffer:remote-ack:possible", ROUTE, BUFFER, "{}").unwrap(),
    )
    .unwrap();
    let recorded = record_result(
        &store,
        &mark_possible(
            &store,
            &prepare(&store, "buffer:remote-ack:recorded", ROUTE, BUFFER, "{}").unwrap(),
        )
        .unwrap(),
        "null",
    )
    .unwrap();
    for original in [&prepared, &possible, &recorded] {
        assert!(original
            .consumed_result()
            .unwrap_err()
            .contains("NOT_CONSUMED"));
        assert!(remote_ack_candidate(&store, original)
            .unwrap_err()
            .contains("NOT_CONSUMED"));
        assert!(finish_remote_ack(&store, original)
            .unwrap_err()
            .contains("NOT_CONSUMED"));
        assert!(params_json(&store, original).is_ok());
    }
    assert!(!remote_ack_table_exists(&store.lock_conn().unwrap()).unwrap());
    assert_eq!(pending(&store, ROUTE, None, 4).unwrap().originals.len(), 3);
    acknowledge(&store, &recorded).unwrap();
    let acknowledged = remote_ack_candidate(&store, &recorded).unwrap().unwrap();
    assert_eq!(acknowledged.phase(), Phase::Acknowledged);
    assert!(finish_remote_ack(&store, &recorded)
        .unwrap_err()
        .contains("STALE"));
    assert_eq!(
        pending_remote_acks(&store, ROUTE, None, 1)
            .unwrap()
            .originals
            .len(),
        1
    );
    finish_remote_ack(&store, &acknowledged).unwrap();
    assert!(remote_ack_candidate(&store, &acknowledged)
        .unwrap()
        .is_none());
}

#[test]
fn remote_ack_requires_actual_store_route_full_transaction_and_open_admission() {
    let file = FileStore::new();
    let other_file = FileStore::new();
    let mut store = file.open();
    let other = other_file.open();
    let original = locally_consumed(
        &store,
        "buffer:remote-ack:bound",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    assert!(remote_ack_candidate(&other, &original)
        .unwrap_err()
        .contains("STALE"));
    assert!(finish_remote_ack(&other, &original)
        .unwrap_err()
        .contains("STALE"));
    let mut changed_route = original.clone();
    changed_route.route_fingerprint = OTHER_ROUTE.to_owned();
    assert!(remote_ack_candidate(&store, &changed_route)
        .unwrap_err()
        .contains("STALE"));
    assert!(finish_remote_ack(&store, &changed_route)
        .unwrap_err()
        .contains("STALE"));
    {
        let conn = store.lock_conn().unwrap();
        assert!(mark_remote_acked_tx(&conn, &original)
            .unwrap_err()
            .contains("FULL_TRANSACTION_REQUIRED"));
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(mark_remote_acked_tx(&conn, &original)
            .unwrap_err()
            .contains("FULL_TRANSACTION_REQUIRED"));
        conn.execute_batch("ROLLBACK").unwrap();
        assert!(!remote_ack_table_exists(&conn).unwrap());
    }
    let barrier = super::super::window_barrier::WindowBarrier::new();
    let _closed = barrier.close_admission().unwrap();
    store.native_writer_barrier = Some(barrier);
    let before = schema_and_changes(&store);
    assert!(finish_remote_ack(&store, &original)
        .unwrap_err()
        .contains("AdmissionClosed"));
    assert!(completion_admission(&store).is_err());
    assert_eq!(schema_and_changes(&store), before);
    assert_eq!(
        pending_remote_acks(&store, ROUTE, None, 1)
            .unwrap()
            .originals
            .len(),
        1
    );
    assert!(!remote_ack_table_exists(&other.lock_conn().unwrap()).unwrap());
}

#[test]
fn remote_ack_rollback_and_commit_uncertainty_keep_durable_outbox_retryable() {
    let file = FileStore::new();
    let store = file.open();
    let original = locally_consumed(
        &store,
        "buffer:remote-ack:rollback",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    let admission = completion_admission(&store).unwrap();
    let rejected: Result<(), String> =
        admission.finish(authority::with_full_projection_transaction(&store, |tx| {
            mark_remote_acked_tx(tx.connection(), &original)?;
            Err("actual retained reply gate rejected completion".into())
        }));
    assert_eq!(
        rejected.unwrap_err(),
        "actual retained reply gate rejected completion"
    );
    assert_eq!(synchronous(&store), 1);
    assert!(!remote_ack_table_exists(&store.lock_conn().unwrap()).unwrap());
    assert!(remote_ack_candidate(&store, &original).unwrap().is_some());

    store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    let uncertain = finish_remote_ack(&store, &original).unwrap_err();
    store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert!(uncertain.contains("COMMIT_UNCERTAIN"), "{uncertain}");
    assert_eq!(synchronous(&store), 1);
    assert!(!remote_ack_table_exists(&store.lock_conn().unwrap()).unwrap());
    assert!(remote_ack_candidate(&store, &original).unwrap().is_some());
    drop(store);

    let reopened = file.open();
    let page = pending_remote_acks(&reopened, ROUTE, None, 1).unwrap();
    assert_eq!(page.originals.len(), 1);
    assert_eq!(page.originals[0].id(), original.id());
    finish_remote_ack(&reopened, &page.originals[0]).unwrap();
    assert!(pending_remote_acks(&reopened, ROUTE, None, 1)
        .unwrap()
        .originals
        .is_empty());
    assert_eq!(rows(&reopened), 1);
}

#[test]
fn remote_ack_outbox_pages_all_methods_without_other_routes_or_one_held_origin_starving_them() {
    let file = FileStore::new();
    let store = file.open();
    let methods = [
        BUFFER,
        "native.services.conversation.desktop.finish",
        FORMAT,
    ];
    let mut expected = HashSet::new();
    for (m, method) in methods.iter().enumerate() {
        for i in 0..3 {
            let original = locally_consumed(
                &store,
                &format!("remote-ack:paged:{m}:{i}"),
                ROUTE,
                method,
                "{}",
                "null",
            );
            expected.insert(original.id().to_owned());
        }
        locally_consumed(
            &store,
            &format!("remote-ack:other-route:{m}"),
            OTHER_ROUTE,
            method,
            "{}",
            "null",
        );
    }
    prepared(&store, "remote-ack:unconsumed:prepared");
    let possible =
        mark_possible(&store, &prepared(&store, "remote-ack:unconsumed:possible")).unwrap();
    record_result(&store, &possible, "null").unwrap();
    let held_id = pending_remote_acks(&store, ROUTE, None, 1)
        .unwrap()
        .originals[0]
        .id()
        .to_owned();
    let mut found = HashSet::new();
    let mut found_methods = HashSet::new();
    let mut cursors = HashSet::new();
    let mut after: Option<String> = None;
    loop {
        let page = pending_remote_acks(&store, ROUTE, after.as_deref(), 2).unwrap();
        assert!(!page.originals.is_empty());
        assert!(page.originals.len() <= 2);
        for original in &page.originals {
            assert_eq!(original.route_fingerprint(), ROUTE);
            assert_eq!(original.phase(), Phase::Acknowledged);
            assert!(!original.can_dispatch());
            assert!(found.insert(original.id().to_owned()));
            found_methods.insert(original.method().to_owned());
            if original.id() != held_id {
                finish_remote_ack(&store, original).unwrap();
            }
        }
        match page.next {
            None => break,
            Some(next) => {
                assert!(cursors.insert(next.clone()), "ACK cursor must advance");
                after = Some(next);
            }
        }
    }
    assert_eq!(found, expected);
    assert_eq!(
        found_methods,
        methods
            .into_iter()
            .map(str::to_owned)
            .collect::<HashSet<_>>()
    );
    let remaining = pending_remote_acks(&store, ROUTE, None, 2).unwrap();
    assert_eq!(remaining.originals.len(), 1);
    assert_eq!(remaining.originals[0].id(), held_id);
    assert_eq!(
        pending_remote_acks(&store, OTHER_ROUTE, None, 4)
            .unwrap()
            .originals
            .len(),
        3
    );
    assert_eq!(rows(&store), 14);
    assert!(pending_remote_acks(&store, ROUTE, None, 0).is_err());
    assert!(pending_remote_acks(&store, ROUTE, None, MAX_PAGE + 1).is_err());
    assert!(pending_remote_acks(&store, "not-a-route", None, 1).is_err());
    assert!(pending_remote_acks(&store, ROUTE, Some("not-an-original-id"), 1).is_err());
}

#[test]
fn corrupt_remote_ack_receipt_is_held_in_outbox_instead_of_falsely_retiring_original() {
    let file = FileStore::new();
    let store = file.open();
    let original = locally_consumed(
        &store,
        "buffer:remote-ack:corrupt-receipt",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    finish_remote_ack(&store, &original).unwrap();
    let wrong_hash = "f".repeat(64);
    {
        let conn = store.lock_conn().unwrap();
        // Deliberate isolated-file corruption, after proving ordinary updates
        // are rejected in the success case. This is never a recovery grant.
        conn.execute_batch("DROP TRIGGER native_delivery_remote_ack_immutable")
            .unwrap();
        conn.execute(
            "UPDATE native_delivery_remote_acks SET result_sha256=?1 WHERE original_id=?2",
            params![wrong_hash, original.id()],
        )
        .unwrap();
    }
    drop(store);

    let reopened = file.open();
    let page = pending_remote_acks(&reopened, ROUTE, None, 1).unwrap();
    assert_eq!(page.originals.len(), 1);
    assert_eq!(page.originals[0].id(), original.id());
    assert!(remote_ack_candidate(&reopened, &page.originals[0])
        .unwrap_err()
        .contains("INVALID"));
    assert!(finish_remote_ack(&reopened, &page.originals[0])
        .unwrap_err()
        .contains("INVALID"));
    assert_eq!(
        pending_remote_acks(&reopened, ROUTE, None, 1)
            .unwrap()
            .originals
            .len(),
        1
    );
    let actual_hash: String = reopened
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT result_sha256 FROM native_delivery_remote_acks WHERE original_id=?1",
            [original.id()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(actual_hash, wrong_hash);
    assert_eq!(rows(&reopened), 1);
}

#[test]
fn corrupt_consumed_original_metadata_cannot_create_remote_ack_receipt() {
    let file = FileStore::new();
    let store = file.open();
    let original = locally_consumed(
        &store,
        "buffer:remote-ack:corrupt-original",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    {
        let conn = store.lock_conn().unwrap();
        conn.execute_batch("DROP TRIGGER native_delivery_result_immutable")
            .unwrap();
        conn.execute(
            "UPDATE native_delivery_originals SET result_sha256='bad' WHERE original_id=?1",
            [original.id()],
        )
        .unwrap();
    }
    let held = pending_remote_acks(&store, ROUTE, None, 1).unwrap();
    assert!(held.originals.is_empty());
    assert!(held.next.is_none());
    assert!(remote_ack_candidate(&store, &original)
        .unwrap_err()
        .contains("INVALID"));
    assert!(finish_remote_ack(&store, &original)
        .unwrap_err()
        .contains("INVALID"));
    assert!(!remote_ack_table_exists(&store.lock_conn().unwrap()).unwrap());
    assert_eq!(rows(&store), 1);
}

fn drain_healthy_remote_acks(store: &SessionStore, limit: usize) -> (HashSet<String>, Vec<usize>) {
    let mut after: Option<String> = None;
    let mut cursors = HashSet::new();
    let mut acknowledged = HashSet::new();
    let mut page_sizes = Vec::new();
    loop {
        assert!(page_sizes.len() < 20, "bounded ACK scan must make progress");
        let page = pending_remote_acks(store, ROUTE, after.as_deref(), limit).unwrap();
        assert!(page.originals.len() <= limit);
        page_sizes.push(page.originals.len());
        for original in &page.originals {
            assert_eq!(original.route_fingerprint(), ROUTE);
            assert_eq!(original.phase(), Phase::Acknowledged);
            assert!(!original.can_dispatch());
            assert!(acknowledged.insert(original.id().to_owned()));
            finish_remote_ack(store, original).unwrap();
        }
        match page.next {
            None => break,
            Some(next) => {
                assert!(cursors.insert(next.clone()), "ACK cursor must advance");
                after = Some(next);
            }
        }
    }
    (acknowledged, page_sizes)
}

#[test]
fn corrupt_first_ack_metadata_does_not_starve_three_healthy_originals_after_reopen() {
    let file = FileStore::new();
    let store = file.open();
    let damaged = locally_consumed(
        &store,
        "remote-ack:corrupt-first",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    let mut healthy = HashSet::new();
    for (i, method) in [
        BUFFER,
        "native.services.conversation.desktop.finish",
        FORMAT,
    ]
    .into_iter()
    .enumerate()
    {
        healthy.insert(
            locally_consumed(
                &store,
                &format!("remote-ack:healthy-after-corruption:{i}"),
                ROUTE,
                method,
                "{}",
                "null",
            )
            .id()
            .to_owned(),
        );
    }
    {
        let conn = store.lock_conn().unwrap();
        conn.execute_batch("DROP TRIGGER native_delivery_result_immutable")
            .unwrap();
        conn.execute(
            "UPDATE native_delivery_originals SET result_sha256='bad' WHERE original_id=?1",
            [damaged.id()],
        )
        .unwrap();
    }
    drop(store);

    let reopened = file.open();
    let before = schema_and_changes(&reopened);
    let first = pending_remote_acks(&reopened, ROUTE, None, 1).unwrap();
    assert!(first.originals.is_empty());
    assert!(first.next.is_some(), "a corrupt-only page must advance");
    assert_eq!(schema_and_changes(&reopened), before);
    let (acknowledged, page_sizes) = drain_healthy_remote_acks(&reopened, 1);
    assert_eq!(acknowledged, healthy);
    assert_eq!(page_sizes, [0, 1, 1, 1]);
    let conn = reopened.lock_conn().unwrap();
    let held: (String, String, i64) = conn
        .query_row(
            "SELECT phase,result_sha256,(SELECT COUNT(*) FROM native_delivery_remote_acks a WHERE a.original_id=o.original_id) FROM native_delivery_originals o WHERE original_id=?1",
            [damaged.id()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(held, ("acknowledged".into(), "bad".into(), 0));
}

#[test]
fn invalid_and_oversized_original_ids_cannot_poison_ack_outbox_continuation() {
    for bad_id in ["not-an-original-id".into(), "x".repeat(3 * 1024 * 1024)] {
        let file = FileStore::new();
        let store = file.open();
        let damaged =
            locally_consumed(&store, "remote-ack:invalid-id", ROUTE, BUFFER, "{}", "null");
        let mut healthy = HashSet::new();
        for i in 0..3 {
            healthy.insert(
                locally_consumed(
                    &store,
                    &format!("remote-ack:after-invalid-id:{i}"),
                    ROUTE,
                    BUFFER,
                    "{}",
                    "null",
                )
                .id()
                .to_owned(),
            );
        }
        {
            let conn = store.lock_conn().unwrap();
            conn.execute_batch("DROP TRIGGER native_delivery_identity_immutable")
                .unwrap();
            conn.execute(
                "UPDATE native_delivery_originals SET original_id=?1 WHERE rowid=?2",
                params![bad_id, damaged.rowid],
            )
            .unwrap();
        }
        drop(store);

        let reopened = file.open();
        let first = pending_remote_acks(&reopened, ROUTE, None, 1).unwrap();
        assert!(first.originals.is_empty());
        let cursor = first.next.unwrap();
        assert!(
            cursor.len() < 40,
            "the corrupt id must never become a cursor"
        );
        let next = pending_remote_acks(&reopened, ROUTE, Some(&cursor), 1).unwrap();
        assert_eq!(next.originals.len(), 1);
        assert!(healthy.contains(next.originals[0].id()));
        let (acknowledged, page_sizes) = drain_healthy_remote_acks(&reopened, 1);
        assert_eq!(acknowledged, healthy);
        assert_eq!(page_sizes, [0, 1, 1, 1]);
        let conn = reopened.lock_conn().unwrap();
        let held: (i64, String, i64) = conn
            .query_row(
                "SELECT length(CAST(original_id AS BLOB)),phase,(SELECT COUNT(*) FROM native_delivery_remote_acks a WHERE a.original_id=o.original_id) FROM native_delivery_originals o WHERE rowid=?1",
                [damaged.rowid],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(held, (bad_id.len() as i64, "acknowledged".into(), 0));
        drop(conn);
        assert_eq!(rows(&reopened), 4);
    }
}

#[test]
fn corrupt_ack_lookahead_keeps_healthy_pages_usable_and_store_route_filters_intact() {
    let file = FileStore::new();
    let store = file.open();
    let mut healthy = HashSet::new();
    for i in 0..2 {
        healthy.insert(
            locally_consumed(
                &store,
                &format!("remote-ack:before-bad-lookahead:{i}"),
                ROUTE,
                BUFFER,
                "{}",
                "null",
            )
            .id()
            .to_owned(),
        );
    }
    let damaged = locally_consumed(
        &store,
        "remote-ack:bad-lookahead",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    for i in 0..2 {
        healthy.insert(
            locally_consumed(
                &store,
                &format!("remote-ack:after-bad-lookahead:{i}"),
                ROUTE,
                FORMAT,
                "{}",
                "null",
            )
            .id()
            .to_owned(),
        );
    }
    let other_route = locally_consumed(
        &store,
        "remote-ack:lookahead-other-route",
        OTHER_ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    let foreign_store = locally_consumed(
        &store,
        "remote-ack:lookahead-foreign-store",
        ROUTE,
        BUFFER,
        "{}",
        "null",
    );
    {
        let conn = store.lock_conn().unwrap();
        conn.execute_batch(
            "DROP TRIGGER native_delivery_result_immutable;
             DROP TRIGGER native_delivery_identity_immutable;",
        )
        .unwrap();
        conn.execute(
            "UPDATE native_delivery_originals SET result_bytes=65537 WHERE original_id=?1",
            [damaged.id()],
        )
        .unwrap();
        conn.execute(
            "UPDATE native_delivery_originals SET source_store_id='foreign-store' WHERE original_id=?1",
            [foreign_store.id()],
        )
        .unwrap();
    }
    let first = pending_remote_acks(&store, ROUTE, None, 2).unwrap();
    assert_eq!(first.originals.len(), 2);
    assert!(first
        .originals
        .iter()
        .all(|item| healthy.contains(item.id())));
    assert_eq!(first.next, Some(first.originals[1].ack_cursor()));
    let partial =
        pending_remote_acks(&store, ROUTE, Some(&first.originals[0].ack_cursor()), 1).unwrap();
    assert_eq!(partial.originals[0].id(), first.originals[1].id());
    let (acknowledged, page_sizes) = drain_healthy_remote_acks(&store, 2);
    assert_eq!(acknowledged, healthy);
    assert_eq!(page_sizes, [2, 1, 1]);
    let other = pending_remote_acks(&store, OTHER_ROUTE, None, 2).unwrap();
    assert_eq!(other.originals.len(), 1);
    assert_eq!(other.originals[0].id(), other_route.id());
    let conn = store.lock_conn().unwrap();
    let falsely_marked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM native_delivery_remote_acks WHERE original_id IN (?1,?2,?3)",
            params![damaged.id(), foreign_store.id(), other_route.id()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(falsely_marked, 0);
    drop(conn);
    assert_eq!(rows(&store), 7);
}

#[test]
fn proven_unavailable_results_do_not_exhaust_active_slots_but_keep_all_originals() {
    let store = SessionStore::open_in_memory().unwrap();
    for index in 0..=MAX_ACTIVE_ROWS {
        let original = prepare_with_budget(
            &store,
            &format!("failed-format-{index}"),
            ROUTE,
            FORMAT,
            "{}",
            FORMAT_RESULT_BYTES,
        )
        .unwrap();
        let original = mark_possible(&store, &original).unwrap();
        authority::with_full_projection_transaction(&store, |tx| {
            release_unavailable_result_tx(tx.connection(), &original)
        })
        .unwrap();
    }
    assert_eq!(rows(&store), (MAX_ACTIVE_ROWS + 1) as i64);
    let conn = store.lock_conn().unwrap();
    let retained: (i64,i64,i64) = conn.query_row("SELECT COUNT(*),SUM(payload_bytes),SUM(phase='possible') FROM native_delivery_originals", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(retained, (257, 514, 257));
    drop(conn);
    for index in 0..15 {
        let original = prepare_with_budget(
            &store,
            &format!("unknown-format-{index}"),
            ROUTE,
            FORMAT,
            "{}",
            FORMAT_RESULT_BYTES,
        )
        .unwrap();
        mark_possible(&store, &original).unwrap();
    }
    assert!(prepare_with_budget(
        &store,
        "unknown-still-bounded",
        ROUTE,
        FORMAT,
        "{}",
        FORMAT_RESULT_BYTES
    )
    .unwrap_err()
    .contains("CAPACITY"));
}
