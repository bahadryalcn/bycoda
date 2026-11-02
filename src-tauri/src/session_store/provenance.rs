use super::*;

pub(super) fn stored_management(conn: &Connection, id: &str) -> rusqlite::Result<Option<Value>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT assistant_management_json FROM sessions WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(optional_json(raw))
}

fn authors(conn: &Connection, id: &str) -> Result<HashMap<String, Value>, String> {
    let normalized: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM session_block_state WHERE session_id=?1 AND length>=0)",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let sql = if normalized {
        "SELECT block_id,json_extract(block_json,'$.author') FROM session_blocks WHERE session_id=?1 AND json_type(block_json,'$.author')='object'"
    } else {
        "SELECT json_extract(value,'$.id'),json_extract(value,'$.author') FROM sessions,json_each(sessions.blocks_json) WHERE sessions.id=?1 AND json_type(value,'$.author')='object'"
    };
    conn.prepare(sql)
        .map_err(|e| e.to_string())?
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .map(|row| {
            let (id, raw) = row.map_err(|e| e.to_string())?;
            let author = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok((id, author))
        })
        .collect()
}

fn protect_management(conn: &Connection, session: &SessionUpsert) -> Result<(), String> {
    if let Some(incoming) = &session.managed_by {
        if stored_management(conn, &session.id)
            .map_err(|e| e.to_string())?
            .as_ref()
            != Some(incoming)
        {
            return Err(
                "Assistant management is Host-owned and cannot be supplied by a client save."
                    .into(),
            );
        }
    }
    Ok(())
}
fn protect_block(block: &mut Value, existing: &HashMap<String, Value>) -> Result<(), String> {
    let Some(row) = block.as_object_mut() else {
        return Ok(());
    };
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let old = existing.get(&id);
    if let Some(author) = row.get("author").filter(|value| !value.is_null()) {
        if Some(author) != old {
            return Err(
                "Message authorship is Host-owned and cannot be changed by a client save.".into(),
            );
        }
    }
    if let Some(author) = old {
        row.insert("author".into(), author.clone());
    } else {
        row.remove("author");
    }
    Ok(())
}
/// Ordinary webview persistence may retain an accepted Host stamp, but cannot
/// create or replace it. Legacy clients omitting a stamp keep the stored value.
/// Internal authenticated Host projection does not pass through this boundary.
pub(super) fn protect_client_upsert(
    conn: &Connection,
    session: &mut SessionUpsert,
) -> Result<(), String> {
    protect_management(conn, session)?;
    let existing = authors(conn, &session.id)?;
    if let Some(blocks) = session.blocks.as_array_mut() {
        for block in blocks {
            protect_block(block, &existing)?;
        }
    }
    Ok(())
}
pub(super) fn protect_client_delta(
    conn: &Connection,
    delta: &mut incremental::SessionDelta,
) -> Result<(), String> {
    protect_management(conn, &delta.session)?;
    let existing = authors(conn, &delta.session.id)?;
    for change in &mut delta.changes {
        protect_block(&mut change.block, &existing)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> SessionUpsert {
        serde_json::from_value(json!({"id":"managed","cwd":"/isolated","harness":"codex","model":"test","modelSettings":{},"runtimeMode":"supervised","title":"Managed","blocks":[{"id":"user","role":"user","text":"Continue","author":{"kind":"assistant","name":"Owner Name","jobId":"job","reason":"nudge","operationId":"operation"}}],"managedBy":{"assistant":true,"jobId":"job","managedAt":123}})).unwrap()
    }
    #[test]
    fn trusted_provenance_survives_checkpoint_delta_export_and_reopen() {
        let path =
            std::env::temp_dir().join(format!("bycoda-provenance-{}.db", uuid::Uuid::new_v4()));
        {
            let conn = Connection::open(&path).unwrap();
            migrate(&conn).unwrap();
            let session = sample();
            upsert_session(&conn, &session).unwrap();
            let record = get_session(&conn, "managed").unwrap().unwrap();
            assert_eq!(record.managed_by, session.managed_by);
            assert_eq!(record.blocks[0]["author"], session.blocks[0]["author"]);
            assert_eq!(
                list_recent(&conn, 10).unwrap()[0].managed_by,
                session.managed_by
            );
            let exported: Value =
                serde_json::from_str(&get_session_json(&conn, "managed").unwrap()).unwrap();
            assert_eq!(exported["managedBy"], session.managed_by.unwrap());
            assert_eq!(exported["blocks"][0]["author"]["name"], "Owner Name");
            let mut legacy = sample();
            legacy.managed_by = None;
            legacy.blocks[0].as_object_mut().unwrap().remove("author");
            protect_client_upsert(&conn, &mut legacy).unwrap();
            assert_eq!(legacy.blocks[0]["author"]["kind"], "assistant");
            upsert_session(&conn, &legacy).unwrap();
            let record = get_session(&conn, "managed").unwrap().unwrap();
            let mut block = record.blocks[0].clone();
            block["text"] = json!("Updated");
            block.as_object_mut().unwrap().remove("author");
            let mut delta = incremental::SessionDelta {
                session: legacy,
                expected_updated_at: record.updated_at,
                expected_revision: record.transcript_revision.unwrap(),
                length: 1,
                changes: vec![incremental::BlockChange { index: 0, block }],
            };
            protect_client_delta(&conn, &mut delta).unwrap();
            incremental::apply(&conn, &delta).unwrap().unwrap();
        }
        {
            let conn = Connection::open(&path).unwrap();
            migrate(&conn).unwrap();
            let record = get_session(&conn, "managed").unwrap().unwrap();
            assert_eq!(record.managed_by.unwrap()["jobId"], "job");
            assert_eq!(record.blocks[0]["author"]["operationId"], "operation");
            assert_eq!(record.blocks[0]["text"], "Updated");
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ordinary_client_saves_cannot_create_or_replace_host_provenance() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let mut forged = sample();
        assert!(protect_client_upsert(&conn, &mut forged)
            .unwrap_err()
            .contains("Host-owned"));
        let trusted = sample();
        upsert_session(&conn, &trusted).unwrap();
        let mut forged = sample();
        forged.managed_by.as_mut().unwrap()["jobId"] = json!("other");
        assert!(protect_client_upsert(&conn, &mut forged).is_err());
        forged = sample();
        forged.blocks[0]["author"]["name"] = json!("Impersonated");
        assert!(protect_client_upsert(&conn, &mut forged).is_err());
        let record = get_session(&conn, "managed").unwrap().unwrap();
        assert_eq!(record.blocks[0]["author"]["name"], "Owner Name");
    }
    #[test]
    fn manual_provenance_keeps_distinct_source_and_rejects_client_forgery() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let mut session = sample();
        session.managed_by =
            Some(json!({"assistant":true,"supervisionId":"manual-grant","managedAt":123}));
        session.blocks[0]["author"] = json!({"kind":"assistant-manual","name":"Owner Name","supervisionId":"manual-grant","reason":"nudge","operationId":"manual-operation"});
        let mut forged = session.clone();
        assert!(protect_client_upsert(&conn, &mut forged).is_err());
        upsert_session(&conn, &session).unwrap();
        let record = get_session(&conn, "managed").unwrap().unwrap();
        assert_eq!(
            record.managed_by.as_ref().unwrap()["supervisionId"],
            "manual-grant"
        );
        assert!(record.managed_by.as_ref().unwrap().get("jobId").is_none());
        assert_eq!(record.blocks[0]["author"]["kind"], "assistant-manual");
        let mut omitted = session.clone();
        omitted.managed_by = None;
        omitted.blocks[0].as_object_mut().unwrap().remove("author");
        protect_client_upsert(&conn, &mut omitted).unwrap();
        upsert_session(&conn, &omitted).unwrap();
        assert_eq!(
            get_session(&conn, "managed").unwrap().unwrap().managed_by,
            session.managed_by
        );
        assert_eq!(omitted.blocks[0]["author"], session.blocks[0]["author"]);
        forged = session;
        forged.blocks[0]["author"]["supervisionId"] = json!("other-grant");
        assert!(protect_client_upsert(&conn, &mut forged).is_err());
    }
    #[test]
    fn schema_repair_restores_provenance_column_without_losing_existing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let mut session = sample();
        session.managed_by = None;
        session.blocks[0].as_object_mut().unwrap().remove("author");
        upsert_session(&conn, &session).unwrap();
        conn.execute_batch("DROP VIEW session_transcripts; ALTER TABLE sessions RENAME COLUMN assistant_management_json TO retired_management;").unwrap();
        migrate(&conn).unwrap();
        let record = get_session(&conn, "managed").unwrap().unwrap();
        assert_eq!(record.blocks[0]["text"], "Continue");
        assert!(record.managed_by.is_none());
    }
}
