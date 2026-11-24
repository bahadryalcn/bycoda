//! Retry policy for opening the session database at launch.
//!
//! Two failures are worth waiting out: another process holding the database
//! ("database is locked") and a transient I/O error on the WAL index, which
//! happens while another process still has the `-shm` file mapped and clears
//! once that mapping is gone.
//! Everything else, corruption and permissions included, fails at once.

use std::time::{Duration, Instant};

/// How long a transient SQLite I/O failure is retried before launch gives up.
pub(super) const OPEN_IO_WAIT: Duration = Duration::from_secs(30);

const CODE_MARKER: &str = "[sqlite extended code ";

/// SQLite extended result codes (`SQLITE_IOERR | n << 8`) that describe the
/// WAL index or a lock being held elsewhere, not a damaged file or disk.
const TRANSIENT_IO_CODES: [i32; 6] = [
    1546, // SQLITE_IOERR_TRUNCATE
    3850, // SQLITE_IOERR_LOCK
    4618, // SQLITE_IOERR_SHMOPEN
    4874, // SQLITE_IOERR_SHMSIZE
    5130, // SQLITE_IOERR_SHMLOCK
    5386, // SQLITE_IOERR_SHMMAP
];

/// Flattens a rusqlite error to text and keeps the extended code, which
/// `Display` drops.
pub(super) fn describe(error: rusqlite::Error) -> String {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _) => {
            format!("{error} {CODE_MARKER}{}]", failure.extended_code)
        }
        _ => error.to_string(),
    }
}

fn extended_code(error: &str) -> Option<i32> {
    let rest = &error[error.find(CODE_MARKER)? + CODE_MARKER.len()..];
    rest[..rest.find(']')?].parse().ok()
}

fn is_locked(error: &str) -> bool {
    error.contains("database is locked")
}

fn is_transient_io(error: &str) -> bool {
    extended_code(error).is_some_and(|code| TRANSIENT_IO_CODES.contains(&code))
}

/// Retries `open` while the database is locked (up to `lock_wait`) or fails
/// with a transient I/O error (up to `io_wait`, counted from the first such
/// failure). Any other error returns at once.
pub(super) fn open_waiting_out_failures<T>(
    open: impl Fn() -> Result<T, String>,
    lock_wait: Duration,
    io_wait: Duration,
    pause: Duration,
) -> Result<T, String> {
    let started = Instant::now();
    let mut io_started: Option<Instant> = None;
    loop {
        match open() {
            Err(error) if is_locked(&error) && started.elapsed() < lock_wait => {
                log::warn!("session store open waits for a locked database: {error}");
                std::thread::sleep(pause);
            }
            Err(error)
                if is_transient_io(&error)
                    && io_started.get_or_insert_with(Instant::now).elapsed() < io_wait =>
            {
                log::warn!("session store open retries a transient I/O failure: {error}");
                std::thread::sleep(pause);
            }
            Err(error) if is_transient_io(&error) => {
                return Err(format!(
                    "{error}; gave up after {}s of retries",
                    io_wait.as_secs()
                ));
            }
            result => return result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn io_error(code: i32) -> String {
        format!("disk I/O error {CODE_MARKER}{code}]")
    }

    #[test]
    fn describe_keeps_the_extended_code() {
        let failure = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ErrorCode::SystemIoFailure,
                extended_code: 1546,
            },
            None,
        );
        let text = describe(failure);
        assert!(text.ends_with(&format!("{CODE_MARKER}1546]")), "{text}");
        assert_eq!(extended_code(&text), Some(1546));
    }

    #[test]
    fn classifies_transient_io_only() {
        assert!(is_transient_io(&io_error(1546)));
        assert!(is_transient_io(&io_error(5386)));
        assert!(!is_transient_io(&io_error(266))); // SQLITE_IOERR_READ
        assert!(!is_transient_io(&io_error(778))); // SQLITE_IOERR_WRITE
        assert!(!is_transient_io(&format!(
            "database disk image is malformed {CODE_MARKER}11]"
        )));
        assert!(!is_transient_io("disk I/O error"));
        assert!(!is_transient_io("unable to open database file"));
    }

    #[test]
    fn retries_a_transient_io_failure_until_it_clears() {
        let attempts = Cell::new(0);
        let opened = open_waiting_out_failures(
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() < 4 {
                    Err(io_error(1546))
                } else {
                    Ok(attempts.get())
                }
            },
            Duration::ZERO,
            Duration::from_secs(5),
            Duration::ZERO,
        );
        assert_eq!(opened, Ok(4));
    }

    #[test]
    fn other_errors_fail_on_the_first_attempt() {
        for error in [
            io_error(266),
            "file is not a database".to_string(),
            format!("attempt to write a readonly database {CODE_MARKER}8]"),
        ] {
            let attempts = Cell::new(0);
            let failed: Result<(), String> = open_waiting_out_failures(
                || {
                    attempts.set(attempts.get() + 1);
                    Err(error.clone())
                },
                Duration::from_secs(5),
                Duration::from_secs(5),
                Duration::ZERO,
            );
            assert_eq!(failed, Err(error));
            assert_eq!(attempts.get(), 1);
        }
    }

    #[test]
    fn transient_io_retries_stop_at_the_deadline_and_keep_the_code() {
        let failed: Result<(), String> = open_waiting_out_failures(
            || Err(io_error(1546)),
            Duration::from_secs(5),
            Duration::from_millis(30),
            Duration::from_millis(5),
        );
        let message = failed.unwrap_err();
        assert!(message.contains("[sqlite extended code 1546]"), "{message}");
        assert!(message.contains("gave up"), "{message}");
    }

    #[test]
    fn retries_a_locked_database_until_it_opens() {
        let attempts = Cell::new(0);
        let opened = open_waiting_out_failures(
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() < 3 {
                    Err("database is locked".to_string())
                } else {
                    Ok(attempts.get())
                }
            },
            Duration::from_secs(5),
            Duration::ZERO,
            Duration::ZERO,
        );
        assert_eq!(opened, Ok(3));
    }

    #[test]
    fn locked_databases_keep_their_own_wait() {
        let gave_up: Result<(), String> = open_waiting_out_failures(
            || Err("database is locked".to_string()),
            Duration::ZERO,
            Duration::from_secs(5),
            Duration::ZERO,
        );
        assert_eq!(gave_up, Err("database is locked".to_string()));
    }
}
