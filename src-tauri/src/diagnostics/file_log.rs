//! `log` backend: one size-rotated `bycoda.log` in the app log directory, written by a
//! background thread so callers never block on disk. The line format is the shared one
//! (`formatDiagnosticLine` in packages/account-contracts/src/diagnostics.ts).
use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::time::Duration;

pub(super) const MAX_BYTES: u64 = 5 * 1024 * 1024;
const KEEP: usize = 2;
const QUEUE: usize = 4096;
const CATEGORY_LIMIT: usize = 48;
const FLUSH_WAIT: Duration = Duration::from_millis(1500);

enum Message {
    Line(String),
    Flush(SyncSender<()>),
}

struct FileLogger {
    sender: SyncSender<Message>,
    level: LevelFilter,
    echo: bool,
    dropped: AtomicU64,
}

/// `bycoda.log` -> `bycoda.1.log` -> `bycoda.2.log`.
pub(super) fn rotated_path(base: &Path, index: usize) -> PathBuf {
    if index == 0 {
        return base.to_path_buf();
    }
    let stem = base
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("bycoda");
    let ext = base.extension().and_then(|s| s.to_str()).unwrap_or("log");
    base.with_file_name(format!("{stem}.{index}.{ext}"))
}

pub(super) struct RotatingFile {
    base: PathBuf,
    max: u64,
    file: Option<File>,
    size: u64,
}

impl RotatingFile {
    pub(super) fn new(base: PathBuf, max: u64) -> Self {
        Self {
            base,
            max,
            file: None,
            size: 0,
        }
    }

    fn open(&mut self) -> std::io::Result<()> {
        if let Some(parent) = self.base.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.base)?;
        self.size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        self.file = Some(file);
        Ok(())
    }

    fn rotate(&mut self) {
        self.file = None;
        let _ = std::fs::remove_file(rotated_path(&self.base, KEEP));
        for index in (0..KEEP).rev() {
            // ast-grep-ignore: rust-rename-without-fsync -- rotates closed, already-written log files; not a state replacement.
            let _ = std::fs::rename(
                rotated_path(&self.base, index),
                rotated_path(&self.base, index + 1),
            );
        }
    }

    pub(super) fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        if self.file.is_none() {
            self.open()?;
        }
        let bytes = line.len() as u64 + 1;
        if self.size > 0 && self.size + bytes > self.max {
            self.rotate();
            self.open()?;
        }
        let file = self.file.as_mut().ok_or(std::io::ErrorKind::NotFound)?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        self.size += bytes;
        Ok(())
    }

    fn flush(&mut self) {
        if let Some(file) = self.file.as_mut() {
            let _ = file.flush();
        }
    }
}

pub(super) fn level_name(level: Level) -> &'static str {
    match level {
        Level::Error => "ERROR",
        Level::Warn => "WARN",
        Level::Info => "INFO",
        Level::Debug | Level::Trace => "DEBUG",
    }
}

/// `native.` + the log target with `::` as `.`, limited to `[a-z0-9._-]` and 48 chars.
pub(super) fn category_for(target: &str) -> String {
    format!("native.{}", target.replace("::", "."))
        .chars()
        .map(|c| {
            let c = c.to_ascii_lowercase();
            if c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(CATEGORY_LIMIT)
        .collect()
}

pub(super) fn format_line(
    at: time::OffsetDateTime,
    level: Level,
    target: &str,
    message: &str,
) -> String {
    let at = at.to_offset(time::UtcOffset::UTC);
    let normalized = message.replace("\r\n", "\n").replace('\r', "\n");
    let body = normalized
        .trim_end()
        .split('\n')
        .collect::<Vec<_>>()
        .join("\n  ");
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z {:<5} [{}] {}",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second(),
        at.millisecond(),
        level_name(level),
        category_for(target),
        body
    )
}

pub(super) fn level_from_env(value: Option<&str>) -> LevelFilter {
    value
        .and_then(|text| text.trim().parse::<LevelFilter>().ok())
        .unwrap_or(if cfg!(debug_assertions) {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        })
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        // Dependencies stay at warnings; only this crate follows the configured level.
        let own = metadata.target().starts_with("bycoda") || metadata.target() == "panic";
        metadata.level() <= self.level && (own || metadata.level() <= Level::Warn)
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let now = time::OffsetDateTime::now_utc();
        let mut line = format_line(
            now,
            record.level(),
            record.target(),
            &record.args().to_string(),
        );
        if self.echo {
            eprintln!("{line}");
        }
        let lost = self.dropped.swap(0, Ordering::Relaxed);
        if lost > 0 {
            let note = format_line(
                now,
                Level::Warn,
                "diagnostics::file_log",
                &format!("{lost} log lines were dropped because the writer queue was full"),
            );
            line = format!("{note}\n{line}");
        }
        if self.sender.try_send(Message::Line(line)).is_err() {
            self.dropped.fetch_add(lost + 1, Ordering::Relaxed);
        }
    }

    fn flush(&self) {
        let (ack, wait) = sync_channel(1);
        match self.sender.try_send(Message::Flush(ack)) {
            Ok(()) => {
                let _ = wait.recv_timeout(FLUSH_WAIT);
            }
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
        }
    }
}

fn writer(receiver: Receiver<Message>, mut file: RotatingFile) {
    while let Ok(message) = receiver.recv() {
        match message {
            Message::Line(line) => {
                let _ = file.write_line(&line);
            }
            Message::Flush(ack) => {
                file.flush();
                let _ = ack.send(());
            }
        }
    }
}

static LOG_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub(super) fn log_dir() -> Option<&'static PathBuf> {
    LOG_DIR.get()
}

/// Installs the logger once; an already-set global logger is left alone.
pub(crate) fn install(log_dir: &Path) {
    let _ = LOG_DIR.set(log_dir.to_path_buf());
    let level = level_from_env(std::env::var("BYCODA_LOG_LEVEL").ok().as_deref());
    let (sender, receiver) = sync_channel(QUEUE);
    let file = RotatingFile::new(log_dir.join("bycoda.log"), MAX_BYTES);
    if std::thread::Builder::new()
        .name("bycoda-file-log".into())
        .spawn(move || writer(receiver, file))
        .is_err()
    {
        return;
    }
    let logger = Box::leak(Box::new(FileLogger {
        sender,
        level,
        echo: cfg!(debug_assertions),
        dropped: AtomicU64::new(0),
    }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(level);
    }
}

/// Flushes queued lines (panic hook and clean exit).
pub(crate) fn flush() {
    log::logger().flush();
}
