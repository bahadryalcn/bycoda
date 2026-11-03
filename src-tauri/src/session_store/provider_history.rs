use super::*;

/// Read provenance only. Normalized transcripts use the role index and never
/// reconstruct tool output or the full transcript for a sidebar list.
pub(super) fn stored(conn: &Connection, id: &str, harness: &str) -> rusqlite::Result<Value> {
    let normalized: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_block_state WHERE session_id=?1 AND length>=0)",
        [id],
        |row| row.get(0),
    )?;
    let projection = "json_object('role',json_extract(block_json,'$.role'),
        'draft',json_extract(block_json,'$.draft'),
        'workspacePreparationPending',json_extract(block_json,'$.workspacePreparationPending'),
        'followUpDelivery',json_extract(block_json,'$.followUpDelivery'),
        'turnModel',json_extract(block_json,'$.turnModel'),
        'handoff',json_extract(block_json,'$.handoff'))";
    let sql = if normalized {
        format!("SELECT {projection} FROM session_blocks INDEXED BY session_blocks_roles
            WHERE session_id=?1 AND json_extract(block_json,'$.role') IN ('user','handoff') ORDER BY ordinal")
    } else {
        format!("SELECT {projection} FROM
            (SELECT value AS block_json FROM json_each((SELECT CASE WHEN json_valid(blocks_json) THEN blocks_json ELSE '[]' END FROM sessions WHERE id=?1)))
            WHERE json_extract(block_json,'$.role') IN ('user','handoff')")
    };
    let mut statement = conn.prepare(&sql)?;
    let facts = statement
        .query_map([id], |row| row.get::<_, String>(0))?
        .map(|row| row.map(|raw| serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null)))
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(derive(&facts, harness))
}

pub(super) fn derive(blocks: &[Value], harness: &str) -> Value {
    let mut inferred = blocks
        .iter()
        .find_map(|block| block["handoff"]["from"].as_str())
        .unwrap_or(harness);
    let mut providers: Vec<&str> = Vec::new();
    let mut active: Option<&str> = None;
    let mut from: Option<&str> = None;
    let mut active_model: Option<&str> = None;
    for block in blocks {
        let handoff = &block["handoff"];
        if handoff["status"] == "ready" && handoff["pending"] != true {
            if let Some(to) = handoff["to"].as_str() {
                inferred = to;
            }
        }
        if block["role"] != "user"
            || block["draft"] == true
            || block["draft"] == 1
            || block["workspacePreparationPending"] == true
            || block["workspacePreparationPending"] == 1
            || !block["followUpDelivery"].is_null()
        {
            continue;
        }
        let used = block["turnModel"]["harness"].as_str().unwrap_or(inferred);
        if !providers.contains(&used) {
            providers.push(used);
        }
        if active.is_some() && active != Some(used) {
            from = active;
        }
        active = Some(used);
        active_model = block["turnModel"]["name"]
            .as_str()
            .filter(|name| !name.is_empty())
            .or_else(|| block["turnModel"]["id"].as_str());
    }
    if active.is_none() {
        providers.push(harness);
    }
    let mut result = json!({"providers": providers, "activeHarness": active.unwrap_or(harness)});
    if let Some(from) = from {
        result["handedOffFrom"] = json!(from);
    }
    if let Some(model) = active_model {
        result["activeModel"] = json!(model);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_actual_turns_without_marking_failed_or_draft_targets_used() {
        let facts = json!([
            {"role":"user","turnModel":{"harness":"claude"}},
            {"role":"handoff","handoff":{"from":"claude","to":"cursor","status":"failed"}},
            {"role":"user","draft":true,"turnModel":{"harness":"cursor"}},
            {"role":"handoff","handoff":{"from":"claude","to":"codex","status":"ready"}},
            {"role":"user"},
            {"role":"user","turnModel":{"harness":"claude"}}
        ]);
        assert_eq!(
            derive(facts.as_array().unwrap(), "cursor"),
            json!({
                "providers":["claude","codex"],"activeHarness":"claude","handedOffFrom":"codex"
            })
        );
    }

    #[test]
    fn reads_legacy_and_normalized_provenance_with_the_same_result() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY, blocks_json TEXT);
            CREATE TABLE session_block_state(session_id TEXT PRIMARY KEY,length INTEGER);
            CREATE TABLE session_blocks(session_id TEXT,ordinal INTEGER,block_json TEXT);
            CREATE INDEX session_blocks_roles ON session_blocks(session_id,json_extract(block_json,'$.role'),json_extract(block_json,'$.draft'));").unwrap();
        let blocks = json!([
            {"role":"user","turnModel":{"harness":"claude"}},
            {"role":"handoff","handoff":{"from":"claude","to":"codex","status":"ready"}},
            {"role":"user","turnModel":{"harness":"codex"}}
        ]);
        conn.execute("INSERT INTO sessions VALUES ('s',?1)", [blocks.to_string()])
            .unwrap();
        let expected = json!({"providers":["claude","codex"],"activeHarness":"codex","handedOffFrom":"claude"});
        assert_eq!(stored(&conn, "s", "codex").unwrap(), expected);
        conn.execute("INSERT INTO session_block_state VALUES ('s',3)", [])
            .unwrap();
        for (index, block) in blocks.as_array().unwrap().iter().enumerate() {
            conn.execute(
                "INSERT INTO session_blocks VALUES ('s',?1,?2)",
                params![index as i64, block.to_string()],
            )
            .unwrap();
        }
        conn.execute("UPDATE sessions SET blocks_json='[]' WHERE id='s'", [])
            .unwrap();
        assert_eq!(stored(&conn, "s", "codex").unwrap(), expected);
    }
}
