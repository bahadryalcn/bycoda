use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

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
        let path = self.0.join("service.json");
        fs::write(&path, serde_json::to_vec(config).unwrap()).unwrap();
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
