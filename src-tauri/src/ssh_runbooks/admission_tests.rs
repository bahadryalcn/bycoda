//! The command SQL bodies with real native Persistence admission, without SSH/network.
use super::*;
use crate::native_window_lifecycle::{
    test_admit_window_persistence, test_buffer_resources, test_persistence_write,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);

fn draft() -> Profile {
    Profile {
        triggers: Some(Triggers {
            startup_server_ids: vec!["server-one".into()],
            interval_minutes: Some(5),
            next_run_at: Some(10),
        }),
        id: "book-one".into(),
        name: "Original reviewed runbook".into(),
        revision: 0,
        script: "  printf 'exact 漢🦀'\r\n".into(),
        shell: RemoteShellKind::Posix,
        target_ids: vec!["server-one".into()],
        limits: ExecutionLimits {
            concurrency: 1,
            timeout_seconds: 10,
        },
    }
}

fn status(book: &Profile, id: &str) -> RunStatus {
    RunStatus {
        run_id: id.into(),
        automation_id: book.id.clone(),
        revision: book.revision,
        owner: "original-window".into(),
        digest: "a".repeat(64),
        targets: vec![ssh_execution::TargetOutcome {
            server_id: "server-one".into(),
            state: TargetState::Queued,
            exit_code: None,
            reason: None,
        }],
    }
}

fn snapshot(store: &SessionStore) -> Vec<Vec<String>> {
    let conn = store.lock_conn().unwrap();
    [
        "SELECT definition_json FROM automations ORDER BY id",
        "SELECT run_json FROM automation_runs ORDER BY id",
        "SELECT quote(automation_id)||':'||quote(event_key)||':'||quote(claim_owner) FROM automation_event_claims ORDER BY automation_id,event_key",
    ]
    .into_iter()
    .map(|sql| {
        conn.prepare(sql)
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    })
    .collect()
}

struct StorePersistence {
    store: Arc<SessionStore>,
    loads: AtomicUsize,
}
impl StorePersistence {
    fn new(store: Arc<SessionStore>) -> Self {
        Self {
            store,
            loads: AtomicUsize::new(0),
        }
    }
}
impl RunPersistence for StorePersistence {
    fn claim(&self, status: &RunStatus) -> Result<ClaimResult, String> {
        let mut conn = self.store.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let result = claim_with_intent(&tx, status, None)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(result)
    }
    fn update(&self, status: &RunStatus) -> Result<(), String> {
        let conn = self.store.lock_conn()?;
        update(&conn, status)
    }
    fn load(&self, owner: &str, id: &str) -> Result<Option<RunStatus>, String> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        load_run_with(&self.store, owner, id)
    }
}

#[test]
fn selected_session_close_refuses_all_six_global_scalar_writers_before_sql_or_events() {
    let store = SessionStore::open_in_memory().unwrap();
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let intent = ssh_runbook_trigger_intent_with(
        &store,
        saved.id.clone(),
        saved.revision,
        "server-one".into(),
        || {},
    )
    .unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let closed = barrier.close_target_admission("unrelated-session").unwrap();
    let entered = Cell::new(0);
    macro_rules! refused {
        ($work:expr) => {
            assert!(test_persistence_write(&resources, Some(&barrier), || {
                entered.set(entered.get() + 1);
                $work
            })
            .is_err());
        };
    }
    refused!(ssh_runbook_save_with(
        &store,
        saved.clone(),
        Some(saved.revision),
        || {}
    ));
    refused!(ssh_runbook_remove_with(
        &store,
        saved.id.clone(),
        saved.revision,
        || {}
    ));
    refused!(ssh_runbook_pending_intents_with(&store, || saved
        .triggers
        .as_ref()
        .unwrap()
        .next_run_at
        .unwrap()));
    refused!(ssh_runbook_trigger_intent_with(
        &store,
        saved.id.clone(),
        saved.revision,
        "server-one".into(),
        || {},
    ));
    refused!(ssh_runbook_dismiss_intent_with(&store, intent.id, || {}));
    refused!(ssh_runbook_abandon_missing_with(
        &store,
        "original-window",
        "missing-run",
        &saved.id,
        saved.revision,
        || {},
    ));
    assert_eq!(entered.get(), 0);
    assert_eq!(snapshot(&store), before);
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn admitted_scalar_workflow_preserves_cas_intents_schedule_and_post_sql_event_order() {
    let store = SessionStore::open_in_memory().unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let notifications = Cell::new(0);
    let notify = || {
        assert!(store.test_connection_unlocked());
        assert!(matches!(
            barrier.try_close_idle_target_admission("cut"),
            Err(BarrierError::PendingNativeOperations)
        ));
        notifications.set(notifications.get() + 1);
    };
    let saved = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_save_with(&store, draft(), None, notify)
    })
    .unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(saved.script, draft().script);
    let due = saved.triggers.as_ref().unwrap().next_run_at.unwrap();
    assert!(
        due > 10,
        "save must retain its real schedule initialization policy"
    );
    let startup = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_trigger_intent_with(
            &store,
            saved.id.clone(),
            saved.revision,
            "server-one".into(),
            notify,
        )
    })
    .unwrap();
    test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_dismiss_intent_with(&store, startup.id.clone(), notify)
    })
    .unwrap();
    assert_eq!(
        read_intent(&store.lock_conn().unwrap(), &startup.id)
            .unwrap()
            .status,
        "dismissed"
    );
    let before_due = snapshot(&store);
    let early = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_pending_intents_with(&store, || due - 1)
    })
    .unwrap();
    assert!(early.is_empty());
    assert_eq!(snapshot(&store), before_due);
    let scheduled = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_pending_intents_with(&store, || due)
    })
    .unwrap();
    assert_eq!(scheduled.len(), 1);
    assert_eq!(scheduled[0].trigger, "scheduled");
    let current = get(&store.lock_conn().unwrap(), &saved.id).unwrap();
    assert_eq!(
        current.triggers.unwrap().next_run_at.unwrap(),
        due + 300_000
    );
    let after_due = snapshot(&store);
    let again = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_pending_intents_with(&store, || due)
    })
    .unwrap();
    assert_eq!(again, scheduled);
    assert_eq!(snapshot(&store), after_due);
    test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_abandon_missing_with(
            &store,
            "original-window",
            "missing-run",
            &saved.id,
            saved.revision,
            notify,
        )
    })
    .unwrap();
    test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_remove_with(&store, saved.id.clone(), saved.revision, notify)
    })
    .unwrap();
    assert_eq!(notifications.get(), 5); // Polling retains its original no-event policy.
    assert!(get(&store.lock_conn().unwrap(), &saved.id).is_err());
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn accepted_scalar_transaction_outlives_waiter_and_remains_owned_through_original_event() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let (inside_sql, sql_entered) = mpsc::channel();
    let (release_sql, sql_release) = mpsc::channel();
    let inserts = Arc::new(AtomicUsize::new(0));
    let actual_inserts = inserts.clone();
    store
        .lock_conn()
        .unwrap()
        .update_hook(Some(move |_, _: &str, table: &str, _| {
            if table == "automation_event_claims"
                && actual_inserts.fetch_add(1, Ordering::SeqCst) == 0
            {
                inside_sql.send(()).unwrap();
                sql_release.recv_timeout(WAIT).unwrap();
            }
        }))
        .unwrap();
    let (notify, notified) = mpsc::channel();
    let (release_notify, notify_release) = mpsc::channel();
    let (result, waiter) = mpsc::channel();
    let actual_store = store.clone();
    let actual_barrier = barrier.clone();
    let worker = std::thread::spawn(move || {
        let outcome = test_persistence_write(&resources, Some(&actual_barrier), || {
            ssh_runbook_abandon_missing_with(
                &actual_store,
                "original-window",
                "missing-run",
                &saved.id,
                saved.revision,
                || {
                    assert!(actual_store.test_connection_unlocked());
                    notify.send(()).unwrap();
                    notify_release.recv_timeout(WAIT).unwrap();
                },
            )
        });
        let _ = result.send(outcome);
    });
    sql_entered.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_sql.send(()).unwrap();
    notified.recv_timeout(WAIT).unwrap();
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_notify.send(()).unwrap();
    worker.join().unwrap();
    // The original operation writes its run ledger and its exact owner marker.
    assert_eq!(inserts.load(Ordering::SeqCst), 2);
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn admitted_sql_abort_rolls_back_intent_and_preserves_original_error_without_event() {
    let store = SessionStore::open_in_memory().unwrap();
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    store.lock_conn().unwrap().execute_batch(
        "CREATE TRIGGER reject_intent BEFORE INSERT ON automation_runs BEGIN SELECT RAISE(ABORT, 'original intent SQL failure'); END;",
    ).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let notified = Cell::new(false);
    let result = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_trigger_intent_with(
            &store,
            saved.id,
            saved.revision,
            "server-one".into(),
            || notified.set(true),
        )
    });
    assert_eq!(result.unwrap_err(), "original intent SQL failure");
    assert!(!notified.get());
    assert_eq!(snapshot(&store), before);
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn stale_revision_error_preserves_definition_and_original_result() {
    let store = SessionStore::open_in_memory().unwrap();
    ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let result = test_persistence_write(&resources, Some(&barrier), || {
        ssh_runbook_save_with(&store, draft(), None, || {
            panic!("must not notify a failed save")
        })
    });
    assert_eq!(result.unwrap_err(), "Runbook changed; reload before saving");
    assert_eq!(snapshot(&store), before);
}

#[test]
fn closed_uncached_status_never_runs_durable_recovery_or_replaces_rows_with_not_found() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let persistence = StorePersistence::new(store.clone());
    assert!(matches!(
        persistence.claim(&status(&saved, "original-run")).unwrap(),
        ClaimResult::Claimed
    ));
    let before = snapshot(&store);
    let executions = ssh_execution::SshExecutions::default();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let closed = barrier.close_target_admission("other-session").unwrap();
    let result = status_with(
        &executions,
        "original-window",
        "original-run",
        &persistence,
        || test_admit_window_persistence(&resources, Some(&barrier)),
    );
    assert!(result.is_err());
    assert_eq!(persistence.loads.load(Ordering::SeqCst), 0);
    assert_eq!(snapshot(&store), before);
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn admitted_status_recovers_unknown_once_and_duplicate_lookup_never_claims_again() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let persistence = StorePersistence::new(store.clone());
    let original = status(&saved, "original-run");
    assert!(matches!(
        persistence.claim(&original).unwrap(),
        ClaimResult::Claimed
    ));
    // Simulate a row left by an earlier process; this process's own claims stay live.
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE automation_runs SET created_at=0 WHERE id='original-run'",
            [],
        )
        .unwrap();
    let executions = ssh_execution::SshExecutions::default();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let recovered = status_with(
        &executions,
        &original.owner,
        &original.run_id,
        &persistence,
        || test_admit_window_persistence(&resources, Some(&barrier)),
    )
    .unwrap();
    assert_eq!(recovered.targets[0].state, TargetState::Unknown);
    assert_eq!(
        recovered.targets[0].reason.as_deref(),
        Some("interrupted_after_restart")
    );
    let after = snapshot(&store);
    let admission = test_admit_window_persistence(&resources, Some(&barrier)).unwrap();
    let duplicate = admission
        .finish(existing_run(
            &executions,
            &original.owner,
            &original.run_id,
            &persistence,
        ))
        .unwrap()
        .unwrap();
    assert_eq!(duplicate.run_id, original.run_id);
    assert_eq!(duplicate.targets[0].state, TargetState::Unknown);
    assert_eq!(snapshot(&store), after);
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn durable_load_errors_are_unknown_not_fresh_start_permission() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let persistence = StorePersistence::new(store.clone());
    persistence.claim(&status(&saved, "original-run")).unwrap();
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE automation_runs SET run_json='broken' WHERE id='original-run'",
            [],
        )
        .unwrap();
    let before = snapshot(&store);
    let executions = ssh_execution::SshExecutions::default();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let continued = Cell::new(false);
    let result = test_persistence_write(&resources, Some(&barrier), || {
        let found = existing_run(&executions, "original-window", "original-run", &persistence)?;
        continued.set(true);
        Ok(found)
    });
    assert!(result.is_err());
    assert!(!continued.get());
    assert_eq!(snapshot(&store), before);
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn durable_foreign_owner_and_same_owner_wrong_serialized_run_are_never_success() {
    for wrong_owner in [true, false] {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
        let persistence = StorePersistence::new(store.clone());
        let mut original = status(&saved, "original-run");
        original.targets[0].state = TargetState::Unknown;
        persistence.claim(&original).unwrap();
        let sql = if wrong_owner {
            "UPDATE automation_runs SET run_json=json_set(run_json,'$.sshExecution.owner','replacement') WHERE id='original-run'"
        } else {
            "UPDATE automation_runs SET run_json=json_set(run_json,'$.id','replacement','$.sshExecution.runId','replacement') WHERE id='original-run'"
        };
        store.lock_conn().unwrap().execute(sql, []).unwrap();
        let before = snapshot(&store);
        let executions = ssh_execution::SshExecutions::default();
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "original-window");
        let result = status_with(
            &executions,
            "original-window",
            "original-run",
            &persistence,
            || test_admit_window_persistence(&resources, Some(&barrier)),
        );
        assert_eq!(
            result.unwrap_err(),
            if wrong_owner {
                "Execution belongs to another native window"
            } else {
                "Execution belongs to another native window or run"
            }
        );
        assert!(
            existing_run(&executions, "original-window", "original-run", &persistence).is_err()
        );
        assert_eq!(snapshot(&store), before);
    }
}

#[test]
fn queried_row_alias_cannot_recover_or_update_another_real_unfinished_run() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let saved = ssh_runbook_save_with(&store, draft(), None, || {}).unwrap();
    let persistence = StorePersistence::new(store.clone());
    persistence.claim(&status(&saved, "row-a")).unwrap();
    persistence.claim(&status(&saved, "row-b")).unwrap();
    store.lock_conn().unwrap().execute(
        "UPDATE automation_runs SET run_json=json_set(run_json,'$.id','row-b','$.sshExecution.runId','row-b') WHERE id='row-a'",
        [],
    ).unwrap();
    let before = snapshot(&store);
    let executions = ssh_execution::SshExecutions::default();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let result = status_with(
        &executions,
        "original-window",
        "row-a",
        &persistence,
        || test_admit_window_persistence(&resources, Some(&barrier)),
    );
    assert_eq!(
        result.unwrap_err(),
        "Execution belongs to another native window or run"
    );
    // Also protect direct Automation recovery, which uses the same production reader.
    assert!(recover_run(&store.lock_conn().unwrap(), "row-a").is_err());
    assert!(existing_run(&executions, "original-window", "row-a", &persistence).is_err());
    assert_eq!(snapshot(&store), before);
    assert_eq!(
        read_run(&store.lock_conn().unwrap(), "row-b")
            .unwrap()
            .unwrap()
            .targets[0]
            .state,
        TargetState::Queued
    );
}
