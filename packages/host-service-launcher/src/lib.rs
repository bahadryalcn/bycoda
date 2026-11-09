//! Transparent, per-user Host supervision. Never evaluates a shell command.
use serde::Deserialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const LOG_LIMIT: u64 = 10 * 1024 * 1024;
const RESTART_DELAYS: [u64; 5] = [2, 5, 15, 30, 60];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    pub executable: PathBuf,
    pub entry: PathBuf,
    pub directory: PathBuf,
    pub port: u16,
    pub path: String,
}

impl Configuration {
    pub fn validate(&self) -> io::Result<()> {
        if !self.executable.is_absolute()
            || !self.entry.is_absolute()
            || !self.directory.is_absolute()
            || self.port == 0
            || self.path.is_empty()
            || self.path.contains('\0')
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid Host launcher paths, port or PATH.",
            ));
        }
        Ok(())
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.executable);
        command
            .arg(&self.entry)
            .arg("serve")
            .arg("--data-dir")
            .arg(&self.directory)
            .arg("--port")
            .arg(self.port.to_string())
            .current_dir(&self.directory)
            .env("PATH", &self.path)
            .env_remove("BYCODA_LAUNCHER_RESTARTS")
            .stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        command
    }
}

pub fn open_log(directory: &Path) -> io::Result<File> {
    let log = directory.join("host.log");
    match fs::metadata(&log) {
        Ok(metadata) => {
            let mut prefix = Vec::with_capacity(2);
            File::open(&log)?.take(2).read_to_end(&mut prefix)?;
            // Windows PowerShell 5.1 wrote UTF-16 logs; never append UTF-8 to them.
            if metadata.len() > LOG_LIMIT
                || matches!(prefix.as_slice(), [0xff, 0xfe] | [0xfe, 0xff])
            {
                let previous = directory.join("host.log.old");
                match fs::remove_file(&previous) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                // ast-grep-ignore: rust-rename-without-fsync -- Rotates a diagnostic log, not durable application state.
                fs::rename(&log, previous)?;
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    OpenOptions::new().create(true).append(true).open(log)
}

fn supervise(
    limit: u32,
    mut launch: impl FnMut() -> io::Result<(i32, Duration)>,
    mut sleep: impl FnMut(Duration),
) -> io::Result<i32> {
    let mut failures = 0usize;
    for restarts in 0..=limit {
        let (code, duration) = launch()?;
        if code == 0 || restarts == limit {
            return Ok(code);
        }
        failures = if duration >= Duration::from_secs(300) {
            0
        } else {
            failures.saturating_add(1)
        };
        sleep(Duration::from_secs(
            RESTART_DELAYS[failures.saturating_sub(1).min(RESTART_DELAYS.len() - 1)],
        ));
    }
    unreachable!()
}

pub fn run(path: &Path) -> io::Result<i32> {
    let configuration: Configuration = serde_json::from_reader(File::open(path)?)?;
    configuration.validate()?;
    let limit = std::env::var("BYCODA_LAUNCHER_RESTARTS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(u32::MAX);
    supervise(
        limit,
        || {
            let log = open_log(&configuration.directory)?;
            let mut command = configuration.command();
            command.stdout(log.try_clone()?).stderr(log);
            let started = Instant::now();
            let status = command.status()?;
            Ok((status.code().unwrap_or(1), started.elapsed()))
        },
        std::thread::sleep,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_children_back_off_and_healthy_run_resets_delay() {
        let codes = [1, 2, 3, 4, 5, 6, 7, 0];
        let mut launches = 0;
        let mut delays = Vec::new();
        let code = supervise(
            10,
            || {
                let index = launches;
                launches += 1;
                Ok((
                    codes[index],
                    Duration::from_secs(if index == 6 { 300 } else { 1 }),
                ))
            },
            |delay| delays.push(delay.as_secs()),
        )
        .unwrap();
        assert_eq!(code, 0);
        assert_eq!(delays, [2, 5, 15, 30, 60, 60, 2]);
    }

    #[test]
    fn restart_limit_preserves_failure_and_start_errors_are_explicit() {
        let mut attempts = 0;
        assert_eq!(
            supervise(
                2,
                || {
                    attempts += 1;
                    Ok((17, Duration::ZERO))
                },
                |_| {}
            )
            .unwrap(),
            17
        );
        assert_eq!(attempts, 3);
        let result = supervise(
            10,
            || Err(io::Error::new(io::ErrorKind::PermissionDenied, "blocked")),
            |_| panic!("must not retry uncertain launch"),
        );
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
    }
}
