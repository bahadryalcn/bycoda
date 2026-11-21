use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const LOG_LIMIT: u64 = 10 * 1024 * 1024;

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new(script: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "bycoda-launcher-{}-{}-Nick's $PC 日本語 &",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        // macOS temp dirs sit behind a /var -> /private/var symlink and the child reports the real path.
        #[cfg(unix)]
        let path = fs::canonicalize(&path).unwrap();
        fs::write(path.join("host.cjs"), script).unwrap();
        Self(path)
    }
    fn config(&self) -> Value {
        let node = Command::new("node")
            .args(["-p", "process.execPath"])
            .output()
            .expect("Node is required for the Host launcher integration fixture");
        assert!(node.status.success());
        json!({
            "executable": String::from_utf8(node.stdout).unwrap().trim(),
            "entry": self.0.join("host.cjs"), "directory": self.0,
            "port": 3774, "path": std::env::var("PATH").unwrap()
        })
    }
    fn launch(&self, config: &Value, limit: &str) -> Output {
        self.launch_raw(&serde_json::to_vec(config).unwrap(), limit)
    }
    fn launch_raw(&self, configuration: &[u8], limit: &str) -> Output {
        let path = self.0.join("service-launcher.json");
        fs::write(&path, configuration).unwrap();
        let mut command = Command::new(env!("CARGO_BIN_EXE_bycoda-host-launcher"));
        command.arg(path).env("BYCODA_LAUNCHER_RESTARTS", limit);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command.output().unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn direct_launch_preserves_literal_arguments_environment_and_both_streams() {
    let fixture = Fixture::new(
        r#"
const fs = require('fs');
fs.writeFileSync('received.json', JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),path:process.env.PATH,limit:process.env.BYCODA_LAUNCHER_RESTARTS ?? null}));
console.log('stdout diagnostic'); console.error('stderr diagnostic');
"#,
    );
    let config = fixture.config();
    assert!(fixture.launch(&config, "0").status.success());
    let received: Value =
        serde_json::from_slice(&fs::read(fixture.0.join("received.json")).unwrap()).unwrap();
    assert_eq!(
        received["args"],
        json!(["serve", "--data-dir", fixture.0, "--port", "3774"])
    );
    assert_eq!(received["cwd"], json!(fixture.0));
    assert_eq!(received["path"], config["path"]);
    assert!(received["limit"].is_null());
    let log = fs::read_to_string(fixture.0.join("host.log")).unwrap();
    assert!(log.contains("stdout diagnostic") && log.contains("stderr diagnostic"));
}

#[test]
#[cfg(windows)]
fn repairs_stray_windows_path_quote_before_launch() {
    let fixture =
        Fixture::new("require('node:fs').writeFileSync('received-path', process.env.PATH)");
    let mut config = fixture.config();
    config["path"] = json!(
        r#"C:\Windows;"C:\Tools;Extra";C:\Program Files\PowerShell\7";C:\Program Files\Git\cmd"#
    );
    assert!(fixture.launch(&config, "0").status.success());
    assert_eq!(
        fs::read_to_string(fixture.0.join("received-path")).unwrap(),
        r#"C:\Windows;"C:\Tools;Extra";C:\Program Files\PowerShell\7;C:\Program Files\Git\cmd"#,
    );
}

#[test]
fn failure_restarts_and_limit_preserves_actual_exit_code() {
    let fixture = Fixture::new(
        r#"
const fs = require('fs'); const count = fs.existsSync('count') ? Number(fs.readFileSync('count')) : 0;
fs.writeFileSync('count', String(count+1)); process.exit(count === 0 ? 17 : 0);
"#,
    );
    assert!(fixture.launch(&fixture.config(), "1").status.success());
    assert_eq!(fs::read_to_string(fixture.0.join("count")).unwrap(), "2");
    fs::remove_file(fixture.0.join("count")).unwrap();
    assert_eq!(
        fixture.launch(&fixture.config(), "0").status.code(),
        Some(17)
    );
}

#[test]
fn invalid_configuration_never_starts_child() {
    let fixture = Fixture::new("require('fs').writeFileSync('started','yes');");
    for (field, value) in [
        ("entry", json!("relative.cjs")),
        ("executable", json!("node")),
        ("directory", json!("relative")),
        ("port", json!(0)),
        ("port", json!(65536)),
        ("path", json!("")),
    ] {
        let mut config = fixture.config();
        config[field] = value;
        assert!(!fixture.launch(&config, "0").status.success());
        assert!(!fixture.0.join("started").exists());
    }
}

#[test]
fn rotates_large_log_and_refuses_unwritable_log() {
    let fixture = Fixture::new("console.log('new log');");
    let previous = fixture.0.join("host.log.old");
    fs::write(&previous, "old").unwrap();
    fs::File::create(fixture.0.join("host.log"))
        .unwrap()
        .set_len(10 * 1024 * 1024 + 1)
        .unwrap();
    assert!(fixture.launch(&fixture.config(), "0").status.success());
    assert_eq!(fs::metadata(previous).unwrap().len(), 10 * 1024 * 1024 + 1);
    assert!(fs::read_to_string(fixture.0.join("host.log"))
        .unwrap()
        .contains("new log"));
    fs::remove_file(fixture.0.join("host.log")).unwrap();
    fs::create_dir(fixture.0.join("host.log")).unwrap();
    assert!(!fixture.launch(&fixture.config(), "0").status.success());
}

#[test]
fn preserves_legacy_utf16_logs_before_appending_native_utf8_output() {
    let fixture = Fixture::new("console.log('new UTF-8 log 日本語');");
    for little_endian in [true, false] {
        let mut previous = if little_endian {
            vec![0xff, 0xfe]
        } else {
            vec![0xfe, 0xff]
        };
        for unit in "legacy diagnostic 日本語\r\n".encode_utf16() {
            previous.extend(if little_endian {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
        fs::write(fixture.0.join("host.log"), &previous).unwrap();
        assert!(fixture.launch(&fixture.config(), "0").status.success());
        assert_eq!(fs::read(fixture.0.join("host.log.old")).unwrap(), previous);
        let current = fs::read_to_string(fixture.0.join("host.log")).unwrap();
        assert!(current.contains("new UTF-8 log 日本語"));
        assert!(!current.contains("legacy diagnostic"));
    }
}

fn log_of(fixture: &Fixture, name: &str) -> String {
    fs::read_to_string(fixture.0.join(name)).unwrap_or_default()
}

#[test]
fn launch_failures_leave_a_timestamped_trace_instead_of_a_discarded_stderr() {
    let fixture = Fixture::new("");
    let mut invalid = fixture.config();
    invalid["port"] = json!(0);
    assert!(!fixture.launch(&invalid, "0").status.success());
    let log = log_of(&fixture, "host.log");
    assert!(
        log.contains("ERROR [host.launcher] Host launcher failed: validate launcher configuration"),
        "{log}"
    );
    assert!(log.contains("InvalidInput"), "{log}");
    assert!(
        log.starts_with("20"),
        "shared diagnostic line starts with an ISO date: {log}"
    );
    fs::remove_file(fixture.0.join("host.log")).unwrap();

    assert!(!fixture.launch_raw(b"{not json", "0").status.success());
    assert!(
        log_of(&fixture, "host.log").contains("parse launcher configuration"),
        "an unreadable configuration is reported beside it"
    );
    fs::remove_file(fixture.0.join("host.log")).unwrap();

    let mut missing = fixture.config();
    missing["executable"] = json!(fixture.0.join("missing-node-executable"));
    assert!(!fixture.launch(&missing, "0").status.success());
    let log = log_of(&fixture, "host.log");
    assert!(
        log.contains("start Host:") && log.contains("NotFound"),
        "{log}"
    );
    fs::remove_file(fixture.0.join("host.log")).unwrap();

    // An unusable host.log is reported in the sibling log and retried like any failed launch.
    fs::create_dir(fixture.0.join("host.log")).unwrap();
    assert!(!fixture.launch(&fixture.config(), "0").status.success());
    assert!(log_of(&fixture, "launcher.log").contains("ERROR [host.launcher] open Host log:"));
}

#[test]
fn log_rotation_failure_does_not_end_supervision() {
    let fixture = Fixture::new("console.log('new log');");
    // A directory named host.log.old makes deleting the previous log fail for real.
    fs::create_dir(fixture.0.join("host.log.old")).unwrap();
    fs::File::create(fixture.0.join("host.log"))
        .unwrap()
        .set_len(LOG_LIMIT + 1)
        .unwrap();
    assert!(fixture.launch(&fixture.config(), "0").status.success());
    let log = log_of(&fixture, "host.log");
    assert!(log.contains("new log"), "the Host still launched");
    assert!(
        log.contains("WARN  [host.launcher] rotate Host log:"),
        "{log}"
    );
    assert!(log.len() < 1024 * 1024, "the oversized log was truncated");
}

#[test]
fn a_running_host_cannot_grow_host_log_past_the_limit() {
    // About 12.8 MiB of console output from one Host process that never restarts.
    let fixture = Fixture::new(
        r#"
const chunk = 'x'.repeat(65535) + '\n';
for (let i = 0; i < 200; i++) process.stdout.write(chunk);
console.error('final marker');
"#,
    );
    assert!(fixture.launch(&fixture.config(), "0").status.success());
    let current = fs::metadata(fixture.0.join("host.log")).unwrap().len();
    assert!(current <= LOG_LIMIT, "host.log grew to {current}");
    assert!(fs::metadata(fixture.0.join("host.log.old")).unwrap().len() > 0);
    // stdout and stderr are separate pipes: the last stdout chunk can land after the
    // stderr marker and rotate it into host.log.old, so the marker survives in one of them.
    let kept = log_of(&fixture, "host.log") + &log_of(&fixture, "host.log.old");
    assert!(kept.contains("final marker"));
}

#[test]
fn a_descendant_holding_the_console_pipes_cannot_stall_the_launcher() {
    let fixture = Fixture::new(
        r#"
const { spawn } = require('child_process');
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit', detached: true }).unref();
"#,
    );
    let started = Instant::now();
    assert!(fixture.launch(&fixture.config(), "0").status.success());
    assert!(
        started.elapsed() < Duration::from_secs(6),
        "launcher waited for the descendant: {:?}",
        started.elapsed()
    );
}

#[cfg(windows)]
#[test]
fn killing_the_launcher_ends_the_host_instead_of_orphaning_it() {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    let fixture = Fixture::new(
        r#"
const fs = require('fs');
fs.writeFileSync('host.pid', String(process.pid));
setInterval(() => fs.appendFileSync('beat', 'x'), 50);
"#,
    );
    let path = fixture.0.join("service-launcher.json");
    fs::write(&path, serde_json::to_vec(&fixture.config()).unwrap()).unwrap();
    let mut launcher = Command::new(env!("CARGO_BIN_EXE_bycoda-host-launcher"))
        .arg(&path)
        .env("BYCODA_LAUNCHER_RESTARTS", "0")
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let beats = || fs::metadata(fixture.0.join("beat")).map_or(0, |metadata| metadata.len());
    let deadline = Instant::now() + Duration::from_secs(20);
    while beats() < 3 {
        assert!(Instant::now() < deadline, "the Host never started");
        std::thread::sleep(Duration::from_millis(50));
    }
    // End Task: no chance for the launcher to clean up after itself.
    launcher.kill().unwrap();
    launcher.wait().unwrap();
    std::thread::sleep(Duration::from_secs(1));
    let first = beats();
    std::thread::sleep(Duration::from_secs(1));
    let second = beats();
    if let Ok(pid) = fs::read_to_string(fixture.0.join("host.pid")) {
        // Never leak the fixture Host when the assertion below fails.
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", pid.trim()])
            .creation_flags(0x08000000)
            .output();
    }
    assert_eq!(
        first, second,
        "the Host kept running after the launcher died"
    );
}
