use super::*;
#[path = "ssh_execution_native_tests.rs"]
mod native_tests;
#[derive(Default)]
struct MemoryPersistence {
    runs: Mutex<HashMap<String, RunStatus>>,
    fail_claim: AtomicBool,
    fail_update: AtomicBool,
}
impl RunPersistence for MemoryPersistence {
    fn claim(&self, status: &RunStatus) -> Result<ClaimResult, String> {
        if self.fail_claim.load(Ordering::Acquire) {
            return Err("fixture persistence failure".into());
        }
        let mut runs = self.runs.lock().unwrap();
        if let Some(existing) = runs.get(&status.run_id) {
            return Ok(ClaimResult::Existing(existing.clone()));
        }
        runs.insert(status.run_id.clone(), status.clone());
        Ok(ClaimResult::Claimed)
    }
    fn update(&self, status: &RunStatus) -> Result<(), String> {
        if self.fail_update.load(Ordering::Acquire) {
            return Err("fixture update failure".into());
        }
        self.runs
            .lock()
            .unwrap()
            .insert(status.run_id.clone(), status.clone());
        Ok(())
    }
    fn load(&self, owner: &str, run_id: &str) -> Result<Option<RunStatus>, String> {
        Ok(self
            .runs
            .lock()
            .unwrap()
            .get(run_id)
            .filter(|run| run.owner == owner)
            .cloned())
    }
}
fn book() -> RunbookSnapshot {
    RunbookSnapshot {
        automation_id: "runbook-1".into(),
        revision: 1,
        script: "printf reviewed".into(),
        shell: RemoteShellKind::Posix,
    }
}
fn targets(count: usize) -> Vec<ResolvedTarget> {
    (0..count)
        .map(|i| ResolvedTarget {
            server_id: format!("server-{i}"),
            proxy_grant: None,
            endpoint: SshEndpoint {
                host: "example.invalid".into(),
                port: 22,
                ..Default::default()
            },
        })
        .collect()
}
fn limits() -> ExecutionLimits {
    ExecutionLimits {
        concurrency: 1,
        timeout_seconds: 10,
    }
}
fn settled(engine: &SshExecutions, store: &dyn RunPersistence, run_id: &str) -> RunStatus {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let status = engine.status("main", run_id, store).unwrap();
        if status.finished() {
            return status;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn counted(counter: Arc<AtomicUsize>) -> TargetRunner {
    Arc::new(move |batch, index, _, _, _| {
        counter.fetch_add(1, Ordering::AcqRel);
        batch.transition(index, TargetState::Exited, Some(0), None);
    })
}

#[test]
fn wrong_window_cannot_consume_and_every_valid_owner_attempt_is_single_use() {
    let reviews = SshExecutionReviews::default();
    let snapshot = book();
    let targets = targets(1);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    assert!(reviews
        .consume("foreign", &review.review_id, &snapshot, &targets, limits())
        .is_err());
    assert!(reviews
        .consume("main", &review.review_id, &snapshot, &targets, limits())
        .is_ok());
    assert!(reviews
        .consume("main", &review.review_id, &snapshot, &targets, limits())
        .is_err());
}
#[test]
fn revision_script_route_environment_and_limits_are_bound_to_review() {
    let reviews = SshExecutionReviews::default();
    let snapshot = book();
    let targets = targets(1);
    for change in 0..6 {
        let review = reviews
            .preview("main", &snapshot, &targets, limits())
            .unwrap();
        let mut next_book = snapshot.clone();
        let mut next_targets = targets.clone();
        let mut next_limits = limits();
        match change {
            0 => next_book.revision += 1,
            1 => next_book.script.push_str("; printf altered"),
            2 => next_targets[0].endpoint.host = "changed.invalid".into(),
            3 => next_targets[0].endpoint.identity_file = Some("/changed/key".into()),
            4 => next_limits.concurrency = 2,
            _ => {
                next_targets[0].endpoint.runtime_configuration =
                    Some(Arc::new(crate::ssh_security::RuntimeConfiguration {
                        digest: "changed-group-runtime".into(),
                        environment: vec![crate::ssh_group_defaults::LiteralEnvironment {
                            name: "APP_MESSAGE".into(),
                            value: "changed literal".into(),
                        }],
                        shell_kind: Some(RemoteShellKind::Posix),
                        provenance: Default::default(),
                    }))
            }
        }
        assert!(reviews
            .consume(
                "main",
                &review.review_id,
                &next_book,
                &next_targets,
                next_limits
            )
            .is_err());
        assert!(reviews
            .consume("main", &review.review_id, &snapshot, &targets, limits())
            .is_err());
    }
}
#[test]
fn expired_and_closed_window_tickets_never_authorize_execution() {
    let reviews = SshExecutionReviews::default();
    let snapshot = book();
    let targets = targets(1);
    let review = reviews
        .preview_at(
            "main",
            &snapshot,
            &targets,
            limits(),
            Instant::now() - REVIEW_TTL - Duration::from_secs(1),
        )
        .unwrap();
    assert!(reviews
        .consume("main", &review.review_id, &snapshot, &targets, limits())
        .is_err());
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    reviews.close_window("main");
    assert!(reviews
        .consume("main", &review.review_id, &snapshot, &targets, limits())
        .is_err());
}
#[test]
fn failed_durable_claim_consumes_review_and_starts_zero_targets() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    store.fail_claim.store(true, Ordering::Release);
    let counter = Arc::new(AtomicUsize::new(0));
    let snapshot = book();
    let targets = targets(2);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    assert!(engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "run-failed".into(),
            snapshot.clone(),
            targets.clone(),
            limits(),
            store.clone(),
            counted(counter.clone())
        )
        .is_err());
    assert_eq!(counter.load(Ordering::Acquire), 0);
    assert!(engine.runs.lock().unwrap().is_empty());
    assert!(reviews
        .consume("main", &review.review_id, &snapshot, &targets, limits())
        .is_err());
}
#[test]
fn duplicate_and_recovered_run_ids_never_replay() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    let counter = Arc::new(AtomicUsize::new(0));
    for round in 0..2 {
        let snapshot = book();
        let targets = targets(2);
        let review = reviews
            .preview("main", &snapshot, &targets, limits())
            .unwrap();
        engine
            .start_with_runner(
                &reviews,
                "main",
                &review.review_id,
                "run-once".into(),
                snapshot,
                targets,
                limits(),
                store.clone(),
                counted(counter.clone()),
            )
            .unwrap();
        settled(&engine, store.as_ref(), "run-once");
        assert_eq!(counter.load(Ordering::Acquire), 2, "round {round}");
    }
    let restarted = Arc::new(SshExecutions::default());
    assert!(restarted
        .status("main", "run-once", store.as_ref())
        .unwrap()
        .finished());
    let snapshot = book();
    let targets = targets(2);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    restarted
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "run-once".into(),
            snapshot,
            targets,
            limits(),
            store.clone(),
            counted(counter.clone()),
        )
        .unwrap();
    assert_eq!(counter.load(Ordering::Acquire), 2);
    assert!(restarted.runs.lock().unwrap().is_empty());
}

#[test]
fn same_review_same_run_id_returns_existing_metadata_without_reexecution() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    let counter = Arc::new(AtomicUsize::new(0));
    let snapshot = book();
    let targets = targets(1);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    for _ in 0..2 {
        engine
            .start_with_runner(
                &reviews,
                "main",
                &review.review_id,
                "run-exact-duplicate".into(),
                snapshot.clone(),
                targets.clone(),
                limits(),
                store.clone(),
                counted(counter.clone()),
            )
            .unwrap();
        settled(&engine, store.as_ref(), "run-exact-duplicate");
    }
    assert_eq!(counter.load(Ordering::Acquire), 1);
}

#[test]
fn inherited_environment_dialect_mismatch_fails_review_and_preflight() {
    let snapshot = book();
    let mut targets = targets(1);
    targets[0].endpoint.runtime_configuration =
        Some(Arc::new(crate::ssh_security::RuntimeConfiguration {
            digest: "fixture-runtime".into(),
            environment: vec![crate::ssh_group_defaults::LiteralEnvironment {
                name: "APP_MESSAGE".into(),
                value: "literal".into(),
            }],
            shell_kind: Some(RemoteShellKind::Powershell),
            provenance: Default::default(),
        }));
    assert!(SshExecutionReviews::default()
        .preview("main", &snapshot, &targets, limits())
        .is_err());
    assert!(prepare_process(&snapshot, &targets[0]).is_err());
}
#[test]
fn failed_running_journal_update_starts_zero_targets() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    store.fail_update.store(true, Ordering::Release);
    let counter = Arc::new(AtomicUsize::new(0));
    let snapshot = book();
    let targets = targets(1);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "run-update-fail".into(),
            snapshot,
            targets,
            limits(),
            store.clone(),
            counted(counter.clone()),
        )
        .unwrap();
    let status = settled(&engine, store.as_ref(), "run-update-fail");
    assert_eq!(counter.load(Ordering::Acquire), 0);
    assert_eq!(status.targets[0].state, TargetState::Unknown);
}
#[test]
fn foreign_cancel_is_denied_and_window_close_cancels_remaining_work() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let called = calls.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        called.fetch_add(1, Ordering::AcqRel);
        let deadline = Instant::now() + Duration::from_secs(2);
        while !batch.cancelled(index) {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        batch.transition(index, TargetState::Cancelled, None, Some("fixture_cancel"));
    });
    let snapshot = book();
    let targets = targets(3);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "run-cancel".into(),
            snapshot,
            targets,
            limits(),
            store.clone(),
            runner,
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    while calls.load(Ordering::Acquire) == 0 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(engine.cancel("foreign", "run-cancel", None).is_err());
    assert!(engine
        .status("foreign", "run-cancel", store.as_ref())
        .is_err());
    engine.close_window("main");
    let status = settled(&engine, store.as_ref(), "run-cancel");
    assert!(status
        .targets
        .iter()
        .all(|target| target.state == TargetState::Cancelled));
    assert_eq!(calls.load(Ordering::Acquire), 1);
}
#[test]
fn interpreter_and_script_use_stdin_and_never_log_or_enable_agent_forwarding() {
    let snapshot = book();
    let target = targets(1).remove(0);
    let (command, input, _, _) = prepare_process(&snapshot, &target).unwrap();
    let args: Vec<_> = command
        .get_args()
        .map(|arg| arg.to_string_lossy())
        .collect();
    assert!(args.iter().any(|arg| arg == "BatchMode=yes"));
    assert!(args.iter().any(|arg| arg == "ForwardAgent=no"));
    assert!(args.iter().any(|arg| arg == "sh -s"));
    assert!(!args.iter().any(|arg| arg.contains("printf reviewed")));
    assert_eq!(input, b"printf reviewed\n");
}

#[test]
fn queued_target_cancellation_preserves_unrelated_targets_and_concurrency_bound() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    let started = Arc::new(AtomicUsize::new(0));
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(AtomicBool::new(false));
    let (calls, live, maximum, allowed) = (
        started.clone(),
        active.clone(),
        peak.clone(),
        release.clone(),
    );
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        calls.fetch_add(1, Ordering::AcqRel);
        let count = live.fetch_add(1, Ordering::AcqRel) + 1;
        maximum.fetch_max(count, Ordering::AcqRel);
        let deadline = Instant::now() + Duration::from_secs(2);
        while !allowed.load(Ordering::Acquire) {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        live.fetch_sub(1, Ordering::AcqRel);
        batch.transition(index, TargetState::Exited, Some(0), None);
    });
    let snapshot = book();
    let targets = targets(4);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "run-target-cancel".into(),
            snapshot,
            targets,
            limits(),
            store.clone(),
            runner,
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    while started.load(Ordering::Acquire) != 1 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    engine
        .cancel("main", "run-target-cancel", Some("server-1"))
        .unwrap();
    release.store(true, Ordering::Release);
    let status = settled(&engine, store.as_ref(), "run-target-cancel");
    assert_eq!(status.targets[1].state, TargetState::Cancelled);
    assert!(status
        .targets
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != 1)
        .all(|(_, target)| target.state == TargetState::Exited));
    assert_eq!(started.load(Ordering::Acquire), 3);
    assert_eq!(peak.load(Ordering::Acquire), 1);
}

#[test]
fn shutdown_never_resumes_queued_work() {
    let engine = Arc::new(SshExecutions::default());
    let reviews = SshExecutionReviews::default();
    let store = Arc::new(MemoryPersistence::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, _, _, _| {
        observed.fetch_add(1, Ordering::AcqRel);
        let deadline = Instant::now() + Duration::from_secs(2);
        while !batch.cancelled(index) {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        batch.transition(
            index,
            TargetState::Cancelled,
            None,
            Some("fixture_shutdown"),
        );
    });
    let snapshot = book();
    let targets = targets(2);
    let review = reviews
        .preview("main", &snapshot, &targets, limits())
        .unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "run-shutdown".into(),
            snapshot,
            targets,
            limits(),
            store.clone(),
            runner,
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    while calls.load(Ordering::Acquire) == 0 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    engine.shutdown();
    let status = settled(&engine, store.as_ref(), "run-shutdown");
    assert!(status
        .targets
        .iter()
        .all(|target| target.state == TargetState::Cancelled));
    assert_eq!(calls.load(Ordering::Acquire), 1);
}
