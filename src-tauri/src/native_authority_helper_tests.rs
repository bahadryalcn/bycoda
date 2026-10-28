use super::*;
use std::io::Cursor;

fn encoded(value: &Value) -> Vec<u8> {
    let mut bytes = Vec::new();
    write_frame(&mut bytes, value).unwrap();
    bytes
}
fn decoded(bytes: &[u8]) -> Vec<Value> {
    let mut input = Cursor::new(bytes);
    let mut values = Vec::new();
    while let Some(frame) = read_frame(&mut input).unwrap() {
        values.push(serde_json::from_slice(&frame).unwrap());
    }
    values
}
fn locator() -> String {
    format!(
        r"\\.\pipe\bycoda-authority-v1-{}",
        uuid::Uuid::new_v4().simple()
    )
}

#[test]
fn clean_stdio_eof_is_empty_success_but_partial_frames_are_generic_errors() {
    let mut output = Vec::new();
    assert_eq!(run(&mut Cursor::new([]), &mut output), 0);
    assert!(output.is_empty());
    for input in [vec![1], vec![1, 0, 0], vec![4, 0, 0, 0, b'{']] {
        let mut output = Vec::new();
        assert_eq!(run(&mut Cursor::new(input), &mut output), 2);
        assert_eq!(
            decoded(&output),
            vec![json!({"kind":"error","code":"INVALID_FRAME"})]
        );
    }
}

#[test]
fn bootstrap_is_closed_locator_only_and_never_accepts_pid_or_identity_claims() {
    for value in [
        json!({"version":1,"address":locator(),"pid":std::process::id()}),
        json!({"version":1,"address":locator(),"token":"do-not-disclose"}),
        json!({"version":1,"address":locator(),"image":"forged.exe"}),
        json!({"version":2,"address":locator()}),
        json!({"version":1,"address":r"\\remote\pipe\other"}),
        json!({"version":1}),
    ] {
        let mut output = Vec::new();
        assert_eq!(run(&mut Cursor::new(encoded(&value)), &mut output), 2);
        assert_eq!(
            decoded(&output),
            vec![json!({"kind":"error","code":"INVALID_BOOTSTRAP"})]
        );
        assert!(!String::from_utf8_lossy(&output).contains("do-not-disclose"));
        assert!(!String::from_utf8_lossy(&output).contains("forged.exe"));
    }
}

#[test]
fn duplicate_bootstrap_fields_are_not_normalized_into_a_valid_locator() {
    let body = format!(
        r#"{{"version":1,"address":"not-a-pipe","address":{}}}"#,
        serde_json::to_string(&locator()).unwrap()
    );
    let mut bytes = (body.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(body.as_bytes());
    let mut output = Vec::new();
    assert_eq!(run(&mut Cursor::new(bytes), &mut output), 2);
    assert_eq!(
        decoded(&output),
        vec![json!({"kind":"error","code":"INVALID_BOOTSTRAP"})]
    );
}

#[test]
fn frame_limits_are_checked_before_body_reads_and_before_stdout_disclosure() {
    let mut input = Cursor::new(((MAX_CONTROL_FRAME + 1) as u32).to_le_bytes());
    assert_eq!(read_frame(&mut input), Err(ErrorCode::FrameTooLarge));
    assert_eq!(input.position(), 4);
    let mut output = Vec::new();
    let value = Value::String("x".repeat(MAX_CONTROL_FRAME - 2));
    write_frame(&mut output, &value).unwrap();
    assert_eq!(output.len(), MAX_CONTROL_FRAME + 4);
    let mut output = Vec::new();
    assert_eq!(
        write_frame(
            &mut output,
            &json!({"kind":"received","id":1,"value":value})
        ),
        Err(ErrorCode::FrameTooLarge)
    );
    assert!(output.is_empty());
    assert_eq!(
        write_frame(&mut output, &json!("\"".repeat(MAX_CONTROL_FRAME))),
        Err(ErrorCode::FrameTooLarge)
    );
    assert!(output.is_empty());
}

#[test]
fn malformed_json_utf8_and_zero_length_never_become_control_commands() {
    for body in [vec![], vec![0xff], b"{} trailing".to_vec(), b"{".to_vec()] {
        let mut frame = (body.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(&body);
        assert_eq!(
            read_frame(&mut Cursor::new(frame)),
            Err(ErrorCode::InvalidFrame)
        );
    }
    assert!(serde_json::from_slice::<Command>(br#"{"kind":"receive","id":1,"pid":1}"#).is_err());
    assert!(serde_json::from_slice::<Command>(
        br#"{"kind":"send","id":1,"value":null,"extra":true}"#
    )
    .is_err());
}

#[test]
fn stdout_failure_has_no_recursive_error_or_source_detail_disclosure() {
    struct Broken;
    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("sensitive OS error detail"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    assert_eq!(run(&mut Cursor::new(vec![1]), &mut Broken), 2);
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::native_authority_peer::NativePeerExpectation;
    use crate::native_authority_pipe::AuthorityPipeListener;
    use std::io::{BufRead, BufReader};
    use std::os::windows::process::CommandExt;
    use std::process::{Child, ChildStdin, Command as ProcessCommand, Stdio};
    use std::sync::mpsc::{self, Receiver};
    use std::time::Instant;

    const MARKER: &str = "NATIVE_AUTHORITY_HELPER_FIXTURE";
    struct HelperChild {
        child: Child,
        input: Option<ChildStdin>,
        replies: Receiver<Result<Value, ErrorCode>>,
        reader: Option<std::thread::JoinHandle<()>>,
    }
    impl HelperChild {
        fn spawn() -> Self {
            let mut command = ProcessCommand::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--ignored",
                    "--exact",
                    "native_authority_helper::tests::windows::hidden_stdio_helper",
                    "--nocapture",
                ])
                .env_clear()
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .creation_flags(0x08000000);
            for name in ["SystemRoot", "WINDIR"] {
                if let Some(value) = std::env::var_os(name) {
                    command.env(name, value);
                }
            }
            let mut child = command.spawn().unwrap();
            let input = child.stdin.take();
            let stdout = child.stdout.take().unwrap();
            let (send, replies) = mpsc::channel();
            let reader = std::thread::spawn(move || {
                let mut stdout = BufReader::new(stdout);
                let mut skipped = 0;
                loop {
                    let mut line = String::new();
                    let Ok(size) = stdout.read_line(&mut line) else {
                        return;
                    };
                    skipped += size;
                    if size == 0 || skipped > 4096 {
                        return;
                    }
                    if line.trim() == MARKER {
                        break;
                    }
                }
                loop {
                    match read_frame(&mut stdout) {
                        Ok(Some(frame)) => {
                            let value =
                                serde_json::from_slice(&frame).map_err(|_| ErrorCode::InvalidFrame);
                            if send.send(value).is_err() {
                                return;
                            }
                        }
                        Ok(None) => return,
                        Err(code) => {
                            let _ = send.send(Err(code));
                            return;
                        }
                    }
                }
            });
            Self {
                child,
                input,
                replies,
                reader: Some(reader),
            }
        }
        fn send(&mut self, value: &Value) {
            write_frame(self.input.as_mut().unwrap(), value).unwrap();
        }
        fn next(&self) -> Value {
            self.replies
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap()
        }
        fn expected(&self) -> NativePeerExpectation {
            NativePeerExpectation::for_owned_child(&self.child, &std::env::current_exe().unwrap())
                .unwrap()
        }
        fn exited(&mut self, expected: i32) {
            let until = Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(status) = self.child.try_wait().unwrap() {
                    assert_eq!(status.code(), Some(expected));
                    return;
                }
                assert!(Instant::now() < until, "owned helper did not exit");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
    impl Drop for HelperChild {
        fn drop(&mut self) {
            self.input.take();
            settle_child(&mut self.child);
            if let Some(reader) = self.reader.take() {
                reader.join().unwrap();
            }
        }
    }
    fn settle_child(child: &mut Child) {
        let until = Instant::now() + Duration::from_secs(2);
        loop {
            if child.try_wait().unwrap().is_some() {
                return;
            }
            if Instant::now() >= until {
                let _ = child.kill();
                child.wait().unwrap();
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn connected() -> (HelperChild, AuthorityPipeConnection) {
        let listener = AuthorityPipeListener::bind().unwrap();
        let mut child = HelperChild::spawn();
        child.send(&json!({"version":1,"address":listener.address().as_str()}));
        let pipe = listener
            .accept(&child.expected(), &budget().unwrap())
            .unwrap();
        assert_eq!(child.next(), json!({"version":1,"kind":"ready"}));
        (child, pipe)
    }

    #[test]
    #[ignore = "owned hidden helper entry; parent consumes test-harness prelude before exact production stdio core"]
    fn hidden_stdio_helper() {
        let mut output = std::io::stdout().lock();
        writeln!(output, "{MARKER}").unwrap();
        output.flush().unwrap();
        drop(output);
        std::process::exit(run_stdio());
    }

    #[test]
    #[ignore = "owned Node interop server fixture; never a production endpoint"]
    fn node_pipe_server_fixture() {
        let listener = AuthorityPipeListener::bind().unwrap();
        {
            let mut output = std::io::stdout().lock();
            writeln!(output, "NATIVE_AUTHORITY_SERVER_FIXTURE").unwrap();
            let notice = serde_json::to_vec(&json!({
                "version":1,
                "kind":"listening",
                "address":listener.address().as_str(),
            }))
            .unwrap();
            assert!(notice.len() <= 512);
            output.write_all(&notice).unwrap();
            output.write_all(b"\n").unwrap();
            output.flush().unwrap();
        }
        let fixture_budget =
            || PipeBudget::new(Duration::from_secs(10), PipeCancellation::default()).unwrap();
        let mut connection = listener
            .accept_current_native_image(&fixture_budget())
            .unwrap();
        let received = connection.read_json(&fixture_budget()).unwrap();
        connection.send_json(&received, &fixture_budget()).unwrap();
        // Stay alive through the helper's post-read held-peer check. The Node
        // fixture closes its helper next; a second application frame is invalid.
        assert!(connection.read_json(&fixture_budget()).is_err());
        connection.close();
        std::process::exit(0);
    }

    #[test]
    fn actual_hidden_helper_bridges_two_process_same_image_send_receive_and_close() {
        let (mut child, mut pipe) = connected();
        let value = json!({"unicode":"ş😀", "retained":[null,1,"quoted\"text"]});
        child.send(&json!({"kind":"send","id":1,"value":value}));
        assert_eq!(pipe.read_json(&budget().unwrap()).unwrap(), value);
        assert_eq!(child.next(), json!({"kind":"sent","id":1}));
        pipe.send_json(&json!({"reply":"kept"}), &budget().unwrap())
            .unwrap();
        child.send(&json!({"kind":"receive","id":3}));
        assert_eq!(
            child.next(),
            json!({"kind":"received","id":3,"value":{"reply":"kept"}})
        );
        child.send(&json!({"kind":"close","id":4}));
        assert_eq!(child.next(), json!({"kind":"closed","id":4}));
        child.exited(0);
    }

    #[test]
    fn actual_helper_eof_closes_and_duplicate_ids_never_replay_a_pipe_send() {
        let (mut child, mut pipe) = connected();
        child.send(&json!({"kind":"send","id":5,"value":"once"}));
        assert_eq!(pipe.read_json(&budget().unwrap()).unwrap(), json!("once"));
        assert_eq!(child.next(), json!({"kind":"sent","id":5}));
        child.send(&json!({"kind":"send","id":5,"value":"again"}));
        assert_eq!(
            child.next(),
            json!({"kind":"error","code":"INVALID_COMMAND"})
        );
        child.exited(2);
        assert!(pipe.read_json(&budget().unwrap()).is_err());
        let (mut child, mut pipe) = connected();
        child.input.take();
        child.exited(0);
        assert!(pipe.read_json(&budget().unwrap()).is_err());
    }

    #[test]
    fn actual_helper_rejects_unsafe_ids_and_frame_overflow_without_echoing_payloads() {
        for id in [0, MAX_ID + 1] {
            let (mut child, _pipe) = connected();
            child.send(&json!({"kind":"receive","id":id}));
            assert_eq!(
                child.next(),
                json!({"kind":"error","code":"INVALID_COMMAND"})
            );
            child.exited(2);
        }
        let (mut child, mut pipe) = connected();
        child.send(&json!({"kind":"receive","id":1}));
        pipe.send_json(
            &json!("x".repeat(MAX_CONTROL_FRAME - 2)),
            &budget().unwrap(),
        )
        .unwrap();
        assert_eq!(
            child.next(),
            json!({"kind":"error","id":1,"code":"FRAME_TOO_LARGE"})
        );
        child.exited(2);
    }

    #[test]
    fn actual_helper_rejects_fake_pid_bootstrap_and_truncated_stdin() {
        let mut child = HelperChild::spawn();
        child.send(&json!({"version":1,"address":locator(),"pid":std::process::id()}));
        assert_eq!(
            child.next(),
            json!({"kind":"error","code":"INVALID_BOOTSTRAP"})
        );
        child.exited(2);
        let mut child = HelperChild::spawn();
        child.input.as_mut().unwrap().write_all(&[1, 0]).unwrap();
        child.input.take();
        assert_eq!(child.next(), json!({"kind":"error","code":"INVALID_FRAME"}));
        child.exited(2);
    }

    #[test]
    fn actual_helper_rejects_an_actual_different_executable_pipe_server() {
        let listener = AuthorityPipeListener::bind().unwrap();
        let address = listener.address();
        drop(listener);
        let root = std::env::var_os("SystemRoot").unwrap();
        let executable =
            std::path::PathBuf::from(&root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let name = address.as_str().strip_prefix(r"\\.\pipe\").unwrap();
        let script = format!("$p=[System.IO.Pipes.NamedPipeServerStream]::new('{name}',[System.IO.Pipes.PipeDirection]::InOut,1,[System.IO.Pipes.PipeTransmissionMode]::Byte,[System.IO.Pipes.PipeOptions]::Asynchronous); try {{ [Console]::Out.WriteLine('ready'); $p.WaitForConnection(); [Console]::In.ReadLine() | Out-Null }} finally {{ $p.Dispose() }}");
        let mut server = ProcessCommand::new(executable)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &script,
            ])
            .env_clear()
            .env("SystemRoot", &root)
            .env("WINDIR", &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        struct OwnedServer(Child);
        impl Drop for OwnedServer {
            fn drop(&mut self) {
                self.0.stdin.take();
                settle_child(&mut self.0);
            }
        }
        let stdout = server.stdout.take().unwrap();
        let server = OwnedServer(server);
        let (send, ready) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            let mut line = String::new();
            BufReader::new(stdout).read_line(&mut line).unwrap();
            send.send(line).unwrap();
        });
        assert_eq!(
            ready.recv_timeout(Duration::from_secs(5)).unwrap().trim(),
            "ready"
        );
        reader.join().unwrap();
        let mut child = HelperChild::spawn();
        child.send(&json!({"version":1,"address":address.as_str()}));
        assert_eq!(child.next(), json!({"kind":"error","code":"PEER_REJECTED"}));
        child.exited(2);
        drop(server);
    }
}
