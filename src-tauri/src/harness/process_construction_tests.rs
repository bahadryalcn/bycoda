//! Physical pipe fixtures for the process receipt boundary. These do not qualify
//! Native output retention, HTTP/SSE routing, or provider consumption.
use super::*;
use crate::native_provider_output::NativeOutputChild;

struct ProcessFixture {
    live: Arc<LiveChild>,
    process: Arc<NativeOutputChild>,
    output: Arc<NativeOutputStream>,
    actual_pid: u32,
    capture: PathBuf,
}

impl ProcessFixture {
    fn new(host: &HarnessHost, session: &str, advertised_pid: Option<u32>) -> Self {
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
        let mut child = command.spawn().unwrap();
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
            account: None,
            owners: Arc::new(Owners::default()),
            output: Some(Arc::clone(&output)),
        });
        Self {
            live,
            process,
            output,
            actual_pid,
            capture,
        }
    }

    fn contents(&self) -> String {
        std::fs::read_to_string(&self.capture).unwrap_or_default()
    }

    fn await_contents(&self, expected: &str) {
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
        terminate(self.actual_pid);
        let _ = self.process.wait(&self.output, true);
        self.output.reader(0).finish(true, true);
        self.output.reader(1).finish(true, true);
        self.output.terminal_delivery(false);
        let _ = std::fs::remove_file(&self.capture);
    }
}

fn publish(host: &HarnessHost, session: &str, live: &Arc<LiveChild>) -> Option<Arc<LiveChild>> {
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
        writeln!(file, "{}", line.unwrap()).unwrap();
        file.sync_all().unwrap();
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
    assert!(host
        .kill_original_session("reused", Some(&original.live.construction_id))
        .is_err());
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
fn selected_original_arc_keeps_its_physical_pipe_after_route_replacement() {
    let host = HarnessHost::new();
    let original = ProcessFixture::new(&host, "pinned", None);
    publish(&host, "pinned", &original.live);
    let selected = host
        .get_original("pinned", Some(&original.live.construction_id))
        .unwrap();
    let replacement = ProcessFixture::new(&host, "pinned", None);
    publish(&host, "pinned", &replacement.live);
    write_selected(selected, "accepted-before-replacement");
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
