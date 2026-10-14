use super::*;

/// The legacy blob is a full checkpoint. Once present, these rows are the
/// authoritative transcript; transactions make an acknowledged delta durable.
pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS session_block_state (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, length INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_blocks (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, block_id TEXT NOT NULL, block_json TEXT NOT NULL,
        revision INTEGER NOT NULL, PRIMARY KEY(session_id, ordinal));
      CREATE INDEX IF NOT EXISTS session_blocks_roles ON session_blocks(session_id,json_extract(block_json,'$.role'),json_extract(block_json,'$.draft'));
      CREATE TRIGGER IF NOT EXISTS session_blocks_checkpoint_changed AFTER UPDATE OF blocks_json ON sessions
        WHEN OLD.blocks_json != NEW.blocks_json BEGIN
          UPDATE session_block_state SET revision=revision+1,length=-1 WHERE session_id=NEW.id;
        END;")?;
    // Generate the compatibility view from the current schema so later columns
    // remain available. Summary readers retain their covering table indexes.
    let columns = conn
        .prepare("PRAGMA table_info(sessions)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let select = columns.iter().map(|name| if name == "blocks_json" {
        "CASE WHEN EXISTS(SELECT 1 FROM session_block_state st WHERE st.session_id=s.id AND st.length>=0)
          THEN COALESCE((SELECT '[' || group_concat(block_json, ',') || ']'
            FROM (SELECT block_json FROM session_blocks b WHERE b.session_id=s.id ORDER BY ordinal)), '[]')
          ELSE s.blocks_json END AS blocks_json".to_string()
    } else { format!("s.\"{}\"", name.replace('"', "\"\"")) }).collect::<Vec<_>>().join(",");
    conn.execute_batch(&format!("DROP VIEW IF EXISTS session_transcripts; CREATE VIEW session_transcripts AS SELECT {select} FROM sessions s;"))
}

/// `raw` holds the compact JSON of each element of `blocks`, in order.
pub(super) fn checkpoint(
    conn: &Connection,
    id: &str,
    blocks: &Value,
    raw: &[String],
) -> rusqlite::Result<()> {
    let Some(blocks) = blocks.as_array() else {
        return Ok(());
    };
    debug_assert_eq!(blocks.len(), raw.len());
    let revision: i64 = conn.query_row(
        "SELECT COALESCE((SELECT revision FROM session_block_state WHERE session_id=?1),0)+1",
        [id],
        |r| r.get(0),
    )?;
    let mut upsert = conn.prepare("INSERT INTO session_blocks(session_id,ordinal,block_id,block_json,revision) VALUES(?1,?2,?3,?4,?5)
          ON CONFLICT(session_id,ordinal) DO UPDATE SET block_id=excluded.block_id,block_json=excluded.block_json,revision=excluded.revision
          WHERE session_blocks.block_json != excluded.block_json")?;
    for (index, (block, raw)) in blocks.iter().zip(raw).enumerate() {
        let block_id = block.get("id").and_then(Value::as_str).unwrap_or("");
        upsert.execute(params![id, index as i64, block_id, raw, revision])?;
    }
    drop(upsert);
    conn.execute(
        "DELETE FROM session_blocks WHERE session_id=?1 AND ordinal>=?2",
        params![id, blocks.len() as i64],
    )?;
    conn.execute(
        "INSERT INTO session_block_state(session_id,revision,length) VALUES(?1,?2,?3)
      ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,length=excluded.length",
        params![id, revision, blocks.len() as i64],
    )?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockChange {
    pub index: usize,
    pub block: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDelta {
    pub session: SessionUpsert,
    pub expected_updated_at: i64,
    pub expected_revision: i64,
    pub length: usize,
    pub changes: Vec<BlockChange>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaAck {
    pub updated_at: i64,
    pub revision: i64,
}

pub(super) fn apply(conn: &Connection, delta: &SessionDelta) -> Result<Option<DeltaAck>, String> {
    validate_upsert(&delta.session)?;
    if delta.length > 1_000_000
        || delta
            .changes
            .iter()
            .any(|c| c.index >= delta.length || !c.block.is_object())
    {
        return Err("Invalid transcript delta".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let current: Option<i64> = tx
        .query_row(
            "SELECT updated_at FROM sessions WHERE id=?1",
            [&delta.session.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if current != Some(delta.expected_updated_at) {
        return Ok(None);
    }
    let revision: Option<i64> = tx
        .query_row(
            "SELECT revision FROM session_block_state WHERE session_id=?1 AND length>=0",
            [&delta.session.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(revision) = revision else {
        return Err("Transcript delta requires a full checkpoint".into());
    };
    if revision != delta.expected_revision {
        return Ok(None);
    }
    let revision = revision + 1;
    let id = &delta.session.id;
    {
        let mut upsert = tx.prepare("INSERT INTO session_blocks(session_id,ordinal,block_id,block_json,revision) VALUES(?1,?2,?3,?4,?5)
          ON CONFLICT(session_id,ordinal) DO UPDATE SET block_id=excluded.block_id,block_json=excluded.block_json,revision=excluded.revision")
            .map_err(|e| e.to_string())?;
        for change in &delta.changes {
            let raw = serde_json::to_string(&change.block).map_err(|e| e.to_string())?;
            let block_id = change
                .block
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Block id is required")?;
            upsert
                .execute(params![id, change.index as i64, block_id, raw, revision])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        "DELETE FROM session_blocks WHERE session_id=?1 AND ordinal>=?2",
        params![id, delta.length as i64],
    )
    .map_err(|e| e.to_string())?;
    let count: i64 = tx
        .query_row(
            "SELECT count(*) FROM session_blocks WHERE session_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count != delta.length as i64 {
        return Err("Transcript delta has missing blocks".into());
    }
    let updated_at = now_millis().max(delta.expected_updated_at + 1);
    let s = &delta.session;
    let settings = serde_json::to_string(&s.model_settings).map_err(|e| e.to_string())?;
    let linked = s
        .linked_work_item
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    tx.execute("UPDATE sessions SET cwd=?2,harness=?3,model=?4,model_settings=?5,runtime_mode=?6,title=?7,
      provider_session_id=?8,provider_account_id=?9,context_used=?10,context_window=?11,branch=?12,worktree_cwd=?13,
      worktree_removed=?14,linked_work_item_json=?15,automation_id=?16,updated_at=?17,
      has_user_message=EXISTS(SELECT 1 FROM session_blocks WHERE session_id=?1 AND json_extract(block_json,'$.role')='user'),
      is_draft=EXISTS(SELECT 1 FROM session_blocks WHERE session_id=?1 AND json_extract(block_json,'$.role')='user' AND json_extract(block_json,'$.draft')=1)
      WHERE id=?1",params![id,s.cwd,s.harness,s.model,settings,s.runtime_mode,s.title,s.provider_session_id,s.provider_account_id,
      s.context_used,s.context_window,s.branch,s.worktree_cwd,i64::from(s.worktree_removed),linked,s.automation_id,updated_at]).map_err(|e|e.to_string())?;
    for change in &delta.changes {
        remember_worker_from_blocks(&tx, id, &json!([change.block])).map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE session_block_state SET revision=?2,length=?3 WHERE session_id=?1",
        params![id, revision, delta.length as i64],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Some(DeltaAck {
        updated_at,
        revision,
    }))
}

#[tauri::command(async)]
pub fn session_apply_delta(
    store: State<'_, SessionStore>,
    delta: SessionDelta,
) -> Result<Option<DeltaAck>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    apply(&conn, &delta)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub session: SessionRecord,
    pub before: Option<usize>,
    pub total_blocks: usize,
    pub revision: i64,
}

#[tauri::command(async)]
pub fn session_get_page(
    store: State<'_, SessionStore>,
    session_id: String,
    before: Option<usize>,
    revision: Option<i64>,
    limit: Option<usize>,
) -> Result<Option<TranscriptPage>, String> {
    store.with_read_conn(|conn| {
        page(
            conn,
            &session_id,
            before,
            revision,
            limit.unwrap_or(80).clamp(1, 200),
        )
    })
}

pub(super) fn page(
    conn: &Connection,
    id: &str,
    before: Option<usize>,
    expected: Option<i64>,
    limit: usize,
) -> Result<Option<TranscriptPage>, String> {
    // A deferred read transaction pins metadata and blocks to the same WAL
    // snapshot. Cursors reject intervening writes rather than splice revisions.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let state: Option<(i64, usize)> = tx
        .query_row(
            "SELECT revision,length FROM session_block_state WHERE session_id=?1 AND length>=0",
            [id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as usize)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let mut record = read_session_row_from(&tx, id, state.is_none()).map_err(|e| e.to_string())?;
    let Some((mut session, settings, legacy)) = record.take() else {
        return Ok(None);
    };
    session.model_settings = serde_json::from_str(&settings).map_err(|e| e.to_string())?;
    let (revision, total, blocks) = if let Some((revision, total)) = state {
        if expected.is_some_and(|value| value != revision) {
            return Err("Transcript page revision changed".into());
        }
        let end = before.unwrap_or(total).min(total);
        let start = end.saturating_sub(limit);
        let mut stmt=tx.prepare("SELECT block_json FROM session_blocks WHERE session_id=?1 AND ordinal>=?2 AND ordinal<?3 ORDER BY ordinal").map_err(|e|e.to_string())?;
        let raw = stmt
            .query_map(params![id, start as i64, end as i64], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        let blocks = raw
            .iter()
            .map(|raw| serde_json::from_str::<Value>(raw))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        (revision, total, blocks)
    } else {
        // Legacy databases remain readable; their first save normalizes blocks.
        let blocks: Vec<Value> = serde_json::from_str(&legacy).map_err(|e| e.to_string())?;
        let total = blocks.len();
        let revision = session.transcript_revision.unwrap_or(session.updated_at);
        if expected.is_some_and(|value| value != revision) {
            return Err("Transcript page revision changed".into());
        }
        let end = before.unwrap_or(total).min(total);
        let start = end.saturating_sub(limit);
        (revision, total, blocks[start..end].to_vec())
    };
    let end = before.unwrap_or(total).min(total);
    let start = end.saturating_sub(limit);
    session.blocks = Value::Array(blocks);
    Ok(Some(TranscriptPage {
        session,
        before: (start > 0).then_some(start),
        total_blocks: total,
        revision,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> SessionUpsert {
        serde_json::from_value(json!({"id":"delta-test","cwd":"/tmp/project","harness":"codex","model":"model",
            "modelSettings":{},"runtimeMode":"full","title":"Test","blocks":[
                {"id":"u","role":"user","text":"hello"},{"id":"a","role":"assistant","text":"before"}]})).unwrap()
    }
    fn seed(conn: &Connection) -> (SessionUpsert, SessionSummary) {
        let session = session();
        let summary = upsert_session_with_git(conn, &session, crate::fs::GitInfo::default(), None)
            .unwrap()
            .unwrap();
        (session, summary)
    }
    fn delta(session: SessionUpsert, summary: &SessionSummary) -> SessionDelta {
        SessionDelta {
            session,
            expected_updated_at: summary.updated_at,
            expected_revision: summary.transcript_revision.unwrap(),
            length: 2,
            changes: vec![BlockChange {
                index: 1,
                block: json!({"id":"a","role":"assistant","text":"after"}),
            }],
        }
    }
    #[test]
    fn delta_is_authoritative_for_get_view_and_revision_pages() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (session, summary) = seed(&conn);
        let first = page(&conn, &session.id, None, None, 1).unwrap().unwrap();
        let ack = apply(&conn, &delta(session.clone(), &summary))
            .unwrap()
            .unwrap();
        assert!(ack.updated_at > summary.updated_at);
        assert!(ack.revision > summary.transcript_revision.unwrap());
        assert_eq!(
            get_session(&conn, &session.id).unwrap().unwrap().blocks[1]["text"],
            "after"
        );
        let checkpoint: String = conn
            .query_row(
                "SELECT blocks_json FROM sessions WHERE id=?1",
                [&session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(checkpoint.contains("before"));
        assert!(page(&conn, &session.id, first.before, Some(first.revision), 1).is_err());
    }
    #[test]
    fn same_timestamp_metadata_write_rejects_stale_revision_delta() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (mut session, summary) = seed(&conn);
        let stale = delta(session.clone(), &summary);
        session.title = "Renamed".into();
        let changed = upsert_session_with_git(&conn, &session, crate::fs::GitInfo::default(), None)
            .unwrap()
            .unwrap();
        assert_eq!(changed.updated_at, summary.updated_at);
        assert_ne!(changed.transcript_revision, summary.transcript_revision);
        assert!(apply(&conn, &stale).unwrap().is_none());
        assert_eq!(
            get_session(&conn, &session.id).unwrap().unwrap().blocks[1]["text"],
            "before"
        );
    }
    #[test]
    fn malformed_delta_rolls_back_rows_and_ack_stamp() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (session, summary) = seed(&conn);
        let mut change = delta(session.clone(), &summary);
        change.length = 4;
        change.changes.push(BlockChange {
            index: 3,
            block: json!({"id":"extra","role":"assistant","text":"gap"}),
        });
        assert!(apply(&conn, &change).is_err());
        let record = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(record.updated_at, summary.updated_at);
        assert_eq!(record.blocks[1]["text"], "before");
    }
    #[test]
    fn legacy_blob_changes_and_deleted_sessions_never_read_stale_rows() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (session, _) = seed(&conn);
        conn.execute("UPDATE sessions SET blocks_json='[{\"id\":\"legacy\",\"role\":\"user\",\"text\":\"legacy\"}]' WHERE id=?1",[&session.id]).unwrap();
        let legacy = page(&conn, &session.id, None, None, 10).unwrap().unwrap();
        assert_eq!(legacy.session.blocks[0]["id"], "legacy");
        delete_session(&conn, &session.id).unwrap();
        let rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM session_blocks WHERE session_id=?1",
                [&session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
    }
    #[test]
    fn acknowledged_delta_survives_database_reopen() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-delta-{}-{}.db",
            std::process::id(),
            now_millis()
        ));
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.conn.lock().unwrap();
            let (session, summary) = seed(&conn);
            apply(&conn, &delta(session, &summary)).unwrap().unwrap();
        }
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.conn.lock().unwrap();
            assert_eq!(
                get_session(&conn, "delta-test").unwrap().unwrap().blocks[1]["text"],
                "after"
            );
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }
}
