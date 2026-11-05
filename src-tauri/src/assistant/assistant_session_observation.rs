//! Native session metadata outbox. The publisher must hold the actual Native
//! project privacy permit and bind its installation identity before disclosure.
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_EVENTS: i64 = 10_000;

/// Install inside the SessionStore migration transaction, before writers start.
pub(crate) fn install(conn: &Connection) -> rusqlite::Result<()> {
    let mut query = conn.prepare("SELECT name FROM pragma_table_info('sessions')")?;
    let fields: std::collections::HashSet<String> = query
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let watched = [
        "id",
        "cwd",
        "title",
        "harness",
        "model",
        "runtime_mode",
        "archived",
        "pinned",
        "is_draft",
        "branch",
        "worktree_cwd",
        "worktree_removed",
        "workspace_id",
        "workspace_revision",
        "workspace_mode",
        "automation_id",
        "linked_work_item_json",
        "provider_session_id",
    ];
    let update_when = watched
        .iter()
        .filter(|name| fields.contains(**name))
        .map(|name| format!("OLD.{name} IS NOT NEW.{name}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    if update_when.is_empty() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    conn.execute_batch("DROP TRIGGER IF EXISTS assistant_native_session_update")?;
    conn.execute_batch(&format!(r#"
      CREATE TABLE IF NOT EXISTS assistant_native_session_revision (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO assistant_native_session_revision SELECT id,0 FROM sessions;
      CREATE TABLE IF NOT EXISTS assistant_native_session_floor (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL);
      INSERT OR IGNORE INTO assistant_native_session_floor VALUES(1,0);
      CREATE TABLE IF NOT EXISTS assistant_native_session_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, revision INTEGER NOT NULL, change TEXT NOT NULL, timestamp INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS assistant_native_session_scope ON assistant_native_session_outbox(cwd,sequence);
      CREATE TABLE IF NOT EXISTS assistant_native_session_publish_cursors(host_id TEXT NOT NULL, cwd TEXT NOT NULL, cursor INTEGER NOT NULL, PRIMARY KEY(host_id,cwd));
      CREATE TABLE IF NOT EXISTS assistant_native_session_coverage(host_id TEXT NOT NULL, cwd TEXT NOT NULL, PRIMARY KEY(host_id,cwd));
      CREATE TABLE IF NOT EXISTS assistant_native_session_completions_v2(request_id TEXT PRIMARY KEY,operation_hash TEXT NOT NULL,host_id TEXT NOT NULL,cwd TEXT NOT NULL,fingerprint TEXT NOT NULL,watermark INTEGER NOT NULL,status TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS assistant_native_session_bound AFTER INSERT ON assistant_native_session_outbox BEGIN
        UPDATE assistant_native_session_floor SET sequence=MAX(sequence,NEW.sequence-{MAX_EVENTS}) WHERE id=1;
        DELETE FROM assistant_native_session_outbox WHERE sequence <= (SELECT sequence FROM assistant_native_session_floor WHERE id=1);
      END;
      CREATE TRIGGER IF NOT EXISTS assistant_native_session_insert AFTER INSERT ON sessions BEGIN
        INSERT INTO assistant_native_session_revision VALUES(NEW.id,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1;
        INSERT INTO assistant_native_session_outbox(session_id,cwd,revision,change,timestamp) VALUES(NEW.id,NEW.cwd,(SELECT revision FROM assistant_native_session_revision WHERE id=NEW.id),'upsert',CAST(strftime('%s','now') AS INTEGER)*1000);
      END;
      CREATE TRIGGER IF NOT EXISTS assistant_native_session_update AFTER UPDATE ON sessions WHEN {update_when} BEGIN
        INSERT INTO assistant_native_session_revision VALUES(OLD.id,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1;
        INSERT INTO assistant_native_session_outbox(session_id,cwd,revision,change,timestamp)
          SELECT OLD.id,OLD.cwd,(SELECT revision FROM assistant_native_session_revision WHERE id=OLD.id),'scopeRemoved',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE OLD.id IS NOT NEW.id OR OLD.cwd IS NOT NEW.cwd;
        INSERT INTO assistant_native_session_revision SELECT NEW.id,1 WHERE OLD.id IS NOT NEW.id OR OLD.cwd IS NOT NEW.cwd ON CONFLICT(id) DO UPDATE SET revision=revision+1;
        INSERT INTO assistant_native_session_outbox(session_id,cwd,revision,change,timestamp) VALUES(NEW.id,NEW.cwd,(SELECT revision FROM assistant_native_session_revision WHERE id=NEW.id),'upsert',CAST(strftime('%s','now') AS INTEGER)*1000);
      END;
      CREATE TRIGGER IF NOT EXISTS assistant_native_session_delete AFTER DELETE ON sessions BEGIN
        INSERT INTO assistant_native_session_revision VALUES(OLD.id,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1;
        INSERT INTO assistant_native_session_outbox(session_id,cwd,revision,change,timestamp) VALUES(OLD.id,OLD.cwd,(SELECT revision FROM assistant_native_session_revision WHERE id=OLD.id),'deleted',CAST(strftime('%s','now') AS INTEGER)*1000);
      END;
    "#))
}

pub(crate) fn publisher_cursor(conn: &Connection, host: &str, cwd: &str) -> rusqlite::Result<i64> {
    scope(cwd)?;
    conn.query_row(
        "SELECT cursor FROM assistant_native_session_publish_cursors WHERE host_id=? AND cwd=?",
        params![host, cwd],
        |row| row.get(0),
    )
    .or_else(|error| {
        if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
            Ok(0)
        } else {
            Err(error)
        }
    })
}
pub(crate) fn source_gap(conn: &Connection, host: &str, cwd: &str) -> rusqlite::Result<bool> {
    let covered: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM assistant_native_session_coverage WHERE host_id=? AND cwd=?)",
        params![host, cwd],
        |row| row.get(0),
    )?;
    let (floor, _) = bounds(conn)?;
    Ok(covered == 0 || publisher_cursor(conn, host, cwd)? < floor)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionBaselinePage {
    pub fingerprint: String,
    pub offset: usize,
    pub next_offset: usize,
    pub total: usize,
    pub watermark: i64,
    pub source_gap: bool,
    pub entries: Vec<SessionBaselineEntry>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionBaselineEntry {
    pub source_id: String,
    pub revision: i64,
}
pub(crate) fn baseline_page(
    conn: &Connection,
    host: &str,
    cwd: &str,
    offset: usize,
    expected: Option<&str>,
) -> Result<SessionBaselinePage, String> {
    let base = baseline(conn, cwd).map_err(|e| e.to_string())?;
    if !base.complete {
        return Err("Native session baseline exceeds 2048 rows".into());
    }
    let gap = source_gap(conn, host, cwd).map_err(|e| e.to_string())?;
    let entries: Vec<_> = base
        .entries
        .into_iter()
        .map(|item| SessionBaselineEntry {
            source_id: item.session_id,
            revision: item.revision,
        })
        .collect();
    let encoded =
        serde_json::to_vec(&(host, cwd, entries.as_slice(), base.floor, base.cursor, gap))
            .map_err(|_| "Invalid Native session baseline")?;
    if encoded.len() > 524288 {
        return Err("Native session baseline exceeds 512 KiB".into());
    }
    let fingerprint = format!("{:x}", Sha256::digest(encoded));
    if expected.is_some_and(|v| v != fingerprint) || offset > entries.len() {
        return Err("Native session baseline changed".into());
    }
    let total = entries.len();
    let next_offset = (offset + 8).min(total);
    Ok(SessionBaselinePage {
        fingerprint,
        offset,
        next_offset,
        total,
        watermark: base.cursor,
        source_gap: gap,
        entries: entries
            .into_iter()
            .skip(offset)
            .take(next_offset - offset)
            .collect(),
    })
}
pub(crate) fn complete_baseline_once(
    conn: &Connection,
    host: &str,
    cwd: &str,
    fingerprint: &str,
    watermark: i64,
    request_id: &str,
    operation_hash: &str,
) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    let old=conn.query_row("SELECT operation_hash,host_id,cwd,fingerprint,watermark,status FROM assistant_native_session_completions_v2 WHERE request_id=?",[request_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?))).optional().map_err(|e|e.to_string())?;
    if let Some((hash, old_host, path, old_fingerprint, old_watermark, status)) = old {
        if hash != operation_hash
            || old_host != host
            || path != cwd
            || old_fingerprint != fingerprint
            || old_watermark != watermark
        {
            return Err("Native session completion identity changed".into());
        }
        return if status == "completed" {
            Ok(())
        } else {
            Err("Native session completion outcome is unknown".into())
        };
    }
    conn.execute(
        "INSERT INTO assistant_native_session_completions_v2 VALUES(?,?,?,?,?,?,'pending')",
        params![
            request_id,
            operation_hash,
            host,
            cwd,
            fingerprint,
            watermark
        ],
    )
    .map_err(|e| e.to_string())?;
    let current = baseline_page(conn, host, cwd, 0, Some(fingerprint))?;
    if current.watermark != watermark {
        return Err("Native session baseline changed".into());
    }
    conn.execute_batch("SAVEPOINT native_session_complete")
        .map_err(|e| e.to_string())?;
    let result = (|| -> rusqlite::Result<()> {
        conn.execute("INSERT INTO assistant_native_session_publish_cursors VALUES(?,?,?) ON CONFLICT(host_id,cwd) DO UPDATE SET cursor=excluded.cursor",params![host,cwd,watermark])?;
        conn.execute(
            "INSERT OR IGNORE INTO assistant_native_session_coverage VALUES(?,?)",
            params![host, cwd],
        )?;
        conn.execute("UPDATE assistant_native_session_completions_v2 SET status='completed' WHERE request_id=? AND status='pending'",[request_id])?;
        Ok(())
    })();
    match result {
        Ok(()) => conn
            .execute_batch("RELEASE native_session_complete")
            .map_err(|e| e.to_string()),
        Err(e) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO native_session_complete; RELEASE native_session_complete",
            );
            Err(e.to_string())
        }
    }
}
pub(crate) fn commit_publisher_cursor(
    conn: &Connection,
    host: &str,
    cwd: &str,
    before: i64,
    after: i64,
) -> rusqlite::Result<()> {
    scope(cwd)?;
    if after < before || publisher_cursor(conn, host, cwd)? != before {
        return Err(rusqlite::Error::InvalidQuery);
    }
    conn.execute("INSERT INTO assistant_native_session_publish_cursors VALUES(?,?,?) ON CONFLICT(host_id,cwd) DO UPDATE SET cursor=excluded.cursor WHERE cursor=?", params![host,cwd,after,before])?;
    Ok(())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionRevision {
    pub session_id: String,
    pub revision: i64,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionEvent {
    pub sequence: i64,
    pub session_id: String,
    pub source_cwd: String,
    pub revision: i64,
    pub change: String,
    pub timestamp: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionBaseline {
    pub entries: Vec<NativeSessionRevision>,
    pub floor: i64,
    pub cursor: i64,
    pub complete: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionPage {
    pub entries: Vec<NativeSessionEvent>,
    pub floor: i64,
    pub next_cursor: i64,
    pub gap: bool,
}

fn scope(cwd: &str) -> rusqlite::Result<()> {
    if cwd.is_empty() || cwd.len() > 4096 || cwd.contains('\0') {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
fn bounds(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row("SELECT sequence,MAX(sequence,COALESCE((SELECT MAX(sequence) FROM assistant_native_session_outbox),0)) FROM assistant_native_session_floor WHERE id=1", [], |r| Ok((r.get(0)?,r.get(1)?)))
}
/// Snapshot and high-water cursor share one SQLite read transaction.
pub(crate) fn baseline(conn: &Connection, cwd: &str) -> rusqlite::Result<NativeSessionBaseline> {
    scope(cwd)?;
    let tx = conn.unchecked_transaction()?;
    let (floor, cursor) = bounds(&tx)?;
    let entries = {
        let mut query = tx.prepare("SELECT s.id,r.revision FROM sessions s JOIN assistant_native_session_revision r ON r.id=s.id WHERE s.cwd=?1 ORDER BY s.id LIMIT 2049")?;
        let rows = query.query_map([cwd], |r| {
            Ok(NativeSessionRevision {
                session_id: r.get(0)?,
                revision: r.get(1)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    tx.commit()?;
    if entries.len() > 2048 {
        return Ok(NativeSessionBaseline {
            entries: vec![],
            floor,
            cursor,
            complete: false,
        });
    }
    Ok(NativeSessionBaseline {
        entries,
        floor,
        cursor,
        complete: true,
    })
}
/// Gap requires a new baseline; empty pages advance only to a captured high-water mark.
pub(crate) fn page(
    conn: &Connection,
    cwd: &str,
    after: i64,
    limit: usize,
) -> rusqlite::Result<NativeSessionPage> {
    scope(cwd)?;
    if after < 0 || limit == 0 || limit > 100 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let tx = conn.unchecked_transaction()?;
    let (floor, high) = bounds(&tx)?;
    if after < floor || after > high {
        tx.commit()?;
        return Ok(NativeSessionPage {
            entries: vec![],
            floor,
            next_cursor: after,
            gap: true,
        });
    }
    let mut entries = {
        let mut query = tx.prepare("SELECT sequence,session_id,cwd,revision,change,timestamp FROM assistant_native_session_outbox WHERE cwd=?1 AND sequence>?2 AND sequence<=?3 ORDER BY sequence LIMIT ?4")?;
        let rows = query.query_map(params![cwd, after, high, (limit + 1) as i64], |r| {
            Ok(NativeSessionEvent {
                sequence: r.get(0)?,
                session_id: r.get(1)?,
                source_cwd: r.get(2)?,
                revision: r.get(3)?,
                change: r.get(4)?,
                timestamp: r.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let next_cursor = if entries.len() > limit {
        entries.truncate(limit);
        entries.last().unwrap().sequence
    } else {
        high
    };
    tx.commit()?;
    Ok(NativeSessionPage {
        entries,
        floor,
        next_cursor,
        gap: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_baseline_is_project_and_host_bound_and_exact_retry_is_safe() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,title TEXT NOT NULL)",
        )
        .unwrap();
        install(&db).unwrap();
        db.execute("INSERT INTO sessions VALUES('one','/a','secret title')", [])
            .unwrap();
        assert!(source_gap(&db, "host-a", "/a").unwrap());
        let page = baseline_page(&db, "host-a", "/a", 0, None).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert!(!serde_json::to_string(&page)
            .unwrap()
            .contains("secret title"));
        complete_baseline_once(
            &db,
            "host-a",
            "/a",
            &page.fingerprint,
            page.watermark,
            "request",
            "hash",
        )
        .unwrap();
        assert!(!source_gap(&db, "host-a", "/a").unwrap());
        assert!(source_gap(&db, "host-b", "/a").unwrap());
        assert!(source_gap(&db, "host-a", "/b").unwrap());
        complete_baseline_once(
            &db,
            "host-a",
            "/a",
            &page.fingerprint,
            page.watermark,
            "request",
            "hash",
        )
        .unwrap();
        assert!(complete_baseline_once(
            &db,
            "host-a",
            "/a",
            &page.fingerprint,
            page.watermark,
            "request",
            "changed"
        )
        .is_err());
    }
    #[test]
    fn transactional_metadata_scope_revisions_and_retention() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,secret TEXT NOT NULL,title TEXT NOT NULL DEFAULT 'title',blocks_json TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0);",
        )
        .unwrap();
        install(&db).unwrap();
        db.execute_batch(
            "BEGIN; INSERT INTO sessions(id,cwd,secret) VALUES('rolled','/a','secret'); ROLLBACK;",
        )
        .unwrap();
        assert!(page(&db, "/a", 0, 10).unwrap().entries.is_empty());
        db.execute(
            "INSERT INTO sessions(id,cwd,secret) VALUES('one','/a','secret')",
            [],
        )
        .unwrap();
        let initial = baseline(&db, "/a").unwrap();
        assert_eq!(initial.entries[0].revision, 1);
        db.execute(
            "UPDATE sessions SET cwd='/b',secret='new secret' WHERE id='one'",
            [],
        )
        .unwrap();
        assert_eq!(
            page(&db, "/a", initial.cursor, 10).unwrap().entries[0].change,
            "scopeRemoved"
        );
        assert_eq!(
            page(&db, "/b", initial.cursor, 10).unwrap().entries[0].revision,
            3
        );
        db.execute("DELETE FROM sessions WHERE id='one'", [])
            .unwrap();
        db.execute(
            "INSERT INTO sessions(id,cwd,secret) VALUES('one','/b','secret')",
            [],
        )
        .unwrap();
        assert_eq!(baseline(&db, "/b").unwrap().entries[0].revision, 5);
        assert!(!serde_json::to_string(&page(&db, "/b", 0, 10).unwrap())
            .unwrap()
            .contains("secret"));
        let prior = baseline(&db, "/b").unwrap().cursor;
        for _ in 0..200 {
            db.execute(
                "UPDATE sessions SET secret=secret || 'x',blocks_json=blocks_json || 'x',updated_at=updated_at+1 WHERE id='one'",
                [],
            )
            .unwrap();
        }
        assert_eq!(baseline(&db, "/b").unwrap().cursor, prior);
        for index in 0..=MAX_EVENTS {
            db.execute(
                "UPDATE sessions SET title=? WHERE id='one'",
                [index.to_string()],
            )
            .unwrap();
        }
        assert!(page(&db, "/b", 0, 10).unwrap().gap);
        assert!(baseline(&db, "/a").unwrap().entries.is_empty());
    }
}
