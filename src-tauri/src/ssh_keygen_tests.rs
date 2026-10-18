use super::*;
use std::process::{Command, Stdio};
use std::sync::mpsc::channel;

#[test]
#[ignore = "Requires disposable output folder BYCODA_SSH_FIXTURE_DIR"]
fn real_private_pty_keygen_encrypts_without_passphrase_echo_and_cleans_up() {
    let root = std::path::PathBuf::from(std::env::var("BYCODA_SSH_FIXTURE_DIR").unwrap());
    let path = root.join(format!("native_generated_{}", uuid::Uuid::new_v4()));
    validate_new_key_path(&path).unwrap();
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize::default())
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("ssh-keygen.exe");
    let args = keygen_args(path.to_str().unwrap());
    assert!(!args.iter().any(|arg| arg == "-N" || arg == "-P"));
    command.args(args);
    command.env("SSH_ASKPASS_REQUIRE", "never");
    let mut reader = pair.master.try_clone_reader().unwrap();
    let writer = Arc::new(Mutex::new(pair.master.take_writer().unwrap()));
    let responder = writer.clone();
    let (tx, rx) = channel();
    let drain = thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut matched = 0;
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            for byte in &buf[..n] {
                let query = b"\x1b[6n";
                matched = if *byte == query[matched] {
                    matched + 1
                } else {
                    usize::from(*byte == query[0])
                };
                if matched == query.len() {
                    let _ = responder.lock().unwrap().write_all(b"\x1b[1;1R");
                    matched = 0;
                }
            }
            if tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    crate::windows::initialize().unwrap();
    let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), command).unwrap();
    drop(pair.slave);
    let mut output = Vec::new();
    let mut wait_for = |marker: &str| {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                output.extend(chunk);
            }
            if String::from_utf8_lossy(&output).contains(marker) {
                return true;
            }
        }
        false
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        assert!(wait_for("Enter passphrase"));
        writer
            .lock()
            .unwrap()
            .write_all(b"BYCODA_TEST_ONLY_PASSPHRASE\r")
            .unwrap();
        assert!(wait_for("Enter same passphrase again"));
        writer
            .lock()
            .unwrap()
            .write_all(b"BYCODA_TEST_ONLY_PASSPHRASE\r")
            .unwrap();
        assert!(wait_for("Your public key has been saved"));
    }));
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().unwrap();
    drop(pair.master);
    drop(writer);
    let _ = drain.join();
    std::fs::write(root.join("keygen-output.log"), &output).unwrap();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
    assert_eq!(status.exit_code(), 0);
    assert!(!String::from_utf8_lossy(&output).contains("BYCODA_TEST_ONLY_PASSPHRASE"));
    assert!(path.is_file());
    assert!(std::path::PathBuf::from(format!("{}.pub", path.display())).is_file());
    assert!(validate_new_key_path(&path).is_err());
    // Empty test passphrase is not the interactive secret. An unencrypted key
    // would decrypt; an encrypted key must fail, without exposing private bytes.
    let mut verify = Command::new("ssh-keygen.exe");
    verify
        .args(["-y", "-P", "", "-f", path.to_str().unwrap()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("SSH_ASKPASS_REQUIRE", "never");
    assert!(!crate::windows::spawn_managed(&mut verify)
        .unwrap()
        .wait()
        .unwrap()
        .success());

    let pending = root.join(format!("cancelled_generated_{}", uuid::Uuid::new_v4()));
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize::default())
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("ssh-keygen.exe");
    command.args(keygen_args(pending.to_str().unwrap()));
    let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), command).unwrap();
    let live = Arc::new(LivePty {
        _jump_config: None,
        _http_proxy: None,
        ssh_identity: Some("keygen-fixture".into()),
        shell_integration: None,
        cwd: root,
        writer: Mutex::new(pair.master.take_writer().unwrap()),
        master: Mutex::new(pair.master),
        pid: child.process_id().unwrap(),
        owner: Arc::new(Mutex::new("keygen-owner".into())),
    });
    drop(pair.slave);
    let host = PtyHost::new();
    host.insert("keygen".into(), live);
    host.kill_window("other-window");
    assert!(host.get("keygen").is_some());
    host.kill_window("keygen-owner");
    assert!(host.get("keygen").is_none());
    assert!(child.wait().is_ok());
}
