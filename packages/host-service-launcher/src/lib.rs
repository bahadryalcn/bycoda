//! Transparent, per-user Host supervision. Never evaluates a shell command.
mod job;
mod log;

use log::{describe, record, Level, RotatingLog};
use serde::Deserialize;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

const RESTART_DELAYS: [u64; 5] = [2, 5, 15, 30, 60];
/// How long a finished Host's console pipes may stay open (a descendant can keep one)
/// before the launcher stops waiting for the last output and restarts or exits.
const PIPE_DRAIN: Duration = Duration::from_secs(2);

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

type SharedLog = Arc<Mutex<RotatingLog>>;

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panicked pump thread must not stop supervision or console draining.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Keeps the failing step and the `io::ErrorKind` in a message that reaches `host.log`.
fn step(name: &str, error: io::Error) -> io::Error {
    io::Error::new(error.kind(), format!("{name}: {}", describe(&error)))
}

/// Copies one console stream into the shared rotating log. It never stops before
/// end of stream, even when a write fails: a full pipe would block the Host.
fn pump(mut stream: impl Read + Send + 'static, log: SharedLog, finished: mpsc::Sender<()>) {
    std::thread::spawn(move || {
        // shortcut: chunks, not lines, so a stdout and stderr line can interleave mid-line;
        // upgrade to line buffering if a log reader ever needs whole lines per stream.
        let mut buffer = [0u8; 8192];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let mut log = locked(&log);
                    let _ = log.write(&buffer[..length]);
                    if let Some(error) = log.take_rotation_error() {
                        let message = format!("rotate Host log: {}", describe(&error));
                        let _ = log.event(Level::Warn, &message);
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        let _ = finished.send(());
    });
}

struct Launcher<'a> {
    configuration: &'a Configuration,
    log: Mutex<Option<SharedLog>>,
}

impl Launcher<'_> {
    /// One log for every Host launch, opened lazily so an unwritable `host.log` is a
    /// retried launch failure rather than the end of supervision.
    fn log(&self) -> io::Result<SharedLog> {
        let mut slot = locked(&self.log);
        if let Some(log) = slot.as_ref() {
            return Ok(log.clone());
        }
        let (mut log, rotation_error) = RotatingLog::open(&self.configuration.directory)?;
        if let Some(error) = rotation_error {
            let message = format!("rotate Host log: {}", describe(&error));
            let _ = log.event(Level::Warn, &message);
        }
        let log = Arc::new(Mutex::new(log));
        *slot = Some(log.clone());
        Ok(log)
    }

    fn note(&self, level: Level, message: &str) {
        let log = locked(&self.log).clone();
        match log {
            Some(log) => {
                let _ = locked(&log).event(level, message);
            }
            None => record(&self.configuration.directory, level, message),
        }
    }

    fn launch(&self) -> io::Result<(i32, Duration)> {
        let log = match self.log() {
            Ok(log) => log,
            Err(error) => {
                // Housekeeping never ends supervision: report it and let the normal
                // backoff retry the append open.
                self.note(
                    Level::Error,
                    &format!("open Host log: {}", describe(&error)),
                );
                return Ok((1, Duration::ZERO));
            }
        };
        let mut command = self.configuration.command();
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        let started = Instant::now();
        let mut child = command.spawn().map_err(|error| step("start Host", error))?;
        let (done, finished) = mpsc::channel();
        let mut pumps = 0;
        if let Some(stream) = child.stdout.take() {
            pump(stream, log.clone(), done.clone());
            pumps += 1;
        }
        if let Some(stream) = child.stderr.take() {
            pump(stream, log.clone(), done.clone());
            pumps += 1;
        }
        drop(done);
        let status = child.wait().map_err(|error| step("wait for Host", error))?;
        let uptime = started.elapsed();
        let deadline = Instant::now() + PIPE_DRAIN;
        for _ in 0..pumps {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if finished.recv_timeout(remaining).is_err() {
                break;
            }
        }
        let code = status.code().unwrap_or(1);
        self.note(
            if code == 0 { Level::Info } else { Level::Warn },
            &format!("Host exited code={code} uptime_s={}", uptime.as_secs()),
        );
        Ok((code, uptime))
    }
}

fn run_configured(
    path: &Path,
    directory: &mut Option<PathBuf>,
    job: &mut Option<job::LifetimeJob>,
) -> io::Result<i32> {
    let file = File::open(path).map_err(|error| step("read launcher configuration", error))?;
    let configuration: Configuration = serde_json::from_reader(file)
        .map_err(|error| step("parse launcher configuration", error.into()))?;
    configuration
        .validate()
        .map_err(|error| step("validate launcher configuration", error))?;
    *directory = Some(configuration.directory.clone());
    let launcher = Launcher {
        configuration: &configuration,
        log: Mutex::new(None),
    };
    // Joining before the first spawn puts every Host process in a kill-on-close job, so a
    // killed launcher cannot leave an unsupervised Host holding the port and database.
    *job = match job::bind_children_to_launcher() {
        Ok(job) => Some(job),
        Err(error) => {
            launcher.note(
                Level::Warn,
                &format!(
                    "bind Host lifetime to launcher: {}; a killed launcher can leave the Host running",
                    describe(&error)
                ),
            );
            None
        }
    };
    let limit = std::env::var("BYCODA_LAUNCHER_RESTARTS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(u32::MAX);
    supervise(
        limit,
        || launcher.launch(),
        |delay| {
            launcher.note(
                Level::Warn,
                &format!("Restarting Host in {} s", delay.as_secs()),
            );
            std::thread::sleep(delay);
        },
    )
}

pub fn run_and_exit(path: &Path) -> ! {
    // Until the configuration validates, its own folder is where the Host data lives.
    let mut directory = path
        .parent()
        .filter(|parent| parent.is_absolute())
        .map(Path::to_path_buf);
    // The launcher is itself in the job. Let Windows close the handle on process
    // exit, after we set the exit code, so dropping it cannot terminate us first.
    let mut job = None;
    let result = run_configured(path, &mut directory, &mut job);
    if let (Err(error), Some(directory)) = (&result, &directory) {
        // A windowless launcher has no stderr: host.log is where support will look.
        record(
            directory,
            Level::Error,
            &format!("Host launcher failed: {error}"),
        );
    }
    std::process::exit(result.unwrap_or_else(|error| {
        eprintln!("Host launcher failed: {error}");
        1
    }));
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

    #[test]
    fn step_errors_keep_their_kind_and_name_the_failing_step() {
        let error = step(
            "start Host",
            io::Error::new(io::ErrorKind::NotFound, "no node"),
        );
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(error.to_string(), "start Host: no node (kind NotFound)");
    }
}
