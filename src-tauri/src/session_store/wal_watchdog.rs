//! Finds a SQLite WAL that stopped checkpointing because a connection inside
//! the app kept a read snapshot or statement open. It names the connections,
//! releases the reader that holds the snapshot, and logs what it did.
use std::fs;
use std::io;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, TryLockError};
use std::time::Duration;

use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{reader, SessionStore};

const TICK: Duration = Duration::from_secs(60);
/// Frames the WAL may fall behind before a flat checkpoint counts as stuck.
const STUCK_LAG_FRAMES: i64 = 2_000;
const LOG_CAP_BYTES: usize = 256 * 1024;
const DIAGNOSTICS_DIR: &str = "diagnostics";
const LOG_FILE: &str = "wal-watchdog.log";
/// The same file `init_with` opens.
const DATABASE_FILE: &str = "bycoda.db";
/// Keep in step with the writer setup in `SessionStore::open`.
const WRITER_PRAGMAS: &str =
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
     PRAGMA journal_size_limit = 67108864; PRAGMA cache_size = -65536;";

type Slot = Mutex<Option<Connection>>;

/// Lets the watchdog swap the writer connection in place.
pub(super) trait ReopenWriter {
    /// Installs `replacement` and returns the old connection to close.
    fn swap_connection(&mut self, replacement: Connection) -> Result<Connection, String>;
}

impl ReopenWriter for super::cohort::RegisteredConnection {
    fn swap_connection(&mut self, replacement: Connection) -> Result<Connection, String> {
        self.replace_connection(replacement)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Checkpoint {
    busy: i64,
    log_frames: i64,
    checkpointed: i64,
}

#[derive(Default)]
pub(super) struct Watch {
    previous: Option<Checkpoint>,
    /// Backfill position at which reopening the idle readers released nothing:
    /// the snapshot is held elsewhere, so idle reopens wait until it moves.
    idle_reopen_failed_at: Option<i64>,
}

/// Starts the watchdog thread. Called from `session_store::init`, so the
/// store is always file-backed here; in-memory stores never reach it.
pub(super) fn start(app: &AppHandle) {
    if crate::package_smoke::active() {
        return;
    }
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("session-wal-watchdog".into())
        .spawn(move || {
            let mut watch = Watch::default();
            let log_dir = data_dir.join(DIAGNOSTICS_DIR);
            let database: PathBuf = data_dir.join(DATABASE_FILE);
            loop {
                std::thread::sleep(TICK);
                let Some(store) = app.try_state::<SessionStore>() else {
                    return;
                };
                let reopen = || -> Result<Connection, String> {
                    let writer = store.lock_conn()?;
                    reader::open_reader(&database, &writer)
                };
                // The same pragmas `SessionStore::open` applies to the writer.
                let open_writer = || -> Result<Connection, String> {
                    let conn = Connection::open(&database).map_err(|e| e.to_string())?;
                    conn.execute_batch(WRITER_PRAGMAS)
                        .map_err(|e| e.to_string())?;
                    Ok(conn)
                };
                tick(
                    &store.conn,
                    &[
                        ("read_conn", &store.read_conn),
                        ("list_conn", &store.list_conn),
                        ("background_conn", &store.background_conn),
                    ],
                    &mut watch,
                    &reopen,
                    &open_writer,
                    &log_dir,
                );
            }
        });
    if let Err(error) = spawned {
        log::warn!("session wal watchdog thread: {error}");
    }
}

/// One watchdog pass. Returns true when it found a stuck WAL and logged it.
pub(super) fn tick<C: Deref<Target = Connection> + ReopenWriter>(
    writer: &Mutex<C>,
    readers: &[(&'static str, &Slot)],
    watch: &mut Watch,
    reopen: &dyn Fn() -> Result<Connection, String>,
    open_writer: &dyn Fn() -> Result<Connection, String>,
    log_dir: &Path,
) -> bool {
    let Ok(now) = checkpoint_locked(writer) else {
        return false;
    };
    let previous = watch.previous.replace(now);
    if !is_stuck(previous, now) {
        return false;
    }
    let mut connections = vec![probe_writer(writer)];
    let mut holder = None;
    for (name, slot) in readers {
        let (probe, needs_recovery) = probe_slot(name, slot);
        connections.push(probe);
        if needs_recovery && holder.is_none() {
            holder = Some((*name, *slot));
        }
    }
    let (action, after) = match holder {
        Some((name, slot)) => {
            let action = recover_slot(name, slot, reopen);
            let after = if action.starts_with("recovered") {
                checkpoint_locked(writer).ok()
            } else {
                None
            };
            (action, after)
        }
        None if watch.idle_reopen_failed_at == Some(now.checkpointed) => {
            ("no_owned_reader_holds_snapshot".to_owned(), None)
        }
        // Every owned reader looks idle (autocommit, no busy statement) yet the
        // WAL does not move. A reader can still pin a snapshot without either
        // sign, so reopen them one by one and record which one let the
        // checkpoint advance; that names the culprit in the log.
        None => {
            let (mut action, mut after) = reopen_idle_readers(writer, readers, reopen);
            if after.is_none_or(|after| after.checkpointed <= now.checkpointed) {
                // The readers released nothing, so the writer connection itself
                // may hold the read mark; reopen it too.
                let (part, writer_after) = reopen_writer(writer, open_writer, after.unwrap_or(now));
                action.push_str(" writer=");
                action.push_str(&part);
                after = writer_after.or(after);
            }
            if after.is_none_or(|after| after.checkpointed <= now.checkpointed) {
                watch.idle_reopen_failed_at = Some(now.checkpointed);
            }
            (action, after)
        }
    };
    let line = json!({
        "ts_ms": super::now_millis(),
        "wal": wal_json(now, previous.map(|p| p.checkpointed)),
        "connections": connections,
        "action": action,
        "after": after.map(|checkpoint| wal_json(checkpoint, None)),
    })
    .to_string();
    log::debug!("{line}");
    if let Err(error) = append_capped(&log_dir.join(LOG_FILE), &line) {
        log::warn!("session wal watchdog log: {error}");
    }
    true
}

/// Stuck means the WAL lags by more than the threshold and the last passive
/// checkpoint backfilled nothing new since the previous pass.
fn is_stuck(previous: Option<Checkpoint>, now: Checkpoint) -> bool {
    now.log_frames - now.checkpointed > STUCK_LAG_FRAMES
        && previous.is_some_and(|previous| now.checkpointed <= previous.checkpointed)
}

fn wal_json(checkpoint: Checkpoint, previous_checkpointed: Option<i64>) -> Value {
    json!({
        "busy": checkpoint.busy,
        "logFrames": checkpoint.log_frames,
        "checkpointed": checkpoint.checkpointed,
        "previousCheckpointed": previous_checkpointed,
    })
}

fn checkpoint_passive(conn: &Connection) -> Result<Checkpoint, String> {
    conn.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
        Ok(Checkpoint {
            busy: row.get(0)?,
            log_frames: row.get(1)?,
            checkpointed: row.get(2)?,
        })
    })
    .map_err(|error| error.to_string())
}

fn checkpoint_locked<C: Deref<Target = Connection>>(
    writer: &Mutex<C>,
) -> Result<Checkpoint, String> {
    let guard = writer.lock().map_err(|_| "Session writer is poisoned")?;
    checkpoint_passive(&guard)
}

fn probe_conn(name: &str, conn: &Connection) -> (Value, bool) {
    let autocommit = conn.is_autocommit();
    let busy = conn.is_busy();
    let txn = match conn.transaction_state(Some(rusqlite::MAIN_DB)) {
        Ok(rusqlite::TransactionState::None) => "none",
        Ok(rusqlite::TransactionState::Read) => "read",
        Ok(rusqlite::TransactionState::Write) => "write",
        Ok(_) | Err(_) => "unknown",
    };
    (
        json!({ "name": name, "status": "open", "autocommit": autocommit, "busy": busy, "txn": txn }),
        busy || !autocommit,
    )
}

fn probe_writer<C: Deref<Target = Connection>>(writer: &Mutex<C>) -> Value {
    match writer.try_lock() {
        Ok(guard) => probe_conn("writer", &guard).0,
        Err(TryLockError::WouldBlock) => json!({ "name": "writer", "status": "locked" }),
        Err(TryLockError::Poisoned(_)) => json!({ "name": "writer", "status": "poisoned" }),
    }
}

/// Probes a reader without blocking. The flag says it needs recovery.
fn probe_slot(name: &str, slot: &Slot) -> (Value, bool) {
    match slot.try_lock() {
        Ok(guard) => match guard.as_ref() {
            Some(conn) => probe_conn(name, conn),
            None => (json!({ "name": name, "status": "none" }), false),
        },
        Err(TryLockError::WouldBlock) => (json!({ "name": name, "status": "locked" }), false),
        Err(TryLockError::Poisoned(_)) => (json!({ "name": name, "status": "poisoned" }), false),
    }
}

/// Releases one reader's open transaction by dropping and reopening it.
fn recover_slot(
    name: &'static str,
    slot: &Slot,
    reopen: &dyn Fn() -> Result<Connection, String>,
) -> String {
    // Open the replacement before taking the slot: `reopen` locks the writer, and
    // a thread holding the writer may be waiting for this slot. Never nest the two.
    let replacement = match reopen() {
        Ok(conn) => conn,
        Err(error) => return format!("reopen_failed: {name}: {error}"),
    };
    let mut guard = match slot.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::WouldBlock) => return format!("locked: {name}"),
        Err(TryLockError::Poisoned(_)) => return format!("poisoned: {name}"),
    };
    let Some(conn) = guard.as_ref() else {
        return format!("none: {name}");
    };
    // A busy statement without an open transaction is not released by a
    // reopen: sqlite3_close refuses to close while it is pending, so the old
    // handle would leak. Only an open transaction is cleared by reopening.
    if conn.is_autocommit() {
        return format!("busy_statement_unreleasable: {name}");
    }
    drop(guard.take());
    *guard = Some(replacement);
    format!("recovered: {name}")
}

/// Reopens every idle reader in turn and checkpoints after each, so the log
/// names the reader whose reopen released frames. Readers in use (slot locked,
/// busy statement, open transaction) are left to the named recovery path.
fn reopen_idle_readers<C: Deref<Target = Connection>>(
    writer: &Mutex<C>,
    readers: &[(&'static str, &Slot)],
    reopen: &dyn Fn() -> Result<Connection, String>,
) -> (String, Option<Checkpoint>) {
    let mut parts = Vec::new();
    let mut last: Option<Checkpoint> = None;
    for (name, slot) in readers {
        let replacement = match reopen() {
            Ok(conn) => conn,
            Err(error) => {
                parts.push(format!("{name}=reopen_failed({error})"));
                continue;
            }
        };
        let outcome = {
            let mut guard = match slot.try_lock() {
                Ok(guard) => guard,
                Err(_) => {
                    parts.push(format!("{name}=locked"));
                    continue;
                }
            };
            match guard.as_ref() {
                None => {
                    parts.push(format!("{name}=none"));
                    continue;
                }
                Some(conn) if conn.is_busy() || !conn.is_autocommit() => {
                    parts.push(format!("{name}=in_use"));
                    continue;
                }
                Some(_) => {}
            }
            let old = guard.take();
            *guard = Some(replacement);
            // An explicit close reports a handle SQLite refused to release.
            old.map_or(Ok(()), |conn| {
                conn.close().map_err(|(_, error)| error.to_string())
            })
        };
        let before = last.or_else(|| checkpoint_locked(writer).ok());
        let after = checkpoint_locked(writer).ok();
        let released = match (before, after) {
            (Some(before), Some(after)) => after.checkpointed - before.checkpointed,
            _ => 0,
        };
        parts.push(match outcome {
            Ok(()) => format!("{name}=reopened(+{released})"),
            Err(error) => format!("{name}=close_failed(+{released},{error})"),
        });
        last = after;
    }
    (format!("reopened_idle_readers: {}", parts.join(" ")), last)
}

/// Replaces the writer connection when no reader release helped. Never closes
/// a connection with a pending statement or open transaction: `sqlite3_close`
/// would refuse and leak it. Returns the log part and the checkpoint after.
fn reopen_writer<C: Deref<Target = Connection> + ReopenWriter>(
    writer: &Mutex<C>,
    open_writer: &dyn Fn() -> Result<Connection, String>,
    before: Checkpoint,
) -> (String, Option<Checkpoint>) {
    // Open before taking the slot so the writer lock is held only for the swap.
    let replacement = match open_writer() {
        Ok(conn) => conn,
        Err(error) => return (format!("reopen_failed({error})"), None),
    };
    let old = {
        let mut guard = match writer.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => return ("locked".into(), None),
            Err(TryLockError::Poisoned(_)) => return ("poisoned".into(), None),
        };
        if guard.is_busy() || !guard.is_autocommit() {
            return ("in_use".into(), None);
        }
        match guard.swap_connection(replacement) {
            Ok(old) => old,
            Err(error) => return (format!("reopen_failed({error})"), None),
        }
    };
    let outcome = old.close().map_err(|(_, error)| error.to_string());
    let after = checkpoint_locked(writer).ok();
    let released = after.map_or(0, |after| after.checkpointed - before.checkpointed);
    let part = match outcome {
        Ok(()) => format!("reopened(+{released})"),
        Err(error) => format!("close_failed(+{released},{error})"),
    };
    (part, after)
}

/// Appends one line. When the file would exceed the cap, keeps the newest half.
fn append_capped(path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut bytes = fs::read(path).unwrap_or_default();
    bytes.extend_from_slice(line.as_bytes());
    bytes.push(b'\n');
    if bytes.len() > LOG_CAP_BYTES {
        let cut = bytes.len() - LOG_CAP_BYTES / 2;
        let start = bytes[cut..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |offset| cut + offset + 1);
        bytes.drain(..start);
    }
    fs::write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Writer(Connection);

    impl Deref for Writer {
        type Target = Connection;
        fn deref(&self) -> &Connection {
            &self.0
        }
    }

    impl ReopenWriter for Writer {
        fn swap_connection(&mut self, replacement: Connection) -> Result<Connection, String> {
            Ok(std::mem::replace(&mut self.0, replacement))
        }
    }

    fn open_writer(path: &Path) -> Result<Connection, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(WRITER_PRAGMAS)
            .map_err(|e| e.to_string())?;
        Ok(conn)
    }

    fn seeded_writer(path: &Path) -> Mutex<Writer> {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
             CREATE TABLE records(value); INSERT INTO records VALUES ('seed');",
        )
        .unwrap();
        Mutex::new(Writer(conn))
    }

    fn open_reader(path: &Path) -> Connection {
        Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
    }

    /// Adds about 1200 rows of 8 KB, roughly 3600 WAL frames, in one commit.
    fn grow_wal(writer: &Mutex<Writer>) {
        let guard = writer.lock().unwrap();
        guard
            .execute_batch(
                "BEGIN; WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 1200)
                 INSERT INTO records SELECT randomblob(8192) FROM n; COMMIT;",
            )
            .unwrap();
    }

    fn checkpoint_full(writer: &Mutex<Writer>) -> Checkpoint {
        checkpoint_locked(writer).unwrap()
    }

    fn logged_lines(dir: &Path) -> Vec<Value> {
        fs::read_to_string(dir.join(LOG_FILE))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// The production reader (`reader::open_reader` through `SessionStore::open`) must
    /// release its WAL snapshot after every read; a pinned snapshot stops checkpoints.
    #[test]
    fn real_store_reader_releases_wal_snapshot_after_each_read() {
        let dir = tempfile::tempdir().unwrap();
        let store = super::super::SessionStore::open(dir.path().join("bycoda.db")).unwrap();
        let grow = || {
            let conn = store.lock_conn().unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS records(value);
                 BEGIN; WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 400)
                 INSERT INTO records SELECT randomblob(8192) FROM n; COMMIT;",
            )
            .unwrap();
        };
        let checkpoint = || {
            let conn = store.lock_conn().unwrap();
            checkpoint_passive(&conn).unwrap()
        };
        grow();
        let count: i64 = store
            .with_read_conn(|conn| {
                conn.query_row("SELECT count(*) FROM records", [], |row| row.get(0))
                    .map_err(|e| e.to_string())
            })
            .unwrap();
        assert_eq!(count, 400);
        let _ = store.with_background_conn(|conn| {
            conn.query_row("SELECT count(*) FROM records", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())
        });
        grow();
        let after = checkpoint();
        assert_eq!(
            after.checkpointed, after.log_frames,
            "a reader still pins the WAL snapshot: {after:?}"
        );
    }

    #[test]
    fn stuck_reader_is_named_then_recovered_by_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let slot = Mutex::new(Some(open_reader(&path)));
        slot.lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .execute_batch("BEGIN; SELECT * FROM records;")
            .unwrap();
        grow_wal(&writer);
        let reopen = || Ok(open_reader(&path));
        let mut watch = Watch::default();
        let readers = [("read_conn", &slot)];

        // The first pass has no previous checkpoint to compare against.
        assert!(!tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));
        assert!(tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));

        let logged = logged_lines(dir.path());
        assert_eq!(logged.len(), 1);
        let line = &logged[0];
        assert_eq!(line["action"], "recovered: read_conn");
        assert_eq!(line["connections"][1]["name"], "read_conn");
        assert_eq!(line["connections"][1]["autocommit"], false);
        let lag = line["wal"]["logFrames"].as_i64().unwrap()
            - line["wal"]["checkpointed"].as_i64().unwrap();
        assert!(lag > STUCK_LAG_FRAMES, "lag {lag}");
        let after = checkpoint_full(&writer);
        assert_eq!(after.busy, 0);
        assert_eq!(after.log_frames, after.checkpointed);
        assert!(slot.lock().unwrap().as_ref().unwrap().is_autocommit());
    }

    /// When no owned reader shows an open transaction or a busy statement yet
    /// the WAL stays stuck, the idle readers are reopened one by one and the
    /// log records how many frames each reopen released. A snapshot the
    /// watchdog does not own releases nothing, and the pass then waits for
    /// the backfill to move before reopening again.
    #[test]
    fn idle_readers_are_reopened_once_per_stuck_position_and_named() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let read = Mutex::new(Some(open_reader(&path)));
        let list = Mutex::new(Some(open_reader(&path)));
        let foreign = open_reader(&path);
        foreign
            .execute_batch("BEGIN; SELECT count(*) FROM records;")
            .unwrap();
        grow_wal(&writer);
        let reopened = std::cell::Cell::new(0);
        let reopen = || {
            reopened.set(reopened.get() + 1);
            Ok(open_reader(&path))
        };
        let mut watch = Watch::default();
        let readers = [("read_conn", &read), ("list_conn", &list)];
        assert!(!tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));
        assert!(tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));
        assert!(tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));

        let logged = logged_lines(dir.path());
        assert_eq!(logged.len(), 2);
        assert_eq!(
            logged[0]["action"],
            "reopened_idle_readers: read_conn=reopened(+0) list_conn=reopened(+0) writer=reopened(+0)"
        );
        assert_eq!(logged[0]["connections"][1]["txn"], "none");
        assert_eq!(logged[1]["action"], "no_owned_reader_holds_snapshot");
        assert_eq!(reopened.get(), 2);
        assert!(read.lock().unwrap().is_some() && list.lock().unwrap().is_some());

        // Once the foreign snapshot goes and the backfill moves, a new stuck
        // position allows another idle pass.
        drop(foreign);
        assert!(!tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));
        let fresh = open_reader(&path);
        fresh
            .execute_batch("BEGIN; SELECT count(*) FROM records;")
            .unwrap();
        grow_wal(&writer);
        assert!(tick(
            &writer,
            &readers,
            &mut watch,
            &reopen,
            &|| open_writer(&path),
            dir.path()
        ));
        assert_eq!(reopened.get(), 4);
        drop(fresh);

        // The replacement writer connection still writes and checkpoints.
        writer
            .lock()
            .unwrap()
            .execute("INSERT INTO records VALUES ('after')", [])
            .unwrap();
        let after = checkpoint_full(&writer);
        assert_eq!(after.busy, 0);
        assert_eq!(after.log_frames, after.checkpointed);
    }

    /// Bisects the startup writer-side work: after each step the writer adds frames
    /// and checkpoints; a step that leaves frames unbackfilled pins the WAL.
    #[test]
    fn writer_side_startup_work_releases_wal_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let store = super::super::SessionStore::open(dir.path().join("bycoda.db")).unwrap();
        {
            let conn = store.lock_conn().unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS records(value)")
                .unwrap();
            for i in 0..40 {
                let blocks = serde_json::json!([
                    {"id": format!("u{i}"), "role": "user", "text": format!("hello world {i}")},
                    {"id": format!("a{i}"), "role": "assistant", "text": "answer text"}
                ]);
                conn.execute(
                    "INSERT OR REPLACE INTO sessions
                       (id, cwd, harness, model, runtime_mode, title, blocks_json,
                        created_at, updated_at, has_user_message)
                     VALUES (?1, 'C:/p', 'claude', 'm', 'supervised', ?2, ?3, 1, ?4, 1)",
                    rusqlite::params![
                        format!("s{i}"),
                        format!("t{i}"),
                        blocks.to_string(),
                        1000 + i
                    ],
                )
                .unwrap();
            }
        }
        let lag = |label: &str| {
            {
                let conn = store.lock_conn().unwrap();
                conn.execute_batch(
                    "BEGIN; WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 300)
                     INSERT INTO records SELECT randomblob(8192) FROM n; COMMIT;",
                )
                .unwrap();
            }
            let conn = store.lock_conn().unwrap();
            let after = checkpoint_passive(&conn).unwrap();
            eprintln!(
                "step {label}: log={} ckpt={}",
                after.log_frames, after.checkpointed
            );
            after.log_frames - after.checkpointed
        };
        let mut pinned = Vec::new();
        if lag("open+seed") > 0 {
            pinned.push("open+seed");
        }
        let _ = store.session_ids().unwrap();
        if lag("session_ids") > 0 {
            pinned.push("session_ids");
        }
        super::super::content_search::index_in_background(&store);
        if lag("search_index") > 0 {
            pinned.push("search_index");
        }
        let _ = super::super::legacy_blob::compact(&store, std::time::Duration::ZERO);
        if lag("legacy_blob_compact") > 0 {
            pinned.push("legacy_blob_compact");
        }
        super::super::content_search::index_in_background(&store);
        if lag("search_index_again") > 0 {
            pinned.push("search_index_again");
        }
        assert!(pinned.is_empty(), "steps that pinned the WAL: {pinned:?}");
    }

    /// An open incremental BLOB handle keeps a read transaction; the probe must see it.
    #[test]
    fn open_blob_handle_is_visible_to_the_probe() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let reader = open_reader(&path);
        let blob = reader
            .blob_open(rusqlite::MAIN_DB, "records", "value", 1, true)
            .unwrap();
        let (probe, needs_recovery) = probe_conn("read_conn", &reader);
        eprintln!("blob probe: {probe}");
        grow_wal(&writer);
        let after = checkpoint_full(&writer);
        eprintln!(
            "blob checkpoint: log={} ckpt={}",
            after.log_frames, after.checkpointed
        );
        drop(blob);
        assert!(needs_recovery, "{probe}");
    }

    #[test]
    fn busy_statement_is_reported_and_never_reopened() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let slot = Mutex::new(Some(open_reader(&path)));
        {
            // The statement lives while the slot is held, so the watchdog's
            // try_lock sees "locked" and the statement is finalized on exit.
            let guard = slot.lock().unwrap();
            let conn = guard.as_ref().unwrap();
            let mut statement = conn.prepare("SELECT value FROM records").unwrap();
            let mut rows = statement.query([]).unwrap();
            assert!(rows.next().unwrap().is_some());
            let (probe, needs_recovery) = probe_conn("read_conn", conn);
            assert_eq!(probe["busy"], true);
            assert_eq!(probe["autocommit"], true);
            assert!(needs_recovery);
            grow_wal(&writer);
            // The replacement is opened before the slot is taken; a locked or
            // unreleasable slot simply drops it again.
            let reopen = || -> Result<Connection, String> { Ok(open_reader(&path)) };
            assert_eq!(
                recover_slot("read_conn", &slot, &reopen),
                "locked: read_conn"
            );
        }
        let reopen = || -> Result<Connection, String> { Ok(open_reader(&path)) };
        assert_eq!(
            recover_slot("read_conn", &slot, &reopen),
            "busy_statement_unreleasable: read_conn"
        );
        assert!(slot.lock().unwrap().is_some());
    }

    #[test]
    fn locked_writer_is_reported_and_not_touched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let before = checkpoint_full(&writer);
        let guard = writer.lock().unwrap();
        let (part, after) = reopen_writer(&writer, &|| open_writer(&path), before);
        assert_eq!((part.as_str(), after), ("locked", None));
        drop(guard);
        let (part, after) = reopen_writer(&writer, &|| open_writer(&path), before);
        assert_eq!(part, "reopened(+0)");
        assert!(after.is_some());
    }

    #[test]
    fn writer_with_open_transaction_is_in_use() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let before = checkpoint_full(&writer);
        writer.lock().unwrap().execute_batch("BEGIN").unwrap();
        let (part, after) = reopen_writer(&writer, &|| open_writer(&path), before);
        assert_eq!((part.as_str(), after), ("in_use", None));
    }

    #[test]
    fn healthy_ticks_write_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bycoda.db");
        let writer = seeded_writer(&path);
        let slot = Mutex::new(Some(open_reader(&path)));
        let reopen = || Ok(open_reader(&path));
        let mut watch = Watch::default();
        grow_wal(&writer);
        // No snapshot is held, so every pass backfills and the lag never persists.
        for _ in 0..3 {
            assert!(!tick(
                &writer,
                &[("read_conn", &slot)],
                &mut watch,
                &reopen,
                &|| open_writer(&path),
                dir.path()
            ));
        }
        assert!(!dir.path().join(LOG_FILE).exists());
    }

    #[test]
    fn log_is_capped_and_keeps_whole_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(LOG_FILE);
        let filler = "x".repeat(1000);
        let mut last = String::new();
        for index in 0..400 {
            last = format!("{index:04}-{filler}");
            append_capped(&path, &last).unwrap();
        }
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.len() <= LOG_CAP_BYTES);
        assert!(contents.ends_with('\n'));
        let kept: Vec<&str> = contents.lines().collect();
        assert_eq!(kept.last().copied(), Some(last.as_str()));
        assert!(kept.iter().all(|line| line.len() == last.len()));
    }
}
