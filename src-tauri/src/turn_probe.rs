//! Reads the end of a provider's own transcript to say whether the last turn
//! finished, so Bycoda does not guess after it was closed mid-turn.
//!
//! Read-only: `~/.claude` and `~/.codex` are never written to, and only the
//! last window of a transcript is read. Only structural facts (record types,
//! stop reasons, task events) decide the state; the one piece of content that
//! leaves this module is the final assistant message of a finished turn, so a
//! reply that landed while the app was closed can be shown.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::fs::{claude_project_dir, expand_home};
use crate::provider_usage::account_config_dir;
use crate::session_store::validate_id;

/// How much of a transcript's end is read. Tool results can be large, so this
/// is generous; a last record bigger than the window reads as `unknown`.
const TAIL_WINDOW: u64 = 1024 * 1024;
const MAX_FINAL_TEXT: usize = 200_000;
const MAX_DEPTH: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TailState {
    /// The turn's last record says it ended (end of turn / task complete).
    Ended,
    /// The last record is mid-turn: a prompt or tool result nobody answered,
    /// or an assistant message that stopped to call a tool.
    Open,
    /// There is a tail but it does not settle the question.
    Unknown,
    /// No transcript could be found or read.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnTail {
    pub state: TailState,
    /// The final assistant message of an `Ended` turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_text: Option<String>,
}

impl TurnTail {
    fn of(state: TailState) -> Self {
        Self {
            state,
            final_text: None,
        }
    }
}

#[tauri::command]
pub async fn probe_turn_tail(
    app: AppHandle,
    provider: String,
    provider_session_id: String,
    cwd: String,
    provider_account_id: Option<String>,
) -> Result<TurnTail, String> {
    validate_id(&provider_session_id, "provider session")?;
    let config_dir = match provider.as_str() {
        "claude" | "codex" => account_config_dir(&app, &provider, provider_account_id.as_deref())?,
        _ => return Ok(TurnTail::of(TailState::Missing)),
    };
    tauri::async_runtime::spawn_blocking(move || {
        probe_in(&config_dir, &provider, &provider_session_id, &cwd)
    })
    .await
    .map_err(|error| error.to_string())
}

fn probe_in(config_dir: &Path, provider: &str, id: &str, cwd: &str) -> TurnTail {
    let found = if provider == "claude" {
        find_claude_transcript(config_dir, id, cwd)
    } else {
        find_codex_rollout(config_dir, id)
    };
    let Some(path) = found else {
        return TurnTail::of(TailState::Missing);
    };
    let Some(records) = read_tail_records(&path) else {
        return TurnTail::of(TailState::Missing);
    };
    if provider == "claude" {
        classify_claude_tail(&records)
    } else {
        classify_codex_tail(&records)
    }
}

pub(crate) fn find_claude_transcript(config_dir: &Path, id: &str, cwd: &str) -> Option<PathBuf> {
    let file = format!("{id}.jsonl");
    let direct = claude_project_dir(config_dir, &expand_home(cwd).to_string_lossy()).join(&file);
    if direct.is_file() {
        return Some(direct);
    }
    // The folder name is a lossy flattening of the cwd, and a session can have
    // run from a worktree: fall back to looking in every project folder.
    std::fs::read_dir(config_dir.join("projects"))
        .ok()?
        .flatten()
        .map(|project| project.path().join(&file))
        .find(|path| path.is_file())
}

pub(crate) fn find_codex_rollout(codex_dir: &Path, id: &str) -> Option<PathBuf> {
    let suffix = format!("{id}.jsonl");
    fn walk(dir: &Path, suffix: &str, depth: usize) -> Option<PathBuf> {
        let mut subdirs = Vec::new();
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            let kind = entry.file_type().ok()?;
            if kind.is_file() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("rollout-") && name.ends_with(suffix) {
                    return Some(path);
                }
            } else if kind.is_dir() && depth < MAX_DEPTH {
                subdirs.push(path);
            }
        }
        subdirs
            .into_iter()
            .find_map(|subdir| walk(&subdir, suffix, depth + 1))
    }
    ["sessions", "archived_sessions"]
        .iter()
        .find_map(|root| walk(&codex_dir.join(root), &suffix, 0))
}

/// Parsed records of the file's last window, newest first.
fn read_tail_records(path: &Path) -> Option<Vec<Value>> {
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = size.saturating_sub(TAIL_WINDOW);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TAIL_WINDOW).read_to_end(&mut bytes).ok()?;
    let mut lines = bytes.split(|byte| *byte == b'\n');
    if start > 0 {
        // The window opens mid-line.
        lines.next();
    }
    let mut records: Vec<Value> = lines
        .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect();
    records.reverse();
    Some(records)
}

fn content_types(message: &Value) -> Vec<&str> {
    message["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block["type"].as_str())
                .collect()
        })
        .unwrap_or_default()
}

fn claude_text(message: &Value) -> Option<String> {
    let text = message["content"]
        .as_array()?
        .iter()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.trim().is_empty()).then(|| cap(text))
}

fn cap(mut text: String) -> String {
    if text.len() > MAX_FINAL_TEXT {
        let mut end = MAX_FINAL_TEXT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}

/// `records` newest first. Claude Code writes bookkeeping lines (titles, cost,
/// permission mode, queue operations, away summaries) around the conversation,
/// so the state comes from the newest `user` / `assistant` record that is not a
/// subagent's.
fn classify_claude_tail(records: &[Value]) -> TurnTail {
    let last = records.iter().find(|record| {
        matches!(record["type"].as_str(), Some("user" | "assistant"))
            && record["isSidechain"] != true
    });
    let Some(last) = last else {
        return TurnTail::of(TailState::Unknown);
    };
    let message = &last["message"];
    if last["type"] == "user" {
        // A user record nobody answered: a prompt, or a tool result the model
        // never saw. A deliberate stop is recorded as a user line too, and is
        // not a cut-off.
        let stopped = match &message["content"] {
            Value::String(text) => text.starts_with("[Request interrupted by user"),
            Value::Array(blocks) => blocks.iter().any(|block| {
                block["text"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("[Request interrupted by user"))
            }),
            _ => false,
        };
        return TurnTail::of(if stopped {
            TailState::Unknown
        } else {
            TailState::Open
        });
    }
    match message["stop_reason"].as_str() {
        Some("end_turn" | "stop_sequence") => {
            // A thinking-only record can carry the stop reason before the text
            // that follows it is written.
            match claude_text(message) {
                Some(text) => TurnTail {
                    state: TailState::Ended,
                    final_text: Some(text),
                },
                None if content_types(message)
                    .iter()
                    .all(|kind| *kind == "thinking") =>
                {
                    TurnTail::of(TailState::Unknown)
                }
                None => TurnTail::of(TailState::Ended),
            }
        }
        // Stopped to call a tool, or still streaming when the process died.
        Some("tool_use") | None => TurnTail::of(TailState::Open),
        // Cut by the token limit, a refusal, a pause: not ours to call.
        Some(_) => TurnTail::of(TailState::Unknown),
    }
}

/// `records` newest first. A Codex rollout brackets each turn with
/// `task_started` and `task_complete` events; `turn_aborted` is a deliberate
/// interrupt.
fn classify_codex_tail(records: &[Value]) -> TurnTail {
    for record in records {
        if record["type"] != "event_msg" {
            continue;
        }
        let payload = &record["payload"];
        match payload["type"].as_str() {
            Some("task_complete") => {
                return TurnTail {
                    state: TailState::Ended,
                    final_text: payload["last_agent_message"]
                        .as_str()
                        .filter(|text| !text.trim().is_empty())
                        .map(|text| cap(text.to_string())),
                };
            }
            Some("task_started") => return TurnTail::of(TailState::Open),
            Some("turn_aborted") => return TurnTail::of(TailState::Unknown),
            _ => {}
        }
    }
    TurnTail::of(TailState::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Oldest first, like a file; the classifiers take newest first.
    fn tail(lines: &[Value]) -> Vec<Value> {
        lines.iter().rev().cloned().collect()
    }

    fn assistant(stop_reason: Value, content: Value) -> Value {
        json!({"type": "assistant", "message": {"role": "assistant", "stop_reason": stop_reason, "content": content}})
    }

    #[test]
    fn claude_end_turn_is_finished_and_carries_the_final_text() {
        let records = tail(&[
            json!({"type": "user", "message": {"role": "user", "content": "do it"}}),
            assistant(
                json!("end_turn"),
                json!([{"type": "text", "text": "Done."}]),
            ),
            json!({"type": "system", "subtype": "turn_duration"}),
            json!({"type": "last-prompt"}),
            json!({"type": "cost-state"}),
        ]);
        let result = classify_claude_tail(&records);
        assert_eq!(result.state, TailState::Ended);
        assert_eq!(result.final_text.as_deref(), Some("Done."));
    }

    #[test]
    fn claude_unanswered_work_is_open() {
        let tool_use = tail(&[assistant(json!("tool_use"), json!([{"type": "tool_use"}]))]);
        assert_eq!(classify_claude_tail(&tool_use).state, TailState::Open);

        let streaming = tail(&[assistant(
            Value::Null,
            json!([{"type": "text", "text": "par"}]),
        )]);
        assert_eq!(classify_claude_tail(&streaming).state, TailState::Open);

        let tool_result = tail(&[
            assistant(json!("tool_use"), json!([{"type": "tool_use"}])),
            json!({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result"}]}}),
            json!({"type": "queue-operation"}),
        ]);
        assert_eq!(classify_claude_tail(&tool_result).state, TailState::Open);
    }

    #[test]
    fn claude_ambiguous_tails_are_unknown() {
        assert_eq!(classify_claude_tail(&[]).state, TailState::Unknown);
        let bookkeeping_only = tail(&[json!({"type": "ai-title"}), json!({"type": "cost-state"})]);
        assert_eq!(
            classify_claude_tail(&bookkeeping_only).state,
            TailState::Unknown
        );

        let thinking_only = tail(&[assistant(json!("end_turn"), json!([{"type": "thinking"}]))]);
        assert_eq!(
            classify_claude_tail(&thinking_only).state,
            TailState::Unknown
        );

        let truncated = tail(&[assistant(
            json!("max_tokens"),
            json!([{"type": "text", "text": "x"}]),
        )]);
        assert_eq!(classify_claude_tail(&truncated).state, TailState::Unknown);

        let stopped = tail(&[json!({"type": "user", "message": {"role": "user",
            "content": [{"type": "text", "text": "[Request interrupted by user]"}]}})]);
        assert_eq!(classify_claude_tail(&stopped).state, TailState::Unknown);
    }

    #[test]
    fn claude_ignores_subagent_records() {
        let records = tail(&[
            assistant(
                json!("end_turn"),
                json!([{"type": "text", "text": "Parent done."}]),
            ),
            json!({"type": "assistant", "isSidechain": true, "message": {"stop_reason": "tool_use", "content": []}}),
        ]);
        let result = classify_claude_tail(&records);
        assert_eq!(result.state, TailState::Ended);
        assert_eq!(result.final_text.as_deref(), Some("Parent done."));
    }

    #[test]
    fn codex_task_events_decide() {
        let event = |kind: &str, extra: Value| {
            let mut payload = json!({ "type": kind });
            payload
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            json!({"type": "event_msg", "payload": payload})
        };
        let finished = tail(&[
            event("task_started", json!({})),
            event("task_complete", json!({"last_agent_message": "All set."})),
            event("token_count", json!({})),
        ]);
        let result = classify_codex_tail(&finished);
        assert_eq!(result.state, TailState::Ended);
        assert_eq!(result.final_text.as_deref(), Some("All set."));

        let running = tail(&[
            event("task_started", json!({})),
            json!({"type": "response_item", "payload": {"type": "message"}}),
        ]);
        assert_eq!(classify_codex_tail(&running).state, TailState::Open);

        let aborted = tail(&[
            event("task_started", json!({})),
            event("turn_aborted", json!({})),
        ]);
        assert_eq!(classify_codex_tail(&aborted).state, TailState::Unknown);
        assert_eq!(classify_codex_tail(&[]).state, TailState::Unknown);
    }

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("bycoda-probe-{name}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn probe_reads_claude_and_codex_files_and_reports_missing_ones() {
        let dir = Tmp::new("files");
        let id = "11111111-2222-3333-4444-555555555555";

        let project = claude_project_dir(&dir.0.join("claude"), "/work/app");
        std::fs::create_dir_all(&project).unwrap();
        let line = assistant(json!("end_turn"), json!([{"type": "text", "text": "ok"}]));
        std::fs::write(project.join(format!("{id}.jsonl")), format!("{line}\n")).unwrap();
        let claude = probe_in(&dir.0.join("claude"), "claude", id, "/work/app");
        assert_eq!(claude.state, TailState::Ended);
        // Found by id even when the cwd flattens to another folder.
        let moved = probe_in(&dir.0.join("claude"), "claude", id, "/elsewhere");
        assert_eq!(moved.state, TailState::Ended);

        let day = dir.0.join("codex/sessions/2026/10/01");
        std::fs::create_dir_all(&day).unwrap();
        let started = json!({"type": "event_msg", "payload": {"type": "task_started"}});
        std::fs::write(
            day.join(format!("rollout-2026-10-01T10-00-00-{id}.jsonl")),
            format!("{started}\n"),
        )
        .unwrap();
        assert_eq!(
            probe_in(&dir.0.join("codex"), "codex", id, "/x").state,
            TailState::Open
        );

        assert_eq!(
            probe_in(
                &dir.0.join("codex"),
                "codex",
                "99999999-2222-3333-4444-555555555555",
                "/x"
            )
            .state,
            TailState::Missing
        );
    }

    #[test]
    fn a_window_that_opens_mid_line_drops_the_partial_record() {
        let dir = Tmp::new("window");
        let path = dir.0.join("big.jsonl");
        let filler = json!({"type": "user", "message": {"content": "x".repeat(2000)}});
        let mut text = String::new();
        while (text.len() as u64) < TAIL_WINDOW + 5000 {
            text.push_str(&format!("{filler}\n"));
        }
        text.push_str(&format!(
            "{}\n",
            assistant(json!("end_turn"), json!([{"type": "text", "text": "fin"}]))
        ));
        std::fs::write(&path, text).unwrap();
        let records = read_tail_records(&path).unwrap();
        assert_eq!(classify_claude_tail(&records).state, TailState::Ended);
    }
}
