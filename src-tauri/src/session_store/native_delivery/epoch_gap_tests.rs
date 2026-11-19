use super::*;
use std::path::PathBuf;

const ROUTE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUFFER: &str = "native.buffers.update";
const FORMAT: &str = "native.services.workspace.format";
const RAW: &str = r#"{"owners":[],"instanceId":"exact-original"}"#;

struct FileDb {
    directory: PathBuf,
    path: PathBuf,
}
impl FileDb {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("bycoda-native-gaps-{}", uuid::Uuid::new_v4()));
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
                    .is_some_and(|name| name.to_string_lossy().starts_with("bycoda-native-gaps-"))
            {
                let _ = std::fs::remove_dir_all(target);
            }
        }
    }
}

fn first_bind(store: &SessionStore) -> (EpochDescription, EpochHandle) {
    let description = EpochDescription {
        version: 2,
        open_id: open_id(store, ROUTE).unwrap(),
        owner_id: uuid::Uuid::new_v4().to_string(),
        generation: 3,
        through: 0,
        high_water: 0,
        closed: false,
    };
    let handle = bind(store, ROUTE, &description).unwrap();
    (description, handle)
}
/// What a reconnecting runtime learns from the Host after a restart.
fn rebind(
    store: &SessionStore,
    description: &EpochDescription,
    through: u64,
    high_water: u64,
) -> EpochHandle {
    bind(
        store,
        ROUTE,
        &EpochDescription {
            through,
            high_water,
            ..description.clone()
        },
    )
    .unwrap()
}
fn consumed(store: &SessionStore, original: &Original) {
    let possible = mark_possible(store, original).unwrap();
    let recorded = record_result(store, &possible, r#"{"acknowledged":true}"#).unwrap();
    acknowledge(store, &recorded).unwrap();
    let acknowledged = remote_ack_candidate(store, &recorded).unwrap().unwrap();
    write(store, |conn| mark_remote_acked_tx(conn, &acknowledged)).unwrap();
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
fn record(store: &SessionStore, original: &Original) -> Result<(), String> {
    write(store, |conn| record_gap_tx(conn, original))
}

#[test]
fn older_runtime_unadmitted_original_is_proven_compacted_and_fenced_permanently() {
    for (method, possible) in [(BUFFER, false), (BUFFER, true), (FORMAT, true)] {
        let db = FileDb::new();
        let old = db.open();
        let (description, handle) = first_bind(&old);
        let lost = prepare(&old, "lost", ROUTE, method, RAW, &handle).unwrap();
        if possible {
            let lost = mark_possible(&old, &lost).unwrap();
            if method == FORMAT {
                write(&old, |conn| release_unavailable_result_tx(conn, &lost)).unwrap();
            }
        }
        drop(old);

        let store = db.open();
        let epoch = rebind(&store, &description, 0, 1);
        assert_eq!(eligible_through(&store, &epoch).unwrap(), 0);
        let later = prepare(&store, "later", ROUTE, BUFFER, RAW, &epoch).unwrap();
        assert_eq!(parse_id(later.id()).unwrap().sequence, 2);
        consumed(&store, &later);
        // A later retired entry never moves the prefix past the unresolved slot.
        assert_eq!(eligible_through(&store, &epoch).unwrap(), 0);
        let candidate = gap_candidate(&store, &epoch).unwrap().unwrap();
        assert_eq!(parse_id(candidate.id()).unwrap().sequence, 1);
        assert!(compact(&store, &epoch, &floor(&store, &epoch, 2)).is_err());

        record(&store, &candidate).unwrap();
        record(&store, &candidate).unwrap();
        assert_eq!(count(&store, TABLE), 1);
        assert_eq!(count(&store, "native_delivery_remote_acks"), 1);
        assert_eq!(eligible_through(&store, &epoch).unwrap(), 2);
        assert!(gap_candidate(&store, &epoch).unwrap().is_none());
        // The proof is not success and the original keeps its exact retained bytes.
        assert_eq!(params_json(&store, &candidate).unwrap(), RAW);
        if possible && method == BUFFER {
            assert!(
                write(&store, |conn| record_result_tx(conn, &candidate, "{}"))
                    .unwrap_err()
                    .contains("GAP_FENCED")
            );
        }
        assert!(prepare(&store, "lost", ROUTE, method, RAW, &epoch)
            .unwrap_err()
            .contains("GAP_FENCED"));
        drop(store);

        let reopened = db.open();
        let epoch = rebind(&reopened, &description, 0, 2);
        assert_eq!(eligible_through(&reopened, &epoch).unwrap(), 2);
        assert_eq!(
            compact(&reopened, &epoch, &floor(&reopened, &epoch, 2)).unwrap(),
            2
        );
        assert_eq!(current(&reopened, &epoch).unwrap().local_through(), 2);
        assert_eq!(count(&reopened, "native_delivery_originals"), 0);
        assert_eq!(count(&reopened, "native_delivery_epoch_allocations"), 0);
        assert_eq!(count(&reopened, "native_delivery_unavailable_results"), 0);
        assert_eq!(count(&reopened, "native_delivery_semantic_retirements"), 1);
        assert_eq!(count(&reopened, TABLE), 1);
        assert!(for_original(&reopened, &candidate).is_err());
        drop(reopened);

        let last = db.open();
        let epoch = rebind(&last, &description, 2, 2);
        assert_eq!(current(&last, &epoch).unwrap().local_through(), 2);
        assert!(prepare(&last, "lost", ROUTE, method, RAW, &epoch)
            .unwrap_err()
            .contains("GAP_FENCED"));
        assert!(
            prepare(&last, "lost", ROUTE, method, "{\"other\":1}", &epoch)
                .unwrap_err()
                .contains("CONFLICT")
        );
        assert!(super::super::super::prepare(&last, "lost", OTHER, method, RAW).is_err());
        let next = prepare(&last, "next", ROUTE, BUFFER, RAW, &epoch).unwrap();
        assert_eq!(parse_id(next.id()).unwrap().sequence, 3);
        // Erasing the permanent proof makes the covered prefix incomplete.
        last.lock_conn()
            .unwrap()
            .execute_batch(&format!(
                "DROP TRIGGER {TABLE}_retained; DELETE FROM {TABLE};"
            ))
            .unwrap();
        assert!(current(&last, &epoch).is_err());
    }
}

#[test]
fn current_runtime_and_already_admitted_originals_are_never_gap_eligible() {
    let db = FileDb::new();
    let store = db.open();
    let (description, epoch) = first_bind(&store);
    let mine = prepare(&store, "mine", ROUTE, BUFFER, RAW, &epoch).unwrap();
    assert!(gap_candidate(&store, &epoch).unwrap().is_none());
    assert!(record(&store, &mine).unwrap_err().contains("GAP_INVALID"));
    let mine = mark_possible(&store, &mine).unwrap();
    assert!(gap_candidate(&store, &epoch).unwrap().is_none());
    assert!(record(&store, &mine).unwrap_err().contains("GAP_INVALID"));
    // Local evidence that the effect happened (recorded, then locally ACKed).
    let recorded = record_result(&store, &mine, r#"{"acknowledged":true}"#).unwrap();
    acknowledge(&store, &recorded).unwrap();
    drop(store);

    let reopened = db.open();
    let epoch = rebind(&reopened, &description, 0, 1);
    assert!(gap_candidate(&reopened, &epoch).unwrap().is_none());
    let page = pending_remote_acks(&reopened, ROUTE, None, 4).unwrap();
    let admitted = page.originals.into_iter().next().unwrap();
    assert!(record(&reopened, &admitted)
        .unwrap_err()
        .contains("GAP_INVALID"));
    // Raw SQL cannot forge a proof for it either.
    let conn = reopened.lock_conn().unwrap();
    let forged = conn.execute(
        &format!("INSERT INTO {TABLE}({COLUMNS}) SELECT original_id,?1,3,1,source_store_id,source_profile_id,semantic_key,route_fingerprint,method,payload_sha256,payload_bytes,created_instance,?2 FROM native_delivery_originals"),
        params![epoch.owner_id(), uuid::Uuid::new_v4().to_string()],
    );
    assert!(forged.is_err());
    drop(conn);
    assert_eq!(count(&reopened, TABLE), 0);
}

#[test]
fn pre_upgrade_epoch_store_migrates_on_first_full_write_and_partial_install_fails_closed() {
    let db = FileDb::new();
    let old = db.open();
    let (description, handle) = first_bind(&old);
    prepare(&old, "lost", ROUTE, BUFFER, RAW, &handle).unwrap();
    // Shape of an epoch Store written before gap proofs existed.
    old.lock_conn()
        .unwrap()
        .execute_batch(&format!(
            "DROP TRIGGER native_delivery_epoch_gap_valid; DROP TRIGGER native_delivery_epoch_gap_phase_fence; DROP TABLE {TABLE};"
        ))
        .unwrap();
    // Reads accept the pre-upgrade shape without migrating it.
    assert_eq!(current(&old, &handle).unwrap().high_water(), 1);
    assert!(gap_candidate(&old, &handle).unwrap().is_none());
    drop(old);

    let store = db.open();
    let epoch = rebind(&store, &description, 0, 1);
    assert_eq!(count(&store, TABLE), 0);
    let candidate = gap_candidate(&store, &epoch).unwrap().unwrap();
    record(&store, &candidate).unwrap();
    assert_eq!(count(&store, TABLE), 1);
    assert_eq!(eligible_through(&store, &epoch).unwrap(), 1);
    store
        .lock_conn()
        .unwrap()
        .execute_batch("DROP TRIGGER native_delivery_epoch_gap_phase_fence")
        .unwrap();
    assert!(current(&store, &epoch).is_err());
    assert!(super::super::super::prepare(&store, "new", OTHER, BUFFER, RAW).is_err());
}
