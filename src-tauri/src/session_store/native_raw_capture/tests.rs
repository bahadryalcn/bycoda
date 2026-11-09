use super::*;
use crate::native_authority_checkpoint::{NativeCheckpointCommit, NativeCheckpointScope};
use crate::session_store::authority;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use serde_json::{json, Value};
use std::path::PathBuf;

#[path = "tests_v3.rs"]
mod v3;

struct FileDb {
    root: PathBuf,
    base: PathBuf,
}
impl FileDb {
    fn new() -> Self {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-29-raw-composer-native/fixtures");
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(format!("raw-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self { root, base }
    }
    fn path(&self) -> PathBuf {
        self.root.join("sessions.db")
    }
    fn open(&self) -> SessionStore {
        SessionStore::open(self.path()).unwrap()
    }
}
impl Drop for FileDb {
    fn drop(&mut self) {
        let target = self.root.canonicalize().unwrap();
        assert_eq!(target.parent(), Some(self.base.as_path()));
        assert!(target
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("raw-"));
        std::fs::remove_dir_all(target).unwrap();
    }
}
fn capture() -> Value {
    json!({"version":1,"kind":"mounted-composer-raw-capture","qualified":false,"sessionId":"A",
        "snapshots":[{"id":1,"revision":0,"sessionId":"A","snapshot":{"text":"  \n\tç 😀  ",
            "attachments":[{"id":"file","name":"file","custom":{"opaque":[true,null,3.5]}}],
            "mcpTags":[{"id":"server","opaque":{"kept":""}}],"mode":"save"}},
            {"id":2,"revision":1,"snapshot":{"text":"","attachments":[],"mcpTags":[]}}]})
}
fn artifact() -> RawCaptureArtifact {
    RawCaptureArtifact::parse(serde_json::to_string(&capture()).unwrap(), "A").unwrap()
}
fn producer_capture() -> Value {
    let mut value = capture();
    value["version"] = json!(2);
    value["kind"] = json!("mounted-native-input-capture");
    value["producerCoverage"] = json!("unknown");
    value["producerEpochs"] = json!({"parent":18,"editor":7});
    value["producers"] = json!([
        {"id":2,"revision":1,"kind":"question-draft","sessionId":"A","snapshot":{"question":"  \n","answer":{"choices":[1,2],"text":""}}},
        {"id":4,"revision":0,"kind":"session-parent","sessionId":"A","snapshot":{"plan":{"status":"editing"},"error":null}},
        {"id":6,"revision":9,"kind":"composer-parent","sessionId":"A","snapshot":{"prompt":"","attachments":[],"provider":{"id":"actual-provider"}}},
        {"id":8,"revision":4,"kind":"queue-edit","sessionId":"A","snapshot":{"items":[{"id":"queued","input":{"text":" kept ","childSessionId":"child-original"}}]},"undefinedPaths":[["items",0,"input","mode"]]},
        {"id":10,"revision":2,"kind":"btw-parent","sessionId":"A","snapshot":{"target":{"parentSessionId":"A","childSessionId":"B","providerSessionId":"original-provider"}}},
        {"id":1,"revision":3,"kind":"file-editor","snapshot":{"documentId":"document","path":"G:/fixture/source.rs","text":"unsaved\n","diskBaseline":"on disk\r\n","eol":"crlf","acknowledgment":{},"undefinedPaths":"ordinary user data"},"undefinedPaths":[["acknowledgment","receipt"],["pendingSave"]]}
    ]);
    value
}
fn seed(store: &SessionStore) {
    store.lock_conn().unwrap().execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES('A','.','codex','fixture','approve','raw fixture',1,1,'[]')",[]).unwrap();
}
fn parent(
    checked: &CheckedStoreTransaction<'_>,
    store: &SessionStore,
    raw: Option<RawCaptureDescriptor>,
) -> Result<NativeSqlCheckpointReceipt, String> {
    let conn = checked.connection();
    let row = store
        .capture_session_row_identity_at(conn, "A")?
        .ok_or("fixture row missing")?;
    let expected = NativeCheckpointExpectation {
        revision: 0,
        updated_at: 1,
        transcript_sha256: digest(b"[]"),
        draft: ExpectedSqlBlob::Absent,
        queue: ExpectedSqlBlob::Absent,
    };
    let nonce = uuid::Uuid::new_v4().to_string();
    let service = uuid::Uuid::new_v4().to_string();
    let round = uuid::Uuid::new_v4().to_string();
    let window = uuid::Uuid::new_v4().to_string();
    let scope = NativeCheckpointScope::new("environment", "A", "migration", 0)?;
    store.renderer_checkpoint_commit_at_with_raw(
        checked,
        NativeCheckpointCommit {
            nonce: &nonce,
            service_epoch: &service,
            round_id: &round,
            window_epoch: &window,
            scope: &scope,
            row_identity: &row,
            expected: &expected,
            fingerprint: &expected.fingerprint()?,
        },
        raw,
    )
}
fn commit(
    store: &SessionStore,
    artifact: &RawCaptureArtifact,
) -> Result<RawCaptureReceipt, String> {
    authority::with_full_projection_transaction(store, |checked| {
        let sql = parent(
            &checked,
            store,
            Some(artifact.descriptor(&digest(b"actual comparison bytes"))?),
        )?;
        retain_at(&checked, store, &sql, artifact)
    })
}
fn count(store: &SessionStore, table: &str) -> i64 {
    assert!(["native_raw_captures", "native_renderer_checkpoint_receipts"].contains(&table));
    store
        .lock_conn()
        .unwrap()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn exact_blank_and_empty_text_opaque_arrays_and_undefined_paths_remain_raw_data() {
    let mut value = capture();
    value["snapshots"][0]["undefinedPaths"] =
        json!([["attachments", 0, "missing"], ["mcpTags", 0, "notAssigned"]]);
    value["snapshots"][1]["undefinedPaths"] = json!([["mode"]]);
    let raw = format!(" \n{}\n", serde_json::to_string(&value).unwrap());
    let original = RawCaptureArtifact::parse(raw.clone(), "A").unwrap();
    assert_eq!(original.raw(), raw);
    assert_eq!(original.sha256(), digest(raw.as_bytes()));
    assert_eq!(original.session_id(), "A");
    let descriptor = original.descriptor(&digest(b"comparison")).unwrap();
    assert_eq!(descriptor.byte_length, raw.len() as u64);
    assert_eq!(descriptor.snapshot_count, 2);
    assert_eq!(descriptor.comparison_sha256, digest(b"comparison"));
    assert!(original.descriptor("not a comparison hash").is_err());
    let mut changed = value;
    changed["snapshots"][0]["snapshot"]["text"] = json!("");
    assert_ne!(
        RawCaptureArtifact::parse(changed.to_string(), "A")
            .unwrap()
            .sha256(),
        original.sha256()
    );
}

#[test]
fn v2_retains_all_six_families_independent_epochs_and_original_child_identities_as_unknown_data() {
    let value = producer_capture();
    let raw = format!(" \n{}\n", value);
    let artifact = RawCaptureArtifact::parse(raw.clone(), "A").unwrap();
    assert_eq!(artifact.raw(), raw);
    assert_eq!(artifact.sha256(), digest(raw.as_bytes()));
    assert_eq!(
        artifact
            .descriptor(&digest(b"comparison"))
            .unwrap()
            .snapshot_count,
        8
    );
    let parsed: Value = serde_json::from_str(artifact.raw()).unwrap();
    assert_eq!(parsed["producerCoverage"], "unknown");
    assert_eq!(parsed["producerEpochs"], json!({"parent":18,"editor":7}));
    assert_eq!(
        parsed["producers"][4]["snapshot"]["target"]["childSessionId"],
        "B"
    );
    assert!(parsed["producers"][5].get("sessionId").is_none());
    assert_eq!(
        parsed["producers"][5]["snapshot"]["undefinedPaths"],
        "ordinary user data"
    );
    // IDs in the legacy Composer mount namespace do not alias producer IDs.
    assert_eq!(parsed["snapshots"][0]["id"], parsed["producers"][5]["id"]);
}

#[test]
fn v2_producer_epochs_fields_coverage_families_and_assigned_scope_are_closed() {
    let mut invalid = Vec::new();
    let mut value = producer_capture();
    value["registryEpoch"] = json!(18);
    invalid.push(value);
    let mut value = producer_capture();
    value["producerEpochs"] = json!({"parent":1});
    invalid.push(value);
    let mut value = producer_capture();
    value["producerEpochs"] = json!({"editor":1});
    invalid.push(value);
    let mut value = producer_capture();
    value["producerEpochs"]["other"] = json!(0);
    invalid.push(value);
    for bad in [
        json!(-1),
        json!(MAX_SAFE + 1),
        json!(0.5),
        Value::Null,
        json!("1"),
    ] {
        for field in ["parent", "editor"] {
            let mut value = producer_capture();
            value["producerEpochs"][field] = bad.clone();
            invalid.push(value);
        }
    }
    for bad in [json!("complete"), json!(true), Value::Null] {
        let mut value = producer_capture();
        value["producerCoverage"] = bad;
        invalid.push(value);
    }
    let mut value = producer_capture();
    value["qualified"] = json!(true);
    invalid.push(value);
    let mut value = producer_capture();
    value["sessionId"] = json!("B");
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["sessionId"] = json!("B");
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["sessionId"] = Value::Null;
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["kind"] = json!("terminal");
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["complete"] = json!(true);
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["revision"] = json!(-1);
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["id"] = json!(0);
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["id"] = json!(MAX_SAFE + 1);
    invalid.push(value);
    let mut value = producer_capture();
    value["producers"][0]["revision"] = json!(MAX_SAFE + 1);
    invalid.push(value);
    // Reusing an ID across two different families is still a duplicate.
    let mut value = producer_capture();
    value["producers"][1]["id"] = value["producers"][0]["id"].clone();
    invalid.push(value);
    for bad in [json!([]), json!("opaque string"), json!(1), Value::Null] {
        let mut value = producer_capture();
        value["producers"][0]["snapshot"] = bad;
        invalid.push(value);
    }
    for value in invalid {
        assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    }
}

#[test]
fn v2_opaque_object_undefined_paths_are_unrestricted_but_legacy_composer_paths_stay_restricted() {
    let mut value = producer_capture();
    value["producers"][0]["snapshot"] = json!({"custom":{"items":[{}]},"__proto__":{"kept":true}});
    value["producers"][0]["undefinedPaths"] = json!([
        ["arbitrary"],
        ["text"],
        ["custom", "items", 0, "notSet"],
        ["__proto__", "notSet"]
    ]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_ok());
    for paths in [
        json!([["custom", "items", 1, "notSet"]]),
        json!([["custom", "items", 0]]),
        json!([["custom", "items", "0", "notSet"]]),
        json!([["__proto__", "kept"]]),
        json!([["arbitrary"], ["arbitrary"]]),
        json!([["arbitrary"], ["arbitrary", "child"]]),
        json!([["custom", "items", MAX_SAFE + 1, "notSet"]]),
        json!([[]]),
        Value::Null,
    ] {
        let mut changed = value.clone();
        changed["producers"][0]["undefinedPaths"] = paths;
        assert!(RawCaptureArtifact::parse(changed.to_string(), "A").is_err());
    }
    value["snapshots"][0]["undefinedPaths"] = json!([["arbitrary"]]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
}

#[test]
fn v2_combined_mount_producer_budget_and_streaming_depth_nodes_unicode_are_enforced() {
    let mut value = producer_capture();
    let template = value["producers"][0].clone();
    value["snapshots"] = json!([]);
    value["producers"] = json!((1..=MAX_SNAPSHOTS)
        .map(|id| {
            let mut v = template.clone();
            v["id"] = json!(id);
            v
        })
        .collect::<Vec<_>>());
    assert_eq!(
        RawCaptureArtifact::parse(value.to_string(), "A")
            .unwrap()
            .descriptor(&digest(b"c"))
            .unwrap()
            .snapshot_count,
        MAX_SNAPSHOTS as u64
    );
    value["snapshots"] = json!([capture()["snapshots"][0].clone()]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut value = producer_capture();
    let mut nested = Value::Null;
    for _ in 0..MAX_DEPTH {
        nested = json!({"nested":nested});
    }
    value["producers"][0]["snapshot"] = nested;
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut value = producer_capture();
    value["producers"][0]["snapshot"] = json!({"values":vec![false;MAX_NODES]});
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let raw = producer_capture().to_string().replacen(
        "\"question\":\"  \\n\"",
        "\"question\":\"\\ud800\"",
        1,
    );
    assert!(raw.contains("\\ud800"));
    assert!(RawCaptureArtifact::parse(raw, "A").is_err());
    let raw =
        producer_capture()
            .to_string()
            .replacen("\"parent\":18", "\"parent\":18,\"parent\":18", 1);
    assert!(RawCaptureArtifact::parse(raw, "A").is_err());
}

#[test]
fn v1_and_v2_raw_bodies_share_the_same_actual_full_store_and_reopen_as_original_data() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let legacy = artifact();
    let producer = RawCaptureArtifact::parse(producer_capture().to_string(), "A").unwrap();
    let first = commit(&store, &legacy).unwrap();
    let second = commit(&store, &producer).unwrap();
    assert_ne!(first.sql.nonce, second.sql.nonce);
    assert_ne!(first.sql.window_epoch, second.sql.window_epoch);
    assert_eq!(first.sql.raw_capture.as_ref().unwrap().snapshot_count, 2);
    assert_eq!(second.sql.raw_capture.as_ref().unwrap().snapshot_count, 8);
    assert_eq!(count(&store, "native_raw_captures"), 2);
    for expected in [&first, &second] {
        assert_eq!(
            &read_at(&store.lock_conn().unwrap(), &store, expected).unwrap(),
            expected
        );
    }
    drop(store);
    let reopened = db.open();
    let conn = reopened.lock_conn().unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT raw_capture_version FROM native_authority_identity WHERE id=1",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    for (expected, exact) in [(&first, legacy.raw()), (&second, producer.raw())] {
        assert!(read_at(&conn, &reopened, expected).is_err());
        assert_eq!(
            &read_retained_at(&conn, &reopened, expected).unwrap(),
            expected
        );
        let raw: String = conn
            .query_row(
                "SELECT raw_json FROM native_raw_captures WHERE nonce=?1",
                [&expected.sql.nonce],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw, exact);
    }
}

#[test]
fn closed_shapes_sessions_mount_ids_modes_and_ambiguous_json_are_rejected() {
    let mut invalid = Vec::new();
    for path in [
        vec!["extra"],
        vec!["snapshots", "0", "extra"],
        vec!["snapshots", "0", "snapshot", "extra"],
    ] {
        let mut value = capture();
        match path.len() {
            1 => value["extra"] = json!(true),
            3 => value["snapshots"][0]["extra"] = json!(true),
            _ => value["snapshots"][0]["snapshot"]["extra"] = json!(true),
        }
        invalid.push(value);
    }
    for id in [0, MAX_SAFE + 1] {
        let mut v = capture();
        v["snapshots"][0]["id"] = json!(id);
        invalid.push(v);
    }
    let mut v = capture();
    v["snapshots"][1]["id"] = json!(1);
    invalid.push(v);
    let mut v = capture();
    v["snapshots"][0]["revision"] = json!(MAX_SAFE + 1);
    invalid.push(v);
    let mut v = capture();
    v["snapshots"][0]["revision"] = json!(-1);
    invalid.push(v);
    let mut v = capture();
    v["sessionId"] = json!("B");
    invalid.push(v);
    let mut v = capture();
    v["snapshots"][0]["sessionId"] = json!("B");
    invalid.push(v);
    let mut v = capture();
    v["snapshots"][0]["sessionId"] = Value::Null;
    invalid.push(v);
    for mode in [Value::Null, json!("plan"), json!("")] {
        let mut v = capture();
        v["snapshots"][0]["snapshot"]["mode"] = mode;
        invalid.push(v);
    }
    let mut v = capture();
    v["snapshots"][0]["snapshot"]["attachments"] = json!({});
    invalid.push(v);
    let mut v = capture();
    v["qualified"] = json!(true);
    invalid.push(v);
    for value in invalid {
        assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    }
    let duplicate =
        capture()
            .to_string()
            .replacen("\"version\":1", "\"version\":1,\"version\":1", 1);
    assert!(RawCaptureArtifact::parse(duplicate, "A").is_err());
    let duplicate_nested = capture().to_string().replacen(
        "\"name\":\"file\"",
        "\"name\":\"file\",\"name\":\"file\"",
        1,
    );
    assert!(RawCaptureArtifact::parse(duplicate_nested, "A").is_err());
    assert!(RawCaptureArtifact::parse(capture().to_string() + " null", "A").is_err());
}

#[test]
fn undefined_paths_only_describe_absent_object_members_without_prefix_or_array_aliases() {
    for paths in [
        json!([["text"]]),
        json!([["mode"]]),
        json!([["attachments"]]),
        json!([["attachments", 0, "name"]]),
        json!([["attachments", 0]]),
        json!([["attachments", 99, "missing"]]),
        json!([["attachments", "0", "missing"]]),
        json!([["attachments", 0, "missing"], ["attachments", 0, "missing"]]),
        json!([
            ["attachments", 0, "missing"],
            ["attachments", 0, "missing", "child"]
        ]),
        json!([["attachments", MAX_SAFE + 1, "missing"]]),
        json!([["mcpTags", 0, "id", "missing"]]),
        json!([[]]),
        json!([["unknown"]]),
        Value::Null,
    ] {
        let mut value = capture();
        value["snapshots"][0]["undefinedPaths"] = paths;
        assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    }
    let mut value = capture();
    value["snapshots"][0]["undefinedPaths"] = json!([["attachments", 0, "custom", "new"]]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_ok());
}

#[test]
fn depth_node_mount_and_byte_limits_reject_before_unbounded_tree_construction() {
    let mut value = capture();
    let mut nested = json!(null);
    for _ in 0..MAX_DEPTH + 1 {
        nested = json!([nested]);
    }
    value["snapshots"][0]["snapshot"]["attachments"] = nested;
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut value = capture();
    value["snapshots"][0]["snapshot"]["mcpTags"] = json!(vec![0; MAX_NODES]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut value = capture();
    let template = value["snapshots"][0].clone();
    value["snapshots"] = json!((1..=MAX_SNAPSHOTS + 1)
        .map(|id| {
            let mut x = template.clone();
            x["id"] = json!(id);
            x
        })
        .collect::<Vec<_>>());
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    assert!(RawCaptureArtifact::parse(" ".repeat(MAX_BYTES + 1), "A").is_err());
    let mut value = capture();
    value["sessionId"] = json!("s".repeat(512));
    value["snapshots"][0]["sessionId"] = json!("s".repeat(512));
    assert!(RawCaptureArtifact::parse(value.to_string(), &"s".repeat(512)).is_ok());
    assert!(RawCaptureArtifact::parse(value.to_string(), &"s".repeat(513)).is_err());
}

#[test]
fn clones_share_one_retained_memory_charge_until_the_final_owner_drops() {
    let raw = capture().to_string();
    let budget = Arc::new(MemoryBudget {
        used: AtomicUsize::new(0),
        limit: raw.len() * 2,
    });
    let first = RawCaptureArtifact::parse_with_budget(raw.clone(), "A", budget.clone()).unwrap();
    let clone = first.clone();
    assert!(Arc::ptr_eq(&first.0, &clone.0));
    let second = RawCaptureArtifact::parse_with_budget(raw.clone(), "A", budget.clone()).unwrap();
    assert!(RawCaptureArtifact::parse_with_budget(raw.clone(), "A", budget.clone()).is_err());
    drop(first);
    assert!(RawCaptureArtifact::parse_with_budget(raw.clone(), "A", budget.clone()).is_err());
    drop(clone);
    let third = RawCaptureArtifact::parse_with_budget(raw.clone(), "A", budget.clone()).unwrap();
    drop((second, third));
    assert_eq!(budget.used.load(Ordering::Acquire), 0);
    assert!(
        RawCaptureArtifact::parse_with_budget("invalid JSON".into(), "A", budget.clone()).is_err()
    );
    assert_eq!(budget.used.load(Ordering::Acquire), 0);
}

#[test]
fn raw_bytes_and_actual_parent_commit_full_together_and_read_on_a_query_only_connection() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let raw = artifact();
    let receipt = commit(&store, &raw).unwrap();
    assert_eq!(
        receipt.sql.raw_capture.as_ref().unwrap().sha256,
        raw.sha256()
    );
    assert_eq!(count(&store, "native_raw_captures"), 1);
    assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 1);
    let conn =
        Connection::open_with_flags(db.path(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    conn.execute_batch("PRAGMA query_only=ON").unwrap();
    assert_eq!(read_at(&conn, &store, &receipt).unwrap(), receipt);
    let exact: String = conn
        .query_row(
            "SELECT raw_json FROM native_raw_captures WHERE nonce=?1",
            [&receipt.sql.nonce],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exact, raw.raw());
    assert_eq!(
        serde_json::to_value(&receipt).unwrap()["sql"]["qualified"],
        false
    );
}

#[test]
fn in_memory_store_empty_filename_keeps_its_actual_read_binding_and_rejects_another_store() {
    let store = SessionStore::open_in_memory().unwrap();
    seed(&store);
    let other = SessionStore::open_in_memory().unwrap();
    let receipt = commit(&store, &artifact()).unwrap();
    let conn = store.lock_conn().unwrap();
    assert!(conn.path().unwrap_or_default().is_empty());
    assert_eq!(read_at(&conn, &store, &receipt).unwrap(), receipt);
    assert!(read_retained_at(&conn, &other, &receipt).is_err());
}

#[test]
fn missing_parent_wrong_checked_store_runtime_and_raw_bytes_never_insert_artifacts() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let raw = artifact();
    let mut candidate = None;
    let cancelled: Result<(), String> =
        authority::with_full_projection_transaction(&store, |checked| {
            candidate = Some(parent(
                &checked,
                &store,
                Some(raw.descriptor(&digest(b"comparison"))?),
            )?);
            Err("precommit rollback".into())
        });
    assert!(cancelled.is_err());
    let sql = candidate.unwrap();
    assert!(
        authority::with_full_projection_transaction(&store, |checked| retain_at(
            &checked, &store, &sql, &raw
        ))
        .is_err()
    );
    let other_db = FileDb::new();
    let other = other_db.open();
    assert!(
        authority::with_full_projection_transaction(&other, |checked| retain_at(
            &checked, &store, &sql, &raw
        ))
        .is_err()
    );
    assert!(require_full(&store.lock_conn().unwrap()).is_err());
    let rejected: Result<RawCaptureReceipt, String> =
        authority::with_full_projection_transaction(&store, |checked| {
            let mut sql = parent(
                &checked,
                &store,
                Some(raw.descriptor(&digest(b"comparison"))?),
            )?;
            sql.native_store_instance = uuid::Uuid::new_v4().to_string();
            retain_at(&checked, &store, &sql, &raw)
        });
    assert!(rejected.is_err());
    let mut changed = capture();
    changed["snapshots"][0]["snapshot"]["text"] = json!("different");
    let changed = RawCaptureArtifact::parse(changed.to_string(), "A").unwrap();
    assert!(
        authority::with_full_projection_transaction(&store, |checked| {
            let sql = parent(
                &checked,
                &store,
                Some(raw.descriptor(&digest(b"comparison"))?),
            )?;
            retain_at(&checked, &store, &sql, &changed)
        })
        .is_err()
    );
    assert_eq!(count(&store, "native_raw_captures"), 0);
    assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 0);
}
#[test]
fn precommit_rollback_and_failed_commit_preserve_parent_child_and_budget_atomically() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let raw = artifact();
    let mut provisional = None;
    let aborted: Result<(), String> =
        authority::with_full_projection_transaction(&store, |checked| {
            let sql = parent(
                &checked,
                &store,
                Some(raw.descriptor(&digest(b"comparison"))?),
            )?;
            provisional = Some(retain_at(&checked, &store, &sql, &raw)?);
            Err("actual caller guard withdrew before commit".into())
        });
    assert!(aborted.is_err());
    assert_eq!(count(&store, "native_raw_captures"), 0);
    assert_eq!(health(&store.lock_conn().unwrap(), None).unwrap(), (0, 0));
    assert!(read_at(&store.lock_conn().unwrap(), &store, &provisional.unwrap()).is_err());
    store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    assert!(commit(&store, &raw)
        .unwrap_err()
        .contains("COMMIT_UNCERTAIN"));
    store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(count(&store, "native_raw_captures"), 0);
    assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 0);
    assert_eq!(health(&store.lock_conn().unwrap(), None).unwrap(), (0, 0));
}

#[test]
fn successful_commit_with_lost_reply_reopens_as_original_data_without_current_runtime_authority() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let raw = artifact();
    let committed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let commit_seen = committed.clone();
    store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(move || {
            commit_seen.store(true, Ordering::Release);
            false
        }))
        .unwrap();
    let probe = committed.clone();
    store
        .lock_conn()
        .unwrap()
        .authorizer(Some(move |context: AuthContext<'_>| {
            if matches!(
                context.action,
                AuthAction::Pragma {
                    pragma_name: "synchronous",
                    pragma_value: Some(_)
                }
            ) && probe.load(Ordering::Acquire)
            {
                Authorization::Deny
            } else {
                Authorization::Allow
            }
        }))
        .unwrap();
    let mut reference = None;
    let lost_ack: Result<(), String> =
        authority::with_full_projection_transaction(&store, |checked| {
            let sql = parent(
                &checked,
                &store,
                Some(raw.descriptor(&digest(b"comparison"))?),
            )?;
            reference = Some(retain_at(&checked, &store, &sql, &raw)?);
            Ok(())
        });
    assert!(lost_ack.unwrap_err().contains("RECOVERY_REQUIRED"));
    store
        .lock_conn()
        .unwrap()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert!(committed.load(Ordering::Acquire));
    assert_eq!(count(&store, "native_raw_captures"), 1);
    assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 1);
    let reference = reference.unwrap();
    let original_runtime = reference.sql.native_store_instance.clone();
    drop(store);
    let reopened = db.open();
    let conn = reopened.lock_conn().unwrap();
    assert_ne!(reopened.native_instance_id().to_string(), original_runtime);
    assert!(read_at(&conn, &reopened, &reference)
        .unwrap_err()
        .contains("RUNTIME_CHANGED"));
    assert_eq!(
        read_retained_at(&conn, &reopened, &reference).unwrap(),
        reference
    );
    assert_eq!(reference.sql.native_store_instance, original_runtime);
    let other_db = FileDb::new();
    let other = other_db.open();
    assert!(read_retained_at(&conn, &other, &reference).is_err());
}

#[test]
fn a_previously_committed_parent_data_reference_cannot_authorize_a_later_artifact_insert() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let raw = artifact();
    // Deliberately simulate a broken caller that committed its provisional raw
    // parent without the mandatory child. A new callback has no insertion
    // provenance; retained JSON is data, never that callback's capability.
    let sql = authority::with_full_projection_transaction(&store, |checked| {
        parent(
            &checked,
            &store,
            Some(raw.descriptor(&digest(b"comparison"))?),
        )
    })
    .unwrap();
    let reference = RawCaptureReceipt::from_sql(&sql).unwrap();
    let rejected = authority::with_full_projection_transaction(&store, |checked| {
        retain_at(&checked, &store, &sql, &raw)
    });
    assert!(rejected
        .unwrap_err()
        .contains("PARENT_NOT_CURRENT_TRANSACTION"));
    assert_eq!(count(&store, "native_raw_captures"), 0);
    assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 1);
    assert!(read_at(&store.lock_conn().unwrap(), &store, &reference).is_err());
}

fn remove_raw_schema(conn: &Connection, remove_anchor: bool) {
    let names = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'native_raw_%'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for name in names {
        conn.execute_batch(&format!("DROP TRIGGER \"{}\"", name.replace('"', "\"\"")))
            .unwrap();
    }
    for table in TABLES.into_iter().rev() {
        conn.execute_batch(&format!("DROP TABLE {table}")).unwrap();
    }
    if remove_anchor {
        conn.execute_batch("ALTER TABLE native_authority_identity DROP COLUMN raw_capture_version")
            .unwrap();
    }
}

#[test]
fn initialized_namespace_before_first_artifact_and_missing_tables_rows_or_witnesses_never_reinitialize(
) {
    for missing in [
        "all_tables",
        "namespace",
        "namespace_witness",
        "budget",
        "budget_witness",
        "artifact",
        "guard",
    ] {
        let db = FileDb::new();
        let store = db.open();
        if missing == "all_tables" {
            remove_raw_schema(&store.lock_conn().unwrap(), false);
        } else {
            seed(&store);
            commit(&store, &artifact()).unwrap();
            let conn = store.lock_conn().unwrap();
            match missing {
                "namespace"=>conn.execute_batch("DROP TRIGGER native_raw_namespace_no_delete;DELETE FROM native_raw_capture_namespace").unwrap(),
                "namespace_witness"=>conn.execute_batch("DROP TABLE native_raw_capture_namespace_witness").unwrap(),
                "budget"=>conn.execute_batch("DROP TABLE native_raw_capture_budget").unwrap(),
                "budget_witness"=>conn.execute_batch("DROP TRIGGER native_raw_budget_witness_no_delete;DELETE FROM native_raw_capture_budget_witness").unwrap(),
                "guard"=>conn.execute_batch("DROP TRIGGER native_raw_no_replace").unwrap(),
                _=>conn.execute_batch("DROP TRIGGER native_raw_no_delete;DELETE FROM native_raw_captures").unwrap(),
            }
        }
        drop(store);
        assert!(
            SessionStore::open(db.path()).is_err(),
            "missing {missing} must remain held"
        );
    }
}

#[test]
fn legacy_sql_parents_without_raw_descriptors_upgrade_without_invented_artifacts() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let legacy = authority::with_full_projection_transaction(&store, |checked| {
        parent(&checked, &store, None)
    })
    .unwrap();
    assert!(legacy.raw_capture.is_none());
    assert!(RawCaptureReceipt::from_sql(&legacy).is_err());
    let json = serde_json::to_string(&legacy).unwrap();
    remove_raw_schema(&store.lock_conn().unwrap(), true);
    drop(store);
    let reopened = db.open();
    assert_eq!(count(&reopened, "native_raw_captures"), 0);
    assert_eq!(count(&reopened, "native_renderer_checkpoint_receipts"), 1);
    let retained: String = reopened
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT receipt_json FROM native_renderer_checkpoint_receipts WHERE nonce=?1",
            [legacy.nonce],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(retained, json);
    assert_eq!(
        health(&reopened.lock_conn().unwrap(), None).unwrap(),
        (0, 0)
    );
}

#[test]
fn immutable_rows_budgets_parent_anchor_and_source_identity_reject_replace_without_recursive_triggers(
) {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let receipt = commit(&store, &artifact()).unwrap();
    let conn = store.lock_conn().unwrap();
    conn.execute_batch("PRAGMA recursive_triggers=OFF").unwrap();
    assert!(conn.execute("INSERT OR REPLACE INTO native_raw_captures SELECT * FROM native_raw_captures WHERE nonce=?1",[&receipt.sql.nonce]).is_err());
    for table in [&TABLES[0], &TABLES[1], &TABLES[2], &TABLES[3]] {
        assert!(conn
            .execute(
                &format!("INSERT OR REPLACE INTO {table} SELECT * FROM {table}"),
                []
            )
            .is_err());
    }
    assert!(conn.execute("INSERT OR REPLACE INTO native_renderer_checkpoint_receipts(nonce,payload_digest,receipt_json) SELECT nonce,payload_digest,json_remove(receipt_json,'$.rawCapture') FROM native_renderer_checkpoint_receipts WHERE nonce=?1",[&receipt.sql.nonce]).is_err());
    let identity = source_ids(&conn).unwrap();
    conn.execute("INSERT OR REPLACE INTO native_authority_identity(id,source_store_id,source_profile_id) VALUES(1,'replacement','replacement')",[]).unwrap();
    assert_eq!(source_ids(&conn).unwrap(), identity);
    assert_eq!(read_at(&conn, &store, &receipt).unwrap(), receipt);
}

#[test]
fn weighted_quota_exhaustion_keeps_originals_and_rolls_back_the_new_parent() {
    for by_bytes in [false, true] {
        let db = FileDb::new();
        let store = db.open();
        seed(&store);
        let raw = artifact();
        let first = commit(&store, &raw).unwrap();
        let (rows, bytes) = health(&store.lock_conn().unwrap(), None).unwrap();
        let result = authority::with_full_projection_transaction(&store, |checked| {
            let sql = parent(
                &checked,
                &store,
                Some(raw.descriptor(&digest(b"comparison"))?),
            )?;
            retain_with_limits(
                &checked,
                &store,
                &sql,
                &raw,
                if by_bytes { MAX_ROWS } else { rows },
                if by_bytes { bytes } else { STORE_BYTES },
            )
        });
        assert!(result.unwrap_err().contains("CAPACITY"));
        assert_eq!(count(&store, "native_raw_captures"), 1);
        assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 1);
        assert_eq!(
            health(&store.lock_conn().unwrap(), None).unwrap(),
            (rows, bytes)
        );
        assert_eq!(
            read_at(&store.lock_conn().unwrap(), &store, &first).unwrap(),
            first
        );
    }
}

#[test]
fn same_length_raw_corruption_and_changed_window_nonce_or_descriptor_fail_read_only_verification() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let receipt = commit(&store, &artifact()).unwrap();
    for field in ["nonce", "window_epoch", "service_epoch", "round_id"] {
        let mut other = receipt.clone();
        match field {
            "nonce" => other.sql.nonce = uuid::Uuid::new_v4().to_string(),
            "window_epoch" => other.sql.window_epoch = uuid::Uuid::new_v4().to_string(),
            "service_epoch" => other.sql.service_epoch = uuid::Uuid::new_v4().to_string(),
            _ => other.sql.round_id = uuid::Uuid::new_v4().to_string(),
        }
        assert!(read_at(&store.lock_conn().unwrap(), &store, &other).is_err());
    }
    let mut other = receipt.clone();
    other.sql.raw_capture.as_mut().unwrap().comparison_sha256 = digest(b"changed");
    assert!(read_at(&store.lock_conn().unwrap(), &store, &other).is_err());
    let conn = store.lock_conn().unwrap();
    conn.execute_batch("DROP TRIGGER native_raw_no_update")
        .unwrap();
    conn.execute(
        "UPDATE native_raw_captures SET raw_json=replace(raw_json,'file','fyle') WHERE nonce=?1",
        [&receipt.sql.nonce],
    )
    .unwrap();
    conn.execute_batch("PRAGMA query_only=ON").unwrap();
    assert!(read_at(&conn, &store, &receipt).is_err());
}
