use super::*;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    super::super::ensure_schema(&conn).unwrap();
    // Isolated catalog identity fixture only; no authority actor/proof/floor.
    conn.execute_batch("CREATE TABLE native_authority_identity(id INTEGER PRIMARY KEY,source_store_id TEXT,source_profile_id TEXT);
      INSERT INTO native_authority_identity VALUES(1,'fixture-store','fixture-profile');").unwrap();
    conn
}
fn raw(tag: &str) -> String {
    serde_json::to_string(&serde_json::json!([{"path":crate::fs::path_to_js(&std::env::temp_dir().join(tag)),"dirty":true}])).unwrap()
}
fn legacy(conn: &Connection, owner: &str, body: &str, nonce: Option<&str>) -> i64 {
    conn.execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce) VALUES(?1,?2,11,0,?3)
      ON CONFLICT(owner_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,confirmed=0,report_nonce=excluded.report_nonce",params![owner,body,nonce]).unwrap();
    current_version(conn, owner).unwrap()
}
fn stamp() -> OwnerStamp {
    let store = "11111111-1111-4111-8111-111111111111";
    let incarnation = "22222222-2222-4222-8222-222222222222";
    OwnerStamp {
        id: format!("physical:v2:{}", sha(&format!("{store}:{incarnation}"))),
        kind: "physical",
        label: "main".into(),
        store_instance: store.into(),
        incarnation: Some(incarnation.into()),
    }
}
fn source(conn: &Connection, version: i64) -> ReportSource {
    metadata(conn, &identity(conn).unwrap(), version)
        .unwrap()
        .0
        .source
        .unwrap()
}
fn holds(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id WHERE i.kind='retained' AND b.confirmed=0",[],|r|r.get(0)).unwrap()
}

#[test]
fn legacy_owner_id_rename_retains_original_guard_and_indexes_the_renamed_row() {
    let conn = setup();
    let body = raw("renamed-buffer");
    let version = legacy(&conn, "main", &body, None);
    conn.execute(
        "UPDATE native_workspace_buffers SET owner_id='renamed' WHERE owner_id='main'",
        [],
    )
    .unwrap();
    assert_eq!(holds(&conn), 1);
    let old = read(&conn, source(&conn, version)).unwrap();
    assert_eq!(old.raw_snapshot, body);
    assert!(old.record.held);
    assert!(!old.record.current);
    let new_version = current_version(&conn, "renamed").unwrap();
    assert!(new_version > version);
    let renamed = read(&conn, source(&conn, new_version)).unwrap();
    assert_eq!(renamed.record.owner_id.as_deref(), Some("renamed"));
    assert_eq!(renamed.record.kind, "legacy");
    assert!(renamed.record.current);
    assert_eq!(renamed.raw_snapshot, body);
}

#[test]
fn schema_reopen_replaces_obsolete_owned_triggers_without_losing_history() {
    let conn = setup();
    let body = raw("reopened-buffer");
    let version = legacy(&conn, "main", &body, None);
    conn.execute_batch(
        "DROP TRIGGER native_buffers_v2_before_update;
         DROP TRIGGER native_buffers_v2_after_update;
         CREATE TRIGGER native_buffers_v2_before_update BEFORE UPDATE ON native_workspace_buffers BEGIN SELECT 1; END;
         CREATE TRIGGER native_buffers_v2_after_update AFTER UPDATE ON native_workspace_buffers BEGIN SELECT 1; END;",
    )
    .unwrap();
    super::super::ensure_schema(&conn).unwrap();
    conn.execute(
        "UPDATE native_workspace_buffers SET owner_id='renamed' WHERE owner_id='main'",
        [],
    )
    .unwrap();
    assert_eq!(holds(&conn), 1);
    let old = read(&conn, source(&conn, version)).unwrap();
    assert_eq!(old.raw_snapshot, body);
    assert!(old.record.held);
    assert!(current_version(&conn, "renamed").unwrap() > version);
}

#[test]
fn legacy_update_upsert_replace_and_delete_keep_exact_old_rows_visible_to_old_guards() {
    for mutation in ["update", "upsert", "replace", "delete"] {
        let conn = setup();
        let old = raw("old-buffer");
        let changed = raw("new-buffer");
        let v = legacy(&conn, "main", &old, None);
        match mutation {
            "update" => {
                conn.execute("UPDATE native_workspace_buffers SET snapshot_json=?1,report_nonce='later' WHERE owner_id='main'",[&changed]).unwrap();
            }
            "upsert" => {
                legacy(&conn, "main", &changed, Some("later"));
            }
            "replace" => {
                conn.execute("INSERT OR REPLACE INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce) VALUES('main',?1,11,1,'later')",[&changed]).unwrap();
            }
            _ => {
                conn.execute(
                    "DELETE FROM native_workspace_buffers WHERE owner_id='main'",
                    [],
                )
                .unwrap();
            }
        }
        assert_eq!(holds(&conn), 1, "{mutation}");
        let retained = read(&conn, source(&conn, v)).unwrap();
        assert_eq!(retained.raw_snapshot, old, "{mutation}");
        assert!(retained.record.held);
        assert!(!retained.record.content_available);
        assert!(!retained.qualified);
        let guard:String=conn.query_row("SELECT b.snapshot_json FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id WHERE i.kind='retained'",[],|r|r.get(0)).unwrap();
        assert_eq!(
            guard, old,
            "legacy SELECT must see the actual retained source for {mutation}"
        );
    }
}

#[test]
fn repeated_identical_legacy_replace_has_distinct_versions_without_duplicate_raw_bodies_or_guard_projections(
) {
    let conn = setup();
    let old = raw("unchanged");
    let first = legacy(&conn, "main", &old, None);
    for _ in 0..30 {
        conn.execute("INSERT OR REPLACE INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce) VALUES('main',?1,11,0,NULL)",[&old]).unwrap();
    }
    assert!(current_version(&conn, "main").unwrap() > first);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_history",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        31
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_bodies",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(holds(&conn), 1);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_holds",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        30
    );
    assert_eq!(read(&conn, source(&conn, first)).unwrap().raw_snapshot, old);
}

#[test]
fn physical_heartbeats_preserve_every_receipt_with_one_body_and_no_new_active_legacy_fences() {
    let conn = setup();
    let owner = stamp();
    let body = raw("physical");
    let mut versions = Vec::new();
    for n in 0..40 {
        versions.push(record_owned(&conn, &owner, &body, 11 + n, &format!("nonce-{n}")).unwrap());
    }
    assert_eq!(versions.len(), 40);
    assert!(versions.windows(2).all(|v| v[0] < v[1]));
    assert_eq!(holds(&conn), 0);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_bodies",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM native_workspace_buffers", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(DISTINCT report_nonce) FROM native_workspace_buffer_history",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        40
    );
    assert_eq!(
        read(&conn, source(&conn, versions[0]))
            .unwrap()
            .raw_snapshot,
        body
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_write_permits",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn physical_prefix_never_adopts_existing_legacy_or_unattributed_identity() {
    for kind in ["legacy", "unattributed"] {
        let conn = setup();
        let owner = stamp();
        let old = raw("collision");
        legacy(&conn, &owner.id, &old, None);
        if kind == "unattributed" {
            conn.execute("UPDATE native_workspace_buffer_identity SET kind='unattributed',store_instance=?1 WHERE owner_id=?2",params![owner.store_instance,owner.id]).unwrap();
        }
        let version = current_version(&conn, &owner.id).unwrap();
        assert!(record_owned(&conn, &owner, "[]", 12, "new").is_err());
        assert_eq!(current_version(&conn, &owner.id).unwrap(), version);
        assert_eq!(
            conn.query_row(
                "SELECT snapshot_json FROM native_workspace_buffers WHERE owner_id=?1",
                [&owner.id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            old
        );
        assert_eq!(
            conn.query_row(
                "SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=?1",
                [&owner.id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            kind
        );
    }
}

#[test]
fn physical_provenance_must_match_and_legacy_writes_cannot_borrow_a_native_permit() {
    let conn = setup();
    let mut owner = stamp();
    let old = raw("original");
    record_owned(&conn, &owner, &old, 11, "native").unwrap();
    owner.store_instance = "44444444-4444-4444-8444-444444444444".into();
    assert!(record_owned(&conn, &owner, "[]", 12, "wrong-store").is_err());
    let owner = stamp();
    conn.execute("UPDATE native_workspace_buffers SET snapshot_json='[]',report_nonce='legacy' WHERE owner_id=?1",[&owner.id]).unwrap();
    assert_eq!(holds(&conn), 1);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_write_permits",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn failed_native_record_rolls_back_the_permit_identity_and_content_together() {
    let conn = setup();
    let owner = stamp();
    conn.execute_batch("CREATE TRIGGER test_reject_buffer BEFORE INSERT ON native_workspace_buffers WHEN NEW.snapshot_json='reject' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(record_owned(&conn, &owner, "reject", 11, "failed").is_err());
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_write_permits",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM native_workspace_buffer_identity WHERE owner_id=?1",
            [&owner.id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    record_owned(&conn, &owner, "[]", 12, "good").unwrap();
    assert_eq!(holds(&conn), 0);
}

#[test]
fn held_rows_and_history_cannot_be_erased_or_confirmed_by_legacy_statements() {
    let conn = setup();
    let old = raw("must-remain");
    let first = legacy(&conn, "main", &old, None);
    legacy(&conn, "main", "[]", Some("new"));
    assert!(conn
        .execute(
            "DELETE FROM native_workspace_buffers WHERE owner_id LIKE 'retained:v2:%'",
            []
        )
        .is_err());
    assert!(conn
        .execute(
            "UPDATE native_workspace_buffers SET confirmed=1 WHERE owner_id LIKE 'retained:v2:%'",
            []
        )
        .is_err());
    assert!(conn
        .execute("DELETE FROM native_workspace_buffer_history", [])
        .is_err());
    assert!(conn
        .execute(
            "UPDATE native_workspace_buffer_bodies SET snapshot_json='[]'",
            []
        )
        .is_err());
    super::super::ensure_schema(&conn).unwrap();
    assert_eq!(holds(&conn), 1);
    assert_eq!(read(&conn, source(&conn, first)).unwrap().raw_snapshot, old);
}

#[test]
fn confirmation_only_changes_never_create_new_versions_or_hide_an_existing_hold() {
    let conn = setup();
    legacy(&conn, "main", &raw("dirty"), None);
    legacy(&conn, "main", "[]", Some("next"));
    let version = current_version(&conn, "main").unwrap();
    conn.execute(
        "UPDATE native_workspace_buffers SET confirmed=1 WHERE owner_id='main'",
        [],
    )
    .unwrap();
    assert_eq!(current_version(&conn, "main").unwrap(), version);
    assert_eq!(holds(&conn), 1);
    super::super::ensure_schema(&conn).unwrap();
    assert_eq!(holds(&conn), 1);
}

#[test]
fn catalogue_and_exact_read_are_profile_bound_paginated_and_path_dirty_only() {
    let conn = setup();
    let body = raw("retained");
    let first = legacy(&conn, "main", &body, None);
    legacy(&conn, "main", "[]", Some("later"));
    let page = list(
        &conn,
        ListRequest {
            after: None,
            limit: 1,
        },
    )
    .unwrap();
    assert!(!page.qualified);
    assert_eq!(page.records.len(), 1);
    assert_eq!(page.next, Some(first as u64));
    let original = page.records[0].source.as_ref().unwrap().clone();
    let read = read(&conn, original.clone()).unwrap();
    assert_eq!(read.raw_snapshot, body);
    assert_eq!(read.buffers.len(), 1);
    assert!(!read.record.content_available);
    assert!(status(&conn, original.clone()).unwrap().record.held);
    let mut wrong = original.clone();
    wrong.source_profile_id = "another-profile".into();
    assert!(super::read(&conn, wrong).is_err());
    let mut wrong = original;
    wrong.snapshot_digest = "a".repeat(64);
    assert!(super::read(&conn, wrong).is_err());
    assert_eq!(
        list(
            &conn,
            ListRequest {
                after: page.next,
                limit: 1
            }
        )
        .unwrap()
        .records
        .len(),
        1
    );
}

#[test]
fn corrupt_or_oversized_snapshots_are_retained_without_unbounded_disclosure_or_repair() {
    for body in ["not json".into(), "x".repeat(MAX_DISCLOSURE as usize + 1)] {
        let conn = setup();
        legacy(&conn, "main", &body, None);
        let page = list(
            &conn,
            ListRequest {
                after: None,
                limit: 1,
            },
        )
        .unwrap();
        assert!(!page.records[0].inspectable);
        assert!(page.records[0].source.is_none());
        assert!(page.records[0].held);
        assert_eq!(
            conn.query_row(
                "SELECT snapshot_json FROM native_workspace_buffers WHERE owner_id='main'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            body
        );
    }
}

#[test]
fn unattributed_host_delivery_never_confirms_or_adopts_the_unknown_owner() {
    let conn = setup();
    let mut owner = stamp();
    owner.id = format!(
        "unattributed:v2:{}:{}",
        owner.store_instance,
        uuid::Uuid::new_v4()
    );
    owner.kind = "unattributed";
    owner.incarnation = None;
    let receipt =
        super::super::BufferReportReceipt::record_owned(&conn, &owner, "[]".into(), 11).unwrap();
    assert_eq!(
        super::super::report_owners(&conn, &receipt, 11).unwrap()[0]["unknown"],
        true
    );
    receipt.confirm(&conn).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT confirmed FROM native_workspace_buffers WHERE owner_id=?1",
            [owner.id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn restored_old_nonce_time_and_bytes_cannot_revive_a_superseded_receipt() {
    let conn = setup();
    let body = raw("aba-original");
    let old = super::super::BufferReportReceipt::record(&conn, "main", body.clone(), 11).unwrap();
    let nonce = old.nonce.clone();
    legacy(&conn, "main", &raw("aba-other"), Some("other"));
    conn.execute("UPDATE native_workspace_buffers SET snapshot_json=?1,updated_at=11,report_nonce=?2,confirmed=0 WHERE owner_id='main'",params![body,nonce]).unwrap();
    assert!(super::super::report_owners(&conn, &old, 11).is_err());
    assert!(old.confirm(&conn).is_err());
    assert_eq!(holds(&conn), 2);
}

#[test]
fn malformed_storage_types_and_unsafe_legacy_timestamps_are_visible_but_uninspectable() {
    let conn = setup();
    conn.execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES('blob',?1,11,0)",[vec![0xff_u8,0xfe]]).unwrap();
    conn.execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES('unsafe-time','[]',?1,0)",[i64::MAX]).unwrap();
    let page = list(
        &conn,
        ListRequest {
            after: None,
            limit: 100,
        },
    )
    .unwrap();
    assert_eq!(page.records.len(), 2);
    assert!(page
        .records
        .iter()
        .all(|r| !r.inspectable && r.source.is_none() && r.held));
    let unsafe_time = page
        .records
        .iter()
        .find(|r| r.owner_id.as_deref() == Some("unsafe-time"))
        .unwrap();
    assert!(unsafe_time.updated_at.is_none());
    assert_eq!(
        unsafe_time.legacy_timestamp.as_deref(),
        Some(i64::MAX.to_string().as_str())
    );
}
