//! Bounded metadata-only usage projection; never transfers transcript text to the UI.
use super::SessionStore;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTurn {
    session_id: String,
    title: String,
    project: String,
    provider: String,
    account_id: Option<String>,
    model: String,
    started_at: i64,
    duration_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cache_read_tokens: Option<i64>,
    cache_write_tokens: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTurnReport {
    turns: Vec<UsageTurn>,
    truncated: bool,
}

fn query(conn: &Connection, since_ms: i64, until_ms: i64) -> Result<UsageTurnReport, String> {
    let mut statement = conn.prepare(
        "WITH blocks AS (
          SELECT b.session_id, b.ordinal, b.block_json AS value FROM session_blocks b
           JOIN session_block_state st ON st.session_id=b.session_id WHERE st.length>=0
          UNION ALL
          SELECT s.id, CAST(b.key AS INTEGER), b.value FROM sessions s, json_each(s.blocks_json) b
           WHERE NOT EXISTS(SELECT 1 FROM session_block_state st WHERE st.session_id=s.id AND st.length>=0)
         ) SELECT s.id, s.title, s.cwd,
          COALESCE(json_extract(b.value, '$.turnModel.harness'), s.harness), s.provider_account_id,
          COALESCE(json_extract(b.value, '$.turnModel.id'), s.model),
          json_extract(b.value, '$.startedAt'), json_extract(b.value, '$.durationMs'),
          json_extract(b.value, '$.turnMetrics.inputTokens'), json_extract(b.value, '$.turnMetrics.outputTokens'),
          json_extract(b.value, '$.turnMetrics.cacheReadTokens'), json_extract(b.value, '$.turnMetrics.cacheWriteTokens')
         FROM sessions s JOIN blocks b ON b.session_id=s.id
         WHERE json_extract(b.value, '$.role') = 'user'
          AND COALESCE(json_extract(b.value, '$.draft'), 0) = 0
          AND json_type(b.value, '$.startedAt') IN ('integer', 'real')
          AND json_extract(b.value, '$.startedAt') < ?2
          AND json_extract(b.value, '$.startedAt') + MAX(0, COALESCE(json_extract(b.value, '$.durationMs'), 0)) >= ?1
         ORDER BY json_extract(b.value, '$.startedAt') DESC, s.id, b.ordinal
         LIMIT 50001"
    ).map_err(|e| e.to_string())?;
    let mut turns = statement
        .query_map(params![since_ms, until_ms], |row| {
            Ok(UsageTurn {
                session_id: row.get(0)?,
                title: row.get(1)?,
                project: row.get(2)?,
                provider: row.get(3)?,
                account_id: row.get(4)?,
                model: row.get(5)?,
                started_at: row.get(6)?,
                duration_ms: row.get(7)?,
                input_tokens: row.get(8)?,
                output_tokens: row.get(9)?,
                cache_read_tokens: row.get(10)?,
                cache_write_tokens: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let truncated = turns.len() > 50000;
    turns.truncate(50000);
    Ok(UsageTurnReport { turns, truncated })
}

#[tauri::command]
pub async fn session_usage_report(
    app: tauri::AppHandle,
    since_ms: i64,
    until_ms: i64,
) -> Result<UsageTurnReport, String> {
    use tauri::Manager;
    if since_ms < 0 || until_ms <= since_ms {
        return Err("Invalid usage interval".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let store: State<'_, SessionStore> = app.state();
        store.with_read_conn(|conn| query(conn, since_ms, until_ms))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projects_only_turn_metadata_and_includes_overlapping_intervals() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, cwd TEXT, harness TEXT, model TEXT, provider_account_id TEXT, blocks_json TEXT);").unwrap();
        super::super::incremental::ensure_schema(&conn).unwrap();
        let blocks = serde_json::json!([
            {"role":"user","text":"private prompt","startedAt":1000,"durationMs":3000,"turnMetrics":{"inputTokens":12,"outputTokens":5}},
            {"role":"user","startedAt":5000,"durationMs":100},
            {"role":"user","startedAt":2500,"draft":true},
            {"role":"assistant","startedAt":2500}
        ]);
        conn.execute(
            "INSERT INTO sessions VALUES ('s', 'Title', '/app', 'codex', 'gpt', 'work', ?1)",
            [blocks.to_string()],
        )
        .unwrap();
        let report = query(&conn, 2000, 5000).unwrap();
        assert_eq!(report.turns.len(), 1);
        assert_eq!(report.turns[0].duration_ms, Some(3000));
        assert_eq!(report.turns[0].input_tokens, Some(12));
        assert!(!serde_json::to_string(&report)
            .unwrap()
            .contains("private prompt"));
        conn.execute("INSERT INTO session_block_state VALUES ('s', 1, 1)", [])
            .unwrap();
        conn.execute("INSERT INTO session_blocks VALUES ('s', 0, 'u', ?1, 1)", [serde_json::json!({"role":"user","startedAt":2200,"durationMs":500,"turnModel":{"id":"turn-model","harness":"claude"}}).to_string()]).unwrap();
        let report = query(&conn, 2000, 5000).unwrap();
        assert_eq!(report.turns.len(), 1);
        assert_eq!(report.turns[0].model, "turn-model");
        assert_eq!(report.turns[0].provider, "claude");
        assert_eq!(report.turns[0].duration_ms, Some(500));
    }
}
