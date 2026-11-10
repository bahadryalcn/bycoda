//! Actual reminder SQL and Native Window/process admission; no OS notifications.
use super::*;
use crate::native_window_lifecycle::{test_admit_window_persistence, test_buffer_resources};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};

const WAIT: Duration = Duration::from_secs(5);

fn database(ids: &[&str]) -> Arc<SessionStore> {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    for id in ids {
        store.lock_conn().unwrap().execute(
            "INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,has_user_message) VALUES(?1,'/owned','codex','','supervised','Saved reminder fixture',1,1,1)",
            [id],
        ).unwrap();
    }
    store
}
fn preferences(ids: &[&str]) -> DeliveryPreferences {
    DeliveryPreferences {
        notifications_enabled: true,
        events: Default::default(),
        sound: false,
        project_rules: ids
            .iter()
            .map(|id| {
                (
                    (*id).to_string(),
                    ProjectDeliveryRule {
                        enabled: true,
                        after: 0,
                    },
                )
            })
            .collect(),
    }
}
fn schedule(store: &SessionStore, ids: &[&str]) {
    set(
        &mut store.lock_conn().unwrap(),
        &ids.iter().map(|id| (*id).to_string()).collect::<Vec<_>>(),
        200,
        100,
    )
    .unwrap();
}
fn rows(store: &SessionStore) -> Vec<Reminder> {
    list(&store.lock_conn().unwrap()).unwrap()
}
fn window_write(
    resources: &tauri::ResourceTable,
    barrier: &WindowBarrier,
    work: impl FnOnce() -> ObservedWrite,
) -> Result<(), String> {
    let admission = test_admit_window_persistence(resources, Some(barrier))?;
    assert!(matches!(&admission, NativeWriteAdmission::Tracked(_)));
    let (result, observation) = work();
    admission.finish_observed(result, observation)
}

#[test]
fn closed_actual_window_refuses_both_commands_before_sql_or_changed_callback() {
    let store = database(&["A", "B"]);
    schedule(&store, &["A"]);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "reminders");
    let closed = barrier.close_target_admission("unrelated-target").unwrap();
    let calls = std::cell::Cell::new(0);
    let set_result = window_write(&resources, &barrier, || {
        calls.set(calls.get() + 1);
        set_with(
            &store,
            &["B".into()],
            300,
            || 100,
            || {
                calls.set(99);
                Ok(())
            },
        )
    });
    let clear_result = window_write(&resources, &barrier, || {
        calls.set(calls.get() + 1);
        clear_with(&store, &["A".into()], None, || {
            calls.set(99);
            Ok(())
        })
    });
    assert!(set_result.unwrap_err().contains("AdmissionClosed"));
    assert!(clear_result.unwrap_err().contains("AdmissionClosed"));
    assert_eq!(calls.get(), 0);
    assert_eq!(
        rows(&store)
            .iter()
            .map(|row| row.session_id.as_str())
            .collect::<Vec<_>>(),
        ["A"]
    );
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn original_window_commands_survive_dropped_waiter_through_unlocked_changed_callback() {
    for clearing in [false, true] {
        let store = database(&["session"]);
        if clearing {
            schedule(&store, &["session"]);
        }
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "reminders");
        let (entered, changed) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let (reply, waiter) = mpsc::channel();
        let actual_store = store.clone();
        let actual_barrier = barrier.clone();
        let worker = std::thread::spawn(move || {
            let result = window_write(&resources, &actual_barrier, || {
                let callback = || {
                    assert!(actual_store.test_connection_unlocked());
                    entered.send(()).unwrap();
                    resume.recv_timeout(WAIT).unwrap();
                    Ok(())
                };
                if clearing {
                    clear_with(&actual_store, &["session".into()], Some(200), callback)
                } else {
                    set_with(&actual_store, &["session".into()], 200, || 100, callback)
                }
            });
            assert!(result.is_ok());
            let _ = reply.send(result);
        });
        changed.recv_timeout(WAIT).unwrap();
        drop(waiter);
        assert_eq!(rows(&store).len(), usize::from(!clearing));
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        release.send(()).unwrap();
        worker.join().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
        barrier.reopen_admission(closed).unwrap();
    }
}

#[test]
fn closed_process_tick_defers_unclaimed_due_rows_then_reopen_delivers_exactly_once() {
    let store = database(&["first", "second"]);
    schedule(&store, &["first", "second"]);
    let prefs = preferences(&["first", "second"]);
    let barrier = WindowBarrier::new();
    let _resources = test_buffer_resources(&barrier, "reminders");
    let changed = std::cell::Cell::new(0);
    let delivered = std::cell::Cell::new(0);
    let closed = barrier.close_admission().unwrap();
    for now in [200, 300] {
        process_tick_with(
            Some(&barrier),
            &store,
            || now,
            &prefs,
            || Ok(Some(prefs.clone())),
            || {
                changed.set(changed.get() + 1);
                Ok(())
            },
            |_, _| {
                delivered.set(delivered.get() + 1);
                Ok(())
            },
        )
        .unwrap();
    }
    assert!(rows(&store).iter().all(|row| row.fired_at.is_none()));
    assert_eq!((changed.get(), delivered.get()), (0, 0));
    barrier.reopen_admission(closed).unwrap();
    for now in [400, 500] {
        process_tick_with(
            Some(&barrier),
            &store,
            || now,
            &prefs,
            || Ok(Some(prefs.clone())),
            || {
                changed.set(changed.get() + 1);
                Ok(())
            },
            |_, _| {
                delivered.set(delivered.get() + 1);
                Ok(())
            },
        )
        .unwrap();
    }
    assert_eq!((changed.get(), delivered.get()), (1, 2));
    assert!(rows(&store).iter().all(|row| row.fired_at == Some(400)));
}

#[test]
fn original_tick_keeps_actual_sql_notification_and_last_delivery_under_one_admission() {
    let store = database(&["first", "last"]);
    schedule(&store, &["first", "last"]);
    let prefs = preferences(&["first", "last"]);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "reminders");
    let (sql_entered, inside_sql) = mpsc::channel();
    let (release_sql, sql_resume) = mpsc::channel();
    let mut first = true;
    store
        .lock_conn()
        .unwrap()
        .update_hook(Some(move |_, _: &str, table: &str, _| {
            if table == "session_reminders" && first {
                first = false;
                sql_entered.send(()).unwrap();
                sql_resume.recv_timeout(WAIT).unwrap();
            }
        }))
        .unwrap();
    let (changed_entered, changed) = mpsc::channel();
    let (release_changed, changed_resume) = mpsc::channel();
    let (last_entered, inside_last) = mpsc::channel();
    let (release_last, last_resume) = mpsc::channel();
    let delivered = Arc::new(AtomicUsize::new(0));
    let (actual_store, actual_barrier, actual_deliveries) =
        (store.clone(), barrier.clone(), delivered.clone());
    let (reply, waiter) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = process_tick_with(
            Some(&actual_barrier),
            &actual_store,
            || 200,
            &prefs,
            || Ok(Some(prefs.clone())),
            || {
                assert!(actual_store.test_connection_unlocked());
                changed_entered.send(()).unwrap();
                changed_resume.recv_timeout(WAIT).unwrap();
                Ok(())
            },
            |reminder, sound| {
                assert!(!sound);
                assert!(actual_store.test_connection_unlocked());
                actual_deliveries.fetch_add(1, Ordering::AcqRel);
                if reminder.session_id == "last" {
                    last_entered.send(()).unwrap();
                    last_resume.recv_timeout(WAIT).unwrap();
                }
                Ok(())
            },
        );
        assert!(result.is_ok());
        let _ = reply.send(result);
    });
    inside_sql.recv_timeout(WAIT).unwrap();
    drop(waiter);
    let closed = barrier.close_admission().unwrap();
    assert!(test_admit_window_persistence(&resources, Some(&barrier)).is_err());
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_sql.send(()).unwrap();
    changed.recv_timeout(WAIT).unwrap();
    assert!(rows(&store).iter().all(|row| row.fired_at == Some(200)));
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_changed.send(()).unwrap();
    inside_last.recv_timeout(WAIT).unwrap();
    assert_eq!(delivered.load(Ordering::Acquire), 2);
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_last.send(()).unwrap();
    worker.join().unwrap();
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[test]
fn invalid_command_batch_and_tick_sql_error_rollback_without_notification_or_partial_claim() {
    let store = database(&["first", "second"]);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "reminders");
    let called = std::cell::Cell::new(false);
    assert!(window_write(&resources, &barrier, || set_with(
        &store,
        &["first".into(), "missing".into()],
        200,
        || 100,
        || {
            called.set(true);
            Ok(())
        }
    ))
    .is_err());
    assert!(rows(&store).is_empty());
    assert!(!called.get());
    schedule(&store, &["first", "second"]);
    store.lock_conn().unwrap().execute_batch("CREATE TRIGGER refuse_due BEFORE UPDATE ON session_reminders WHEN NEW.session_id='second' BEGIN SELECT RAISE(ABORT,'controlled claim failure'); END;").unwrap();
    let prefs = preferences(&["first", "second"]);
    let delivered = std::cell::Cell::new(0);
    assert!(process_tick_with(
        Some(&barrier),
        &store,
        || 200,
        &prefs,
        || Ok(Some(prefs.clone())),
        || {
            called.set(true);
            Ok(())
        },
        |_, _| {
            delivered.set(delivered.get() + 1);
            Ok(())
        }
    )
    .is_err());
    assert!(rows(&store).iter().all(|row| row.fired_at.is_none()));
    assert!(!called.get());
    assert_eq!(delivered.get(), 0);
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::FailedNativeOperation)
    ));
    store
        .lock_conn()
        .unwrap()
        .execute_batch("DROP TRIGGER refuse_due")
        .unwrap();
    process_tick_with(
        Some(&barrier),
        &store,
        || 300,
        &prefs,
        || Ok(Some(prefs.clone())),
        || Ok(()),
        |_, _| {
            delivered.set(delivered.get() + 1);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(delivered.get(), 2);
    assert!(rows(&store).iter().all(|row| row.fired_at == Some(300)));
}

#[test]
fn delivery_failure_or_panic_preserves_committed_claim_without_replay_or_false_idle() {
    for panics in [false, true] {
        let store = database(&["first", "second"]);
        schedule(&store, &["first", "second"]);
        let prefs = preferences(&["first", "second"]);
        let barrier = WindowBarrier::new();
        let _resources = test_buffer_resources(&barrier, "reminders");
        let delivered = std::cell::Cell::new(0);
        let result = process_tick_with(
            Some(&barrier),
            &store,
            || 200,
            &prefs,
            || Ok(Some(prefs.clone())),
            || Ok(()),
            |_, _| {
                delivered.set(delivered.get() + 1);
                assert!(!panics, "controlled original delivery panic");
                Err("controlled original notification failure".into())
            },
        );
        assert!(result.is_ok(), "SQL commit remains authoritative");
        assert!(rows(&store).iter().all(|row| row.fired_at == Some(200)));
        let attempts = delivered.get();
        assert_eq!(attempts, if panics { 1 } else { 2 });
        assert!(matches!(
            barrier.try_close_idle_target_admission("cut"),
            Err(BarrierError::FailedNativeOperation)
        ));
        process_tick_with(
            Some(&barrier),
            &store,
            || 300,
            &prefs,
            || Ok(Some(prefs.clone())),
            || Ok(()),
            |_, _| {
                delivered.set(delivered.get() + 1);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(delivered.get(), attempts);
    }
}

#[test]
fn original_preclose_cancel_or_reschedule_is_rechecked_after_blocked_delivery() {
    for reschedule in [false, true] {
        let store = database(&["first", "last"]);
        schedule(&store, &["first", "last"]);
        let prefs = preferences(&["first", "last"]);
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "reminders");
        let (entered, delivering) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let count = Arc::new(AtomicUsize::new(0));
        let (actual_store, actual_barrier, actual_count, latest) =
            (store.clone(), barrier.clone(), count.clone(), prefs.clone());
        let worker = std::thread::spawn(move || {
            process_tick_with(
                Some(&actual_barrier),
                &actual_store,
                || 200,
                &latest,
                || Ok(Some(latest.clone())),
                || Ok(()),
                |reminder, _| {
                    actual_count.fetch_add(1, Ordering::AcqRel);
                    assert_eq!(reminder.session_id, "first");
                    entered.send(()).unwrap();
                    resume.recv_timeout(WAIT).unwrap();
                    Ok(())
                },
            )
        });
        delivering.recv_timeout(WAIT).unwrap();
        // This exact scalar operation was accepted before closure. The original
        // tick rechecks its claimed snapshot; it never borrows fresh admission.
        let original = test_admit_window_persistence(&resources, Some(&barrier)).unwrap();
        let closed = barrier.close_admission().unwrap();
        let (result, observation) = if reschedule {
            set_with(&store, &["last".into()], 500, || 200, || Ok(()))
        } else {
            clear_with(&store, &["last".into()], Some(200), || Ok(()))
        };
        original.finish_observed(result, observation).unwrap();
        release.send(()).unwrap();
        worker.join().unwrap().unwrap();
        assert_eq!(count.load(Ordering::Acquire), 1);
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
        barrier.reopen_admission(closed).unwrap();
        process_tick_with(
            Some(&barrier),
            &store,
            || 500,
            &prefs,
            || Ok(Some(prefs.clone())),
            || Ok(()),
            |reminder, _| {
                assert_eq!(reminder.session_id, "last");
                count.fetch_add(1, Ordering::AcqRel);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            count.load(Ordering::Acquire),
            if reschedule { 2 } else { 1 }
        );
    }
}

#[test]
fn changed_event_failure_keeps_authoritative_set_and_clear_results_without_idle_proof() {
    for clearing in [false, true] {
        let store = database(&["session"]);
        if clearing {
            schedule(&store, &["session"]);
        }
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "reminders");
        let callback = || {
            assert!(store.test_connection_unlocked());
            Err("controlled changed observer failure".into())
        };
        let result = window_write(&resources, &barrier, || {
            if clearing {
                clear_with(&store, &["session".into()], Some(200), callback)
            } else {
                set_with(&store, &["session".into()], 200, || 100, callback)
            }
        });
        assert!(result.is_ok());
        assert_eq!(rows(&store).len(), usize::from(!clearing));
        assert!(matches!(
            barrier.try_close_idle_target_admission("cut"),
            Err(BarrierError::FailedNativeOperation)
        ));
    }
}

#[test]
fn clock_reads_keep_original_sql_owned_callsites_and_closed_ticks_do_not_read_time() {
    let store = database(&["session"]);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "reminders");
    let clocks = std::cell::Cell::new(0);
    window_write(&resources, &barrier, || {
        set_with(
            &store,
            &["session".into()],
            200,
            || {
                assert!(
                    !store.test_connection_unlocked(),
                    "set clock follows SQL lock acquisition"
                );
                clocks.set(clocks.get() + 1);
                100
            },
            || Ok(()),
        )
    })
    .unwrap();
    let prefs = preferences(&["session"]);
    let closed = barrier.close_admission().unwrap();
    process_tick_with(
        Some(&barrier),
        &store,
        || panic!("a deferred tick must not observe its mutation clock"),
        &prefs,
        || Ok(Some(prefs.clone())),
        || panic!("no changed event before acceptance"),
        |_, _| panic!("no delivery before acceptance"),
    )
    .unwrap();
    assert!(rows(&store)[0].fired_at.is_none());
    assert_eq!(clocks.get(), 1);
    barrier.reopen_admission(closed).unwrap();
    let delivered = std::cell::Cell::new(0);
    process_tick_with(
        Some(&barrier),
        &store,
        || {
            assert!(
                !store.test_connection_unlocked(),
                "tick clock follows SQL lock acquisition"
            );
            clocks.set(clocks.get() + 1);
            200
        },
        &prefs,
        || Ok(Some(prefs.clone())),
        || Ok(()),
        |_, _| {
            delivered.set(delivered.get() + 1);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!((clocks.get(), delivered.get()), (2, 1));
    assert_eq!(rows(&store)[0].fired_at, Some(200));
}

#[test]
fn accepted_tick_distinguishes_failed_preference_observation_from_true_absence() {
    for read_failed in [false, true] {
        let store = database(&["session"]);
        schedule(&store, &["session"]);
        let prefs = preferences(&["session"]);
        let barrier = WindowBarrier::new();
        let _resources = test_buffer_resources(&barrier, "reminders");
        let delivered = std::cell::Cell::new(0);
        let result = process_tick_with(
            Some(&barrier),
            &store,
            || 200,
            &prefs,
            || {
                if read_failed {
                    Err("original preference mutex read failed".into())
                } else {
                    Ok(None)
                }
            },
            || Ok(()),
            |_, _| {
                delivered.set(delivered.get() + 1);
                Ok(())
            },
        );
        assert!(result.is_ok(), "the original fired claim committed");
        assert_eq!(rows(&store)[0].fired_at, Some(200));
        assert_eq!(delivered.get(), 0);
        if read_failed {
            assert!(matches!(
                barrier.try_close_idle_target_admission("cut"),
                Err(BarrierError::FailedNativeOperation)
            ));
        } else {
            let closed = barrier.close_admission().unwrap();
            assert!(matches!(
                barrier.prove_native_idle(&closed),
                Err(BarrierError::MissingNativeCheckpoint)
            ));
            barrier.reopen_admission(closed).unwrap();
        }
        process_tick_with(
            Some(&barrier),
            &store,
            || 300,
            &prefs,
            || {
                panic!(
                    "a committed claim must not be replayed after a failed read or config removal"
                )
            },
            || panic!("no second changed event"),
            |_, _| panic!("no repeated delivery"),
        )
        .unwrap();
    }
}
