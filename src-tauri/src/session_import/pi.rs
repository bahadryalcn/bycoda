//! Pi, omp and OpenClaw keep the pi-coding-agent session format: one JSONL
//! file per session, a `session` header carrying the id and working folder,
//! then entries linked into a tree by `id` and `parentId`. Only the branch
//! the session last continued on is imported.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::entries::{arguments, content_text, typed_text, EntryLog};
use super::{
    collapse, last_timestamp, modified_ms, parse_ms, read_capped_line, scan_cached,
    CodexTranscript, ImportCandidate, ImportKind, ScanScope, HEAD_BYTES, MAX_LINE_BYTES,
};
use crate::fs::path_to_js;
use crate::provider_usage::open_log;

/// Session files under `root`: `<root>/<folder>/<stamp>_<id>.jsonl`, and the
/// files directly in `root`. Deleted OpenClaw transcripts are renamed with a
/// `.deleted.` infix and left out.
pub(super) fn session_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return files;
    };
    let wanted = |path: &Path| {
        path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
            && !path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(".deleted."))
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_file() && wanted(&path) {
            files.push(path);
        } else if kind.is_dir() {
            if let Ok(inner) = std::fs::read_dir(&path) {
                for file in inner.flatten() {
                    let path = file.path();
                    if file.file_type().is_ok_and(|kind| kind.is_file()) && wanted(&path) {
                        files.push(path);
                    }
                }
            }
        }
    }
    files
}

pub(super) fn discover(
    provider: &'static str,
    files: &[PathBuf],
    resumable: bool,
) -> Vec<ImportCandidate> {
    super::par_filter_map(files, |path| {
        scan_cached(path, ScanScope::Plain(provider), || {
            scan_file(path, provider, resumable)
        })
    })
}

/// The ms timestamp of an entry: the message's own, else the entry's.
fn entry_ms(record: &Value) -> u64 {
    record
        .pointer("/message/timestamp")
        .and_then(Value::as_u64)
        .or_else(|| {
            record
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(parse_ms)
        })
        .unwrap_or(0)
}

/// What a session header and the first entries say about a session.
#[derive(Default)]
pub(super) struct Summary {
    pub(super) id: Option<String>,
    pub(super) cwd: Option<String>,
    pub(super) started_at: Option<u64>,
    pub(super) parent: bool,
    pub(super) prompt: Option<String>,
    pub(super) model: Option<String>,
    pub(super) last_at: u64,
}

impl Summary {
    /// Folds one entry in; true once nothing more is needed.
    pub(super) fn add(&mut self, record: &Value) -> bool {
        let at = entry_ms(record);
        self.last_at = self.last_at.max(at);
        match record.get("type").and_then(Value::as_str) {
            Some("session") => {
                let text = |key: &str| {
                    record
                        .get(key)
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                };
                self.id = self.id.take().or_else(|| text("id"));
                self.cwd = self.cwd.take().or_else(|| text("cwd"));
                self.started_at = self.started_at.or(Some(at).filter(|at| *at > 0));
                self.parent |= text("parentSession").is_some();
            }
            Some("model_change") if self.model.is_none() => {
                self.model = record
                    .get("modelId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            Some("message") => {
                let message = record.get("message").unwrap_or(&Value::Null);
                match message.get("role").and_then(Value::as_str) {
                    Some("user") if self.prompt.is_none() => {
                        let text = content_text(message.get("content").unwrap_or(&Value::Null));
                        self.prompt = typed_text(&text).map(collapse);
                    }
                    Some("assistant") if self.model.is_none() => {
                        self.model = message
                            .get("model")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        self.prompt.is_some() && self.model.is_some() && self.cwd.is_some()
    }
}

fn scan_file(path: &Path, provider: &'static str, resumable: bool) -> Option<ImportCandidate> {
    let size = std::fs::metadata(path).ok()?.len();
    let mut reader = open_log(path)?;
    let mut buf = Vec::new();
    let mut read = 0usize;
    let mut summary = Summary::default();
    while read < HEAD_BYTES {
        let Ok(Some((taken, cut))) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        else {
            break;
        };
        read += taken;
        if cut {
            continue;
        }
        let Ok(record) = serde_json::from_slice::<Value>(&buf) else {
            continue;
        };
        if summary.add(&record) {
            break;
        }
    }
    let id = summary.id.or_else(|| {
        let stem = path.file_stem()?.to_str()?;
        Some(stem.rsplit('_').next()?.to_string())
    })?;
    let cwd = summary.cwd?;
    let prompt = summary.prompt?;
    let last_at = last_timestamp(path, size).unwrap_or_else(|| modified_ms(path));
    let started_at = summary.started_at.unwrap_or(last_at);
    Some(ImportCandidate {
        provider,
        path: path_to_js(path),
        provider_session_id: id,
        cwd,
        cwd_exists: false,
        resumable,
        first_prompt: prompt,
        started_at,
        last_at: last_at.max(started_at),
        size_bytes: size,
        kind: if summary.parent {
            ImportKind::Subagent
        } else {
            ImportKind::Interactive
        },
        model: summary.model,
        archived: false,
    })
}

/// The entries on the branch that ends at the last entry, oldest first.
/// Files written before entries had ids keep every entry.
pub(super) fn active_branch(records: Vec<Value>) -> Vec<Value> {
    let id = |record: &Value| record.get("id").and_then(Value::as_str).map(str::to_string);
    let parent = |record: &Value| {
        record
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let Some(last) = records
        .iter()
        .rev()
        .find(|record| record.get("type").and_then(Value::as_str) != Some("session"))
        .and_then(id)
    else {
        return records;
    };
    if records.iter().all(|record| parent(record).is_none()) {
        return records;
    }
    let parents: HashMap<String, Option<String>> = records
        .iter()
        .filter_map(|record| Some((id(record)?, parent(record))))
        .collect();
    let mut keep = HashSet::new();
    let mut cursor = Some(last);
    while let Some(current) = cursor {
        if !keep.insert(current.clone()) {
            break;
        }
        cursor = parents.get(&current).cloned().flatten();
    }
    records
        .into_iter()
        .filter(|record| match id(record) {
            Some(id) => keep.contains(&id),
            // The header and id-less bookkeeping stay.
            None => true,
        })
        .collect()
}

/// Adds one session entry to the transcript.
pub(super) fn feed(log: &mut EntryLog, record: &Value) {
    let at = entry_ms(record);
    if record.get("type").and_then(Value::as_str) != Some("message") {
        return;
    }
    let Some(message) = record.get("message") else {
        return;
    };
    let content = message.get("content").unwrap_or(&Value::Null);
    match message.get("role").and_then(Value::as_str) {
        Some("user") => log.user(at, &content_text(content)),
        Some("assistant") => {
            let Some(parts) = content.as_array() else {
                log.assistant(at, &content_text(content));
                return;
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
                    Some("toolCall" | "tool_call" | "tool-call") => {
                        log.assistant(at, &std::mem::take(&mut text));
                        let name = part
                            .get("name")
                            .or_else(|| part.get("toolName"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let call = part
                            .get("id")
                            .or_else(|| part.get("toolCallId"))
                            .and_then(Value::as_str);
                        let args = arguments(part.get("arguments").or_else(|| part.get("args")));
                        log.tool(at, call, name, &args);
                    }
                    _ => {}
                }
            }
            log.assistant(at, &text);
        }
        Some("toolResult" | "tool") => {
            if let Some(call) = message
                .get("toolCallId")
                .or_else(|| message.get("tool_call_id"))
                .and_then(Value::as_str)
            {
                log.tool_output(call, &content_text(content));
            }
        }
        Some("bashExecution") => {
            let command = message.get("command").and_then(Value::as_str).unwrap_or("");
            let output = message.get("output").and_then(Value::as_str).unwrap_or("");
            log.tool_with_output(
                at,
                None,
                "bash",
                &serde_json::json!({ "command": command }),
                output,
            );
        }
        _ => {}
    }
}

pub(super) fn read(path: &Path, max_bytes: usize) -> Result<CodexTranscript, String> {
    let mut reader = open_log(path).ok_or_else(|| format!("Cannot open {}", path.display()))?;
    let mut buf = Vec::new();
    let mut records = Vec::new();
    let mut oversize = 0usize;
    // shortcut: holds every entry of the file to find the active branch; a
    // session past a few hundred MB would need a two-pass read instead.
    while let Some((_, cut)) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        .map_err(|error| error.to_string())?
    {
        if cut {
            oversize += 1;
            continue;
        }
        if let Ok(record) = serde_json::from_slice::<Value>(&buf) {
            records.push(record);
        }
    }
    let mut log = EntryLog::new(max_bytes);
    log.oversize = oversize;
    for record in active_branch(records) {
        feed(&mut log, &record);
    }
    Ok(log.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write(lines: &[Value]) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("bycoda-pi-import-{}", uuid::Uuid::new_v4()));
        let folder = dir.join("--C--work-app--");
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("2026-05-01T10-00-00-000Z_0198aa.jsonl");
        let text: Vec<String> = lines.iter().map(Value::to_string).collect();
        std::fs::write(&path, text.join("\n") + "\n").unwrap();
        (dir, path)
    }

    fn session() -> Vec<Value> {
        vec![
            json!({"type":"session","version":3,"id":"0198aa","timestamp":"2026-05-01T10:00:00.000Z","cwd":"C:/work/app"}),
            json!({"type":"message","id":"a1","parentId":null,"timestamp":"2026-05-01T10:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"bycoda tools for this session: x"}],"timestamp":1}}),
            json!({"type":"message","id":"a2","parentId":"a1","timestamp":"2026-05-01T10:00:02.000Z","message":{"role":"user","content":"fix the tests","timestamp":2}}),
            json!({"type":"message","id":"a3","parentId":"a2","timestamp":"2026-05-01T10:00:03.000Z","message":{"role":"assistant","model":"claude-x","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"Running them."},{"type":"toolCall","id":"t1","name":"bash","arguments":{"command":"npm test"}}],"timestamp":3}}),
            json!({"type":"message","id":"a4","parentId":"a3","timestamp":"2026-05-01T10:00:04.000Z","message":{"role":"toolResult","toolCallId":"t1","toolName":"bash","content":[{"type":"text","text":"1 failing"}],"isError":false,"timestamp":4}}),
            // An abandoned branch off a2.
            json!({"type":"message","id":"b3","parentId":"a2","timestamp":"2026-05-01T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"text","text":"abandoned"}],"timestamp":5}}),
            json!({"type":"message","id":"a5","parentId":"a4","timestamp":"2026-05-01T10:00:06.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Fixed."}],"timestamp":6}}),
        ]
    }

    #[test]
    fn discovers_a_session_from_its_header_and_first_typed_prompt() {
        let (dir, path) = write(&session());
        let files = session_files(&dir);
        assert_eq!(files, vec![path.clone()]);
        let candidate = scan_file(&path, "pi", true).unwrap();
        assert_eq!(candidate.provider_session_id, "0198aa");
        assert_eq!(candidate.cwd, "C:/work/app");
        assert_eq!(candidate.first_prompt, "fix the tests");
        assert_eq!(candidate.model.as_deref(), Some("claude-x"));
        assert_eq!(candidate.kind, ImportKind::Interactive);
        assert!(candidate.resumable);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reads_only_the_active_branch() {
        let (dir, path) = write(&session());
        let transcript = read(&path, 1 << 20).unwrap();
        let texts: Vec<_> = transcript
            .entries
            .iter()
            .map(|entry| (entry.kind, entry.text.as_str()))
            .collect();
        assert_eq!(
            texts,
            [
                ("user", "fix the tests"),
                ("assistant", "Running them."),
                ("tool", ""),
                ("assistant", "Fixed."),
            ]
        );
        assert_eq!(transcript.entries[2].input.as_deref(), Some("npm test"));
        assert_eq!(transcript.entries[2].output.as_deref(), Some("1 failing"));
        std::fs::remove_dir_all(dir).ok();
    }
}
