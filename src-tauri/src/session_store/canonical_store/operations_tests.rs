use super::*;

fn db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE canonical_operations (scope TEXT NOT NULL, operation_id TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL, window TEXT NOT NULL, page TEXT NOT NULL, PRIMARY KEY(scope,operation_id));").unwrap();
    db
}

fn record(db: &Connection, scope: &str, id: usize) {
    db.execute(
        "INSERT INTO canonical_operations(scope,operation_id,request,result,window,page) VALUES(?1,?2,'r','{}','main','p')",
        params![scope, format!("op-{id}")],
    )
    .unwrap();
}

fn ids(db: &Connection, scope: &str) -> Vec<String> {
    let mut stmt = db
        .prepare("SELECT operation_id FROM canonical_operations WHERE scope=?1 ORDER BY rowid")
        .unwrap();
    stmt.query_map(params![scope], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn receiptless_scope_keeps_only_the_newest_rows() {
    let db = db();
    for id in 0..10 {
        record(&db, "remote-outbox.v2", id);
    }
    reclaim(&db, "remote-outbox.v2", 3).unwrap();
    assert_eq!(ids(&db, "remote-outbox.v2"), ["op-7", "op-8", "op-9"]);
    // Within the window nothing is reclaimed, so a replay still finds its row.
    reclaim(&db, "remote-outbox.v2", 3).unwrap();
    assert_eq!(ids(&db, "remote-outbox.v2").len(), 3);
}

#[test]
fn reclaim_never_touches_other_scopes() {
    let db = db();
    for id in 0..10 {
        record(&db, "remote-outbox.v2", id);
        record(&db, "assistant-thread-drafts.v2", id);
    }
    reclaim(&db, "remote-outbox.v2", 2).unwrap();
    assert_eq!(ids(&db, "remote-outbox.v2").len(), 2);
    assert_eq!(ids(&db, "assistant-thread-drafts.v2").len(), 10);
}

#[test]
fn receipt_reconciled_scopes_are_never_reclaimed() {
    let db = db();
    for scope in [
        "session-organization.v1",
        "session-pin-saga.v1",
        "assistant-thread-sends.v2",
        "host-session-bindings-migration.v1",
    ] {
        for id in 0..10 {
            record(&db, scope, id);
        }
        reclaim(&db, scope, 1).unwrap();
        assert_eq!(ids(&db, scope).len(), 10, "{scope} lost a receipt");
    }
}
