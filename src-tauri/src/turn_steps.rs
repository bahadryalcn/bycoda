//! The records of a provider's own transcript that belong to its last turn,
//! so Bycoda can show the tool calls and replies a turn produced while the
//! app was closed. Nothing is parsed here beyond what the session import
//! already reads: the Claude and Codex readers in `session_import` reduce the
//! bytes, and the webview converts them into blocks with the import's own
//! code.
//!
//! Read-only, like the probe. The file is read backwards in growing windows
//! until one contains the turn's prompt, up to a cap; a turn longer than the
//! cap comes back without its beginning and says so.

use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::provider_usage::account_config_dir;
use crate::session_import::{
    claude_prompt, claude_transcript_from, codex_transcript_from, CodexEntry,
};
use crate::session_store::validate_id;
use crate::turn_probe::{find_claude_transcript, find_codex_rollout};

/// Window sizes tried in turn; the last one is the cap on how far back a turn
/// is followed.
const WINDOWS: [u64; 4] = [1 << 20, 2 << 20, 4 << 20, 8 << 20];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteps {
    /// Replayable Claude JSONL, from the turn's prompt on. Claude only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Codex entries, from the turn's prompt on. Codex only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<CodexEntry>>,
    /// The prompt that opens the turn is in `text` / `entries`. False when the
    /// turn is longer than the cap and only its end was read.
    pub start_reached: bool,
}

#[tauri::command]
pub async fn read_turn_steps(
    app: AppHandle,
    provider: String,
    provider_session_id: String,
    cwd: String,
    provider_account_id: Option<String>,
) -> Result<Option<TurnSteps>, String> {
    validate_id(&provider_session_id, "provider session")?;
    let config_dir = match provider.as_str() {
        "claude" | "codex" => account_config_dir(&app, &provider, provider_account_id.as_deref())?,
        _ => return Ok(None),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let found = if provider == "claude" {
            find_claude_transcript(&config_dir, &provider_session_id, &cwd)
        } else {
            find_codex_rollout(&config_dir, &provider_session_id)
        };
        found.and_then(|path| steps_in(&path, &provider, &WINDOWS))
    })
    .await
    .map_err(|error| error.to_string())
}

/// The last `window` bytes of the file, starting on a line boundary, and
/// whether that is the whole file.
fn read_window(path: &Path, window: u64) -> Option<(Vec<u8>, bool)> {
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = size.saturating_sub(window);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(window).read_to_end(&mut bytes).ok()?;
    if start > 0 {
        // The window opens mid-line: drop that line.
        let cut = bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |index| index + 1);
        bytes.drain(..cut);
    }
    Some((bytes, start == 0))
}

fn steps_in(path: &Path, provider: &str, windows: &[u64]) -> Option<TurnSteps> {
    let mut last = None;
    for window in windows {
        let (bytes, whole_file) = read_window(path, *window)?;
        let mut steps = reduce(provider, bytes)?;
        // A file read whole has nothing before its first record to look for.
        steps.start_reached |= whole_file;
        let done = steps.start_reached;
        last = Some(steps);
        if done {
            break;
        }
    }
    last
}

/// The window's records from its last prompt on (all of them when it has none).
fn reduce(provider: &str, bytes: Vec<u8>) -> Option<TurnSteps> {
    let mut reader = Cursor::new(bytes);
    if provider == "claude" {
        let transcript = claude_transcript_from(&mut reader, usize::MAX).ok()?;
        let lines: Vec<&str> = transcript.text.lines().collect();
        let prompt = lines.iter().rposition(|line| {
            serde_json::from_str::<Value>(line)
                .map(|record| record["type"] == "user" && claude_prompt(&record).is_some())
                .unwrap_or(false)
        });
        let from = prompt.unwrap_or(0);
        Some(TurnSteps {
            text: Some(lines[from..].join("\n")),
            entries: None,
            start_reached: prompt.is_some(),
        })
    } else {
        let transcript = codex_transcript_from(&mut reader, usize::MAX).ok()?;
        let prompt = transcript
            .entries
            .iter()
            .rposition(|entry| entry.kind == "user");
        let from = prompt.unwrap_or(0);
        Some(TurnSteps {
            text: None,
            entries: Some(transcript.entries[from..].to_vec()),
            start_reached: prompt.is_some(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_file(name: &str, lines: &[Value]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("bycoda-steps-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let body: Vec<String> = lines.iter().map(Value::to_string).collect();
        std::fs::write(&path, body.join("\n") + "\n").unwrap();
        path
    }

    fn claude_user(text: &str) -> Value {
        json!({"type": "user", "timestamp": "2026-05-01T10:00:00.000Z",
            "message": {"role": "user", "content": text}})
    }

    fn claude_tool_use(id: &str, command: &str) -> Value {
        json!({"type": "assistant", "message": {"role": "assistant", "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "id": id, "name": "Bash", "input": {"command": command}}]}})
    }

    fn claude_tool_result(id: &str, output: &str) -> Value {
        json!({"type": "user", "message": {"role": "user",
            "content": [{"type": "tool_result", "tool_use_id": id, "content": output}]}})
    }

    fn claude_reply(text: &str) -> Value {
        json!({"type": "assistant", "message": {"role": "assistant", "stop_reason": "end_turn",
            "content": [{"type": "text", "text": text}]}})
    }

    fn prompts_in(text: &str) -> usize {
        text.lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|record| record["type"] == "user" && claude_prompt(record).is_some())
            .count()
    }

    #[test]
    fn claude_turn_is_cut_at_its_prompt_and_keeps_every_step() {
        let path = temp_file(
            "s.jsonl",
            &[
                claude_user("first question"),
                claude_reply("first answer"),
                claude_user("second question"),
                claude_tool_use("t1", "ls"),
                claude_tool_result("t1", "a b"),
                claude_tool_use("t2", "cat a"),
                claude_tool_result("t2", "hello"),
                json!({"type": "ai-title", "title": "ignored"}),
                claude_reply("all done"),
            ],
        );
        let steps = steps_in(&path, "claude", &WINDOWS).unwrap();
        assert!(steps.start_reached);
        let text = steps.text.unwrap();
        assert_eq!(prompts_in(&text), 1);
        assert!(text.contains("second question"));
        assert!(!text.contains("first answer"));
        assert!(text.contains("\"t1\"") && text.contains("\"t2\""));
        assert!(text.contains("all done"));
        assert!(!text.contains("ignored"), "bookkeeping lines stay out");
    }

    #[test]
    fn claude_turn_without_an_end_is_still_read() {
        let path = temp_file(
            "s.jsonl",
            &[
                claude_user("go"),
                claude_tool_use("t1", "ls"),
                claude_tool_result("t1", "x"),
                claude_tool_use("t2", "pwd"),
            ],
        );
        let text = steps_in(&path, "claude", &WINDOWS).unwrap().text.unwrap();
        assert!(text.contains("\"t2\""));
    }

    #[test]
    fn claude_turn_longer_than_the_cap_comes_back_without_its_prompt() {
        let filler = "x".repeat(400);
        let mut lines = vec![claude_user("the long one")];
        for index in 0..40 {
            lines.push(claude_tool_use(&format!("t{index}"), "ls"));
            lines.push(claude_tool_result(&format!("t{index}"), &filler));
        }
        let path = temp_file("s.jsonl", &lines);
        // Windows far smaller than the turn: the prompt is never reached.
        let steps = steps_in(&path, "claude", &[1_000, 2_000, 4_000]).unwrap();
        assert!(!steps.start_reached);
        let text = steps.text.unwrap();
        assert!(!text.contains("the long one"));
        assert!(
            text.contains("\"t39\""),
            "the end of the turn is what is kept"
        );
        // The first line of a window is a cut-off fragment and must not leak.
        assert!(text
            .lines()
            .all(|line| serde_json::from_str::<Value>(line).is_ok()));
    }

    #[test]
    fn window_grows_until_the_prompt_is_inside() {
        let filler = "y".repeat(300);
        let mut lines = vec![claude_user("old"), claude_reply("old reply")];
        lines.push(claude_user("current"));
        for index in 0..6 {
            lines.push(claude_tool_use(&format!("t{index}"), "ls"));
            lines.push(claude_tool_result(&format!("t{index}"), &filler));
        }
        let path = temp_file("s.jsonl", &lines);
        // The first window cannot hold the prompt; a later one can.
        let steps = steps_in(&path, "claude", &[600, 1_200, 100_000]).unwrap();
        assert!(steps.start_reached);
        let text = steps.text.unwrap();
        assert!(text.contains("current") && !text.contains("old reply"));
        assert!(text.contains("\"t0\"") && text.contains("\"t5\""));
    }

    fn codex_line(kind: &str, payload: Value) -> Value {
        json!({"timestamp": "2026-05-01T10:00:00.000Z", "type": kind, "payload": payload})
    }

    fn codex_turn(prompt: &str, call: &str) -> Vec<Value> {
        vec![
            codex_line("event_msg", json!({"type": "task_started"})),
            codex_line(
                "event_msg",
                json!({"type": "user_message", "message": prompt}),
            ),
            codex_line(
                "response_item",
                json!({"type": "function_call", "name": "shell_command", "call_id": call,
                    "arguments": "{\"command\":\"ls\"}"}),
            ),
            codex_line(
                "response_item",
                json!({"type": "function_call_output", "call_id": call,
                    "output": "Exit code: 0\nOutput:\nfiles"}),
            ),
            codex_line(
                "response_item",
                json!({"type": "message", "role": "assistant",
                    "content": [{"type": "output_text", "text": format!("answer to {prompt}")}]}),
            ),
            codex_line("event_msg", json!({"type": "task_complete"})),
        ]
    }

    #[test]
    fn codex_turn_is_cut_at_its_prompt_with_calls_and_outputs() {
        let mut lines = codex_turn("first", "call_a");
        lines.extend(codex_turn("second", "call_b"));
        let path = temp_file("rollout-x.jsonl", &lines);
        let steps = steps_in(&path, "codex", &WINDOWS).unwrap();
        assert!(steps.start_reached);
        let entries = steps.entries.unwrap();
        let kinds: Vec<&str> = entries.iter().map(|entry| entry.kind).collect();
        assert_eq!(kinds, ["user", "tool", "assistant"]);
        assert_eq!(entries[0].text, "second");
        assert_eq!(entries[1].call_id.as_deref(), Some("call_b"));
        assert!(entries[1].output.as_deref().unwrap().contains("files"));
    }

    #[test]
    fn codex_turn_longer_than_the_cap_reports_a_missing_start() {
        let mut lines = vec![codex_line(
            "event_msg",
            json!({"type": "user_message", "message": "the long one"}),
        )];
        for index in 0..40 {
            lines.push(codex_line(
                "response_item",
                json!({"type": "function_call", "name": "shell_command",
                    "call_id": format!("c{index}"), "arguments": "{\"command\":\"ls\"}"}),
            ));
            lines.push(codex_line(
                "response_item",
                json!({"type": "function_call_output", "call_id": format!("c{index}"),
                    "output": "z".repeat(400)}),
            ));
        }
        let path = temp_file("rollout-y.jsonl", &lines);
        let steps = steps_in(&path, "codex", &[1_000, 2_000]).unwrap();
        assert!(!steps.start_reached);
        let entries = steps.entries.unwrap();
        assert!(entries.iter().all(|entry| entry.kind != "user"));
        assert!(entries
            .iter()
            .any(|entry| entry.call_id.as_deref() == Some("c39")));
    }

    #[test]
    fn a_missing_file_gives_nothing() {
        assert!(steps_in(Path::new("/definitely/not/here.jsonl"), "claude", &WINDOWS).is_none());
    }
}
