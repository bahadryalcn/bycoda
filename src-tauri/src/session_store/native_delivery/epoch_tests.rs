use super::*;
use std::path::PathBuf;

const ROUTE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const METHOD: &str = "native.buffers.update";
const RAW: &str = r#"{"owners":[],"instanceId":"exact-original"}"#;
struct FileDb {
    directory: PathBuf,
    path: PathBuf,
}
impl FileDb {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("bycoda-native-epochs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        Self {
            path: directory.join("native.sqlite"),
            directory,
        }
    }
    fn open(&self) -> SessionStore {
        SessionStore::open(self.path.clone()).unwrap()
    }
}
impl Drop for FileDb {
    fn drop(&mut self) {
        if let (Ok(root), Ok(target)) = (
            std::env::temp_dir().canonicalize(),
            self.directory.canonicalize(),
        ) {
            if target.parent() == Some(root.as_path())
                && target
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("bycoda-native-epochs-"))
            {
                let _ = std::fs::remove_dir_all(target);
            }
        }
    }
}
fn description(store: &SessionStore, route: &str) -> EpochDescription {
    EpochDescription {
        version: 2,
        open_id: open_id(store, route).unwrap(),
        owner_id: uuid::Uuid::new_v4().to_string(),
        generation: 7,
        through: 0,
        high_water: 0,
        closed: false,
    }
}
fn epoch(store: &SessionStore) -> EpochHandle {
    bind(store, ROUTE, &description(store, ROUTE)).unwrap()
}
fn original(store: &SessionStore, epoch: &EpochHandle, key: &str) -> Original {
    prepare(store, key, ROUTE, METHOD, RAW, epoch).unwrap()
}
fn consumed(store: &SessionStore, original: &Original, remote: bool) -> Original {
    let possible = mark_possible(store, original).unwrap();
    let recorded = record_result(store, &possible, r#"{"acknowledged":true}"#).unwrap();
    acknowledge(store, &recorded).unwrap();
    let acknowledged = remote_ack_candidate(store, &recorded).unwrap().unwrap();
    if remote {
        write(store, |conn| mark_remote_acked_tx(conn, &acknowledged)).unwrap();
    }
    acknowledged
}
fn floor(store: &SessionStore, epoch: &EpochHandle, through: u64) -> EpochDescription {
    let current = current(store, epoch).unwrap();
    EpochDescription {
        through,
        high_water: current.high_water(),
        ..current.description()
    }
}
fn count(store: &SessionStore, table: &str) -> i64 {
    store
        .lock_conn()
        .unwrap()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn open_intent_is_deterministic_durable_and_old_native_restore_cannot_bind_nonempty_host_stream() {
    let db = FileDb::new();
    let store = db.open();
    let ids = identity(&store.lock_conn().unwrap()).unwrap();
    // Copy a complete database, not a main file whose current state is in WAL.
    store.lock_conn().unwrap().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    drop(store);
    let backup = db.directory.join("before-epochs.sqlite");
    std::fs::copy(&db.path, &backup).unwrap();
    let store = db.open();
    let desc = description(&store, ROUTE);
    let handle = bind(&store, ROUTE, &desc).unwrap();
    assert_eq!(desc.open_id, deterministic_open_id(&ids, ROUTE));
    assert!(uuid(&desc.open_id));
    let first = original(&store, &handle, "first");
    assert_eq!(parse_id(first.id()).unwrap().sequence, 1);
    let host = EpochDescription {
        high_water: 1,
        ..desc.clone()
    };
    drop(store);
    let reopened = db.open();
    assert_eq!(open_id(&reopened, ROUTE).unwrap(), desc.open_id);
    assert_eq!(bind(&reopened, ROUTE, &host).unwrap().high_water(), 1);
    // A newer WAL must not replay over the deliberately restored old main file.
    reopened.lock_conn().unwrap().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    drop(reopened);
    std::fs::copy(&backup, &db.path).unwrap();
    let restored = db.open();
    assert_eq!(open_id(&restored, ROUTE).unwrap(), desc.open_id);
    assert!(bind(&restored, ROUTE, &host).is_err());
    assert_eq!(count(&restored, "native_delivery_epochs"), 0);
    assert_eq!(count(&restored, "native_delivery_originals"), 0);
}

#[test]
fn sequence_and_original_are_atomic_and_semantic_lookup_precedes_allocation() {
    let db = FileDb::new();
    let store = db.open();
    let legacy = super::super::prepare(&store, "legacy", ROUTE, METHOD, RAW).unwrap();
    let handle = epoch(&store);
    assert_eq!(
        prepare(&store, "legacy", ROUTE, METHOD, RAW, &handle)
            .unwrap()
            .id(),
        legacy.id()
    );
    assert_eq!(
        current(&store, &handle).unwrap().next_sequence().unwrap(),
        1
    );
    let first = original(&store, &handle, "same");
    let same = original(&store, &handle, "same");
    assert_eq!(first.id(), same.id());
    assert_eq!(parse_id(first.id()).unwrap().sequence, 1);
    assert!(prepare(
        &store,
        "same",
        ROUTE,
        METHOD,
        "{\"different\":true}",
        &handle
    )
    .unwrap_err()
    .contains("CONFLICT"));
    assert_eq!(current(&store, &handle).unwrap().high_water(), 1);
    let second = original(&store, &handle, "other");
    assert_eq!(parse_id(second.id()).unwrap().sequence, 2);
    assert!(
        super::super::prepare(&store, "old-writer-new-key", ROUTE, METHOD, RAW)
            .unwrap_err()
            .contains("V2_REQUIRED")
    );
    drop(store);
    let reopened = db.open();
    let page = pending(&reopened, ROUTE, None, 1).unwrap();
    assert_eq!(page.originals.len(), 1);
    assert!(page.next.is_some());
    let rest = pending(&reopened, ROUTE, page.next.as_deref(), 4).unwrap();
    assert_eq!(rest.originals.len(), 2);
    let rebound = bind(
        &reopened,
        ROUTE,
        &EpochDescription {
            high_water: 2,
            ..handle.description()
        },
    )
    .unwrap();
    assert_eq!(
        prepare(&reopened, "same", ROUTE, METHOD, RAW, &rebound)
            .unwrap()
            .id(),
        first.id()
    );
    assert!(!prepare(&reopened, "same", ROUTE, METHOD, RAW, &rebound)
        .unwrap()
        .can_dispatch());
}

#[test]
fn compacted_semantics_block_v1_v2_new_epoch_and_route_retarget_without_any_new_identity() {
    let db = FileDb::new();
    let store = db.open();
    let handle = epoch(&store);
    let original = consumed(&store, &original(&store, &handle, "retired-semantic"), true);
    let receipt = floor(&store, &handle, 1);
    assert_eq!(compact(&store, &handle, &receipt).unwrap(), 1);
    assert_eq!(count(&store, "native_delivery_originals"), 0);
    assert_eq!(count(&store, "native_delivery_remote_acks"), 0);
    assert_eq!(count(&store, "native_delivery_epoch_allocations"), 0);
    assert_eq!(count(&store, "native_delivery_semantic_retirements"), 1);
    assert!(params_json(&store, &original).is_err());
    assert!(for_original(&store, &original).is_err());
    assert!(
        super::super::prepare(&store, "retired-semantic", ROUTE, METHOD, RAW)
            .unwrap_err()
            .contains("RETIRED")
    );
    assert!(
        prepare(&store, "retired-semantic", ROUTE, METHOD, RAW, &handle)
            .unwrap_err()
            .contains("RETIRED")
    );
    let other = bind(&store, OTHER, &description(&store, OTHER)).unwrap();
    assert!(
        prepare(&store, "retired-semantic", OTHER, METHOD, RAW, &other)
            .unwrap_err()
            .contains("CONFLICT")
    );
    assert_eq!(current(&store, &other).unwrap().high_water(), 0);
    let ids = identity(&store.lock_conn().unwrap()).unwrap();
    let conn = store.lock_conn().unwrap();
    let bypass=conn.execute("INSERT INTO native_delivery_originals(original_id,semantic_key,route_fingerprint,method,source_store_id,source_profile_id,payload_sha256,payload_bytes,params_json,created_instance,phase,revision,result_budget,created_at) VALUES(?1,'retired-semantic',?2,?3,?4,?5,?6,?7,?8,?9,'prepared',0,65536,1)",params![uuid::Uuid::new_v4().to_string(),OTHER,METHOD,ids.0,ids.1,digest(RAW),RAW.len() as i64,RAW,store.native_instance_id().to_string()]);
    assert!(bypass.is_err());
    drop(conn);
    drop(store);
    let reopened = db.open();
    assert!(super::super::prepare(&reopened, "retired-semantic", OTHER, METHOD, RAW).is_err());
    assert_eq!(count(&reopened, "native_delivery_originals"), 0);
}

#[test]
fn original_and_marker_floor_witnesses_reject_replace_with_recursive_triggers_disabled() {
    let db = FileDb::new();
    let store = db.open();
    let handle = epoch(&store);
    let original = original(&store, &handle, "once");
    assert!(store.lock_conn().unwrap().execute_batch("INSERT OR REPLACE INTO native_delivery_originals SELECT * FROM native_delivery_originals").is_err());
    consumed(&store, &original, true);
    compact(&store, &handle, &floor(&store, &handle, 1)).unwrap();
    let conn = store.lock_conn().unwrap();
    conn.pragma_update(None, "recursive_triggers", false)
        .unwrap();
    for table in TABLES {
        if table == "native_delivery_epoch_allocations" {
            continue;
        }
        assert!(
            conn.execute_batch(&format!(
                "INSERT OR REPLACE INTO {table} SELECT * FROM {table}"
            ))
            .is_err(),
            "{table} allowed REPLACE"
        );
    }
    assert!(conn
        .execute_batch("DELETE FROM native_delivery_semantic_retirements")
        .is_err());
    assert!(conn
        .execute_batch("UPDATE native_delivery_semantic_retirements SET semantic_key='rewritten'")
        .is_err());
    drop(conn);
    assert_eq!(current(&store, &handle).unwrap().local_through(), 1);
    assert!(original_id(original.id()));
}

#[test]
fn raw_sql_cannot_assign_legacy_or_noncanonical_originals_to_an_epoch() {
    let db = FileDb::new();
    let store = db.open();
    let legacy = super::super::prepare(&store, "legacy-only", ROUTE, METHOD, RAW).unwrap();
    let legacy = consumed(&store, &legacy, true);
    let handle = epoch(&store);
    original(&store, &handle, "valid-v2");
    let rejected: Result<(), String> = write(&store, |conn| {
        let mut tip = state(conn, handle.owner_id(), handle.generation() as i64)?;
        tip.high_water += 1;
        save_state(conn, &tip, false)?;
        for id in [
            legacy.id().to_owned(),
            format!("nd2:{}:07:2", handle.owner_id()),
        ] {
            assert!(conn.execute("INSERT INTO native_delivery_epoch_allocations VALUES(?1,?2,?3,2,'legacy-only',?4,?5,?6,?7,?8,?9)",params![id,tip.owner_id,tip.generation,ROUTE,METHOD,tip.source_store_id,tip.source_profile_id,digest(RAW),RAW.len() as i64]).is_err());
        }
        Err("fixture rolls back its uncommitted tip".into())
    });
    assert!(rejected.is_err());
    assert_eq!(current(&store, &handle).unwrap().high_water(), 1);
    assert!(store
        .lock_conn()
        .unwrap()
        .execute(
            "DELETE FROM native_delivery_remote_acks WHERE original_id=?1",
            [legacy.id()]
        )
        .is_err());
    assert_eq!(count(&store, "native_delivery_epoch_allocations"), 1);
    assert_eq!(count(&store, "native_delivery_semantic_retirements"), 0);
}

#[test]
fn unknown_and_missing_remote_ack_holes_never_advance_a_floor_or_allocate_around_it() {
    for remote in [false, true] {
        let db = FileDb::new();
        let store = db.open();
        let handle = epoch(&store);
        let first = original(&store, &handle, "first");
        if remote {
            mark_possible(&store, &first).unwrap();
        } else {
            consumed(&store, &first, false);
        }
        consumed(&store, &original(&store, &handle, "second"), true);
        assert_eq!(eligible_through(&store, &handle).unwrap(), 0);
        let receipt = floor(&store, &handle, 2);
        assert!(compact(&store, &handle, &receipt).is_err());
        assert_eq!(count(&store, "native_delivery_originals"), 2);
        assert_eq!(count(&store, "native_delivery_semantic_retirements"), 0);
        let observed = bind(&store, ROUTE, &receipt).unwrap();
        assert!(prepare(&store, "new", ROUTE, METHOD, RAW, &observed).is_err());
        assert_eq!(current(&store, &handle).unwrap().high_water(), 2);
    }
}

#[test]
fn compaction_is_bounded_to_thirty_two_and_never_deletes_a_v1_tombstone() {
    let db = FileDb::new();
    let store = db.open();
    let v1 = super::super::prepare(&store, "legacy", ROUTE, METHOD, RAW).unwrap();
    let v1 = consumed(&store, &v1, true);
    let handle = epoch(&store);
    for index in 0..35 {
        consumed(
            &store,
            &original(&store, &handle, &format!("item-{index}")),
            true,
        );
    }
    let receipt = floor(&store, &handle, 35);
    assert_eq!(compact(&store, &handle, &receipt).unwrap(), 32);
    assert_eq!(current(&store, &handle).unwrap().local_through(), 32);
    assert_eq!(compact(&store, &handle, &receipt).unwrap(), 3);
    assert_eq!(count(&store, "native_delivery_originals"), 1);
    assert_eq!(count(&store, "native_delivery_semantic_retirements"), 35);
    assert!(store
        .lock_conn()
        .unwrap()
        .execute(
            "DELETE FROM native_delivery_originals WHERE original_id=?1",
            [v1.id()]
        )
        .is_err());
    assert!(store
        .lock_conn()
        .unwrap()
        .execute(
            "DELETE FROM native_delivery_remote_acks WHERE original_id=?1",
            [v1.id()]
        )
        .is_err());
}

#[test]
fn lost_active_slots_or_markers_fail_closed_including_ordinary_v1_preparation() {
    for removed_marker in [false, true] {
        let db = FileDb::new();
        let store = db.open();
        let handle = epoch(&store);
        let first = original(&store, &handle, "lost");
        if removed_marker {
            consumed(&store, &first, true);
            compact(&store, &handle, &floor(&store, &handle, 1)).unwrap();
            store.lock_conn().unwrap().execute_batch("DROP TRIGGER native_delivery_semantic_retirements_retained; DELETE FROM native_delivery_semantic_retirements;").unwrap();
        } else {
            original(&store, &handle, "still-there");
            let conn = store.lock_conn().unwrap();
            conn.execute_batch("DROP TRIGGER native_delivery_no_delete; DROP TRIGGER native_delivery_epoch_allocation_retained;").unwrap();
            conn.execute(
                "DELETE FROM native_delivery_originals WHERE original_id=?1",
                [first.id()],
            )
            .unwrap();
            conn.execute(
                "DELETE FROM native_delivery_epoch_allocations WHERE original_id=?1",
                [first.id()],
            )
            .unwrap();
        }
        assert!(current(&store, &handle).is_err());
        assert!(prepare(&store, "lost", ROUTE, METHOD, RAW, &handle).is_err());
        assert!(super::super::prepare(&store, "lost", OTHER, METHOD, RAW).is_err());
    }
}

#[test]
fn missing_initialized_witness_and_counter_regression_do_not_reinitialize_intent() {
    for corrupt_counter in [false, true] {
        let db = FileDb::new();
        let store = db.open();
        let handle = epoch(&store);
        original(&store, &handle, "one");
        if corrupt_counter {
            store
                .lock_conn()
                .unwrap()
                .execute_batch("UPDATE native_delivery_epochs SET high_water=high_water+1")
                .unwrap();
        } else {
            store.lock_conn().unwrap().execute_batch("DROP TRIGGER native_delivery_epoch_witnesses_retained; DELETE FROM native_delivery_epoch_witnesses;").unwrap();
        }
        assert!(current(&store, &handle).is_err());
        assert!(bind(&store, ROUTE, &handle.description()).is_err());
        assert!(prepare(&store, "new", ROUTE, METHOD, RAW, &handle).is_err());
        assert!(super::super::prepare(&store, "new", OTHER, METHOD, RAW).is_err());
    }
}

#[test]
fn erased_initialized_header_pairs_tables_or_budget_never_look_like_new_streams() {
    for damage in ["headers", "table", "budget"] {
        let db = FileDb::new();
        let store = db.open();
        let handle = epoch(&store);
        original(&store, &handle, "old");
        let conn = store.lock_conn().unwrap();
        match damage {
            "headers"=>conn.execute_batch("DROP TRIGGER native_delivery_epochs_retained; DROP TRIGGER native_delivery_epoch_witnesses_retained; DELETE FROM native_delivery_epochs; DELETE FROM native_delivery_epoch_witnesses;").unwrap(),
            "table"=>conn.execute_batch("DROP TABLE native_delivery_epoch_witnesses;").unwrap(),
            _=>conn.execute_batch("DROP TRIGGER native_delivery_semantic_budget_witness_retained; DELETE FROM native_delivery_semantic_budget_witness;").unwrap(),
        }
        drop(conn);
        assert!(open_id(&store, ROUTE).is_err(), "{damage}");
        assert!(
            bind(&store, ROUTE, &handle.description()).is_err(),
            "{damage}"
        );
        assert!(
            prepare(&store, "old", ROUTE, METHOD, RAW, &handle).is_err(),
            "{damage}"
        );
        assert!(
            super::super::prepare(&store, "old", OTHER, METHOD, RAW).is_err(),
            "{damage}"
        );
        assert_eq!(count(&store, "native_delivery_originals"), 1);
    }
}

#[test]
fn quota_failure_keeps_original_ack_and_floor_and_markers_use_weighted_bytes() {
    for byte_quota in [false, true] {
        let db = FileDb::new();
        let store = db.open();
        let handle = epoch(&store);
        let original = consumed(
            &store,
            &original(&store, &handle, &format!("key-{}", "ç".repeat(400))),
            true,
        );
        let receipt = floor(&store, &handle, 1);
        let weight = marker_weight(&original);
        assert!(weight > original.semantic_key().chars().count() as i64);
        let result = write(&store, |conn| {
            compact_limits(
                conn,
                &handle,
                &receipt,
                if byte_quota { MARKER_ROWS } else { 0 },
                if byte_quota { weight - 1 } else { MARKER_BYTES },
            )
        });
        assert!(result.unwrap_err().contains("CAPACITY"));
        assert_eq!(count(&store, "native_delivery_originals"), 1);
        assert_eq!(count(&store, "native_delivery_remote_acks"), 1);
        assert_eq!(read_budget(&store.lock_conn().unwrap()).unwrap(), (0, 0));
        assert_eq!(current(&store, &handle).unwrap().local_through(), 0);
        assert_eq!(compact(&store, &handle, &receipt).unwrap(), 1);
        assert_eq!(
            read_budget(&store.lock_conn().unwrap()).unwrap(),
            (1, weight)
        );
    }
}

#[test]
fn rollback_and_uncertain_commit_keep_sequence_original_and_marker_changes_atomic() {
    let db = FileDb::new();
    let store = db.open();
    let handle = epoch(&store);
    store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    assert!(prepare(&store, "uncertain", ROUTE, METHOD, RAW, &handle)
        .unwrap_err()
        .contains("COMMIT_UNCERTAIN"));
    store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(current(&store, &handle).unwrap().high_water(), 0);
    assert_eq!(count(&store, "native_delivery_epoch_allocations"), 0);
    let original = consumed(&store, &original(&store, &handle, "uncertain"), true);
    let receipt = floor(&store, &handle, 1);
    let rejected: Result<usize, String> = write(&store, |conn| {
        compact_tx(conn, &handle, &receipt)?;
        Err("actual reply guard rejected completion".into())
    });
    assert!(rejected.is_err());
    assert_eq!(current(&store, &handle).unwrap().local_through(), 0);
    store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    assert!(compact(&store, &handle, &receipt)
        .unwrap_err()
        .contains("COMMIT_UNCERTAIN"));
    store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(count(&store, "native_delivery_originals"), 1);
    assert_eq!(count(&store, "native_delivery_remote_acks"), 1);
    assert_eq!(count(&store, "native_delivery_semantic_retirements"), 0);
    drop(store);
    let reopened = db.open();
    let rebound = bind(&reopened, ROUTE, &receipt).unwrap();
    assert_eq!(compact(&reopened, &rebound, &receipt).unwrap(), 1);
    assert!(super::super::prepare(&reopened, "uncertain", OTHER, METHOD, RAW).is_err());
    assert!(for_original(&reopened, &original).is_err());
}

#[test]
fn descriptions_ids_and_closed_streams_are_strict_and_never_rotate_implicitly() {
    let db = FileDb::new();
    let store = db.open();
    let handle = epoch(&store);
    for id in [
        format!("nd2:{}:01:1", handle.owner_id()),
        format!("nd2:{}:1:0", handle.owner_id()),
        format!("nd2:{}:1:9007199254740992", handle.owner_id()),
        format!("nd2:{}:1:1:extra", handle.owner_id()),
    ] {
        assert!(parse_id(&id).is_none());
    }
    let mut wrong = handle.description();
    wrong.generation = 0;
    assert!(bind(&store, ROUTE, &wrong).is_err());
    wrong = handle.description();
    wrong.owner_id = uuid::Uuid::new_v4().to_string();
    assert!(bind(&store, ROUTE, &wrong).is_err());
    wrong = handle.description();
    wrong.generation += 1;
    assert!(bind(&store, ROUTE, &wrong).is_err());
    wrong = handle.description();
    wrong.high_water = 1;
    assert!(bind(&store, ROUTE, &wrong).is_err());
    consumed(&store, &original(&store, &handle, "done"), true);
    let receipt = floor(&store, &handle, 1);
    compact(&store, &handle, &receipt).unwrap();
    let closed = EpochDescription {
        closed: true,
        ..receipt
    };
    let bound = bind(&store, ROUTE, &closed).unwrap();
    assert_eq!(open_id(&store, ROUTE).unwrap(), bound.open_id());
    assert!(prepare(&store, "another", ROUTE, METHOD, RAW, &bound)
        .unwrap_err()
        .contains("CLOSED"));
    assert!(bind(
        &store,
        ROUTE,
        &EpochDescription {
            closed: false,
            ..closed
        }
    )
    .is_err());
}
