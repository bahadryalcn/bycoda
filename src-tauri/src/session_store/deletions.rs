//! Explicit deletion survives stale writers and application restarts.
use super::*;

pub(super) const DELETED: &str = "Session was deleted";

pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    ensure_markers(conn)?;
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS session_deleted_insert BEFORE INSERT ON sessions
         WHEN EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.id)
         BEGIN SELECT RAISE(ABORT, 'Session was deleted'); END;
         CREATE TRIGGER IF NOT EXISTS session_deleted_identity BEFORE UPDATE OF id ON sessions
         WHEN EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.id)
         BEGIN SELECT RAISE(ABORT, 'Session was deleted'); END;
         CREATE TRIGGER IF NOT EXISTS session_deleted_in_flight BEFORE INSERT ON in_flight_sessions
         WHEN EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.session_id)
         BEGIN SELECT RAISE(IGNORE); END;",
    )
}

pub(super) fn ensure_markers(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_deletions (
        session_id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL
    );",
    )
}

pub(super) fn assert_readable(conn: &Connection, id: &str) -> Result<(), String> {
    let deleted: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM session_deletions WHERE session_id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if deleted {
        Err(DELETED.into())
    } else {
        Ok(())
    }
}

pub(super) fn deleted_ids(conn: &Connection, ids: &[String]) -> Result<Vec<String>, String> {
    let encoded = serde_json::to_string(ids).map_err(|error| error.to_string())?;
    let mut statement = conn.prepare(
        "SELECT session_id FROM session_deletions WHERE session_id IN (SELECT value FROM json_each(?1)) ORDER BY session_id"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([encoded], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

/// The only reusable deletion is an unsent draft. A stale client cannot use this
/// path to remove a submitted conversation or clear an existing deletion marker.
pub(super) fn assert_recreatable_draft(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    // has_user_message is a listability flag and includes saved user drafts.
    // Read the authoritative normalized transcript and retained rewind history;
    // the legacy blocks_json checkpoint alone can be older or empty.
    let has_submitted_user = |blocks: &Value| {
        blocks.as_array().is_some_and(|blocks| {
            blocks.iter().any(|block| {
                block.get("role").and_then(Value::as_str) == Some("user")
                    && block.get("draft").and_then(Value::as_bool) != Some(true)
            })
        })
    };
    let sent = get_session(conn, id)?.is_some_and(|record| {
        has_submitted_user(&record.blocks)
            || record
                .rewind_history
                .as_ref()
                .and_then(Value::as_array)
                .is_some_and(|entries| {
                    entries
                        .iter()
                        .any(|entry| has_submitted_user(&entry["blocks"]))
                })
    });
    if sent {
        return Err(rusqlite::Error::InvalidParameterName(
            "Only an unsent draft can be discarded without a deletion marker".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
