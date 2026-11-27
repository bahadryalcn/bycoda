//! OpenCode keeps every session in one SQLite database,
//! `<XDG_DATA_HOME>/opencode/opencode.db`. Current builds use `session_v2` and
//! `session_message` (tool calls and their results inline in assistant
//! messages); earlier ones used `session`, `message` and `part`.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::entries::{content_text, typed_text, EntryLog};
use super::{collapse, CodexTranscript, ImportCandidate, ImportKind};
use crate::cursor_store::open_read_only;
use crate::fs::path_to_js;

fn has_table(connection: &Connection, name: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Schema {
    V2,
    V1,
}

fn schema(connection: &Connection) -> Option<Schema> {
    if has_table(connection, "session_v2") && has_table(connection, "session_message") {
        Some(Schema::V2)
    } else if has_table(connection, "session") && has_table(connection, "message") {
        Some(Schema::V1)
    } else {
        None
    }
}

fn model_id(raw: Option<String>) -> Option<String> {
    let raw = raw?;
    match serde_json::from_str::<Value>(&raw) {
        Ok(value) => value
            .get("id")
            .or_else(|| value.get("modelID"))
            .and_then(Value::as_str)
            .map(str::to_string),
        Err(_) => Some(raw).filter(|raw| !raw.is_empty()),
    }
}

/// Sessions in the database; `scanned` counts every row looked at.
pub(super) fn discover(db: &Path) -> (Vec<ImportCandidate>, usize) {
    let Ok(connection) = open_read_only(db) else {
        return (Vec::new(), 0);
    };
    match schema(&connection) {
        Some(Schema::V2) => discover_v2(&connection, db).unwrap_or_default(),
        Some(Schema::V1) => discover_v1(&connection, db).unwrap_or_default(),
        None => (Vec::new(), 0),
    }
}

struct Row {
    id: String,
    parent: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    created: i64,
    updated: i64,
    archived: bool,
}

fn candidate(db: &Path, row: Row, prompt: String, size: i64) -> Option<ImportCandidate> {
    let cwd = row.cwd.filter(|cwd| !cwd.is_empty())?;
    let started_at = u64::try_from(row.created).unwrap_or(0);
    let last_at = u64::try_from(row.updated).unwrap_or(0).max(started_at);
    Some(ImportCandidate {
        provider: "opencode",
        path: path_to_js(db),
        provider_session_id: row.id,
        cwd,
        cwd_exists: false,
        resumable: true,
        first_prompt: prompt,
        started_at,
        last_at,
        size_bytes: u64::try_from(size).unwrap_or(0),
        kind: if row.parent.is_some() {
            ImportKind::Subagent
        } else {
            ImportKind::Interactive
        },
        model: row.model,
        archived: row.archived,
    })
}

fn discover_v2(
    connection: &Connection,
    db: &Path,
) -> rusqlite::Result<(Vec<ImportCandidate>, usize)> {
    let mut statement = connection.prepare(
        "SELECT id, parent_id, directory, model, time_created, time_updated, time_archived
         FROM session_v2",
    )?;
    let rows: Vec<Row> = statement
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                parent: row.get(1)?,
                cwd: row.get(2)?,
                model: model_id(row.get(3)?),
                created: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                updated: row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                archived: row.get::<_, Option<i64>>(6)?.is_some(),
            })
        })?
        .flatten()
        .collect();
    let scanned = rows.len();
    let mut prompts = connection.prepare(
        "SELECT data FROM session_message WHERE session_id = ?1 AND type = 'user'
         ORDER BY seq LIMIT 8",
    )?;
    let mut sizes = connection.prepare(
        "SELECT COALESCE(SUM(LENGTH(data)), 0), MAX(time_created) FROM session_message
         WHERE session_id = ?1",
    )?;
    let mut found = Vec::new();
    for mut row in rows {
        let prompt = prompts
            .query_map(params![row.id], |row| row.get::<_, String>(0))?
            .flatten()
            .filter_map(|data| serde_json::from_str::<Value>(&data).ok())
            .map(|data| content_text(data.get("text").unwrap_or(&Value::Null)))
            .find_map(|text| typed_text(&text).map(collapse));
        let Some(prompt) = prompt else { continue };
        let (size, newest): (i64, Option<i64>) =
            sizes.query_row(params![row.id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        row.updated = row.updated.max(newest.unwrap_or(0));
        found.extend(candidate(db, row, prompt, size));
    }
    Ok((found, scanned))
}

/// The text a v1 user message was written with: its non-synthetic text parts.
fn v1_text(connection: &Connection, message: &str) -> rusqlite::Result<String> {
    let mut statement =
        connection.prepare("SELECT data FROM part WHERE message_id = ?1 ORDER BY id")?;
    let parts: Vec<Value> = statement
        .query_map([message], |row| row.get::<_, String>(0))?
        .flatten()
        .filter_map(|data| serde_json::from_str(&data).ok())
        .collect();
    Ok(parts
        .iter()
        .filter(|part| {
            part.get("type").and_then(Value::as_str) == Some("text")
                && part.get("synthetic").and_then(Value::as_bool) != Some(true)
        })
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n"))
}

fn discover_v1(
    connection: &Connection,
    db: &Path,
) -> rusqlite::Result<(Vec<ImportCandidate>, usize)> {
    let mut statement = connection
        .prepare("SELECT id, parent_id, directory, time_created, time_updated FROM session")?;
    let rows: Vec<Row> = statement
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                parent: row.get(1)?,
                cwd: row.get(2)?,
                model: None,
                created: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                updated: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                archived: false,
            })
        })?
        .flatten()
        .collect();
    let scanned = rows.len();
    let mut messages = connection
        .prepare("SELECT id, data FROM message WHERE session_id = ?1 ORDER BY time_created, id")?;
    let mut found = Vec::new();
    for mut row in rows {
        let listed: Vec<(String, String)> = messages
            .query_map(params![row.id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .flatten()
            .collect();
        let size = listed.iter().map(|(_, data)| data.len() as i64).sum();
        let mut prompt = None;
        for (id, data) in &listed {
            let Ok(message) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            match message.get("role").and_then(Value::as_str) {
                Some("user") if prompt.is_none() => {
                    let text = v1_text(connection, id)?;
                    prompt = typed_text(&text).map(collapse);
                }
                Some("assistant") if row.model.is_none() => {
                    row.model = message
                        .get("modelID")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
                _ => {}
            }
        }
        let Some(prompt) = prompt else { continue };
        found.extend(candidate(db, row, prompt, size));
    }
    Ok((found, scanned))
}

fn tool_output(state: &Value) -> String {
    if let Some(error) = state.get("error").and_then(Value::as_str) {
        return error.to_string();
    }
    match state.get("content").or_else(|| state.get("output")) {
        Some(value) => content_text(value),
        None => String::new(),
    }
}

pub(super) fn read(
    db: &Path,
    session_id: &str,
    max_bytes: usize,
) -> Result<CodexTranscript, String> {
    let connection = open_read_only(db)?;
    let mut log = EntryLog::new(max_bytes);
    match schema(&connection) {
        Some(Schema::V2) => read_v2(&connection, session_id, &mut log),
        Some(Schema::V1) => read_v1(&connection, session_id, &mut log),
        None => return Err("Not an OpenCode database".into()),
    }
    .map_err(|error| error.to_string())?;
    Ok(log.finish())
}

fn read_v2(connection: &Connection, session_id: &str, log: &mut EntryLog) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(
        "SELECT type, time_created, data FROM session_message
         WHERE session_id = ?1 AND type IN ('user', 'assistant') ORDER BY seq",
    )?;
    let rows = statement.query_map([session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for (kind, created, data) in rows.flatten() {
        let Ok(data) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        let at = u64::try_from(created.unwrap_or(0)).unwrap_or(0);
        if kind == "user" {
            log.user(at, &content_text(data.get("text").unwrap_or(&Value::Null)));
            continue;
        }
        let mut text = String::new();
        for part in data
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(chunk) = part.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(chunk);
                    }
                }
                Some("tool") => {
                    log.assistant(at, &std::mem::take(&mut text));
                    let name = part.get("name").and_then(Value::as_str).unwrap_or("");
                    let state = part.get("state").unwrap_or(&Value::Null);
                    log.tool_with_output(
                        at,
                        part.get("id").and_then(Value::as_str),
                        name,
                        state.get("input").unwrap_or(&Value::Null),
                        &tool_output(state),
                    );
                }
                _ => {}
            }
        }
        log.assistant(at, &text);
    }
    Ok(())
}

fn read_v1(connection: &Connection, session_id: &str, log: &mut EntryLog) -> rusqlite::Result<()> {
    let mut messages = connection
        .prepare("SELECT id, data FROM message WHERE session_id = ?1 ORDER BY time_created, id")?;
    let listed: Vec<(String, String)> = messages
        .query_map([session_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .flatten()
        .collect();
    let mut parts =
        connection.prepare("SELECT data FROM part WHERE message_id = ?1 ORDER BY id")?;
    for (id, data) in listed {
        let Ok(message) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        let at = message
            .pointer("/time/created")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let role = message.get("role").and_then(Value::as_str);
        let rows: Vec<Value> = parts
            .query_map([&id], |row| row.get::<_, String>(0))?
            .flatten()
            .filter_map(|data| serde_json::from_str(&data).ok())
            .collect();
        let mut text = String::new();
        for part in rows {
            match part.get("type").and_then(Value::as_str) {
                Some("text") if part.get("synthetic").and_then(Value::as_bool) != Some(true) => {
                    if let Some(chunk) = part.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(chunk);
                    }
                }
                Some("tool") if role == Some("assistant") => {
                    log.assistant(at, &std::mem::take(&mut text));
                    let state = part.get("state").unwrap_or(&Value::Null);
                    log.tool_with_output(
                        at,
                        part.get("callID").and_then(Value::as_str),
                        part.get("tool").and_then(Value::as_str).unwrap_or(""),
                        state.get("input").unwrap_or(&Value::Null),
                        &tool_output(state),
                    );
                }
                _ => {}
            }
        }
        match role {
            Some("user") => log.user(at, &text),
            Some("assistant") => log.assistant(at, &text),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_v2_sessions_with_inline_tool_calls() {
        let dir =
            std::env::temp_dir().join(format!("bycoda-opencode-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("opencode.db");
        {
            let connection = Connection::open(&db).unwrap();
            connection
                .execute_batch(
                    r#"
                    CREATE TABLE session_v2 (id TEXT, parent_id TEXT, directory TEXT, title TEXT,
                      model TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
                    CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, seq INTEGER,
                      time_created INTEGER, time_updated INTEGER, data TEXT);
                    INSERT INTO session_v2 VALUES ('ses_a', NULL, 'G:/work', NULL,
                      '{"id":"glm-5","providerID":"opencode"}', 1000, 2000, NULL);
                    INSERT INTO session_v2 VALUES ('ses_empty', NULL, 'G:/work', NULL, NULL, 1, 2, NULL);
                    INSERT INTO session_message VALUES ('m1','ses_a','user',1,1000,1000,
                      '{"text":"bycoda tools for this session: ..."}');
                    INSERT INTO session_message VALUES ('m2','ses_a','user',2,1100,1100,
                      '{"text":"add a test"}');
                    INSERT INTO session_message VALUES ('m3','ses_a','assistant',3,1200,1300,
                      '{"content":[{"type":"reasoning","text":"x"},{"type":"tool","id":"call-1","name":"shell","state":{"status":"completed","input":{"command":"ls"},"content":[{"type":"text","text":"a.rs"}]}},{"type":"text","text":"Done."}]}');
                    INSERT INTO session_message VALUES ('m4','ses_a','system',4,3000,3000,
                      '{"text":"The server restarted"}');
                    "#,
                )
                .unwrap();
        }
        let (found, scanned) = discover(&db);
        assert_eq!(scanned, 2);
        assert_eq!(found.len(), 1);
        let session = &found[0];
        assert_eq!(session.provider_session_id, "ses_a");
        assert_eq!(session.first_prompt, "add a test");
        assert_eq!(session.model.as_deref(), Some("glm-5"));
        assert_eq!(session.last_at, 3000);

        let transcript = read(&db, "ses_a", 1 << 20).unwrap();
        let kinds: Vec<_> = transcript.entries.iter().map(|entry| entry.kind).collect();
        assert_eq!(kinds, ["user", "tool", "assistant"]);
        assert_eq!(transcript.entries[1].name.as_deref(), Some("shell"));
        assert_eq!(transcript.entries[1].output.as_deref(), Some("a.rs"));
        std::fs::remove_dir_all(dir).ok();
    }
}
