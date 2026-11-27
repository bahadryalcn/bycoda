//! The Cursor agent CLI keeps each session in its own SQLite store,
//! `~/.cursor/acp-sessions/<id>/store.db` (earlier `chats/<hash>/<id>/`).
//! Messages are JSON blobs in insertion order; the folder a session ran in is
//! only stated in the `<user_info>` context Cursor injects ahead of the first
//! prompt, so a store without it is skipped.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

use super::entries::{arguments, content_text, EntryLog};
use super::{collapse, modified_ms, tag_text, CodexTranscript, ImportCandidate, ImportKind};
use crate::cursor_store::{open_read_only, read_cursor_metadata};
use crate::fs::path_to_js;

/// Blobs larger than this are snapshots, not messages.
const MAX_BLOB_BYTES: i64 = 2 * 1024 * 1024;
/// How many messages discovery reads looking for the folder and first prompt.
const HEAD_MESSAGES: usize = 64;

/// Every `store.db` under `~/.cursor`.
pub(super) fn stores(cursor: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut add = |dir: &Path| {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let store = entry.path().join("store.db");
                if store.is_file() {
                    found.push(store);
                }
            }
        }
    };
    add(&cursor.join("acp-sessions"));
    if let Ok(projects) = std::fs::read_dir(cursor.join("chats")) {
        for project in projects.flatten() {
            add(&project.path());
        }
    }
    found
}

fn messages(connection: &Connection, limit: Option<usize>) -> rusqlite::Result<Vec<Value>> {
    let mut statement = connection.prepare(
        "SELECT data FROM blobs WHERE length(data) <= ?1 AND substr(data, 1, 1) = x'7b'
         ORDER BY rowid",
    )?;
    let rows = statement.query_map([MAX_BLOB_BYTES], |row| row.get::<_, Vec<u8>>(0))?;
    let mut found = Vec::new();
    for data in rows.flatten() {
        let Ok(value) = serde_json::from_slice::<Value>(&data) else {
            continue;
        };
        if value.get("role").is_some() {
            found.push(value);
            if limit.is_some_and(|limit| found.len() >= limit) {
                break;
            }
        }
    }
    Ok(found)
}

/// The prompt inside Cursor's `<user_query>` wrapper; other user messages are
/// context it injected.
fn typed_prompt(message: &Value) -> Option<String> {
    let text = content_text(message.get("content")?);
    let query = tag_text(&text, "user_query")?;
    (!query.is_empty()).then(|| query.to_string())
}

fn workspace_path(message: &Value) -> Option<String> {
    let text = content_text(message.get("content")?);
    let line = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("Workspace Path:"))?;
    let path = line.trim();
    (!path.is_empty()).then(|| path.to_string())
}

fn store_modified(store: &Path) -> u64 {
    let mut wal = store.as_os_str().to_os_string();
    wal.push("-wal");
    modified_ms(store).max(modified_ms(Path::new(&wal)))
}

pub(super) fn discover(store: &Path) -> Option<ImportCandidate> {
    let connection = open_read_only(store).ok()?;
    let meta = read_cursor_metadata(&connection).unwrap_or(Value::Null);
    let id = meta
        .get("agentId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| Some(store.parent()?.file_name()?.to_str()?.to_string()))?;
    let head = messages(&connection, Some(HEAD_MESSAGES)).ok()?;
    let user = |message: &&Value| message.get("role").and_then(Value::as_str) == Some("user");
    let cwd = head.iter().filter(user).find_map(workspace_path)?;
    let prompt = head.iter().filter(user).find_map(typed_prompt)?;
    let model = head.iter().find_map(|message| {
        message
            .pointer("/providerOptions/cursor/systemPromptFingerprint/model")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let last_at = store_modified(store);
    let started_at = meta
        .get("createdAt")
        .and_then(Value::as_u64)
        .filter(|at| *at > 0 && *at <= last_at)
        .unwrap_or(last_at);
    let size = std::fs::metadata(store).map(|meta| meta.len()).unwrap_or(0);
    Some(ImportCandidate {
        provider: "cursor",
        path: path_to_js(store),
        provider_session_id: id,
        cwd,
        cwd_exists: false,
        resumable: true,
        first_prompt: collapse(&prompt),
        started_at,
        last_at,
        size_bytes: size,
        kind: if meta.get("subagentInfo").is_some() {
            ImportKind::Subagent
        } else {
            ImportKind::Interactive
        },
        model,
        archived: false,
    })
}

pub(super) fn read(store: &Path, max_bytes: usize) -> Result<CodexTranscript, String> {
    let connection = open_read_only(store)?;
    let mut log = EntryLog::new(max_bytes);
    for message in messages(&connection, None).map_err(|error| error.to_string())? {
        let content = message.get("content").unwrap_or(&Value::Null);
        match message.get("role").and_then(Value::as_str) {
            Some("user") => {
                if let Some(prompt) = typed_prompt(&message) {
                    log.user(0, &prompt);
                }
            }
            Some("assistant") => {
                let Some(parts) = content.as_array() else {
                    log.assistant(0, &content_text(content));
                    continue;
                };
                let mut text = String::new();
                for part in parts {
                    match part.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(chunk) = part.get("text").and_then(Value::as_str) {
                                if !text.is_empty() {
                                    text.push('\n');
                                }
                                text.push_str(chunk);
                            }
                        }
                        Some("tool-call") => {
                            log.assistant(0, &std::mem::take(&mut text));
                            log.tool(
                                0,
                                part.get("toolCallId").and_then(Value::as_str),
                                part.get("toolName").and_then(Value::as_str).unwrap_or(""),
                                &arguments(part.get("args").or_else(|| part.get("input"))),
                            );
                        }
                        _ => {}
                    }
                }
                log.assistant(0, &text);
            }
            Some("tool") => {
                for part in content.as_array().into_iter().flatten() {
                    if let Some(id) = part.get("toolCallId").and_then(Value::as_str) {
                        let result = part
                            .get("result")
                            .or_else(|| part.get("output"))
                            .unwrap_or(&Value::Null);
                        log.tool_output(id, &content_text(result));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(log.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn imports_a_cli_store_with_its_workspace_folder() {
        let dir =
            std::env::temp_dir().join(format!("bycoda-cursor-import-{}", uuid::Uuid::new_v4()));
        let folder = dir.join("acp-sessions").join("agent-1");
        std::fs::create_dir_all(&folder).unwrap();
        let store = folder.join("store.db");
        {
            let connection = Connection::open(&store).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
                     CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);",
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO meta VALUES ('0', ?1)",
                    [json!({"agentId": "agent-1"}).to_string()],
                )
                .unwrap();
            let blobs = [
                json!({"role":"system","content":"You are Cursor"}),
                json!({"role":"user","content":[{"type":"text","text":"<user_info>\nWorkspace Path: C:\\work\\app\n</user_info>"}]}),
                json!({"role":"user","content":[{"type":"text","text":"<user_query>\nrename foo\n</user_query>"}]}),
                json!({"role":"assistant","content":[{"type":"text","text":"Renaming."},{"type":"tool-call","toolCallId":"t1","toolName":"Shell","args":{"command":"rg foo"}}]}),
                json!({"role":"tool","content":[{"type":"tool-result","toolCallId":"t1","result":"a.rs:1"}]}),
            ];
            for (index, blob) in blobs.iter().enumerate() {
                connection
                    .execute(
                        "INSERT INTO blobs VALUES (?1, ?2)",
                        rusqlite::params![index.to_string(), blob.to_string().into_bytes()],
                    )
                    .unwrap();
            }
        }
        assert_eq!(stores(&dir), vec![store.clone()]);
        let candidate = discover(&store).unwrap();
        assert_eq!(candidate.provider_session_id, "agent-1");
        assert_eq!(candidate.cwd, "C:\\work\\app");
        assert_eq!(candidate.first_prompt, "rename foo");

        let transcript = read(&store, 1 << 20).unwrap();
        let kinds: Vec<_> = transcript.entries.iter().map(|entry| entry.kind).collect();
        assert_eq!(kinds, ["user", "assistant", "tool"]);
        assert_eq!(transcript.entries[2].name.as_deref(), Some("shell"));
        assert_eq!(transcript.entries[2].output.as_deref(), Some("a.rs:1"));
        std::fs::remove_dir_all(dir).ok();
    }
}
