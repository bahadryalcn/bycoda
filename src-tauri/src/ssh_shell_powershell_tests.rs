//! Isolated native PowerShell acceptance. No owner history/profile is read.
use super::*;
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

struct PsHarness {
    shell: Arc<Mutex<ShellIntegration>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    events: mpsc::Receiver<ShellEvent>,
    visible: Arc<Mutex<Vec<u8>>>,
    drain: Option<std::thread::JoinHandle<()>>,
}
impl PsHarness {
    fn spawn(root: &std::path::Path) -> Self {
        Self::spawn_configured(root, None)
    }
    fn spawn_configured(
        root: &std::path::Path,
        route: Option<(&crate::ssh_security::SshEndpoint, &std::path::Path)>,
    ) -> Self {
        let shell = Arc::new(Mutex::new(
            ShellIntegration::for_shell("powershell").unwrap(),
        ));
        let history = root.join("ps-history.txt");
        std::fs::write(&history, "ls profile-directory\n[Console]::WriteLine('PS_REVERSE_'+'OK')\ngit diff\npwd\n$env:TOKEN='SEEDED_TEST_SECRET'\n").unwrap();
        let production = if let Some((endpoint, _)) = route {
            crate::ssh_environment::remote_command(endpoint, Some(&shell.lock().unwrap()))
                .unwrap()
                .unwrap()
        } else {
            shell.lock().unwrap().remote_command()
        };
        assert!(production.len() < 8191);
        // Windows PSReadLine uses a KnownFolder instead of APPDATA env. Set only
        // this explicit fixture's history BEFORE first ReadLine; the production
        // initializer and outer cmd quoting otherwise run unchanged.
        let prelude = if route.is_some() {
            "Set-PSReadLineOption -HistorySavePath $env:BYCODA_PS_FIXTURE -ErrorAction Stop;".into()
        } else {
            format!(
            "$p='{}'; Import-Module PSReadLine; Set-PSReadLineOption -HistorySavePath $p; if((Get-PSReadLineOption).HistorySavePath -ne $p){{exit 91}}; Set-Location ([IO.Path]::GetDirectoryName($p)); ",
            history.to_string_lossy().replace('\'', "''")
        )
        };
        let line = production.replacen("-Command \"", &format!("-Command \"{prelude}"), 1);
        assert!(line.len() < 8191);
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 36,
                cols: 140,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let ssh_fixture = std::env::var("BYCODA_PS_SSH_FIXTURE_DIR").ok();
        let mut command =
            portable_pty::CommandBuilder::new(if ssh_fixture.is_some() || route.is_some() {
                "ssh.exe"
            } else {
                "pwsh.exe"
            });
        let is_ssh = ssh_fixture.is_some() || route.is_some();
        if let Some((endpoint, trust)) = route {
            command.args([
                "-o".into(),
                format!("UserKnownHostsFile={}", trust.display()),
                "-o".into(),
                "SendEnv=BYCODA_PS_FIXTURE".into(),
            ]);
            command.args(crate::ssh_security::interactive_args(endpoint).unwrap());
            command.arg(line);
        } else if let Some(fixture) = ssh_fixture {
            let fixture = std::path::PathBuf::from(fixture);
            let endpoint = crate::ssh_security::SshEndpoint {
                host: "127.0.0.1".into(),
                user: Some(std::env::var("USERNAME").unwrap()),
                port: std::fs::read_to_string(fixture.join("port.txt"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap(),
                identity_file: Some(std::env::var("BYCODA_PS_IDENTITY_FILE").unwrap()),
                ..Default::default()
            };
            command.args([
                "-o".into(),
                format!(
                    "UserKnownHostsFile={}",
                    fixture.join("known_hosts").display()
                ),
            ]);
            command.args(crate::ssh_security::interactive_args(&endpoint).unwrap());
            command.arg(line);
        } else {
            let inner = production
                .strip_prefix("pwsh -NoLogo -NoProfile -NoExit -Command \"")
                .unwrap()
                .strip_suffix('"')
                .unwrap();
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NoExit",
                "-Command",
                &format!("{prelude}{inner}"),
            ]);
        }
        command.env("HOME", root);
        let fixture_location = if route.is_some() {
            history.as_path()
        } else {
            root
        };
        command.env("BYCODA_PS_FIXTURE", fixture_location);
        command.cwd(root);
        // Validate the IDENTICAL argument/parser/isolation path without an
        // interactive input loop first. If quoting turns code into a string or
        // isolation fails, no ReadLine process is ever launched.
        let mut probe_args: Vec<std::ffi::OsString> =
            command.get_argv().iter().skip(1).cloned().collect();
        for arg in &mut probe_args {
            if arg == "-NoExit" {
                *arg = "-NonInteractive".into();
            }
        }
        let marker = if route.is_some() {
            // The long production initializer plus environment is near cmd.exe's
            // limit. Isolation has already been verified by the fixed prelude;
            // the actual PTY must separately emit its integration capability.
            ";'PS_ISOLATED_PREFLIGHT'"
        } else {
            ";if(!(Get-Command PSConsoleHostReadLine).Definition.Contains('__BC')){exit 92};'PS_ISOLATED_PREFLIGHT'"
        };
        let last = probe_args.last_mut().unwrap();
        let text = last.to_string_lossy();
        *last = if is_ssh {
            format!(
                "{}{}\"",
                text.replace("-NoExit", "-NonInteractive")
                    .strip_suffix('"')
                    .unwrap(),
                marker
            )
            .into()
        } else {
            format!("{text}{marker}").into()
        };
        let mut probe = std::process::Command::new(command.get_argv().first().unwrap());
        probe
            .args(probe_args)
            .current_dir(root)
            .env("HOME", root)
            .env("BYCODA_PS_FIXTURE", fixture_location)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        crate::windows::initialize().unwrap();
        let output = crate::windows::spawn_managed(&mut probe)
            .unwrap()
            .wait_with_output()
            .unwrap();
        assert!(output.status.success() && String::from_utf8_lossy(&output.stdout).contains("PS_ISOLATED_PREFLIGHT"),
            "noninteractive isolation/initializer preflight failed: {:?}; interactive ReadLine was NOT spawned; bounded error: {}", output.status, String::from_utf8_lossy(&output.stderr).chars().take(800).collect::<String>());
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
                let (bytes, records) = parse.lock().unwrap().filter("ps-fixture", &buf[..n]);
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
                // Physical multiline input may leave older prompt events in
                // the channel. A new write revokes native readiness before
                // enqueueing; do not mistake an old event for its completion.
                if event.status == status && (status != "ready" || self.shell.lock().unwrap().ready)
                {
                    return event;
                }
            }
        }
        let output = self.visible.lock().unwrap();
        let tail = &output[output.len().saturating_sub(2000)..];
        let text = String::from_utf8_lossy(tail);
        let bounded = if text.contains("FromBase64String") {
            "<fixed bootstrap command omitted>".to_string()
        } else {
            text.into_owned()
        };
        panic!("missing {status}; states {observed:?}; visible tail {bounded}");
    }
    fn wait_snapshot(&self) -> ShellEvent {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if let Ok(event) = self.events.recv_timeout(Duration::from_millis(100)) {
                if matches!(event.status.as_str(), "suggestions" | "unavailable") {
                    return event;
                }
            }
        }
        panic!("missing selection snapshot acknowledgement");
    }
    fn send(&self, data: &str) {
        let mut writer = self.writer.lock().unwrap();
        self.shell.lock().unwrap().input_changed("ps-fixture", data);
        writer.write_all(data.as_bytes()).unwrap();
    }
    fn cancel_line(&self) {
        self.send("\x03");
        // Empty-editor Ctrl+C redraws inside the SAME PSReadLine invocation.
        // Nonempty cancellation may instead leave/reenter ConsoleHostReadLine.
        std::thread::sleep(Duration::from_millis(150));
        if !self.shell.lock().unwrap().ready {
            self.wait("ready");
        }
    }
    fn request(&self) -> String {
        self.request_source("reviewed")
    }
    fn request_source(&self, source: &str) -> String {
        let mut writer = self.writer.lock().unwrap();
        let result = self
            .shell
            .lock()
            .unwrap()
            .request_with_source("ps-fixture", source);
        let (id, _) = result.unwrap_or_else(|error| {
            let output = self.visible.lock().unwrap();
            let tail = &output[output.len().saturating_sub(1600)..];
            panic!(
                "{error}; bounded fixture output: {}",
                String::from_utf8_lossy(tail)
            );
        });
        writer.write_all(request_keys(source).unwrap()).unwrap();
        id
    }
    fn accept(&self, id: &str, value: &str) {
        let mut writer = self.writer.lock().unwrap();
        let paste = self.shell.lock().unwrap().accept(id, value, false).unwrap();
        assert!(!paste.contains('\r'));
        writer.write_all(paste.as_bytes()).unwrap();
    }
    fn wait_visible(&self, marker: &[u8]) {
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if self
                .visible
                .lock()
                .unwrap()
                .windows(marker.len())
                .any(|part| part == marker)
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!(
            "missing marker: {}",
            String::from_utf8_lossy(&self.visible.lock().unwrap())
        );
    }
}
impl Drop for PsHarness {
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
#[ignore = "Starts disposable owned sshd; requires installed PS7 and native ConPTY"]
fn actual_integrated_powershell_group_environment_keeps_shell_assistance() {
    use crate::ssh_group_defaults as groups;
    use crate::ssh_jump_config::native_tests::{config_path, key, server};
    let base = std::path::PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("ps-env-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME").unwrap();
    let client = key(&root, "client");
    let host = key(&root, "host");
    let (_daemon, port, trust) = server(&root, 0, &client, &host, &user);
    let local_before = std::env::var_os("APP_ENV");
    let saved = crate::ssh_security::SshEndpoint {
        host: "127.0.0.1".into(),
        port: 22,
        ..Default::default()
    };
    let group = groups::GroupDefaults {
        id: "ps-fixture".into(),
        revision: 1,
        name: "Disposable".into(),
        defaults: groups::ConnectionDefaults {
            user: Some(user),
            port: Some(port),
            identity_file: Some(config_path(&client)),
            certificate_file: None,
        },
        environment: vec![groups::LiteralEnvironment {
            name: "APP_ENV".into(),
            value: "production".into(),
        }],
        shell_kind: Some(groups::RemoteShellKind::Powershell),
    };
    let inheritance = groups::Inheritance {
        group_id: group.id.clone(),
        fields: vec![
            groups::InheritedField::User,
            groups::InheritedField::Port,
            groups::InheritedField::IdentityFile,
        ],
        environment: true,
    };
    let effective = groups::resolve(&saved, Some(&inheritance), Some(&group)).unwrap();
    let endpoint = crate::ssh_configuration::runtime_endpoint(effective);
    let harness = PsHarness::spawn_configured(&root, Some((&endpoint, &trust)));
    harness.wait("ready");
    harness.send("[Console]::WriteLine('GROUP_ENV_'+$env:APP_ENV)\r");
    harness.wait("ready");
    harness.wait_visible(b"GROUP_ENV_production");
    harness.send("git ");
    harness.request();
    let snapshot = harness.wait("suggestions");
    assert_eq!(snapshot.prefix.as_deref(), Some("git "));
    assert!(snapshot
        .suggestions
        .unwrap()
        .iter()
        .any(|entry| entry == "git diff"));
    harness.cancel_line();
    assert_eq!(std::env::var_os("APP_ENV"), local_before);
}

#[test]
#[ignore = "Requires explicit BYCODA_PS_FIXTURE_DIR; real PS7/PSReadLine2.4 native ConPTY"]
fn actual_powershell_bootstrap_history_insert_and_password_guards() {
    let root = std::path::PathBuf::from(std::env::var("BYCODA_PS_FIXTURE_DIR").unwrap());
    let mut harness = PsHarness::spawn(&root);
    std::fs::create_dir_all(root.join("profile-directory")).unwrap();
    let ready = harness.wait("ready");
    assert_eq!(ready.shell, "powershell");
    assert_eq!(ready.user, std::env::var("USERNAME").unwrap());
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
        Some("git diff")
    );
    assert!(history
        .suggestions
        .unwrap()
        .iter()
        .all(|value| !value.contains("SECRET")));
    // Ordinary Up/Down remain PSReadLine-owned, including preexisting history.
    harness.send("\x1b\x1b[A\x1b[A");
    harness.request();
    assert_eq!(harness.wait("suggestions").prefix.as_deref(), Some("pwd"));
    // A custom request ends PSReadLine's navigation group. Test ordinary Down
    // without inserting another handler between the Up and Down keystrokes.
    harness.cancel_line();
    harness.send("\x1b[A\x1b[B");
    harness.request();
    assert_eq!(harness.wait("suggestions").prefix.as_deref(), Some(""));
    harness.cancel_line();
    harness.send("\x12PS_REVERSE_");
    assert!(harness.shell.lock().unwrap().request("ps-fixture").is_err());
    harness.send("\r");
    harness.wait("ready");
    harness.wait_visible(b"PS_REVERSE_OK");
    eprintln!("PowerShell fixture: history/arrows/reverse-search verified");
    harness.cancel_line();
    harness.send("Get-Pro");
    harness.request_source("commands");
    assert!(harness
        .wait("suggestions")
        .suggestions
        .unwrap()
        .contains(&"Get-Process".into()));
    harness.cancel_line();
    harness.send("git st");
    harness.request_source("commands");
    assert!(harness
        .wait("suggestions")
        .suggestions
        .unwrap()
        .contains(&"git status".into()));
    harness.cancel_line();
    harness.send("cd profile-dir");
    let paths = harness.request_source("paths");
    assert!(harness
        .wait("suggestions")
        .suggestions
        .unwrap()
        .contains(&"cd profile-directory/".into()));
    harness.accept(&paths, "cd profile-directory/");
    assert!(
        harness.shell.lock().unwrap().ready,
        "path acceptance must not execute"
    );
    harness.cancel_line();
    eprintln!("PowerShell fixture: command names, argument forms and path insertion verified");
    harness.send("ls profile-");
    harness.request_source("history");
    assert!(harness
        .wait("suggestions")
        .suggestions
        .unwrap()
        .contains(&"ls profile-directory".into()));
    harness.cancel_line();
    harness.send("git st");
    let request = harness.request();
    harness.wait("suggestions");
    harness.accept(&request, "git status");
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        harness.shell.lock().unwrap().ready,
        "insert must not execute"
    );
    harness.request();
    assert_eq!(
        harness.wait("suggestions").prefix.as_deref(),
        Some("git status")
    );
    eprintln!("PowerShell fixture: semantic insertion verified without execution");
    harness.cancel_line();
    harness.send("git st\x1b[D");
    harness.request();
    assert!(harness.wait("unavailable").prefix.is_none());
    harness.send("\x1b[C");
    harness.request();
    assert_eq!(
        harness.wait("suggestions").prefix.as_deref(),
        Some("git st")
    );
    harness.cancel_line();
    harness.send("git st\x01");
    let selected_request = harness.request();
    let selected = harness.wait_snapshot();
    if selected.status == "suggestions" {
        // PSReadLine may end its selection when dispatching a custom chord.
        // In that case suffix insertion must retain the complete prefix.
        assert_eq!(selected.prefix.as_deref(), Some("git st"));
        harness.accept(&selected_request, "git status");
        harness.request();
        assert_eq!(
            harness.wait("suggestions").prefix.as_deref(),
            Some("git status")
        );
    } else {
        assert!(selected.prefix.is_none());
    }
    harness.send("\x1b[C"); // leave selection without changing the OS clipboard
    harness.cancel_line();
    std::fs::write(root.join("bycoda-complete-file.txt"), "fixture").unwrap();
    harness.send("Get-Item bycoda-comp\t");
    harness.wait_visible(b"bycoda-complete-file.txt");
    harness.cancel_line();
    harness.send("\x1b[200~Write-Output ('PS_UNI'+'CODE_ığ🙂')\x1b[201~");
    std::thread::sleep(Duration::from_millis(100));
    assert!(!String::from_utf8_lossy(&harness.visible.lock().unwrap()).contains("PS_UNICODE_ığ🙂"));
    harness.send("\r");
    harness.wait("ready");
    harness.wait_visible("PS_UNICODE_ığ🙂".as_bytes());
    // PSReadLine 2.4 does not implement bracketed-paste. Complete standalone
    // lines may execute on their CRLF; a normal syntactically-enclosed block
    // stays in the shell's continuation editor until the separate final Enter.
    harness.send("\x1b[200~& {\r\n[Console]::WriteLine('PS_MULTI_'+'A')\r\n[Console]::WriteLine('PS_MULTI_'+'B')\r\n}\x1b[201~");
    std::thread::sleep(Duration::from_millis(100));
    assert!(!String::from_utf8_lossy(&harness.visible.lock().unwrap()).contains("PS_MULTI_A"));
    harness.send("\r");
    harness.wait("ready");
    harness.wait_visible(b"PS_MULTI_A");
    harness.wait_visible(b"PS_MULTI_B");
    eprintln!("PowerShell fixture: cursor/completion/Unicode/multiline verified");
    harness.send("Get-Item 'bycoda-absent-file' -ErrorAction SilentlyContinue\r");
    harness.wait("ready");
    harness.send("[Console]::WriteLine('PS_STATUS_'+$?)\r");
    harness.wait("ready");
    harness.wait_visible(b"PS_STATUS_False");
    eprintln!("PowerShell fixture: previous-command status preserved");
    harness.send("Set-PSReadLineKeyHandler -Chord Ctrl+b -ScriptBlock { [Microsoft.PowerShell.PSConsoleReadLine]::Insert('pwd') }\r");
    harness.wait("ready");
    harness.send("\x02");
    harness.request();
    assert_eq!(harness.wait("suggestions").prefix.as_deref(), Some("pwd"));
    harness.cancel_line();
    harness.send("[Console]::Write([char]27+'[?1049h'); $unused=Read-Host ('PS_FULL'+'SCREEN'); [Console]::Write([char]27+'[?1049l')\r");
    harness.wait_visible(b"\x1b[?1049h");
    assert!(harness.shell.lock().unwrap().request("ps-fixture").is_err());
    harness.send("\r");
    harness.wait("ready");
    harness.send("Add-Type 'using System; using System.Runtime.InteropServices; public static class BycodaTestEcho { [DllImport(\"kernel32.dll\")] static extern IntPtr GetStdHandle(int n); [DllImport(\"kernel32.dll\")] static extern bool GetConsoleMode(IntPtr h, out uint m); [DllImport(\"kernel32.dll\")] static extern bool SetConsoleMode(IntPtr h, uint m); public static void Set(bool b) { var h=GetStdHandle(-10); uint m; if(GetConsoleMode(h,out m)) SetConsoleMode(h,b ? m|4u : m&~4u); } }'; [BycodaTestEcho]::Set($false)\r");
    harness.wait("unavailable");
    assert!(harness.shell.lock().unwrap().request("ps-fixture").is_err());
    harness.send("[BycodaTestEcho]::Set($true)\r");
    harness.wait("ready");
    harness.send("$env:TOKEN='TYPED_TEST_SECRET'");
    harness.request();
    assert!(harness.wait("unavailable").prefix.is_none());
    harness.cancel_line();
    harness.send("$unused = Read-Host -AsSecureString ('PS_PASS'+'WORD')\r");
    harness.wait_visible(b"PS_PASSWORD");
    assert!(harness.shell.lock().unwrap().request("ps-fixture").is_err());
    harness.send("PS_PASSWORD_SENTINEL\r");
    harness.wait("ready");
    assert!(
        !String::from_utf8_lossy(&harness.visible.lock().unwrap()).contains("PS_PASSWORD_SENTINEL")
    );
    assert!(!std::fs::read_to_string(root.join("ps-history.txt"))
        .unwrap()
        .contains("PS_PASSWORD_SENTINEL"));
    eprintln!(
        "PowerShell fixture: status/custom binding/echo-off/fullscreen/SecureString verified"
    );
    let nonce = harness.shell.lock().unwrap().nonce.clone();
    harness.send("exit\r");
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && harness.child.try_wait().unwrap().is_none() {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(harness.child.try_wait().unwrap().is_some());
    drop(harness);
    let mut reconnect = PsHarness::spawn(&root);
    reconnect.wait("ready");
    assert_ne!(nonce, reconnect.shell.lock().unwrap().nonce);
    assert!(reconnect.shell.lock().unwrap().snapshot.is_none());
    assert!(!String::from_utf8_lossy(&reconnect.visible.lock().unwrap()).contains("PS_MULTI_A"));
    reconnect.send("exit\r");
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && reconnect.child.try_wait().unwrap().is_none() {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(reconnect.child.try_wait().unwrap().is_some());
}
