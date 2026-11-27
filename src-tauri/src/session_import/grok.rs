//! Grok Build keeps one folder per session under
//! `<GROK_HOME>/sessions/<encoded cwd>/<id>/`: `summary.json` holds the id,
//! folder, times and model, `chat_history.jsonl` the model-facing history.
//! History records carry no timestamps, so entries are imported undated.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::entries::{arguments, content_text, EntryLog};
use super::{
    collapse, modified_ms, parse_ms, read_capped_line, scan_cached, tag_text, CodexTranscript,
    ImportCandidate, ImportKind, ScanScope, HEAD_BYTES, MAX_LINE_BYTES,
};
use crate::fs::path_to_js;
use crate::provider_usage::open_log;

pub(super) const HISTORY: &str = "chat_history.jsonl";

/// Every `chat_history.jsonl` under `<root>/sessions`.
pub(super) fn history_files(sessions: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(folders) = std::fs::read_dir(sessions) else {
        return files;
    };
    for folder in folders.flatten() {
        let Ok(ids) = std::fs::read_dir(folder.path()) else {
            continue;
        };
        for id in ids.flatten() {
            let path = id.path().join(HISTORY);
            if path.is_file() {
                files.push(path);
            }
        }
    }
    files
}

pub(super) fn discover(files: &[PathBuf]) -> Vec<ImportCandidate> {
    super::par_filter_map(files, |path| {
        scan_cached(path, ScanScope::Plain("grok"), || scan(path))
    })
}

/// What the person typed: a numbered prompt, with Grok's `<user_query>`
/// wrapper removed. Context Grok injects as user records has no prompt index.
fn typed_prompt(record: &Value) -> Option<String> {
    if record.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let text = content_text(record.get("content").unwrap_or(&Value::Null));
    let wrapped = tag_text(&text, "user_query");
    if record.get("prompt_index").is_none() && wrapped.is_none() {
        return None;
    }
    let text = wrapped.unwrap_or(text.trim()).to_string();
    (!text.is_empty()).then_some(text)
}

fn scan(path: &Path) -> Option<ImportCandidate> {
    let folder = path.parent()?;
    let summary: Value =
        serde_json::from_slice(&std::fs::read(folder.join("summary.json")).ok()?).ok()?;
    let text = |pointer: &str| {
        summary
            .pointer(pointer)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    };
    let id = text("/info/id")
        .map(str::to_string)
        .or_else(|| Some(folder.file_name()?.to_str()?.to_string()))?;
    let cwd = text("/info/cwd")?.to_string();

    let mut reader = open_log(path)?;
    let mut buf = Vec::new();
    let mut read = 0usize;
    let mut prompt = None;
    while read < HEAD_BYTES && prompt.is_none() {
        let Ok(Some((taken, cut))) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        else {
            break;
        };
        read += taken;
        if cut {
            continue;
        }
        if let Ok(record) = serde_json::from_slice::<Value>(&buf) {
            prompt = typed_prompt(&record).map(|text| collapse(&text));
        }
    }
    let prompt = prompt?;
    let size = std::fs::metadata(path).ok()?.len();
    let last_at = text("/last_active_at")
        .or_else(|| text("/updated_at"))
        .and_then(parse_ms)
        .unwrap_or_else(|| modified_ms(path));
    let started_at = text("/created_at").and_then(parse_ms).unwrap_or(last_at);
    Some(ImportCandidate {
        provider: "grok",
        path: path_to_js(path),
        provider_session_id: id,
        cwd,
        cwd_exists: false,
        resumable: true,
        first_prompt: prompt,
        started_at,
        last_at: last_at.max(started_at),
        size_bytes: size,
        kind: if text("/session_kind") == Some("headless") {
            ImportKind::Exec
        } else {
            ImportKind::Interactive
        },
        model: text("/current_model_id").map(str::to_string),
        archived: false,
    })
}

pub(super) fn read(path: &Path, max_bytes: usize) -> Result<CodexTranscript, String> {
    let mut reader = open_log(path).ok_or_else(|| format!("Cannot open {}", path.display()))?;
    let mut buf = Vec::new();
    let mut log = EntryLog::new(max_bytes);
    while let Some((_, cut)) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        .map_err(|error| error.to_string())?
    {
        if cut {
            log.oversize += 1;
            continue;
        }
        let Ok(record) = serde_json::from_slice::<Value>(&buf) else {
            continue;
        };
        match record.get("type").and_then(Value::as_str) {
            Some("user") => {
                if let Some(text) = typed_prompt(&record) {
                    log.user(0, &text);
                }
            }
            Some("assistant") => {
                log.assistant(
                    0,
                    &content_text(record.get("content").unwrap_or(&Value::Null)),
                );
                for call in record
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let name = call.get("name").and_then(Value::as_str).unwrap_or("");
                    let id = call.get("id").and_then(Value::as_str);
                    log.tool(0, id, name, &arguments(call.get("arguments")));
                }
            }
            Some("tool_result") => {
                if let Some(id) = record.get("tool_call_id").and_then(Value::as_str) {
                    log.tool_output(
                        id,
                        &content_text(record.get("content").unwrap_or(&Value::Null)),
                    );
                }
            }
            Some("backend_tool_call") => {
                if let Some(query) = record.pointer("/action/query").and_then(Value::as_str) {
                    log.tool(0, None, "web_search", &Value::String(query.to_string()));
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
    fn imports_typed_prompts_tool_calls_and_results() {
        let dir = std::env::temp_dir().join(format!("bycoda-grok-import-{}", uuid::Uuid::new_v4()));
        let folder = dir.join("C%3A%2Fwork").join("01a1-session");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("summary.json"),
            json!({
                "info": {"id": "01a1-session", "cwd": "C:/work"},
                "created_at": "2026-05-01T10:00:00.000Z",
                "updated_at": "2026-05-01T11:00:00.000Z",
                "current_model_id": "grok-4.5"
            })
            .to_string(),
        )
        .unwrap();
        let lines = [
            json!({"type":"system","content":"You are Grok"}),
            json!({"type":"user","content":[{"type":"text","text":"<user_info>\nWorkspace Path: C:/work\n</user_info>"}]}),
            json!({"type":"user","prompt_index":0,"content":[{"type":"text","text":"<user_query>\nlist files\n</user_query>"}]}),
            json!({"type":"assistant","content":"","tool_calls":[{"id":"call-1","name":"run_terminal_command","arguments":"{\"command\":\"ls\"}"}]}),
            json!({"type":"tool_result","tool_call_id":"call-1","content":"a.txt"}),
            json!({"type":"assistant","content":"One file."}),
        ];
        let text: Vec<String> = lines.iter().map(Value::to_string).collect();
        let history = folder.join(HISTORY);
        std::fs::write(&history, text.join("\n") + "\n").unwrap();

        assert_eq!(history_files(&dir), vec![history.clone()]);
        let candidate = scan(&history).unwrap();
        assert_eq!(candidate.provider_session_id, "01a1-session");
        assert_eq!(candidate.cwd, "C:/work");
        assert_eq!(candidate.first_prompt, "list files");
        assert_eq!(candidate.model.as_deref(), Some("grok-4.5"));
        assert_eq!(
            candidate.last_at,
            parse_ms("2026-05-01T11:00:00.000Z").unwrap()
        );

        let transcript = read(&history, 1 << 20).unwrap();
        let kinds: Vec<_> = transcript.entries.iter().map(|entry| entry.kind).collect();
        assert_eq!(kinds, ["user", "tool", "assistant"]);
        assert_eq!(transcript.entries[1].input.as_deref(), Some("ls"));
        assert_eq!(transcript.entries[1].output.as_deref(), Some("a.txt"));
        std::fs::remove_dir_all(dir).ok();
    }
}
