//! Finds the conversations Claude Code and Codex stored on disk and reads them
//! back in bounded pieces, so Bycoda can import them as sessions.
//!
//! Everything here is read-only: `~/.claude` and `~/.codex` are never written
//! to. Discovery reads only a head and a tail window of each file, because a
//! single rollout can run past 100 MB and a user can have hundreds of them.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::fs::{claude_message_text, claude_project_dir, path_to_js};
use crate::provider_usage::{account_config_dir, collect_jsonl, is_log, open_log, parse_timestamp};

/// How much of a file's start discovery reads looking for the working
/// directory, the first prompt and the model.
const HEAD_BYTES: usize = 2 * 1024 * 1024;
/// How much of a file's end it reads to find the last timestamp.
const TAIL_BYTES: u64 = 128 * 1024;
/// A line longer than this is skipped rather than held in memory. It is
/// almost always a tool result carrying a whole file or an embedded image.
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS: usize = 240;
const MAX_TOOL_INPUT_BYTES: usize = 24 * 1024;
const MAX_TOOL_OUTPUT_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportKind {
    /// A conversation a person had in the terminal, desktop app or editor.
    Interactive,
    /// A non-interactive run (`claude -p`, `codex exec`, an SDK call).
    Exec,
    /// A thread another agent spawned.
    Subagent,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    /// `claude` or `codex`.
    pub provider: &'static str,
    pub path: String,
    pub provider_session_id: String,
    /// The folder the conversation ran in, as the transcript recorded it.
    pub cwd: String,
    pub cwd_exists: bool,
    /// Whether the provider can resume this conversation from `cwd`. Claude
    /// finds a conversation by its working directory, so a transcript whose
    /// recorded directory does not map to the folder it was filed under cannot
    /// be continued from there. Archived Codex rollouts are not resumed either.
    pub resumable: bool,
    pub first_prompt: String,
    pub started_at: u64,
    pub last_at: u64,
    pub size_bytes: u64,
    pub kind: ImportKind,
    pub model: Option<String>,
    /// Codex moves conversations the user archived out of `sessions`.
    pub archived: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryReport {
    pub candidates: Vec<ImportCandidate>,
    pub files_scanned: usize,
    /// Files with no working directory or no prompt: nothing to import.
    pub files_skipped: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTranscript {
    /// Replayable JSONL records (user and assistant, subagent traffic left out
    /// the way the live replay leaves it out), oldest first.
    pub text: String,
    /// Older records were dropped to stay within the byte budget.
    pub truncated: bool,
    pub total_records: usize,
    pub kept_records: usize,
    /// Records too large to hold, skipped outright.
    pub oversize_skipped: usize,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEntry {
    /// `user`, `assistant` or `tool`.
    pub kind: &'static str,
    pub at: u64,
    pub text: String,
    pub call_id: Option<String>,
    pub name: Option<String>,
    pub input: Option<String>,
    pub output: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTranscript {
    pub entries: Vec<CodexEntry>,
    pub truncated: bool,
    /// Entries dropped from the start to stay within the byte budget.
    pub dropped: usize,
    pub oversize_skipped: usize,
}

// --- commands -------------------------------------------------------------

#[tauri::command]
pub async fn import_discover(app: AppHandle) -> Result<DiscoveryReport, String> {
    let (claude, codex) = source_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || discover_in(&claude, &codex))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_read_claude(
    app: AppHandle,
    path: String,
    max_bytes: usize,
) -> Result<ClaudeTranscript, String> {
    let (claude, _) = source_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = allowed_source(&path, std::slice::from_ref(&claude))?;
        read_claude_transcript(&path, max_bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn import_read_codex(
    app: AppHandle,
    path: String,
    max_bytes: usize,
) -> Result<CodexTranscript, String> {
    let (_, codex) = source_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = allowed_source(&path, &codex)?;
        read_codex_transcript(&path, max_bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A real folder to file a conversation under when the one it ran in is gone
/// (or is not a project folder, like the home directory). Created on demand
/// inside the app's own data directory and named after the original folder.
#[tauri::command]
pub fn import_placeholder_dir(app: AppHandle, original: String) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("imported-history");
    let dir = root.join(placeholder_name(&original));
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(path_to_js(&dir))
}

fn placeholder_name(original: &str) -> String {
    let normalized = original.replace('\\', "/");
    let last = normalized
        .trim_end_matches('/')
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or("folder");
    let clean: String = last
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '-'
            }
        })
        .take(48)
        .collect();
    // FNV-1a over the full path, so two folders with the same name stay apart.
    let mut hash: u32 = 0x811c_9dc5;
    for byte in normalized.to_lowercase().trim_end_matches('/').bytes() {
        hash = (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193);
    }
    format!(
        "Missing folder - {} [{:06x}]",
        clean.trim(),
        hash & 0x00ff_ffff
    )
}

fn source_roots(app: &AppHandle) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let claude = account_config_dir(app, "claude", None)?.join("projects");
    let codex = account_config_dir(app, "codex", None)?;
    Ok((
        claude,
        vec![codex.join("sessions"), codex.join("archived_sessions")],
    ))
}

/// Only files under the provider stores may be read through these commands.
fn allowed_source(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical =
        std::fs::canonicalize(path).map_err(|error| format!("Cannot read {path}: {error}"))?;
    let inside = roots
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| canonical.starts_with(root));
    if !inside || !is_log(&canonical) {
        return Err("Not a Claude Code or Codex transcript".into());
    }
    Ok(canonical)
}

// --- shared helpers -------------------------------------------------------

/// Reads one line into `buf` (cleared first), keeping at most `cap` bytes of
/// it. Returns the bytes taken from the stream and whether the line was cut,
/// or `None` at the end of the stream.
fn read_capped_line<R: BufRead + ?Sized>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    cap: usize,
) -> std::io::Result<Option<(usize, bool)>> {
    buf.clear();
    let mut consumed = 0usize;
    let mut cut = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            return Ok((consumed > 0).then_some((consumed, cut)));
        }
        let (take, done) = match chunk.iter().position(|byte| *byte == b'\n') {
            Some(index) => (index + 1, true),
            None => (chunk.len(), false),
        };
        let keep = take.min(cap.saturating_sub(buf.len()));
        buf.extend_from_slice(&chunk[..keep]);
        cut |= keep < take;
        reader.consume(take);
        consumed += take;
        if done {
            return Ok(Some((consumed, cut)));
        }
    }
}

/// Unix milliseconds for an RFC 3339 timestamp.
fn parse_ms(text: &str) -> Option<u64> {
    let seconds = u64::try_from(parse_timestamp(text)?).ok()?;
    let millis = text
        .get(19..)
        .and_then(|rest| rest.strip_prefix('.'))
        .map(|fraction| {
            fraction
                .chars()
                .take_while(char::is_ascii_digit)
                .take(3)
                .collect::<String>()
        })
        .filter(|digits| !digits.is_empty())
        .map(|digits| digits.parse::<u64>().unwrap_or(0) * 10u64.pow(3 - digits.len() as u32))
        .unwrap_or(0);
    Some(seconds * 1000 + millis)
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// The newest `timestamp` in the last window of a plain file.
fn last_timestamp(path: &Path, size: u64) -> Option<u64> {
    if path.extension().and_then(|ext| ext.to_str()) == Some("zst") {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let start = size.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    #[derive(Deserialize)]
    struct Stamp {
        timestamp: Option<String>,
    }
    let mut lines = bytes.split(|byte| *byte == b'\n');
    if start > 0 {
        // The window opens mid-line.
        lines.next();
    }
    lines
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .filter(|line| !line.is_empty())
        .find_map(|line| {
            serde_json::from_slice::<Stamp>(line)
                .ok()
                .and_then(|stamp| stamp.timestamp)
                .and_then(|text| parse_ms(&text))
        })
}

fn collapse(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX_PROMPT_CHARS {
        return flat;
    }
    let short: String = flat.chars().take(MAX_PROMPT_CHARS - 1).collect();
    format!("{short}\u{2026}")
}

fn tag_text<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(text[start..end].trim())
}

fn cap_bytes(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Run `f` over every item on a few threads. Discovery is bound by opening
/// hundreds of files, which overlaps well.
fn par_filter_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> Option<R> + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let out = Mutex::new(Vec::new());
    let workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .min(8);
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(item) = items.get(index) else { break };
                if let Some(found) = f(item) {
                    if let Ok(mut out) = out.lock() {
                        out.push((index, found));
                    }
                }
            });
        }
    });
    let mut found = out.into_inner().unwrap_or_default();
    found.sort_by_key(|(index, _)| *index);
    found.into_iter().map(|(_, value)| value).collect()
}

// --- discovery ------------------------------------------------------------

pub(crate) fn discover_in(claude_projects: &Path, codex_roots: &[PathBuf]) -> DiscoveryReport {
    let started = Instant::now();

    let mut claude_files: Vec<(PathBuf, String)> = Vec::new();
    if let Ok(projects) = std::fs::read_dir(claude_projects) {
        for project in projects.flatten() {
            if !project.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let folder = project.file_name().to_string_lossy().into_owned();
            let Ok(files) = std::fs::read_dir(project.path()) else {
                continue;
            };
            // Only the top level: nested `subagents/` transcripts are shown
            // inside the conversation that spawned them.
            for file in files.flatten() {
                let path = file.path();
                if file.file_type().is_ok_and(|kind| kind.is_file())
                    && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
                {
                    claude_files.push((path, folder.clone()));
                }
            }
        }
    }

    // `sessions` first, so a rollout caught mid-archive is reported once.
    let mut codex_files: Vec<(PathBuf, bool)> = Vec::new();
    let mut seen_names = HashSet::new();
    for (index, root) in codex_roots.iter().enumerate() {
        let mut found = Vec::new();
        collect_jsonl(root, 0, 0, &mut found);
        for (_, path) in found {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().trim_end_matches(".zst").to_string())
                .unwrap_or_default();
            if seen_names.insert(name) {
                codex_files.push((path, index > 0));
            }
        }
    }

    let files_scanned = claude_files.len() + codex_files.len();
    let mut candidates = par_filter_map(&claude_files, |(path, folder)| {
        scan_claude_file(path, folder)
    });
    candidates.extend(par_filter_map(&codex_files, |(path, archived)| {
        scan_codex_file(path, *archived)
    }));
    let files_skipped = files_scanned - candidates.len();

    // The same conversation can be filed twice (a moved or relocated session):
    // keep whichever was written last.
    let mut best: HashMap<(&'static str, String), usize> = HashMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
        let key = (candidate.provider, candidate.provider_session_id.clone());
        match best.get(&key) {
            Some(&other) if candidates[other].last_at >= candidate.last_at => {}
            _ => {
                best.insert(key, index);
            }
        }
    }
    let keep: HashSet<usize> = best.into_values().collect();
    let mut candidates: Vec<ImportCandidate> = candidates
        .into_iter()
        .enumerate()
        .filter(|(index, _)| keep.contains(index))
        .map(|(_, candidate)| candidate)
        .collect();

    let mut exists: HashMap<String, bool> = HashMap::new();
    for candidate in &mut candidates {
        candidate.cwd_exists = *exists
            .entry(candidate.cwd.clone())
            .or_insert_with(|| Path::new(&candidate.cwd).is_dir());
    }
    candidates.sort_by(|a, b| b.last_at.cmp(&a.last_at).then(a.path.cmp(&b.path)));

    DiscoveryReport {
        candidates,
        files_scanned,
        files_skipped,
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

/// The prompt a person typed, or nothing for the wrappers Claude Code records
/// around slash commands and system notices.
pub(crate) fn claude_prompt(record: &Value) -> Option<String> {
    let text = claude_message_text(record)?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if text.starts_with("<command-name>") || text.starts_with("<command-message>") {
        let name = tag_text(text, "command-name")?;
        return Some(collapse(&match tag_text(text, "command-args") {
            Some(args) if !args.is_empty() => format!("{name} {args}"),
            _ => name.to_string(),
        }));
    }
    const NOISE: [&str; 6] = [
        "<local-command",
        "Caveat:",
        "<system-reminder>",
        "<task-notification",
        "[Request interrupted",
        "<bash-",
    ];
    if NOISE.iter().any(|prefix| text.starts_with(prefix)) {
        return None;
    }
    Some(collapse(text))
}

fn flatten_cwd(cwd: &str) -> String {
    claude_project_dir(Path::new(""), cwd)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn scan_claude_file(path: &Path, folder: &str) -> Option<ImportCandidate> {
    let size = std::fs::metadata(path).ok()?.len();
    let id = path.file_stem()?.to_str()?.to_string();
    let mut reader = open_log(path)?;
    let mut buf = Vec::new();
    let mut read = 0usize;

    let mut cwds: Vec<String> = Vec::new();
    let mut matched: Option<String> = None;
    let mut prompt: Option<String> = None;
    let mut model: Option<String> = None;
    let mut started_at: Option<u64> = None;
    let mut entrypoint: Option<String> = None;
    let mut first_sidechain: Option<bool> = None;

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
        let kind = record.get("type").and_then(Value::as_str);
        if !matches!(kind, Some("user" | "assistant")) {
            continue;
        }
        let sidechain = record
            .get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        first_sidechain.get_or_insert(sidechain);
        if entrypoint.is_none() {
            entrypoint = record
                .get("entrypoint")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        if started_at.is_none() {
            started_at = record
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(parse_ms);
        }
        if let Some(cwd) = record.get("cwd").and_then(Value::as_str) {
            if !cwds.iter().any(|seen| seen == cwd) && cwds.len() < 8 {
                cwds.push(cwd.to_string());
                if matched.is_none() && flatten_cwd(cwd).eq_ignore_ascii_case(folder) {
                    matched = Some(cwd.to_string());
                }
            }
        }
        if kind == Some("assistant") && model.is_none() {
            model = record
                .pointer("/message/model")
                .and_then(Value::as_str)
                .filter(|name| !name.starts_with('<'))
                .map(str::to_string);
        }
        let is_meta = record
            .get("isMeta")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // A file made only of sidechain records is a subagent's own transcript;
        // its first prompt is the brief it was given.
        let own_prompt = !sidechain || first_sidechain == Some(true);
        if kind == Some("user") && own_prompt && !is_meta && prompt.is_none() {
            prompt = claude_prompt(&record);
        }
        if prompt.is_some() && model.is_some() && matched.is_some() {
            break;
        }
    }

    // Nothing was ever typed (or it never recorded where): not a conversation.
    let prompt = prompt?;
    let resumable = matched.is_some();
    let cwd = matched.or_else(|| cwds.first().cloned())?;
    let last_at = last_timestamp(path, size).unwrap_or_else(|| modified_ms(path));
    Some(ImportCandidate {
        provider: "claude",
        path: path_to_js(path),
        provider_session_id: id,
        cwd,
        cwd_exists: false,
        resumable,
        first_prompt: prompt,
        started_at: started_at.unwrap_or(last_at),
        last_at: last_at.max(started_at.unwrap_or(0)),
        size_bytes: size,
        kind: if first_sidechain == Some(true) {
            ImportKind::Subagent
        } else if entrypoint.as_deref() == Some("sdk-cli") {
            ImportKind::Exec
        } else {
            ImportKind::Interactive
        },
        model,
        archived: false,
    })
}

/// Context Codex injects as a user message: not something the person wrote.
fn is_injected_user_text(text: &str) -> bool {
    let text = text.trim_start();
    const INJECTED: [&str; 9] = [
        "<environment_context",
        "# AGENTS.md instructions",
        "<user_instructions",
        "<skill>",
        "<turn_aborted>",
        "<subagent_notification",
        "<permissions",
        "<image name=",
        "</image>",
    ];
    text.is_empty() || INJECTED.iter().any(|prefix| text.starts_with(prefix))
}

fn codex_message_text(payload: &Value) -> String {
    payload
        .get("content")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn scan_codex_file(path: &Path, archived: bool) -> Option<ImportCandidate> {
    let size = std::fs::metadata(path).ok()?.len();
    let mut reader = open_log(path)?;
    let mut buf = Vec::new();
    let mut read = 0usize;
    let mut first = true;

    let mut meta: Option<Value> = None;
    let mut prompt: Option<String> = None;
    let mut model: Option<String> = None;

    while read < HEAD_BYTES {
        let Ok(Some((taken, cut))) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        else {
            break;
        };
        read += taken;
        if cut {
            continue;
        }
        let line = String::from_utf8_lossy(&buf);
        // The first line is the header; after it only the few record kinds
        // that matter are parsed, since most lines are large tool output.
        let wanted = first
            || (prompt.is_none() && (line.contains("user_message") || line.contains("\"user\"")))
            || (model.is_none() && line.contains("turn_context"));
        if !wanted {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            if first {
                return None;
            }
            continue;
        };
        let payload = record.get("payload");
        if first {
            first = false;
            if record.get("type").and_then(Value::as_str) != Some("session_meta") {
                return None;
            }
            meta = payload.cloned();
            continue;
        }
        let Some(payload) = payload else { continue };
        match (
            record.get("type").and_then(Value::as_str),
            payload.get("type").and_then(Value::as_str),
        ) {
            (Some("turn_context"), _) => {
                model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            (Some("event_msg"), Some("user_message")) if prompt.is_none() => {
                prompt = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .filter(|text| !is_injected_user_text(text))
                    .map(collapse);
            }
            (Some("response_item"), Some("message"))
                if prompt.is_none()
                    && payload.get("role").and_then(Value::as_str) == Some("user") =>
            {
                let text = codex_message_text(payload);
                if !is_injected_user_text(&text) {
                    prompt = Some(collapse(&text));
                }
            }
            _ => {}
        }
        if prompt.is_some() && model.is_some() {
            break;
        }
    }

    let meta = meta?;
    let text = |key: &str| meta.get(key).and_then(Value::as_str);
    let id = text("id")
        .map(str::to_string)
        .or_else(|| rollout_id(path))?;
    let cwd = text("cwd").filter(|cwd| !cwd.is_empty())?.to_string();
    let prompt = prompt?;

    let source = meta.get("source");
    let is_subagent = source.is_some_and(|value| value.get("subagent").is_some())
        || text("thread_source") == Some("subagent")
        || text("parent_thread_id").is_some();
    let is_exec = matches!(source.and_then(Value::as_str), Some("exec" | "mcp"))
        || text("originator") == Some("codex_exec");
    let started_at = text("timestamp").and_then(parse_ms);
    let last_at = last_timestamp(path, size).unwrap_or_else(|| modified_ms(path));
    Some(ImportCandidate {
        provider: "codex",
        path: path_to_js(path),
        provider_session_id: id,
        cwd,
        cwd_exists: false,
        // Resuming an archived rollout was not verified, and a failed resume
        // quietly starts a new thread, so archived ones are history only.
        resumable: !archived,
        first_prompt: prompt,
        started_at: started_at.unwrap_or(last_at),
        last_at: last_at.max(started_at.unwrap_or(0)),
        size_bytes: size,
        kind: if is_subagent {
            ImportKind::Subagent
        } else if is_exec {
            ImportKind::Exec
        } else {
            ImportKind::Interactive
        },
        model,
        archived,
    })
}

/// The thread id embedded in `rollout-<timestamp>-<id>.jsonl[.zst]`.
fn rollout_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name.trim_end_matches(".zst").trim_end_matches(".jsonl");
    // A UUID is 36 characters.
    let id = stem.get(stem.len().checked_sub(36)?..)?;
    (id.len() == 36 && id.bytes().filter(|byte| *byte == b'-').count() == 4).then(|| id.to_string())
}

// --- transcripts ----------------------------------------------------------

/// The replayable records of a Claude conversation, newest `max_bytes` of them.
///
/// Only `user` and `assistant` records outside subagent sidechains are kept,
/// which is exactly what the replay in the webview consumes, so the file's
/// attachments, snapshots and bookkeeping never cross the process boundary.
/// When the budget is exceeded the oldest records go first: continuing the
/// conversation matters more than its opening.
pub(crate) fn read_claude_transcript(
    path: &Path,
    max_bytes: usize,
) -> Result<ClaudeTranscript, String> {
    let mut reader = open_log(path).ok_or_else(|| format!("Cannot open {}", path.display()))?;
    claude_transcript_from(&mut *reader, max_bytes)
}

/// `read_claude_transcript` over any reader, so a window of a file reduces the
/// same way the whole file does.
pub(crate) fn claude_transcript_from(
    reader: &mut dyn BufRead,
    max_bytes: usize,
) -> Result<ClaudeTranscript, String> {
    #[derive(Deserialize)]
    struct Peek {
        #[serde(rename = "type")]
        kind: Option<String>,
        #[serde(rename = "isSidechain")]
        is_sidechain: Option<bool>,
    }
    let mut buf = Vec::new();
    let mut kept: VecDeque<String> = VecDeque::new();
    let mut bytes = 0usize;
    let mut total = 0usize;
    let mut oversize = 0usize;
    while let Some((_, cut)) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        .map_err(|error| error.to_string())?
    {
        if cut {
            oversize += 1;
            continue;
        }
        let Ok(peek) = serde_json::from_slice::<Peek>(&buf) else {
            continue;
        };
        if !matches!(peek.kind.as_deref(), Some("user" | "assistant"))
            || peek.is_sidechain == Some(true)
        {
            continue;
        }
        total += 1;
        let line = String::from_utf8_lossy(&buf).trim_end().to_string();
        bytes += line.len() + 1;
        kept.push_back(line);
        while bytes > max_bytes && kept.len() > 1 {
            if let Some(dropped) = kept.pop_front() {
                bytes -= dropped.len() + 1;
            }
        }
    }
    let kept_records = kept.len();
    Ok(ClaudeTranscript {
        text: kept.into_iter().collect::<Vec<_>>().join("\n"),
        truncated: kept_records < total,
        total_records: total,
        kept_records,
        oversize_skipped: oversize,
    })
}

/// Tools whose rows would only be noise in a read-back transcript.
fn is_quiet_codex_tool(name: &str) -> bool {
    matches!(
        name,
        "wait"
            | "wait_agent"
            | "close_agent"
            | "write_stdin"
            | "update_plan"
            | "request_user_input"
            | "request_user_input_async"
    )
}

/// A readable one-line input for a tool call: the command for a shell tool,
/// the patch for `apply_patch`, the raw arguments otherwise.
fn codex_tool_input(arguments: &str) -> (String, Option<String>) {
    let parsed: Option<Value> = serde_json::from_str(arguments).ok();
    let command = parsed.as_ref().and_then(|args| {
        let field = args.get("command").or_else(|| args.get("cmd"))?;
        match field {
            Value::String(text) => Some(text.clone()),
            Value::Array(parts) => Some(
                parts
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
            _ => None,
        }
    });
    let cwd = parsed
        .as_ref()
        .and_then(|args| args.get("workdir").or_else(|| args.get("cwd")))
        .and_then(Value::as_str)
        .map(str::to_string);
    match command {
        Some(command) => (cap_bytes(&command, MAX_TOOL_INPUT_BYTES), cwd),
        None => (cap_bytes(arguments, 600), cwd),
    }
}

fn function_output_text(payload: &Value) -> String {
    match payload.get("output") {
        Some(Value::String(text)) => text.clone(),
        Some(other) => other
            .get("content")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| other.to_string()),
        None => String::new(),
    }
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum UserSource {
    /// `event_msg` `user_message`: what was typed, in newer rollouts.
    Event,
    /// A `response_item` user message with injected context filtered out:
    /// all that older rollouts have.
    Item,
}

/// A Codex rollout reduced to the conversation: what was said, and the tool
/// calls with their outputs. Reasoning (stored encrypted), token counts and
/// turn bookkeeping are left out.
///
/// The rollout's `response_item` stream exists in every Codex version, while
/// the `event_msg` stream only carries user prompts in newer ones. Prompts are
/// therefore taken from `event_msg` when the file has any, and from the
/// filtered `response_item` messages otherwise.
pub(crate) fn read_codex_transcript(
    path: &Path,
    max_bytes: usize,
) -> Result<CodexTranscript, String> {
    let mut reader = open_log(path).ok_or_else(|| format!("Cannot open {}", path.display()))?;
    codex_transcript_from(&mut *reader, max_bytes)
}

/// `read_codex_transcript` over any reader; see `claude_transcript_from`.
pub(crate) fn codex_transcript_from(
    reader: &mut dyn BufRead,
    max_bytes: usize,
) -> Result<CodexTranscript, String> {
    let mut buf = Vec::new();
    let mut entries: Vec<(Option<UserSource>, CodexEntry)> = Vec::new();
    let mut by_call: HashMap<String, usize> = HashMap::new();
    let mut start = 0usize;
    let mut bytes = 0usize;
    let mut oversize = 0usize;
    let weight = |entry: &CodexEntry| {
        entry.text.len()
            + entry.input.as_ref().map_or(0, String::len)
            + entry.output.as_ref().map_or(0, String::len)
            + 64
    };

    while let Some((_, cut)) = read_capped_line(&mut *reader, &mut buf, MAX_LINE_BYTES)
        .map_err(|error| error.to_string())?
    {
        if cut {
            oversize += 1;
            continue;
        }
        let line = String::from_utf8_lossy(&buf);
        // Most lines are token counts, reasoning and turn bookkeeping.
        if !(line.contains("\"message\"")
            || line.contains("_call")
            || line.contains("user_message"))
        {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(payload) = record.get("payload") else {
            continue;
        };
        let at = record
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_ms)
            .unwrap_or(0);
        let kind = record.get("type").and_then(Value::as_str);
        let payload_type = payload.get("type").and_then(Value::as_str);
        let call_id = payload
            .get("call_id")
            .and_then(Value::as_str)
            .map(str::to_string);

        let mut pushed: Option<(Option<UserSource>, CodexEntry)> = None;
        match (kind, payload_type) {
            (Some("event_msg"), Some("user_message")) => {
                if let Some(text) = payload.get("message").and_then(Value::as_str) {
                    if !is_injected_user_text(text) {
                        pushed = Some((
                            Some(UserSource::Event),
                            CodexEntry {
                                kind: "user",
                                at,
                                text: text.trim().to_string(),
                                ..CodexEntry::default()
                            },
                        ));
                    }
                }
            }
            (Some("response_item"), Some("message")) => {
                let text = codex_message_text(payload);
                match payload.get("role").and_then(Value::as_str) {
                    Some("user") if !is_injected_user_text(&text) => {
                        pushed = Some((
                            Some(UserSource::Item),
                            CodexEntry {
                                kind: "user",
                                at,
                                text: text.trim().to_string(),
                                ..CodexEntry::default()
                            },
                        ));
                    }
                    Some("assistant") if !text.trim().is_empty() => {
                        pushed = Some((
                            None,
                            CodexEntry {
                                kind: "assistant",
                                at,
                                text: text.trim().to_string(),
                                ..CodexEntry::default()
                            },
                        ));
                    }
                    _ => {}
                }
            }
            (Some("response_item"), Some("function_call")) => {
                let name = payload.get("name").and_then(Value::as_str).unwrap_or("");
                if !name.is_empty() && !is_quiet_codex_tool(name) {
                    let arguments = payload
                        .get("arguments")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let (input, cwd) = codex_tool_input(arguments);
                    pushed = Some((
                        None,
                        CodexEntry {
                            kind: "tool",
                            at,
                            call_id: call_id.clone(),
                            name: Some(name.to_string()),
                            input: Some(input),
                            cwd,
                            ..CodexEntry::default()
                        },
                    ));
                }
            }
            (Some("response_item"), Some("custom_tool_call")) => {
                let name = payload.get("name").and_then(Value::as_str).unwrap_or("");
                if !name.is_empty() && !is_quiet_codex_tool(name) {
                    let input = payload.get("input").and_then(Value::as_str).unwrap_or("");
                    let limit = if name == "apply_patch" {
                        MAX_TOOL_INPUT_BYTES
                    } else {
                        600
                    };
                    pushed = Some((
                        None,
                        CodexEntry {
                            kind: "tool",
                            at,
                            call_id: call_id.clone(),
                            name: Some(name.to_string()),
                            input: Some(cap_bytes(input, limit)),
                            ..CodexEntry::default()
                        },
                    ));
                }
            }
            (Some("response_item"), Some("local_shell_call")) => {
                let action = payload.get("action");
                let command = action
                    .and_then(|action| action.get("command"))
                    .and_then(Value::as_array)
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default();
                pushed = Some((
                    None,
                    CodexEntry {
                        kind: "tool",
                        at,
                        call_id: call_id.clone(),
                        name: Some("local_shell".into()),
                        input: Some(cap_bytes(&command, MAX_TOOL_INPUT_BYTES)),
                        cwd: action
                            .and_then(|action| action.get("working_directory"))
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        ..CodexEntry::default()
                    },
                ));
            }
            (Some("response_item"), Some("web_search_call")) => {
                let query = payload
                    .pointer("/action/query")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !query.is_empty() {
                    pushed = Some((
                        None,
                        CodexEntry {
                            kind: "tool",
                            at,
                            name: Some("web_search".into()),
                            input: Some(cap_bytes(query, 600)),
                            ..CodexEntry::default()
                        },
                    ));
                }
            }
            (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => {
                if let Some(index) = call_id.as_ref().and_then(|id| by_call.get(id)).copied() {
                    if index >= start {
                        let output =
                            cap_bytes(&function_output_text(payload), MAX_TOOL_OUTPUT_BYTES);
                        let entry = &mut entries[index].1;
                        bytes += output.len();
                        entry.output = Some(output);
                    }
                }
            }
            _ => {}
        }

        if let Some((source, entry)) = pushed {
            bytes += weight(&entry);
            if let Some(id) = &entry.call_id {
                by_call.insert(id.clone(), entries.len());
            }
            entries.push((source, entry));
            while bytes > max_bytes && entries.len() - start > 1 {
                bytes = bytes.saturating_sub(weight(&entries[start].1));
                // Free the dropped entry's text now; the slot stays so call
                // indexes remain valid.
                entries[start].1 = CodexEntry::default();
                start += 1;
            }
        }
    }

    let had_typed_prompts = entries
        .iter()
        .any(|(source, _)| *source == Some(UserSource::Event));
    let total = entries.len();
    let entries: Vec<CodexEntry> = entries
        .into_iter()
        .skip(start)
        .filter(|(source, _)| match source {
            Some(UserSource::Item) => !had_typed_prompts,
            _ => true,
        })
        .map(|(_, entry)| entry)
        .collect();
    Ok(CodexTranscript {
        entries,
        truncated: start > 0,
        dropped: start.min(total),
        oversize_skipped: oversize,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("bycoda-import-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, lines: &[String]) -> PathBuf {
        let path = dir.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn claude_line(kind: &str, cwd: &str, extra: &str, content: &str) -> String {
        format!(
            r#"{{"type":"{kind}","cwd":{cwd:?},"timestamp":"2026-05-01T10:00:00.250Z",{extra}"message":{content}}}"#
        )
    }

    #[test]
    fn reads_millisecond_timestamps() {
        assert_eq!(parse_ms("1970-01-01T00:00:01.250Z"), Some(1250));
        assert_eq!(parse_ms("1970-01-01T00:00:01Z"), Some(1000));
        assert_eq!(parse_ms("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(parse_ms("nonsense"), None);
    }

    #[test]
    fn capped_lines_skip_the_overflow_without_losing_the_next_line() {
        let mut reader = std::io::Cursor::new(b"abcdefgh\nxy\n".to_vec());
        let mut buf = Vec::new();
        let (taken, cut) = read_capped_line(&mut reader, &mut buf, 4).unwrap().unwrap();
        assert_eq!((taken, cut, buf.as_slice()), (9, true, &b"abcd"[..]));
        let (taken, cut) = read_capped_line(&mut reader, &mut buf, 4).unwrap().unwrap();
        assert_eq!((taken, cut, buf.as_slice()), (3, false, &b"xy\n"[..]));
        assert!(read_capped_line(&mut reader, &mut buf, 4)
            .unwrap()
            .is_none());
    }

    #[test]
    fn discovers_claude_conversations_and_classifies_them() {
        let root = temp_dir("claude");
        let cwd = if cfg!(windows) {
            r"C:\work\app one"
        } else {
            "/work/app one"
        };
        let folder = flatten_cwd(cwd);
        let str_msg = |text: &str| format!(r#"{{"role":"user","content":{text:?}}}"#);
        let asst = r#"{"role":"assistant","model":"claude-opus-test","content":[{"type":"text","text":"hi"}]}"#;

        write(
            &root.join(&folder),
            "11111111-aaaa.jsonl",
            &[
                r#"{"type":"mode","mode":"x"}"#.into(),
                "not json".into(),
                claude_line(
                    "user",
                    cwd,
                    r#""entrypoint":"cli","#,
                    &str_msg("Fix the login bug"),
                ),
                claude_line("assistant", cwd, "", asst),
            ],
        );
        // Automation: the SDK entrypoint.
        write(
            &root.join(&folder),
            "22222222-bbbb.jsonl",
            &[claude_line(
                "user",
                cwd,
                r#""entrypoint":"sdk-cli","#,
                &str_msg("Summarize"),
            )],
        );
        // A subagent file: its records are sidechains.
        write(
            &root.join(&folder),
            "33333333-cccc.jsonl",
            &[claude_line(
                "user",
                cwd,
                r#""isSidechain":true,"#,
                &str_msg("Explore the repo"),
            )],
        );
        // Nothing typed: not a conversation.
        write(
            &root.join(&folder),
            "44444444-dddd.jsonl",
            &[r#"{"type":"file-history-snapshot"}"#.into()],
        );
        // Slash commands are titled by the command, noise is skipped.
        write(
            &root.join(&folder),
            "55555555-eeee.jsonl",
            &[
                claude_line(
                    "user",
                    cwd,
                    "",
                    &str_msg("Caveat: The messages below were generated"),
                ),
                claude_line(
                    "user",
                    cwd,
                    "",
                    &str_msg(
                        "<command-name>/review</command-name><command-args>PR 5</command-args>",
                    ),
                ),
            ],
        );
        // A nested subagent transcript is never listed on its own.
        write(
            &root.join(&folder).join("11111111-aaaa").join("subagents"),
            "agent-1.jsonl",
            &[claude_line("user", cwd, "", &str_msg("nested"))],
        );
        // The recorded directory does not map to its folder: readable, not resumable.
        write(
            &root.join("elsewhere"),
            "66666666-ffff.jsonl",
            &[claude_line("user", cwd, "", &str_msg("Moved transcript"))],
        );

        let report = discover_in(&root, &[]);
        let by_id = |id: &str| {
            report
                .candidates
                .iter()
                .find(|candidate| candidate.provider_session_id == id)
        };
        let main = by_id("11111111-aaaa").unwrap();
        assert_eq!(main.first_prompt, "Fix the login bug");
        assert_eq!(main.kind, ImportKind::Interactive);
        assert_eq!(main.cwd, cwd);
        assert!(main.resumable);
        assert_eq!(main.model.as_deref(), Some("claude-opus-test"));
        assert_eq!(main.started_at, 1_777_629_600_250);
        assert_eq!(by_id("22222222-bbbb").unwrap().kind, ImportKind::Exec);
        assert_eq!(by_id("33333333-cccc").unwrap().kind, ImportKind::Subagent);
        assert!(by_id("44444444-dddd").is_none());
        assert_eq!(by_id("55555555-eeee").unwrap().first_prompt, "/review PR 5");
        assert!(!by_id("66666666-ffff").unwrap().resumable);
        assert_eq!(report.files_scanned, 6);
        assert_eq!(report.files_skipped, 1);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn claude_lowercase_drive_folders_still_match_their_cwd() {
        let root = temp_dir("claude-case");
        let cwd = r"G:\Projects\demo";
        let msg = r#"{"role":"user","content":"hello"}"#;
        write(
            &root.join("g--Projects-demo"),
            "77777777-1111.jsonl",
            &[claude_line("user", cwd, "", msg)],
        );
        let report = discover_in(&root, &[]);
        assert!(report.candidates[0].resumable);
        assert_eq!(report.candidates[0].cwd, cwd);
        std::fs::remove_dir_all(root).ok();
    }

    fn codex_meta(id: &str, cwd: &str, source: &str, originator: &str, extra: &str) -> String {
        format!(
            r#"{{"timestamp":"2026-05-01T09:00:00.000Z","type":"session_meta","payload":{{"id":"{id}","timestamp":"2026-05-01T09:00:00.000Z","cwd":{cwd:?},"originator":"{originator}","source":{source},{extra}"base_instructions":{{"text":"x"}}}}}}"#
        )
    }

    fn codex_user_event(text: &str) -> String {
        format!(
            r#"{{"timestamp":"2026-05-01T09:00:05.000Z","type":"event_msg","payload":{{"type":"user_message","message":{text:?}}}}}"#
        )
    }

    #[test]
    fn discovers_codex_rollouts_and_classifies_them() {
        let root = temp_dir("codex");
        let sessions = root.join("sessions");
        let archived = root.join("archived_sessions");
        let cwd = if cfg!(windows) {
            r"C:\work\api"
        } else {
            "/work/api"
        };
        let turn = r#"{"timestamp":"2026-05-01T09:00:06.000Z","type":"turn_context","payload":{"model":"gpt-test"}}"#;

        write(
            &sessions,
            "2026/05/01/rollout-2026-05-01T09-00-00-aaaaaaaa-0000-0000-0000-000000000001.jsonl",
            &[
                codex_meta("aaaaaaaa-0000-0000-0000-000000000001", cwd, r#""cli""#, "codex-tui", ""),
                codex_user_event("Add pagination"),
                turn.into(),
                r#"{"timestamp":"2026-05-02T09:00:00.000Z","type":"event_msg","payload":{"type":"task_complete"}}"#.into(),
            ],
        );
        write(
            &sessions,
            "2026/05/01/rollout-2026-05-01T09-00-00-aaaaaaaa-0000-0000-0000-000000000002.jsonl",
            &[
                codex_meta(
                    "aaaaaaaa-0000-0000-0000-000000000002",
                    cwd,
                    r#""exec""#,
                    "codex_exec",
                    "",
                ),
                codex_user_event("Run the benchmark"),
            ],
        );
        write(
            &sessions,
            "2026/05/01/rollout-2026-05-01T09-00-00-aaaaaaaa-0000-0000-0000-000000000003.jsonl",
            &[
                codex_meta(
                    "aaaaaaaa-0000-0000-0000-000000000003",
                    cwd,
                    r#"{"subagent":{"thread_spawn":{"parent_thread_id":"p"}}}"#,
                    "codex-tui",
                    r#""thread_source":"subagent","#,
                ),
                codex_user_event("Review this diff"),
            ],
        );
        // Older rollouts only have the response_item stream; injected context
        // is not the prompt.
        write(
            &archived,
            "rollout-2026-04-01T09-00-00-aaaaaaaa-0000-0000-0000-000000000004.jsonl",
            &[
                codex_meta("aaaaaaaa-0000-0000-0000-000000000004", cwd, r#""vscode""#, "Codex Desktop", ""),
                r#"{"timestamp":"2026-04-01T09:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n<cwd>x</cwd>"}]}}"#.into(),
                r#"{"timestamp":"2026-04-01T09:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Explain the schema"}]}}"#.into(),
            ],
        );
        // Compressed rollouts are read through the same path.
        std::fs::write(
            archived
                .join("rollout-2026-04-02T09-00-00-aaaaaaaa-0000-0000-0000-000000000005.jsonl.zst"),
            ruzstd::encoding::compress_to_vec(
                (codex_meta(
                    "aaaaaaaa-0000-0000-0000-000000000005",
                    cwd,
                    r#""cli""#,
                    "codex-tui",
                    "",
                ) + "\n"
                    + &codex_user_event("Packed prompt")
                    + "\n")
                    .as_bytes(),
                ruzstd::encoding::CompressionLevel::Fastest,
            ),
        )
        .unwrap();
        // The same rollout under both roots is reported once.
        write(
            &archived,
            "rollout-2026-05-01T09-00-00-aaaaaaaa-0000-0000-0000-000000000001.jsonl",
            &[codex_meta(
                "aaaaaaaa-0000-0000-0000-000000000001",
                cwd,
                r#""cli""#,
                "codex-tui",
                "",
            )],
        );

        let report = discover_in(&root.join("none"), &[sessions, archived]);
        let by_id = |suffix: &str| {
            report
                .candidates
                .iter()
                .find(|candidate| candidate.provider_session_id.ends_with(suffix))
                .unwrap()
        };
        let first = by_id("0001");
        assert_eq!(first.kind, ImportKind::Interactive);
        assert_eq!(first.first_prompt, "Add pagination");
        assert_eq!(first.model.as_deref(), Some("gpt-test"));
        assert_eq!(first.last_at, 1_777_712_400_000);
        assert!(!first.archived);
        assert_eq!(by_id("0002").kind, ImportKind::Exec);
        assert_eq!(by_id("0003").kind, ImportKind::Subagent);
        assert_eq!(by_id("0004").first_prompt, "Explain the schema");
        assert!(by_id("0004").archived);
        assert!(!by_id("0004").resumable && by_id("0001").resumable);
        assert_eq!(by_id("0005").first_prompt, "Packed prompt");
        assert_eq!(report.candidates.len(), 5);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn claude_transcript_keeps_replayable_records_and_the_newest_when_trimmed() {
        let dir = temp_dir("claude-read");
        let msg = |text: &str| format!(r#"{{"role":"user","content":{text:?}}}"#);
        let path = write(
            &dir,
            "s.jsonl",
            &[
                r#"{"type":"file-history-snapshot","snapshot":{}}"#.into(),
                claude_line("user", "/w", "", &msg("first")),
                claude_line(
                    "assistant",
                    "/w",
                    r#""isSidechain":true,"#,
                    &msg("sidechain"),
                ),
                claude_line("user", "/w", "", &msg("second")),
                "broken".into(),
                claude_line("user", "/w", "", &msg("third")),
            ],
        );
        let all = read_claude_transcript(&path, usize::MAX).unwrap();
        assert!(!all.truncated);
        assert_eq!((all.total_records, all.kept_records), (3, 3));
        assert!(!all.text.contains("sidechain") && !all.text.contains("snapshot"));

        let line = all.text.lines().next().unwrap().len();
        let trimmed = read_claude_transcript(&path, line * 2 + 4).unwrap();
        assert!(trimmed.truncated);
        assert_eq!(trimmed.kept_records, 2);
        assert!(trimmed.text.contains("third") && !trimmed.text.contains("first"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn codex_transcript_maps_messages_and_tools_and_prefers_typed_prompts() {
        let dir = temp_dir("codex-read");
        let item = |ts: &str, payload: &str| {
            format!(
                r#"{{"timestamp":"2026-05-01T09:00:{ts}.000Z","type":"response_item","payload":{payload}}}"#
            )
        };
        let path = write(
            &dir,
            "rollout-x.jsonl",
            &[
                codex_meta(
                    "aaaaaaaa-0000-0000-0000-000000000009",
                    "/w",
                    r#""cli""#,
                    "codex-tui",
                    "",
                ),
                item(
                    "01",
                    r#"{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>x"}]}"#,
                ),
                item(
                    "02",
                    r#"{"type":"message","role":"user","content":[{"type":"input_text","text":"Run the tests"}]}"#,
                ),
                codex_user_event("Run the tests"),
                item(
                    "03",
                    r#"{"type":"reasoning","summary":[],"encrypted_content":"zz"}"#,
                ),
                item(
                    "04",
                    r##"{"type":"function_call","name":"shell_command","arguments":"{\"command\":\"npm test\",\"workdir\":\"/w\"}","call_id":"c1"}"##,
                ),
                item(
                    "05",
                    r#"{"type":"function_call_output","call_id":"c1","output":"Exit code: 0\nok"}"#,
                ),
                item(
                    "06",
                    r#"{"type":"function_call","name":"wait","arguments":"{}","call_id":"c2"}"#,
                ),
                item(
                    "07",
                    r#"{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\n*** Update File: a.ts\n*** End Patch","call_id":"c3"}"#,
                ),
                item(
                    "08",
                    r#"{"type":"custom_tool_call_output","call_id":"c3","output":"done"}"#,
                ),
                item(
                    "09",
                    r#"{"type":"message","role":"assistant","content":[{"type":"output_text","text":"All green."}]}"#,
                ),
            ],
        );
        let result = read_codex_transcript(&path, usize::MAX).unwrap();
        let kinds: Vec<_> = result.entries.iter().map(|entry| entry.kind).collect();
        // The prompt appears once: the typed one, not the response_item copy.
        assert_eq!(kinds, ["user", "tool", "tool", "assistant"]);
        assert_eq!(result.entries[0].text, "Run the tests");
        assert_eq!(result.entries[1].input.as_deref(), Some("npm test"));
        assert_eq!(result.entries[1].cwd.as_deref(), Some("/w"));
        assert_eq!(
            result.entries[1].output.as_deref(),
            Some("Exit code: 0\nok")
        );
        assert_eq!(result.entries[2].name.as_deref(), Some("apply_patch"));
        assert_eq!(result.entries[2].output.as_deref(), Some("done"));
        assert!(!result.truncated);

        let trimmed = read_codex_transcript(&path, 200).unwrap();
        assert!(trimmed.truncated && trimmed.dropped > 0);
        assert_eq!(trimmed.entries.last().unwrap().text, "All green.");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn codex_falls_back_to_response_item_prompts_for_older_rollouts() {
        let dir = temp_dir("codex-old");
        let path = write(
            &dir,
            "rollout-old.jsonl",
            &[
                codex_meta("aaaaaaaa-0000-0000-0000-000000000008", "/w", r#""cli""#, "codex_cli_rs", ""),
                r#"{"timestamp":"2026-04-01T09:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Explain the schema"}]}}"#.into(),
            ],
        );
        let result = read_codex_transcript(&path, usize::MAX).unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].text, "Explain the schema");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn only_provider_transcripts_may_be_read() {
        let root = temp_dir("allow");
        let inside = write(&root.join("store"), "a.jsonl", &["{}".into()]);
        let outside = write(&root, "b.jsonl", &["{}".into()]);
        let roots = [root.join("store")];
        assert!(allowed_source(inside.to_str().unwrap(), &roots).is_ok());
        assert!(allowed_source(outside.to_str().unwrap(), &roots).is_err());
        let sneaky = root.join("store").join("..").join("b.jsonl");
        assert!(allowed_source(sneaky.to_str().unwrap(), &roots).is_err());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn placeholder_names_keep_same_named_folders_apart() {
        let a = placeholder_name(r"G:\old\app");
        let b = placeholder_name(r"G:\other\app");
        assert!(a.starts_with("Missing folder - app ["));
        assert_ne!(a, b);
        assert_eq!(a, placeholder_name("g:/old/app/"));
    }

    /// Dry run against the real stores. Prints aggregate numbers only.
    /// `cargo test -p bycoda --lib real_store_dry_run -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_store_dry_run() {
        let home = PathBuf::from(crate::dirs_home().unwrap());
        let claude = home.join(".claude").join("projects");
        let codex = home.join(".codex");
        let report = discover_in(
            &claude,
            &[codex.join("sessions"), codex.join("archived_sessions")],
        );
        let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
        let mut folders: HashSet<String> = HashSet::new();
        let mut missing: HashSet<String> = HashSet::new();
        let mut unresumable = 0;
        for candidate in &report.candidates {
            let kind = format!("{:?}", candidate.kind).to_lowercase();
            *counts
                .entry(format!("{} / {}", candidate.provider, kind))
                .or_default() += 1;
            let drive = candidate
                .cwd
                .chars()
                .take(2)
                .collect::<String>()
                .to_uppercase();
            *counts.entry(format!("drive {drive}")).or_default() += 1;
            let key = candidate.cwd.to_lowercase().replace('\\', "/");
            folders.insert(key.clone());
            if !candidate.cwd_exists {
                missing.insert(key);
            }
            if candidate.provider == "claude" && !candidate.resumable {
                unresumable += 1;
            }
        }
        println!("files scanned: {}", report.files_scanned);
        println!("files skipped (no prompt/cwd): {}", report.files_skipped);
        println!("candidates: {}", report.candidates.len());
        for (key, value) in &counts {
            println!("  {key}: {value}");
        }
        println!("distinct folders: {}", folders.len());
        println!("missing folders: {}", missing.len());
        println!("claude not resumable (cwd/folder mismatch): {unresumable}");
        println!("scan time: {} ms", report.elapsed_ms);

        // Reading every transcript back, as an import of everything would.
        let started = Instant::now();
        let mut kept_bytes = 0usize;
        let mut truncated = 0usize;
        let mut kinds: std::collections::BTreeMap<&str, usize> = Default::default();
        let mut tools: std::collections::BTreeMap<String, usize> = Default::default();
        for candidate in &report.candidates {
            let path = Path::new(&candidate.path);
            if candidate.provider == "claude" {
                let read = read_claude_transcript(path, 4 * 1024 * 1024).unwrap();
                kept_bytes += read.text.len();
                truncated += usize::from(read.truncated);
            } else {
                let read = read_codex_transcript(path, 4 * 1024 * 1024).unwrap();
                truncated += usize::from(read.truncated);
                for entry in &read.entries {
                    *kinds.entry(entry.kind).or_default() += 1;
                    if let Some(name) = &entry.name {
                        *tools.entry(name.clone()).or_default() += 1;
                    }
                }
            }
        }
        println!(
            "read all transcripts (4 MiB cap each): {} ms, claude kept {} MiB, truncated {}",
            started.elapsed().as_millis(),
            kept_bytes / (1024 * 1024),
            truncated
        );
        println!("codex entries by kind: {kinds:?}");
        let mut tools: Vec<_> = tools.into_iter().collect();
        tools.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
        println!("codex tools (top 12): {:?}", &tools[..tools.len().min(12)]);
    }
}
