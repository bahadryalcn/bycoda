//! Real Automation SQL behind the same resource-owned Persistence admission as IPC.
use super::*;
use crate::native_window_lifecycle::{test_buffer_resources, test_persistence_write};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use std::cell::Cell;
use std::sync::{mpsc, Arc};
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);

#[test]
fn recovery_runs_once_after_success_and_retries_failure() {
    let guard = Mutex::new(None);
    assert!(recover_once::<i32>(&guard, "owner", || Err("failed".into())).is_err());
    assert_eq!(
        recover_once(&guard, "owner", || Ok(vec![1])).unwrap(),
        vec![1]
    );
    assert_eq!(
        recover_once::<i32>(&guard, "owner", || panic!("recovery repeated")).unwrap(),
        vec![1]
    );
    assert!(
        recover_once::<i32>(&guard, "other", || panic!("recovery repeated"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn terminal_run_cannot_be_restarted_or_completed_again() {
    let store = SessionStore::open_in_memory().unwrap();
    let automation = automations_upsert_with(&store, input("transition"), || {}).unwrap();
    let run = automation_run_now_with(&store, automation.id, 10, || {}).unwrap();
    automation_run_update_with(
        &store,
        run.id.clone(),
        "cancelled".into(),
        None,
        None,
        11,
        || {},
    )
    .unwrap();
    for status in ["running", "succeeded", "cancelled"] {
        assert!(automation_run_update_with(
            &store,
            run.id.clone(),
            status.into(),
            None,
            None,
            12,
            || {}
        )
        .is_err());
    }
}

fn input(id: &str) -> AutomationUpsert {
    serde_json::from_value(serde_json::json!({
        "id": id, "name": "  Original automation  ",
        "prompt": "  original\r\n漢🦀\n", "harness": "codex", "model": "original",
        "cwd": "/original", "runtimeMode": "supervised", "scheduleKind": "hourly",
        "minute": 0, "time": "09:00", "dayOfWeek": 1,
        "missedRunGraceMinutes": 720, "enabled": true,
        "nextRunAt": now_millis() + 3_600_000,
        "triggers": [
            {"id":"time", "kind":"time", "scheduleKind":"hourly"},
            {"id":"event", "kind":"github", "event":"issue_labeled"}
        ]
    }))
    .unwrap()
}

fn claim(token: &str, key: &str) -> AutomationEventClaim {
    AutomationEventClaim {
        recovery_token: Some(token.into()),
        event_key: key.into(),
        event_kind: "github".into(),
        event: "issue_labeled".into(),
        scheduled_for: 10,
        prompt: "  exact event\r\n漢🦀\n".into(),
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

#[test]
fn selected_session_closure_refuses_all_seven_global_automation_writes_before_sql() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = automations_upsert_with(&store, input("original"), || {}).unwrap();
    let run = automation_run_now_with(&store, original.id.clone(), 10, || {}).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "automation-original-window");
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
    refused!(automations_upsert_with(&store, input("new"), || {}));
    refused!(automations_delete_with(&store, original.id.clone(), || {}));
    refused!(automation_runs_recover_with(&store, 20, 30, || {}));
    refused!(automation_run_now_with(
        &store,
        original.id.clone(),
        40,
        || {}
    ));
    refused!(automations_claim_due_with(
        &store,
        original.id.clone(),
        original.next_run_at,
        original.next_run_at,
        original.next_run_at + 3_600_000,
        original.next_run_at,
        || {}
    ));
    refused!(automations_claim_event_with(
        &store,
        "automation-original-window",
        original.id,
        claim(&Uuid::new_v4().to_string(), "closed-event"),
        50,
        || {}
    ));
    refused!(automation_run_update_with(
        &store,
        run.id,
        "succeeded".into(),
        Some("other-session".into()),
        None,
        60,
        || {}
    ));
    assert_eq!(entered.get(), 0);
    assert_eq!(snapshot(&store), before);
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn all_seven_actual_operations_preserve_results_and_notify_only_after_sql_unlock() {
    let store = SessionStore::open_in_memory().unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "automation-workflow");
    let notifications = Cell::new(0);
    let notify = || {
        assert!(
            store.test_connection_unlocked(),
            "event ran under the SQL lock"
        );
        assert!(matches!(
            barrier.try_close_idle_target_admission("cut"),
            Err(BarrierError::PendingNativeOperations)
        ));
        notifications.set(notifications.get() + 1);
    };
    let saved = test_persistence_write(&resources, Some(&barrier), || {
        automations_upsert_with(&store, input("workflow"), notify)
    })
    .unwrap();
    assert_eq!(saved.name, "Original automation");
    assert_eq!(saved.prompt, "  original\r\n漢🦀\n");
    let manual = test_persistence_write(&resources, Some(&barrier), || {
        automation_run_now_with(&store, saved.id.clone(), 10, notify)
    })
    .unwrap();
    let running = test_persistence_write(&resources, Some(&barrier), || {
        automation_run_update_with(
            &store,
            manual.id.clone(),
            "running".into(),
            Some("original-session".into()),
            None,
            11,
            notify,
        )
    })
    .unwrap();
    assert_eq!(running.started_at, Some(11));
    assert_eq!(running.session_id.as_deref(), Some("original-session"));
    let recovered = test_persistence_write(&resources, Some(&barrier), || {
        automation_runs_recover_with(&store, 20, 30, notify)
    })
    .unwrap();
    assert!(recovered.is_empty());
    let recovered = list_runs(&store.lock_conn().unwrap(), &saved.id).unwrap();
    assert_eq!(recovered[0].status, "cancelled");
    assert_eq!(
        recovered[0].error.as_deref(),
        Some("Interrupted when bycoda last stopped.")
    );
    let scheduled = test_persistence_write(&resources, Some(&barrier), || {
        automations_claim_due_with(
            &store,
            saved.id.clone(),
            saved.next_run_at,
            saved.next_run_at,
            saved.next_run_at + 3_600_000,
            saved.next_run_at,
            notify,
        )
    })
    .unwrap()
    .unwrap();
    assert_eq!(scheduled.run.trigger, "scheduled");
    let event = test_persistence_write(&resources, Some(&barrier), || {
        automations_claim_event_with(
            &store,
            "automation-workflow",
            saved.id.clone(),
            claim(&Uuid::new_v4().to_string(), "original-event"),
            50,
            notify,
        )
    })
    .unwrap()
    .unwrap();
    assert_eq!(event.run.prompt.as_deref(), Some("  exact event\r\n漢🦀\n"));
    test_persistence_write(&resources, Some(&barrier), || {
        automations_delete_with(&store, saved.id.clone(), notify)
    })
    .unwrap();
    assert!(get(&store.lock_conn().unwrap(), &saved.id)
        .unwrap()
        .is_none());
    assert_eq!(notifications.get(), 7);
    let closed = barrier.try_close_idle_target_admission("cut").unwrap();
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn dropped_waiter_cannot_retire_an_accepted_actual_sql_transaction_or_its_notification() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    automations_upsert_with(&store, input("original"), || {}).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "automation-detached");
    let (inside_sql, sql_started) = mpsc::channel();
    let (release_sql, sql_release) = mpsc::channel();
    let writes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let written = writes.clone();
    let mut first = true;
    store
        .lock_conn()
        .unwrap()
        .update_hook(Some(move |_, _: &str, table: &str, _| {
            if table == "automation_runs" {
                written.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if first {
                    first = false;
                    inside_sql.send(()).unwrap();
                    sql_release.recv_timeout(WAIT).unwrap();
                }
            }
        }))
        .unwrap();
    let (notify_started, notified) = mpsc::channel();
    let (release_notify, notify_release) = mpsc::channel();
    let (result, waiter) = mpsc::channel();
    let actual_store = store.clone();
    let actual_barrier = barrier.clone();
    let worker = std::thread::spawn(move || {
        let actual = test_persistence_write(&resources, Some(&actual_barrier), || {
            automation_run_now_with(&actual_store, "original".into(), 10, || {
                assert!(actual_store.test_connection_unlocked());
                notify_started.send(()).unwrap();
                notify_release.recv_timeout(WAIT).unwrap();
            })
        });
        let _ = result.send(actual);
    });
    sql_started.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_sql.send(()).unwrap();
    notified.recv_timeout(WAIT).unwrap();
    assert_eq!(
        list_runs(&store.lock_conn().unwrap(), "original")
            .unwrap()
            .len(),
        1
    );
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_notify.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        list_runs(&store.lock_conn().unwrap(), "original")
            .unwrap()
            .len(),
        1
    );
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn actual_transaction_error_rolls_back_without_event_or_fabricated_success() {
    let store = SessionStore::open_in_memory().unwrap();
    automations_upsert_with(&store, input("original"), || {}).unwrap();
    store.lock_conn().unwrap().execute_batch(
        "CREATE TRIGGER reject_original_run BEFORE INSERT ON automation_runs BEGIN SELECT RAISE(ABORT, 'original SQL failure'); END;",
    ).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "automation-error");
    let notified = Cell::new(false);
    let result = test_persistence_write(&resources, Some(&barrier), || {
        automation_run_now_with(&store, "original".into(), 10, || notified.set(true))
    });
    assert_eq!(result.unwrap_err(), "original SQL failure");
    assert!(!notified.get());
    assert_eq!(snapshot(&store), before);
    // A real failed operation cannot become an idle/qualified checkpoint proof.
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn accepted_event_retry_keeps_original_native_window_scope_and_does_not_replay() {
    let store = SessionStore::open_in_memory().unwrap();
    automations_upsert_with(&store, input("original"), || {}).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "original-window");
    let token = Uuid::new_v4().to_string();
    let notifications = Cell::new(0);
    let run_claim = |window: &str| {
        test_persistence_write(&resources, Some(&barrier), || {
            automations_claim_event_with(
                &store,
                window,
                "original".into(),
                claim(&token, "same-event"),
                10,
                || notifications.set(notifications.get() + 1),
            )
        })
        .unwrap()
    };
    let original = run_claim("original-window").unwrap();
    let retry = run_claim("original-window").unwrap();
    assert_eq!(retry.run.id, original.run.id);
    assert!(run_claim("replacement-window").is_none());
    assert_eq!(notifications.get(), 1);
    assert_eq!(
        list_runs(&store.lock_conn().unwrap(), "original")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn ssh_ownership_refusal_preserves_original_row_and_error() {
    let store = SessionStore::open_in_memory().unwrap();
    let mut original = automations_upsert_with(&store, input("ssh-original"), || {}).unwrap();
    original.executor = Some(crate::ssh_runbooks::Executor::Ssh);
    write_automation(&store.lock_conn().unwrap(), &original).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "automation-ssh-refusal");
    let notified = Cell::new(false);
    let result = test_persistence_write(&resources, Some(&barrier), || {
        automations_delete_with(&store, original.id, || notified.set(true))
    });
    assert_eq!(
        result.unwrap_err(),
        "Use the SSH runbook editor to remove this runbook"
    );
    assert!(!notified.get());
    assert_eq!(snapshot(&store), before);
}
