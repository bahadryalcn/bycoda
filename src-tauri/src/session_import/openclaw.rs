//! OpenClaw keeps each agent's sessions under
//! `<OPENCLAW_STATE_DIR>/agents/<agent>/`: current builds in
//! `agent/openclaw-agent.sqlite` (`session_windows` rows, transcript events in
//! `transcript_events`, plain or zstd JSON), earlier ones as
//! `sessions/<id>.jsonl`. Both hold pi-coding-agent session entries. OpenClaw
//! has no Bycoda provider, so its conversations are imported as history.

use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

use super::entries::EntryLog;
use super::pi::{active_branch, feed, session_files, Summary};
use super::{collapse, CodexTranscript, ImportCandidate, ImportKind};
use crate::cursor_store::open_read_only;
use crate::fs::path_to_js;

/// A compressed event larger than this is skipped.
const MAX_EVENT_BYTES: u64 = 4 * 1024 * 1024;
/// How many events discovery reads looking for the header and first prompt.
const HEAD_EVENTS: i64 = 64;

pub(super) struct Stores {
    pub(super) transcripts: Vec<PathBuf>,
    pub(super) databases: Vec<PathBuf>,
}

pub(super) fn stores(state: &Path) -> Stores {
    let mut found = Stores {
        transcripts: Vec::new(),
        databases: Vec::new(),
    };
    let Ok(agents) = std::fs::read_dir(state.join("agents")) else {
        return found;
    };
    for agent in agents.flatten() {
        let dir = agent.path();
        let db = dir.join("agent").join("openclaw-agent.sqlite");
        if db.is_file() {
            found.databases.push(db);
        }
        found
            .transcripts
            .extend(session_files(&dir.join("sessions")));
    }
    found
}

fn event(json: Option<String>, zstd: Option<Vec<u8>>) -> Option<Value> {
    if let Some(json) = json {
        return serde_json::from_str(&json).ok();
    }
    let compressed = zstd?;
    let decoder = ruzstd::decoding::StreamingDecoder::new(compressed.as_slice()).ok()?;
    let mut bytes = Vec::new();
    decoder.take(MAX_EVENT_BYTES).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn events(
    connection: &Connection,
    session: &str,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Value>> {
    let mut statement = connection.prepare(
        "SELECT event_json, event_zstd FROM transcript_events WHERE session_id = ?1
         ORDER BY seq LIMIT ?2",
    )?;
    let rows = statement.query_map(rusqlite::params![session, limit.unwrap_or(-1)], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<Vec<u8>>>(1)?,
        ))
    })?;
    Ok(rows
        .flatten()
        .filter_map(|(json, zstd)| event(json, zstd))
        .collect())
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
    let mut statement = connection.prepare(
        "SELECT session_id, session_key, created_at, updated_at, model, spawned_by,
                parent_session_key
         FROM session_windows",
    )?;
    type Row = (
        String,
        String,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let rows: Vec<Row> = statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })?
        .flatten()
        .collect();
    let scanned = rows.len();
    let mut sizes = connection.prepare(
        "SELECT COALESCE(SUM(COALESCE(event_utf8_bytes, LENGTH(event_json))), 0)
         FROM transcript_events WHERE session_id = ?1",
    )?;
    let mut found = Vec::new();
    for (id, key, created, updated, model, spawned_by, parent) in rows {
        let mut summary = Summary::default();
        for record in events(connection, &id, Some(HEAD_EVENTS))? {
            if summary.add(&record) {
                break;
            }
        }
        let (Some(cwd), Some(prompt)) = (summary.cwd, summary.prompt) else {
            continue;
        };
        let size: i64 = sizes.query_row([&id], |row| row.get(0))?;
        let started_at = u64::try_from(created.unwrap_or(0))
            .ok()
            .filter(|at| *at > 0)
            .or(summary.started_at)
            .unwrap_or(0);
        let last_at = u64::try_from(updated.unwrap_or(0))
            .unwrap_or(0)
            .max(summary.last_at)
            .max(started_at);
        let automated =
            key.starts_with("cron:") || key.starts_with("hook:") || key.contains(":explicit:");
        found.push(ImportCandidate {
            provider: "openclaw",
            path: path_to_js(db),
            provider_session_id: id,
            cwd,
            cwd_exists: false,
            resumable: false,
            first_prompt: collapse(&prompt),
            started_at: if started_at > 0 { started_at } else { last_at },
            last_at,
            size_bytes: u64::try_from(size).unwrap_or(0),
            kind: if spawned_by.is_some() || parent.is_some() || summary.parent {
                ImportKind::Subagent
            } else if automated {
                ImportKind::Exec
            } else {
                ImportKind::Interactive
            },
            model: model.or(summary.model),
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
    let records = events(&connection, session_id, None).map_err(|error| error.to_string())?;
    let mut log = EntryLog::new(max_bytes);
    for record in active_branch(records) {
        feed(&mut log, &record);
    }
    Ok(log.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn imports_sessions_from_the_agent_database() {
        let state =
            std::env::temp_dir().join(format!("bycoda-openclaw-import-{}", uuid::Uuid::new_v4()));
        let agent = state.join("agents").join("main");
        std::fs::create_dir_all(agent.join("agent")).unwrap();
        std::fs::create_dir_all(agent.join("sessions")).unwrap();
        std::fs::write(agent.join("sessions").join("sessions.json"), "{}").unwrap();
        let db = agent.join("agent").join("openclaw-agent.sqlite");
        {
            let connection = Connection::open(&db).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE session_windows (session_id TEXT PRIMARY KEY, session_key TEXT,
                       created_at INTEGER, updated_at INTEGER, model TEXT, spawned_by TEXT,
                       parent_session_key TEXT);
                     CREATE TABLE transcript_events (session_id TEXT, seq INTEGER, event_json TEXT,
                       event_zstd BLOB, event_utf8_bytes INTEGER, created_at INTEGER);
                     INSERT INTO session_windows VALUES ('s1', 'agent:main:main', 1000, 5000,
                       'gpt-x', NULL, NULL);
                     INSERT INTO session_windows VALUES ('s2', 'cron:nightly', 1, 2, NULL, NULL, NULL);",
                )
                .unwrap();
            let events = [
                (
                    "s1",
                    json!({"type":"session","id":"s1","cwd":"/home/me/.openclaw/workspace","timestamp":"2026-05-01T10:00:00Z"}),
                ),
                (
                    "s1",
                    json!({"type":"message","id":"e1","parentId":null,"timestamp":"2026-05-01T10:00:01Z","message":{"role":"user","content":"plan my week"}}),
                ),
                (
                    "s1",
                    json!({"type":"message","id":"e2","parentId":"e1","timestamp":"2026-05-01T10:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"Here is a plan."}]}}),
                ),
                (
                    "s2",
                    json!({"type":"session","id":"s2","cwd":"/home/me/.openclaw/workspace","timestamp":"2026-05-01T10:00:00Z"}),
                ),
                (
                    "s2",
                    json!({"type":"message","id":"f1","parentId":null,"timestamp":"2026-05-01T10:00:01Z","message":{"role":"user","content":"nightly digest"}}),
                ),
            ];
            for (seq, (session, event)) in events.iter().enumerate() {
                let text = event.to_string();
                if seq == 2 {
                    let compressed = ruzstd::encoding::compress_to_vec(
                        text.as_bytes(),
                        ruzstd::encoding::CompressionLevel::Fastest,
                    );
                    connection
                        .execute(
                            "INSERT INTO transcript_events VALUES (?1, ?2, NULL, ?3, ?4, 0)",
                            rusqlite::params![session, seq as i64, compressed, text.len() as i64],
                        )
                        .unwrap();
                } else {
                    connection
                        .execute(
                            "INSERT INTO transcript_events VALUES (?1, ?2, ?3, NULL, NULL, 0)",
                            rusqlite::params![session, seq as i64, text],
                        )
                        .unwrap();
                }
            }
        }
        let stores = stores(&state);
        assert_eq!(stores.databases, vec![db.clone()]);
        assert!(stores.transcripts.is_empty());
        let (mut found, scanned) = discover(&db);
        assert_eq!(scanned, 2);
        found.sort_by(|a, b| a.provider_session_id.cmp(&b.provider_session_id));
        assert_eq!(found[0].first_prompt, "plan my week");
        assert_eq!(found[0].cwd, "/home/me/.openclaw/workspace");
        assert_eq!(found[0].kind, ImportKind::Interactive);
        assert!(!found[0].resumable);
        assert_eq!(found[1].kind, ImportKind::Exec);

        let transcript = read(&db, "s1", 1 << 20).unwrap();
        let texts: Vec<_> = transcript
            .entries
            .iter()
            .map(|entry| entry.text.as_str())
            .collect();
        assert_eq!(texts, ["plan my week", "Here is a plan."]);
        std::fs::remove_dir_all(state).ok();
    }
}
