use super::*;
use crate::session_store::SessionStore;

const SEND_SCOPE: &str = "assistant-thread-sends.v2";

fn temp_store_path() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("bycoda-claim-orphans-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    dir.join("sessions.sqlite")
}

fn hold(store: &SessionStore, scope: &str, key: &str, phase: &str, process: Option<&str>) {
    let db = store.conn.lock().unwrap();
    db.execute("INSERT INTO canonical_claims(scope,key,operation_id,window,page) VALUES(?1,?2,'op','main','old-page')", params![scope, key]).unwrap();
    db.execute(
        "INSERT INTO canonical_claim_phases(scope,key,operation_id,phase) VALUES(?1,?2,'op',?3)",
        params![scope, key, phase],
    )
    .unwrap();
    if let Some(process) = process {
        record_process(&db, scope, key, "op", "main", "old-page", process).unwrap();
    }
}

fn release(store: &SessionStore, scope: &str, key: &str) -> bool {
    let db = store.conn.lock().unwrap();
    let own = store.native_instance_id().to_string();
    release_if_orphaned(&db, &db, &own, "new-page", scope, key).unwrap()
}

fn held(store: &SessionStore, scope: &str, key: &str) -> bool {
    let db = store.conn.lock().unwrap();
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM canonical_claims WHERE scope=?1 AND key=?2)",
        params![scope, key],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn quit_process_session_claims_release_only_after_its_lease_ends() {
    let path = temp_store_path();
    let previous = SessionStore::open(path.clone()).unwrap();
    let previous_id = previous.native_instance_id().to_string();
    hold(
        &previous,
        BINDING_SCOPE,
        "tracked",
        "submitted",
        Some(&previous_id),
    );
    hold(&previous, BINDING_SCOPE, "legacy", "submitted", None);
    hold(
        &previous,
        SEND_SCOPE,
        "send",
        "submitted",
        Some(&previous_id),
    );
    let current = SessionStore::open(path).unwrap();

    // A live issuer keeps every claim, tracked or written before tracking.
    assert!(!release(&current, BINDING_SCOPE, "tracked"));
    assert!(!release(&current, BINDING_SCOPE, "legacy"));

    drop(previous);
    assert!(release(&current, BINDING_SCOPE, "tracked"));
    assert!(release(&current, BINDING_SCOPE, "legacy"));
    assert!(!held(&current, BINDING_SCOPE, "tracked"));
    assert!(!held(&current, BINDING_SCOPE, "legacy"));
    // A submitted Host send may have been accepted; receipts reconcile it.
    assert!(!release(&current, SEND_SCOPE, "send"));
    assert!(held(&current, SEND_SCOPE, "send"));
}

#[test]
fn own_process_claims_are_never_released() {
    let store = SessionStore::open(temp_store_path()).unwrap();
    let own = store.native_instance_id().to_string();
    hold(&store, BINDING_SCOPE, "mine", "submitted", Some(&own));
    assert!(!release(&store, BINDING_SCOPE, "mine"));
    assert!(held(&store, BINDING_SCOPE, "mine"));
}
