//! Physical pipe fixtures for the process receipt boundary. These do not qualify
//! Native output retention, HTTP/SSE routing, or provider consumption.
use super::*;
use crate::native_provider_output::NativeOutputChild;

#[test]
fn page_retirement_selects_only_the_original_physical_owner() {
    let host = HarnessHost::new();
    let first = ProcessFixture::new(&host, "first", None);
    let second = ProcessFixture::new(&host, "second", None);
    let owner = first.live.issuer.as_ref().unwrap().clone();
    let other = second.live.issuer.as_ref().unwrap().clone();
    {
        let mut inner = host.lock_inner();
        inner.children.insert("first".into(), first.live.clone());
        inner.children.insert("second".into(), second.live.clone());
    }
    assert!(host.assert_spawn_owner("first", &owner).is_ok());
    assert_eq!(
        host.assert_spawn_owner("first", &other).unwrap_err(),
        "NATIVE_SESSION_OWNED_BY_ANOTHER_WINDOW"
    );
    assert!(host.get("first").is_some());
    let retired = host.retire_issuer(&owner);
    assert_eq!(retired.len(), 1);
    assert!(Arc::ptr_eq(&retired[0], &first.live));
    assert!(host.get("first").is_none());
    assert!(Arc::ptr_eq(&host.get("second").unwrap(), &second.live));
    assert!(host.retire_issuer(&owner).is_empty());
    assert!(!Arc::ptr_eq(&owner, &other));
}

#[test]
fn retired_page_cannot_admit_a_pending_spawn() {
    use tauri::Resource;
    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    Resource::close(issuer.clone());
    let mut started = false;
    let result = issuer.with_live(|| {
        started = true;
        Ok(())
    });
    assert!(result.is_err());
    assert!(!started);
}

#[test]
fn page_retirement_proof_waits_for_pending_start_and_actual_exit() {
    use tauri::Resource;
    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    let id = page_proof_id(&issuer).unwrap();
    let mut start = PageStart::new(&issuer).unwrap();
    let exit = Arc::new(ManagedProviderExit::default());
    start.attach(exit.clone()).unwrap();
    Resource::close(issuer);
    assert_eq!(page_retirement_status(&id), PageRetirement::Pending);
    start.completed = true;
    drop(start);
    assert_eq!(page_retirement_status(&id), PageRetirement::Pending);
    exit.finish(Ok(()));
    assert_eq!(page_retirement_status(&id), PageRetirement::Confirmed);
    assert_eq!(page_retirement_status("missing"), PageRetirement::Unknown);
}

#[test]
fn uncertain_spawn_and_failed_exit_never_prove_retirement() {
    use tauri::Resource;
    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    let id = page_proof_id(&issuer).unwrap();
    let start = PageStart::new(&issuer).unwrap();
    Resource::close(issuer);
    drop(start);
    assert_eq!(page_retirement_status(&id), PageRetirement::Unknown);

    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    let id = page_proof_id(&issuer).unwrap();
    let mut start = PageStart::new(&issuer).unwrap();
    let exit = Arc::new(ManagedProviderExit::default());
    start.attach(exit.clone()).unwrap();
    start.completed = true;
    drop(start);
    Resource::close(issuer);
    exit.finish(Err("unknown exit".into()));
    assert_eq!(page_retirement_status(&id), PageRetirement::Unknown);
}

#[test]
fn external_stream_without_provider_retirement_proof_keeps_page_unknown() {
    use tauri::Resource;
    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    let id = page_proof_id(&issuer).unwrap();
    mark_page_external_unverified(&issuer).unwrap();
    Resource::close(issuer);
    assert_eq!(page_retirement_status(&id), PageRetirement::Unknown);
    assert!(!page_retirement_waiting(&id));
}

pub(super) struct ProcessFixture {
    pub(super) live: Arc<LiveChild>,
    process: Arc<NativeOutputChild>,
    output: Arc<NativeOutputStream>,
    pub(super) actual_pid: u32,
    capture: PathBuf,
    waiter: Option<thread::JoinHandle<()>>,
}

impl ProcessFixture {
    pub(super) fn new(host: &HarnessHost, session: &str, advertised_pid: Option<u32>) -> Self {
        Self::with_final_callback(host, session, advertised_pid, None)
    }

    fn with_final_callback(
        host: &HarnessHost,
        session: &str,
        advertised_pid: Option<u32>,
        final_callback: Option<mpsc::Receiver<()>>,
    ) -> Self {
        let capture = std::env::temp_dir().join(format!(
            "bycoda-process-construction-{}.txt",
            uuid::Uuid::new_v4()
        ));
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "harness::process_construction_tests::owned_stdin_child",
                "--ignored",
                "--nocapture",
            ])
            .env("BYCODA_PROCESS_CONSTRUCTION_CAPTURE", &capture)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_child(&mut command);
        let mut child = OwnedChild::spawn(&mut command).unwrap();
        let actual_pid = child.id();
        let stdin = child.stdin.take().unwrap();
        let (output, process) = host.output.begin_process(
            OutputSource::fixture(session),
            child,
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        let live = Arc::new(LiveChild {
            cwd: std::env::temp_dir(),
            stdin: Mutex::new(stdin),
            pid: advertised_pid.unwrap_or(actual_pid),
            construction_id: output.epoch().to_owned(),
            issuer: Some(Arc::new(crate::control::receipts::WindowIssuer::default())),
            _control_turn: None,
            account: None,
            owners: Arc::new(Owners::default()),
            output: Some(Arc::clone(&output)),
            process: Some(process.clone()),
            exit: Some(Arc::new(ManagedProviderExit::default())),
            writers: WriteGate::new(),
            order: WriteOrder::new(),
        });
        output.reader(0).finish(true, false);
        output.reader(1).finish(true, false);
        let waiting = process.clone();
        let waiting_output = output.clone();
        let exit = live.exit.as_ref().unwrap().clone();
        let waiter = thread::spawn(move || {
            let result = waiting
                .wait(&waiting_output, false)
                .map(|_| ())
                .map_err(|e| e.to_string())
                .and_then(|_| waiting.retirement().require_verified());
            if let Some(callback) = final_callback {
                let _ = callback.recv();
            }
            exit.finish(result);
        });
        Self {
            live,
            process,
            output,
            actual_pid,
            capture,
            waiter: Some(waiter),
        }
    }

    pub(super) fn contents(&self) -> String {
        std::fs::read_to_string(&self.capture).unwrap_or_default()
    }

    pub(super) fn await_contents(&self, expected: &str) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let actual = self.contents();
            if actual == expected {
                return;
            }
            assert!(Instant::now() < deadline, "child pipe contents: {actual:?}");
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for ProcessFixture {
    fn drop(&mut self) {
        // Tests that simulate recycled PID metadata still terminate the actual
        // fixture process, never the PID advertised in its synthetic registry row.
        let _ = self.process.request_stop();
        let _ = self.process.wait_actual();
        if let Some(waiter) = self.waiter.take() {
            let _ = waiter.join();
        }
        self.output.terminal_delivery(false);
        let _ = std::fs::remove_file(&self.capture);
    }
}

pub(super) fn publish(
    host: &HarnessHost,
    session: &str,
    live: &Arc<LiveChild>,
) -> Option<Arc<LiveChild>> {
    let (epoch, kill_all, previous) = host.begin_spawn(session);
    assert!(host
        .install_spawn(session.to_owned(), epoch, kill_all, Arc::clone(live))
        .is_none());
    previous
}

fn write_selected(live: Arc<LiveChild>, text: &str) {
    write_child_with_deadline_guarded(live, text.to_owned(), Duration::from_secs(3), None).unwrap();
}

#[test]
#[ignore = "isolated stdin child entry; invoked only by process construction fixtures"]
fn owned_stdin_child() {
    let capture = std::env::var_os("BYCODA_PROCESS_CONSTRUCTION_CAPTURE").unwrap();
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(capture)
        .unwrap();
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        writeln!(file, "{}", line).unwrap();
        file.sync_all().unwrap();
        if line == "__exit_original__" {
            break;
        }
    }
}

#[test]
fn receipt_and_process_events_retain_the_actual_stream_construction() {
    let host = HarnessHost::new();
    let process = ProcessFixture::new(&host, "current", None);
    publish(&host, "current", &process.live);
    let receipt = process.live.receipt("current");
    let serialized = serde_json::to_value(&receipt).unwrap();
    assert_eq!(
        serialized,
        serde_json::json!({
            "version": 1,
            "backend": "native",
            "sessionId": "current",
            "pid": process.actual_pid,
            "constructionId": process.output.epoch(),
        })
    );
    let selected = host
        .get_original("current", Some(&receipt.construction_id))
        .unwrap();
    assert!(Arc::ptr_eq(&selected, &process.live));
    write_selected(selected, "current-source");
    process.await_contents("current-source\n");
    // The same event DTO serves stdout and stderr; terminal events carry the
    // identical top-level identity even without output qualification metadata.
    let lines = serde_json::to_value(HarnessLines {
        session_id: "current".into(),
        construction_id: receipt.construction_id.clone(),
        lines: vec!["output".into()],
        native_output: None,
    })
    .unwrap();
    let exit = serde_json::to_value(HarnessExit {
        session_id: "current".into(),
        construction_id: receipt.construction_id.clone(),
        code: Some(0),
        pid: receipt.pid,
        native_output_state: None,
    })
    .unwrap();
    assert_eq!(lines["constructionId"], serialized["constructionId"]);
    assert_eq!(exit["constructionId"], serialized["constructionId"]);
    host.remove_if_child("current", &process.live).unwrap();
}

#[test]
fn missing_foreign_noncanonical_and_closed_sources_cannot_select_or_kill() {
    let host = HarnessHost::new();
    let process = ProcessFixture::new(&host, "protected", None);
    publish(&host, "protected", &process.live);
    let stream_stopped = Arc::new(AtomicBool::new(false));
    host.insert_sse(
        "protected".into(),
        Arc::new(LiveSse {
            stop: Arc::clone(&stream_stopped),
            issuer: None,
            owners: Arc::new(Owners::default()),
            output: None,
        }),
    );
    let foreign = uuid::Uuid::new_v4().to_string();
    let uppercase = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    let before = host.lock_inner().epochs["protected"];
    for identity in [None, Some(""), Some(foreign.as_str()), Some(uppercase)] {
        assert!(host.get_original("protected", identity).is_err());
        assert!(host.kill_original_session("protected", identity).is_err());
        assert_eq!(host.lock_inner().epochs["protected"], before);
        assert!(Arc::ptr_eq(&host.get("protected").unwrap(), &process.live));
        assert!(!stream_stopped.load(Ordering::SeqCst));
    }
    assert!(host
        .get_original("foreign-route", Some(&process.live.construction_id))
        .is_err());
    write_selected(
        host.get_original("protected", Some(&process.live.construction_id))
            .unwrap(),
        "only-current-source",
    );
    process.await_contents("only-current-source\n");
    host.kill_original_session("protected", Some(&process.live.construction_id))
        .unwrap();
    assert!(stream_stopped.load(Ordering::SeqCst));
    assert!(host
        .get_original("protected", Some(&process.live.construction_id))
        .is_err());
}

#[test]
fn late_original_after_replacement_cannot_write_kill_or_remove_the_replacement() {
    let host = HarnessHost::new();
    let original = ProcessFixture::new(&host, "reused", None);
    publish(&host, "reused", &original.live);
    // Advertise the same PID to exercise the old PID-only cleanup bug while
    // keeping two real, independently observed pipes behind the registry rows.
    let replacement = ProcessFixture::new(&host, "reused", Some(original.live.pid));
    let removed = publish(&host, "reused", &replacement.live).unwrap();
    let replacement_stream_stopped = Arc::new(AtomicBool::new(false));
    host.insert_sse(
        "reused".into(),
        Arc::new(LiveSse {
            stop: Arc::clone(&replacement_stream_stopped),
            issuer: None,
            owners: Arc::new(Owners::default()),
            output: None,
        }),
    );
    assert!(Arc::ptr_eq(&removed, &original.live));
    assert_ne!(
        original.live.construction_id,
        replacement.live.construction_id
    );
    assert!(host
        .get_original("reused", Some(&original.live.construction_id))
        .is_err());
    let retired = host
        .kill_original_session("reused", Some(&original.live.construction_id))
        .unwrap();
    assert!(Arc::ptr_eq(&retired, &original.live));
    assert!(host.remove_if_child("reused", &original.live).is_none());
    assert!(Arc::ptr_eq(&host.get("reused").unwrap(), &replacement.live));
    assert!(!replacement_stream_stopped.load(Ordering::SeqCst));
    write_selected(
        host.get_original("reused", Some(&replacement.live.construction_id))
            .unwrap(),
        "replacement-only",
    );
    replacement.await_contents("replacement-only\n");
    assert_eq!(original.contents(), "");
    host.remove_if_child("reused", &replacement.live).unwrap();
    assert!(replacement_stream_stopped.load(Ordering::SeqCst));
}

#[test]
fn naturally_exited_original_receipt_drains_idempotently_after_replacement() {
    let host = HarnessHost::new();
    let original = ProcessFixture::new(&host, "natural", None);
    publish(&host, "natural", &original.live);
    write_selected(original.live.clone(), "__exit_original__");
    original
        .live
        .exit
        .as_ref()
        .unwrap()
        .wait(Duration::from_secs(5))
        .unwrap();
    host.remove_if_child("natural", &original.live).unwrap();
    let replacement = ProcessFixture::new(&host, "natural", Some(original.actual_pid));
    publish(&host, "natural", &replacement.live);
    let epoch = host.lock_inner().epochs["natural"];
    for _ in 0..2 {
        // Completed receipts may be reclaimed; a stale original must never select its replacement.
        assert_eq!(
            host.kill_original_session("natural", Some(&original.live.construction_id))
                .err()
                .unwrap(),
            "NATIVE_PROCESS_CONSTRUCTION_STALE"
        );
        assert_eq!(host.lock_inner().epochs["natural"], epoch);
        assert!(Arc::ptr_eq(
            &host.get("natural").unwrap(),
            &replacement.live
        ));
    }
    write_selected(replacement.live.clone(), "replacement-stays-live");
    replacement.await_contents("replacement-stays-live\n");
    assert!(host
        .kill_original_session("foreign-route", Some(&original.live.construction_id))
        .is_err());
    assert!(host
        .kill_original_session("natural", Some(&uuid::Uuid::new_v4().to_string()))
        .is_err());
}

#[test]
fn old_receipt_waits_actual_final_callback_without_stopping_new_process() {
    let host = Arc::new(HarnessHost::new());
    let (release, held_callback) = mpsc::channel();
    let original =
        ProcessFixture::with_final_callback(&host, "held-close", None, Some(held_callback));
    publish(&host, "held-close", &original.live);
    write_selected(original.live.clone(), "__exit_original__");
    original.process.wait_actual().unwrap();
    host.remove_if_child("held-close", &original.live).unwrap();
    let replacement = ProcessFixture::new(&host, "held-close", Some(original.actual_pid));
    publish(&host, "held-close", &replacement.live);
    let stopping = host.clone();
    let construction = original.live.construction_id.clone();
    let (entered, selected) = mpsc::channel();
    let (completed, done) = mpsc::channel();
    let stop = thread::spawn(move || {
        let old = stopping
            .kill_original_session("held-close", Some(&construction))
            .unwrap();
        entered.send(()).unwrap();
        completed.send(old.stop_and_drain()).unwrap();
    });
    selected.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(matches!(
        done.recv_timeout(Duration::from_millis(30)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    assert!(Arc::ptr_eq(
        &host.get("held-close").unwrap(),
        &replacement.live
    ));
    write_selected(replacement.live.clone(), "new-while-old-callback-held");
    replacement.await_contents("new-while-old-callback-held\n");
    release.send(()).unwrap();
    done.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    stop.join().unwrap();
}

#[test]
fn actual_source_window_required_before_current_or_historical_stop_effects() {
    let host = HarnessHost::new();
    let original = ProcessFixture::new(&host, "window-bound", None);
    publish(&host, "window-bound", &original.live);
    let foreign = Arc::new(crate::control::receipts::WindowIssuer::default());
    let epoch = host.lock_inner().epochs["window-bound"];
    assert!(host
        .select_original_for_stop(
            "window-bound",
            Some(&original.live.construction_id),
            Some(&foreign)
        )
        .is_ok());
    assert_eq!(host.lock_inner().epochs["window-bound"], epoch + 1);
    assert!(original.live.admit_write().is_err());
    let replacement = ProcessFixture::new(&host, "window-bound", None);
    publish(&host, "window-bound", &replacement.live);
    assert!(host
        .select_original_for_stop(
            "window-bound",
            Some(&original.live.construction_id),
            replacement.live.issuer.as_ref()
        )
        .is_ok());
    let selected = host
        .select_original_for_stop(
            "window-bound",
            Some(&original.live.construction_id),
            original.live.issuer.as_ref(),
        )
        .unwrap();
    assert!(Arc::ptr_eq(&selected, &original.live));
    assert!(Arc::ptr_eq(
        &host.get("window-bound").unwrap(),
        &replacement.live
    ));
}

#[test]
fn receipt_capacity_refuses_actual_spawn_before_child_or_authority_effect() {
    let host = HarnessHost::new();
    let original = ProcessFixture::new(&host, "capacity", None);
    publish(&host, "capacity", &original.live);
    let original_epoch = host.lock_inner().epochs["capacity"];
    let held = Arc::new(ManagedProviderExit::default());
    {
        let mut inner = host.lock_inner();
        for _ in 1..512 {
            inner.receipts.capacity().unwrap();
            inner.receipts.reserve("unknown-original", held.clone());
        }
    }
    assert!(
        matches!(host.reserve_process("capacity"), Err(error) if error == "NATIVE_PROCESS_RECEIPT_CAPACITY")
    );
    assert_eq!(host.lock_inner().epochs["capacity"], original_epoch);
    assert!(Arc::ptr_eq(&host.get("capacity").unwrap(), &original.live));
    write_selected(original.live.clone(), "capacity-refusal-keeps-original");
    original.await_contents("capacity-refusal-keeps-original\n");
    let marker = std::env::temp_dir().join(format!(
        "bycoda-capacity-noeffect-{}.txt",
        uuid::Uuid::new_v4()
    ));
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "harness::process_construction_tests::owned_stdin_child",
            "--ignored",
            "--nocapture",
        ])
        .env("BYCODA_PROCESS_CONSTRUCTION_CAPTURE", &marker)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    isolate_child(&mut command);
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let mut lease = store
        .authority_execution_gate()
        .reserve("fenced-capacity", "provider", None)
        .unwrap();
    let (epoch, all, _) = host.begin_spawn("fenced-capacity");
    let result = host.spawn_tracked_for_target(
        "fenced-capacity",
        "fenced-capacity",
        epoch,
        all,
        &mut command,
        Some(&mut lease),
    );
    assert!(matches!(result, Err(error) if error == "NATIVE_PROCESS_RECEIPT_CAPACITY"));
    assert!(!marker.exists());
    lease.finish().unwrap();
    held.finish(Err("original physical retirement remains unknown".into()));
    // A settled (even failed) original can now make room.
    assert!(host.lock_inner().receipts.capacity().is_ok());
}

#[test]
fn selected_original_arc_keeps_its_physical_pipe_after_route_replacement() {
    let host = HarnessHost::new();
    let original = ProcessFixture::new(&host, "pinned", None);
    publish(&host, "pinned", &original.live);
    let selected = host
        .get_original("pinned", Some(&original.live.construction_id))
        .unwrap();
    let admission = selected.admit_write().unwrap();
    let replacement = ProcessFixture::new(&host, "pinned", None);
    publish(&host, "pinned", &replacement.live);
    write_child_with_deadline_admitted(
        selected,
        "accepted-before-replacement".into(),
        Duration::from_secs(3),
        None,
        admission,
    )
    .unwrap();
    original.await_contents("accepted-before-replacement\n");
    assert_eq!(replacement.contents(), "");
    assert!(host.remove_if_child("pinned", &original.live).is_none());
    write_selected(
        host.get_original("pinned", Some(&replacement.live.construction_id))
            .unwrap(),
        "new-source",
    );
    replacement.await_contents("new-source\n");
    host.remove_if_child("pinned", &replacement.live).unwrap();
}

fn await_original_stop(process: &NativeOutputChild) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !process.signals_closed() || !process.exit_observed() {
        assert!(
            Instant::now() < deadline,
            "original stop phase did not complete"
        );
        thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn write_timeout_keeps_original_and_targeted_close_does_not_touch_replacement() {
    let host = HarnessHost::new();
    let replacement = ProcessFixture::new(&host, "same", None);
    let original = ProcessFixture::new(&host, "same", Some(replacement.actual_pid));
    publish(&host, "same", &original.live);
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let lease = store
        .authority_execution_gate()
        .reserve("same", "provider-stdin", None)
        .unwrap();
    let admission = original.live.admit_write().unwrap();
    let writing = original.live.clone();
    let (at_io, io_observed) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (deadline, deadline_fired) = mpsc::channel();
    let (returned, result) = mpsc::channel();
    let writer = thread::spawn(move || {
        returned
            .send(write_child_with_deadline_waiter(
                writing,
                "original-only".into(),
                Duration::from_millis(20),
                Some(lease),
                admission,
                move || {
                    at_io.send(()).unwrap();
                    released.recv_timeout(Duration::from_secs(10)).unwrap();
                },
                move |_rx, _timeout| {
                    deadline_fired
                        .recv_timeout(Duration::from_secs(10))
                        .unwrap();
                    Err(mpsc::RecvTimeoutError::Timeout)
                },
            ))
            .unwrap();
    });
    io_observed.recv_timeout(Duration::from_secs(5)).unwrap();
    original.await_contents("original-only\n");
    // Fire the observation only after this explicit fixture consumption. An OS
    // stdin callback/flush does not promise that the provider already ran.
    deadline.send(()).unwrap();
    // A pure write timeout reports the error but never stops the live original.
    assert!(result
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap_err()
        .contains("outcome unknown"));
    writer.join().unwrap();
    assert!(!original.process.signals_closed());
    assert!(!original.live.writers.is_closing());
    let reservations = || -> i64 {
        store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM native_authority_reservations WHERE session_id='same'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert_eq!(
        reservations(),
        1,
        "the held actual writer still owns its lease"
    );
    release.send(()).unwrap();
    let until = Instant::now() + Duration::from_secs(5);
    while reservations() != 0 {
        assert!(
            Instant::now() < until,
            "the actual successful I/O tail released its own lease"
        );
        thread::sleep(Duration::from_millis(5));
    }
    // Targeted close stays best-effort and never touches the replacement.
    let stopped = host
        .kill_original_session("same", Some(&original.live.construction_id))
        .unwrap();
    publish(&host, "same", &replacement.live);
    assert!(stopped.stop_and_drain().is_ok());
    assert!(original.live.admit_write().is_err());
    write_selected(replacement.live.clone(), "replacement-live");
    replacement.await_contents("replacement-live\n");
    host.remove_if_child("same", &replacement.live).unwrap();
}

#[test]
fn failed_actual_pipe_writer_retains_unknown_authority_after_its_real_thread_drains() {
    let host = HarnessHost::new();
    let source = ProcessFixture::new(&host, "failed-pipe", None);
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let lease = store
        .authority_execution_gate()
        .reserve("failed-pipe", "provider-stdin", None)
        .unwrap();
    let admission = source.live.admit_write().unwrap();
    source.live.request_stop().unwrap();
    await_original_stop(&source.process);
    let (at_io, observed) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let writing = source.live.clone();
    let writer = thread::spawn(move || {
        write_child_with_deadline_observed(
            writing,
            "cannot-arrive".into(),
            Duration::from_secs(5),
            Some(lease),
            admission,
            move || {
                at_io.send(()).unwrap();
                released.recv_timeout(Duration::from_secs(10)).unwrap();
            },
        )
    });
    observed.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(!writer.is_finished());
    release.send(()).unwrap();
    assert!(writer
        .join()
        .unwrap()
        .unwrap_err()
        .contains("Failed to write"));
    // Stop is best-effort and idempotent; the failed write is only logged.
    assert!(source.live.stop_and_drain().is_ok());
    let retained: i64 = store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM native_authority_reservations WHERE session_id='failed-pipe'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        retained, 0,
        "the drained writer releases its lease even when I/O failed"
    );
    assert_eq!(source.contents(), "");
}

#[test]
fn authority_refusal_before_actual_write_does_not_stop_or_detach_the_original_process() {
    let host = HarnessHost::new();
    let source = ProcessFixture::new(&host, "authority-denied", None);
    publish(&host, "authority-denied", &source.live);
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let lease = store
        .authority_execution_gate()
        .reserve("authority-denied", "provider-stdin", None)
        .unwrap();
    store.lock_conn().unwrap().execute("INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol) VALUES('env','authority-denied',1,'FENCED','migration',2)", []).unwrap();
    let admission = source.live.admit_write().unwrap();
    let error = write_child_with_deadline_admitted(
        source.live.clone(),
        "must-not-arrive".into(),
        Duration::from_secs(2),
        Some(lease),
        admission,
    )
    .unwrap_err();
    assert!(error.contains("NATIVE_AUTHORITY"));
    assert!(!source.live.writers.is_closing());
    assert!(Arc::ptr_eq(
        &host.get("authority-denied").unwrap(),
        &source.live
    ));
    assert_eq!(source.contents(), "");
    write_selected(source.live.clone(), "still-owned");
    source.await_contents("still-owned\n");
    host.remove_if_child("authority-denied", &source.live)
        .unwrap();
}

#[cfg(windows)]
#[test]
#[ignore = "isolated fast-descendant producer; invoked only by its owned parent fixture"]
fn fast_descendant_child() {
    let mut leaf = Command::new(std::env::current_exe().unwrap());
    leaf.arg("--list")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::hide_window_console(&mut leaf);
    assert!(leaf.spawn().unwrap().wait().unwrap().success());
    println!("DESCENDANT-DRAINED");
    std::io::stdout().flush().unwrap();
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    println!("known-command-output");
    eprintln!("known-command-diagnostic");
    std::process::exit(7);
}

#[cfg(windows)]
fn fast_descendant_command() -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "harness::process_construction_tests::fast_descendant_child",
            "--ignored",
            "--nocapture",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate_child(&mut command);
    command
}

#[cfg(windows)]
fn observe_fast_descendant(child: &mut OwnedChild) {
    // Observe the child-authored barrier before ProcessOwner starts polling.
    // The job retains the original parent HANDLE, but this finished birth has
    // intentionally not been captured by an observation loop.
    let mut seen = String::new();
    let mut byte = [0u8; 1];
    while !seen.ends_with("DESCENDANT-DRAINED\n") && !seen.ends_with("DESCENDANT-DRAINED\r\n") {
        child
            .stdout
            .as_mut()
            .unwrap()
            .read_exact(&mut byte)
            .unwrap();
        seen.push(byte[0] as char);
        assert!(seen.len() < 8192);
    }
}

#[cfg(windows)]
#[test]
fn fast_descendant_keeps_actual_one_shot_output_and_retires_best_effort() {
    let mut child = OwnedChild::spawn(&mut fast_descendant_command()).unwrap();
    observe_fast_descendant(&mut child);
    let rx = output_wait(child);
    let output = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    assert_eq!(output.status.code(), Some(7));
    assert!(String::from_utf8_lossy(&output.stdout).contains("known-command-output"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("known-command-diagnostic"));
    // Unproven job birth is logged and terminated, never a failed completion.
    assert!(rx.owner.retirement().require_verified().is_ok());
    let response = ShellCommandOutput {
        output: String::from_utf8_lossy(&output.stdout).into_owned(),
        exit_code: output.status.code(),
        timed_out: false,
        retirement: rx.owner.retirement(),
    };
    assert!(response.require_activity_retirement().is_ok());
    let wire = serde_json::to_value(&response).unwrap();
    assert_eq!(wire["exitCode"], 7);
    assert!(wire["output"]
        .as_str()
        .unwrap()
        .contains("known-command-output"));
    assert!(wire.get("retirement").is_none());
}

#[cfg(windows)]
#[test]
fn fast_descendant_native_terminal_keeps_exit_status_and_releases_spawn_authority() {
    let host = HarnessHost::new();
    let store = crate::session_store::SessionStore::open_in_memory().unwrap();
    let mut lease = store
        .authority_execution_gate()
        .reserve("fast-source", "provider-spawn", None)
        .unwrap();
    let (epoch, all, _) = host.begin_spawn("fast-source");
    let (mut child, exit) = host
        .spawn_tracked_for_target(
            "fast-source",
            "fast-source",
            epoch,
            all,
            &mut fast_descendant_command(),
            Some(&mut lease),
        )
        .unwrap();
    observe_fast_descendant(&mut child);
    drop(child.stdin.take());
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (output, process) = host.output.begin_process(
        OutputSource::fixture("fast-source"),
        child,
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    let out = output.reader(0);
    let err = output.reader(1);
    let stdout = thread::spawn(move || read_provider_lines(stdout, out, |_| {}));
    let stderr = thread::spawn(move || read_provider_lines(stderr, err, |_| {}));
    let status = process.wait(&output, false).unwrap();
    assert_eq!(status.code(), Some(7));
    assert!(stdout.join().unwrap());
    assert!(stderr.join().unwrap());
    output.terminal_delivery(true);
    assert!(output.verified_emit_seal().is_ok());
    assert!(process.retirement().require_verified().is_ok());
    exit.finish(finish_spawn_authority(&process.retirement(), lease));
    assert!(exit.succeeded());
    assert!(host.authority_idle("fast-source").is_ok());
    let retained: i64 = store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM native_authority_reservations WHERE session_id='fast-source'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(retained, 0);
}
