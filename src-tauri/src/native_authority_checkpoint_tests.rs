use super::*;
use crate::session_store::SessionStore;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use std::sync::mpsc;

struct Fixture {
    store: Arc<SessionStore>,
    barrier: WindowBarrier,
    resources: Arc<ResourceTable>,
    service: Arc<NativeRendererCheckpoints>,
}
impl Fixture {
    fn new() -> Self {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        store.lock_conn().unwrap().execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES('A','.','codex','fixture','approve','A',1,1,'[]')", []).unwrap();
        store.lock_conn().unwrap().execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES('B','.','codex','fixture','approve','B',1,1,'[]')", []).unwrap();
        let barrier = WindowBarrier::new();
        barrier.admit_window("main").unwrap();
        let resources = Arc::new(native_window_lifecycle::test_buffer_resources(
            &barrier, "main",
        ));
        let source = CapturedSourceBinding::capture(store.clone(), "environment").unwrap();
        let service = Arc::new(NativeRendererCheckpoints::new(source, barrier.clone()).unwrap());
        Self {
            store,
            barrier,
            resources,
            service,
        }
    }
    fn round(&self) -> NativeCheckpointRound {
        self.service
            .start_round(
                self.barrier.close_target_admission("A").unwrap(),
                NativeCheckpointScope::new("environment", "A", "migration", 0).unwrap(),
            )
            .unwrap()
    }
    fn issue(&self, round: &NativeCheckpointRound) -> NativeRendererChallenge {
        self.service
            .issue_resources(round, &self.resources, Duration::from_secs(10))
            .unwrap()
    }
    fn expected(&self) -> NativeCheckpointExpectation {
        let conn = self.store.lock_conn().unwrap();
        let (revision, updated_at, transcript): (i64,i64,String) = conn.query_row("SELECT COALESCE((SELECT revision FROM session_block_state WHERE session_id='A'),0),updated_at,blocks_json FROM session_transcripts WHERE id='A'", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
        let blob = |table: &str, column: &str| {
            use rusqlite::OptionalExtension;
            let raw: Option<String> = conn
                .query_row(
                    &format!("SELECT {column} FROM {table} WHERE session_id='A'"),
                    [],
                    |row| row.get(0),
                )
                .optional()
                .unwrap();
            raw.map_or(ExpectedSqlBlob::Absent, |raw| ExpectedSqlBlob::Present {
                sha256: hash(raw.as_bytes()),
            })
        };
        NativeCheckpointExpectation {
            revision,
            updated_at,
            transcript_sha256: hash(transcript.as_bytes()),
            draft: blob("composer_drafts", "draft_json"),
            queue: blob("session_queues", "queue_json"),
        }
    }
    fn receipts(&self) -> i64 {
        self.store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM native_renderer_checkpoint_receipts",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }
}

fn replace_same_row(f: &Fixture, mode: &str) {
    let conn = f.store.lock_conn().unwrap();
    if mode == "rename" {
        conn.execute("UPDATE sessions SET id='temporary' WHERE id='A'", [])
            .unwrap();
        conn.execute("UPDATE sessions SET id='A' WHERE id='temporary'", [])
            .unwrap();
        return;
    }
    if mode == "delete" {
        conn.execute("DELETE FROM sessions WHERE id='A'", [])
            .unwrap();
    }
    conn.execute("INSERT OR REPLACE INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES('A','.','codex','fixture','approve','A',1,1,'[]')", []).unwrap();
}

#[test]
fn same_id_row_recreation_cannot_issue_or_consume_an_old_round() {
    for before_issue in [true, false] {
        for mode in ["delete", "replace", "rename"] {
            let f = Fixture::new();
            let original = f.expected();
            let round = f.round();
            let challenge = (!before_issue).then(|| f.issue(&round));
            replace_same_row(&f, mode);
            assert_eq!(f.expected(), original); // revision/content cannot detect this ABA
            let error = if let Some(challenge) = challenge {
                f.service
                    .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
                    .unwrap_err()
            } else {
                f.service
                    .issue_resources(&round, &f.resources, Duration::from_secs(10))
                    .unwrap_err()
            };
            assert!(error.contains("ROW_CHANGED"), "{mode}: {error}");
            assert_eq!(f.receipts(), 0);
        }
    }
}

#[test]
fn pending_challenge_expiring_during_row_validation_never_admits_checkpoint_work() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f
        .service
        .issue_resources(&round, &f.resources, Duration::from_secs(1))
        .unwrap();
    let expected = f.expected();
    let expires = f.service.ledger.lock().unwrap().entries[&challenge.nonce].expires;
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first = std::sync::atomic::AtomicBool::new(true);
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(Some(move |context: AuthContext<'_>| {
            if matches!(
                context.action,
                AuthAction::Read {
                    table_name: "native_session_row_identity",
                    ..
                }
            ) && first.swap(false, Ordering::SeqCst)
            {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            Authorization::Allow
        }))
        .unwrap();
    let service = f.service.clone();
    let resources = f.resources.clone();
    let nonce = challenge.nonce.clone();
    let job =
        std::thread::spawn(move || service.checkpoint_resources(&resources, &nonce, expected));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    std::thread::sleep(
        expires.saturating_duration_since(Instant::now()) + Duration::from_millis(10),
    );
    release_tx.send(()).unwrap();
    let error = job.join().unwrap().unwrap_err();
    assert!(error.contains("EXPIRED"), "{error}");
    assert_eq!(f.receipts(), 0);
    assert!(matches!(
        f.service
            .status_resources(&f.resources, &challenge.nonce)
            .unwrap(),
        NativeCheckpointStatus::Expired
    ));
}

#[test]
fn scoped_checked_owner_matches_only_the_same_physical_capture() {
    let f = Fixture::new();
    let instance = f.store.native_instance_id();
    let original =
        native_window_lifecycle::capture_checkpoint_resources(&f.resources, instance).unwrap();
    let second_capture =
        native_window_lifecycle::capture_checkpoint_resources(&f.resources, instance).unwrap();
    let same_label_resources = native_window_lifecycle::test_buffer_resources(&f.barrier, "main");
    let same_label =
        native_window_lifecycle::capture_checkpoint_resources(&same_label_resources, instance)
            .unwrap();
    native_window_lifecycle::with_checked_checkpoint_resources(
        &original,
        &f.resources,
        instance,
        |_, _, checked| {
            assert!(checked.matches_store_instance(instance));
            assert!(!checked.matches_store_instance(uuid::Uuid::new_v4()));
            assert!(checked.matches(&original));
            assert!(checked.matches(&second_capture));
            assert!(!checked.matches(&same_label));
            Ok(())
        },
    )
    .unwrap();
    assert!(native_window_lifecycle::with_checked_checkpoint_resources(
        &original,
        &same_label_resources,
        instance,
        |_, _, _| Ok(())
    )
    .is_err());
    // A same-label replacement above retires the old barrier token. Exercise
    // reload on a separate current physical owner, not on that retired token.
    let reload = Fixture::new();
    let reload_instance = reload.store.native_instance_id();
    let reload_owner =
        native_window_lifecycle::capture_checkpoint_resources(&reload.resources, reload_instance)
            .unwrap();
    native_window_lifecycle::test_reload_buffer_resources(&reload.resources);
    assert!(native_window_lifecycle::with_checked_checkpoint_resources(
        &reload_owner,
        &reload.resources,
        reload_instance,
        |_, _, _| Ok(())
    )
    .is_err());
}

#[test]
fn full_sql_transaction_rejects_foreign_target_store_and_replaced_row_tokens() {
    for mode in ["target", "store", "replace"] {
        let f = Fixture::new();
        let other = Fixture::new();
        let round = f.round();
        let challenge = f.issue(&round);
        let actual = f.service.ledger.lock().unwrap().rounds[&round.id].clone();
        let row = if mode == "target" {
            f.store.capture_session_row_identity("B").unwrap().unwrap()
        } else if mode == "store" {
            other
                .store
                .capture_session_row_identity("A")
                .unwrap()
                .unwrap()
        } else {
            let row = f.store.capture_session_row_identity("A").unwrap().unwrap();
            replace_same_row(&f, "replace");
            row
        };
        let expected = f.expected();
        let fingerprint = expected.fingerprint().unwrap();
        let error = f
            .store
            .renderer_checkpoint_commit(NativeCheckpointCommit {
                nonce: &challenge.nonce,
                service_epoch: &f.service.epoch,
                round_id: &round.id,
                window_epoch: &challenge.window_epoch,
                scope: &actual.scope,
                row_identity: &row,
                expected: &expected,
                fingerprint: &fingerprint,
            })
            .unwrap_err();
        assert!(error.contains("ROW_CHANGED"), "{mode}: {error}");
        assert_eq!(f.receipts(), 0);
    }
}

#[test]
fn ordinary_upsert_preserves_the_round_and_its_real_full_sql_receipt() {
    let f = Fixture::new();
    let round = f.round();
    f.store.lock_conn().unwrap().execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES('A','.','codex','fixture','approve','renamed title',1,2,'[]') ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at", []).unwrap();
    let challenge = f.issue(&round);
    let receipt = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
    assert_eq!(receipt.updated_at, 2);
    assert_eq!(receipt.provider_output, ProviderOutputCheckpoint::Unsealed);
    assert_eq!(f.receipts(), 1);
}

#[test]
fn historical_receipt_remains_readable_but_does_not_validate_a_recreated_row() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let expected = f.expected();
    let receipt = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, expected.clone())
        .unwrap();
    replace_same_row(&f, "replace");
    let actual = f.service.ledger.lock().unwrap().rounds[&round.id].clone();
    assert!(f
        .store
        .renderer_checkpoint_validate_row(&actual.scope, &actual.row_identity)
        .unwrap_err()
        .contains("ROW_CHANGED"));
    assert_eq!(
        f.service
            .checkpoint_resources(&f.resources, &challenge.nonce, expected)
            .unwrap(),
        receipt
    );
    assert_eq!(f.receipts(), 1);
    assert!(f
        .service
        .issue_resources(&round, &f.resources, Duration::from_secs(10))
        .unwrap_err()
        .contains("ROW_CHANGED"));
}

#[test]
fn actual_sql_receipt_reads_exact_rows_without_creating_floor_or_rewriting_them() {
    let f = Fixture::new();
    let draft = "{ \"text\":\"漢🦀\\r\\n\",\"attachments\":[] }";
    f.store
        .lock_conn()
        .unwrap()
        .execute(
            "INSERT INTO composer_drafts(session_id,draft_json,updated_at) VALUES('A',?1,2)",
            [draft],
        )
        .unwrap();
    f.store
        .lock_conn()
        .unwrap()
        .execute(
            "INSERT INTO session_queues(session_id,queue_json,updated_at) VALUES('A','[]',3)",
            [],
        )
        .unwrap();
    let round = f.round();
    let challenge = f.issue(&round);
    let receipt = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
    assert_eq!(serde_json::to_value(&receipt).unwrap()["qualified"], false);
    assert_eq!(receipt.provider_output, ProviderOutputCheckpoint::Unsealed);
    assert_eq!(receipt.draft_sha256, Some(hash(draft.as_bytes())));
    assert_eq!(receipt.queue_sha256, Some(hash(b"[]")));
    assert_eq!(
        receipt.native_store_instance,
        f.store.native_instance_id().to_string()
    );
    assert_eq!(f.receipts(), 1);
    assert!(f.store.authority_status("A").unwrap().is_none());
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT draft_json FROM composer_drafts WHERE session_id='A'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        draft
    );
    let ledger = f.service.ledger.lock().unwrap();
    assert!(f
        .barrier
        .prove_target_native_idle(&ledger.rounds[&round.id].closed)
        .is_err());
}

#[test]
fn same_nonce_lost_reply_recovers_same_durable_receipt_and_different_payload_conflicts() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let expected = f.expected();
    let first = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, expected.clone())
        .unwrap();
    let second = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, expected.clone())
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(f.receipts(), 1);
    f.service
        .ledger
        .lock()
        .unwrap()
        .entries
        .get_mut(&challenge.nonce)
        .unwrap()
        .expires = Instant::now() - Duration::from_secs(1);
    assert!(
        matches!(f.service.status_resources(&f.resources, &challenge.nonce).unwrap(), NativeCheckpointStatus::Committed { receipt } if *receipt == first)
    );
    let mut changed = expected;
    changed.updated_at += 1;
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, changed)
        .unwrap_err()
        .contains("CONFLICT"));
    assert_eq!(f.receipts(), 1);
}

#[test]
fn incremental_native_transcript_is_read_instead_of_the_stale_full_blob() {
    let f = Fixture::new();
    f.store.lock_conn().unwrap().execute_batch("INSERT INTO session_block_state(session_id,revision,length) VALUES('A',5,1); INSERT INTO session_blocks(session_id,ordinal,block_id,block_json,revision) VALUES('A',0,'b','{\"id\":\"b\",\"role\":\"assistant\",\"text\":\"applied delta\"}',5);").unwrap();
    let round = f.round();
    let challenge = f.issue(&round);
    let receipt = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
    assert_eq!(receipt.revision, 5);
    assert_ne!(receipt.transcript_sha256, hash(b"[]"));
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT blocks_json FROM sessions WHERE id='A'", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "[]"
    );
}

#[test]
fn true_qualification_and_sealed_output_cannot_decode_into_sql_only_receipt() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let receipt = f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
    let mut value = serde_json::to_value(&receipt).unwrap();
    value["qualified"] = serde_json::json!(true);
    assert!(serde_json::from_value::<NativeSqlCheckpointReceipt>(value).is_err());
    let mut value = serde_json::to_value(&receipt).unwrap();
    value["providerOutput"] = serde_json::json!("sealed");
    assert!(serde_json::from_value::<NativeSqlCheckpointReceipt>(value).is_err());
}

#[test]
fn retained_generation_and_fenced_phase_are_checked_from_actual_native_sql() {
    for phase in ["QUIESCING", "FENCED", "HOST", "CACHE"] {
        let f = Fixture::new();
        f.store.lock_conn().unwrap().execute("INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol) VALUES('environment','A',7,?1,'owned-migration',2)", [phase]).unwrap();
        let closed = f.barrier.close_target_admission("A").unwrap();
        let expected_migration = if phase == "QUIESCING" {
            "wrong-migration"
        } else {
            "owned-migration"
        };
        let error = f
            .service
            .start_round(
                closed,
                NativeCheckpointScope::new("environment", "A", expected_migration, 7).unwrap(),
            )
            .unwrap_err();
        assert!(error.message.contains("WRONG_SCOPE"));
        assert_eq!(f.store.authority_status("A").unwrap().unwrap().phase, phase);
        assert_eq!(f.receipts(), 0);
        f.barrier.reopen_target_admission(error.closed).unwrap();
    }
}

#[test]
fn oversized_or_corrupt_native_json_cannot_create_a_checkpoint_receipt() {
    for oversized in [false, true] {
        let f = Fixture::new();
        let raw = if oversized {
            format!("{{\"text\":\"{}\"}}", "x".repeat(32 * 1024 * 1024))
        } else {
            "{broken".into()
        };
        f.store
            .lock_conn()
            .unwrap()
            .execute(
                "INSERT INTO composer_drafts(session_id,draft_json,updated_at) VALUES('A',?1,1)",
                [&raw],
            )
            .unwrap();
        let round = f.round();
        let challenge = f.issue(&round);
        assert!(f
            .service
            .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
            .is_err());
        assert_eq!(f.receipts(), 0);
        assert_eq!(f.store.lock_conn().unwrap().query_row("SELECT length(CAST(draft_json AS BLOB)) FROM composer_drafts WHERE session_id='A'", [], |row| row.get::<_,i64>(0)).unwrap(), raw.len() as i64);
    }
}

#[test]
fn roster_change_cannot_interleave_inside_the_actual_sql_checkpoint_scope() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let expected = f.expected();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(Some(move |context: AuthContext<'_>| {
            if matches!(
                context.action,
                AuthAction::Insert {
                    table_name: "native_renderer_checkpoint_receipts"
                }
            ) {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            Authorization::Allow
        }))
        .unwrap();
    let service = f.service.clone();
    let resources = f.resources.clone();
    let job = std::thread::spawn(move || {
        service.checkpoint_resources(&resources, &challenge.nonce, expected)
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let barrier = f.barrier.clone();
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let roster = std::thread::spawn(move || {
        attempt_tx.send(()).unwrap();
        let result = barrier.admit_window("new-window");
        done_tx.send(result.is_ok()).unwrap();
    });
    attempt_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(done_rx.recv_timeout(Duration::from_millis(20)).is_err());
    release_tx.send(()).unwrap();
    assert!(job.join().unwrap().is_ok());
    done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    roster.join().unwrap();
    assert_eq!(f.receipts(), 1);
    assert!(!f.service.ledger.lock().unwrap().rounds.is_empty());
    let ledger = f.service.ledger.lock().unwrap();
    assert!(f
        .barrier
        .prove_target_native_idle(&ledger.rounds[&round.id].closed)
        .is_err());
}

#[test]
fn actual_reopen_preserves_durable_identity_but_cannot_rebind_old_physical_owner() {
    let temporary = std::env::temp_dir().canonicalize().unwrap();
    let root = temporary.join(format!("bycoda-checkpoint-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("store.db");
    {
        let first = Arc::new(SessionStore::open(path.clone()).unwrap());
        let second = Arc::new(SessionStore::open(path).unwrap());
        assert_eq!(
            first.authority_identity().unwrap(),
            second.authority_identity().unwrap()
        );
        assert_ne!(first.native_instance_id(), second.native_instance_id());
        let barrier = WindowBarrier::new();
        barrier.admit_window("main").unwrap();
        let resources = native_window_lifecycle::test_buffer_resources(&barrier, "main");
        let owner = native_window_lifecycle::capture_checkpoint_resources(
            &resources,
            first.native_instance_id(),
        )
        .unwrap();
        assert!(native_window_lifecycle::with_checkpoint_resources(
            &owner,
            &resources,
            second.native_instance_id(),
            |_, _| Ok(())
        )
        .is_err());
        let binding = CapturedSourceBinding::capture(first.clone(), "environment").unwrap();
        binding
            .with_checked_store(|actual| {
                assert_eq!(actual.native_instance_id(), first.native_instance_id());
                Ok(())
            })
            .unwrap();
    }
    assert_eq!(root.parent(), Some(temporary.as_path()));
    assert!(!std::fs::symlink_metadata(&root)
        .unwrap()
        .file_type()
        .is_symlink());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn wrong_physical_window_and_same_label_other_resource_never_consume_the_challenge() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let other_barrier = WindowBarrier::new();
    other_barrier.admit_window("main").unwrap();
    let foreign = native_window_lifecycle::test_buffer_resources(&other_barrier, "main");
    assert!(f
        .service
        .checkpoint_resources(&foreign, &challenge.nonce, f.expected())
        .unwrap_err()
        .contains("WINDOW_CHANGED"));
    assert_eq!(f.receipts(), 0);
    f.service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
}

#[test]
fn native_reload_invalidates_exact_old_incarnation_and_round() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    native_window_lifecycle::test_reload_buffer_resources(&f.resources);
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .is_err());
    assert!(f
        .service
        .status_resources(&f.resources, &challenge.nonce)
        .is_err());
    assert_eq!(f.receipts(), 0);
}

#[test]
fn deadline_and_unknown_nonce_do_not_create_checkpoint_work() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    f.service
        .ledger
        .lock()
        .unwrap()
        .entries
        .get_mut(&challenge.nonce)
        .unwrap()
        .expires = Instant::now() - Duration::from_secs(1);
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap_err()
        .contains("EXPIRED"));
    assert!(matches!(
        f.service
            .status_resources(&f.resources, &challenge.nonce)
            .unwrap(),
        NativeCheckpointStatus::Expired
    ));
    assert!(matches!(
        f.service
            .status_resources(&f.resources, &uuid::Uuid::new_v4().to_string())
            .unwrap(),
        NativeCheckpointStatus::Unknown
    ));
    assert!(f
        .service
        .status_resources(&f.resources, "renderer nonce")
        .is_err());
    assert_eq!(f.receipts(), 0);
}

#[test]
fn scope_rejection_returns_exact_closed_token_and_preserves_other_session_work() {
    let f = Fixture::new();
    let closed = f.barrier.close_target_admission("A").unwrap();
    let error = f
        .service
        .start_round(
            closed,
            NativeCheckpointScope::new("environment", "B", "migration", 0).unwrap(),
        )
        .unwrap_err();
    assert!(error.message.contains("WRONG_SCOPE"));
    f.barrier.reopen_target_admission(error.closed).unwrap();
    let round = f.round();
    let owner = native_window_lifecycle::capture_checkpoint_resources(
        &f.resources,
        f.store.native_instance_id(),
    )
    .unwrap();
    native_window_lifecycle::with_checkpoint_resources(
        &owner,
        &f.resources,
        f.store.native_instance_id(),
        |barrier, token| {
            let operation = barrier
                .begin_session_write(token, "B", NativeLane::Persistence)
                .map_err(|error| error.to_string())?;
            f.store
                .lock_conn()?
                .execute("UPDATE sessions SET title='B survives' WHERE id='B'", [])
                .map_err(|error| error.to_string())?;
            operation
                .finish(Ok::<_, String>(()))
                .map_err(|error| error.to_string())
        },
    )
    .unwrap();
    let challenge = f.issue(&round);
    f.service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT title FROM sessions WHERE id='B'", [], |row| row
                .get::<_, String>(
                0
            ))
            .unwrap(),
        "B survives"
    );
}

#[test]
fn already_admitted_native_write_must_settle_before_checkpoint_admission() {
    let f = Fixture::new();
    let owner = native_window_lifecycle::capture_checkpoint_resources(
        &f.resources,
        f.store.native_instance_id(),
    )
    .unwrap();
    let prior = native_window_lifecycle::with_checkpoint_resources(
        &owner,
        &f.resources,
        f.store.native_instance_id(),
        |barrier, token| {
            barrier
                .begin_session_write(token, "A", NativeLane::Persistence)
                .map_err(|error| error.to_string())
        },
    )
    .unwrap();
    let round = f.round();
    let challenge = f.issue(&round);
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap_err()
        .contains("PendingNativeOperations"));
    prior.finish(Ok::<_, String>(())).unwrap();
    f.service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
}

#[test]
fn mismatched_native_sql_rows_rollback_receipt_and_nonce_cannot_be_replayed() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let correct = f.expected();
    let mut wrong = correct.clone();
    wrong.draft = ExpectedSqlBlob::Present {
        sha256: hash(b"not present"),
    };
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, wrong)
        .unwrap_err()
        .contains("CONFLICT"));
    assert_eq!(f.receipts(), 0);
    assert!(matches!(
        f.service
            .status_resources(&f.resources, &challenge.nonce)
            .unwrap(),
        NativeCheckpointStatus::Failed
    ));
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, correct)
        .unwrap_err()
        .contains("CONFLICT"));
    let closed = f.service.retire_round(&round).unwrap();
    f.barrier.reopen_target_admission(closed).unwrap();
    assert!(f.barrier.admit_window("ordinary").is_ok());
}

#[test]
fn sql_checkpoint_is_full_durable_and_immutable_with_normal_sync_restored() {
    let f = Fixture::new();
    let before: i64 = f
        .store
        .lock_conn()
        .unwrap()
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .unwrap();
    f.store.lock_conn().unwrap().execute_batch("CREATE TABLE checkpoint_sync_probe(value INTEGER); CREATE TRIGGER checkpoint_sync BEFORE INSERT ON native_renderer_checkpoint_receipts BEGIN INSERT INTO checkpoint_sync_probe SELECT synchronous FROM pragma_synchronous; END;").unwrap();
    let round = f.round();
    let challenge = f.issue(&round);
    f.service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .unwrap();
    let conn = f.store.lock_conn().unwrap();
    assert_eq!(
        conn.query_row("SELECT value FROM checkpoint_sync_probe", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        conn.pragma_query_value(None, "synchronous", |row| row.get::<_, i64>(0))
            .unwrap(),
        before
    );
    assert!(conn
        .execute(
            "UPDATE native_renderer_checkpoint_receipts SET receipt_json='{}'",
            []
        )
        .is_err());
    assert!(conn
        .execute("DELETE FROM native_renderer_checkpoint_receipts", [])
        .is_err());
}

#[test]
fn failed_commit_rolls_back_without_altering_native_payloads() {
    let f = Fixture::new();
    f.store.lock_conn().unwrap().execute_batch("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON native_renderer_checkpoint_receipts BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    let round = f.round();
    let challenge = f.issue(&round);
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .is_err());
    assert_eq!(f.receipts(), 0);
    assert_eq!(f.expected().transcript_sha256, hash(b"[]"));
    assert!(matches!(
        f.service
            .status_resources(&f.resources, &challenge.nonce)
            .unwrap(),
        NativeCheckpointStatus::Failed
    ));
}

#[test]
fn error_after_actual_commit_recovers_durable_outcome_without_second_checkpoint() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let expected = f.expected();
    let inserted = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let probe = inserted.clone();
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(Some(move |context: AuthContext<'_>| {
            match context.action {
                AuthAction::Insert {
                    table_name: "native_renderer_checkpoint_receipts",
                } => {
                    probe.store(true, Ordering::Release);
                }
                AuthAction::Pragma {
                    pragma_name,
                    pragma_value: Some(_),
                } if pragma_name == "synchronous" && probe.load(Ordering::Acquire) => {
                    return Authorization::Deny;
                }
                _ => {}
            }
            Authorization::Allow
        }))
        .unwrap();
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, expected)
        .is_err());
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    assert!(inserted.load(Ordering::Acquire));
    assert_eq!(f.receipts(), 1);
    assert!(matches!(
        f.service
            .status_resources(&f.resources, &challenge.nonce)
            .unwrap(),
        NativeCheckpointStatus::Committed { .. }
    ));
    assert_eq!(f.receipts(), 1);
}

#[test]
fn shutdown_during_actual_sql_retains_admitted_work_until_settlement() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let expected = f.expected();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(Some(move |context: AuthContext<'_>| {
            if matches!(
                context.action,
                AuthAction::Insert {
                    table_name: "native_renderer_checkpoint_receipts"
                }
            ) {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            Authorization::Allow
        }))
        .unwrap();
    let service = f.service.clone();
    let resources = f.resources.clone();
    let nonce = challenge.nonce.clone();
    let job =
        std::thread::spawn(move || service.checkpoint_resources(&resources, &nonce, expected));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    f.service.shutdown();
    assert_eq!(f.service.calls.load(Ordering::Acquire), 1);
    assert!(matches!(f.service.retire_round(&round), Err(error) if error.contains("PENDING")));
    release_tx.send(()).unwrap();
    let receipt = job.join().unwrap().unwrap();
    assert_eq!(receipt.provider_output, ProviderOutputCheckpoint::Unsealed);
    assert_eq!(f.service.calls.load(Ordering::Acquire), 0);
    assert_eq!(f.receipts(), 1);
}

#[test]
fn native_identity_change_and_wrong_generation_reject_before_any_receipt() {
    let f = Fixture::new();
    let closed = f.barrier.close_target_admission("A").unwrap();
    let error = f
        .service
        .start_round(
            closed,
            NativeCheckpointScope::new("environment", "A", "migration", 1).unwrap(),
        )
        .unwrap_err();
    f.barrier.reopen_target_admission(error.closed).unwrap();
    let round = f.round();
    let challenge = f.issue(&round);
    // Deliberately corrupt the identity below the production immutability gate.
    // Only this fixture bypasses the guard; the original reader must still reject.
    f.store
        .lock_conn()
        .unwrap()
        .execute_batch(
            "DROP TRIGGER native_raw_identity_immutable;
             UPDATE native_authority_identity SET source_profile_id='changed'",
        )
        .unwrap();
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, f.expected())
        .is_err());
    assert_eq!(f.receipts(), 0);
}

#[test]
fn bounded_challenges_calls_and_round_retirement_do_not_silently_reopen_gates() {
    let f = Fixture::new();
    let round = f.round();
    assert!(f
        .service
        .issue_resources(&round, &f.resources, Duration::ZERO)
        .is_err());
    assert!(f
        .service
        .issue_resources(&round, &f.resources, Duration::from_secs(31))
        .is_err());
    for _ in 0..MAX_CHALLENGES {
        f.issue(&round);
    }
    assert!(f
        .service
        .issue_resources(&round, &f.resources, Duration::from_secs(1))
        .unwrap_err()
        .contains("CAPACITY"));
    let permits = (0..8)
        .map(|_| f.service.admit_call().unwrap())
        .collect::<Vec<_>>();
    assert!(f.service.admit_call().is_err());
    drop(permits);
    assert!(f.service.admit_call().is_ok());
    let closed = f.service.retire_round(&round).unwrap();
    assert!(f.barrier.close_target_admission("A").is_err());
    f.barrier.reopen_target_admission(closed).unwrap();
    assert!(f.barrier.close_target_admission("A").is_ok());
}

#[test]
fn session_revisions_raw_emptiness_and_tampered_sql_receipts_are_not_inferred() {
    let f = Fixture::new();
    let round = f.round();
    let challenge = f.issue(&round);
    let expected = f.expected();
    f.store
        .lock_conn()
        .unwrap()
        .execute(
            "INSERT INTO session_queues(session_id,queue_json,updated_at) VALUES('A','[]',1)",
            [],
        )
        .unwrap();
    assert!(f
        .service
        .checkpoint_resources(&f.resources, &challenge.nonce, expected)
        .unwrap_err()
        .contains("CONFLICT"));
    assert_eq!(f.receipts(), 0);
    // A fresh isolated round tests retained-receipt corruption independently of
    // the first deliberately failed Native checkpoint's qualification taint.
    let g = Fixture::new();
    let round = g.round();
    let challenge = g.issue(&round);
    g.service
        .checkpoint_resources(&g.resources, &challenge.nonce, g.expected())
        .unwrap();
    g.store
        .lock_conn()
        .unwrap()
        .execute_batch("DROP TRIGGER native_renderer_checkpoint_no_update")
        .unwrap();
    g.store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE native_renderer_checkpoint_receipts SET payload_digest=?1",
            ["a".repeat(64)],
        )
        .unwrap();
    assert!(g
        .service
        .status_resources(&g.resources, &challenge.nonce)
        .is_err());
    for blob in [false, true] {
        if blob {
            g.store.lock_conn().unwrap().execute("UPDATE native_renderer_checkpoint_receipts SET payload_digest=zeroblob(1048576)", []).unwrap();
        } else {
            g.store
                .lock_conn()
                .unwrap()
                .execute(
                    "UPDATE native_renderer_checkpoint_receipts SET payload_digest=?1",
                    ["x".repeat(1048576)],
                )
                .unwrap();
        }
        assert!(g
            .service
            .status_resources(&g.resources, &challenge.nonce)
            .is_err());
        assert_eq!(g.receipts(), 1);
    }
}
