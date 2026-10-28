use super::launch::{Admission, IntentRequest, LaunchLedger, LaunchWork, ReceiptState};
use super::*;
use crate::session_store::window_barrier::{BarrierError, NativeLane, WindowBarrier, WindowToken};

fn window(barrier: &WindowBarrier, label: &str) -> WindowToken {
    let token = barrier.admit_window(label).unwrap();
    barrier.confirm_created(&token).unwrap();
    token
}
fn admission(barrier: &WindowBarrier, token: &WindowToken) -> NativeWriteAdmission {
    NativeWriteAdmission::Tracked(
        barrier
            .begin_native_write(token, NativeLane::Buffers)
            .unwrap(),
    )
}
fn checkpoints(
    barrier: &WindowBarrier,
    closed: &crate::session_store::window_barrier::ClosedAdmission,
    token: &WindowToken,
) {
    for lane in [NativeLane::Persistence, NativeLane::Buffers] {
        barrier
            .begin_native_checkpoint(closed, token, lane)
            .unwrap()
            .finish(Ok::<_, ()>(()))
            .unwrap();
    }
}

#[test]
fn dropped_capture_waiter_does_not_release_worker_lease_or_busy_claim() {
    let barrier = WindowBarrier::new();
    let token = window(&barrier, "quick");
    let busy = Arc::new(AtomicBool::new(false));
    let work = CaptureWork::claim(admission(&barrier, &token), busy.clone()).unwrap();
    let (release, wait) = std::sync::mpsc::sync_channel(1);
    let (answer, receiver) = std::sync::mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        wait.recv().unwrap();
        let result = work.finish(Ok::<_, ()>("actual file/grant result"));
        let _ = answer.send(result);
    });
    drop(receiver);
    let closed = barrier.close_admission().unwrap();
    assert!(busy.load(Ordering::Acquire));
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    release.send(()).unwrap();
    worker.join().unwrap();
    assert!(!busy.load(Ordering::Acquire));
    checkpoints(&barrier, &closed, &token);
    assert!(barrier.prove_native_idle(&closed).is_ok());
}

#[test]
fn unfinished_capture_is_unknown_but_ordinary_native_work_still_functions() {
    let barrier = WindowBarrier::new();
    let token = window(&barrier, "quick");
    let busy = Arc::new(AtomicBool::new(false));
    drop(CaptureWork::claim(admission(&barrier, &token), busy.clone()).unwrap());
    assert!(!busy.load(Ordering::Acquire));
    assert!(matches!(
        barrier.close_admission(),
        Err(BarrierError::UnfinishedNativeOperation)
    ));
    admission(&barrier, &token).finish(Ok::<_, ()>(())).unwrap();
}

#[test]
fn busy_rejection_cannot_clear_the_first_actual_claim() {
    let busy = Arc::new(AtomicBool::new(false));
    let first = CaptureWork::claim(NativeWriteAdmission::Unqualified, busy.clone()).unwrap();
    assert!(CaptureWork::claim(NativeWriteAdmission::Unqualified, busy.clone()).is_err());
    assert!(busy.load(Ordering::Acquire));
    first.finish(Ok::<_, ()>(())).unwrap();
    assert!(!busy.load(Ordering::Acquire));
}

#[test]
fn popup_holds_both_real_admissions_until_actual_completion() {
    let barrier = WindowBarrier::new();
    let parent = window(&barrier, "quick");
    let popup = window(&barrier, "git");
    let work = PopupWork::new(admission(&barrier, &parent), admission(&barrier, &popup));
    let closed = barrier.close_admission().unwrap();
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    work.finish(Ok::<_, ()>(())).unwrap();
    checkpoints(&barrier, &closed, &parent);
    checkpoints(&barrier, &closed, &popup);
    assert!(barrier.prove_native_idle(&closed).is_ok());
}

#[test]
fn same_label_resource_replacement_never_matches_an_old_physical_owner() {
    let mut first = ResourceTable::default();
    let old = QuickWindowOwner::install(&mut first).unwrap();
    assert!(old.same(&QuickWindowOwner::get(&first).unwrap()));
    let mut next = ResourceTable::default();
    let new = QuickWindowOwner::install(&mut next).unwrap();
    assert!(!old.same(&new));
    assert!(!old.matches(&next));
    assert!(new.matches(&next));
    old.retire();
    assert!(!old.matches(&first));
    assert!(new.matches(&next));
}

#[test]
fn scope_is_bound_to_actual_resource_and_native_store_construction() {
    let mut resources = ResourceTable::default();
    let owner = QuickWindowOwner::install(&mut resources).unwrap();
    let first_store = uuid::Uuid::new_v4();
    let first = owner.scope(first_store).unwrap();
    assert!(!first.qualified);
    assert_eq!(first.next_sequence, 1);
    owner
        .with_scope(&first.scope, first_store, |next| {
            *next += 1;
            Ok(())
        })
        .unwrap();
    assert_eq!(owner.scope(first_store).unwrap().next_sequence, 2);
    let next_store = uuid::Uuid::new_v4();
    assert!(owner
        .with_scope(&first.scope, next_store, |_| Ok(()))
        .is_err());
    let next = owner.scope(next_store).unwrap();
    assert_eq!(next.next_sequence, 2);
    assert_ne!(first.scope, next.scope);
    assert!(owner
        .with_scope(&first.scope, first_store, |_| Ok(()))
        .is_err());
    assert_eq!(MAX_SEQUENCE, 9_007_199_254_740_991);
}

fn intent(sequence: u64) -> IntentRequest {
    serde_json::from_value(serde_json::json!({ "version": 1,
        "scope": { "windowEpoch": uuid::Uuid::new_v4(), "storeInstance": uuid::Uuid::new_v4() },
        "sequence": sequence, "intentId": uuid::Uuid::new_v4(),
        "request": { "prompt": "first", "cwd": "/repo", "harness": "codex", "reveal": false }
    }))
    .unwrap()
}
fn reserve(ledger: &mut LaunchLedger, next: &mut u64, request: &IntentRequest) -> launch::Ticket {
    let Admission::Start(ticket) = ledger
        .reserve(next, request, &request.digest().unwrap())
        .unwrap()
    else {
        panic!("fresh execution")
    };
    ticket
}
#[test]
fn pending_precedes_effects_duplicate_joins_and_exact_fence_rejects_skips() {
    let mut ledger = LaunchLedger::default();
    let mut next = 1;
    let request = intent(1);
    let digest = request.digest().unwrap();
    let ticket = reserve(&mut ledger, &mut next, &request);
    assert_eq!(next, 2);
    assert_eq!(
        ledger.status(&request, &digest).unwrap().state,
        ReceiptState::Pending
    );
    let Admission::Existing(duplicate) = ledger.reserve(&mut next, &request, &digest).unwrap()
    else {
        panic!("replayed effects")
    };
    assert_eq!(duplicate.delivery_id.as_deref(), Some(ticket.delivery_id()));
    let mut changed = request.clone();
    changed.request.prompt = "different".into();
    assert!(ledger
        .reserve(&mut next, &changed, &changed.digest().unwrap())
        .is_err());
    let skip = intent(3);
    let Admission::Existing(skipped) = ledger
        .reserve(&mut next, &skip, &skip.digest().unwrap())
        .unwrap()
    else {
        panic!("skip admitted")
    };
    assert_eq!(skipped.state, ReceiptState::Unavailable);
    assert_eq!(next, 2);
    ledger.settle(ticket, ReceiptState::Unknown).unwrap();
    assert!(matches!(
        ledger.reserve(&mut next, &request, &digest).unwrap(),
        Admission::Existing(_)
    ));
}
#[test]
fn actual_job_retains_admission_when_waiter_disappears_and_drop_is_unknown() {
    let barrier = WindowBarrier::new();
    let token = window(&barrier, "quick");
    let ledger = Arc::new(Mutex::new(LaunchLedger::default()));
    let mut next = 1;
    let request = intent(1);
    let digest = request.digest().unwrap();
    let ticket = reserve(&mut ledger.lock().unwrap(), &mut next, &request);
    let mut work = LaunchWork::new(ledger.clone(), ticket);
    assert_eq!(work.scope(), &request.scope);
    assert!(!work.delivery_id().is_empty());
    work.admitted(admission(&barrier, &token));
    let (send, receive) = std::sync::mpsc::channel();
    let (done, waiter) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        receive.recv().unwrap();
        let _ = done.send(work.finish(ReceiptState::Queued));
    });
    drop(waiter);
    let closed = barrier.close_admission().unwrap();
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    send.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(
        ledger
            .lock()
            .unwrap()
            .status(&request, &digest)
            .unwrap()
            .state,
        ReceiptState::Queued
    );
    checkpoints(&barrier, &closed, &token);
    assert!(barrier.prove_native_idle(&closed).is_ok());
    let second = intent(2);
    let ticket = reserve(&mut ledger.lock().unwrap(), &mut next, &second);
    drop(LaunchWork::new(ledger.clone(), ticket));
    assert_eq!(
        ledger
            .lock()
            .unwrap()
            .status(&second, &second.digest().unwrap())
            .unwrap()
            .state,
        ReceiptState::Unknown
    );
}
#[test]
fn failed_tuple_never_rearms_and_ack_requires_existing_queue_entry() {
    let mut ledger = LaunchLedger::default();
    let mut next = 1;
    let request = intent(1);
    let digest = request.digest().unwrap();
    let ticket = reserve(&mut ledger, &mut next, &request);
    let delivery_id = ticket.delivery_id().to_owned();
    ledger.settle(ticket, ReceiptState::Failed).unwrap();
    assert_eq!(
        ledger.status(&request, &digest).unwrap().state,
        ReceiptState::Failed
    );
    let Admission::Existing(terminal) = ledger.reserve(&mut next, &request, &digest).unwrap()
    else {
        panic!("terminal tuple rearmed")
    };
    assert_eq!(terminal.state, ReceiptState::Failed);
    assert_eq!(terminal.delivery_id.as_deref(), Some(delivery_id.as_str()));
    assert_eq!(next, 2);
    let request = intent(2);
    let digest = request.digest().unwrap();
    let ticket = reserve(&mut ledger, &mut next, &request);
    let delivery_id = ticket.delivery_id().to_owned();
    ledger.settle(ticket, ReceiptState::Queued).unwrap();
    let store = uuid::Uuid::new_v4();
    let mut queue = delivery::LaunchQueue::default();
    assert!(queue.has_capacity());
    queue.push_reserved(
        request.request.clone(),
        "workspace".into(),
        delivery_id.clone(),
        Some(store),
    );
    assert!(queue
        .claim_for_store("workspace", Some(uuid::Uuid::new_v4()), |_| true)
        .is_none());
    assert_eq!(
        queue
            .claim_for_store("workspace", Some(store), |_| true)
            .unwrap()
            .id,
        delivery_id
    );
    assert!(!queue.acknowledge_in_store("workspace", &delivery_id, Some(uuid::Uuid::new_v4())));
    if queue.acknowledge("wrong", &delivery_id) {
        ledger.acknowledge_existing(&delivery_id);
    }
    assert_eq!(
        ledger.status(&request, &digest).unwrap().state,
        ReceiptState::Queued
    );
    if queue.acknowledge("workspace", &delivery_id) {
        ledger.acknowledge_existing(&delivery_id);
    }
    assert_eq!(
        ledger.status(&request, &digest).unwrap().state,
        ReceiptState::Acknowledged
    );
    assert!(!queue.acknowledge("workspace", &delivery_id));
}
#[test]
fn full_unknown_ledger_never_evicts_and_compacted_ack_fence_cannot_replay() {
    let mut ledger = LaunchLedger::default();
    let mut next = 1;
    let first = intent(1);
    let ticket = reserve(&mut ledger, &mut next, &first);
    let first_id = ticket.delivery_id().to_owned();
    ledger.settle(ticket, ReceiptState::Queued).unwrap();
    for sequence in 2..=128 {
        let request = intent(sequence);
        let ticket = reserve(&mut ledger, &mut next, &request);
        ledger.settle(ticket, ReceiptState::Unknown).unwrap();
    }
    let latest = intent(129);
    let Admission::Existing(full) = ledger
        .reserve(&mut next, &latest, &latest.digest().unwrap())
        .unwrap()
    else {
        panic!("evicted unknown")
    };
    assert_eq!(full.state, ReceiptState::Unavailable);
    assert_eq!(next, 129);
    ledger.acknowledge_existing(&first_id);
    let ticket = reserve(&mut ledger, &mut next, &latest);
    ledger.settle(ticket, ReceiptState::Queued).unwrap();
    let Admission::Existing(old) = ledger
        .reserve(&mut next, &first, &first.digest().unwrap())
        .unwrap()
    else {
        panic!("replayed compacted sequence")
    };
    assert_eq!(old.state, ReceiptState::Unknown);
    assert_eq!(next, 130);
    assert_eq!(
        ledger
            .status(&first, &first.digest().unwrap())
            .unwrap()
            .state,
        ReceiptState::Unknown
    );
}
#[test]
fn new_envelope_is_closed_and_bounded_but_legacy_dto_remains_compatible() {
    assert!(bounded_json_size(&serde_json::json!({ "branch": "main" }), 32).is_ok());
    assert!(bounded_json_size(&serde_json::json!({ "branch": "x".repeat(128) }), 32).is_err());
    let request = intent(1);
    let mut value = serde_json::json!({ "version": 1, "scope": request.scope,
        "sequence": 1, "intentId": request.intent_id, "request": request.request });
    value["request"]["unknown"] = true.into();
    assert!(serde_json::from_value::<IntentRequest>(value).is_err());
    let mut request = intent(1);
    request.request.prompt = "x".repeat(256 * 1024 + 1);
    assert!(request.digest().is_err());
    let mut request = intent(1);
    request.intent_id = uuid::Uuid::nil().to_string();
    assert!(request.digest().is_err());
    let mut request = intent(1);
    request.request.cwd = "x".repeat(1024 * 1024);
    assert!(request.digest().is_err());
}

#[test]
fn observed_verified_failures_can_compact_without_reopening_old_sequence() {
    let mut ledger = LaunchLedger::default();
    let mut next = 1;
    let first = intent(1);
    let ticket = reserve(&mut ledger, &mut next, &first);
    ledger.settle(ticket, ReceiptState::Failed).unwrap();
    for sequence in 2..=128 {
        let request = intent(sequence);
        let ticket = reserve(&mut ledger, &mut next, &request);
        ledger.settle(ticket, ReceiptState::Failed).unwrap();
    }
    let latest = intent(129);
    let Admission::Existing(full) = ledger
        .reserve(&mut next, &latest, &latest.digest().unwrap())
        .unwrap()
    else {
        panic!("unobserved failure evicted")
    };
    assert_eq!(full.state, ReceiptState::Unavailable);
    assert_eq!(
        ledger
            .status(&first, &first.digest().unwrap())
            .unwrap()
            .state,
        ReceiptState::Failed
    );
    let ticket = reserve(&mut ledger, &mut next, &latest);
    ledger.settle(ticket, ReceiptState::Unknown).unwrap();
    let Admission::Existing(old) = ledger
        .reserve(&mut next, &first, &first.digest().unwrap())
        .unwrap()
    else {
        panic!("replayed compacted failure")
    };
    assert_eq!(old.state, ReceiptState::Unknown);
    assert_eq!(next, 130);
}
