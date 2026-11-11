//! Returns free pages of the session database to the file system.
//!
//! SQLite reuses free pages but never gives them back, so one large deletion
//! (the retired legacy transcript copies, removed sessions) left most of the
//! file empty for good.
//!
//! A database created before this module has `auto_vacuum=NONE`; only a
//! `VACUUM` can change that. So a mostly free file is rewritten once, which
//! also switches it to `auto_vacuum=INCREMENTAL`. That rewrite holds the writer
//! for seconds, so it waits for a minute without writes; readers keep working
//! on their WAL snapshots. From then on free pages are released a few megabytes
//! at a time (`PRAGMA incremental_vacuum`), each step a short write.
//!
//! Row ids that are persisted (delivery cursors, the notes index) belong to
//! tables with a primary key index, which `VACUUM` copies unchanged.
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use super::SessionStore;

const START_DELAY: Duration = Duration::from_secs(10 * 60);
/// How often the free page count is looked at.
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);
/// Pace while a rewrite is due and waits for a minute without writes.
const TICK: Duration = Duration::from_secs(60);
/// Free share above which a file without incremental auto-vacuum is rewritten.
const MIN_FREE_RATIO: f64 = 0.25;
/// `PRAGMA auto_vacuum` value of the incremental mode.
const INCREMENTAL: i64 = 2;
/// Pages one incremental step releases (8 MiB at the 4 KiB page size).
const STEP_PAGES: i64 = 2048;
/// Free pages left in the file for later writes to reuse.
const KEEP_FREE_PAGES: i64 = 4096;
/// A due rewrite that never sees a quiet tick runs anyway after this long.
const QUIET_WAIT: Duration = Duration::from_secs(60 * 60);
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Default)]
pub(super) struct Watch {
    /// When the file was first seen mostly free.
    due_since: Option<Instant>,
    /// Writer change counter at the previous tick.
    changes: Option<i64>,
    retry_at: Option<Instant>,
}

fn number(conn: &Connection, sql: &str) -> Result<i64, String> {
    conn.query_row(sql, [], |row| row.get(0))
        .map_err(|error| error.to_string())
}

/// `(auto_vacuum mode, pages, free pages)`.
fn layout(conn: &Connection) -> Result<(i64, i64, i64), String> {
    Ok((
        number(conn, "PRAGMA auto_vacuum")?,
        number(conn, "PRAGMA page_count")?,
        number(conn, "PRAGMA freelist_count")?,
    ))
}

/// Releases up to `pages` free pages. The pragma frees one page per step.
fn release(conn: &Connection, pages: i64) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA incremental_vacuum({pages})"))
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    while rows.next().map_err(|error| error.to_string())?.is_some() {}
    Ok(())
}

/// Rewrites the file and returns its size in bytes before and after.
fn vacuum(conn: &Connection) -> Result<(i64, i64), String> {
    let page_size = number(conn, "PRAGMA page_size")?;
    let before = number(conn, "PRAGMA page_count")?;
    conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL; VACUUM")
        .map_err(|error| error.to_string())?;
    // The rewrite went through the WAL; the file shrinks once it is checkpointed.
    // A reader may still pin it: the watchdog's passive checkpoints finish later.
    let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    Ok((
        before * page_size,
        number(conn, "PRAGMA page_count")? * page_size,
    ))
}

/// One pass: an incremental step, or the one-time rewrite. Returns the outcome
/// when it attempted the rewrite.
pub(super) fn tick(
    store: &SessionStore,
    watch: &mut Watch,
    now: Instant,
) -> Option<Result<(i64, i64), String>> {
    if watch.retry_at.is_some_and(|at| now < at) {
        return None;
    }
    let (mode, pages, free) = store.with_background_conn(layout).ok()?;
    if mode == INCREMENTAL {
        let spare = free - KEEP_FREE_PAGES;
        *watch = Watch::default();
        if spare <= 0 {
            return None;
        }
        let admission = store.process_write_admission().ok()?;
        let released =
            admission.finish((|| release(&*store.lock_conn()?, spare.min(STEP_PAGES)))());
        match released {
            // More to release: keep the minute pace.
            Ok(()) if spare > STEP_PAGES => watch.due_since = Some(now),
            Ok(()) => {}
            Err(error) => {
                log::warn!("session database incremental vacuum: {error}");
                watch.retry_at = Some(now + RETRY_AFTER_FAILURE);
            }
        }
        return None;
    }
    if pages <= 0 || free as f64 / pages as f64 <= MIN_FREE_RATIO {
        *watch = Watch::default();
        return None;
    }
    let changes = store
        .lock_conn()
        .and_then(|conn| number(&conn, "SELECT total_changes()"))
        .ok()?;
    let quiet = watch.changes.replace(changes) == Some(changes);
    let since = *watch.due_since.get_or_insert(now);
    if !quiet && now.duration_since(since) < QUIET_WAIT {
        return None;
    }
    let admission = store.process_write_admission().ok()?;
    let result = admission.finish((|| vacuum(&*store.lock_conn()?))());
    *watch = Watch::default();
    if result.is_err() {
        watch.retry_at = Some(now + RETRY_AFTER_FAILURE);
    }
    Some(result)
}

/// Hourly while there is nothing to do, every minute while work is pending.
fn next_delay(watch: &Watch) -> Duration {
    if watch.due_since.is_some() {
        TICK
    } else {
        CHECK_EVERY
    }
}

/// Starts the pass off the startup path. Failure only leaves the file large.
pub(super) fn start(app: &AppHandle) {
    if crate::package_smoke::active() {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("session-db-compaction".into())
        .spawn(move || {
            std::thread::sleep(START_DELAY);
            let mut watch = Watch::default();
            loop {
                let Some(store) = app.try_state::<SessionStore>() else {
                    return;
                };
                match tick(&store, &mut watch, Instant::now()) {
                    Some(Ok((before, after))) => {
                        log::info!("session database VACUUM: {before} -> {after} bytes");
                    }
                    Some(Err(error)) => log::warn!("session database VACUUM: {error}"),
                    None => {}
                }
                std::thread::sleep(next_delay(&watch));
            }
        });
    if let Err(error) = spawned {
        log::warn!("session database compaction thread: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A store whose file is mostly free pages.
    fn fill_and_free(store: &SessionStore, bytes: i64) {
        store
            .lock_conn()
            .unwrap()
            .execute_batch(&format!(
                "CREATE TABLE filler (b BLOB); INSERT INTO filler VALUES (zeroblob({bytes}));
                 DROP TABLE filler;"
            ))
            .unwrap();
    }

    fn free_pages(store: &SessionStore) -> i64 {
        layout(&store.lock_conn().unwrap()).unwrap().2
    }

    fn mostly_free_store() -> SessionStore {
        let store = SessionStore::open_in_memory().unwrap();
        fill_and_free(&store, 8_000_000);
        let (mode, pages, free) = layout(&store.lock_conn().unwrap()).unwrap();
        assert!(mode != INCREMENTAL && free * 4 > pages);
        store
    }

    fn write(store: &SessionStore) {
        store
            .lock_conn()
            .unwrap()
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS activity (n INTEGER); INSERT INTO activity VALUES (1);",
            )
            .unwrap();
    }

    #[test]
    fn rewrites_a_mostly_free_file_on_the_first_quiet_tick() {
        let store = mostly_free_store();
        let mut watch = Watch::default();
        let start = Instant::now();
        assert_eq!(next_delay(&watch), CHECK_EVERY);
        // The first tick only records the writer's change counter.
        assert!(tick(&store, &mut watch, start).is_none());
        assert_eq!(next_delay(&watch), TICK);
        write(&store);
        assert!(tick(&store, &mut watch, start + TICK).is_none());
        let (before, after) = tick(&store, &mut watch, start + TICK * 2).unwrap().unwrap();
        assert!(after < before / 2, "{before} -> {after}");
        assert_eq!(layout(&store.lock_conn().unwrap()).unwrap().0, INCREMENTAL);
        assert_eq!(free_pages(&store), 0);
        assert_eq!(next_delay(&watch), CHECK_EVERY);
        // Nothing free any more: later ticks leave the file alone.
        assert!(tick(&store, &mut watch, start + TICK * 3).is_none());
        assert_eq!(next_delay(&watch), CHECK_EVERY);
    }

    #[test]
    fn releases_later_free_pages_in_small_steps_without_another_rewrite() {
        let store = mostly_free_store();
        let mut watch = Watch::default();
        let start = Instant::now();
        assert!(tick(&store, &mut watch, start).is_none());
        assert!(tick(&store, &mut watch, start + TICK).unwrap().is_ok());
        fill_and_free(&store, 40_000_000);
        // A busy writer does not delay a step: it is a short write.
        write(&store);
        let free = free_pages(&store);
        assert!(free > KEEP_FREE_PAGES + STEP_PAGES * 2, "{free}");
        assert!(tick(&store, &mut watch, start + TICK * 2).is_none());
        assert_eq!(free_pages(&store), free - STEP_PAGES);
        assert_eq!(next_delay(&watch), TICK);
        for step in 3..8 {
            assert!(tick(&store, &mut watch, start + TICK * step).is_none());
        }
        // The reserve stays for later writes; the pace returns to hourly.
        assert_eq!(free_pages(&store), KEEP_FREE_PAGES);
        assert_eq!(next_delay(&watch), CHECK_EVERY);
    }

    #[test]
    fn a_writer_that_never_goes_quiet_delays_the_rewrite_only_for_the_wait() {
        let store = mostly_free_store();
        let mut watch = Watch::default();
        let start = Instant::now();
        assert!(tick(&store, &mut watch, start).is_none());
        write(&store);
        assert!(tick(&store, &mut watch, start + QUIET_WAIT - TICK).is_none());
        write(&store);
        assert!(tick(&store, &mut watch, start + QUIET_WAIT)
            .unwrap()
            .is_ok());
    }

    #[test]
    fn a_failed_rewrite_is_not_retried_for_a_day() {
        let store = mostly_free_store();
        let mut watch = Watch::default();
        let start = Instant::now();
        assert!(tick(&store, &mut watch, start).is_none());
        // VACUUM refuses to run inside a transaction.
        store.lock_conn().unwrap().execute_batch("BEGIN").unwrap();
        assert!(tick(&store, &mut watch, start + TICK).unwrap().is_err());
        store
            .lock_conn()
            .unwrap()
            .execute_batch("ROLLBACK")
            .unwrap();
        assert!(tick(&store, &mut watch, start + TICK * 2).is_none());
        assert_eq!(next_delay(&watch), CHECK_EVERY);
        assert!(tick(&store, &mut watch, start + TICK * 3).is_none());
        let later = start + RETRY_AFTER_FAILURE + TICK;
        assert!(tick(&store, &mut watch, later).is_none());
        assert!(tick(&store, &mut watch, later + TICK).unwrap().is_ok());
    }
}
