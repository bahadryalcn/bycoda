//! Guard query-only operations against an accidentally retained transaction.
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;

use super::cohort::RegisteredConnection;

/// Counts reader calls that returned with a statement still busy. Logs on
/// powers of two so a repeating leak cannot flood stderr.
static BUSY_READS: AtomicU64 = AtomicU64::new(0);

struct ReadTransactionGuard<'a>(&'a Connection);

impl Drop for ReadTransactionGuard<'_> {
    fn drop(&mut self) {
        if !self.0.is_autocommit() {
            // A panic must not leave the reusable reader pinning a WAL snapshot.
            let _ = self.0.execute_batch("ROLLBACK");
        }
    }
}

/// Opens one WAL reader for the session store. Startup and the WAL watchdog
/// share this so a reopened reader gets the same flags and file identity check.
pub(super) fn open_reader(
    path: &Path,
    writer: &RegisteredConnection,
) -> Result<Connection, String> {
    let reader = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    writer.verify_connection(&reader)?;
    reader
        .execute_batch(
            "PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -65536;",
        )
        .map_err(|e| e.to_string())?;
    Ok(reader)
}

pub(super) fn run<T>(
    conn: &Connection,
    read: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = ReadTransactionGuard(conn);
    if !conn.is_autocommit() {
        return Err("Session reader already has an active transaction".into());
    }
    let result = read(conn);
    if conn.is_busy() {
        let occurrence = BUSY_READS.fetch_add(1, Ordering::Relaxed) + 1;
        if occurrence.is_power_of_two() {
            eprintln!("session reader left a busy statement (occurrence {occurrence}); wal_watchdog recovers stuck readers");
        }
    }
    if !conn.is_autocommit() {
        let cleanup = conn
            .execute_batch("ROLLBACK")
            .map_err(|error| error.to_string());
        return match (result, cleanup) {
            (Err(error), Ok(())) => Err(error),
            (Err(error), Err(cleanup)) => {
                Err(format!("{error}; reader rollback failed: {cleanup}"))
            }
            (Ok(_), Ok(())) => Err("Session reader left a transaction open".into()),
            (Ok(_), Err(cleanup)) => Err(format!("Session reader rollback failed: {cleanup}")),
        };
    }
    drop(guard);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfinished_read_transaction_is_rolled_back_on_error_and_success() {
        let conn = Connection::open_in_memory().unwrap();
        for fail in [true, false] {
            let result: Result<(), String> = run(&conn, |conn| {
                conn.execute_batch("BEGIN; SELECT 1;").unwrap();
                if fail {
                    Err("read failed".into())
                } else {
                    Ok(())
                }
            });
            assert_eq!(
                result.unwrap_err(),
                if fail {
                    "read failed"
                } else {
                    "Session reader left a transaction open"
                }
            );
            assert!(conn.is_autocommit());
        }
    }

    #[test]
    fn unfinished_read_transaction_is_rolled_back_on_panic() {
        let conn = Connection::open_in_memory().unwrap();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _: Result<(), String> = run(&conn, |conn| {
                conn.execute_batch("BEGIN; SELECT 1;").unwrap();
                panic!("interrupted read")
            });
        }));
        assert!(conn.is_autocommit());
    }

    #[test]
    fn released_reader_allows_wal_backfill() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("isolated.db");
        let writer = Connection::open(&path).unwrap();
        writer.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(value); INSERT INTO records VALUES ('seed');").unwrap();
        let reader =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let checkpoint = || {
            writer
                .query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
                    Ok((row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
                })
                .unwrap()
        };
        let result: Result<(), String> = run(&reader, |conn| {
            conn.execute_batch("BEGIN; SELECT * FROM records;").unwrap();
            for _ in 0..20 {
                writer
                    .execute("INSERT INTO records VALUES (randomblob(8192))", [])
                    .unwrap();
            }
            let (frames, backfilled) = checkpoint();
            assert!(backfilled < frames);
            Err("cancelled".into())
        });
        assert_eq!(result.unwrap_err(), "cancelled");
        let (frames, backfilled) = checkpoint();
        assert_eq!(frames, backfilled);
    }
}
