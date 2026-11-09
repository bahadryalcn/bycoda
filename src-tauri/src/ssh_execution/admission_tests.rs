//! Real Window persistence admission + runbook SQL; isolated local children only.
use super::*;
use crate::native_window_lifecycle::{
    test_admit_window_persistence, test_buffer_resources, test_reload_buffer_resources,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use crate::session_store::SessionStore;
use std::sync::{mpsc, Condvar};

const WAIT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    changed: Condvar,
}
impl Gate {
    fn wait(&self) {
        let open = self.open.lock().unwrap();
        let (open, _) = self
            .changed
            .wait_timeout_while(open, WAIT, |open| !*open)
            .unwrap();
        assert!(*open, "original test work was not released");
    }
    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.changed.notify_all();
    }
}
fn until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !condition() {
        assert!(
            Instant::now() < deadline,
            "actual SSH worker did not settle"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn batch(engine: &SshExecutions, id: &str) -> Arc<Batch> {
    engine.runs.lock().unwrap().get(id).unwrap().clone()
}
fn tracked(barrier: &WindowBarrier, resources: &tauri::ResourceTable) -> NativeWriteAdmission {
    let admission = test_admit_window_persistence(resources, Some(barrier)).unwrap();
    assert!(matches!(&admission, NativeWriteAdmission::Tracked(_)));
    admission
}
struct SqlPersistence {
    store: Arc<SessionStore>,
    final_gate: Option<Arc<Gate>>,
    final_entered: AtomicBool,
    fail_final: AtomicBool,
    panic_final: AtomicBool,
    loads: AtomicUsize,
    updates: AtomicUsize,
}
impl SqlPersistence {
    fn new(count: usize, limits: ExecutionLimits, final_gate: Option<Arc<Gate>>) -> Self {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        crate::ssh_runbooks::test_save_runbook(
            &store.lock_conn().unwrap(),
            &crate::ssh_runbooks::Profile {
                id: book().automation_id,
                name: "Actual admitted runbook fixture".into(),
                revision: 0,
                script: book().script,
                shell: book().shell,
                target_ids: targets(count)
                    .iter()
                    .map(|target| target.server_id.clone())
                    .collect(),
                limits,
                triggers: None,
            },
        )
        .unwrap();
        Self {
            store,
            final_gate,
            final_entered: AtomicBool::new(false),
            fail_final: AtomicBool::new(false),
            panic_final: AtomicBool::new(false),
            loads: AtomicUsize::new(0),
            updates: AtomicUsize::new(0),
        }
    }
    fn read(&self, id: &str) -> RunStatus {
        crate::ssh_runbooks::test_read_run(&self.store.lock_conn().unwrap(), id)
            .unwrap()
            .unwrap()
    }
}
impl RunPersistence for SqlPersistence {
    fn claim(&self, status: &RunStatus) -> Result<ClaimResult, String> {
        let mut conn = self.store.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let result = crate::ssh_runbooks::test_claim_run(&tx, status)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    fn update(&self, status: &RunStatus) -> Result<(), String> {
        self.updates.fetch_add(1, Ordering::AcqRel);
        if status.finished() {
            assert!(
                !self.panic_final.load(Ordering::Acquire),
                "actual final callback panic"
            );
            if self.fail_final.load(Ordering::Acquire) {
                return Err("actual final SQL refused".into());
            }
        }
        let connection = self.store.lock_conn()?;
        crate::ssh_runbooks::test_update_run(&connection, status)?;
        drop(connection);
        if status.finished() {
            self.final_entered.store(true, Ordering::Release);
            if let Some(gate) = &self.final_gate {
                // Actual SQL is unlocked, but the original callback has not ended.
                assert!(self.store.test_connection_unlocked());
                gate.wait();
            }
        }
        Ok(())
    }
    fn load(&self, owner: &str, id: &str) -> Result<Option<RunStatus>, String> {
        self.loads.fetch_add(1, Ordering::AcqRel);
        let connection = self.store.lock_conn()?;
        Ok(crate::ssh_runbooks::test_read_run(&connection, id)?.filter(|run| run.owner == owner))
    }
}
#[allow(clippy::too_many_arguments)]
fn start(
    engine: &Arc<SshExecutions>,
    reviews: &SshExecutionReviews,
    id: &str,
    count: usize,
    limits: ExecutionLimits,
    persistence: Arc<dyn RunPersistence>,
    runner: TargetRunner,
    admission: NativeWriteAdmission,
) -> Result<RunStatus, String> {
    let snapshot = book();
    let targets = targets(count);
    let review = reviews
        .preview("main", &snapshot, &targets, limits)
        .unwrap();
    engine.start_admitted_with_runner(
        reviews,
        "main",
        &review.review_id,
        id.into(),
        snapshot,
        targets,
        limits,
        persistence,
        runner,
        admission,
    )
}

#[test]
fn dropped_response_keeps_two_original_workers_and_final_actual_sql_callback_admitted() {
    let engine = Arc::new(SshExecutions::default());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let last = Arc::new(Gate::default());
    let final_callback = Arc::new(Gate::default());
    let limits = ExecutionLimits {
        concurrency: 2,
        ..limits()
    };
    let sql = Arc::new(SqlPersistence::new(2, limits, Some(final_callback.clone())));
    let entered = Arc::new(AtomicUsize::new(0));
    let (calls, remaining) = (entered.clone(), last.clone());
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        calls.fetch_add(1, Ordering::AcqRel);
        if index == 1 {
            remaining.wait();
        }
        batch.transition(index, TargetState::Exited, Some(0), None);
    });
    let admission = tracked(&barrier, &resources);
    let (reply, waiter) = mpsc::channel();
    drop(waiter);
    let (actual_engine, persistence) = (engine.clone(), sql.clone());
    std::thread::spawn(move || {
        let result = start(
            &actual_engine,
            &SshExecutionReviews::default(),
            "original",
            2,
            limits,
            persistence,
            runner,
            admission,
        );
        assert!(result.is_ok());
        assert!(reply.send(result).is_err());
    })
    .join()
    .unwrap();
    until(|| entered.load(Ordering::Acquire) == 2);
    let original = batch(&engine, "original");
    let closed = barrier.close_admission().unwrap();
    assert!(test_admit_window_persistence(&resources, Some(&barrier)).is_err());
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    last.release();
    until(|| sql.final_entered.load(Ordering::Acquire));
    assert!(sql.read("original").finished());
    assert!(!original.workers_finished.load(Ordering::Acquire));
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    final_callback.release();
    until(|| original.workers_finished.load(Ordering::Acquire));
    assert!(sql
        .read("original")
        .targets
        .iter()
        .all(|target| target.state == TargetState::Exited));
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[test]
fn cached_terminal_status_and_engine_drop_cannot_retire_original_runner_cleanup() {
    let engine = Arc::new(SshExecutions::default());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let sql = Arc::new(SqlPersistence::new(1, limits(), None));
    let cleanup = Arc::new(Gate::default());
    let remaining = cleanup.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        batch.transition(index, TargetState::Exited, Some(0), None);
        remaining.wait();
    });
    start(
        &engine,
        &SshExecutionReviews::default(),
        "cache",
        1,
        limits(),
        sql.clone(),
        runner,
        tracked(&barrier, &resources),
    )
    .unwrap();
    until(|| sql.final_entered.load(Ordering::Acquire));
    let original = batch(&engine, "cache");
    let closed = barrier.close_admission().unwrap();
    let loads = sql.loads.load(Ordering::Acquire);
    assert!(engine
        .cached_status("main", "cache")
        .unwrap()
        .unwrap()
        .finished());
    assert!(engine.cached_status("foreign", "cache").is_err());
    assert!(engine.cached_status("main", "missing").unwrap().is_none());
    assert_eq!(sql.loads.load(Ordering::Acquire), loads);
    // Stop remains available while fresh writes are closed; cached final data
    // cannot imply that the original callback or local cleanup has returned.
    engine.cancel("main", "cache", None).unwrap();
    engine.runs.lock().unwrap().remove("cache");
    drop(engine);
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    cleanup.release();
    until(|| original.workers_finished.load(Ordering::Acquire));
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[test]
fn actual_final_persistence_error_or_panic_never_turns_initial_ok_into_native_idle() {
    for panic in [false, true] {
        let engine = Arc::new(SshExecutions::default());
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "main");
        let sql = Arc::new(SqlPersistence::new(1, limits(), None));
        sql.fail_final.store(!panic, Ordering::Release);
        sql.panic_final.store(panic, Ordering::Release);
        let calls = Arc::new(AtomicUsize::new(0));
        assert!(start(
            &engine,
            &SshExecutionReviews::default(),
            "sql-failed",
            1,
            limits(),
            sql.clone(),
            counted(calls.clone()),
            tracked(&barrier, &resources)
        )
        .is_ok());
        let original = batch(&engine, "sql-failed");
        until(|| original.workers_finished.load(Ordering::Acquire));
        assert_eq!(calls.load(Ordering::Acquire), 1);
        assert_eq!(sql.updates.load(Ordering::Acquire), 2);
        assert!(!sql.read("sql-failed").finished());
        let status = engine.cached_status("main", "sql-failed").unwrap().unwrap();
        assert_eq!(status.targets[0].state, TargetState::Unknown);
        assert_eq!(
            status.targets[0].reason.as_deref(),
            Some("persistence_failed")
        );
        assert!(matches!(
            barrier.try_close_idle_target_admission("cut"),
            Err(BarrierError::FailedNativeOperation)
        ));
    }
}

#[test]
fn worker_panic_does_not_skip_another_original_join_or_its_final_sql() {
    let engine = Arc::new(SshExecutions::default());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let limits = ExecutionLimits {
        concurrency: 2,
        ..limits()
    };
    let sql = Arc::new(SqlPersistence::new(2, limits, None));
    let entered = Arc::new(AtomicUsize::new(0));
    let cleanup = Arc::new(Gate::default());
    let (calls, remaining) = (entered.clone(), cleanup.clone());
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        calls.fetch_add(1, Ordering::AcqRel);
        until(|| calls.load(Ordering::Acquire) == 2);
        assert_ne!(index, 0, "original runner panic");
        remaining.wait();
        batch.transition(
            index,
            TargetState::Cancelled,
            None,
            Some("original_cleanup"),
        );
    });
    start(
        &engine,
        &SshExecutionReviews::default(),
        "panic",
        2,
        limits,
        sql.clone(),
        runner,
        tracked(&barrier, &resources),
    )
    .unwrap();
    until(|| entered.load(Ordering::Acquire) == 2);
    let original = batch(&engine, "panic");
    let closed = barrier.close_admission().unwrap();
    until(|| original.snapshot().targets[0].state == TargetState::Unknown);
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    cleanup.release();
    until(|| original.workers_finished.load(Ordering::Acquire));
    assert!(sql.read("panic").finished());
    assert_eq!(entered.load(Ordering::Acquire), 2);
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::FailedNativeOperation)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[test]
fn refused_supervisor_keeps_original_admission_through_fallback_actual_sql() {
    let engine = Arc::new(SshExecutions::default());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let callback = Arc::new(Gate::default());
    let sql = Arc::new(SqlPersistence::new(1, limits(), Some(callback.clone())));
    let admission = tracked(&barrier, &resources);
    let (actual_engine, persistence) = (engine.clone(), sql.clone());
    let calls = Arc::new(AtomicUsize::new(0));
    let effects = calls.clone();
    let caller = std::thread::spawn(move || {
        let reviews = SshExecutionReviews::default();
        let review = reviews
            .preview("main", &book(), &targets(1), limits())
            .unwrap();
        actual_engine.start_admitted_with_spawners(
            &reviews,
            "main",
            &review.review_id,
            "no-supervisor".into(),
            book(),
            targets(1),
            limits(),
            persistence,
            counted(effects),
            admission,
            Arc::new(|_work| Err(std::io::Error::other("controlled supervisor refusal"))),
            execution_spawner(),
        )
    });
    until(|| sql.final_entered.load(Ordering::Acquire));
    let closed = barrier.close_admission().unwrap();
    assert!(sql.read("no-supervisor").finished());
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    assert_eq!(calls.load(Ordering::Acquire), 0);
    callback.release();
    assert!(caller.join().unwrap().is_err());
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::FailedNativeOperation)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[test]
fn worker_spawn_refusal_joins_an_already_running_original_before_finishing() {
    let engine = Arc::new(SshExecutions::default());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let entered = Arc::new(AtomicUsize::new(0));
    let cleanup = Arc::new(Gate::default());
    let (calls, remaining) = (entered.clone(), cleanup.clone());
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        calls.fetch_add(1, Ordering::AcqRel);
        remaining.wait();
        batch.transition(index, TargetState::Exited, Some(0), None);
    });
    let attempts = Arc::new(AtomicUsize::new(0));
    let observed = entered.clone();
    let spawn: ExecutionSpawner = Arc::new(move |work| {
        if attempts.fetch_add(1, Ordering::AcqRel) == 0 {
            let handle = execution_spawner()(work)?;
            until(|| observed.load(Ordering::Acquire) == 1);
            Ok(handle)
        } else {
            Err(std::io::Error::other("controlled target refusal"))
        }
    });
    let reviews = SshExecutionReviews::default();
    let limits = ExecutionLimits {
        concurrency: 2,
        ..limits()
    };
    let review = reviews
        .preview("main", &book(), &targets(2), limits)
        .unwrap();
    let sql = Arc::new(SqlPersistence::new(2, limits, None));
    engine
        .start_admitted_with_spawners(
            &reviews,
            "main",
            &review.review_id,
            "worker-refusal".into(),
            book(),
            targets(2),
            limits,
            sql.clone(),
            runner,
            tracked(&barrier, &resources),
            execution_spawner(),
            spawn,
        )
        .unwrap();
    until(|| entered.load(Ordering::Acquire) == 1);
    let original = batch(&engine, "worker-refusal");
    until(|| original.observation_failed.load(Ordering::Acquire));
    let closed = barrier.close_admission().unwrap();
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    cleanup.release();
    until(|| original.workers_finished.load(Ordering::Acquire));
    assert!(sql.read("worker-refusal").finished());
    assert_eq!(entered.load(Ordering::Acquire), 1);
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::FailedNativeOperation)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[test]
fn terminal_metadata_keeps_actual_active_capacity_until_cleanup_returns() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let persistence = Arc::new(MemoryPersistence::default());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let cleanup = Arc::new(Gate::default());
    let remaining = cleanup.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        batch.transition(index, TargetState::Exited, Some(0), None);
        remaining.wait();
    });
    for index in 0..MAX_ACTIVE_RUNS {
        let id = format!("active-{index}");
        start(
            &engine,
            &reviews,
            &id,
            1,
            limits(),
            persistence.clone(),
            runner.clone(),
            tracked(&barrier, &resources),
        )
        .unwrap();
        until(|| {
            engine
                .cached_status("main", &id)
                .unwrap()
                .unwrap()
                .finished()
        });
    }
    let first = batch(&engine, "active-0");
    assert!(start(
        &engine,
        &reviews,
        "overflow",
        1,
        limits(),
        persistence.clone(),
        runner,
        tracked(&barrier, &resources)
    )
    .unwrap_err()
    .contains("Too many active"));
    assert!(Arc::ptr_eq(&first, &batch(&engine, "active-0")));
    cleanup.release();
    let originals: Vec<_> = engine.runs.lock().unwrap().values().cloned().collect();
    until(|| {
        originals
            .iter()
            .all(|run| run.workers_finished.load(Ordering::Acquire))
    });
    assert_eq!(persistence.runs.lock().unwrap().len(), MAX_ACTIVE_RUNS);
}

#[test]
fn reloaded_physical_window_cannot_rebind_or_qualify_original_cancelled_work() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let sql = Arc::new(SqlPersistence::new(1, limits(), None));
    let cleanup = Arc::new(Gate::default());
    let remaining = cleanup.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        until(|| batch.cancelled(index));
        batch.transition(
            index,
            TargetState::Cancelled,
            None,
            Some("original_window_closed"),
        );
        remaining.wait();
    });
    start(
        &engine,
        &reviews,
        "old-window",
        1,
        limits(),
        sql.clone(),
        runner,
        tracked(&barrier, &resources),
    )
    .unwrap();
    let original = batch(&engine, "old-window");
    until(|| original.snapshot().targets[0].state == TargetState::Running);
    test_reload_buffer_resources(&resources);
    reviews.close_window("main");
    engine.close_window("main");
    until(|| sql.final_entered.load(Ordering::Acquire));
    assert!(!original.workers_finished.load(Ordering::Acquire));
    assert!(engine.cached_status("replacement", "old-window").is_err());
    cleanup.release();
    until(|| original.workers_finished.load(Ordering::Acquire));
    assert_eq!(
        sql.read("old-window").targets[0].state,
        TargetState::Cancelled
    );
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::UnfinishedNativeOperation)
    ));
}

#[test]
fn stop_while_closed_keeps_original_cancelled_workers_through_final_sql_and_cleanup() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "main");
    let sql = Arc::new(SqlPersistence::new(2, limits(), None));
    let cleanup = Arc::new(Gate::default());
    let remaining = cleanup.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let effects = calls.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        effects.fetch_add(1, Ordering::AcqRel);
        until(|| batch.cancelled(index));
        batch.transition(index, TargetState::Cancelled, None, Some("original_stop"));
        remaining.wait();
    });
    start(
        &engine,
        &reviews,
        "cancel-closed",
        2,
        limits(),
        sql.clone(),
        runner,
        tracked(&barrier, &resources),
    )
    .unwrap();
    let original = batch(&engine, "cancel-closed");
    until(|| calls.load(Ordering::Acquire) == 1);
    let closed = barrier.close_admission().unwrap();
    assert!(test_admit_window_persistence(&resources, Some(&barrier)).is_err());
    engine.cancel("main", "cancel-closed", None).unwrap();
    until(|| original.snapshot().targets[0].state == TargetState::Cancelled);
    assert_eq!(
        sql.read("cancel-closed").targets[0].state,
        TargetState::Cancelled
    );
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::PendingNativeOperations)
    ));
    cleanup.release();
    until(|| original.workers_finished.load(Ordering::Acquire));
    assert!(sql
        .read("cancel-closed")
        .targets
        .iter()
        .all(|target| target.state == TargetState::Cancelled));
    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert!(matches!(
        barrier.prove_native_idle(&closed),
        Err(BarrierError::MissingNativeCheckpoint)
    ));
    barrier.reopen_admission(closed).unwrap();
}

#[cfg(windows)]
mod local_process {
    use super::*;
    use std::io::Read;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };

    const CHILD: &str = "ssh_execution::tests::admission_tests::local_process::owned_stdin_child";
    const MARKER: &str = "BYCODA_SSH_ADMISSION_CHILD";
    const ROOT: &str = "BYCODA_SSH_ADMISSION_CHILD_ROOT";

    fn children_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-30-ssh-persistence/engine/children")
    }

    #[test]
    #[ignore = "only the owned local process fixture with its unique child marker may invoke this"]
    fn owned_stdin_child() {
        let root = PathBuf::from(std::env::var_os(ROOT).expect("owned child root is required"));
        let root = root.canonicalize().unwrap();
        let base = children_root().canonicalize().unwrap();
        assert_eq!(root.parent(), Some(base.as_path()));
        let nonce = root.file_name().unwrap().to_str().unwrap();
        assert!(uuid::Uuid::parse_str(nonce).is_ok());
        assert_eq!(
            std::env::var(MARKER).unwrap(),
            nonce,
            "task-specific child marker required"
        );
        let mut input = Vec::new();
        std::io::stdin().read_to_end(&mut input).unwrap();
        std::fs::write(root.join("received.bin"), input).unwrap();
        std::fs::write(root.join("ready.tmp"), std::process::id().to_string()).unwrap();
        std::fs::rename(root.join("ready.tmp"), root.join("ready.pid")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !root.join("release").exists() {
            assert!(
                Instant::now() < deadline,
                "owned child release was not observed"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    struct ChildFixture {
        root: PathBuf,
        engine: Arc<SshExecutions>,
        callback: Arc<Gate>,
        run: Option<Arc<Batch>>,
        process: Option<OwnedHandle>,
    }
    impl ChildFixture {
        fn new(engine: Arc<SshExecutions>, callback: Arc<Gate>) -> Self {
            let base = children_root();
            std::fs::create_dir_all(&base).unwrap();
            let root = base
                .canonicalize()
                .unwrap()
                .join(uuid::Uuid::new_v4().to_string());
            std::fs::create_dir(&root).unwrap();
            Self {
                root,
                engine,
                callback,
                run: None,
                process: None,
            }
        }
        fn prepared(root: PathBuf, input: Vec<u8>, target: &ResolvedTarget) -> PreparedProcess {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    CHILD,
                    "--ignored",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(MARKER, root.file_name().unwrap())
                .env(ROOT, &root)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000);
            (command, input, target.endpoint.clone(), None)
        }
        fn observe_owned_child(&mut self, expected: &[u8]) {
            until(|| self.root.join("ready.pid").is_file());
            assert_eq!(
                std::fs::read(self.root.join("received.bin")).unwrap(),
                expected
            );
            let pid: u32 = std::fs::read_to_string(self.root.join("ready.pid"))
                .unwrap()
                .parse()
                .unwrap();
            // Retain this exact live child kernel object, not a later PID lookup
            // or process-name search. Only this owned test child can be killed.
            let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid) };
            assert!(!raw.is_null());
            let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
            assert_eq!(
                unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) },
                WAIT_TIMEOUT
            );
            self.process = Some(handle);
        }
        fn assert_exited(&self) {
            assert_eq!(
                unsafe { WaitForSingleObject(self.process.as_ref().unwrap().as_raw_handle(), 0) },
                WAIT_OBJECT_0,
                "the exact owned local child must really have exited"
            );
        }
    }
    impl Drop for ChildFixture {
        fn drop(&mut self) {
            self.callback.release();
            let _ = std::fs::write(self.root.join("release"), []);
            self.engine.shutdown();
            let running = self.process.as_ref().filter(|handle| unsafe {
                WaitForSingleObject(handle.as_raw_handle(), 0) == WAIT_TIMEOUT
            });
            if let Some(handle) = running {
                // Failure cleanup is limited to the original child handle.
                unsafe {
                    TerminateProcess(handle.as_raw_handle(), 1);
                }
                unsafe {
                    WaitForSingleObject(handle.as_raw_handle(), 5000);
                }
            }
            let deadline = Instant::now() + WAIT;
            if let Some(run) = &self.run {
                while !run.workers_finished.load(Ordering::Acquire) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(2));
                }
                if !run.workers_finished.load(Ordering::Acquire) {
                    // Preserve failed fixture evidence; do not erase a live job.
                    return;
                }
            }
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn actual_piped_local_child_exit_and_final_sql_callback_both_precede_admission_finish() {
        let engine = Arc::new(SshExecutions::default());
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "main");
        let callback = Arc::new(Gate::default());
        let sql = Arc::new(SqlPersistence::new(1, limits(), Some(callback.clone())));
        let mut fixture = ChildFixture::new(engine.clone(), callback.clone());
        let input = "  owned piped bytes\r\n漢🦀\n".repeat(2048).into_bytes();
        let (root, original_input) = (fixture.root.clone(), input.clone());
        let runner: TargetRunner = Arc::new(move |batch, index, _, target, limits| {
            execute_prepared(
                batch,
                index,
                Ok(ChildFixture::prepared(
                    root.clone(),
                    original_input.clone(),
                    target,
                )),
                limits,
            );
        });
        start(
            &engine,
            &SshExecutionReviews::default(),
            "local-success",
            1,
            limits(),
            sql.clone(),
            runner,
            tracked(&barrier, &resources),
        )
        .unwrap();
        fixture.run = Some(batch(&engine, "local-success"));
        fixture.observe_owned_child(&input);
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        std::fs::write(fixture.root.join("release"), []).unwrap();
        until(|| sql.final_entered.load(Ordering::Acquire));
        fixture.assert_exited();
        assert_eq!(
            sql.read("local-success").targets[0].state,
            TargetState::Exited
        );
        assert!(!fixture
            .run
            .as_ref()
            .unwrap()
            .workers_finished
            .load(Ordering::Acquire));
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        callback.release();
        until(|| {
            fixture
                .run
                .as_ref()
                .unwrap()
                .workers_finished
                .load(Ordering::Acquire)
        });
        assert!(!fixture
            .run
            .as_ref()
            .unwrap()
            .observation_failed
            .load(Ordering::Acquire));
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
        barrier.reopen_admission(closed).unwrap();
    }

    #[test]
    fn actual_cancelled_local_child_and_stdin_are_retired_before_original_final_sql_settles() {
        let engine = Arc::new(SshExecutions::default());
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "main");
        let callback = Arc::new(Gate::default());
        let sql = Arc::new(SqlPersistence::new(1, limits(), Some(callback.clone())));
        let mut fixture = ChildFixture::new(engine.clone(), callback.clone());
        let input = " exact cancel stdin\r\n🦀 ".repeat(2048).into_bytes();
        let (root, original_input) = (fixture.root.clone(), input.clone());
        let runner: TargetRunner = Arc::new(move |batch, index, _, target, limits| {
            execute_prepared(
                batch,
                index,
                Ok(ChildFixture::prepared(
                    root.clone(),
                    original_input.clone(),
                    target,
                )),
                limits,
            );
        });
        start(
            &engine,
            &SshExecutionReviews::default(),
            "local-cancel",
            1,
            limits(),
            sql.clone(),
            runner,
            tracked(&barrier, &resources),
        )
        .unwrap();
        fixture.run = Some(batch(&engine, "local-cancel"));
        fixture.observe_owned_child(&input);
        let closed = barrier.close_admission().unwrap();
        engine.cancel("main", "local-cancel", None).unwrap();
        until(|| sql.final_entered.load(Ordering::Acquire));
        fixture.assert_exited();
        let status = sql.read("local-cancel");
        assert_eq!(status.targets[0].state, TargetState::Cancelled);
        assert_eq!(
            status.targets[0].reason.as_deref(),
            Some("cancel_requested_remote_outcome_unknown")
        );
        assert!(!fixture
            .run
            .as_ref()
            .unwrap()
            .workers_finished
            .load(Ordering::Acquire));
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        callback.release();
        until(|| {
            fixture
                .run
                .as_ref()
                .unwrap()
                .workers_finished
                .load(Ordering::Acquire)
        });
        // Windows can report a kill refusal after the existing tree terminator
        // already ended this child. The real exit above is mandatory either way;
        // a recorded observation error must still deny idle qualification.
        let expected = if fixture
            .run
            .as_ref()
            .unwrap()
            .observation_failed
            .load(Ordering::Acquire)
        {
            BarrierError::FailedNativeOperation
        } else {
            BarrierError::MissingNativeCheckpoint
        };
        assert_eq!(barrier.prove_native_idle(&closed).err(), Some(expected));
        barrier.reopen_admission(closed).unwrap();
    }
}
