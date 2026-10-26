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
    let current: Option<(i64, bool)> = tx
        .query_row(
            "SELECT updated_at, adopted_divergence IS ?2 FROM sessions WHERE id=?1",
            params![&delta.session.id, delta.session.adopted_divergence],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((current_updated, same_divergence)) = current else {
        return Ok(None);
    };
    if current_updated != delta.expected_updated_at {
        return Ok(None);
    }
    let state: Option<(i64, i64)> = tx
        .query_row(
            "SELECT revision, length FROM session_block_state WHERE session_id=?1 AND length>=0",
            [&delta.session.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((revision, previous_length)) = state else {
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
    // The same rule as a full upsert (`upsert_session_core`): the transcript,
    // a changed divergence or any other changed field moves `updated_at`;
    // `adopted_base`, a record of what was agreed, must not on its own.
    let transcript_changed = !delta.changes.is_empty() || delta.length as i64 != previous_length;
    let s = &delta.session;
    let settings = serde_json::to_string(&s.model_settings).map_err(|e| e.to_string())?;
    let linked = s
        .linked_work_item
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    let rewind_history = s
        .rewind_history
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    // Title, model, harness or provider-thread changes also reach the host
    // through this stamp; only `adopted_base` alone leaves it alone.
    let metadata_unchanged = super::session_metadata_unchanged(
        &tx,
        s,
        &settings,
        linked.as_deref(),
        rewind_history.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let updated_at = if transcript_changed || !same_divergence || !metadata_unchanged {
        now_millis().max(delta.expected_updated_at + 1)
    } else {
        delta.expected_updated_at
    };
    let archived_user = super::has_archived_user_block(s.rewind_history.as_ref());
    tx.execute("UPDATE sessions SET cwd=?2,harness=?3,model=?4,model_settings=?5,runtime_mode=?6,title=?7,
      provider_session_id=?8,provider_account_id=?9,context_used=?10,context_window=?11,branch=?12,worktree_cwd=?13,
      worktree_removed=?14,linked_work_item_json=?15,automation_id=?16,updated_at=?17,
      rewind_history_json=?18,pending_context_replay=?19,adopted_divergence=?21,adopted_base=?22,workspace_id=?23,workspace_revision=?24,
      has_user_message=?20 OR EXISTS(SELECT 1 FROM session_blocks WHERE session_id=?1 AND json_extract(block_json,'$.role')='user'),
      is_draft=EXISTS(SELECT 1 FROM session_blocks WHERE session_id=?1 AND json_extract(block_json,'$.role')='user' AND json_extract(block_json,'$.draft')=1)
      WHERE id=?1",params![id,s.cwd,s.harness,s.model,settings,s.runtime_mode,s.title,s.provider_session_id,s.provider_account_id,
      s.context_used,s.context_window,s.branch,s.worktree_cwd,i64::from(s.worktree_removed),linked,s.automation_id,updated_at,
      rewind_history,s.pending_context_replay,i64::from(archived_user),s.adopted_divergence,s.adopted_base,s.workspace_id,s.workspace_revision]).map_err(|e|e.to_string())?;
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

#[derive(Default)]
pub(super) struct LegacyPageCache {
    entries: std::collections::VecDeque<LegacyPageEntry>,
    bytes: usize,
    #[cfg(test)]
    builds: usize,
    #[cfg(test)]
    blob_bytes: usize,
    #[cfg(test)]
    fallback_reads: usize,
}

struct LegacyPageEntry {
    id: String,
    source: i64,
    revision: i64,
    offsets: Arc<Vec<(usize, usize)>>,
}

/// Validate the entire legacy array once, retaining byte positions rather than
/// a second parsed copy of every historical block. IgnoredAny validates JSON
/// strings/escapes/nesting without allocating their contents.
pub(super) fn legacy_offsets(
    raw: &str,
    keep_going: &dyn Fn() -> bool,
) -> Result<Option<Vec<(usize, usize)>>, String> {
    let bytes = raw.as_bytes();
    let mut cursor = 0;
    let skip = |cursor: &mut usize| {
        while bytes.get(*cursor).is_some_and(u8::is_ascii_whitespace) {
            *cursor += 1;
        }
    };
    skip(&mut cursor);
    if bytes.get(cursor) != Some(&b'[') {
        return Err("Legacy transcript is not an array".into());
    }
    cursor += 1;
    skip(&mut cursor);
    let mut offsets = Vec::new();
    if bytes.get(cursor) != Some(&b']') {
        loop {
            if !keep_going() {
                return Ok(None);
            }
            let start = cursor;
            let mut stream = serde_json::Deserializer::from_slice(&bytes[cursor..])
                .into_iter::<serde::de::IgnoredAny>();
            stream
                .next()
                .ok_or("Incomplete legacy transcript")?
                .map_err(|error| error.to_string())?;
            cursor += stream.byte_offset();
            offsets.push((start, cursor));
            skip(&mut cursor);
            match bytes.get(cursor) {
                Some(b',') => {
                    cursor += 1;
                    skip(&mut cursor);
                }
                Some(b']') => break,
                _ => return Err("Invalid legacy transcript separator".into()),
            }
        }
    }
    cursor += 1;
    skip(&mut cursor);
    if cursor != bytes.len() {
        return Err("Trailing legacy transcript data".into());
    }
    Ok(Some(offsets))
}

fn legacy_page_offsets(
    conn: &Connection,
    id: &str,
    revision: i64,
    cache: Option<&Mutex<LegacyPageCache>>,
) -> Result<Arc<Vec<(usize, usize)>>, String> {
    let source: i64 = conn
        .query_row(
            "SELECT version FROM session_search_source_revision WHERE session_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0);
    let mut guard = cache
        .map(|cache| cache.lock().map_err(|_| "Legacy page cache is locked"))
        .transpose()?;
    if let Some(cache) = guard.as_mut() {
        if let Some(position) = cache.entries.iter().position(|entry| {
            entry.id == id && entry.source == source && entry.revision == revision
        }) {
            let entry = cache.entries.remove(position).unwrap();
            let offsets = entry.offsets.clone();
            cache.entries.push_back(entry);
            return Ok(offsets);
        }
    }
    let raw: String = conn
        .query_row(
            "SELECT blocks_json FROM sessions WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let offsets = Arc::new(legacy_offsets(&raw, &|| true)?.unwrap());
    if let Some(cache) = guard.as_mut() {
        #[cfg(test)]
        {
            cache.builds += 1;
        }
        let bytes = offsets.capacity() * std::mem::size_of::<(usize, usize)>();
        if bytes <= 16 * 1024 * 1024 {
            while let Some(position) = cache.entries.iter().position(|entry| entry.id == id) {
                let entry = cache.entries.remove(position).unwrap();
                cache.bytes -= entry.offsets.capacity() * std::mem::size_of::<(usize, usize)>();
            }
            cache.entries.push_back(LegacyPageEntry {
                id: id.into(),
                source,
                revision,
                offsets: offsets.clone(),
            });
            cache.bytes += bytes;
            while cache.entries.len() > 4 || cache.bytes > 16 * 1024 * 1024 {
                if let Some(entry) = cache.entries.pop_front() {
                    cache.bytes -= entry.offsets.capacity() * std::mem::size_of::<(usize, usize)>();
                }
            }
        }
    }
    Ok(offsets)
}

/// Incremental SQLite BLOB I/O also accepts TEXT cells. Unlike SQL substr,
/// it does not materialize the whole legacy cell inside SQLite for each page.
/// An unsuitable older storage layout retains its read-only SQL fallback.
fn read_legacy_window(
    conn: &Connection,
    id: &str,
    from: usize,
    len: usize,
) -> Result<(Vec<u8>, bool), String> {
    let rowid = conn.query_row("SELECT rowid FROM sessions WHERE id=?1", [id], |row| {
        row.get::<_, i64>(0)
    });
    if let Ok(rowid) = rowid {
        if let Ok(blob) = conn.blob_open("main", "sessions", "blocks_json", rowid, true) {
            if from.checked_add(len).is_none_or(|end| end > blob.len()) {
                return Err("Legacy transcript page identity changed".into());
            }
            let mut bytes = vec![0; len];
            blob.read_at_exact(&mut bytes, from)
                .map_err(|error| error.to_string())?;
            return Ok((bytes, true));
        }
    }
    let bytes = conn
        .query_row(
            "SELECT substr(CAST(blocks_json AS BLOB),?2,?3) FROM sessions WHERE id=?1",
            params![id, from as i64 + 1, len as i64],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok((bytes, false))
}

#[tauri::command(async)]
pub fn session_get_page(
    app: AppHandle,
    store: State<'_, SessionStore>,
    session_id: String,
    before: Option<usize>,
    revision: Option<i64>,
    limit: Option<usize>,
) -> Result<Option<TranscriptPage>, String> {
    let _ = super::rewind::reconcile_pending_native(&app, &store, Some(&session_id));
    store.with_read_conn(|conn| {
        page_with_cache(
            conn,
            &session_id,
            before,
            revision,
            limit.unwrap_or(80).clamp(1, 200),
            Some(&store.legacy_page_cache),
        )
    })
}

#[cfg(test)]
pub(super) fn page(
    conn: &Connection,
    id: &str,
    before: Option<usize>,
    expected: Option<i64>,
    limit: usize,
) -> Result<Option<TranscriptPage>, String> {
    page_with_cache(conn, id, before, expected, limit, None)
}

fn page_with_cache(
    conn: &Connection,
    id: &str,
    before: Option<usize>,
    expected: Option<i64>,
    limit: usize,
    cache: Option<&Mutex<LegacyPageCache>>,
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
    let mut record = read_session_row_from(&tx, id, false).map_err(|e| e.to_string())?;
    let Some((mut session, settings, _legacy)) = record.take() else {
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
        let revision = session.transcript_revision.unwrap_or(session.updated_at);
        if expected.is_some_and(|value| value != revision) {
            return Err("Transcript page revision changed".into());
        }
        let offsets = legacy_page_offsets(&tx, id, revision, cache)?;
        let total = offsets.len();
        let end = before.unwrap_or(total).min(total);
        let start = end.saturating_sub(limit);
        let blocks = if start == end {
            Vec::new()
        } else {
            let from = offsets[start].0;
            let through = offsets[end - 1].1;
            let (raw, _bounded_blob) = read_legacy_window(&tx, id, from, through - from)?;
            #[cfg(test)]
            if let Some(cache) = cache {
                let mut cache = cache.lock().unwrap();
                if _bounded_blob {
                    cache.blob_bytes += raw.len();
                } else {
                    cache.fallback_reads += 1;
                }
            }
            let mut array = Vec::with_capacity(raw.len() + 2);
            array.push(b'[');
            array.extend_from_slice(&raw);
            array.push(b']');
            serde_json::from_slice(&array).map_err(|error| error.to_string())?
        };
        (revision, total, blocks)
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
    #[test]
    #[ignore = "bounded legacy paging cost comparison; run explicitly"]
    fn legacy_paging_cost_comparison() {
        for count in [10_000, 100_000] {
            let store = SessionStore::open_in_memory().unwrap();
            let conn = store.conn.lock().unwrap();
            let (session, _) = seed(&conn);
            let blocks:Vec<Value>=(0..count).map(|index|json!({"id":format!("b{index}"),"role":"assistant","text":"Unicode 🧩 Türkiye long historical text"})).collect();
            let raw = serde_json::to_string(&blocks).unwrap();
            conn.execute(
                "UPDATE sessions SET blocks_json=?2 WHERE id=?1",
                params![session.id, raw],
            )
            .unwrap();
            let started = std::time::Instant::now();
            for _ in 0..5 {
                let parsed: Vec<Value> = serde_json::from_str(&raw).unwrap();
                std::hint::black_box(parsed);
            }
            let control = started.elapsed();
            let cache = Mutex::new(LegacyPageCache::default());
            let started = std::time::Instant::now();
            let mut before = None;
            let mut revision = None;
            for index in 0..5 {
                let page = page_with_cache(&conn, &session.id, before, revision, 80, Some(&cache))
                    .unwrap()
                    .unwrap();
                assert_eq!(
                    page.session.blocks[79]["id"],
                    format!("b{}", count - index * 80 - 1)
                );
                before = page.before;
                revision = Some(page.revision);
            }
            println!("native legacy {count} blocks, {} bytes, 5 pages: old full-parse control {:?}; cached byte-window {:?}; offset builds {}",raw.len(),control,started.elapsed(),cache.lock().unwrap().builds);
            assert_eq!(cache.lock().unwrap().builds, 1);
        }
    }

    #[test]
    fn legacy_offsets_validate_json_without_materializing_historical_values() {
        for raw in [
            "[]",
            " [ 1, {\"text\":\"Türkçe 🧩 \\\"\",\"nested\":[null,true]},\"x\" ] ",
            "[1,]",
            "[",
            "{}",
            "[\"unterminated]",
            "[1] junk",
            "[[[false]]]",
            "[01]",
        ] {
            let parsed = serde_json::from_str::<Vec<Value>>(raw);
            let offsets = legacy_offsets(raw, &|| true);
            assert_eq!(offsets.is_ok(), parsed.is_ok(), "{raw}");
            if let (Ok(Some(offsets)), Ok(values)) = (offsets, parsed) {
                let restored: Vec<Value> = offsets
                    .iter()
                    .map(|(from, to)| serde_json::from_str(&raw[*from..*to]).unwrap())
                    .collect();
                assert_eq!(restored, values);
            }
        }
    }

    #[test]
    fn legacy_page_cache_indexes_once_and_reads_stable_revision_windows() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (session, _) = seed(&conn);
        let blocks: Vec<Value> = (0..10_000).map(|index| json!({"id":format!("b{index}"),"role":"user","text":"🧩 quoted \\\"\ntext"})).collect();
        let raw = serde_json::to_string(&blocks).unwrap();
        conn.execute(
            "UPDATE sessions SET blocks_json=?2 WHERE id=?1",
            params![session.id, raw],
        )
        .unwrap();
        let changes = conn.total_changes();
        let cache = Mutex::new(LegacyPageCache::default());
        let started = std::time::Instant::now();
        let mut before = None;
        let mut revision = None;
        for page_index in 0..5 {
            let page = page_with_cache(&conn, &session.id, before, revision, 80, Some(&cache))
                .unwrap()
                .unwrap();
            let end = 10_000 - page_index * 80;
            assert_eq!(
                page.session.blocks,
                Value::Array(blocks[end - 80..end].to_vec())
            );
            assert_eq!(page.total_blocks, 10_000);
            before = page.before;
            revision = Some(page.revision);
        }
        println!(
            "native legacy 10k blocks / 5 pages: {:?}, full offset builds {}",
            started.elapsed(),
            cache.lock().unwrap().builds
        );
        assert_eq!(cache.lock().unwrap().builds, 1);
        assert!(cache.lock().unwrap().blob_bytes < raw.len());
        assert_eq!(cache.lock().unwrap().fallback_reads, 0);
        assert_eq!(
            conn.total_changes(),
            changes,
            "paging must remain read-only"
        );
        conn.execute(
            "UPDATE sessions SET title='Unrelated metadata' WHERE id=?1",
            [&session.id],
        )
        .unwrap();
        page_with_cache(&conn, &session.id, None, revision, 80, Some(&cache)).unwrap();
        assert_eq!(cache.lock().unwrap().builds, 1);
        conn.execute("UPDATE sessions SET blocks_json='[{\"id\":\"new\",\"role\":\"user\",\"text\":\"new\"}]' WHERE id=?1",[&session.id]).unwrap();
        assert!(page_with_cache(&conn, &session.id, None, revision, 80, Some(&cache)).is_err());
        let latest = page_with_cache(&conn, &session.id, None, None, 80, Some(&cache))
            .unwrap()
            .unwrap();
        assert_eq!(latest.session.blocks[0]["id"], "new");
        assert_eq!(cache.lock().unwrap().builds, 2);
    }

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
    fn delta_carries_the_adopted_base() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (mut session, summary) = seed(&conn);
        let base = r#"{"count":2,"chain":"0123456789abcdef0123456789abcdef"}"#;
        session.adopted_base = Some(base.into());
        apply(&conn, &delta(session.clone(), &summary))
            .unwrap()
            .unwrap();
        let restored = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(restored.adopted_base.as_deref(), Some(base));
        assert_eq!(restored.blocks[1]["text"], "after");
    }
    #[test]
    fn a_delta_moves_updated_at_like_a_full_upsert_does() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (mut session, summary) = seed(&conn);
        let no_changes = |session: &SessionUpsert, at: i64, revision: i64| SessionDelta {
            session: session.clone(),
            expected_updated_at: at,
            expected_revision: revision,
            length: 2,
            changes: vec![],
        };

        // Recording what was agreed is bookkeeping: history keeps its order.
        session.adopted_base =
            Some(r#"{"count":2,"chain":"0123456789abcdef0123456789abcdef"}"#.into());
        let recorded = apply(
            &conn,
            &no_changes(
                &session,
                summary.updated_at,
                summary.transcript_revision.unwrap(),
            ),
        )
        .unwrap()
        .unwrap();
        assert_eq!(recorded.updated_at, summary.updated_at);

        // A flagged divergence is something to tell the host, and so is the answer.
        session.adopted_divergence = Some(r#"{"key":"k"}"#.into());
        let flagged = apply(
            &conn,
            &no_changes(&session, recorded.updated_at, recorded.revision),
        )
        .unwrap()
        .unwrap();
        assert!(flagged.updated_at > recorded.updated_at);
        let same = apply(
            &conn,
            &no_changes(&session, flagged.updated_at, flagged.revision),
        )
        .unwrap()
        .unwrap();
        assert_eq!(same.updated_at, flagged.updated_at);

        // Changed blocks always move it.
        let changed = apply(
            &conn,
            &SessionDelta {
                expected_updated_at: same.updated_at,
                expected_revision: same.revision,
                ..delta(session.clone(), &summary)
            },
        )
        .unwrap()
        .unwrap();
        assert!(changed.updated_at > same.updated_at);
    }
    #[test]
    fn a_delta_with_only_metadata_changes_still_moves_updated_at() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (session, summary) = seed(&conn);
        let mut at = summary.updated_at;
        let mut revision = summary.transcript_revision.unwrap();
        let mut step = |session: &SessionUpsert| {
            let ack = apply(
                &conn,
                &SessionDelta {
                    session: session.clone(),
                    expected_updated_at: at,
                    expected_revision: revision,
                    length: 2,
                    changes: vec![],
                },
            )
            .unwrap()
            .unwrap();
            let moved = ack.updated_at > at;
            at = ack.updated_at;
            revision = ack.revision;
            moved
        };
        let mut next = session.clone();
        assert!(!step(&next), "nothing changed");
        next.title = "Renamed".into();
        assert!(step(&next), "title");
        assert!(!step(&next), "same title again");
        next.model = "other-model".into();
        assert!(step(&next), "model");
        next.harness = "claude".into();
        assert!(step(&next), "harness");
        next.provider_session_id = Some("thread-1".into());
        assert!(step(&next), "provider thread");
        next.adopted_base =
            Some(r#"{"count":2,"chain":"0123456789abcdef0123456789abcdef"}"#.into());
        assert!(!step(&next), "adopted_base alone");
        next.adopted_divergence = Some(r#"{"key":"k"}"#.into());
        assert!(step(&next), "divergence");
    }
    #[test]
    fn rewind_to_empty_active_transcript_keeps_archived_session_listable() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (mut session, summary) = seed(&conn);
        session.blocks = json!([]);
        session.rewind_history = Some(json!([{
            "id": "archive-1", "createdAt": 10, "fromBlockId": "u",
            "blocks": [{ "id": "u", "role": "user", "text": "archived prompt" }]
        }]));
        session.pending_context_replay = None;
        conn.execute(
            "UPDATE sessions SET pending_context_replay='stale replay' WHERE id=?1",
            [&session.id],
        )
        .unwrap();
        let delta = SessionDelta {
            session,
            expected_updated_at: summary.updated_at,
            expected_revision: summary.transcript_revision.unwrap(),
            length: 0,
            changes: vec![],
        };

        apply(&conn, &delta).unwrap().unwrap();
        let restored = get_session(&conn, "delta-test").unwrap().unwrap();
        assert_eq!(restored.blocks, json!([]));
        assert_eq!(
            restored.rewind_history.as_ref().unwrap()[0]["blocks"][0]["text"],
            "archived prompt"
        );
        assert_eq!(restored.pending_context_replay, None);
        assert!(list_recent(&conn, 10)
            .unwrap()
            .iter()
            .any(|row| row.id == "delta-test"));
    }
    #[test]
    fn same_timestamp_metadata_write_rejects_stale_revision_delta() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let (mut session, summary) = seed(&conn);
        let stale = delta(session.clone(), &summary);
        // Only the recorded base: it leaves `updated_at` where it was.
        session.adopted_base =
            Some(r#"{"count":2,"chain":"0123456789abcdef0123456789abcdef"}"#.into());
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
