//! Durable metadata emitted in the same SQLite transaction as Native Notes.
//! Callers must bind a batch to the live native admission and source scope before
//! sending it; this storage layer itself grants no read or delivery authority.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteObservation {
    pub sequence: i64,
    pub source_id: String,
    pub revision: i64,
    pub change: String,
    pub source_cwd: Option<String>,
    pub occurred_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteBaselineEntry {
    pub source_id: String,
    // Zero identifies a row that predates installation of the outbox.
    pub revision: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalNoteBaseline {
    pub fingerprint: String,
    pub offset: usize,
    pub next_offset: usize,
    pub total: usize,
    pub watermark: i64,
    pub source_gap: bool,
    pub entries: Vec<NoteBaselineEntry>,
}

/// Recomputes the complete bounded source before each page. The caller signs
/// this result against the actual Native installation, Host and current capture;
/// it is not evidence of model delivery until the Host records that receipt.
pub(crate) fn personal_note_baseline(
    conn: &Connection,
    host: &str,
    offset: usize,
    expected: Option<&str>,
) -> Result<PersonalNoteBaseline, String> {
    conn.execute_batch("SAVEPOINT assistant_note_baseline")
        .map_err(|e| e.to_string())?;
    let result = personal_note_baseline_inner(conn, host, offset, expected);
    match result {
        Ok(value) => {
            conn.execute_batch("RELEASE assistant_note_baseline")
                .map_err(|e| e.to_string())?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO assistant_note_baseline; RELEASE assistant_note_baseline",
            );
            Err(error)
        }
    }
}

fn personal_note_baseline_inner(
    conn: &Connection,
    host: &str,
    offset: usize,
    expected: Option<&str>,
) -> Result<PersonalNoteBaseline, String> {
    let mut statement = conn.prepare("SELECT n.id,COALESCE(r.revision,0) FROM notes n LEFT JOIN assistant_native_note_revisions r ON r.source_id=n.id WHERE n.source_cwd IS NULL OR n.source_cwd='' ORDER BY n.id LIMIT 2049").map_err(|e| e.to_string())?;
    let entries = statement
        .query_map([], |row| {
            Ok(NoteBaselineEntry {
                source_id: row.get(0)?,
                revision: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    if entries.len() > 2048 {
        return Err("Native Notes baseline exceeds 2048 rows".into());
    }
    let watermark: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sequence),0) FROM assistant_native_note_outbox",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let gap = notes_gap(conn, host).map_err(|e| e.to_string())?;
    let encoded = serde_json::to_vec(&entries).map_err(|_| "Invalid Native Notes baseline")?;
    if encoded.len() > 524288 {
        return Err("Native Notes baseline exceeds 512 KiB".into());
    }
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(host, entries.as_slice(), watermark, gap))
                .map_err(|_| "Invalid Native Notes baseline")?
        )
    );
    if expected.is_some_and(|value| value != fingerprint) || offset > entries.len() {
        return Err("Native Notes baseline changed or offset is invalid".into());
    }
    let total = entries.len();
    let next_offset = (offset + 8).min(total);
    let entries = entries
        .into_iter()
        .skip(offset)
        .take(next_offset - offset)
        .collect();
    Ok(PersonalNoteBaseline {
        fingerprint,
        offset,
        next_offset,
        total,
        watermark,
        source_gap: gap,
        entries,
    })
}

/// Source data only; callers must bind all delivered pages to one unchanged
/// snapshot before treating this as complete or advancing a recovery cursor.
#[cfg(test)] // Only the outbox regression test reads baseline pages.
pub(crate) fn baseline_page(
    conn: &Connection,
    cwd: &str,
    after: &str,
    limit: usize,
) -> rusqlite::Result<Vec<NoteBaselineEntry>> {
    let mut query = conn.prepare("SELECT n.id,COALESCE(r.revision,0) FROM notes n LEFT JOIN assistant_native_note_revisions r ON r.source_id=n.id WHERE n.source_cwd=? AND n.id>? ORDER BY n.id LIMIT ?")?;
    let rows = query.query_map(params![cwd, after, limit.clamp(1, 100) as i64], |row| {
        Ok(NoteBaselineEntry {
            source_id: row.get(0)?,
            revision: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn install_notes(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS assistant_native_note_revisions (
           source_id TEXT PRIMARY KEY, revision INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS assistant_native_note_outbox (
           sequence INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,
           revision INTEGER NOT NULL, change_kind TEXT NOT NULL, source_cwd TEXT, occurred_at INTEGER NOT NULL,
           UNIQUE(source_id, revision)
         );
         CREATE TABLE IF NOT EXISTS assistant_native_note_state(id INTEGER PRIMARY KEY CHECK(id=1),gap INTEGER NOT NULL);
         INSERT OR IGNORE INTO assistant_native_note_state VALUES(1,1);
         CREATE TABLE IF NOT EXISTS assistant_native_note_host(id INTEGER PRIMARY KEY CHECK(id=1),host_id TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS assistant_native_note_completions_v2(request_id TEXT PRIMARY KEY,operation_hash TEXT NOT NULL,host_id TEXT NOT NULL,fingerprint TEXT NOT NULL,watermark INTEGER NOT NULL,status TEXT NOT NULL);",
    )?;
    for (operation, row, change) in [
        ("INSERT", "NEW", "created"),
        ("UPDATE", "NEW", "updated"),
        ("DELETE", "OLD", "deleted"),
    ] {
        let old_scope = if operation == "UPDATE" {
            "INSERT INTO assistant_native_note_revisions(source_id,revision)
               SELECT OLD.id,1 WHERE OLD.source_cwd IS NOT NEW.source_cwd OR OLD.id IS NOT NEW.id
               ON CONFLICT(source_id) DO UPDATE SET revision=revision+1;
             INSERT INTO assistant_native_note_outbox(source_id,revision,change_kind,source_cwd,occurred_at)
               SELECT OLD.id,revision,'deleted',OLD.source_cwd,CAST(strftime('%s','now') AS INTEGER)*1000 FROM assistant_native_note_revisions
               WHERE source_id=OLD.id AND (OLD.source_cwd IS NOT NEW.source_cwd OR OLD.id IS NOT NEW.id);"
        } else {
            ""
        };
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS assistant_native_note_{} AFTER {} ON notes BEGIN
               {}
               INSERT INTO assistant_native_note_revisions VALUES({}.id,1)
                 ON CONFLICT(source_id) DO UPDATE SET revision=revision+1;
               INSERT INTO assistant_native_note_outbox(source_id,revision,change_kind,source_cwd,occurred_at)
                 SELECT {}.id,revision,'{}',{}.source_cwd,CAST(strftime('%s','now') AS INTEGER)*1000 FROM assistant_native_note_revisions WHERE source_id={}.id;
             END;", operation.to_lowercase(), operation, old_scope, row, row, change, row, row,
        ))?;
    }
    Ok(())
}

pub(crate) fn notes_gap(conn: &Connection, host: &str) -> rusqlite::Result<bool> {
    let gap: i64 = conn.query_row(
        "SELECT gap FROM assistant_native_note_state WHERE id=1",
        [],
        |row| row.get(0),
    )?;
    let owner: Option<String> = conn
        .query_row(
            "SELECT host_id FROM assistant_native_note_host WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(gap != 0 || owner.as_deref() != Some(host))
}

/// Called under Native write lock only after Host has disclosed all exact pages.
pub(crate) fn complete_personal_notes_once(
    conn: &Connection,
    host: &str,
    expected: &str,
    watermark: i64,
    request_id: &str,
    operation_hash: &str,
) -> Result<(), String> {
    let old = conn.query_row("SELECT operation_hash,host_id,fingerprint,watermark,status FROM assistant_native_note_completions_v2 WHERE request_id=?", [request_id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,i64>(3)?,row.get::<_,String>(4)?))).optional().map_err(|e| e.to_string())?;
    if let Some((hash, old_host, fingerprint, old_watermark, status)) = old {
        if hash != operation_hash || fingerprint != expected || old_watermark != watermark {
            return Err("Native Notes baseline request identity changed".into());
        }
        if old_host != host {
            return Err("Native Notes baseline Host changed".into());
        }
        return if status == "completed" {
            Ok(())
        } else {
            Err("Native Notes baseline completion outcome is unknown".into())
        };
    }
    conn.execute(
        "INSERT INTO assistant_native_note_completions_v2 VALUES(?,?,?,?,?, 'pending')",
        params![request_id, operation_hash, host, expected, watermark],
    )
    .map_err(|e| e.to_string())?;
    let current = personal_note_baseline(conn, host, 0, Some(expected))?;
    if current.watermark != watermark {
        return Err("Native Notes baseline changed".into());
    }
    conn.execute_batch("SAVEPOINT assistant_note_complete")
        .map_err(|e| e.to_string())?;
    let result = (|| -> rusqlite::Result<()> {
        conn.execute("DELETE FROM assistant_native_note_outbox WHERE sequence<=? AND (source_cwd IS NULL OR source_cwd='')", [watermark])?;
        conn.execute(
            "UPDATE assistant_native_note_state SET gap=0 WHERE id=1",
            [],
        )?;
        conn.execute("INSERT INTO assistant_native_note_host VALUES(1,?) ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id",[host])?;
        conn.execute("UPDATE assistant_native_note_completions_v2 SET status='completed' WHERE request_id=? AND status='pending'", [request_id])?;
        Ok(())
    })();
    match result {
        Ok(()) => conn
            .execute_batch("RELEASE assistant_note_complete")
            .map_err(|e| e.to_string()),
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO assistant_note_complete; RELEASE assistant_note_complete",
            );
            Err(error.to_string())
        }
    }
}

/// Oldest retained rows only. A caller must retain this exact page until the
/// authenticated Host reports its original identities committed.
#[cfg(test)] // Only the outbox regression test reads the oldest page.
pub(crate) fn page(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<NoteObservation>> {
    page_after(conn, 0, limit)
}

pub(crate) fn page_after(
    conn: &Connection,
    after: i64,
    limit: usize,
) -> rusqlite::Result<Vec<NoteObservation>> {
    let mut query = conn.prepare("SELECT sequence,source_id,revision,change_kind,source_cwd,occurred_at FROM assistant_native_note_outbox WHERE sequence > ? ORDER BY sequence LIMIT ?")?;
    let rows = query.query_map(params![after, limit.clamp(1, 100) as i64], |row| {
        Ok(NoteObservation {
            sequence: row.get(0)?,
            source_id: row.get(1)?,
            revision: row.get(2)?,
            change: row.get(3)?,
            source_cwd: row
                .get::<_, Option<String>>(4)?
                .filter(|value| !value.is_empty()),
            occurred_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Delete only the exact committed identity. Unknown delivery stays retained.
pub(crate) fn acknowledge(
    conn: &Connection,
    sequence: i64,
    source_id: &str,
    revision: i64,
) -> rusqlite::Result<bool> {
    let matched: Option<i64> = conn.query_row(
        "SELECT sequence FROM assistant_native_note_outbox WHERE sequence=? AND source_id=? AND revision=?",
        params![sequence, source_id, revision], |row| row.get(0),
    ).optional()?;
    if matched.is_none() {
        return Ok(false);
    }
    Ok(conn.execute(
        "DELETE FROM assistant_native_note_outbox WHERE sequence=? AND source_id=? AND revision=?",
        params![sequence, source_id, revision],
    )? == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_outbox_rolls_back_and_keeps_recreated_identity() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE notes(id TEXT PRIMARY KEY, source_cwd TEXT); ")
            .unwrap();
        install_notes(&db).unwrap();
        db.execute_batch("BEGIN; INSERT INTO notes VALUES('a','/project'); ROLLBACK;")
            .unwrap();
        assert!(page(&db, 10).unwrap().is_empty());
        db.execute_batch("INSERT INTO notes VALUES('a','/project'); DELETE FROM notes WHERE id='a'; INSERT INTO notes VALUES('a','/project');").unwrap();
        let baseline = baseline_page(&db, "/project", "", 10).unwrap();
        assert_eq!(baseline.len(), 1);
        assert_eq!(baseline[0].revision, 3);
        assert!(baseline_page(&db, "/other", "", 10).unwrap().is_empty());
        let rows = page(&db, 10).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.revision).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(!acknowledge(&db, rows[0].sequence, "a", 2).unwrap());
        assert!(acknowledge(&db, rows[0].sequence, "a", 1).unwrap());
        assert_eq!(page(&db, 10).unwrap().len(), 2);
        db.execute_batch(
            "INSERT INTO notes VALUES('personal',NULL); INSERT INTO notes VALUES('blank','');",
        )
        .unwrap();
        let baseline = personal_note_baseline(&db, "host", 0, None).unwrap();
        assert_eq!(baseline.total, 2);
        assert!(personal_note_baseline(&db, "host", 0, Some(&baseline.fingerprint)).is_ok());
        db.execute_batch("UPDATE notes SET source_cwd='/project' WHERE id='personal'")
            .unwrap();
        assert!(personal_note_baseline(&db, "host", 0, Some(&baseline.fingerprint)).is_err());
        let current = personal_note_baseline(&db, "host", 0, None).unwrap();
        assert!(current.source_gap);
        complete_personal_notes_once(
            &db,
            "host",
            &current.fingerprint,
            current.watermark,
            "request",
            "hash",
        )
        .unwrap();
        assert!(!notes_gap(&db, "host").unwrap());
        assert!(notes_gap(&db, "other-host").unwrap());
        assert!(complete_personal_notes_once(
            &db,
            "other-host",
            &current.fingerprint,
            current.watermark,
            "request",
            "hash"
        )
        .is_err());
        complete_personal_notes_once(
            &db,
            "host",
            &current.fingerprint,
            current.watermark,
            "request",
            "hash",
        )
        .unwrap();
        assert!(complete_personal_notes_once(
            &db,
            "host",
            &current.fingerprint,
            current.watermark,
            "request",
            "changed"
        )
        .is_err());
    }
}
