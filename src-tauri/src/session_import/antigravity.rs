//! The Antigravity CLI (`agy`) lists conversations in
//! `~/.gemini/antigravity-cli/conversation_summaries.db` and keeps each one's
//! steps in `conversations/<id>.db`, one protobuf payload per step. The IDE's
//! own `conversations/*.pb` files are encrypted and cannot be imported.
//!
//! Step payload fields, as observed: 1 = step type, 5.1 = start time
//! (`{1: seconds, 2: nanos}`); a user step (14) has its text in 19.2; a model
//! step (15) its reply in 20.1 (or 20.8) and each tool call in 20.7
//! (`{1: id, 2: name, 3: JSON arguments}`); a tool result step (132) names the
//! call in 5.4.1 and holds the output in 140.2.1.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

use super::entries::{arguments, typed_text, EntryLog};
use super::{collapse, parse_ms, CodexTranscript, ImportCandidate, ImportKind};
use crate::cursor_store::open_read_only;
use crate::fs::path_to_js;

const USER_STEP: i64 = 14;
const MODEL_STEP: i64 = 15;
const TOOL_RESULT_STEP: i64 = 132;

enum Field<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

fn varint(bytes: &[u8], at: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*at)?;
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(value);
        }
    }
    None
}

/// The fields of one protobuf message, or `None` when the bytes are not one.
fn fields(bytes: &[u8]) -> Option<Vec<(u64, Field<'_>)>> {
    let mut at = 0usize;
    let mut out = Vec::new();
    while at < bytes.len() {
        let key = varint(bytes, &mut at)?;
        let number = key >> 3;
        if number == 0 {
            return None;
        }
        match key & 7 {
            0 => out.push((number, Field::Varint(varint(bytes, &mut at)?))),
            1 => at = at.checked_add(8)?,
            2 => {
                let len = usize::try_from(varint(bytes, &mut at)?).ok()?;
                let end = at.checked_add(len).filter(|end| *end <= bytes.len())?;
                out.push((number, Field::Bytes(&bytes[at..end])));
                at = end;
            }
            5 => at = at.checked_add(4)?,
            _ => return None,
        }
    }
    (at == bytes.len()).then_some(out)
}

/// Every length-delimited value at `path`, depth first.
fn all_at<'a>(bytes: &'a [u8], path: &[u64]) -> Vec<&'a [u8]> {
    let Some((first, rest)) = path.split_first() else {
        return vec![bytes];
    };
    let Some(fields) = fields(bytes) else {
        return Vec::new();
    };
    fields
        .into_iter()
        .filter_map(|(number, field)| match field {
            Field::Bytes(inner) if number == *first => Some(inner),
            _ => None,
        })
        .flat_map(|inner| all_at(inner, rest))
        .collect()
}

fn text_at(bytes: &[u8], path: &[u64]) -> Option<String> {
    all_at(bytes, path)
        .into_iter()
        .find_map(|value| std::str::from_utf8(value).ok().map(str::to_string))
        .filter(|text| !text.trim().is_empty())
}

fn varint_at(bytes: &[u8], path: &[u64]) -> Option<u64> {
    let (last, parents) = path.split_last()?;
    all_at(bytes, parents).into_iter().find_map(|inner| {
        fields(inner)?
            .into_iter()
            .find_map(|(number, field)| match field {
                Field::Varint(value) if number == *last => Some(value),
                _ => None,
            })
    })
}

fn step_ms(payload: &[u8]) -> u64 {
    let seconds = varint_at(payload, &[5, 1, 1]).unwrap_or(0);
    let nanos = varint_at(payload, &[5, 1, 2]).unwrap_or(0);
    seconds * 1000 + nanos / 1_000_000
}

/// A local path for a `file:///` workspace URI.
fn uri_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let mut bytes = Vec::with_capacity(rest.len());
    let raw = rest.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' && index + 2 < raw.len() {
            let hex = std::str::from_utf8(&raw[index + 1..index + 3]).ok()?;
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                bytes.push(byte);
                index += 3;
                continue;
            }
        }
        bytes.push(raw[index]);
        index += 1;
    }
    let path = String::from_utf8(bytes).ok()?;
    // `/C:/work` is a drive path; `/home/me` stays as it is.
    let path = match path.as_bytes() {
        [b'/', drive, b':', ..] if drive.is_ascii_alphabetic() => path[1..].to_string(),
        _ => path,
    };
    (!path.is_empty()).then_some(path)
}

pub(super) fn conversation_db(root: &Path, id: &str) -> PathBuf {
    root.join("conversations").join(format!("{id}.db"))
}

pub(super) fn discover(root: &Path) -> (Vec<ImportCandidate>, usize) {
    let summaries = root.join("conversation_summaries.db");
    let Ok(connection) = open_read_only(&summaries) else {
        return (Vec::new(), 0);
    };
    discover_in(&connection, root).unwrap_or_default()
}

fn discover_in(
    connection: &Connection,
    root: &Path,
) -> rusqlite::Result<(Vec<ImportCandidate>, usize)> {
    let mut statement = connection.prepare(
        "SELECT conversation_id, title, preview, last_modified_time, workspace_uris,
                parent_conversation_id
         FROM conversation_summaries",
    )?;
    /// Id, title, preview, last modified, workspace URIs, parent.
    type Row = (
        String,
        Option<String>,
        Option<String>,
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
            ))
        })?
        .flatten()
        .collect();
    let scanned = rows.len();
    let mut found = Vec::new();
    for (id, title, preview, modified, uris, parent) in rows {
        let db = conversation_db(root, &id);
        let Ok(meta) = std::fs::metadata(&db) else {
            continue;
        };
        let cwd = uris
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
            .and_then(|uris| uris.iter().find_map(|uri| uri_path(uri)));
        let Some(cwd) = cwd else { continue };
        let first_step = open_read_only(&db).ok().and_then(|steps| {
            steps
                .query_row(
                    "SELECT step_payload FROM steps WHERE step_type = ?1 ORDER BY idx LIMIT 1",
                    [USER_STEP],
                    |row| row.get::<_, Vec<u8>>(0),
                )
                .ok()
        });
        let prompt = first_step
            .as_deref()
            .and_then(|payload| text_at(payload, &[19, 2]))
            .and_then(|text| typed_text(&text).map(str::to_string))
            .or(preview.filter(|text| !text.trim().is_empty()))
            .or(title.filter(|text| !text.trim().is_empty()));
        let Some(prompt) = prompt else { continue };
        let last_at = modified
            .as_deref()
            .and_then(parse_ms)
            .unwrap_or_else(|| super::modified_ms(&db));
        let started_at = first_step
            .as_deref()
            .map(step_ms)
            .filter(|at| *at > 0 && *at <= last_at)
            .unwrap_or(last_at);
        found.push(ImportCandidate {
            provider: "antigravity",
            path: path_to_js(&db),
            provider_session_id: id,
            cwd,
            cwd_exists: false,
            // The ACP session id is not proven to be this conversation id.
            resumable: false,
            first_prompt: collapse(&prompt),
            started_at,
            last_at,
            size_bytes: meta.len(),
            kind: if parent.is_some_and(|parent| !parent.is_empty()) {
                ImportKind::Subagent
            } else {
                ImportKind::Interactive
            },
            model: None,
            archived: false,
        });
    }
    Ok((found, scanned))
}

pub(super) fn read(db: &Path, max_bytes: usize) -> Result<CodexTranscript, String> {
    let connection = open_read_only(db)?;
    let mut statement = connection
        .prepare("SELECT step_type, step_payload FROM steps ORDER BY idx")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<Vec<u8>>>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut log = EntryLog::new(max_bytes);
    for (kind, payload) in rows.flatten() {
        let Some(payload) = payload else { continue };
        let at = step_ms(&payload);
        match kind {
            USER_STEP => {
                if let Some(text) = text_at(&payload, &[19, 2]) {
                    log.user(at, &text);
                }
            }
            MODEL_STEP => {
                let reply = text_at(&payload, &[20, 1]).or_else(|| text_at(&payload, &[20, 8]));
                log.assistant(at, reply.as_deref().unwrap_or(""));
                for call in all_at(&payload, &[20, 7]) {
                    let name = text_at(call, &[2]).unwrap_or_default();
                    let id = text_at(call, &[1]);
                    let args = arguments(text_at(call, &[3]).map(Value::String).as_ref());
                    log.tool(at, id.as_deref(), &name, &args);
                }
            }
            TOOL_RESULT_STEP => {
                if let (Some(id), Some(output)) = (
                    text_at(&payload, &[5, 4, 1]),
                    text_at(&payload, &[140, 2, 1]),
                ) {
                    log.tool_output(&id, &output);
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

    fn key(number: u64, wire: u64, out: &mut Vec<u8>) {
        put_varint(number << 3 | wire, out);
    }

    fn put_varint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    fn bytes(number: u64, value: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        key(number, 2, &mut out);
        put_varint(value.len() as u64, &mut out);
        out.extend_from_slice(value);
        out
    }

    fn number(field: u64, value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        key(field, 0, &mut out);
        put_varint(value, &mut out);
        out
    }

    fn started(seconds: u64) -> Vec<u8> {
        bytes(
            5,
            &bytes(1, &[number(1, seconds), number(2, 500_000_000)].concat()),
        )
    }

    #[test]
    fn decodes_steps_into_prompts_replies_and_tool_calls() {
        let user = [
            number(1, 14),
            started(100),
            bytes(19, &bytes(2, b"run the tests")),
        ]
        .concat();
        let call = [
            bytes(1, b"call_1"),
            bytes(2, b"run_command"),
            bytes(3, br#"{"CommandLine":"npm test"}"#),
        ]
        .concat();
        let model = [
            number(1, 15),
            started(101),
            bytes(20, &[bytes(1, b"Running."), bytes(7, &call)].concat()),
        ]
        .concat();
        let result = [
            number(1, 132),
            bytes(5, &bytes(4, &bytes(1, b"call_1"))),
            bytes(140, &bytes(2, &bytes(1, b"Command exited with code 0."))),
        ]
        .concat();

        let dir = std::env::temp_dir().join(format!("bycoda-agy-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("conversations")).unwrap();
        {
            let summaries = Connection::open(dir.join("conversation_summaries.db")).unwrap();
            summaries
                .execute_batch(
                    "CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT,
                       preview TEXT, last_modified_time TEXT, workspace_uris TEXT,
                       parent_conversation_id TEXT);
                     INSERT INTO conversation_summaries VALUES ('c1', 'Tests', 'run the tests',
                       '2026-05-01T10:00:00Z', '[\"file:///C:/work/my%20app\"]', NULL);
                     INSERT INTO conversation_summaries VALUES ('gone', 'x', 'x',
                       '2026-05-01T10:00:00Z', '[\"file:///C:/work\"]', NULL);",
                )
                .unwrap();
            let steps = Connection::open(conversation_db(&dir, "c1")).unwrap();
            steps
                .execute_batch(
                    "CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB);",
                )
                .unwrap();
            for (index, (kind, payload)) in [(14, user), (15, model), (132, result)]
                .into_iter()
                .enumerate()
            {
                steps
                    .execute(
                        "INSERT INTO steps VALUES (?1, ?2, ?3)",
                        rusqlite::params![index as i64, kind, payload],
                    )
                    .unwrap();
            }
        }
        let (found, scanned) = discover(&dir);
        assert_eq!(scanned, 2);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].cwd, "C:/work/my app");
        assert_eq!(found[0].first_prompt, "run the tests");
        assert_eq!(found[0].started_at, 100_500);
        assert!(!found[0].resumable);

        let transcript = read(&conversation_db(&dir, "c1"), 1 << 20).unwrap();
        let kinds: Vec<_> = transcript.entries.iter().map(|entry| entry.kind).collect();
        assert_eq!(kinds, ["user", "assistant", "tool"]);
        assert_eq!(transcript.entries[2].name.as_deref(), Some("shell"));
        assert_eq!(transcript.entries[2].input.as_deref(), Some("npm test"));
        assert_eq!(
            transcript.entries[2].output.as_deref(),
            Some("Command exited with code 0.")
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn workspace_uris_become_local_paths() {
        assert_eq!(uri_path("file:///C:/a%20b").as_deref(), Some("C:/a b"));
        assert_eq!(uri_path("file:///home/me").as_deref(), Some("/home/me"));
        assert_eq!(uri_path("https://x"), None);
    }
}
