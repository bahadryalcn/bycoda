use super::*;
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

struct ShellHarness {
    shell: Arc<Mutex<ShellIntegration>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    events: mpsc::Receiver<ShellEvent>,
    visible: Arc<Mutex<Vec<u8>>>,
    drain: Option<std::thread::JoinHandle<()>>,
}
impl ShellHarness {
    fn spawn(root: &std::path::Path) -> Self {
        Self::spawn_mode(root, false)
    }
    fn spawn_mode(root: &std::path::Path, local_bootstrap: bool) -> Self {
        Self::spawn_config(root, local_bootstrap, false)
    }
    fn spawn_config(root: &std::path::Path, local_bootstrap: bool, mac_zsh: bool) -> Self {
        let shell = Arc::new(Mutex::new(if mac_zsh {
            ShellIntegration::for_shell("zsh").unwrap()
        } else if local_bootstrap {
            ShellIntegration::for_shell("auto").unwrap()
        } else {
            ShellIntegration::new()
        }));
        std::fs::write(
            root.join("bashrc"),
            format!(
                "{}\nPS1='BYCODA_PROMPT> '\n",
                shell.lock().unwrap().script()
            ),
        )
        .unwrap();
        let endpoint = if mac_zsh {
            crate::ssh_security::SshEndpoint {
                host: std::env::var("BYCODA_ZSH_MAC_HOST").unwrap(),
                user: Some(std::env::var("BYCODA_ZSH_MAC_USER").unwrap()),
                port: 22,
                identity_file: Some(std::env::var("BYCODA_ZSH_MAC_IDENTITY").unwrap()),
                ..Default::default()
            }
        } else if local_bootstrap {
            crate::ssh_security::SshEndpoint::default()
        } else {
            crate::ssh_security::SshEndpoint {
                host: "127.0.0.1".into(),
                user: Some(std::env::var("USERNAME").unwrap()),
                port: std::fs::read_to_string(root.join("port.txt"))
                    .unwrap()
                    .parse()
                    .unwrap(),
                identity_file: Some(root.join("client_key").to_string_lossy().into_owned()),
                jump_host: None,
                ..Default::default()
            }
        };
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize::default())
            .unwrap();
        let mut command = portable_pty::CommandBuilder::new(if local_bootstrap {
            "C:/Program Files/Git/bin/bash.exe"
        } else {
            "ssh.exe"
        });
        if local_bootstrap {
            // SSH transmits the command as bytes; a Windows bash -c argument
            // adds MSYS quoting/conversion which is not part of that transport.
            let bootstrap = root.join("bootstrap-command.sh");
            std::fs::write(&bootstrap, shell.lock().unwrap().remote_command()).unwrap();
            command.arg(bootstrap);
            command.env("HOME", root.join("bash-home"));
            command.env("HISTFILE", root.join("bash-home/history"));
            command.env("SHELL", "/bin/bash");
            command.env(
                "PATH",
                format!(
                    "C:/Program Files/Git/bin;C:/Program Files/Git/usr/bin;{}",
                    std::env::var("PATH").unwrap_or_default()
                ),
            );
        } else {
            if !mac_zsh {
                command.args([
                    "-o".into(),
                    format!("UserKnownHostsFile={}", root.join("known_hosts").display()),
                ]);
            }
            command.args(crate::ssh_security::interactive_args(&endpoint).unwrap());
            if mac_zsh {
                let home = std::env::var("BYCODA_ZSH_MAC_HOME").unwrap();
                command.arg(format!(
                    "HOME={} ZDOTDIR={} {}",
                    crate::remote_ssh::shell_quote(&home),
                    crate::remote_ssh::shell_quote(&home),
                    shell.lock().unwrap().remote_command()
                ));
            }
        }
        command.env("SSH_ASKPASS_REQUIRE", "never");
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = Arc::new(Mutex::new(pair.master.take_writer().unwrap()));
        let responder = writer.clone();
        let parse = shell.clone();
        let visible = Arc::new(Mutex::new(Vec::new()));
        let output = visible.clone();
        let (tx, events) = mpsc::channel();
        let drain = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
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
                let (bytes, records) = parse.lock().unwrap().filter("fixture", &buf[..n]);
                output.lock().unwrap().extend(bytes);
                for event in records {
                    if tx.send(event).is_err() {
                        return;
                    }
                }
            }
        });
        crate::windows::initialize().unwrap();
        let child = crate::windows::spawn_pty(pair.slave.as_ref(), command).unwrap();
        drop(pair.slave);
        Self {
            shell,
            writer,
            master: Some(pair.master),
            child,
            events,
            visible,
            drain: Some(drain),
        }
    }
    fn wait(&self, status: &str) -> ShellEvent {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut observed = Vec::new();
        while Instant::now() < deadline {
            if let Ok(event) = self.events.recv_timeout(Duration::from_millis(100)) {
                observed.push(event.status.clone());
                if event.status == status {
                    return event;
                }
            }
        }
        panic!(
            "missing shell state {status}; observed {observed:?}; protocol state {:?}: {}",
            {
                let shell = self.shell.lock().unwrap();
                (
                    shell.prompt_seq,
                    shell.request_seq,
                    shell.ready,
                    shell
                        .pending
                        .as_ref()
                        .map(|p| (p.prompt_seq, p.request_seq)),
                )
            },
            String::from_utf8_lossy(&self.visible.lock().unwrap())
        );
    }
    fn send(&self, data: &str) {
        let mut writer = self.writer.lock().unwrap();
        self.shell.lock().unwrap().input_changed("fixture", data);
        writer.write_all(data.as_bytes()).unwrap();
    }
    fn wait_visible(&self, marker: &[u8]) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self
                .visible
                .lock()
                .unwrap()
                .windows(marker.len())
                .any(|bytes| bytes == marker)
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("foreground test marker unavailable");
    }
    fn request(&self) -> String {
        self.request_source("reviewed")
    }
    fn request_source(&self, source: &str) -> String {
        let mut writer = self.writer.lock().unwrap();
        let (id, _) = self
            .shell
            .lock()
            .unwrap()
            .request_with_source("fixture", source)
            .unwrap();
        writer.write_all(request_keys(source).unwrap()).unwrap();
        id
    }
    fn accept(&self, request: &str, value: &str) {
        let mut writer = self.writer.lock().unwrap();
        let bytes = self
            .shell
            .lock()
            .unwrap()
            .accept(request, value, false)
            .unwrap();
        assert!(!bytes.contains('\r'));
        writer.write_all(bytes.as_bytes()).unwrap();
    }
    fn profile_checks(&self, zsh: bool) {
        self.send("git st");
        self.request_source("commands");
        assert!(self
            .wait("suggestions")
            .suggestions
            .unwrap()
            .contains(&"git status".into()));
        self.send("\x15");
        self.send("bas");
        self.request_source("commands");
        assert!(self
            .wait("suggestions")
            .suggestions
            .unwrap()
            .iter()
            .any(|value| value == "bash" || value == "bash.exe"));
        self.send("\x15cd /us");
        let request = self.request_source("paths");
        assert!(self
            .wait("suggestions")
            .suggestions
            .unwrap()
            .contains(&"cd /usr/".into()));
        self.accept(&request, "cd /usr/");
        assert!(
            self.shell.lock().unwrap().ready,
            "acceptance must not execute"
        );
        self.send("\x03");
        self.wait("ready");
        self.send(if zsh {
            "print -s 'ls /usr/bin'\r"
        } else {
            "history -s 'ls /usr/bin'\r"
        });
        self.wait("ready");
        self.send("ls /usr/b");
        self.request_source("history");
        assert!(self
            .wait("suggestions")
            .suggestions
            .unwrap()
            .contains(&"ls /usr/bin".into()));
        self.send("\x15ls .env");
        self.request_source("paths");
        assert!(self.wait("unavailable").prefix.is_none());
        self.send("\x03");
        self.wait("ready");
    }
}

#[test]
#[ignore = "Requires isolated output folder BYCODA_SSH_FIXTURE_DIR and existing Git Bash"]
fn exact_production_bootstrap_runs_in_native_conpty_without_filesystem_rc() {
    let root = std::path::PathBuf::from(std::env::var("BYCODA_SSH_FIXTURE_DIR").unwrap());
    let harness = ShellHarness::spawn_mode(&root, true);
    harness.wait("ready");
    harness.profile_checks(false);
    // Real Readline history and the exact production automatic bootstrap.
    harness.send("history -s 'clear screen-old'\r");
    harness.wait("ready");
    harness.send("history -s 'clear screen-new'\r");
    harness.wait("ready");
    harness.send("history -s 'clear token-hidden'\r");
    harness.wait("ready");
    harness.send("cl");
    let request = harness.request_source("commands");
    let event = harness.wait("suggestions");
    let values = event.suggestions.unwrap();
    assert_eq!(&values[..2], &["clear screen-new", "clear screen-old"]);
    assert!(values.iter().any(|value| value == "clear"));
    assert!(!values.iter().any(|value| value.contains("token")));
    harness.accept(&request, "clear");
    assert!(harness.shell.lock().unwrap().ready);
    harness.send("\x03");
    harness.wait("ready");
    harness.send("git st");
    let request = harness.request();
    let event = harness.wait("suggestions");
    assert_eq!(event.prefix.as_deref(), Some("git st"));
    harness.accept(&request, "git status");
    std::thread::sleep(Duration::from_millis(100));
    assert!(harness.shell.lock().unwrap().ready);
    assert!(harness.shell.lock().unwrap().snapshot.is_none());
    harness.send("\x03");
    harness.wait("ready");
    harness.send("false\r");
    harness.wait("ready");
    harness.send("printf 'BYCODA_STATUS_%s\\n' \"$?\"\r");
    harness.wait_visible(b"BYCODA_STATUS_1");
}
impl Drop for ShellHarness {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.master.take();
        if let Some(drain) = self.drain.take() {
            let _ = drain.join();
        }
    }
}

#[test]
#[ignore = "Requires explicit isolated Mac Zsh fixture and endpoint environment"]
fn actual_mac_zsh_production_bootstrap_safe_history_insert_and_guards() {
    let root = std::path::PathBuf::from(std::env::var("BYCODA_SSH_FIXTURE_DIR").unwrap());
    let mut harness = ShellHarness::spawn_config(&root, false, true);
    let ready = harness.wait("ready");
    assert_eq!(ready.shell, "zsh");
    assert_eq!(ready.user, std::env::var("BYCODA_ZSH_MAC_USER").unwrap());
    assert!(!ready.host.is_empty());
    harness.profile_checks(true);
    harness.send("git ");
    harness.request();
    let event = harness.wait("suggestions");
    let values = event.suggestions.unwrap();
    assert_eq!(values.first().map(String::as_str), Some("git diff"));
    assert!(values.iter().all(|value| !value.contains("TOKEN")));
    harness.send("\x15git st");
    let request = harness.request();
    harness.wait("suggestions");
    harness.accept(&request, "git status");
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        harness.shell.lock().unwrap().ready,
        "accept must not execute"
    );
    harness.send("\x15docker");
    harness.request();
    assert!(harness.wait("unavailable").prefix.is_none());
    harness.send("\x15git st");
    harness.request();
    harness.wait("suggestions");
    harness.send("\x03");
    harness.wait("ready");
    harness.send("export TOKEN=fixture-secret");
    harness.request();
    assert!(harness.wait("unavailable").prefix.is_none());
    harness
        .send("\x15printf '\\033[?1049hZSH_FULLSCREEN'; read -r answer; printf '\\033[?1049l'\r");
    harness.wait_visible(b"\x1b[?1049h");
    assert!(harness.shell.lock().unwrap().request("fixture").is_err());
    harness.send("\r");
    harness.wait("ready");
    harness.send("stty -echo; printf 'ZSH_PASS%s' WORD; read -r answer; stty echo\r");
    harness.wait_visible(b"ZSH_PASSWORD");
    assert!(harness.shell.lock().unwrap().request("fixture").is_err());
    harness.send("SENTINEL_NOT_ECHOED\r");
    harness.wait("ready");
    assert!(
        !String::from_utf8_lossy(&harness.visible.lock().unwrap()).contains("SENTINEL_NOT_ECHOED")
    );
    harness.send("exit\r");
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && harness.child.try_wait().unwrap().is_none() {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(
        harness.child.try_wait().unwrap().is_some(),
        "remote shell must exit cleanly"
    );
}

#[test]
#[ignore = "Requires run-bash-fixture.ps1 disposable SSH Bash fixture"]
fn actual_remote_bash_suggestions_secret_fullscreen_disconnect_and_reconnect() {
    let root = std::path::PathBuf::from(std::env::var("BYCODA_SSH_FIXTURE_DIR").unwrap());
    let first_nonce;
    {
        let harness = ShellHarness::spawn(&root);
        first_nonce = harness.shell.lock().unwrap().nonce.clone();
        let ready = harness.wait("ready");
        assert!(!ready.user.is_empty());
        assert!(!ready.host.is_empty());
        harness.profile_checks(false);
        harness.send("docker");
        harness.request();
        let no_match = harness.wait("unavailable");
        assert!(no_match.prefix.is_none());
        harness.send("\x15git st");
        let retry = harness.request();
        let retried = harness.wait("suggestions");
        assert_eq!(retried.request_id.as_deref(), Some(retry.as_str()));
        harness.send("\x03");
        harness.wait("ready");
        harness.send("git st");
        let request = harness.request();
        let suggestions = harness.wait("suggestions");
        assert_eq!(suggestions.request_id.as_deref(), Some(request.as_str()));
        assert_eq!(suggestions.prefix.as_deref(), Some("git st"));
        assert!(suggestions
            .suggestions
            .unwrap()
            .contains(&"git status".into()));
        harness.accept(&request, "git status");
        std::thread::sleep(Duration::from_millis(150));
        assert!(
            harness.shell.lock().unwrap().ready,
            "accept must not execute command"
        );
        harness.send("\x03");
        harness.wait("ready");
        harness.send("git ");
        harness.request();
        let history = harness.wait("suggestions");
        assert_eq!(
            history
                .suggestions
                .as_ref()
                .unwrap()
                .first()
                .map(String::as_str),
            Some("git diff"),
            "pre-existing safe history must precede fallback choices"
        );
        assert!(history
            .suggestions
            .as_ref()
            .unwrap()
            .iter()
            .all(|value| !value.contains("TEST_ONLY_HISTORY_SECRET")));
        harness.send("\x03");
        harness.wait("ready");
        harness.send("export TOKEN=TEST_ONLY_SENTINEL");
        harness.request();
        let blocked = harness.wait("unavailable");
        assert!(blocked.prefix.is_none());
        harness.send("\x03");
        harness.wait("ready");
        harness.send("stty -echo; read -r -p 'TEST_PASSWORD_PROMPT' unused; stty echo\r");
        assert!(harness.shell.lock().unwrap().request("fixture").is_err());
        std::thread::sleep(Duration::from_millis(100));
        harness.send("TEST_ONLY_PASSWORD\r");
        harness.wait("ready");
        assert!(!String::from_utf8_lossy(&harness.visible.lock().unwrap())
            .contains("TEST_ONLY_PASSWORD"));
        // An actual alternate-screen foreground command. No integration bind
        // exists while its read is active, exactly as with vim/top.
        harness.send("printf '\\033[?1049h'; read -r unused; printf '\\033[?1049l'\r");
        assert!(harness.shell.lock().unwrap().request("fixture").is_err());
        harness.wait_visible(b"\x1b[?1049h");
        std::thread::sleep(Duration::from_millis(100));
        harness.send("TEST_FULLSCREEN_EXIT\r");
        harness.wait("ready");
        let output = harness.visible.lock().unwrap();
        assert!(!output.windows(MARKER.len()).any(|bytes| bytes == MARKER));
    }
    let harness = ShellHarness::spawn(&root);
    harness.wait("ready");
    assert_ne!(harness.shell.lock().unwrap().nonce, first_nonce);
    std::thread::sleep(Duration::from_millis(200));
    assert!(harness.shell.lock().unwrap().snapshot.is_none());
    assert!(harness.shell.lock().unwrap().pending.is_none());
    assert!(
        !String::from_utf8_lossy(&harness.visible.lock().unwrap()).contains("git status\r\n"),
        "reconnect must not execute history"
    );
}
