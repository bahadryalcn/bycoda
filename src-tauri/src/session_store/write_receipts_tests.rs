use super::*;
use crate::native_window_lifecycle as windows;
use crate::session_store::window_barrier::WindowBarrier;
use tauri::ResourceTable;

struct Fixture {
    store: SessionStore,
    resources: ResourceTable,
}
impl Fixture {
    fn new() -> Self {
        Self::with_store(SessionStore::open_in_memory().unwrap())
    }
    fn with_store(store: SessionStore) -> Self {
        let barrier = WindowBarrier::new();
        barrier.admit_window("main").unwrap();
        let resources = windows::test_buffer_resources(&barrier, "main");
        Self { store, resources }
    }
    fn owner(&self) -> Arc<NativeCheckpointWindow> {
        Arc::new(
            windows::capture_checkpoint_resources(&self.resources, self.store.native_instance_id())
                .unwrap(),
        )
    }
    fn put(&self, s: &SessionUpsert, enabled: bool) -> NativeWriteAck<SessionSummary> {
        let owner = enabled.then(|| self.owner());
        let conn = self.store.lock_conn().unwrap();
        upsert(
            &self.store,
            &conn,
            s,
            Default::default(),
            None,
            None,
            None,
            owner,
        )
        .unwrap()
        .unwrap()
    }
    fn matches(&self, input: &WriteInput<'_>, id: &str, ack: AckStamp) -> bool {
        let owner = self.owner();
        windows::with_checked_checkpoint_resources(
            &owner,
            &self.resources,
            self.store.native_instance_id(),
            |_, _, checked| {
                let connection = self.store.lock_conn()?;
                let conn = connection
                    .unchecked_transaction()
                    .map_err(|e| e.to_string())?;
                Ok(self
                    .store
                    .compare_output_write_at(&conn, &checked, input, id, ack)
                    .is_some())
            },
        )
        .unwrap()
    }
    fn commit_claim<T>(
        &self,
        claim: &NativeProjectionWriteClaim,
        consume: impl FnOnce(
            &authority::CheckedStoreTransaction<'_>,
            &NativeWriteComparison<'_>,
        ) -> Result<T, String>,
    ) -> Result<(T, NativeProjectionWriteComparison), String> {
        let owner = self.owner();
        windows::with_checked_checkpoint_resources(
            &owner,
            &self.resources,
            self.store.native_instance_id(),
            |_, _, checked| {
                self.store
                    .commit_projection_write_comparison(&checked, claim, consume)
            },
        )
    }
}
fn session(id: &str) -> SessionUpsert {
    serde_json::from_value(
        json!({"id":id,"cwd":"/isolated","harness":"codex","model":"fixture",
        "modelSettings":{},"runtimeMode":"approve","title":"Receipt fixture",
        "blocks":[{"id":"block","role":"assistant","text":"native λ\n東京"}]}),
    )
    .unwrap()
}
fn input(s: &SessionUpsert) -> WriteInput<'_> {
    WriteInput::Replace {
        session: s,
        expected_updated_at: None,
        expected_revision: None,
        expect_missing: None,
    }
}
fn stamp(ack: &NativeWriteAck<SessionSummary>) -> AckStamp {
    AckStamp {
        updated_at: ack.ack.updated_at,
        revision: ack.ack.transcript_revision.unwrap(),
    }
}

fn projection_wire(s: &SessionUpsert, ack: &NativeWriteAck<SessionSummary>) -> Value {
    json!({"version":1,"kind":"session-output-full-candidate-comparison","qualified":false,
        "fullCheckpoint":false,"applicationThrough":null,"nativeCommitmentRequired":true,
        "sessionId":s.id,"modelVersion":1,"command":"session_upsert",
        "admittedPayload":{"session":s,"captureOutputReceipt":true},
        "acknowledgement":{"kind":"replace","revision":stamp(ack).revision,"updatedAt":ack.ack.updated_at,"nativeWriteId":ack.native_write_id},
        // Deliberately untrusted locator. These writer-only tests do not claim
        // Native input eligibility; Root's input resolver must validate all items.
        "items":[{"writerOnlyUntrustedFixture":true}]})
}
fn claim(wire: &Value) -> NativeProjectionWriteClaim {
    NativeProjectionWriteClaim::parse(&serde_json::to_string(wire).unwrap()).unwrap()
}
fn nonce_table(f: &Fixture) {
    f.store
        .lock_conn()
        .unwrap()
        .execute_batch("CREATE TABLE projection_join_fixture_nonce(id TEXT PRIMARY KEY)")
        .unwrap();
}
fn nonce_count(f: &Fixture) -> i64 {
    f.store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM projection_join_fixture_nonce",
            [],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn projection_claim_closed_schema_flags_scope_and_limits_are_comparison_only() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let wire = projection_wire(&s, &ack);
    let parsed = claim(&wire);
    assert_eq!(parsed.session_id(), "A");
    assert_eq!(parsed.model_version(), 1);
    assert_eq!(parsed.items(), wire["items"].as_array().unwrap());
    assert_eq!(input_digest(&parsed.input()), input_digest(&input(&s)));
    for (pointer, value) in [
        ("/version", json!(2)),
        ("/kind", json!("other")),
        ("/qualified", json!(true)),
        ("/fullCheckpoint", json!(true)),
        ("/applicationThrough", json!(0)),
        ("/nativeCommitmentRequired", json!(false)),
        ("/modelVersion", json!(0)),
        ("/modelVersion", json!(MAX_SAFE + 1)),
        ("/sessionId", json!("other")),
        ("/command", json!("session_get")),
        ("/admittedPayload/captureOutputReceipt", json!(false)),
        ("/acknowledgement/kind", json!("delta")),
        ("/acknowledgement/revision", json!(0)),
        ("/acknowledgement/updatedAt", json!(-1)),
        ("/acknowledgement/nativeWriteId", json!("bad")),
        ("/items", json!([])),
        (
            "/items",
            json!(vec![Value::Null; MAX_PROJECTION_ORIGINS + 1]),
        ),
    ] {
        let mut changed = wire.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            NativeProjectionWriteClaim::parse(&changed.to_string()).is_err(),
            "{pointer}"
        );
    }
    for pointer in [
        "",
        "/admittedPayload",
        "/admittedPayload/session",
        "/acknowledgement",
    ] {
        let mut changed = wire.clone();
        changed
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(true));
        assert!(
            NativeProjectionWriteClaim::parse(&changed.to_string()).is_err(),
            "{pointer}"
        );
    }
    for key in [
        "qualified",
        "fullCheckpoint",
        "applicationThrough",
        "nativeCommitmentRequired",
    ] {
        let mut changed = wire.clone();
        changed.as_object_mut().unwrap().remove(key);
        assert!(
            NativeProjectionWriteClaim::parse(&changed.to_string()).is_err(),
            "missing {key}"
        );
    }
    assert!(NativeProjectionWriteClaim::parse(&"x".repeat(MAX_BYTES + 1)).is_err());
    let duplicate = wire.to_string().replacen("{", "{\"version\":1,", 1);
    assert!(NativeProjectionWriteClaim::parse(&duplicate).is_err());
}

#[test]
fn projection_claim_uses_original_cas_defaults_and_actual_rust_normalization() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let conn = f.store.lock_conn().unwrap();
    let ack = upsert(
        &f.store,
        &conn,
        &s,
        Default::default(),
        Some(old.ack.updated_at),
        old.ack.transcript_revision,
        Some(false),
        Some(f.owner()),
    )
    .unwrap()
    .unwrap();
    drop(conn);
    let mut wire = projection_wire(&s, &ack);
    wire["admittedPayload"]["expectedUpdatedAt"] = json!(old.ack.updated_at);
    wire["admittedPayload"]["expectedRevision"] = json!(old.ack.transcript_revision);
    wire["admittedPayload"]["expectMissing"] = json!(false);
    let parsed = claim(&wire);
    let (_, committed) = f.commit_claim(&parsed, |_, _| Ok(())).unwrap();
    assert_eq!(
        committed.native_write_id(),
        ack.native_write_id.as_deref().unwrap()
    );
    // Omitting default session fields gives exactly the Native typed input,
    // independent of renderer JSON field insertion/omission conventions.
    let mut sparse = wire.clone();
    let object = sparse["admittedPayload"]["session"]
        .as_object_mut()
        .unwrap();
    object.retain(|_, v| !v.is_null());
    object.remove("worktreeRemoved");
    assert_eq!(
        input_digest(&claim(&sparse).input()),
        input_digest(&parsed.input())
    );
    for key in ["expectedUpdatedAt", "expectedRevision", "expectMissing"] {
        let mut changed = wire.clone();
        changed["admittedPayload"]
            .as_object_mut()
            .unwrap()
            .remove(key);
        let parsed = claim(&changed);
        assert!(f.commit_claim(&parsed, |_, _| Ok(())).is_err(), "{key}");
    }
}

#[test]
fn projection_full_transaction_returns_owned_commitment_after_actual_commit_and_restoration() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let parsed = claim(&projection_wire(&s, &ack));
    nonce_table(&f);
    f.store
        .lock_conn()
        .unwrap()
        .pragma_update(None, "synchronous", "NORMAL")
        .unwrap();
    let (value, committed) = f
        .commit_claim(&parsed, |tx, comparison| {
            assert!(tx.is_for(&f.store));
            assert_eq!(tx.native_instance_id(), f.store.native_instance_id());
            let sync: i64 = tx
                .connection()
                .pragma_query_value(None, "synchronous", |r| r.get(0))
                .unwrap();
            assert_eq!(sync, 2);
            assert_eq!(
                comparison.native_write_id(),
                ack.native_write_id.as_deref().unwrap()
            );
            tx.connection()
                .execute(
                    "INSERT INTO projection_join_fixture_nonce VALUES('actual-full')",
                    [],
                )
                .unwrap();
            Ok(17)
        })
        .unwrap();
    assert_eq!(value, 17);
    assert_eq!(nonce_count(&f), 1);
    assert_eq!(committed.session_id(), "A");
    assert_eq!(committed.model_version(), 1);
    assert_eq!(committed.ack(), stamp(&ack));
    assert_eq!(committed.native_instance_id(), f.store.native_instance_id());
    assert_eq!(committed.input_digest(), input_digest(&input(&s)).unwrap());
    let (store_id, profile_id) = source_identity(&f.store.lock_conn().unwrap()).unwrap();
    assert_eq!(committed.source_store_id(), store_id);
    assert_eq!(committed.source_profile_id(), profile_id);
    assert_ne!(committed.sql_digest(), [0; 32]);
    assert_ne!(committed.transcript_digest(), [0; 32]);
    let sync: i64 = f
        .store
        .lock_conn()
        .unwrap()
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .unwrap();
    assert_eq!(sync, 1);
}

#[test]
fn projection_delta_normalizes_original_production_command_and_actual_ack() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let delta = incremental::SessionDelta {
        session: s.clone(),
        expected_updated_at: old.ack.updated_at,
        expected_revision: stamp(&old).revision,
        length: 1,
        changes: vec![incremental::BlockChange {
            index: 0,
            block: json!({"id":"block","role":"assistant","text":"delta"}),
        }],
    };
    let conn = f.store.lock_conn().unwrap();
    let ack = apply_delta(&f.store, &conn, &delta, Some(f.owner()))
        .unwrap()
        .unwrap();
    drop(conn);
    let mut wire = projection_wire(&s, &old);
    wire["command"] = json!("session_apply_delta");
    wire["admittedPayload"] = json!({"delta":delta,"captureOutputReceipt":true});
    wire["acknowledgement"] = json!({"kind":"delta","revision":ack.ack.revision,"updatedAt":ack.ack.updated_at,"nativeWriteId":ack.native_write_id});
    let (_, committed) = f.commit_claim(&claim(&wire), |_, _| Ok(())).unwrap();
    assert_eq!(
        committed.native_write_id(),
        ack.native_write_id.as_deref().unwrap()
    );
    for pointer in ["/admittedPayload/delta", "/admittedPayload/delta/changes/0"] {
        let mut changed = wire.clone();
        changed
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(1));
        assert!(NativeProjectionWriteClaim::parse(&changed.to_string()).is_err());
    }
    let mut changed = wire;
    changed["admittedPayload"]["delta"]["expectedRevision"] = json!(0);
    assert!(f.commit_claim(&claim(&changed), |_, _| Ok(())).is_err());
}

#[test]
fn projection_consumer_failure_and_late_target_mutation_rollback_whole_transaction() {
    for changed_target in [false, true] {
        let f = Fixture::new();
        let s = session("A");
        let ack = f.put(&s, true);
        let parsed = claim(&projection_wire(&s, &ack));
        nonce_table(&f);
        let result = f.commit_claim(&parsed, |tx, _| {
            tx.connection()
                .execute(
                    "INSERT INTO projection_join_fixture_nonce VALUES('rollback')",
                    [],
                )
                .unwrap();
            if changed_target {
                tx.connection()
                    .execute("UPDATE sessions SET title='late mutation' WHERE id='A'", [])
                    .unwrap();
                Ok(())
            } else {
                Err("actual input resolver rejected".into())
            }
        });
        assert!(result.is_err());
        assert_eq!(nonce_count(&f), 0);
        assert!(f.matches(
            &input(&s),
            ack.native_write_id.as_deref().unwrap(),
            stamp(&ack)
        ));
    }
}

#[test]
fn projection_failed_commit_never_returns_owned_comparison_or_nonce_effect() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let parsed = claim(&projection_wire(&s, &ack));
    nonce_table(&f);
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    let result = f.commit_claim(&parsed, |tx, _| {
        tx.connection()
            .execute(
                "INSERT INTO projection_join_fixture_nonce VALUES('uncommitted')",
                [],
            )
            .unwrap();
        Ok(())
    });
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert!(result.is_err());
    assert_eq!(nonce_count(&f), 0);
    assert!(f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
}

#[test]
fn projection_restore_failure_withholds_owned_comparison_even_when_actual_commit_landed() {
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let parsed = claim(&projection_wire(&s, &ack));
    nonce_table(&f);
    let conn = f.store.lock_conn().unwrap();
    conn.pragma_update(None, "synchronous", "NORMAL").unwrap();
    conn.authorizer(Some(|context: AuthContext<'_>| {
        if matches!(
            context.action,
            AuthAction::Pragma {
                pragma_name: "synchronous",
                pragma_value: Some("1")
            }
        ) {
            Authorization::Deny
        } else {
            Authorization::Allow
        }
    }))
    .unwrap();
    drop(conn);
    let result = f.commit_claim(&parsed, |tx, _| {
        tx.connection()
            .execute(
                "INSERT INTO projection_join_fixture_nonce VALUES('committed-but-unconfirmed')",
                [],
            )
            .unwrap();
        Ok(())
    });
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    assert!(result.is_err());
    assert_eq!(nonce_count(&f), 1);
    assert!(f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
}

#[test]
fn projection_bad_locator_changed_request_and_superseded_write_never_run_consumer() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let wire = projection_wire(&s, &ack);
    nonce_table(&f);
    for (pointer, value) in [
        (
            "/acknowledgement/nativeWriteId",
            json!(uuid::Uuid::new_v4().to_string()),
        ),
        ("/admittedPayload/session/title", json!("changed request")),
        ("/acknowledgement/revision", json!(99)),
    ] {
        let mut changed = wire.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(f
            .commit_claim(&claim(&changed), |_, _| -> Result<(), String> {
                panic!("comparison rejected before consumer")
            })
            .is_err());
    }
    let parsed = claim(&wire);
    f.put(&s, false);
    assert!(f
        .commit_claim(&parsed, |_, _| -> Result<(), String> {
            panic!("superseded before consumer")
        })
        .is_err());
    assert_eq!(nonce_count(&f), 0);
}

#[test]
fn projection_same_label_foreign_owner_and_reload_cannot_join_original_write() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let parsed = claim(&projection_wire(&s, &ack));
    let barrier = WindowBarrier::new();
    barrier.admit_window("main").unwrap();
    let resources = windows::test_buffer_resources(&barrier, "main");
    let owner =
        windows::capture_checkpoint_resources(&resources, f.store.native_instance_id()).unwrap();
    let result = windows::with_checked_checkpoint_resources(
        &owner,
        &resources,
        f.store.native_instance_id(),
        |_, _, checked| {
            f.store.commit_projection_write_comparison(
                &checked,
                &parsed,
                |_, _| -> Result<(), String> { panic!("wrong owner") },
            )
        },
    );
    assert!(result.is_err());
    windows::test_reload_buffer_resources(&f.resources);
    assert!(f
        .commit_claim(&parsed, |_, _| -> Result<(), String> {
            panic!("reloaded owner")
        })
        .is_err());
}

#[test]
fn exact_sql_row_revision_metadata_cannot_change_under_a_content_only_match() {
    let f = Fixture::new();
    let s = session("A");
    f.put(&s, false);
    let ack = f.put(&s, true);
    let conn = f.store.lock_conn().unwrap();
    let block_revision: i64 = conn
        .query_row(
            "SELECT revision FROM session_blocks WHERE session_id='A'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(block_revision < stamp(&ack).revision);
    drop(conn);
    assert!(f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
    f.store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE session_blocks SET revision=?1 WHERE session_id='A'",
            [stamp(&ack).revision],
        )
        .unwrap();
    assert!(!f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
}

#[test]
fn reopened_actual_profile_retains_sql_but_never_invents_lost_process_receipt() {
    let root = std::env::temp_dir().canonicalize().unwrap();
    let directory = root.join(format!(
        "bycoda-native-write-receipts-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("sessions.sqlite");
    let s = session("reopened");
    let (id, ack, instance) = {
        let f = Fixture::with_store(SessionStore::open(path.clone()).unwrap());
        let result = f.put(&s, true);
        (
            result.native_write_id.clone().unwrap(),
            stamp(&result),
            f.store.native_instance_id(),
        )
    };
    {
        let f = Fixture::with_store(SessionStore::open(path).unwrap());
        assert_ne!(f.store.native_instance_id(), instance);
        let count: i64 = f
            .store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM session_blocks WHERE session_id='reopened'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(!f.matches(&input(&s), &id, ack));
        assert!(f
            .store
            .output_write_receipts
            .lock()
            .unwrap()
            .entries
            .is_empty());
    }
    assert_eq!(directory.parent(), Some(root.as_path()));
    assert!(directory
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("bycoda-native-write-receipts-"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
#[ignore = "Explicit bounded Native/JS ABI fixture; no GUI, provider or live profile"]
fn emit_native_write_receipt_fixture() {
    let f = Fixture::new();
    let s = session("native-receipt-fixture");
    let replace = f.put(&s, true);
    let replace_matches = f.matches(
        &input(&s),
        replace.native_write_id.as_deref().unwrap(),
        stamp(&replace),
    );
    let bad_locator_matches = f.matches(
        &input(&s),
        &uuid::Uuid::new_v4().to_string(),
        stamp(&replace),
    );
    let mut delta_session = s.clone();
    delta_session.blocks = json!([]);
    let delta = incremental::SessionDelta {
        session: delta_session,
        expected_updated_at: replace.ack.updated_at,
        expected_revision: replace.ack.transcript_revision.unwrap(),
        length: 1,
        changes: vec![incremental::BlockChange {
            index: 0,
            block: json!({"id":"block","role":"assistant","text":"Native committed Δ / 東京\nsecond"}),
        }],
    };
    let conn = f.store.lock_conn().unwrap();
    let delta_ack = apply_delta(&f.store, &conn, &delta, Some(f.owner()))
        .unwrap()
        .unwrap();
    let (source_store_id, source_profile_id) = source_identity(&conn).unwrap();
    drop(conn);
    let delta_matches = f.matches(
        &WriteInput::Delta { delta: &delta },
        delta_ack.native_write_id.as_deref().unwrap(),
        AckStamp {
            updated_at: delta_ack.ack.updated_at,
            revision: delta_ack.ack.revision,
        },
    );
    let replaced_locator_matches = f.matches(
        &input(&s),
        replace.native_write_id.as_deref().unwrap(),
        stamp(&replace),
    );
    assert!(replace_matches && delta_matches);
    assert!(!bad_locator_matches && !replaced_locator_matches);
    let result = json!({"version":1,"qualified":false,"comparisonOnly":true,
        "scope":{"sessionId":s.id,"sourceStoreId":source_store_id,"sourceProfileId":source_profile_id},
        "replace":{"admittedPayload":{"session":s,"expectedUpdatedAt":null,"expectedRevision":null,"expectMissing":null,"captureOutputReceipt":true},
            "ack":replace,"comparisonMatches":replace_matches},
        "delta":{"admittedPayload":{"delta":delta,"captureOutputReceipt":true},"ack":delta_ack,"comparisonMatches":delta_matches},
        "badLocatorMatches":bad_locator_matches,"replacedLocatorMatches":replaced_locator_matches});
    let raw = serde_json::to_string(&result).unwrap();
    assert!(raw.len() <= 8192);
    println!("NATIVE_WRITE_RECEIPT_FIXTURE\n{raw}");
}

#[test]
fn empty_full_and_empty_noop_delta_are_real_receipted_writes() {
    let f = Fixture::new();
    let mut s = session("empty");
    s.blocks = json!([]);
    let ack = f.put(&s, true);
    assert!(f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
    let delta = incremental::SessionDelta {
        session: s,
        expected_updated_at: ack.ack.updated_at,
        expected_revision: ack.ack.transcript_revision.unwrap(),
        length: 0,
        changes: vec![],
    };
    let conn = f.store.lock_conn().unwrap();
    let next = apply_delta(&f.store, &conn, &delta, Some(f.owner()))
        .unwrap()
        .unwrap();
    drop(conn);
    assert_eq!(next.ack.updated_at, ack.ack.updated_at);
    assert!(next.ack.revision > stamp(&ack).revision);
    assert!(f.matches(
        &WriteInput::Delta { delta: &delta },
        next.native_write_id.as_deref().unwrap(),
        AckStamp {
            updated_at: next.ack.updated_at,
            revision: next.ack.revision
        }
    ));
}

#[test]
fn optional_observation_failure_does_not_fail_the_actual_sql_write() {
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    let f = Fixture::new();
    let mut s = session("A");
    let old = f.put(&s, true);
    let conn = f.store.lock_conn().unwrap();
    conn.authorizer(Some(|context: AuthContext<'_>| {
        if matches!(
            context.action,
            AuthAction::Read {
                table_name: "native_authority_identity",
                ..
            }
        ) {
            Authorization::Deny
        } else {
            Authorization::Allow
        }
    }))
    .unwrap();
    s.title = "write succeeds although optional identity query denied".into();
    let ack = upsert(
        &f.store,
        &conn,
        &s,
        Default::default(),
        None,
        None,
        None,
        Some(f.owner()),
    )
    .unwrap()
    .unwrap();
    assert!(ack.native_write_id.is_none());
    let title: String = conn
        .query_row("SELECT title FROM sessions WHERE id='A'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, s.title);
    conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    drop(conn);
    assert!(!f.matches(
        &input(&session("A")),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
}

#[test]
fn comparison_requires_actual_snapshot_and_original_connection_even_for_same_store_argument() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let id = ack.native_write_id.as_deref().unwrap();
    let owner = f.owner();
    windows::with_checked_checkpoint_resources(
        &owner,
        &f.resources,
        f.store.native_instance_id(),
        |_, _, checked| {
            let conn = f.store.lock_conn()?;
            assert!(f
                .store
                .compare_output_write_at(&conn, &checked, &input(&s), id, stamp(&ack))
                .is_none());
            let foreign = Connection::open_in_memory().unwrap();
            let foreign = foreign.unchecked_transaction().unwrap();
            assert!(f
                .store
                .compare_output_write_at(&foreign, &checked, &input(&s), id, stamp(&ack))
                .is_none());
            Ok(())
        },
    )
    .unwrap();
    assert!(f.matches(&input(&s), id, stamp(&ack)));
}

#[test]
fn unknown_corrupt_identity_and_oversize_sql_ancillary_fields_never_gain_receipts() {
    for corruption in [
        "UPDATE native_authority_identity SET source_store_id=CAST(zeroblob(2097153) AS TEXT)",
        "PRAGMA ignore_check_constraints=ON; UPDATE native_session_row_identity SET incarnation=zeroblob(2097153)",
        "ALTER TABLE sessions ADD COLUMN unsupported_metadata TEXT; UPDATE sessions SET unsupported_metadata=CAST(zeroblob(2097153) AS TEXT)",
    ] {
        let f=Fixture::new(); let s=session("A"); f.put(&s,false);
        let conn = f.store.lock_conn().unwrap();
        if corruption.starts_with("UPDATE native_authority_identity ") {
            // Deliberate corrupt-identity fixture, not a production write path.
            conn.execute_batch("DROP TRIGGER native_raw_identity_immutable")
                .unwrap();
        }
        conn.execute_batch(corruption).unwrap();
        drop(conn);
        let ack=f.put(&s,true); assert!(ack.native_write_id.is_none(),"{corruption}");
        assert!(ack.ack.transcript_revision.is_some());
    }
}

#[test]
fn optional_ledger_poison_keeps_ordinary_save_operational_and_comparison_unknown() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = f.store.output_write_receipts.lock().unwrap();
        panic!("fixture poison");
    }));
    let ack = f.put(&s, true);
    assert!(ack.native_write_id.is_none());
    assert!(ack.ack.transcript_revision.unwrap() > stamp(&old).revision);
    assert!(!f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
}

#[test]
fn actual_delta_failure_has_no_new_receipt_or_partial_transcript() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let delta = incremental::SessionDelta {
        session: s.clone(),
        expected_updated_at: old.ack.updated_at,
        expected_revision: old.ack.transcript_revision.unwrap(),
        length: 2,
        changes: vec![],
    };
    let conn = f.store.lock_conn().unwrap();
    assert!(apply_delta(&f.store, &conn, &delta, Some(f.owner())).is_err());
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM session_blocks WHERE session_id='A'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    drop(conn);
    assert!(!f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
}

#[test]
fn actual_full_writer_commits_typed_input_and_exact_native_sql_transcript() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let id = ack.native_write_id.as_deref().unwrap();
    let uuid = uuid::Uuid::parse_str(id).unwrap();
    assert_eq!(uuid.get_version_num(), 4);
    assert_eq!(uuid.to_string(), id);
    assert!(f.matches(&input(&s), id, stamp(&ack)));
    let owner = f.owner();
    windows::with_checked_checkpoint_resources(
        &owner,
        &f.resources,
        f.store.native_instance_id(),
        |_, _, checked| {
            let connection = f.store.lock_conn()?;
            let conn = connection
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            let comparison = f
                .store
                .compare_output_write_at(&conn, &checked, &input(&s), id, stamp(&ack))
                .unwrap();
            let native_text: String = conn
                .query_row(
                    "SELECT blocks_json FROM session_transcripts WHERE id='A'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let expected: [u8; 32] = Sha256::digest(native_text.as_bytes()).into();
            assert_eq!(comparison.transcript_digest(), expected);
            assert_eq!(comparison.native_write_id(), id);
            assert_eq!(comparison.ack(), stamp(&ack));
            assert_eq!(comparison.input_digest(), input_digest(&input(&s)).unwrap());
            assert_ne!(comparison.sql_digest(), [0; 32]);
            Ok(())
        },
    )
    .unwrap();
    assert!(f.store.output_write_receipts.lock().unwrap().entries.len() == 1);
}

#[test]
fn all_original_full_cas_fields_participate_and_input_changes_cannot_match() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let id = ack.native_write_id.as_deref().unwrap();
    for changed in [
        WriteInput::Replace {
            session: &s,
            expected_updated_at: Some(ack.ack.updated_at),
            expected_revision: None,
            expect_missing: None,
        },
        WriteInput::Replace {
            session: &s,
            expected_updated_at: None,
            expected_revision: Some(1),
            expect_missing: None,
        },
        WriteInput::Replace {
            session: &s,
            expected_updated_at: None,
            expected_revision: None,
            expect_missing: Some(false),
        },
    ] {
        assert!(!f.matches(&changed, id, stamp(&ack)));
    }
    let mut changed = s.clone();
    changed.title = "different request".into();
    assert!(!f.matches(&input(&changed), id, stamp(&ack)));
    assert!(!f.matches(&input(&s), &id.to_uppercase(), stamp(&ack)));
    assert!(!f.matches(
        &input(&s),
        id,
        AckStamp {
            updated_at: ack.ack.updated_at,
            revision: 99
        }
    ));
    assert!(f.matches(&input(&s), id, stamp(&ack)));
}

#[test]
fn guarded_full_cas_is_inside_original_transaction_and_failed_cas_does_not_register() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let conn = f.store.lock_conn().unwrap();
    for (time, revision, missing) in [
        (Some(-1), None, None),
        (None, Some(-1), None),
        (None, None, Some(true)),
    ] {
        assert!(upsert(
            &f.store,
            &conn,
            &s,
            Default::default(),
            time,
            revision,
            missing,
            Some(f.owner())
        )
        .unwrap()
        .is_none());
    }
    drop(conn);
    assert!(f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
    let conn = f.store.lock_conn().unwrap();
    let ack = upsert(
        &f.store,
        &conn,
        &s,
        Default::default(),
        Some(old.ack.updated_at),
        old.ack.transcript_revision,
        None,
        Some(f.owner()),
    )
    .unwrap()
    .unwrap();
    drop(conn);
    let expected = WriteInput::Replace {
        session: &s,
        expected_updated_at: Some(old.ack.updated_at),
        expected_revision: old.ack.transcript_revision,
        expect_missing: None,
    };
    assert!(f.matches(
        &expected,
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
    assert!(!f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
}

#[test]
fn actual_delta_writer_receipt_matches_original_delta_only_and_retires_full() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let mut delta_session = s.clone();
    delta_session.blocks = json!([]);
    let delta = incremental::SessionDelta {
        session: delta_session,
        expected_updated_at: old.ack.updated_at,
        expected_revision: old.ack.transcript_revision.unwrap(),
        length: 1,
        changes: vec![incremental::BlockChange {
            index: 0,
            block: json!({"id":"block","role":"assistant","text":"updated"}),
        }],
    };
    let conn = f.store.lock_conn().unwrap();
    let ack = apply_delta(&f.store, &conn, &delta, Some(f.owner()))
        .unwrap()
        .unwrap();
    drop(conn);
    let delta_stamp = AckStamp {
        updated_at: ack.ack.updated_at,
        revision: ack.ack.revision,
    };
    assert!(f.matches(
        &WriteInput::Delta { delta: &delta },
        ack.native_write_id.as_deref().unwrap(),
        delta_stamp
    ));
    assert!(!f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
    let conn = f.store.lock_conn().unwrap();
    assert!(apply_delta(&f.store, &conn, &delta, Some(f.owner()))
        .unwrap()
        .is_none());
    drop(conn);
    assert!(f.matches(
        &WriteInput::Delta { delta: &delta },
        ack.native_write_id.as_deref().unwrap(),
        delta_stamp
    ));
}

#[test]
fn preparation_occurs_before_commit_and_failed_commit_publishes_nothing() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let conn = f.store.lock_conn().unwrap();
    conn.commit_hook(Some(|| true)).unwrap();
    let mut changed = s.clone();
    changed.title = "must roll back".into();
    assert!(upsert(
        &f.store,
        &conn,
        &changed,
        Default::default(),
        None,
        None,
        None,
        Some(f.owner())
    )
    .is_err());
    conn.commit_hook(None::<fn() -> bool>).unwrap();
    let title: String = conn
        .query_row("SELECT title FROM sessions WHERE id='A'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, s.title);
    assert!(f
        .store
        .output_write_receipts
        .lock()
        .unwrap()
        .entries
        .is_empty());
    drop(conn);
    assert!(!f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
}

#[test]
fn no_opt_in_or_missing_owner_preserves_ordinary_ack_shape_and_retires_prior() {
    let f = Fixture::new();
    let s = session("A");
    let old = f.put(&s, true);
    let plain = f.put(&s, false);
    assert!(plain.native_write_id.is_none());
    assert_eq!(
        serde_json::to_value(&plain).unwrap(),
        serde_json::to_value(&plain.ack).unwrap()
    );
    assert!(!f.matches(
        &input(&s),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
    let delta = incremental::DeltaAck {
        updated_at: 1,
        revision: 2,
        summary: None,
    };
    assert_eq!(
        serde_json::to_value(NativeWriteAck {
            ack: delta,
            native_write_id: None
        })
        .unwrap(),
        json!({"updatedAt":1,"revision":2})
    );
}

#[test]
fn reload_same_label_different_physical_resource_and_other_store_cannot_compare() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    let id = ack.native_write_id.as_deref().unwrap();
    let barrier = WindowBarrier::new();
    barrier.admit_window("main").unwrap();
    let other = windows::test_buffer_resources(&barrier, "main");
    let owner =
        windows::capture_checkpoint_resources(&other, f.store.native_instance_id()).unwrap();
    windows::with_checked_checkpoint_resources(
        &owner,
        &other,
        f.store.native_instance_id(),
        |_, _, checked| {
            let connection = f.store.lock_conn()?;
            let conn = connection
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            assert!(f
                .store
                .compare_output_write_at(&conn, &checked, &input(&s), id, stamp(&ack))
                .is_none());
            Ok(())
        },
    )
    .unwrap();
    let other_store = SessionStore::open_in_memory().unwrap();
    let owner = f.owner();
    windows::with_checked_checkpoint_resources(
        &owner,
        &f.resources,
        f.store.native_instance_id(),
        |_, _, checked| {
            let connection = other_store.lock_conn()?;
            let conn = connection
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            assert!(other_store
                .compare_output_write_at(&conn, &checked, &input(&s), id, stamp(&ack))
                .is_none());
            Ok(())
        },
    )
    .unwrap();
    windows::test_reload_buffer_resources(&f.resources);
    assert!(!f.matches(&input(&s), id, stamp(&ack)));
    assert!(windows::with_checked_checkpoint_resources(
        &owner,
        &f.resources,
        f.store.native_instance_id(),
        |_, _, _| Ok(())
    )
    .is_err());
}

#[test]
fn row_delete_reinsert_replace_and_rename_aba_reject_identical_sql_contents() {
    for mode in ["delete", "replace", "rename"] {
        let f = Fixture::new();
        let s = session("A");
        let ack = f.put(&s, true);
        let id = ack.native_write_id.as_deref().unwrap();
        let conn = f.store.lock_conn().unwrap();
        if mode == "rename" {
            // Exercise the legacy external-writer boundary without inventing
            // cascading rename behavior for the normalized transcript tables.
            conn.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
            conn.execute_batch("UPDATE sessions SET id='temp' WHERE id='A'; UPDATE sessions SET id='A' WHERE id='temp';").unwrap();
        } else {
            conn.execute_batch("CREATE TEMP TABLE row_copy AS SELECT * FROM sessions WHERE id='A'; CREATE TEMP TABLE state_copy AS SELECT * FROM session_block_state WHERE session_id='A'; CREATE TEMP TABLE block_copy AS SELECT * FROM session_blocks WHERE session_id='A';").unwrap();
            if mode == "delete" {
                conn.execute("DELETE FROM sessions WHERE id='A'", [])
                    .unwrap();
            }
            conn.execute_batch("INSERT OR REPLACE INTO sessions SELECT * FROM row_copy; INSERT OR REPLACE INTO session_block_state SELECT * FROM state_copy; INSERT OR REPLACE INTO session_blocks SELECT * FROM block_copy;").unwrap();
        }
        drop(conn);
        assert!(!f.matches(&input(&s), id, stamp(&ack)), "{mode}");
    }
}

#[test]
fn input_and_sql_caps_are_best_effort_normal_writes_still_succeed() {
    let f = Fixture::new();
    let mut s = session("A");
    let old = f.put(&s, true);
    s.blocks = json!([{"id":"huge","text":"x".repeat(MAX_BYTES)}]);
    let ack = f.put(&s, true);
    assert!(ack.native_write_id.is_none());
    assert!(ack.ack.transcript_revision.is_some());
    assert!(!f.matches(
        &input(&session("A")),
        old.native_write_id.as_deref().unwrap(),
        stamp(&old)
    ));
    let mut s = session("B");
    s.title = "x".repeat(MAX_BYTES);
    assert!(f.put(&s, true).native_write_id.is_none());
}

#[test]
fn sql_metadata_and_corrupt_transcript_are_revalidated_without_view_materialization() {
    for sql in [
        "UPDATE sessions SET adopted_base='different' WHERE id='A'",
        "UPDATE sessions SET title=CAST(zeroblob(2097153) AS TEXT) WHERE id='A'",
        "UPDATE session_blocks SET ordinal=5 WHERE session_id='A'",
        "UPDATE session_blocks SET block_json='not JSON' WHERE session_id='A'",
        "UPDATE session_blocks SET revision=99 WHERE session_id='A'",
        "UPDATE native_authority_identity SET source_profile_id='changed' WHERE id=1",
    ] {
        let f = Fixture::new();
        let s = session("A");
        let ack = f.put(&s, true);
        // json_extract index rejects invalid JSON itself; remove only this
        // auxiliary index for the corrupt-row fixture. Identity corruption also
        // explicitly bypasses only its new immutable source-identity SQL guard.
        let conn = f.store.lock_conn().unwrap();
        conn.execute_batch("DROP INDEX session_blocks_roles")
            .unwrap();
        if sql.starts_with("UPDATE native_authority_identity ") {
            conn.execute_batch("DROP TRIGGER native_raw_identity_immutable")
                .unwrap();
        }
        conn.execute_batch(sql).unwrap();
        drop(conn);
        assert!(
            !f.matches(
                &input(&s),
                ack.native_write_id.as_deref().unwrap(),
                stamp(&ack)
            ),
            "{sql}"
        );
    }
}

#[test]
fn bounded_ledger_never_evicts_other_sessions_and_at_capacity_can_replace_same_session() {
    let f = Fixture::new();
    let a = session("A");
    let first = f.put(&a, true);
    // Fill through real production writes, not a synthetic ledger reducer.
    for n in 1..MAX_SESSIONS {
        assert!(f
            .put(&session(&format!("S{n}")), true)
            .native_write_id
            .is_some());
    }
    assert!(f.put(&session("overflow"), true).native_write_id.is_none());
    assert!(f.matches(
        &input(&a),
        first.native_write_id.as_deref().unwrap(),
        stamp(&first)
    ));
    let replacement = f.put(&a, true);
    assert!(replacement.native_write_id.is_some());
    assert!(!f.matches(
        &input(&a),
        first.native_write_id.as_deref().unwrap(),
        stamp(&first)
    ));
    assert!(f.matches(
        &input(&a),
        replacement.native_write_id.as_deref().unwrap(),
        stamp(&replacement)
    ));
    assert_eq!(
        f.store.output_write_receipts.lock().unwrap().entries.len(),
        MAX_SESSIONS
    );
}

#[test]
fn identical_ack_noop_still_retires_prior_receipt_and_unrelated_write_does_not() {
    let f = Fixture::new();
    let s = session("A");
    let ack = f.put(&s, true);
    f.put(&session("B"), true);
    assert!(f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
    let conn = f.store.lock_conn().unwrap();
    conn.execute_batch("CREATE TEMP TRIGGER keep_noop_revision AFTER UPDATE ON session_block_state WHEN NEW.session_id='A' BEGIN UPDATE session_block_state SET revision=OLD.revision WHERE session_id='A'; END;").unwrap();
    drop(conn);
    let noop = f.put(&s, false);
    assert_eq!(stamp(&noop), stamp(&ack));
    assert!(!f.matches(
        &input(&s),
        ack.native_write_id.as_deref().unwrap(),
        stamp(&ack)
    ));
}
