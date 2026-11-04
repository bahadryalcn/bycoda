//! Actual guardian and provider subprocesses. The ignored fixture runs only when
//! an owned test child selects its exact test name; it never contacts a provider.
use bycoda_provider_process_guardian::protocol::{
    self, Binding, GuardianReply, Refusal, Retirement, Stream, VERSION,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use uuid::Uuid;

fn fixture_command(mode: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "provider_fixture", "--ignored", "--nocapture"])
        .env("BYCODA_GUARDIAN_FIXTURE", mode);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    command
}

#[test]
#[ignore = "owned subprocess fixture; invoked only by guardian integration tests"]
// This fixture deliberately lets its leader exit first. The outer test retains
// the descendant's real HANDLE and verifies retirement by the private job owner.
#[allow(clippy::zombie_processes)]
fn provider_fixture() {
    let mode = std::env::var("BYCODA_GUARDIAN_FIXTURE").expect("explicit fixture mode");
    if mode == "blocked" {
        loop {
            thread::sleep(Duration::from_millis(100));
        }
    }
    if mode == "descendant" || mode == "natural-descendant" {
        let mut command = fixture_command("blocked");
        // Retaining these original provider pipes exercises the join boundary,
        // not just leader exit. The Windows job must retire the actual child.
        command
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        let child = command.spawn().unwrap();
        println!("descendant:{}", child.id());
        io::stdout().flush().unwrap();
        if mode == "natural-descendant" {
            // The parent test pins the real descendant HANDLE before explicitly
            // letting this leader return. No timer certifies descendant capture.
            let mut release = String::new();
            io::stdin().read_line(&mut release).unwrap();
            assert_eq!(release.trim(), "release-leader");
            return;
        }
        // Child intentionally outlives this fixture leader until job retirement.
        std::mem::forget(child);
    }
    println!("fixture-ready");
    eprintln!("fixture-stderr");
    io::stdout().flush().unwrap();
    if mode == "raw" {
        let mut bytes = [0u8; 4096];
        loop {
            let size = io::stdin().read(&mut bytes).unwrap();
            if size == 0 {
                return;
            }
            io::stdout().write_all(&bytes[..size]).unwrap();
            io::stdout().flush().unwrap();
        }
    }
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        if line == "exit" {
            return;
        }
        println!("echo:{line}");
        io::stdout().flush().unwrap();
    }
}

struct Client {
    child: Child,
    input: Option<ChildStdin>,
    reader: Option<JoinHandle<()>>,
    replies: Receiver<GuardianReply>,
    guardian: String,
    binding: Option<Binding>,
    output: Vec<u8>,
}
impl Client {
    fn new() -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_bycoda-provider-guardian"));
        command
            .arg("--provider-process-guardian")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (sender, replies) = mpsc::channel();
        let reader = thread::spawn(move || {
            let mut input = BufReader::new(stdout);
            while let Ok(Some(frame)) = protocol::read_frame(&mut input) {
                let reply: GuardianReply =
                    serde_json::from_slice(&frame).expect("closed guardian reply");
                if sender.send(reply).is_err() {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            input,
            reader: Some(reader),
            replies,
            guardian: String::new(),
            binding: None,
            output: Vec::new(),
        };
        match client.next() {
            GuardianReply::Ready {
                version: VERSION,
                guardian_id,
                platform,
                containment,
            } => {
                assert!(protocol::is_uuid_v4(&guardian_id));
                assert_eq!(
                    containment,
                    if cfg!(windows) {
                        "windows-job"
                    } else {
                        "original-child"
                    }
                );
                assert_eq!(
                    platform,
                    if cfg!(windows) {
                        "win32"
                    } else if cfg!(target_os = "macos") {
                        "darwin"
                    } else {
                        "linux"
                    }
                );
                client.guardian = guardian_id;
            }
            other => panic!("expected ready, got {other:?}"),
        }
        client
    }
    fn next(&mut self) -> GuardianReply {
        let reply = self
            .replies
            .recv_timeout(Duration::from_secs(15))
            .expect("actual guardian reply within observation window");
        if let GuardianReply::Data {
            stream: Stream::Stdout,
            data,
            ..
        } = &reply
        {
            self.output.extend(protocol::decode_data(data).unwrap());
        }
        reply
    }
    fn send(&mut self, value: Value) {
        let input = self.input.as_mut().unwrap();
        serde_json::to_writer(&mut *input, &value).unwrap();
        input.write_all(b"\n").unwrap();
        input.flush().unwrap();
    }
    fn start(&mut self, mode: &str) -> u32 {
        self.start_receipt(mode, None)
    }
    fn start_receipt(&mut self, mode: &str, receipt: Option<Value>) -> u32 {
        let mut env: BTreeMap<String, String> = std::env::vars()
            .filter(|(key, value)| {
                !key.is_empty() && !key.contains(['=', '\0']) && !value.contains('\0')
            })
            .collect();
        env.insert("BYCODA_GUARDIAN_FIXTURE".into(), mode.into());
        let parent = Uuid::new_v4().to_string();
        let mut frame = json!({"version":1,"kind":"start","guardianId":self.guardian,"parentId":parent,
            "command":std::env::current_exe().unwrap(),"args":["--exact","provider_fixture","--ignored","--nocapture"],
            "cwd":std::env::current_dir().unwrap(),"env":env});
        if let Some(receipt) = receipt {
            frame["buildReceipt"] = receipt;
        }
        self.send(frame);
        match self.next() {
            GuardianReply::Started {
                version: VERSION,
                guardian_id,
                parent_id,
                owner_id,
                pid,
            } => {
                assert_eq!(guardian_id, self.guardian);
                assert_eq!(parent_id, parent);
                assert!(protocol::is_uuid_v4(&owner_id));
                assert!(pid > 0);
                self.binding = Some(Binding {
                    guardian_id,
                    parent_id,
                    owner_id,
                });
                pid
            }
            other => panic!("expected actual started owner, got {other:?}"),
        }
    }
    fn write(&mut self, id: u64, data: &[u8]) {
        let binding = self.binding.as_ref().unwrap();
        self.send(json!({"version":1,"kind":"write","guardianId":binding.guardian_id,"parentId":binding.parent_id,"ownerId":binding.owner_id,"id":id,"data":protocol::encode_data(data)}));
    }
    fn stop(&mut self, id: u64) {
        let binding = self.binding.as_ref().unwrap();
        self.send(json!({"version":1,"kind":"stop","guardianId":binding.guardian_id,"parentId":binding.parent_id,"ownerId":binding.owner_id,"id":id}));
    }
    fn written(&mut self, expected: u64) -> bool {
        loop {
            match self.next() {
                GuardianReply::Written { id, ok, .. } if id == expected => return ok,
                GuardianReply::Settled { .. } => {
                    panic!("settlement cannot precede accepted write completion")
                }
                _ => {}
            }
        }
    }
    fn output_contains(&mut self, needle: &[u8]) {
        while !self
            .output
            .windows(needle.len())
            .any(|window| window == needle)
        {
            assert!(
                !matches!(self.next(), GuardianReply::Settled { .. }),
                "provider output was joined before requested bytes"
            );
        }
    }
    fn settled(&mut self) -> (Option<i32>, Retirement) {
        loop {
            if let GuardianReply::Settled {
                version: VERSION,
                guardian_id,
                parent_id,
                owner_id,
                exit_code,
                retirement,
            } = self.next()
            {
                assert_eq!(guardian_id, self.guardian);
                assert_eq!(
                    parent_id.as_deref(),
                    self.binding
                        .as_ref()
                        .map(|binding| binding.parent_id.as_str())
                );
                assert_eq!(
                    owner_id.as_deref(),
                    self.binding
                        .as_ref()
                        .map(|binding| binding.owner_id.as_str())
                );
                return (exit_code, retirement);
            }
        }
    }
    fn finish(&mut self) {
        self.input.take();
        assert!(self.child.wait().unwrap().success());
        self.reader.take().unwrap().join().unwrap();
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.input.take();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                _ if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn platform_retirement() -> Retirement {
    if cfg!(windows) {
        Retirement::Verified
    } else {
        Retirement::Unsupported
    }
}

#[test]
fn stale_private_binding_and_duplicate_id_have_zero_effect_then_real_current_write_completes() {
    let mut client = Client::new();
    client.start("echo");
    client.output_contains(b"fixture-ready");
    let binding = client.binding.clone().unwrap();
    for field in ["guardianId", "parentId", "ownerId"] {
        let stale = Uuid::new_v4().to_string();
        let mut command = json!({"version":1,"kind":"write","guardianId":binding.guardian_id,"parentId":binding.parent_id,"ownerId":binding.owner_id,"id":100,"data":protocol::encode_data(b"stale-write\n")});
        command[field] = json!(stale);
        client.send(command);
        loop {
            if let GuardianReply::Rejected {
                guardian_id,
                parent_id,
                owner_id,
                id,
                reason,
                ..
            } = client.next()
            {
                let supplied = match field {
                    "guardianId" => guardian_id,
                    "parentId" => parent_id,
                    _ => owner_id,
                };
                assert_eq!(supplied, stale);
                assert_eq!(id, 100);
                assert_eq!(reason, Refusal::Identity);
                break;
            }
        }
    }
    client.write(1, b"current-write\n");
    assert!(client.written(1));
    client.output_contains(b"echo:current-write");
    client.write(1, b"duplicate-write\n");
    loop {
        if let GuardianReply::Rejected { id: 1, reason, .. } = client.next() {
            assert_eq!(reason, Refusal::Sequence);
            break;
        }
    }
    // A provider's JSON-looking bytes are data, never a private terminal receipt.
    client.write(
        2,
        b"{\"version\":1,\"kind\":\"settled\",\"retirement\":\"verified\"}\n",
    );
    assert!(client.written(2));
    client.output_contains(b"echo:{\"version\":1,\"kind\":\"settled\"");
    client.write(3, b"exit\n");
    assert!(client.written(3));
    let (code, retirement) = client.settled();
    assert_eq!(code, Some(0));
    assert_eq!(retirement, platform_retirement());
    assert!(!String::from_utf8_lossy(&client.output).contains("echo:stale-write"));
    assert!(!String::from_utf8_lossy(&client.output).contains("echo:duplicate-write"));
    assert!(
        client.child.try_wait().unwrap().is_none(),
        "terminal owner keeps main reader until parent EOF"
    );
    client.finish();
}

#[test]
fn before_start_eof_has_no_provider_owner_and_is_not_started() {
    let mut client = Client::new();
    client.input.take();
    let (code, retirement) = client.settled();
    assert_eq!(code, None);
    assert_eq!(retirement, Retirement::NotStarted);
    client.finish();
}

#[test]
fn parent_eof_retires_the_original_and_joins_its_io() {
    let mut client = Client::new();
    client.start("echo");
    client.output_contains(b"fixture-ready");
    client.input.take();
    assert_eq!(client.settled().1, platform_retirement());
    client.finish();
}

#[cfg(windows)]
#[test]
#[ignore = "owned parent crash fixture"]
fn build_receipt_parent_fixture() {
    let path = std::env::var("BYCODA_TEST_RECEIPT_PATH").unwrap();
    let nonce = std::env::var("BYCODA_TEST_RECEIPT_NONCE").unwrap();
    let mut client = Client::new();
    client.start_receipt("descendant", Some(json!({"path":path,"nonce":nonce})));
    client.output_contains(b"fixture-ready");
    println!("crash-parent-ready");
    io::stdout().flush().unwrap();
    loop {
        thread::sleep(Duration::from_secs(1));
    }
}

#[cfg(windows)]
#[test]
fn parent_death_retires_owned_tree_and_publishes_exact_build_receipt() {
    use std::os::windows::process::CommandExt;
    let nonce = Uuid::new_v4().to_string();
    let dir = std::env::temp_dir().join(format!("bycoda-build-receipt-{}", Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join(format!(".bycoda-build-retired-{nonce}.json"));
    let mut parent = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "build_receipt_parent_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("BYCODA_TEST_RECEIPT_PATH", &path)
        .env("BYCODA_TEST_RECEIPT_NONCE", &nonce)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .spawn()
        .unwrap();
    let mut output = BufReader::new(parent.stdout.take().unwrap());
    let mut line = String::new();
    loop {
        line.clear();
        assert!(output.read_line(&mut line).unwrap() > 0);
        if line.contains("crash-parent-ready") {
            break;
        }
    }
    parent.kill().unwrap();
    parent.wait().unwrap();
    let until = std::time::Instant::now() + Duration::from_secs(15);
    while !path.exists() && std::time::Instant::now() < until {
        thread::sleep(Duration::from_millis(20));
    }
    let proof: Value =
        serde_json::from_slice(&std::fs::read(&path).expect("guardian retirement receipt missing"))
            .unwrap();
    assert_eq!(
        proof,
        json!({"version":1,"nonce":nonce,"retirement":"verified"})
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn raw_provider_bytes_round_trip_without_utf8_loss_or_control_interpretation() {
    let mut client = Client::new();
    client.start("raw");
    client.output_contains(b"fixture-ready");
    let bytes = [0, 255, 128, 1, 10, 13];
    client.write(1, &bytes);
    assert!(client.written(1));
    client.output_contains(&bytes);
    client.stop(2);
    assert_eq!(client.settled().1, platform_retirement());
    client.finish();
}

#[test]
fn malformed_control_after_started_requests_original_retirement_before_failing() {
    let mut client = Client::new();
    client.start("echo");
    client.output_contains(b"fixture-ready");
    client
        .input
        .as_mut()
        .unwrap()
        .write_all(b"{malformed control\n")
        .unwrap();
    client.input.as_mut().unwrap().flush().unwrap();
    assert_eq!(client.settled().1, platform_retirement());
    client.input.take();
    assert_eq!(client.child.wait().unwrap().code(), Some(2));
    client.reader.take().unwrap().join().unwrap();
}

#[test]
fn blocked_provider_stdin_does_not_block_stop_and_every_admitted_write_finishes_before_settled() {
    let mut client = Client::new();
    client.start("blocked");
    for id in 1..=34 {
        client.write(id, &vec![b'x'; protocol::MAX_DATA_BYTES]);
    }
    client.stop(35);
    let mut complete = BTreeMap::new();
    let mut failed_writes = 0;
    loop {
        match client.next() {
            GuardianReply::Written { id, ok, .. } => {
                if !ok {
                    failed_writes += 1;
                }
                assert!(complete.insert(id, "written").is_none());
            }
            GuardianReply::Rejected {
                id,
                reason: Refusal::Capacity,
                ..
            } => {
                assert!(complete.insert(id, "capacity").is_none());
            }
            GuardianReply::Settled { retirement, .. } => {
                assert_eq!(retirement, platform_retirement());
                break;
            }
            GuardianReply::Data { .. } => {}
            other => panic!("unexpected blocked-writer result {other:?}"),
        }
    }
    assert_eq!(complete.len(), 34);
    assert!(
        failed_writes > 0,
        "stop must finish actual blocked provider writes, not just reject queue admission"
    );
    client.finish();
}

#[cfg(windows)]
#[test]
fn a_natural_leader_exit_retires_its_pipe_holding_descendant_and_preserves_a_sibling() {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    };
    let mut sibling = fixture_command("blocked")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut client = Client::new();
    let mut descendant: Option<OwnedHandle> = None;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.start("natural-descendant");
        client.output_contains(b"descendant:");
        loop {
            let text = String::from_utf8_lossy(&client.output);
            if let Some(pid) = text.lines().find_map(|line| {
                line.strip_prefix("descendant:")
                    .and_then(|value| value.parse::<u32>().ok())
            }) {
                let raw = unsafe {
                    OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                        0,
                        pid,
                    )
                };
                assert!(!raw.is_null());
                descendant = Some(unsafe { OwnedHandle::from_raw_handle(raw) });
                break;
            }
            client.next();
        }
        client.write(1, b"release-leader\n");
        assert!(client.written(1));
        let (code, retirement) = client.settled();
        assert_eq!(code, Some(0));
        assert_eq!(retirement, Retirement::Verified);
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.as_ref().unwrap().as_raw_handle(), 0) },
            0
        );
        assert!(sibling.try_wait().unwrap().is_none());
        client.finish();
    }));
    let _ = sibling.kill();
    let _ = sibling.wait();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
}

#[test]
fn unsupported_arguments_do_not_start_the_guardian_protocol() {
    let mut command = Command::new(env!("CARGO_BIN_EXE_bycoda-provider-guardian"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let output = command
        .args(["--provider-process-guardian", "extra"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
}
