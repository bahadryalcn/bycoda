use super::*;

fn session(id: &str) -> SessionUpsert {
    serde_json::from_value(json!({"id":id,"cwd":".","harness":"codex","model":"fixture","modelSettings":{},
        "runtimeMode":"approve","title":"fixture","blocks":[{"id":"user.1","role":"user","text":"preserved"}]})).unwrap()
}

fn store() -> SessionStore {
    SessionStore::open_in_memory().unwrap()
}

fn seed(store: &SessionStore, id: &str) {
    let conn = store.lock_conn().unwrap();
    upsert_session_with_git(&conn, &session(id), crate::fs::GitInfo::default(), None).unwrap();
}

#[test]
fn quiesce_cancellation_is_permanent_monotonic_and_reopens() {
    let directory = Directory::new();
    let path = directory.0.join("cancel.db");
    let store = SessionStore::open(path.clone()).unwrap();
    seed(&store, "cancel");
    let ids = store.authority_identity().unwrap();
    let host = crate::harness::HarnessHost::new();
    store
        .authority_begin_quiesce("env", "cancel", "first", 0)
        .unwrap();
    let receipt = store
        .authority_cancel_quiesce("env", "cancel", "first", 0, &ids, &host)
        .unwrap();
    assert_eq!(receipt.authority_generation, 1);
    assert!(store
        .authority_begin_quiesce("env", "cancel", "first", 1)
        .is_err());
    assert!(store
        .authority_native_checkpoint(
            &NativeScope {
                environment_id: "env".into(),
                generation: 0
            },
            &session("cancel")
        )
        .is_err());
    store
        .authority_native_checkpoint(
            &NativeScope {
                environment_id: "env".into(),
                generation: 1,
            },
            &session("cancel"),
        )
        .unwrap();
    drop(store);
    let store = SessionStore::open(path).unwrap();
    assert_eq!(
        store
            .authority_cancel_quiesce("env", "cancel", "first", 0, &ids, &host)
            .unwrap(),
        receipt
    );
    store
        .authority_begin_quiesce("env", "cancel", "second", 1)
        .unwrap();
    assert!(store
        .authority_cancel_quiesce("env", "cancel", "first", 0, &ids, &host)
        .is_err());
    assert_eq!(
        store
            .authority_status("cancel")
            .unwrap()
            .unwrap()
            .migration_id,
        "second"
    );
}

#[test]
fn quiesce_cancellation_rejects_unknown_effects_scope_overflow_and_partial_fences() {
    let store = store();
    seed(&store, "cancel");
    let ids = store.authority_identity().unwrap();
    let host = crate::harness::HarnessHost::new();
    store
        .authority_begin_quiesce("env", "cancel", "m", 0)
        .unwrap();
    assert!(store
        .authority_cancel_quiesce("other", "cancel", "m", 0, &ids, &host)
        .is_err());
    let mut wrong = ids.clone();
    wrong.source_store_id = "wrong".into();
    assert!(store
        .authority_cancel_quiesce("env", "cancel", "m", 0, &wrong, &host)
        .is_err());
    assert!(store
        .authority_cancel_quiesce("env", "cancel", "m", MAX_SAFE, &ids, &host)
        .is_err());
    store
        .lock_conn()
        .unwrap()
        .execute(
            "INSERT INTO native_authority_unknown_ingress VALUES('unknown','provider',1)",
            [],
        )
        .unwrap();
    assert!(store
        .authority_cancel_quiesce("env", "cancel", "m", 0, &ids, &host)
        .is_err());
    store
        .lock_conn()
        .unwrap()
        .execute("DELETE FROM native_authority_unknown_ingress", [])
        .unwrap();
    store.lock_conn().unwrap().execute(
        "INSERT INTO native_authority_reservations VALUES('pending','cancel',0,'provider','UNKNOWN',1,NULL,1)", []).unwrap();
    assert!(store
        .authority_cancel_quiesce("env", "cancel", "m", 0, &ids, &host)
        .is_err());
    store
        .lock_conn()
        .unwrap()
        .execute("DELETE FROM native_authority_reservations", [])
        .unwrap();
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE native_authority_journal SET fence_json='{}' WHERE migration_id='m'",
            [],
        )
        .unwrap();
    assert!(store
        .authority_cancel_quiesce("env", "cancel", "m", 0, &ids, &host)
        .is_err());
    assert_eq!(
        store.authority_status("cancel").unwrap().unwrap().phase,
        "QUIESCING"
    );
    assert_eq!(
        store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM native_authority_cancellations",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn quiesce_cancellation_and_fence_compete_without_dual_ownership() {
    let directory = Directory::new();
    let path = directory.0.join("race.db");
    let store = SessionStore::open(path.clone()).unwrap();
    seed(&store, "race");
    store
        .authority_begin_quiesce("env.1", "race", "m", 0)
        .unwrap();
    let proof = idle(&store, "race", "m");
    let other = SessionStore::open(path).unwrap();
    let ids = other.authority_identity().unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let signal = barrier.clone();
    let cancel = std::thread::spawn(move || {
        signal.wait();
        other.authority_cancel_quiesce(
            "env.1",
            "race",
            "m",
            0,
            &ids,
            &crate::harness::HarnessHost::new(),
        )
    });
    barrier.wait();
    let fenced = store.authority_fence_source(proof);
    let cancelled = cancel.join().unwrap();
    assert_ne!(fenced.is_ok(), cancelled.is_ok());
    let state = store.authority_status("race").unwrap().unwrap();
    assert_eq!(state.generation, 1);
    assert_eq!(
        state.phase,
        if fenced.is_ok() { "FENCED" } else { "NATIVE" }
    );
}
fn inventory(store: &SessionStore, id: &str) -> WriterInventory {
    let conn = store.lock_conn().unwrap();
    WriterInventory::Complete {
        identity: identity(&conn).unwrap(),
        protocols: vec![2],
        observation_digest: sha(b"explicit isolated native launcher/window qualification"),
        buffers_digest: buffers_digest(&conn, id).unwrap(),
    }
}
fn idle(store: &SessionStore, id: &str, migration: &str) -> IdleProof {
    store
        .authority_verify_idle(
            "env.1",
            id,
            migration,
            &crate::harness::HarnessHost::new(),
            inventory(store, id),
        )
        .unwrap()
}
fn fence(store: &SessionStore, id: &str, migration: &str) -> SourceSnapshot {
    store
        .authority_begin_quiesce("env.1", id, migration, 0)
        .unwrap();
    store
        .authority_fence_source(idle(store, id, migration))
        .unwrap()
}
struct IsolatedAuthenticatedPort;
impl AuthenticatedHostDecisionPort for IsolatedAuthenticatedPort {
    fn verify_actor_and_challenge(&self, _: &NativeFence, _: &str) -> Result<(), String> {
        Ok(())
    }
}
struct RejectedActor;
impl AuthenticatedHostDecisionPort for RejectedActor {
    fn verify_actor_and_challenge(&self, _: &NativeFence, _: &str) -> Result<(), String> {
        Err("authenticated native challenge missing".into())
    }
}
fn decision(source: &NativeFence, phase: &str, generation: u64) -> HostDecision {
    let mut value = HostDecision {
        protocol: 2,
        environment_id: source.environment_id.clone(),
        session_id: source.session_id.clone(),
        migration_id: source.migration_id.clone(),
        source_profile_id: source.source_profile_id.clone(),
        source_store_id: source.source_store_id.clone(),
        receipt_id: format!("receipt.{phase}.{generation}"),
        source_generation: source.generation,
        authority_generation: generation,
        source_revision: source.source_revision,
        source_digest: source.source_digest.clone(),
        evidence_digest: source.evidence_digest.clone(),
        min_writer_protocol: 2,
        committed_at: 1_700_000_000_000,
        decision_digest: String::new(),
        phase: phase.into(),
        target_digest: (phase == "host-active").then(|| source.source_digest.clone()),
    };
    value.decision_digest = decision_digest(&value).unwrap();
    value
}
fn proof(store: &SessionStore, decision: &HostDecision) -> VerifiedHostDecision {
    store
        .authority_verify_host_decision(
            &decision.migration_id,
            &serde_json::to_string(decision).unwrap(),
            &IsolatedAuthenticatedPort,
        )
        .unwrap()
}

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("bycoda-authority-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let target = self.0.canonicalize().unwrap();
        assert_eq!(target.parent(), Some(root.as_path()));
        assert!(target
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("bycoda-authority-"));
        std::fs::remove_dir_all(target).unwrap();
    }
}

#[test]
fn empty_authority_schema_preserves_legacy_writes_and_identity() {
    let store = store();
    let ids = store.authority_identity().unwrap();
    assert_ne!(ids.source_profile_id, ids.source_store_id);
    let conn = store.lock_conn().unwrap();
    upsert_session(&conn, &session("legacy.1")).unwrap();
    assert!(get_session(&conn, "legacy.1").unwrap().is_some());
}

#[test]
fn critical_barrier_is_full_before_begin_and_restores_normal_on_rollback() {
    let store = store();
    let conn = store.lock_conn().unwrap();
    conn.pragma_update(None, "synchronous", "NORMAL").unwrap();
    let result: Result<(), String> = critical(&conn, |tx| {
        let synchronous: i64 = tx
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .unwrap();
        assert_eq!(synchronous, 2);
        tx.execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at) VALUES('rolled.back','.','codex','fixture','approve','fixture',1,1)",[]).unwrap();
        Err("injected failure".into())
    });
    assert!(result.is_err());
    assert!(get_session(&conn, "rolled.back").unwrap().is_none());
    assert_eq!(
        conn.pragma_query_value(None, "synchronous", |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn deterministic_exact_source_encoding_rejects_unsafe_integer_values() {
    assert_eq!(
        encode(&json!({"z":"e\u{301}","a":"\u{e9}"})).unwrap(),
        "{\"a\":\"é\",\"z\":\"é\"}"
    );
    assert!(encode(&json!({"counter":9_007_199_254_740_992u64})).is_err());
    assert!(encode(&json!({"counter":9_007_199_254_740_991u64})).is_ok());
}

#[test]
fn old_connection_without_bridge_functions_cannot_change_fenced_rows_but_other_ids_work() {
    let directory = Directory::new();
    let path = directory.0.join("isolated.db");
    let store = SessionStore::open(path.clone()).unwrap();
    seed(&store, "migrated");
    seed(&store, "legacy");
    let source = fence(&store, "migrated", "migration.1");
    assert_eq!(source.fence.generation, 1);
    let old = Connection::open(&path).unwrap();
    old.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    for sql in [
        "UPDATE sessions SET title='stale' WHERE id='migrated'",
        "DELETE FROM sessions WHERE id='migrated'",
        "UPDATE session_blocks SET block_json='{}' WHERE session_id='migrated'",
        "DELETE FROM session_block_state WHERE session_id='migrated'",
        "INSERT OR REPLACE INTO sessions SELECT * FROM sessions WHERE id='migrated'",
    ] {
        assert!(
            old.execute(sql, [])
                .unwrap_err()
                .to_string()
                .contains("NATIVE_AUTHORITY_FENCED"),
            "{sql}"
        );
    }
    old.execute(
        "UPDATE sessions SET title='legacy still works' WHERE id='legacy'",
        [],
    )
    .unwrap();
    assert_eq!(
        old.query_row("SELECT title FROM sessions WHERE id='legacy'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "legacy still works"
    );
    assert_eq!(
        old.query_row(
            "SELECT count(*) FROM session_blocks WHERE session_id='migrated'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn source_fence_and_immutable_bytes_survive_reopen_without_changing_store_identity() {
    let directory = Directory::new();
    let path = directory.0.join("isolated.db");
    let store = SessionStore::open(path.clone()).unwrap();
    seed(&store, "native");
    let source = fence(&store, "native", "migration.restart");
    let ids = store.authority_identity().unwrap();
    assert_eq!(
        source.fence.source_digest,
        sha(source.snapshot_json.as_bytes())
    );
    let retained: Value = serde_json::from_str(&source.snapshot_json).unwrap();
    assert!(retained["retainedNativeRows"]["sessions"].is_array());
    drop(store);
    let reopened = SessionStore::open(path).unwrap();
    assert_eq!(ids, reopened.authority_identity().unwrap());
    assert_eq!(
        source.snapshot_json,
        reopened
            .authority_snapshot("migration.restart")
            .unwrap()
            .snapshot_json
    );
    assert_eq!(
        reopened.authority_status("native").unwrap().unwrap().phase,
        "FENCED"
    );
}

#[test]
fn competing_migrations_and_foreign_environment_cannot_replace_source_intent() {
    let store = store();
    seed(&store, "native");
    store
        .authority_begin_quiesce("env.1", "native", "first", 0)
        .unwrap();
    store
        .authority_begin_quiesce("env.1", "native", "first", 0)
        .unwrap();
    assert!(store
        .authority_begin_quiesce("env.1", "native", "second", 0)
        .is_err());
    assert!(store
        .authority_begin_quiesce("env.2", "native", "first", 0)
        .is_err());
    assert!(store
        .authority_begin_quiesce("env.1", "native", "first", 1)
        .is_err());
    assert_eq!(
        store
            .authority_status("native")
            .unwrap()
            .unwrap()
            .migration_id,
        "first"
    );
}

#[test]
fn incomplete_or_old_writer_inventory_never_mints_idle_proof() {
    let store = store();
    seed(&store, "native");
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    let host = crate::harness::HarnessHost::new();
    assert!(store
        .authority_verify_idle("env.1", "native", "m", &host, WriterInventory::Unknown)
        .is_err());
    for protocols in [vec![], vec![1], vec![2, 1]] {
        let mut observation = inventory(&store, "native");
        if let WriterInventory::Complete {
            protocols: values, ..
        } = &mut observation
        {
            *values = protocols;
        }
        assert!(store
            .authority_verify_idle("env.1", "native", "m", &host, observation)
            .is_err());
    }
}

#[test]
fn unknown_admission_after_external_boundary_is_retained_and_blocks_transfer() {
    let store = store();
    seed(&store, "native");
    let gate = store.authority_execution_gate();
    let mut lease = gate.reserve("native", "provider", None).unwrap();
    lease.begin_external().unwrap();
    drop(lease);
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    store
        .lock_conn()
        .unwrap()
        .execute("UPDATE native_authority_reservations SET created_at=0", [])
        .unwrap();
    assert!(store
        .authority_verify_idle(
            "env.1",
            "native",
            "m",
            &crate::harness::HarnessHost::new(),
            inventory(&store, "native")
        )
        .is_err());
    assert_eq!(
        store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM native_authority_reservations",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn quiesce_and_pre_fork_admission_have_no_unreserved_race_window() {
    let store = store();
    seed(&store, "native");
    let gate = store.authority_execution_gate();
    let mut admitted = gate.reserve("native", "provider", None).unwrap();
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    assert!(gate.reserve("native", "provider", None).is_err());
    assert!(store
        .authority_verify_idle(
            "env.1",
            "native",
            "m",
            &crate::harness::HarnessHost::new(),
            inventory(&store, "native")
        )
        .is_err());
    // An already admitted start remains visible until actual known settlement.
    admitted.begin_external().unwrap();
    admitted.spawned(1234).unwrap();
    admitted.finish().unwrap();
    assert_eq!(
        store
            .authority_fence_source(idle(&store, "native", "m"))
            .unwrap()
            .fence
            .generation,
        1
    );
}

#[test]
fn unstarted_reservation_drop_is_known_not_sent_and_leaves_no_stale_slot() {
    let store = store();
    seed(&store, "native");
    drop(
        store
            .authority_execution_gate()
            .reserve("native", "provider", None)
            .unwrap(),
    );
    assert_eq!(fence(&store, "native", "m").fence.generation, 1);
}

#[test]
fn injected_fence_write_failure_rolls_back_generation_snapshot_and_permits() {
    let store = store();
    seed(&store, "native");
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    store.lock_conn().unwrap().execute_batch("CREATE TEMP TRIGGER fault BEFORE UPDATE ON native_authority_floor WHEN NEW.phase='FENCED' BEGIN SELECT RAISE(ABORT,'injected storage fault'); END;").unwrap();
    assert!(store
        .authority_fence_source(idle(&store, "native", "m"))
        .is_err());
    let state = store.authority_status("native").unwrap().unwrap();
    assert_eq!(state.phase, "QUIESCING");
    assert_eq!(state.generation, 0);
    assert!(store.authority_snapshot("m").is_err());
    store
        .lock_conn()
        .unwrap()
        .execute_batch("DROP TRIGGER fault")
        .unwrap();
    assert!(store
        .authority_fence_source(idle(&store, "native", "m"))
        .is_ok());
}

#[test]
fn host_activation_cache_write_and_source_snapshot_have_distinct_capabilities() {
    let store = store();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let receipt = decision(&source.fence, "host-active", 1);
    let proof = proof(&store, &receipt);
    assert!(store
        .authority_apply_projection(&proof, &session("native"))
        .is_err());
    store.authority_apply_host_decision(&proof).unwrap();
    let mut update = session("native");
    update.title = "Host projection".into();
    update.blocks = json!([{"id":"host.1","role":"assistant","text":"from Host"}]);
    store.authority_apply_projection(&proof, &update).unwrap();
    assert_eq!(
        store.authority_status("native").unwrap().unwrap().phase,
        "CACHE"
    );
    assert!(store
        .authority_execution_gate()
        .reserve(
            "native",
            "provider",
            Some(&NativeScope {
                environment_id: "env.1".into(),
                generation: 1
            })
        )
        .is_err());
    assert!(upsert_session_with_git(
        &store.lock_conn().unwrap(),
        &update,
        crate::fs::GitInfo::default(),
        None
    )
    .is_err());
    assert_eq!(
        source.snapshot_json,
        store.authority_snapshot("m").unwrap().snapshot_json
    );
    assert!(store
        .authority_apply_projection(&proof, &session("other.session"))
        .is_err());
}

#[test]
fn projection_failure_never_commits_an_old_binary_write_bypass() {
    let store = store();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let proof = proof(&store, &decision(&source.fence, "host-active", 1));
    store.authority_apply_host_decision(&proof).unwrap();
    store.lock_conn().unwrap().execute_batch("CREATE TEMP TRIGGER fail_projection BEFORE INSERT ON session_blocks BEGIN SELECT RAISE(ABORT,'fault after permit insertion'); END").unwrap();
    let mut update = session("native");
    update.title = "must roll back".into();
    assert!(store.authority_apply_projection(&proof, &update).is_err());
    let conn = store.lock_conn().unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM native_authority_permits", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
    assert_eq!(
        get_session(&conn, "native").unwrap().unwrap().title,
        "fixture"
    );
    assert!(conn
        .execute(
            "UPDATE sessions SET title='old writer' WHERE id='native'",
            []
        )
        .is_err());
}

#[test]
fn source_abort_requires_matching_authenticated_higher_generation_host_receipt() {
    let store = store();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let mut invalid = decision(&source.fence, "aborted", 2);
    invalid.environment_id = "foreign.env".into();
    invalid.decision_digest = decision_digest(&invalid).unwrap();
    assert!(store
        .authority_verify_host_decision(
            "m",
            &serde_json::to_string(&invalid).unwrap(),
            &IsolatedAuthenticatedPort
        )
        .is_err());
    let abort = decision(&source.fence, "aborted", 2);
    let raw = serde_json::to_string(&abort).unwrap();
    assert!(store
        .authority_verify_host_decision("m", &raw, &RejectedActor)
        .is_err());
    let proof = proof(&store, &abort);
    let state = store.authority_apply_host_decision(&proof).unwrap();
    assert_eq!(state.phase, "NATIVE");
    assert_eq!(state.generation, 2);
    assert!(store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE sessions SET title='unversioned downgrade' WHERE id='native'",
            []
        )
        .is_err());
    assert!(store
        .authority_execution_gate()
        .reserve("native", "provider", None)
        .is_err());
    let scope = NativeScope {
        environment_id: "env.1".into(),
        generation: 2,
    };
    let mut update = session("native");
    update.title = "qualified native writer".into();
    store.authority_native_checkpoint(&scope, &update).unwrap();
    assert!(store
        .authority_native_checkpoint(
            &NativeScope {
                environment_id: "env.1".into(),
                generation: 1
            },
            &update
        )
        .is_err());
    assert!(store
        .authority_native_checkpoint(
            &NativeScope {
                environment_id: "wrong".into(),
                generation: 2
            },
            &update
        )
        .is_err());
}

#[test]
fn an_abort_receipt_can_never_unfence_an_already_active_host() {
    let store = store();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    store
        .authority_apply_host_decision(&proof(&store, &decision(&source.fence, "host-active", 1)))
        .unwrap();
    assert!(store
        .authority_apply_host_decision(&proof(&store, &decision(&source.fence, "aborted", 2)))
        .is_err());
    assert_eq!(
        store.authority_status("native").unwrap().unwrap().phase,
        "HOST"
    );
}

#[test]
fn corrupt_source_blob_or_evidence_is_rescue_only() {
    let store = store();
    seed(&store, "native");
    fence(&store, "native", "m");
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE native_authority_journal SET snapshot_json='{}' WHERE migration_id='m'",
            [],
        )
        .unwrap();
    assert!(store.authority_snapshot("m").is_err());
    assert_eq!(
        store.authority_status("native").unwrap().unwrap().phase,
        "FENCED"
    );
    assert!(store
        .authority_execution_gate()
        .reserve("native", "provider", None)
        .is_err());
}

#[test]
fn unsafe_source_numbers_cannot_be_silently_rewritten_during_migration() {
    let store = store();
    let mut input = session("native");
    input.model_settings = json!({"unsafe":9_007_199_254_740_992u64});
    upsert_session_with_git(
        &store.lock_conn().unwrap(),
        &input,
        crate::fs::GitInfo::default(),
        None,
    )
    .unwrap();
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    assert!(store
        .authority_fence_source(idle(&store, "native", "m"))
        .unwrap_err()
        .contains("unsafe snapshot number"));
    assert_eq!(
        store.authority_status("native").unwrap().unwrap().phase,
        "QUIESCING"
    );
    assert_eq!(
        get_session(&store.lock_conn().unwrap(), "native")
            .unwrap()
            .unwrap()
            .model_settings,
        input.model_settings
    );
}

#[test]
fn changed_or_unsaved_native_editor_barrier_prevents_source_fence() {
    let store = store();
    seed(&store, "native");
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    let proof = idle(&store, "native", "m");
    let raw=json!([{"path":std::env::current_dir().unwrap().join("authority-unsaved-file.txt").to_string_lossy(),"dirty":true}]).to_string();
    store.lock_conn().unwrap().execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES('window',?1,1,1)",[raw]).unwrap();
    assert!(store.authority_fence_source(proof).is_err());
    assert!(buffers_digest(&store.lock_conn().unwrap(), "native").is_err());
}

#[test]
fn a_parent_delete_cannot_mutate_a_fenced_worker_or_drop_client_owned_queue() {
    let store = store();
    seed(&store, "lead");
    seed(&store, "worker");
    store
        .lock_conn()
        .unwrap()
        .execute(
            "INSERT INTO orchestration_workers(session_id,lead_id) VALUES('worker','lead')",
            [],
        )
        .unwrap();
    set_session_queue(
        &store.lock_conn().unwrap(),
        "worker",
        Some(&json!([{"id":"unsent.1","text":"preserve"}])),
    )
    .unwrap();
    fence(&store, "worker", "m");
    assert!(delete_session(&store.lock_conn().unwrap(), "lead").is_err());
    assert!(delete_session(&store.lock_conn().unwrap(), "worker").is_err());
    assert!(get_session(&store.lock_conn().unwrap(), "lead")
        .unwrap()
        .is_some());
    assert!(get_session_queue(&store.lock_conn().unwrap(), "worker")
        .unwrap()
        .is_some());
    // Unsent queues are local client state and are not automatically drained.
    set_session_queue(
        &store.lock_conn().unwrap(),
        "worker",
        Some(&json!([{"id":"unsent.2"}])),
    )
    .unwrap();
}

#[test]
fn stale_provider_alias_cannot_bypass_session_scope_after_cache_replacement() {
    let store = store();
    let mut original = session("native");
    original.provider_session_id = Some("provider-old".into());
    upsert_session_with_git(
        &store.lock_conn().unwrap(),
        &original,
        crate::fs::GitInfo::default(),
        None,
    )
    .unwrap();
    let source = fence(&store, "native", "m");
    let proof = proof(&store, &decision(&source.fence, "host-active", 1));
    store.authority_apply_host_decision(&proof).unwrap();
    let mut projected = original;
    projected.provider_session_id = Some("provider-host".into());
    store
        .authority_apply_projection(&proof, &projected)
        .unwrap();
    let gate = store.authority_execution_gate();
    assert!(gate
        .assert_provider_target(
            "unrelated",
            "http://127.0.0.1:1234/session/provider-old/prompt_async"
        )
        .is_err());
    assert!(gate
        .assert_provider_target(
            "unrelated",
            "http://127.0.0.1:1234/session/provider-host/prompt_async"
        )
        .is_err());
}

#[test]
fn observed_sessionless_mutations_keep_promotion_unqualified() {
    let store = store();
    seed(&store, "native");
    let gate = store.authority_execution_gate();
    gate.note_unknown_ingress("legacy-provider-http").unwrap();
    store
        .authority_begin_quiesce("env.1", "native", "m", 0)
        .unwrap();
    assert!(gate.note_unknown_ingress("legacy-provider-http").is_err());
    assert!(store
        .authority_verify_idle(
            "env.1",
            "native",
            "m",
            &crate::harness::HarnessHost::new(),
            inventory(&store, "native")
        )
        .is_err());
}

#[test]
fn host_receipt_digest_matches_the_node_ascii_tuple_vector() {
    let value = HostDecision {
        protocol: 2,
        environment_id: "env-golden".into(),
        session_id: "session-golden".into(),
        migration_id: "migration-golden".into(),
        source_profile_id: "profile-golden".into(),
        source_store_id: "store-golden".into(),
        receipt_id: "receipt-golden".into(),
        source_generation: 7,
        authority_generation: 8,
        source_revision: 42,
        source_digest: "a".repeat(64),
        evidence_digest: "b".repeat(64),
        min_writer_protocol: 2,
        committed_at: 1_700_000_000_000,
        phase: "aborted".into(),
        target_digest: None,
        decision_digest: String::new(),
    };
    // Independently computed with Node crypto over JSON.stringify(the canonical tuple).
    assert_eq!(
        decision_digest(&value).unwrap(),
        "a6598ffe23f231050ad53809356cef7d36ffd915da0cf540f05e28a5c3f3fc2a"
    );
}

#[test]
fn modified_or_unsupported_host_receipts_cannot_restore_native_authority() {
    let store = store();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let original = decision(&source.fence, "aborted", 2);
    for variant in 0..6 {
        let mut changed = original.clone();
        match variant {
            0 => changed.authority_generation = 1,
            1 => changed.source_store_id = "wrong-store".into(),
            2 => changed.source_revision += 1,
            3 => changed.source_digest = "c".repeat(64),
            4 => changed.min_writer_protocol = 3,
            _ => changed.receipt_id = "modified-after-signing".into(),
        }
        if variant != 5 {
            changed.decision_digest = decision_digest(&changed).unwrap();
        }
        assert!(store
            .authority_verify_host_decision(
                "m",
                &serde_json::to_string(&changed).unwrap(),
                &IsolatedAuthenticatedPort
            )
            .is_err());
    }
    assert_eq!(
        store.authority_status("native").unwrap().unwrap().phase,
        "FENCED"
    );
}

#[test]
fn a_future_writer_floor_blocks_current_native_and_projection_capabilities() {
    let store = store();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let active = proof(&store, &decision(&source.fence, "host-active", 1));
    store.authority_apply_host_decision(&active).unwrap();
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE native_authority_floor SET min_writer_protocol=3 WHERE session_id='native'",
            [],
        )
        .unwrap();
    assert!(store
        .authority_apply_projection(&active, &session("native"))
        .is_err());
    let mut conn = store.lock_conn().unwrap();
    let tx = conn.transaction().unwrap();
    tx.execute("INSERT INTO native_authority_permits(nonce,environment_id,session_id,generation,writer_protocol,purpose) VALUES('obsolete','env.1','native',1,2,'projection')",[]).unwrap();
    assert!(tx
        .execute("UPDATE sessions SET title='obsolete' WHERE id='native'", [])
        .is_err());
    tx.rollback().unwrap();
    drop(conn);
    assert!(store
        .authority_execution_gate()
        .reserve(
            "native",
            "provider",
            Some(&NativeScope {
                environment_id: "env.1".into(),
                generation: 1
            })
        )
        .is_err());
    assert_eq!(
        store
            .authority_status("native")
            .unwrap()
            .unwrap()
            .min_writer_protocol,
        3
    );
}

#[test]
fn full_delta_checkpoint_and_rewind_writers_cannot_bypass_a_fence() {
    let store = store();
    seed(&store, "native");
    fence(&store, "native", "m");
    let conn = store.lock_conn().unwrap();
    assert!(upsert_session_with_git(
        &conn,
        &session("native"),
        crate::fs::GitInfo::default(),
        None
    )
    .is_err());
    assert!(incremental::checkpoint(&conn, "native", &json!([]), &[]).is_err());
    let delta = incremental::SessionDelta {
        session: session("native"),
        expected_updated_at: 0,
        expected_revision: 0,
        length: 1,
        changes: vec![],
    };
    assert!(incremental::apply(&conn, &delta).is_err());
    drop(conn);
    assert!(rewind::assert_writable(&store, "native").is_err());
    assert!(store.session_ids().unwrap().contains("native"));
}

#[test]
fn an_old_reader_never_observes_a_transaction_local_projection_permit() {
    let directory = Directory::new();
    let path = directory.0.join("isolated.db");
    let store = SessionStore::open(path.clone()).unwrap();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let active = proof(&store, &decision(&source.fence, "host-active", 1));
    store.authority_apply_host_decision(&active).unwrap();
    let old = Connection::open(path).unwrap();
    old.busy_timeout(std::time::Duration::from_millis(20))
        .unwrap();
    let mut conn = store.lock_conn().unwrap();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    tx.execute("INSERT INTO native_authority_permits(nonce,environment_id,session_id,generation,writer_protocol,purpose) VALUES('uncommitted','env.1','native',1,2,'projection')",[]).unwrap();
    tx.execute(
        "UPDATE sessions SET title='not committed' WHERE id='native'",
        [],
    )
    .unwrap();
    assert_eq!(
        old.query_row("SELECT count(*) FROM native_authority_permits", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
    assert!(old
        .execute(
            "UPDATE sessions SET title='old writer' WHERE id='native'",
            []
        )
        .is_err());
    drop(tx);
    drop(conn);
    drop(store);
    assert_eq!(
        old.query_row("SELECT count(*) FROM native_authority_permits", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
    assert_eq!(
        old.query_row("SELECT title FROM sessions WHERE id='native'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "fixture"
    );
    assert!(old
        .execute(
            "UPDATE sessions SET title='old writer' WHERE id='native'",
            []
        )
        .unwrap_err()
        .to_string()
        .contains("NATIVE_AUTHORITY_FENCED"));
}

#[test]
fn a_failed_durable_admission_never_calls_the_provider_operation() {
    let store = store();
    seed(&store, "native");
    store.lock_conn().unwrap().execute_batch("CREATE TEMP TRIGGER reject_reservation BEFORE INSERT ON native_authority_reservations BEGIN SELECT RAISE(ABORT,'injected disk failure'); END;").unwrap();
    let called = std::cell::Cell::new(false);
    let result = store
        .authority_execution_gate()
        .guarded("native", "provider", || {
            called.set(true);
            Ok(())
        });
    assert!(result.is_err());
    assert!(!called.get());
    assert_eq!(
        store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM native_authority_reservations",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
#[ignore = "isolated child exits without unwinding; invoked only by parent crash test"]
fn authority_uncommitted_projection_crash_child() {
    let path = std::path::PathBuf::from(
        std::env::var_os("BYCODA_AUTHORITY_CRASH_DB").expect("isolated parent path"),
    );
    let parent = path.parent().unwrap().canonicalize().unwrap();
    assert_eq!(
        parent.parent(),
        Some(std::env::temp_dir().canonicalize().unwrap().as_path())
    );
    assert!(parent
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("bycoda-authority-"));
    let store = SessionStore::open(path).unwrap();
    let conn = store.lock_conn().unwrap();
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).unwrap();
    tx.execute("INSERT INTO native_authority_permits(nonce,environment_id,session_id,generation,writer_protocol,purpose) VALUES('crashing','env.1','native',1,2,'projection')",[]).unwrap();
    tx.execute(
        "UPDATE sessions SET title='crashed projection' WHERE id='native'",
        [],
    )
    .unwrap();
    // Deliberately bypass Rust Drop/rollback. SQLite must recover without ever
    // publishing the temporary permit or partial transcript to another writer.
    std::process::exit(91);
}

#[test]
fn process_death_cannot_publish_a_projection_permit_or_partial_transcript() {
    let directory = Directory::new();
    let path = directory.0.join("crash.db");
    let store = SessionStore::open(path.clone()).unwrap();
    seed(&store, "native");
    let source = fence(&store, "native", "m");
    let active = proof(&store, &decision(&source.fence, "host-active", 1));
    store.authority_apply_host_decision(&active).unwrap();
    drop(store);
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--ignored",
            "--exact",
            "session_store::authority::tests::authority_uncommitted_projection_crash_child",
        ])
        .env("BYCODA_AUTHORITY_CRASH_DB", &path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    assert_eq!(command.status().unwrap().code(), Some(91));
    let reopened = SessionStore::open(path).unwrap();
    assert_eq!(
        get_session(&reopened.lock_conn().unwrap(), "native")
            .unwrap()
            .unwrap()
            .title,
        "fixture"
    );
    assert_eq!(
        reopened
            .lock_conn()
            .unwrap()
            .query_row("SELECT count(*) FROM native_authority_permits", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
    assert_eq!(
        reopened.authority_status("native").unwrap().unwrap().phase,
        "HOST"
    );
    assert!(upsert_session_with_git(
        &reopened.lock_conn().unwrap(),
        &session("native"),
        crate::fs::GitInfo::default(),
        None
    )
    .is_err());
}
