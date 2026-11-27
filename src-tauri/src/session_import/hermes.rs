//! Hermes Agent keeps sessions and messages in `<HERMES_HOME>/state.db`
//! (one more per profile under `profiles/<name>/`). Times are Unix seconds.
//! The ACP adapter, which Bycoda drives, stores its sessions with
//! `source = 'acp'` under the ACP session id, so only those can be resumed.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::Value;

use super::entries::{arguments, content_text, typed_text, EntryLog};
use super::{collapse, CodexTranscript, ImportCandidate, ImportKind};
use crate::cursor_store::open_read_only;
use crate::fs::path_to_js;

/// `state.db` of every home, and of each profile in it.
pub(super) fn databases(homes: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for home in homes {
        let db = home.join("state.db");
        if db.is_file() {
            found.push(db);
        }
        if let Ok(profiles) = std::fs::read_dir(home.join("profiles")) {
            for profile in profiles.flatten() {
                let db = profile.path().join("state.db");
                if db.is_file() {
                    found.push(db);
                }
            }
        }
    }
    found
}

fn columns(connection: &Connection, table: &str) -> HashSet<String> {
    let Ok(mut statement) = connection.prepare(&format!("PRAGMA table_info({table})")) else {
        return HashSet::new();
    };
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// `name`, or `NULL` when this database predates the column.
fn column(present: &HashSet<String>, name: &str) -> String {
    if present.contains(name) {
        name.to_string()
    } else {
        format!("NULL AS {name}")
    }
}

fn seconds_to_ms(value: Option<f64>) -> u64 {
    value
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
        .map(|seconds| (seconds * 1000.0) as u64)
        .unwrap_or(0)
}

/// Hermes running under WSL records `/mnt/<drive>/...` for a Windows folder.
fn native_path(path: &str) -> String {
    if cfg!(windows) {
        if let Some(rest) = path.strip_prefix("/mnt/") {
            let mut chars = rest.chars();
            if let (Some(drive), next) = (chars.next(), chars.next()) {
                if drive.is_ascii_alphabetic() && matches!(next, None | Some('/')) {
                    let tail = rest.get(2..).unwrap_or("");
                    return format!("{}:/{tail}", drive.to_ascii_uppercase());
                }
            }
        }
    }
    path.to_string()
}

pub(super) fn discover(db: &Path) -> (Vec<ImportCandidate>, usize) {
    let Ok(connection) = open_read_only(db) else {
        return (Vec::new(), 0);
    };
    discover_in(&connection, db).unwrap_or_default()
}

fn discover_in(
    connection: &Connection,
    db: &Path,
) -> rusqlite::Result<(Vec<ImportCandidate>, usize)> {
    let present = columns(connection, "sessions");
    if present.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let message_columns = columns(connection, "messages");
    let sql = format!(
        "SELECT id, source, model, started_at, ended_at, {}, {}, {}, {}, {}
         FROM sessions",
        column(&present, "last_activity_at"),
        column(&present, "cwd"),
        column(&present, "model_config"),
        column(&present, "git_repo_root"),
        column(&present, "hidden"),
    );
    let mut statement = connection.prepare(&sql)?;
    struct Row {
        id: String,
        source: Option<String>,
        model: Option<String>,
        started: Option<f64>,
        ended: Option<f64>,
        activity: Option<f64>,
        cwd: Option<String>,
        config: Option<String>,
        repo: Option<String>,
        hidden: bool,
    }
    let rows: Vec<Row> = statement
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                source: row.get(1)?,
                model: row.get(2)?,
                started: row.get(3)?,
                ended: row.get(4)?,
                activity: row.get(5)?,
                cwd: row.get(6)?,
                config: row.get(7)?,
                repo: row.get(8)?,
                hidden: row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
            })
        })?
        .flatten()
        .collect();
    let scanned = rows.len();
    let visible = if message_columns.contains("active") && message_columns.contains("compacted") {
        " AND (active = 1 OR compacted = 1)"
    } else {
        ""
    };
    let mut prompts = connection.prepare(&format!(
        "SELECT content FROM messages WHERE session_id = ?1 AND role = 'user'{visible}
         ORDER BY id LIMIT 8"
    ))?;
    let mut totals = connection.prepare(
        "SELECT MAX(timestamp), COALESCE(SUM(LENGTH(content)), 0) FROM messages
         WHERE session_id = ?1",
    )?;
    let mut found = Vec::new();
    for row in rows {
        if row.hidden {
            continue;
        }
        let config_cwd = row
            .config
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|config| {
                config
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        let Some(cwd) = row
            .cwd
            .clone()
            .or(config_cwd)
            .or(row.repo.clone())
            .filter(|cwd| !cwd.is_empty())
        else {
            continue;
        };
        let prompt = prompts
            .query_map(params![row.id], |row| row.get::<_, Option<String>>(0))?
            .flatten()
            .flatten()
            .find_map(|text| typed_text(&text).map(collapse));
        let Some(prompt) = prompt else { continue };
        let (newest, size): (Option<f64>, i64) =
            totals.query_row(params![row.id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let started_at = seconds_to_ms(row.started);
        let last_at = [row.ended, row.activity, newest]
            .into_iter()
            .map(seconds_to_ms)
            .max()
            .unwrap_or(0)
            .max(started_at);
        let source = row.source.as_deref().unwrap_or("");
        found.push(ImportCandidate {
            provider: "hermes",
            path: path_to_js(db),
            provider_session_id: row.id,
            cwd: native_path(&cwd),
            cwd_exists: false,
            resumable: source == "acp",
            first_prompt: prompt,
            started_at: if started_at > 0 { started_at } else { last_at },
            last_at,
            size_bytes: u64::try_from(size).unwrap_or(0),
            kind: match source {
                "subagent" => ImportKind::Subagent,
                "cron" | "kanban" => ImportKind::Exec,
                // A parent also links compression continuations, which are
                // the same conversation, so only the source decides.
                _ => ImportKind::Interactive,
            },
            model: row.model.filter(|model| !model.is_empty()),
            archived: false,
        });
    }
    Ok((found, scanned))
}

pub(super) fn read(
    db: &Path,
    session_id: &str,
    max_bytes: usize,
) -> Result<CodexTranscript, String> {
    let connection = open_read_only(db)?;
    let present = columns(&connection, "messages");
    let visible = if present.contains("active") && present.contains("compacted") {
        " AND (active = 1 OR compacted = 1)"
    } else {
        ""
    };
    let sql = format!(
        "SELECT role, content, {}, {}, timestamp FROM messages
         WHERE session_id = ?1{visible} ORDER BY id",
        column(&present, "tool_calls"),
        column(&present, "tool_call_id"),
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<f64>>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut log = EntryLog::new(max_bytes);
    for (role, content, calls, call_id, timestamp) in rows.flatten() {
        let at = seconds_to_ms(timestamp);
        let content = content.unwrap_or_default();
        match role.as_str() {
            "user" => log.user(at, &content),
            "assistant" => {
                log.assistant(at, &content);
                let calls: Value = calls
                    .as_deref()
                    .and_then(|raw| serde_json::from_str(raw).ok())
                    .unwrap_or(Value::Null);
                for call in calls.as_array().into_iter().flatten() {
                    let function = call.get("function").unwrap_or(call);
                    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
                    log.tool(
                        at,
                        call.get("id").and_then(Value::as_str),
                        name,
                        &arguments(function.get("arguments")),
                    );
                }
            }
            "tool" => {
                if let Some(id) = call_id.as_deref() {
                    let text = serde_json::from_str::<Value>(&content)
                        .map(|value| content_text(&value))
                        .unwrap_or(content);
                    log.tool_output(id, &text);
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

    #[test]
    fn imports_hermes_sessions_and_marks_only_acp_ones_resumable() {
        let dir =
            std::env::temp_dir().join(format!("bycoda-hermes-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("profiles/work")).unwrap();
        let db = dir.join("state.db");
        {
            let connection = Connection::open(&db).unwrap();
            connection
                .execute_batch(
                    r#"
                    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT,
                      model_config TEXT, parent_session_id TEXT, started_at REAL NOT NULL,
                      ended_at REAL, cwd TEXT, hidden INTEGER NOT NULL DEFAULT 0);
                    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT,
                      role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
                      timestamp REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                      compacted INTEGER NOT NULL DEFAULT 0);
                    INSERT INTO sessions VALUES ('acp-1', 'acp', 'hermes-4', NULL, NULL, 100.5, NULL, 'C:/work', 0);
                    INSERT INTO sessions VALUES ('cli-1', 'cli', NULL, '{"cwd":"C:/other"}', NULL, 50, 60, NULL, 0);
                    INSERT INTO sessions VALUES ('cron-1', 'cron', NULL, NULL, NULL, 10, 11, 'C:/work', 0);
                    INSERT INTO sessions VALUES ('hidden-1', 'cli', NULL, NULL, NULL, 10, 11, 'C:/work', 1);
                    INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES
                      ('acp-1', 'user', 'refactor it', NULL, 101),
                      ('acp-1', 'assistant', 'Looking.', '[{"id":"c1","type":"function","function":{"name":"terminal","arguments":"{\"command\":\"git status\"}"}}]', 102);
                    INSERT INTO messages (session_id, role, content, tool_call_id, timestamp) VALUES
                      ('acp-1', 'tool', 'clean', 'c1', 103);
                    INSERT INTO messages (session_id, role, content, timestamp, active, compacted) VALUES
                      ('acp-1', 'user', 'old turn', 99, 0, 0);
                    INSERT INTO messages (session_id, role, content, timestamp) VALUES
                      ('cli-1', 'user', 'hello', 55),
                      ('cron-1', 'user', 'nightly', 10),
                      ('hidden-1', 'user', 'title job', 10);
                    "#,
                )
                .unwrap();
        }
        assert_eq!(databases(std::slice::from_ref(&dir)), vec![db.clone()]);
        let (mut found, scanned) = discover(&db);
        assert_eq!(scanned, 4);
        found.sort_by(|a, b| a.provider_session_id.cmp(&b.provider_session_id));
        let ids: Vec<_> = found
            .iter()
            .map(|c| c.provider_session_id.as_str())
            .collect();
        assert_eq!(ids, ["acp-1", "cli-1", "cron-1"]);
        assert!(found[0].resumable);
        assert_eq!(found[0].started_at, 100_500);
        assert_eq!(found[0].last_at, 103_000);
        assert!(!found[1].resumable);
        assert_eq!(found[1].cwd, "C:/other");
        assert_eq!(found[2].kind, ImportKind::Exec);

        let transcript = read(&db, "acp-1", 1 << 20).unwrap();
        let kinds: Vec<_> = transcript.entries.iter().map(|entry| entry.kind).collect();
        assert_eq!(kinds, ["user", "assistant", "tool"]);
        assert_eq!(transcript.entries[2].name.as_deref(), Some("shell"));
        assert_eq!(transcript.entries[2].output.as_deref(), Some("clean"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn wsl_mount_paths_map_to_drive_paths_on_windows() {
        if cfg!(windows) {
            assert_eq!(native_path("/mnt/c/work/app"), "C:/work/app");
            assert_eq!(native_path("/mnt/data/x"), "/mnt/data/x");
        }
        assert_eq!(native_path("/home/me"), "/home/me");
    }
}
