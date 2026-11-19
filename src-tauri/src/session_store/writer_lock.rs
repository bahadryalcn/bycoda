//! The one way to lock the shared writer connection. A panic while a holder
//! owns the guard poisons the mutex; the connection is handed out again only
//! after it is proven back in a clean state, never on faith.
use super::cohort::RegisteredConnection;
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

const CRASHED: &str = "Session store crashed after an internal error and could not be \
                       restored safely; restart the app";

pub(crate) fn lock_writer(
    mutex: &Mutex<RegisteredConnection>,
) -> Result<MutexGuard<'_, RegisteredConnection>, String> {
    match mutex.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            let guard = poisoned.into_inner();
            match restore(&guard) {
                Ok(rolled_back) => {
                    // Only after the check passes: a failed restore leaves the
                    // mutex poisoned so every caller keeps the distinct error.
                    mutex.clear_poison();
                    log::warn!(
                        "session store writer recovered after a panic (open transaction rolled back: {rolled_back})"
                    );
                    Ok(guard)
                }
                Err(error) => {
                    log::error!(
                        "session store writer could not be restored after a panic: {error}"
                    );
                    Err(CRASHED.into())
                }
            }
        }
    }
}

/// Undoes what an unwound holder can leave on the connection. Committed rows
/// are never touched: SQLite already made every commit durable, and only the
/// uncommitted transaction of the panicking holder is discarded.
fn restore(conn: &Connection) -> Result<bool, String> {
    let rolled_back = !conn.is_autocommit();
    if rolled_back {
        conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())?;
    }
    if !conn.is_autocommit() {
        return Err("a transaction is still open after ROLLBACK".into());
    }
    // A holder may have died inside a temporary durability or enforcement
    // switch; put the open-time values back.
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;")
        .map_err(|e| e.to_string())?;
    let foreign_keys: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if foreign_keys != 1 {
        return Err("foreign key enforcement could not be re-enabled".into());
    }
    Ok(rolled_back)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn store() -> Arc<Mutex<RegisteredConnection>> {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE parent(id INTEGER PRIMARY KEY);
             CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
             INSERT INTO parent VALUES (1);",
        )
        .unwrap();
        Arc::new(Mutex::new(RegisteredConnection::in_memory(conn)))
    }

    fn panic_holding(store: &Arc<Mutex<RegisteredConnection>>, work: fn(&Connection)) {
        let shared = Arc::clone(store);
        let result = std::thread::spawn(move || {
            let guard = shared.lock().unwrap();
            work(&guard);
            panic!("holder crashed");
        })
        .join();
        assert!(result.is_err());
        assert!(store.is_poisoned());
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn a_panicking_holder_does_not_brick_the_next_call() {
        let store = store();
        panic_holding(&store, |conn| {
            conn.execute("INSERT INTO parent VALUES (2)", []).unwrap();
        });
        let guard = lock_writer(&store).unwrap();
        // Committed work survives; the poison is cleared for later callers.
        assert_eq!(count(&guard, "parent"), 2);
        drop(guard);
        assert!(!store.is_poisoned());
        assert!(lock_writer(&store).is_ok());
    }

    #[test]
    fn an_open_transaction_is_rolled_back_and_committed_rows_are_kept() {
        let store = store();
        panic_holding(&store, |conn| {
            conn.execute("INSERT INTO parent VALUES (2)", []).unwrap();
            conn.execute_batch(
                "BEGIN; INSERT INTO parent VALUES (3); INSERT INTO parent VALUES (4);",
            )
            .unwrap();
        });
        let guard = lock_writer(&store).unwrap();
        assert!(guard.is_autocommit());
        assert_eq!(count(&guard, "parent"), 2);
        // The half-written transaction must not leak into the next writer.
        guard.execute("INSERT INTO parent VALUES (3)", []).unwrap();
        assert_eq!(count(&guard, "parent"), 3);
    }

    #[test]
    fn connection_settings_changed_by_the_dead_holder_are_restored() {
        let store = store();
        panic_holding(&store, |conn| {
            conn.execute_batch("PRAGMA foreign_keys = OFF; PRAGMA synchronous = FULL;")
                .unwrap();
        });
        let guard = lock_writer(&store).unwrap();
        assert!(guard
            .execute("INSERT INTO child VALUES (1, 99)", [])
            .is_err());
    }

    #[test]
    fn the_crash_error_names_the_cause_not_contention() {
        assert!(!CRASHED.contains("locked"));
    }

    #[test]
    fn production_code_reaches_the_writer_only_through_lock_writer() {
        // Raw `conn.lock()` call sites are what turned one poisoned lock into
        // a permanently bricked store; tests keep their own `.unwrap()` locks.
        let sources = [
            ("session_store.rs", include_str!("../session_store.rs")),
            ("authority.rs", include_str!("authority.rs")),
            ("canonical_store.rs", include_str!("canonical_store.rs")),
            (
                "delete_with_images.rs",
                include_str!("delete_with_images.rs"),
            ),
            ("incremental.rs", include_str!("incremental.rs")),
            ("pin_receipts.rs", include_str!("pin_receipts.rs")),
        ];
        for (name, source) in sources {
            for raw in [
                "conn.lock().map_err",
                "conn.lock().unwrap_or_else",
                "Session store is locked",
            ] {
                assert!(!source.contains(raw), "{name} bypasses lock_writer: {raw}");
            }
        }
    }
}
