use super::*;
use crate::control::writes::fixtures as turns;
use crate::control::{finish_original_turn, ControlHost, ControlTurnReceipt};
use crate::harness::process_construction_tests::{publish, ProcessFixture};

struct Warm {
    host: Arc<HarnessHost>,
    control: Arc<ControlHost>,
    process: ProcessFixture,
    issuer: Arc<crate::control::receipts::WindowIssuer>,
    route: String,
}
impl Warm {
    fn new(route: &str) -> Self {
        let host = Arc::new(HarnessHost::new());
        let process = ProcessFixture::new(&host, route, None);
        publish(&host, route, &process.live);
        let issuer = process.live.issuer.as_ref().unwrap().clone();
        Self {
            host,
            control: Arc::new(turns::host()),
            process,
            issuer,
            route: route.into(),
        }
    }
    fn authorize(&self) -> ControlTurnReceipt {
        turns::authorize(
            &self.control,
            &self.issuer,
            &self.route,
            &self.process.live.cwd,
        )
        .unwrap()
    }
    fn bind(&self, receipt: &ControlTurnReceipt) -> ChildTurnBinding {
        bind_original(
            &self.host,
            &self.control,
            &self.issuer,
            "original-window",
            &self.route,
            self.process.live.clone(),
            receipt.clone(),
        )
        .unwrap()
    }
    fn admit(&self, binding: &ChildTurnBinding) -> Result<StrictWrite, String> {
        admit_original(
            &self.host,
            &self.control,
            &self.issuer,
            "original-window",
            &self.route,
            &self.process.live,
            binding,
        )
        .map(|(_, admission)| admission)
    }
    fn write(&self, binding: &ChildTurnBinding, line: &str) {
        write_controlled(
            self.process.live.clone(),
            line.into(),
            None,
            self.admit(binding).unwrap(),
            || {},
        )
        .unwrap();
    }
    fn spawn_bind(
        &self,
        receipt: &ControlTurnReceipt,
    ) -> (
        thread::JoinHandle<()>,
        mpsc::Receiver<Result<ChildTurnBinding, String>>,
    ) {
        let host = self.host.clone();
        let control = self.control.clone();
        let issuer = self.issuer.clone();
        let route = self.route.clone();
        let live = self.process.live.clone();
        let receipt = receipt.clone();
        let (send, done) = mpsc::channel();
        let task = thread::spawn(move || {
            let _ = send.send(bind_original(
                &host,
                &control,
                &issuer,
                "original-window",
                &route,
                live,
                receipt,
            ));
        });
        (task, done)
    }
    fn await_binding_count(&self, count: usize) {
        until(|| self.host.lock_inner().turn_bindings.records.len() == count);
    }
}

fn until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            Instant::now() < deadline,
            "original lifetime transition did not occur"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

struct HeldWrite {
    release: Option<mpsc::Sender<()>>,
    task: Option<thread::JoinHandle<Result<(), String>>>,
}
impl HeldWrite {
    fn start(
        warm: &Warm,
        binding: &ChildTurnBinding,
        line: &str,
        lease: Option<crate::session_store::authority::NativeLease>,
    ) -> Self {
        let admission = warm.admit(binding).unwrap();
        let live = warm.process.live.clone();
        let line = line.to_owned();
        let (release, held) = mpsc::channel();
        let (entered, ready) = mpsc::channel();
        let task = thread::spawn(move || {
            write_controlled(live, line, lease, admission, move || {
                let _ = entered.send(());
                let _ = held.recv();
            })
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        Self {
            release: Some(release),
            task: Some(task),
        }
    }
    fn finish(mut self) -> Result<(), String> {
        self.release.take().unwrap().send(()).unwrap();
        self.task.take().unwrap().join().unwrap()
    }
}
impl Drop for HeldWrite {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
        if let Some(task) = self.task.take() {
            let _ = task.join();
        }
    }
}

#[test]
fn warm_same_process_waits_actual_a_tail_then_writes_b_and_rejects_late_a() {
    let warm = Warm::new("warm-a-b");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    assert_eq!(
        warm.bind(&a),
        aw,
        "same original pair has one source-issued binding"
    );
    let held = HeldWrite::start(&warm, &aw, "accepted-a", None);
    warm.process.await_contents("accepted-a\n");
    let b = warm.authorize();
    let (binding_task, bound) = warm.spawn_bind(&b);
    warm.await_binding_count(2);
    assert!(matches!(bound.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert!(warm.admit(&aw).is_err());
    assert!(!warm.process.live.writers.is_closing());
    held.finish().unwrap();
    let bw = bound.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    binding_task.join().unwrap();
    assert_eq!(bw.construction_id, aw.construction_id);
    assert_ne!(bw.binding_id, aw.binding_id);
    assert_eq!(bw.turn_id, b.turn_id);
    assert_eq!(warm.process.actual_pid, warm.process.live.pid);
    warm.write(&bw, "accepted-b");
    warm.process.await_contents("accepted-a\naccepted-b\n");
    finish_original_turn(&warm.control, &warm.issuer, "original-window", &a).unwrap();
    finish_original_turn(&warm.control, &warm.issuer, "original-window", &a).unwrap();
    assert!(turns::active(&warm.control, &b));
    assert!(warm.admit(&aw).is_err());
    warm.write(&bw, "b-after-old-finish");
    warm.process
        .await_contents("accepted-a\naccepted-b\nb-after-old-finish\n");
}

#[test]
fn finish_revokes_permission_first_and_holds_real_writer_lease_through_callback_tail() {
    let warm = Warm::new("warm-finish");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let lease = store
        .authority_execution_gate()
        .reserve(&warm.route, "provider-stdin", None)
        .unwrap();
    let held = HeldWrite::start(&warm, &aw, "written-before-tail", Some(lease));
    warm.process.await_contents("written-before-tail\n");
    let host = warm.control.clone();
    let issuer = warm.issuer.clone();
    let receipt = a.clone();
    let (send, done) = mpsc::channel();
    let finishing = thread::spawn(move || {
        let _ = send.send(finish_original_turn(
            &host,
            &issuer,
            "original-window",
            &receipt,
        ));
    });
    until(|| !turns::active(&warm.control, &a));
    assert!(matches!(done.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert!(warm.admit(&aw).is_err());
    let reservations: i64 = store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM native_authority_reservations WHERE session_id=?",
            [&warm.route],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        reservations, 1,
        "actual byte lease survives the held callback"
    );
    held.finish().unwrap();
    done.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    finishing.join().unwrap();
    let reservations: i64 = store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM native_authority_reservations WHERE session_id=?",
            [&warm.route],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(reservations, 0);
    assert!(
        !warm.process.live.writers.is_closing(),
        "turn completion cannot stop the warm process"
    );
    let b = warm.authorize();
    let bw = warm.bind(&b);
    warm.write(&bw, "same-process-next-turn");
    warm.process
        .await_contents("written-before-tail\nsame-process-next-turn\n");
}

#[test]
fn pending_b_cannot_bypass_held_a_when_c_supersedes_b() {
    let warm = Warm::new("warm-a-b-c");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let held = HeldWrite::start(&warm, &aw, "a-before-c", None);
    let b = warm.authorize();
    let (b_task, b_done) = warm.spawn_bind(&b);
    warm.await_binding_count(2);
    let c = warm.authorize();
    let (c_task, c_done) = warm.spawn_bind(&c);
    warm.await_binding_count(3);
    assert!(matches!(b_done.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert!(matches!(c_done.try_recv(), Err(mpsc::TryRecvError::Empty)));
    held.finish().unwrap();
    assert!(b_done
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .is_err());
    let cw = c_done
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    b_task.join().unwrap();
    c_task.join().unwrap();
    warm.write(&cw, "only-c");
    warm.process.await_contents("a-before-c\nonly-c\n");
}

#[test]
fn finish_waits_pending_original_bind_then_retires_only_its_own_authority() {
    let warm = Warm::new("warm-pending-finish");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let held = HeldWrite::start(&warm, &aw, "held-a", None);
    let b = warm.authorize();
    let (binding_task, binding_done) = warm.spawn_bind(&b);
    warm.await_binding_count(2);
    let control = warm.control.clone();
    let issuer = warm.issuer.clone();
    let original_b = b.clone();
    let (sent, done) = mpsc::channel();
    let finish = thread::spawn(move || {
        let _ = sent.send(finish_original_turn(
            &control,
            &issuer,
            "original-window",
            &original_b,
        ));
    });
    until(|| !turns::active(&warm.control, &b));
    assert!(matches!(done.try_recv(), Err(mpsc::TryRecvError::Empty)));
    held.finish().unwrap();
    assert!(binding_done
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .is_err());
    done.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    binding_task.join().unwrap();
    finish.join().unwrap();
    assert!(!warm.process.live.writers.is_closing());
    let c = warm.authorize();
    let cw = warm.bind(&c);
    warm.write(&cw, "c-after-pending-b-ended");
    warm.process
        .await_contents("held-a\nc-after-pending-b-ended\n");
}

#[test]
fn logical_binding_target_comes_from_original_output_not_physical_route_spelling() {
    let warm = Warm::new("logical-source");
    let a = warm.authorize();
    let physical = "physical-source:catalog-worker";
    warm.host
        .lock_inner()
        .children
        .insert(physical.into(), warm.process.live.clone());
    let binding = bind_original(
        &warm.host,
        &warm.control,
        &warm.issuer,
        "original-window",
        physical,
        warm.process.live.clone(),
        a.clone(),
    )
    .unwrap();
    assert_eq!(binding.session_id, "logical-source");
    assert_eq!(binding.construction_id, warm.process.live.construction_id);
    let (_, admission) = admit_original(
        &warm.host,
        &warm.control,
        &warm.issuer,
        "original-window",
        physical,
        &warm.process.live,
        &binding,
    )
    .unwrap();
    write_controlled(
        warm.process.live.clone(),
        "logical-exact".into(),
        None,
        admission,
        || {},
    )
    .unwrap();
    warm.process.await_contents("logical-exact\n");
}

#[test]
fn already_admitted_original_writer_never_retargets_replacement_even_after_route_changes() {
    let warm = Warm::new("warm-selected-original");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let admitted = warm.admit(&aw).unwrap();
    let replacement = ProcessFixture::new(&warm.host, &warm.route, Some(warm.process.actual_pid));
    publish(&warm.host, &warm.route, &replacement.live);
    write_controlled(
        warm.process.live.clone(),
        "accepted-original-only".into(),
        None,
        admitted,
        || {},
    )
    .unwrap();
    warm.process.await_contents("accepted-original-only\n");
    assert!(warm.admit(&aw).is_err());
    assert_eq!(replacement.contents(), "");
    assert!(Arc::ptr_eq(
        &warm.host.get(&warm.route).unwrap(),
        &replacement.live
    ));
}

#[test]
fn pending_bind_rechecks_actual_window_after_original_writer_drains() {
    let warm = Warm::new("warm-window");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let held = HeldWrite::start(&warm, &aw, "before-window-close", None);
    let b = warm.authorize();
    let (b_task, b_done) = warm.spawn_bind(&b);
    warm.await_binding_count(2);
    tauri::Resource::close(warm.issuer.clone());
    held.finish().unwrap();
    assert!(b_done
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .is_err());
    b_task.join().unwrap();
    assert!(warm.admit(&aw).is_err());
    assert!(!turns::work(&warm.control, &b).finished());
    warm.process.await_contents("before-window-close\n");
}

#[test]
fn exact_binding_rejects_forged_route_receipt_window_and_replaced_physical_source() {
    let warm = Warm::new("warm-source");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let serialized = serde_json::to_value(&aw).unwrap();
    assert_eq!(serialized.as_object().unwrap().len(), 5);
    assert_eq!(serialized["sessionId"], warm.route);
    let mut extra = serialized.clone();
    extra["pid"] = warm.process.actual_pid.into();
    assert!(serde_json::from_value::<ChildTurnBinding>(extra).is_err());
    assert!(serde_json::from_value::<ChildTurnBinding>(serde_json::json!({"version":1})).is_err());
    let mut fake = aw.clone();
    fake.binding_id = uuid::Uuid::new_v4().to_string();
    assert!(warm.admit(&fake).is_err());
    fake = aw.clone();
    fake.version = 2;
    assert!(warm.admit(&fake).is_err());
    fake = aw.clone();
    fake.session_id = "foreign-logical-target".into();
    assert!(warm.admit(&fake).is_err());
    let mut stale_turn = aw.clone();
    stale_turn.turn_id = uuid::Uuid::new_v4().to_string();
    assert!(warm.admit(&stale_turn).is_err());
    let mut foreign_source = aw.clone();
    foreign_source.construction_id = uuid::Uuid::new_v4().to_string();
    assert!(warm.admit(&foreign_source).is_err());
    let recreated = Arc::new(crate::control::receipts::WindowIssuer::default());
    assert!(admit_original(
        &warm.host,
        &warm.control,
        &recreated,
        "original-window",
        &warm.route,
        &warm.process.live,
        &aw
    )
    .is_err());
    assert!(admit_original(
        &warm.host,
        &warm.control,
        &warm.issuer,
        "foreign-window",
        &warm.route,
        &warm.process.live,
        &aw
    )
    .is_err());
    assert!(admit_original(
        &warm.host,
        &warm.control,
        &warm.issuer,
        "original-window",
        "foreign-route",
        &warm.process.live,
        &aw
    )
    .is_err());
    warm.write(&aw, "original-positive");
    warm.process.await_contents("original-positive\n");
    let replacement = ProcessFixture::new(&warm.host, &warm.route, Some(warm.process.actual_pid));
    publish(&warm.host, &warm.route, &replacement.live);
    assert!(warm.admit(&aw).is_err());
    assert!(admit_original(
        &warm.host,
        &warm.control,
        replacement.live.issuer.as_ref().unwrap(),
        "original-window",
        &warm.route,
        &replacement.live,
        &aw
    )
    .is_err());
    assert_eq!(replacement.contents(), "");
    assert_eq!(warm.process.contents(), "original-positive\n");
}

#[test]
fn binding_capacity_is_reserved_before_closing_original_strict_writer() {
    let warm = Warm::new("warm-capacity");
    let a = warm.authorize();
    let mut last = warm.bind(&a);
    let mut route = warm.route.clone();
    // All aliases select this actual retained process/output. No fake process
    // completion, capacity override or ledger reset supplies the 512 slots.
    for index in 1..CAPACITY {
        route = format!("capacity-original-{index}");
        warm.host
            .lock_inner()
            .children
            .insert(route.clone(), warm.process.live.clone());
        last = bind_original(
            &warm.host,
            &warm.control,
            &warm.issuer,
            "original-window",
            &route,
            warm.process.live.clone(),
            a.clone(),
        )
        .unwrap();
    }
    let refused = "capacity-refused";
    warm.host
        .lock_inner()
        .children
        .insert(refused.into(), warm.process.live.clone());
    assert_eq!(
        bind_original(
            &warm.host,
            &warm.control,
            &warm.issuer,
            "original-window",
            refused,
            warm.process.live.clone(),
            a.clone()
        )
        .unwrap_err(),
        "NATIVE_TURN_BINDING_CAPACITY"
    );
    assert!(turns::active(&warm.control, &a));
    let (_, admission) = admit_original(
        &warm.host,
        &warm.control,
        &warm.issuer,
        "original-window",
        &route,
        &warm.process.live,
        &last,
    )
    .unwrap();
    write_controlled(
        warm.process.live.clone(),
        "capacity-kept-original".into(),
        None,
        admission,
        || {},
    )
    .unwrap();
    warm.process.await_contents("capacity-kept-original\n");
    finish_original_turn(&warm.control, &warm.issuer, "original-window", &a).unwrap();
    let b = warm.authorize();
    let bw = warm.bind(&b);
    warm.write(&bw, "after-known-byte-retirement");
    warm.process
        .await_contents("capacity-kept-original\nafter-known-byte-retirement\n");
}

#[test]
fn controlled_authority_refusal_has_no_pipe_or_process_stop_effect() {
    let warm = Warm::new("warm-authority-denied");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let lease = store
        .authority_execution_gate()
        .reserve(&warm.route, "provider-stdin", None)
        .unwrap();
    store.lock_conn().unwrap().execute(
        "INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol) VALUES('env',?,1,'FENCED','migration',2)", [&warm.route]).unwrap();
    let result = write_controlled(
        warm.process.live.clone(),
        "denied".into(),
        Some(lease),
        warm.admit(&aw).unwrap(),
        || {},
    );
    assert!(result.is_err());
    assert_eq!(warm.process.contents(), "");
    assert!(!warm.process.live.writers.is_closing());
    finish_original_turn(&warm.control, &warm.issuer, "original-window", &a).unwrap();
    assert!(turns::work(&warm.control, &a).finished());
}

#[test]
fn failed_real_stdin_keeps_turn_and_authority_unknown_after_actual_writer_completion() {
    let warm = Warm::new("warm-failed-pipe");
    let a = warm.authorize();
    let aw = warm.bind(&a);
    let admission = warm.admit(&aw).unwrap();
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let lease = store
        .authority_execution_gate()
        .reserve(&warm.route, "provider-stdin", None)
        .unwrap();
    warm.process.live.request_stop().unwrap();
    let process = warm.process.live.process.as_ref().unwrap();
    until(|| process.exit_observed() && process.signals_closed());
    let result = write_controlled(
        warm.process.live.clone(),
        "cannot-arrive".into(),
        Some(lease),
        admission,
        || {},
    );
    assert!(result
        .unwrap_err()
        .contains("Failed to write original controlled harness"));
    assert!(finish_original_turn(&warm.control, &warm.issuer, "original-window", &a).is_err());
    assert!(!turns::active(&warm.control, &a));
    assert!(!turns::work(&warm.control, &a).finished());
    let reservations: i64 = store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM native_authority_reservations WHERE session_id=?",
            [&warm.route],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(reservations, 1);
    assert_eq!(warm.process.contents(), "");
}
