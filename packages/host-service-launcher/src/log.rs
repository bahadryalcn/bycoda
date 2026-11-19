//! Size-bounded launcher log. Host console output and launcher events share one
//! rotating file so `host.log` stays bounded for the whole life of a long-running Host.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const LOG_LIMIT: u64 = 10 * 1024 * 1024;
const LOG_NAME: &str = "host.log";
/// Used only when `host.log` itself cannot be opened for appending.
const FALLBACK_LOG_NAME: &str = "launcher.log";
const CATEGORY: &str = "host.launcher";

#[derive(Clone, Copy, Debug)]
pub enum Level {
    Info,
    Warn,
    Error,
}

pub struct RotatingLog {
    path: PathBuf,
    previous: PathBuf,
    file: File,
    size: u64,
    limit: u64,
    rotation_error: Option<io::Error>,
}

/// Error text with its kind, so a support reader sees what failed without a console.
pub fn describe(error: &io::Error) -> String {
    format!("{error} (kind {:?})", error.kind())
}

impl RotatingLog {
    /// Opens `host.log`, rotating a leftover oversized or legacy UTF-16 log first.
    /// A rotation failure is tolerated (the log is truncated instead) and returned
    /// beside the log for the caller to record; only the append open itself can fail.
    pub fn open(directory: &Path) -> io::Result<(Self, Option<io::Error>)> {
        Self::open_named(directory, LOG_NAME, LOG_LIMIT)
    }

    fn open_named(
        directory: &Path,
        name: &str,
        limit: u64,
    ) -> io::Result<(Self, Option<io::Error>)> {
        let path = directory.join(name);
        let previous = directory.join(format!("{name}.old"));
        let rotation_error = match needs_rotation(&path, limit)? {
            true => make_room(&path, &previous).err(),
            false => None,
        };
        let file = open_append(&path)?;
        let size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        Ok((
            Self {
                path,
                previous,
                file,
                size,
                limit,
                rotation_error: None,
            },
            rotation_error,
        ))
    }

    /// Appends raw bytes, rotating first when they would push the file past the limit.
    /// A failed rotation is housekeeping, never a write failure: it is kept for
    /// [`take_rotation_error`] and the bytes are still written.
    pub fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.size > 0 && self.size.saturating_add(bytes.len() as u64) > self.limit {
            if let Err(error) = self.roll() {
                self.rotation_error = Some(error);
            }
        }
        self.file.write_all(bytes)?;
        self.size = self.size.saturating_add(bytes.len() as u64);
        Ok(())
    }

    /// The most recent tolerated mid-run rotation failure, for the caller to record.
    pub fn take_rotation_error(&mut self) -> Option<io::Error> {
        self.rotation_error.take()
    }

    pub fn event(&mut self, level: Level, message: &str) -> io::Result<()> {
        let mut line = diagnostic_line(SystemTime::now(), level, message);
        line.push('\n');
        self.write(line.as_bytes())
    }

    fn roll(&mut self) -> io::Result<()> {
        let outcome = make_room(&self.path, &self.previous);
        // A fresh append handle either follows the new file or, after a failed rotation,
        // the truncated one. Without it the old handle would keep filling `host.log.old`.
        match open_append(&self.path) {
            Ok(file) => {
                self.size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
                self.file = file;
            }
            // Count another full limit of output before the next attempt instead of
            // retrying on every chunk.
            Err(_) => self.size = 0,
        }
        outcome
    }
}

/// Best-effort: appends one launcher event to `host.log`, or `launcher.log` when
/// `host.log` is unusable. Nothing here may stop the launcher.
pub fn record(directory: &Path, level: Level, message: &str) {
    for name in [LOG_NAME, FALLBACK_LOG_NAME] {
        if let Ok((mut log, _)) = RotatingLog::open_named(directory, name, LOG_LIMIT) {
            if log.event(level, message).is_ok() {
                return;
            }
        }
    }
}

fn needs_rotation(path: &Path, limit: u64) -> io::Result<bool> {
    match fs::metadata(path) {
        Ok(metadata) => {
            let mut prefix = Vec::with_capacity(2);
            // Windows PowerShell 5.1 wrote UTF-16 logs; never append UTF-8 to them.
            // An unreadable prefix is left for the append open to report.
            let _ = File::open(path).and_then(|file| file.take(2).read_to_end(&mut prefix));
            Ok(metadata.is_file()
                && (metadata.len() > limit
                    || matches!(prefix.as_slice(), [0xff, 0xfe] | [0xfe, 0xff])))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Moves the log to `<name>.old`. When that fails (a locked or undeletable `.old`),
/// truncates the log so the bound still holds and no UTF-8 is appended to UTF-16 text;
/// the rotation error is returned for the caller to record.
fn make_room(path: &Path, previous: &Path) -> io::Result<()> {
    let rotated = match fs::remove_file(previous) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
    // ast-grep-ignore: rust-rename-without-fsync -- Rotates a diagnostic log, not durable application state.
    .and_then(|()| fs::rename(path, previous));
    if rotated.is_err() {
        let _ = OpenOptions::new().write(true).truncate(true).open(path);
    }
    rotated
}

fn open_append(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

/// Shared diagnostic line format: `<ISO-8601 UTC> <LEVEL padded to 5> [<category>] <message>`.
pub fn diagnostic_line(at: SystemTime, level: Level, message: &str) -> String {
    let level = match level {
        Level::Info => "INFO ",
        Level::Warn => "WARN ",
        Level::Error => "ERROR",
    };
    let message = message.replace("\r\n", "\n").replace('\r', "\n");
    let message = message.trim_end().replace('\n', "\n  ");
    format!("{} {level} [{CATEGORY}] {message}", utc_timestamp(at))
}

fn utc_timestamp(at: SystemTime) -> String {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let (seconds, millis) = (since.as_secs(), since.subsec_millis());
    let (days, rest) = ((seconds / 86_400) as i64, seconds % 86_400);
    // Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "bycoda-launcher-log-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn lines_use_the_shared_diagnostic_format() {
        let at = UNIX_EPOCH + Duration::from_millis(1_700_000_000_042);
        assert_eq!(
            diagnostic_line(at, Level::Error, "start Host: boom\r\nsecond"),
            "2023-11-14T22:13:20.042Z ERROR [host.launcher] start Host: boom\n  second"
        );
        assert!(diagnostic_line(UNIX_EPOCH, Level::Warn, "x")
            .starts_with("1970-01-01T00:00:00.000Z WARN  [host.launcher] x"));
        // A leap day and the end of a century that is not a leap year.
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400); // 2000-02-29
        assert!(utc_timestamp(leap).starts_with("2000-02-29T"));
    }

    #[test]
    fn a_running_log_rotates_when_a_write_would_pass_the_limit() {
        let directory = Directory::new();
        let (mut log, _) = RotatingLog::open_named(&directory.0, "host.log", 100).unwrap();
        for index in 0..30 {
            log.write(format!("line {index:02} of console output\n").as_bytes())
                .unwrap();
            assert!(fs::metadata(directory.0.join("host.log")).unwrap().len() <= 100);
        }
        let current = fs::read_to_string(directory.0.join("host.log")).unwrap();
        assert!(current.contains("line 29 "));
        assert!(fs::metadata(directory.0.join("host.log.old")).unwrap().len() > 0);
    }

    #[test]
    fn rotation_failure_keeps_the_log_bounded_and_writable() {
        let directory = Directory::new();
        // A directory cannot be deleted as a file, so removing `.old` really fails.
        fs::create_dir(directory.0.join("host.log.old")).unwrap();
        fs::write(directory.0.join("host.log"), vec![b'x'; 200]).unwrap();
        let (mut log, rotation) = RotatingLog::open_named(&directory.0, "host.log", 100).unwrap();
        assert!(rotation.is_some());
        assert!(fs::metadata(directory.0.join("host.log")).unwrap().len() <= 100);
        log.write(b"after failed rotation\n").unwrap();
        for _ in 0..10 {
            log.write(&[b'y'; 40]).unwrap();
        }
        assert!(
            log.take_rotation_error().is_some(),
            "a mid-run rotation failure is reported, not fatal"
        );
        let length = fs::metadata(directory.0.join("host.log")).unwrap().len();
        assert!(length <= 100, "{length}");
    }

    #[test]
    fn legacy_utf16_log_is_replaced_even_when_it_cannot_be_rotated() {
        let directory = Directory::new();
        fs::create_dir(directory.0.join("host.log.old")).unwrap();
        fs::write(directory.0.join("host.log"), [0xff, 0xfe, b'a', 0]).unwrap();
        let (mut log, rotation) =
            RotatingLog::open_named(&directory.0, "host.log", LOG_LIMIT).unwrap();
        assert!(rotation.is_some());
        log.write(b"utf8\n").unwrap();
        assert_eq!(
            fs::read(directory.0.join("host.log")).unwrap(),
            b"utf8\n".to_vec()
        );
    }

    #[test]
    fn record_falls_back_to_the_sibling_log_when_host_log_is_unusable() {
        let directory = Directory::new();
        fs::create_dir(directory.0.join("host.log")).unwrap();
        record(&directory.0, Level::Error, "open Host log: denied");
        assert!(fs::read_to_string(directory.0.join("launcher.log"))
            .unwrap()
            .contains("ERROR [host.launcher] open Host log: denied"));
    }
}
