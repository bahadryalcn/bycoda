use super::*;

#[test]
fn idle_close_absolute_deadline_is_checked_after_waiting_for_real_barrier_mutex() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    let barrier = WindowBarrier::new();
    live(&barrier, "main");
    let held = barrier.state.lock().unwrap();
    let closing = barrier.clone();
    let expires = Instant::now() + Duration::from_millis(25);
    let (entered, waiting) = mpsc::channel();
    let job = std::thread::spawn(move || {
        entered.send(()).unwrap();
        closing.try_close_idle_target_admission_before("A", expires, || false)
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    std::thread::sleep(Duration::from_millis(40));
    drop(held);
    assert!(matches!(
        job.join().unwrap(),
        Err(BarrierError::CheckpointExpired)
    ));
    finish(barrier.begin_process_session_write("A").unwrap());
    let closed = barrier.try_close_idle_target_admission("A").unwrap();
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn idle_close_cancellation_is_checked_under_mutex_and_never_leaves_target_closed() {
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    };
    use std::time::{Duration, Instant};
    let barrier = WindowBarrier::new();
    live(&barrier, "main");
    let cancelled = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(AtomicUsize::new(0));
    let held = barrier.state.lock().unwrap();
    let closing = barrier.clone();
    let cancelling = cancelled.clone();
    let checking = calls.clone();
    let (entered, waiting) = mpsc::channel();
    let job = std::thread::spawn(move || {
        entered.send(()).unwrap();
        closing.try_close_idle_target_admission_before(
            "A",
            Instant::now() + Duration::from_secs(5),
            || {
                checking.fetch_add(1, Ordering::AcqRel);
                cancelling.load(Ordering::Acquire)
            },
        )
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(calls.load(Ordering::Acquire), 0);
    cancelled.store(true, Ordering::Release);
    drop(held);
    assert!(matches!(
        job.join().unwrap(),
        Err(BarrierError::CheckpointExpired)
    ));
    assert_eq!(calls.load(Ordering::Acquire), 1);
    let busy = barrier.begin_process_session_write("A").unwrap();
    assert!(matches!(
        barrier.try_close_idle_target_admission_before(
            "A",
            Instant::now() + Duration::from_secs(5),
            || false
        ),
        Err(BarrierError::PendingNativeOperations)
    ));
    finish(busy);
    let closed = barrier
        .try_close_idle_target_admission_before(
            "A",
            Instant::now() + Duration::from_secs(5),
            || false,
        )
        .unwrap();
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn idle_try_close_rejects_relevant_process_work_without_closing_admission() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    for global in [false, true] {
        let operation = if global {
            barrier.begin_process_write().unwrap()
        } else {
            barrier.begin_process_session_write("A").unwrap()
        };
        assert!(matches!(
            barrier.try_close_idle_target_admission("A"),
            Err(BarrierError::PendingNativeOperations)
        ));
        finish(
            barrier
                .begin_session_write(&window, "A", NativeLane::Persistence)
                .unwrap(),
        );
        finish(operation);
        let closed = barrier.try_close_idle_target_admission("A").unwrap();
        assert!(matches!(
            barrier.begin_process_session_write("A"),
            Err(BarrierError::AdmissionClosed)
        ));
        barrier.reopen_target_admission(closed).unwrap();
    }
}

#[test]
fn idle_try_close_ignores_other_session_process_work_and_its_later_settlement() {
    let barrier = WindowBarrier::new();
    live(&barrier, "main");
    let unrelated = barrier.begin_process_session_write("B").unwrap();
    let closed = barrier.try_close_idle_target_admission("A").unwrap();
    checkpoints(&barrier, &closed);
    let proof = barrier.prove_target_native_idle(&closed).unwrap();
    finish(unrelated);
    assert_eq!(
        barrier
            .with_target_native_idle(&proof, str::to_owned)
            .unwrap(),
        "A"
    );
    finish(barrier.begin_process_session_write("B").unwrap());
    assert_eq!(
        barrier
            .with_target_native_idle(&proof, str::to_owned)
            .unwrap(),
        "A"
    );
}

#[test]
fn idle_try_close_pending_or_empty_roster_never_traps_new_window_admission() {
    let barrier = WindowBarrier::new();
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::EmptyWindowRoster)
    ));
    let pending = barrier.admit_window("main").unwrap();
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::PendingNativeWindow)
    ));
    barrier.confirm_created(&pending).unwrap();
    finish(barrier.begin_process_session_write("A").unwrap());
    let closed = barrier.try_close_idle_target_admission("A").unwrap();
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn checkpoint_deadline_is_rechecked_after_waiting_for_the_actual_admission_lock() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let closed = std::sync::Arc::new(barrier.close_target_admission("A").unwrap());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let holding_barrier = barrier.clone();
    let holding_closed = closed.clone();
    let holding_window = window.clone();
    let holding = std::thread::spawn(move || {
        holding_barrier
            .with_target_checkpoint_scope(&holding_closed, &holding_window, |_| {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            })
            .unwrap();
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let expires = Instant::now() + Duration::from_millis(100);
    let waiting_barrier = barrier.clone();
    let waiting_closed = closed.clone();
    let waiting_window = window.clone();
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let waiting = std::thread::spawn(move || {
        attempt_tx.send(()).unwrap();
        let result = waiting_barrier.begin_target_checkpoint_before(
            &waiting_closed,
            &waiting_window,
            NativeLane::Persistence,
            expires,
        );
        done_tx
            .send(matches!(result, Err(BarrierError::CheckpointExpired)))
            .unwrap();
    });
    attempt_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(done_rx.recv_timeout(Duration::from_millis(20)).is_err());
    std::thread::sleep(
        expires.saturating_duration_since(Instant::now()) + Duration::from_millis(10),
    );
    release_tx.send(()).unwrap();
    holding.join().unwrap();
    assert!(done_rx.recv_timeout(Duration::from_secs(5)).unwrap());
    waiting.join().unwrap();
    assert!(barrier.lock().unwrap().operations.is_empty());
    finish(
        barrier
            .begin_target_checkpoint_before(
                &closed,
                &window,
                NativeLane::Persistence,
                Instant::now() + Duration::from_secs(1),
            )
            .unwrap(),
    );
}

fn live(barrier: &WindowBarrier, label: &str) -> WindowToken {
    let window = barrier.admit_window(label).unwrap();
    barrier.confirm_created(&window).unwrap();
    window
}

fn finish(operation: NativeOperation) {
    operation.finish(Ok::<_, ()>(())).unwrap();
}

fn checkpoints(barrier: &WindowBarrier, closed: &ClosedTargetAdmission) {
    for window in closed.windows() {
        for lane in [NativeLane::Persistence, NativeLane::Buffers] {
            finish(
                barrier
                    .begin_target_checkpoint(closed, window, lane)
                    .unwrap(),
            );
        }
    }
}

#[test]
fn target_closure_keeps_other_session_work_and_proof_alive() {
    let barrier = WindowBarrier::new();
    let first = live(&barrier, "first");
    let second = live(&barrier, "second");
    let already_running = barrier
        .begin_session_write(&second, "B", NativeLane::Persistence)
        .unwrap();
    let closed = barrier.close_target_admission("A").unwrap();
    assert_eq!(closed.session_id(), "A");
    assert!(matches!(
        barrier.begin_session_write(&first, "A", NativeLane::Persistence),
        Err(BarrierError::AdmissionClosed)
    ));
    checkpoints(&barrier, &closed);
    let proof = barrier.prove_target_native_idle(&closed).unwrap();
    finish(already_running);
    for _ in 0..10 {
        finish(
            barrier
                .begin_session_write(&second, "B", NativeLane::Persistence)
                .unwrap(),
        );
    }
    assert_eq!(
        barrier
            .with_target_native_idle(&proof, str::to_owned)
            .unwrap(),
        "A"
    );
}

#[test]
fn accepted_target_work_must_settle_before_any_checkpoint() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let work = barrier
        .begin_session_write(&window, "A", NativeLane::Persistence)
        .unwrap();
    let closed = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.begin_target_checkpoint(&closed, &window, NativeLane::Buffers),
        Err(BarrierError::PendingNativeOperations)
    ));
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    finish(work);
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    checkpoints(&barrier, &closed);
    assert!(barrier.prove_target_native_idle(&closed).is_ok());
}

#[test]
fn shared_and_process_work_overlap_every_target_and_no_new_shared_work_crosses() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let shared = barrier
        .begin_native_write(&window, NativeLane::Buffers)
        .unwrap();
    let process = barrier.begin_process_write().unwrap();
    let closed = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.begin_process_write(),
        Err(BarrierError::AdmissionClosed)
    ));
    assert!(matches!(
        barrier.begin_native_write(&window, NativeLane::Buffers),
        Err(BarrierError::AdmissionClosed)
    ));
    assert!(matches!(
        barrier.begin_writer(&window),
        Err(BarrierError::AdmissionClosed)
    ));
    finish(shared);
    assert!(matches!(
        barrier.begin_target_checkpoint(&closed, &window, NativeLane::Persistence),
        Err(BarrierError::PendingNativeOperations)
    ));
    finish(process);
    checkpoints(&barrier, &closed);
    assert!(barrier.prove_target_native_idle(&closed).is_ok());
}

#[test]
fn checkpoint_lifetime_and_repeated_lane_invalidate_old_target_proof() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    checkpoints(&barrier, &closed);
    let proof = barrier.prove_target_native_idle(&closed).unwrap();
    let work = barrier
        .begin_target_checkpoint(&closed, &window, NativeLane::Buffers)
        .unwrap();
    assert!(matches!(
        barrier.with_target_native_idle(&proof, |_| ()),
        Err(BarrierError::StaleProof)
    ));
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    finish(work);
    assert!(barrier.prove_target_native_idle(&closed).is_ok());
    assert!(matches!(
        barrier.with_target_native_idle(&proof, |_| ()),
        Err(BarrierError::StaleProof)
    ));
}

#[test]
fn every_window_needs_both_target_checkpoint_lanes() {
    let barrier = WindowBarrier::new();
    let first = live(&barrier, "first");
    let second = live(&barrier, "second");
    let closed = barrier.close_target_admission("A").unwrap();
    for lane in [NativeLane::Persistence, NativeLane::Buffers] {
        finish(
            barrier
                .begin_target_checkpoint(&closed, &first, lane)
                .unwrap(),
        );
    }
    finish(
        barrier
            .begin_target_checkpoint(&closed, &second, NativeLane::Persistence)
            .unwrap(),
    );
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    finish(
        barrier
            .begin_target_checkpoint(&closed, &second, NativeLane::Buffers)
            .unwrap(),
    );
    assert!(barrier.prove_target_native_idle(&closed).is_ok());
}

#[test]
fn independent_closed_targets_and_their_checkpoint_rounds_do_not_cross() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let first = barrier.close_target_admission("A").unwrap();
    let second = barrier.close_target_admission("B").unwrap();
    checkpoints(&barrier, &first);
    let proof = barrier.prove_target_native_idle(&first).unwrap();
    checkpoints(&barrier, &second);
    assert!(barrier.prove_target_native_idle(&second).is_ok());
    assert!(barrier.with_target_native_idle(&proof, |_| ()).is_ok());
    barrier.reopen_target_admission(first).unwrap();
    finish(
        barrier
            .begin_session_write(&window, "A", NativeLane::Persistence)
            .unwrap(),
    );
    assert!(matches!(
        barrier.begin_session_write(&window, "B", NativeLane::Persistence),
        Err(BarrierError::AdmissionClosed)
    ));
}

#[test]
fn profile_and_target_closures_are_mutually_exclusive() {
    let barrier = WindowBarrier::new();
    live(&barrier, "main");
    let profile = barrier.close_admission().unwrap();
    assert!(matches!(
        barrier.close_target_admission("A"),
        Err(BarrierError::AdmissionAlreadyClosed)
    ));
    barrier.reopen_admission(profile).unwrap();
    let target = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.close_admission(),
        Err(BarrierError::AdmissionAlreadyClosed)
    ));
    assert!(matches!(
        barrier.close_target_admission("A"),
        Err(BarrierError::AdmissionAlreadyClosed)
    ));
    barrier.reopen_target_admission(target).unwrap();
    assert!(barrier.close_admission().is_ok());
}

#[test]
fn closure_and_proof_are_bound_to_the_exact_barrier() {
    let barrier = WindowBarrier::new();
    let other = WindowBarrier::new();
    let first = live(&barrier, "main");
    let second = live(&other, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        other.begin_target_checkpoint(&closed, &second, NativeLane::Buffers),
        Err(BarrierError::ForeignToken)
    ));
    assert!(matches!(
        barrier.begin_target_checkpoint(&closed, &second, NativeLane::Buffers),
        Err(BarrierError::ForeignToken)
    ));
    checkpoints(&barrier, &closed);
    let proof = barrier.prove_target_native_idle(&closed).unwrap();
    assert!(matches!(
        other.with_target_native_idle(&proof, |_| ()),
        Err(BarrierError::ForeignToken)
    ));
    assert!(matches!(
        other.begin_session_write(&first, "B", NativeLane::Persistence),
        Err(BarrierError::ForeignToken)
    ));
    assert!(matches!(
        other.reopen_target_admission(closed),
        Err(BarrierError::ForeignToken)
    ));
}

#[test]
fn new_native_window_invalidates_target_roster_without_stopping_other_session() {
    let barrier = WindowBarrier::new();
    let first = live(&barrier, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    checkpoints(&barrier, &closed);
    let proof = barrier.prove_target_native_idle(&closed).unwrap();
    let second = live(&barrier, "other");
    assert!(matches!(
        barrier.with_target_native_idle(&proof, |_| ()),
        Err(BarrierError::StaleProof)
    ));
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::StaleAdmission)
    ));
    assert!(matches!(
        barrier.begin_target_checkpoint(&closed, &first, NativeLane::Buffers),
        Err(BarrierError::StaleAdmission)
    ));
    finish(
        barrier
            .begin_session_write(&second, "B", NativeLane::Persistence)
            .unwrap(),
    );
    barrier.reopen_target_admission(closed).unwrap();
    finish(
        barrier
            .begin_session_write(&first, "A", NativeLane::Persistence)
            .unwrap(),
    );
}

#[test]
fn reload_and_same_label_aba_cannot_complete_an_old_checkpoint() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    let pending = barrier
        .begin_target_checkpoint(&closed, &window, NativeLane::Buffers)
        .unwrap();
    let replacement = barrier.observe_reloaded(&window).unwrap();
    finish(pending); // Actual successful native result remains successful.
    assert!(barrier.prove_target_native_idle(&closed).is_err());
    assert!(matches!(
        barrier.begin_session_write(&window, "B", NativeLane::Persistence),
        Err(BarrierError::StaleWindow)
    ));
    finish(
        barrier
            .begin_session_write(&replacement, "B", NativeLane::Persistence)
            .unwrap(),
    );
    barrier.reopen_target_admission(closed).unwrap();
    assert!(barrier.close_target_admission("A").is_err()); // Lost old operation owner taints coverage.
}

#[test]
fn failed_or_dropped_real_work_never_becomes_target_idle() {
    for abandon in [false, true] {
        let barrier = WindowBarrier::new();
        let window = live(&barrier, "main");
        let operation = barrier
            .begin_session_write(&window, "A", NativeLane::Persistence)
            .unwrap();
        let closed = barrier.close_target_admission("A").unwrap();
        if abandon {
            drop(operation);
        } else {
            assert!(operation.finish(Err::<(), _>("SQL failed")).is_err());
        }
        assert!(barrier.prove_target_native_idle(&closed).is_err());
        assert!(barrier
            .begin_target_checkpoint(&closed, &window, NativeLane::Persistence)
            .is_err());
        finish(
            barrier
                .begin_session_write(&window, "B", NativeLane::Persistence)
                .unwrap(),
        );
        barrier.reopen_target_admission(closed).unwrap();
        finish(
            barrier
                .begin_session_write(&window, "A", NativeLane::Persistence)
                .unwrap(),
        );
        assert!(barrier.close_target_admission("A").is_err());
    }
}

#[test]
fn unqualified_fallback_preserves_other_work_but_denies_all_proof() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    barrier.admit_unqualified_session_write("B").unwrap();
    assert!(matches!(
        barrier.admit_unqualified_session_write("A"),
        Err(BarrierError::AdmissionClosed)
    ));
    assert!(matches!(
        barrier.admit_unqualified_write(),
        Err(BarrierError::AdmissionClosed)
    ));
    assert!(barrier.prove_target_native_idle(&closed).is_err());
    barrier.reopen_target_admission(closed).unwrap();
    finish(
        barrier
            .begin_session_write(&window, "A", NativeLane::Persistence)
            .unwrap(),
    );
}

#[test]
fn reopening_and_reclosing_cannot_reuse_old_target_proof() {
    let barrier = WindowBarrier::new();
    live(&barrier, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    checkpoints(&barrier, &closed);
    let proof = barrier.prove_target_native_idle(&closed).unwrap();
    barrier.reopen_target_admission(closed).unwrap();
    let next = barrier.close_target_admission("A").unwrap();
    checkpoints(&barrier, &next);
    assert!(barrier.prove_target_native_idle(&next).is_ok());
    assert!(matches!(
        barrier.with_target_native_idle(&proof, |_| ()),
        Err(BarrierError::StaleProof)
    ));
}

#[test]
fn no_windows_or_pending_windows_cannot_prove_target_idle() {
    let barrier = WindowBarrier::new();
    let closed = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::EmptyWindowRoster)
    ));
    barrier.reopen_target_admission(closed).unwrap();
    let pending = barrier.admit_window("main").unwrap();
    let closed = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.begin_target_checkpoint(&closed, &pending, NativeLane::Buffers),
        Err(BarrierError::PendingNativeWindow)
    ));
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::PendingNativeWindow)
    ));
}

#[test]
fn target_capacity_does_not_disable_unrelated_ordinary_session_work() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let mut tokens = Vec::new();
    for index in 0..MAX_TARGET_CLOSURES {
        tokens.push(
            barrier
                .close_target_admission(&format!("target-{index}"))
                .unwrap(),
        );
    }
    assert!(matches!(
        barrier.close_target_admission("extra"),
        Err(BarrierError::CapacityExceeded)
    ));
    finish(
        barrier
            .begin_session_write(&window, "unrelated", NativeLane::Persistence)
            .unwrap(),
    );
    for token in tokens {
        barrier.reopen_target_admission(token).unwrap();
    }
    assert!(barrier.close_target_admission("extra").is_ok());
}

#[test]
fn invalid_session_scopes_cannot_collide_with_shared_or_valid_targets() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    for id in [
        "".to_owned(),
        "a\0b".to_owned(),
        "a\nb".to_owned(),
        "x".repeat(MAX_SESSION_BYTES + 1),
    ] {
        assert!(matches!(
            barrier.close_target_admission(&id),
            Err(BarrierError::InvalidSessionScope)
        ));
        assert!(matches!(
            barrier.begin_session_write(&window, &id, NativeLane::Persistence),
            Err(BarrierError::InvalidSessionScope)
        ));
    }
    assert!(barrier.close_target_admission("valid-session").is_ok());
}

#[test]
fn actual_background_lifetime_does_not_release_on_waiter_detachment() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let work = barrier
        .begin_session_write(&window, "A", NativeLane::Persistence)
        .unwrap();
    let (release, wait) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        wait.recv().unwrap();
        finish(work);
    });
    let closed = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.prove_target_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    finish(
        barrier
            .begin_session_write(&window, "B", NativeLane::Persistence)
            .unwrap(),
    );
    release.send(()).unwrap();
    worker.join().unwrap();
    checkpoints(&barrier, &closed);
    assert!(barrier.prove_target_native_idle(&closed).is_ok());
}

#[test]
fn old_checkpoint_completion_cannot_certify_a_reopened_new_round() {
    let barrier = WindowBarrier::new();
    let window = live(&barrier, "main");
    let first = barrier.close_target_admission("A").unwrap();
    let old_work = barrier
        .begin_target_checkpoint(&first, &window, NativeLane::Buffers)
        .unwrap();
    barrier.reopen_target_admission(first).unwrap();
    let second = barrier.close_target_admission("A").unwrap();
    assert!(matches!(
        barrier.begin_target_checkpoint(&second, &window, NativeLane::Persistence),
        Err(BarrierError::PendingNativeOperations)
    ));
    finish(old_work);
    finish(
        barrier
            .begin_target_checkpoint(&second, &window, NativeLane::Persistence)
            .unwrap(),
    );
    assert!(matches!(
        barrier.prove_target_native_idle(&second),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    finish(
        barrier
            .begin_target_checkpoint(&second, &window, NativeLane::Buffers)
            .unwrap(),
    );
    assert!(barrier.prove_target_native_idle(&second).is_ok());
}

#[test]
fn poisoned_tracking_never_hides_target_gate_and_preserves_unknown_other_work() {
    let barrier = WindowBarrier::new();
    live(&barrier, "main");
    let closed = barrier.close_target_admission("A").unwrap();
    let state = barrier.state.clone();
    let _ = std::panic::catch_unwind(move || {
        let _guard = state.lock().unwrap();
        panic!("tracking failed");
    });
    barrier.admit_unqualified_session_write("B").unwrap();
    assert!(matches!(
        barrier.admit_unqualified_session_write("A"),
        Err(BarrierError::AdmissionClosed)
    ));
    assert!(matches!(
        barrier.admit_unqualified_write(),
        Err(BarrierError::AdmissionClosed)
    ));
    assert!(barrier.prove_target_native_idle(&closed).is_err());
}
