use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::dirs_home;
mod attachment_reads;
use crate::git_conflicts::{
    find_git_dir, git_unmerged_checked_for, git_unmerged_for, side_stage, stage_has_side,
    unmerged_message, unmerged_stages_for, GitConflictFile,
};
pub use attachment_reads::AttachmentChunk;

pub(crate) const MAX_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;
pub(crate) const MAX_ATTACHMENT_EMBED_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) const MAX_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_GENERATED_IMAGE_DATA_BYTES: u64 = MAX_GENERATED_IMAGE_BYTES * 4 / 3 + 4;
const GENERATED_IMAGE_DIR: &str = "generated-images";

#[derive(Default)]
struct GitMutationLocks {
    local: Mutex<()>,
    fetch: Mutex<()>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GitMutationScope {
    Local,
    Fetch,
    Exclusive,
}

static GIT_MUTATIONS: Mutex<Option<HashMap<PathBuf, Weak<GitMutationLocks>>>> = Mutex::new(None);

/// Hold the checkout lease for the whole operation, including safety reads and
/// compound commands. Git's own lock still coordinates external processes.
pub(crate) fn with_git_mutation<T>(
    root: &Path,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    with_git_mutation_scope(root, GitMutationScope::Exclusive, work)
}

fn with_git_mutation_scope<T>(
    root: &Path,
    scope: GitMutationScope,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let git_dir = find_git_dir(root).unwrap_or_else(|| root.to_path_buf());
    let common = match std::fs::read_to_string(git_dir.join("commondir")) {
        Ok(path) => git_dir.join(path.trim()),
        Err(error) if error.kind() == ErrorKind::NotFound => git_dir,
        Err(error) => return Err(error.to_string()),
    };
    let key = std::fs::canonicalize(common).map_err(|e| e.to_string())?;
    let lock = {
        let mut guard = GIT_MUTATIONS.lock().map_err(|e| e.to_string())?;
        let locks = guard.get_or_insert_with(HashMap::new);
        locks.retain(|_, value| value.strong_count() > 0);
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(GitMutationLocks::default());
            locks.insert(key, Arc::downgrade(&lock));
            lock
        }
    };
    // Always acquire in this order. A fetch touches remote refs; only local
    // index writes/commit may overlap it. Checkout/rebase/reset fence both.
    let _local = if scope != GitMutationScope::Fetch {
        Some(lock.local.lock().map_err(|e| e.to_string())?)
    } else {
        None
    };
    let _fetch = if scope != GitMutationScope::Local {
        Some(lock.fetch.lock().map_err(|e| e.to_string())?)
    } else {
        None
    };
    work()
}

fn spawn_git_local_mutation<T: Send + 'static>(
    cwd: String,
    work: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = expand_home(&cwd);
        with_git_mutation_scope(&root, GitMutationScope::Local, || work(&root))
    })
}

pub(crate) fn spawn_git_mutation<T: Send + 'static>(
    cwd: String,
    work: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = expand_home(&cwd);
        with_git_mutation(&root, || work(&root))
    })
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageAsset {
    path: String,
    mime_type: String,
    size: u64,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocation {
    path: String,
    identity: String,
}

/// Resolve a project by filesystem identity when its directory was renamed.
///
/// A rename preserves the directory identity. We only inspect direct siblings
/// of the missing path, which keeps this bounded and avoids a filesystem watch
/// or a broad disk search.
#[tauri::command(async)]
pub fn resolve_project_location(
    app: AppHandle,
    path: String,
    identity: Option<String>,
) -> Result<Option<ProjectLocation>, String> {
    let location = resolve_project_location_sync(&path, identity.as_deref())?;
    if let Some(location) = &location {
        crate::file_access::authorize(&app, &expand_home(&location.path), true)?;
    }
    Ok(location)
}

fn resolve_project_location_sync(
    path: &str,
    identity: Option<&str>,
) -> Result<Option<ProjectLocation>, String> {
    let path = expand_home(path);
    if path.is_dir() {
        let identity = directory_identity(&path)?;
        return Ok(Some(ProjectLocation {
            path: path_to_js(&path),
            identity,
        }));
    }

    let Some(identity) = identity.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let Some(parent) = path.parent() else {
        return Ok(None);
    };
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries.flatten() {
        let candidate = entry.path();
        if !candidate.is_dir() {
            continue;
        }
        let Ok(candidate_identity) = directory_identity(&candidate) else {
            continue;
        };
        if candidate_identity == identity {
            return Ok(Some(ProjectLocation {
                path: path_to_js(&candidate),
                identity: candidate_identity,
            }));
        }
    }
    Ok(None)
}

#[cfg(unix)]
fn directory_identity(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    Ok(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn directory_identity(path: &Path) -> Result<String, String> {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };

    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|error| error.to_string())?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    let succeeded = unsafe {
        GetFileInformationByHandle(file.as_raw_handle() as _, std::ptr::addr_of_mut!(info))
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let file_index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    Ok(format!(
        "windows:{}:{file_index}",
        info.dwVolumeSerialNumber
    ))
}

/// One Claude Code conversation on disk, summarized without shipping the whole
/// transcript to the UI: a single session file routinely runs past half a
/// megabyte, and a project can hold dozens.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    id: String,
    path: String,
    title: String,
    updated_at: u64,
    message_count: usize,
}

/// Claude Code stores a project's conversations under a directory derived from
/// its working directory: every character that is not an ASCII letter or digit
/// becomes `-`. That covers separators, but also spaces, punctuation, drive
/// colons and anything non-ASCII — so listing only the characters that looked
/// like separators would miss `/Users/me/My Project` and `C:\src\app` and read
/// a directory that does not exist.
///
/// The mapping only runs this way: `-a-b` could have come from `/a/b`, `/a-b`
/// or `/a.b`, so a directory name can never be turned back into a path.
pub(crate) fn claude_project_dir(config_dir: &Path, cwd: &str) -> PathBuf {
    let flattened: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    config_dir.join("projects").join(flattened)
}

/// The directory a Claude account keeps its config and transcripts in. An
/// added account runs its CLI with `CLAUDE_CONFIG_DIR` pointed at its own
/// profile, so its conversations live there and never under `~/.claude`.
fn claude_config_dir(
    app: &AppHandle,
    provider_account_id: Option<&str>,
) -> Result<PathBuf, String> {
    match provider_account_id {
        Some(id) if id != "default" => crate::harness::provider_account_path(app, "claude", id),
        _ => match std::env::var_os("CLAUDE_CONFIG_DIR") {
            Some(path) => Ok(PathBuf::from(path)),
            None => Ok(
                PathBuf::from(dirs_home().ok_or("Home directory is unavailable")?).join(".claude"),
            ),
        },
    }
}

#[tauri::command]
pub async fn claude_sessions(
    app: AppHandle,
    cwd: String,
    provider_account_id: Option<String>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let config_dir = claude_config_dir(&app, provider_account_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = claude_sessions_sync(&config_dir, &cwd)?;
        if !sessions.is_empty() {
            let root = crate::file_access::canonical_target(&config_dir)?;
            for session in &sessions {
                let path = crate::file_access::canonical_target(Path::new(&session.path))?;
                if !path.starts_with(&root) {
                    return Err("Transcript is outside its provider folder".into());
                }
                crate::file_access::grant_readonly_native(&app, &path)?;
            }
        }
        Ok(sessions)
    })
    .await
    .map_err(|e| format!("{e}"))?
}

fn claude_sessions_sync(config_dir: &Path, cwd: &str) -> Result<Vec<ClaudeSessionSummary>, String> {
    let dir = claude_project_dir(config_dir, &expand_home(cwd).to_string_lossy());
    let Ok(reader) = std::fs::read_dir(&dir) else {
        // No conversations recorded for this project yet is an empty list, not
        // an error the picker should surface.
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for ent in reader.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let updated_at = ent
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let Some(summary) = summarize_claude_session(&path) else {
            continue;
        };
        out.push(ClaudeSessionSummary {
            id: id.to_string(),
            path: path_to_js(&path),
            title: summary.0,
            updated_at,
            message_count: summary.1,
        });
    }
    out.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
    Ok(out)
}

/// Returns the conversation's display title and its human-visible message
/// count. Claude keeps a generated `ai-title` and rewrites it as the topic
/// moves, so the last one wins; the first typed prompt is the fallback for a
/// conversation too short to have earned a title.
fn summarize_claude_session(path: &Path) -> Option<(String, usize)> {
    let file = std::fs::File::open(path).ok()?;
    let mut title: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut messages = 0usize;

    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { break };
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match value.get("type").and_then(|v| v.as_str()) {
            Some("ai-title") => {
                if let Some(text) = value.get("aiTitle").and_then(|v| v.as_str()) {
                    title = Some(text.to_string());
                }
            }
            Some(kind @ ("user" | "assistant")) => {
                // Subagent traffic is bookkeeping for a tool call the parent
                // already shows; counting it would inflate every row.
                if value
                    .get("isSidechain")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    continue;
                }
                messages += 1;
                if kind == "user" && first_prompt.is_none() {
                    first_prompt = claude_message_text(&value);
                }
            }
            _ => {}
        }
    }

    if messages == 0 {
        return None;
    }
    let title = title
        .or(first_prompt)
        .unwrap_or_else(|| "Untitled conversation".to_string());
    Some((truncate_title(&title), messages))
}

/// `content` is a bare string for a typed prompt and a block list once the
/// message carries attachments or tool results.
pub(crate) fn claude_message_text(value: &serde_json::Value) -> Option<String> {
    let content = value.get("message")?.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let blocks = content.as_array()?;
    for block in blocks {
        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn truncate_title(text: &str) -> String {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() <= 80 {
        return cleaned;
    }
    let short: String = cleaned.chars().take(79).collect();
    format!("{short}\u{2026}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    ignored: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OmpInterjectionAnchor {
    id: String,
    after_assistant_text: String,
    after_occurrence: usize,
    after_assistant_text_concat: String,
    after_concat_occurrence: usize,
    /// A directly following text-only answer can have been coalesced into the
    /// parent block by old builds. Require both full texts before splitting it.
    following_assistant_text: Option<String>,
    following_assistant_text_concat: Option<String>,
    text: String,
    custom_type: String,
    severity: Option<String>,
}

/// One active-path assistant message in file order. Both join forms of its
/// text parts are alternatives for the same message, never two messages.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct OmpAssistantText {
    text: String,
    concat: String,
}

/// Recover displayed OMP custom messages that older bycoda builds omitted
/// from their persisted transcript. The provider id is already stored with the
/// session; matching the original JSONL keeps the repair deterministic instead
/// of guessing from neighbouring reasoning text.
#[tauri::command(async)]
pub fn omp_session_interjections(
    provider_session_id: String,
) -> Result<Vec<OmpInterjectionAnchor>, String> {
    let Some(path) = omp_session_path(&provider_session_id)? else {
        return Ok(Vec::new());
    };
    parse_omp_interjections(&path)
}

#[tauri::command(async)]
pub fn omp_active_assistant_texts(
    provider_session_id: String,
) -> Result<Vec<OmpAssistantText>, String> {
    let Some(path) = omp_session_path(&provider_session_id)? else {
        return Ok(Vec::new());
    };
    active_omp_assistant_texts(&path)
}

/// Recover Bash commands that older UI builds saved as a bare "Shell" row.
/// Claude's own transcript retains the complete tool input by tool-use id.
#[tauri::command(async)]
pub fn claude_shell_commands(
    app: AppHandle,
    provider_session_id: String,
    provider_account_id: Option<String>,
    tool_ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    if provider_session_id.is_empty()
        || !provider_session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid Claude provider session id".into());
    }
    if tool_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let config_dir = claude_config_dir(&app, provider_account_id.as_deref())?;
    let transcript_name = format!("{provider_session_id}.jsonl");
    let root = config_dir.join("projects");
    let Some(path) = std::fs::read_dir(root).ok().and_then(|projects| {
        projects.flatten().find_map(|project| {
            let candidate = project.path().join(&transcript_name);
            candidate.is_file().then_some(candidate)
        })
    }) else {
        return Ok(HashMap::new());
    };
    claude_shell_commands_from_file(&path, &tool_ids)
}

fn claude_shell_commands_from_file(
    path: &Path,
    tool_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let wanted: HashSet<&str> = tool_ids.iter().map(String::as_str).collect();
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut commands = HashMap::new();
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| error.to_string())?;
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if record.get("type").and_then(serde_json::Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(content) = record
            .pointer("/message/content")
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };
        for block in content {
            let Some(id) = block.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if wanted.contains(id)
                && block.get("name").and_then(serde_json::Value::as_str) == Some("Bash")
            {
                if let Some(command) = block
                    .pointer("/input/command")
                    .and_then(serde_json::Value::as_str)
                    .filter(|command| !command.trim().is_empty())
                {
                    commands.insert(id.to_owned(), command.to_owned());
                }
            }
        }
        if commands.len() == wanted.len() {
            break;
        }
    }
    Ok(commands)
}

fn omp_session_path(provider_session_id: &str) -> Result<Option<PathBuf>, String> {
    if provider_session_id.is_empty()
        || !provider_session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid OMP provider session id".into());
    }
    let root = dirs_home()
        .map(PathBuf::from)
        .ok_or("Home directory is unavailable")?
        .join(".omp/agent/sessions");
    Ok(find_omp_session_file(&root, provider_session_id))
}

fn find_omp_session_file(root: &Path, provider_session_id: &str) -> Option<PathBuf> {
    let suffix = format!("_{provider_session_id}.jsonl");
    let projects = std::fs::read_dir(root).ok()?;
    for project in projects.flatten() {
        let path = project.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&suffix))
        {
            return Some(path);
        }
        if !path.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(path) else {
            continue;
        };
        for entry in entries.flatten() {
            let candidate = entry.path();
            if candidate.is_file()
                && candidate
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(&suffix))
            {
                return Some(candidate);
            }
        }
    }
    None
}

fn omp_message_text(value: &serde_json::Value, separator: &str) -> String {
    if let Some(text) = value.as_str() {
        return text.to_owned();
    }
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| {
            (part.get("type").and_then(serde_json::Value::as_str) == Some("text"))
                .then(|| part.get("text").and_then(serde_json::Value::as_str))
                .flatten()
        })
        .collect::<Vec<_>>()
        .join(separator)
}

fn read_omp_entries(path: &Path) -> Result<Vec<serde_json::Value>, String> {
    let file = std::fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut entries = Vec::new();
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        entries.push(value);
    }
    Ok(entries)
}

fn omp_active_ids(entries: &[serde_json::Value]) -> HashSet<&str> {
    let nodes: HashMap<_, _> = entries
        .iter()
        .filter_map(|value| value["id"].as_str().map(|id| (id, value)))
        .collect();
    let mut active = HashSet::new();
    let mut cursor = entries.last().and_then(|value| value["id"].as_str());
    while let Some(id) = cursor {
        if !active.insert(id) {
            break;
        }
        cursor = nodes.get(id).and_then(|value| value["parentId"].as_str());
    }
    active
}

// Return the ordered sequence, not per-text counts: a status split may only
// be merged with the message at its own source position.
fn active_omp_assistant_texts(path: &Path) -> Result<Vec<OmpAssistantText>, String> {
    let entries = read_omp_entries(path)?;
    let active = omp_active_ids(&entries);
    Ok(entries
        .iter()
        .filter(|value| {
            value["type"] == "message"
                && value["message"]["role"] == "assistant"
                && value["id"].as_str().is_some_and(|id| active.contains(id))
        })
        .map(|value| {
            let content = &value["message"]["content"];
            OmpAssistantText {
                text: omp_message_text(content, "\n"),
                concat: omp_message_text(content, ""),
            }
        })
        .filter(|message| !message.text.trim().is_empty())
        .collect())
}

fn parse_omp_interjections(path: &Path) -> Result<Vec<OmpInterjectionAnchor>, String> {
    let entries = read_omp_entries(path)?;
    let nodes: HashMap<_, _> = entries
        .iter()
        .filter_map(|value| value["id"].as_str().map(|id| (id, value)))
        .collect();
    let active = omp_active_ids(&entries);
    let mut assistants: HashMap<&str, (String, usize, String, usize)> = HashMap::new();
    let mut occurrences: HashMap<String, usize> = HashMap::new();
    let mut concat_occurrences: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<OmpInterjectionAnchor> = Vec::new();
    // Metadata and compaction participate in ancestry, not anchor text.
    // Keep file order for occurrences and notes, but exclude abandoned branches.
    for value in &entries {
        if !value["id"].as_str().is_some_and(|id| active.contains(id)) {
            continue;
        }
        match value.get("type").and_then(serde_json::Value::as_str) {
            Some("message")
                if value
                    .pointer("/message/role")
                    .and_then(serde_json::Value::as_str)
                    == Some("assistant") =>
            {
                let Some(id) = value.get("id").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                let text = omp_message_text(&value["message"]["content"], "\n");
                let concat_text = omp_message_text(&value["message"]["content"], "");
                if text.trim().is_empty() {
                    continue;
                }
                if let Some(anchor) = out.last_mut() {
                    let text_only = value["message"]["content"]
                        .as_array()
                        .is_some_and(|parts| parts.iter().all(|part| part["type"] == "text"));
                    if text_only
                        && value.get("parentId").and_then(serde_json::Value::as_str)
                            == Some(anchor.id.as_str())
                    {
                        anchor.following_assistant_text = Some(text.clone());
                        anchor.following_assistant_text_concat = Some(concat_text.clone());
                    }
                }
                let occurrence = occurrences.entry(text.clone()).or_default();
                *occurrence += 1;
                let concat_occurrence = concat_occurrences.entry(concat_text.clone()).or_default();
                *concat_occurrence += 1;
                assistants.insert(id, (text, *occurrence, concat_text, *concat_occurrence));
            }
            Some("custom_message")
                if value.get("display").and_then(serde_json::Value::as_bool) == Some(true) =>
            {
                let Some(id) = value.get("id").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                let Some(parent_id) = value.get("parentId").and_then(serde_json::Value::as_str)
                else {
                    continue;
                };
                let mut ancestor = Some(parent_id);
                let mut seen = HashSet::new();
                let mut assistant = None;
                while let Some(id) = ancestor {
                    if !active.contains(id) || !seen.insert(id) {
                        break;
                    }
                    if let Some(found) = assistants.get(id) {
                        assistant = Some(found);
                        break;
                    }
                    let Some(parent) = nodes.get(id) else { break };
                    if matches!(
                        parent
                            .pointer("/message/role")
                            .and_then(serde_json::Value::as_str),
                        Some("user" | "assistant")
                    ) {
                        break;
                    }
                    ancestor = parent["parentId"].as_str();
                }
                let Some((after_assistant_text, after_occurrence, concat_text, concat_occurrence)) =
                    assistant
                else {
                    continue;
                };
                let custom_type = value
                    .get("customType")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("custom")
                    .to_owned();
                let mut severity = None;
                let mut note_bodies = Vec::new();
                if custom_type == "advisor" {
                    for note in value
                        .pointer("/details/notes")
                        .and_then(serde_json::Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        if let Some(body) = note.get("note").and_then(serde_json::Value::as_str) {
                            note_bodies.push(body);
                        }
                        let next = note.get("severity").and_then(serde_json::Value::as_str);
                        if next == Some("blocker")
                            || (next == Some("concern") && severity.as_deref() != Some("blocker"))
                            || (next == Some("nit") && severity.is_none())
                        {
                            severity = next.map(str::to_owned);
                        }
                    }
                }
                let text = if note_bodies.is_empty() {
                    omp_message_text(&value["content"], "\n")
                } else {
                    note_bodies.join("\n\n")
                };
                // Tool results, metadata and note chains seal the same preceding
                // assistant prose. Notes resolving there stack in source order.
                out.push(OmpInterjectionAnchor {
                    id: id.to_owned(),
                    after_assistant_text: after_assistant_text.clone(),
                    after_occurrence: *after_occurrence,
                    after_assistant_text_concat: concat_text.clone(),
                    after_concat_occurrence: *concat_occurrence,
                    following_assistant_text: None,
                    following_assistant_text_concat: None,
                    text,
                    custom_type,
                    severity,
                });
            }
            _ => {}
        }
    }
    Ok(out)
}

/// Immediate children of `path` (project tree). Folders first, then files.
#[tauri::command(async)]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    list_dir_sync(&expand_home(&path))
}

pub(crate) fn list_dir_sync(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let reader = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    let mut out = Vec::new();
    for ent in reader {
        let Ok(ent) = ent else { continue };
        let name = ent.file_name();
        let Some(name) = name.to_str() else { continue };
        if name == ".DS_Store" {
            continue;
        }
        let path = ent.path();
        let is_dir = ent
            .file_type()
            .map(|t| t.is_dir() || (t.is_symlink() && path.is_dir()))
            .unwrap_or_else(|_| path.is_dir());
        out.push(DirEntry {
            ignored: false,
            name: name.to_string(),
            path: path_to_js(&path),
            is_dir,
        });
    }

    let names: Vec<&str> = out.iter().map(|e| e.name.as_str()).collect();
    let ignored = cached_ignored_names(
        &IGNORED_NAMES_CACHE,
        IGNORED_NAMES_TTL,
        dir,
        &names,
        git_ignored_names,
    )
    .unwrap_or_else(|| {
        let ignore = Ignore::load(dir);
        names
            .iter()
            .filter(|n| ignore.matches(n))
            .map(|n| n.to_string())
            .collect()
    });
    for entry in &mut out {
        entry.ignored = entry.name == ".git" || ignored.contains(&entry.name);
    }

    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| compare_natural_names(&a.name, &b.name))
    });
    Ok(out)
}

fn compare_natural_names(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let a_start = i;
            let b_start = j;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let a_digits = &a[a_start..i];
            let b_digits = &b[b_start..j];
            let a_value = a_digits
                .iter()
                .position(|digit| *digit != b'0')
                .map_or(&a_digits[a_digits.len()..], |start| &a_digits[start..]);
            let b_value = b_digits
                .iter()
                .position(|digit| *digit != b'0')
                .map_or(&b_digits[b_digits.len()..], |start| &b_digits[start..]);
            let order = a_value
                .len()
                .cmp(&b_value.len())
                .then_with(|| a_value.cmp(b_value));
            if order != Ordering::Equal {
                return order;
            }
        } else {
            let order = a[i].to_ascii_lowercase().cmp(&b[j].to_ascii_lowercase());
            if order != Ordering::Equal {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j)).then_with(|| a.cmp(b))
}

const MAX_PROJECT_FILES: usize = 20_000;
const MAX_WALK_DIRS: usize = 4_000;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) relative: String,
}

/// Wire shape of `list_project_files`: the project root once, and per file only
/// what the root cannot supply. The absolute `path` is `root` + `/` + `relative`
/// (rebuilt in `listProjectFiles`), so the root is not repeated 20,000 times.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileEntry {
    name: String,
    relative: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileListing {
    root: String,
    files: Vec<ProjectFileEntry>,
}

fn project_file_listing(cwd: &str) -> Result<ProjectFileListing, String> {
    let files = list_project_files_sync(cwd)?;
    Ok(ProjectFileListing {
        root: path_to_js(&expand_home(cwd)),
        files: files
            .into_iter()
            .map(|f| ProjectFileEntry {
                name: f.name,
                relative: f.relative,
            })
            .collect(),
    })
}

/// Workspace files for Quick Open. Prefer `git ls-files` (gitignore-aware,
/// index-backed); otherwise a bounded walk that never descends into vendor dirs.
#[tauri::command]
pub async fn list_project_files(cwd: String) -> Result<ProjectFileListing, String> {
    tauri::async_runtime::spawn_blocking(move || project_file_listing(&cwd))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn list_project_files_sync(cwd: &str) -> Result<Vec<ProjectFile>, String> {
    list_project_files_sync_cancellable(cwd, None)
}

/// Same listing, but aborts as soon as `cancel` is set.
///
/// Both halves of the enumeration can outlast a cancelled search on their own,
/// so both take the flag: `git ls-files` and the walk it falls back to. The
/// walk is the one that can run for minutes, but the listing is the one that
/// can hold a hundred megabytes, so neither is left uninterruptible.
pub(crate) fn list_project_files_sync_cancellable(
    cwd: &str,
    cancel: Option<&AtomicBool>,
) -> Result<Vec<ProjectFile>, String> {
    let root = expand_home(cwd);
    if !root.is_dir() {
        return Err(format!("{}: Not a directory", root.display()));
    }
    if !is_indexable_root(&root) {
        return Ok(Vec::new());
    }
    if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
        return Ok(Vec::new());
    }
    if let Some(files) = git_ls_files(&root, cancel) {
        return Ok(files);
    }
    // `git_ls_files` returns `None` for "not a git repo", truncation, and
    // cancel. The first two should walk; cancel must not, or a cancelled
    // `ls-files` would start enumerating the tree it just avoided.
    if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
        return Ok(Vec::new());
    }
    Ok(walk_project_files(&root, cancel.into()))
}

/// `git check-ignore` queues behind the Windows spawn gate, and the tree
/// re-lists the same folder on every poll and change event. The answer is cached
/// per folder and keyed on the exact entry names, so an added, removed or
/// renamed entry always misses. Ignore rules can change without the folder
/// changing (`.gitignore` higher up, `info/exclude`, global excludes, a file
/// becoming tracked), so the TTL bounds staleness to a late dimming label. It
/// outlasts the tree's 3 s poll, so an unchanged folder is not re-checked on
/// every poll; a rename or new entry still misses at once.
const IGNORED_NAMES_TTL: Duration = Duration::from_secs(10);
const IGNORED_NAMES_CACHE_MAX: usize = 256;

type IgnoredNamesEntry = (Instant, Vec<String>, Option<HashSet<String>>);
type IgnoredNamesCache = Mutex<Option<HashMap<PathBuf, IgnoredNamesEntry>>>;

static IGNORED_NAMES_CACHE: IgnoredNamesCache = Mutex::new(None);

fn cached_ignored_names(
    cache: &IgnoredNamesCache,
    ttl: Duration,
    dir: &Path,
    names: &[&str],
    lookup: impl FnOnce(&Path, &[&str]) -> Option<HashSet<String>>,
) -> Option<HashSet<String>> {
    let mut sorted: Vec<String> = names.iter().map(|n| n.to_string()).collect();
    sorted.sort_unstable();
    if let Ok(mut guard) = cache.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.retain(|_, (at, _, _)| at.elapsed() < ttl);
        if let Some((_, cached_names, result)) = map.get(dir) {
            if *cached_names == sorted {
                return result.clone();
            }
        }
    }
    let result = lookup(dir, names);
    if let Ok(mut guard) = cache.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        if map.len() >= IGNORED_NAMES_CACHE_MAX {
            map.clear();
        }
        map.insert(dir.to_path_buf(), (Instant::now(), sorted, result.clone()));
    }
    result
}

const CHECK_IGNORE_SOME_MATCHED: i32 = 0;
const CHECK_IGNORE_NONE_MATCHED: i32 = 1;

fn git_ignored_names(dir: &Path, names: &[&str]) -> Option<HashSet<String>> {
    if names.is_empty() {
        return Some(HashSet::new());
    }
    let _turn = GIT_SPAWN_GATE.enter();
    let mut child = git_cmd()
        .arg("-C")
        .arg(dir)
        .args(["check-ignore", "--stdin", "-z"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut input = Vec::with_capacity(names.iter().map(|n| n.len() + 1).sum());
    for name in names {
        input.extend_from_slice(name.as_bytes());
        input.push(0);
    }
    let mut stdin = child.stdin.take()?;
    // Write on a separate thread: a large listing can fill the stdout pipe
    // while git still waits for stdin, which would deadlock a serial writer.
    let deadline = Instant::now() + GIT_LOCAL_TIMEOUT;
    let (sender, written) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(stdin.write_all(&input));
    });
    let output = wait_with_timeout(child, GIT_LOCAL_TIMEOUT).ok()?;

    if !matches!(
        output.status.code(),
        Some(CHECK_IGNORE_SOME_MATCHED | CHECK_IGNORE_NONE_MATCHED)
    ) {
        return None;
    }
    written
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok()?
        .ok()?;
    Some(
        output
            .stdout
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect(),
    )
}

/// Ceiling for one `git ls-files` listing. A 2M-file monorepo emits roughly
/// 120 MB of NUL-separated paths; past this the walk takes over, which is
/// bounded by `MAX_PROJECT_FILES` and cancellable.
const MAX_LS_FILES_BYTES: usize = 8 * 1024 * 1024;

fn git_ls_files(root: &Path, cancel: Option<&AtomicBool>) -> Option<Vec<ProjectFile>> {
    // Routed through the bounded reader rather than `Command::output()`: this
    // is the path a cancelled search actually takes, because a repository with
    // a git index never reaches the walk. `output()` buffers the whole listing
    // before anything can look at it, so on a large monorepo it held ~100 MB
    // and ran to completion with no way to interrupt it — the exact cost the
    // walk's cancel check was added to avoid, one function earlier.
    let (raw, truncated) = git_output_capped(
        root,
        &["ls-files", "-co", "--exclude-standard", "-z"],
        MAX_LS_FILES_BYTES,
        cancel,
    )?;
    if truncated {
        // A partial listing would silently hide files from search. Fall back to
        // the walk, which is bounded by its own budget.
        return None;
    }

    let mut files = Vec::new();
    for rel in raw.split(|b| *b == 0) {
        if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            return Some(Vec::new());
        }
        if rel.is_empty() {
            continue;
        }
        let relative = path_to_js(Path::new(String::from_utf8_lossy(rel).as_ref()));
        if relative.ends_with('/') || path_has_skipped_dir(&relative) {
            continue;
        }
        let path = root.join(&relative);
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name == ".DS_Store" {
            continue;
        }
        files.push(ProjectFile {
            name: name.to_string(),
            path: path_to_js(&path),
            relative,
        });
        if files.len() >= MAX_PROJECT_FILES {
            break;
        }
    }
    Some(files)
}

#[derive(Debug, Clone, Default)]
pub(crate) struct GitInfo {
    pub branch: Option<String>,
    pub repo: Option<String>,
}

/// `git_info_for` costs up to three `git` subprocesses, and it sits inside
/// both `session_upsert` (which runs every time a transcript is persisted) and
/// `list_by_project` (every project switch). Caching it for a beat keeps a
/// busy session from respawning git on every keystroke-driven save; the branch
/// can lag by at most `GIT_INFO_TTL`, which only affects a label.
const GIT_INFO_TTL: Duration = Duration::from_secs(3);

static GIT_INFO_CACHE: Mutex<Option<HashMap<PathBuf, (Instant, GitInfo)>>> = Mutex::new(None);

pub(crate) fn git_info_for(root: &Path) -> GitInfo {
    if let Ok(mut guard) = GIT_INFO_CACHE.lock() {
        let cache = guard.get_or_insert_with(HashMap::new);
        cache.retain(|_, (at, _)| at.elapsed() < GIT_INFO_TTL);
        if let Some((_, info)) = cache.get(root) {
            return info.clone();
        }
    }
    let info = git_info_uncached(root);
    if let Ok(mut guard) = GIT_INFO_CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), (Instant::now(), info.clone()));
    }
    info
}

fn git_info_uncached(root: &Path) -> GitInfo {
    let Some(top) = git_stdout(root, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    else {
        return GitInfo {
            branch: None,
            repo: file_name(root),
        };
    };
    GitInfo {
        branch: git_branch(&top),
        repo: git_origin_repo(&top).or_else(|| file_name(&top)),
    }
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStats {
    pub files: i64,
    pub additions: i64,
    pub deletions: i64,
}

/// Uncommitted line counts for the opened folder: staged + unstaged vs HEAD,
/// plus untracked (gitignore-aware) files counted as additions.
#[tauri::command]
pub async fn git_diff_stats(cwd: String) -> Result<GitDiffStats, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_stats_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub relative: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffIndex {
    pub repository: bool,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub files: Vec<GitChangedFile>,
    pub additions: i64,
    pub deletions: i64,
    pub remote: Option<String>,
    pub upstream: Option<String>,
    pub default_branch: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub ahead_of_default: i64,
    pub head_pushed: bool,
    /// Unmerged files, kept out of `files` and the line counts.
    pub conflicts: Vec<GitConflictFile>,
    /// The merge, rebase, cherry-pick or revert git is stopped in the middle of.
    pub operation: Option<&'static str>,
}

/// Changed files in the opened folder, with per-file line counts and status.
#[tauri::command]
pub async fn git_diff_index(cwd: String) -> Result<GitDiffIndex, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_index_checked(&expand_home(&cwd), true))
        .await
        .map_err(|e| e.to_string())?
}

/// Changed files and counts without branch/upstream synchronization metadata.
#[tauri::command]
pub async fn git_diff_files(cwd: String) -> Result<GitDiffIndex, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_index_checked(&expand_home(&cwd), false))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub path: String,
    pub relative: String,
    pub status: String,
    pub original: String,
    pub current: String,
    pub binary: bool,
    pub too_large: bool,
}

/// Contents for one changed file. Staged diffs compare HEAD to the index;
/// unstaged diffs compare the index to the working tree.
#[tauri::command]
pub async fn git_file_diff(
    cwd: String,
    relative: String,
    staged: bool,
) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_file_diff_for(&expand_home(&cwd), &relative, staged)
    })
    .await
    .map_err(|e| e.to_string())?
}

const GIT_HISTORY_DEFAULT: u32 = 200;
const GIT_HISTORY_MAX: u32 = 5000;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryRef {
    pub name: String,
    pub kind: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryCommit {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
    pub refs: Vec<GitHistoryRef>,
    pub head: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
    pub head: Option<String>,
    pub commits: Vec<GitHistoryCommit>,
}

/// Recent commits for the Graph view: HEAD, upstream, and the default
/// branch, or every branch, remote branch, and tag when `all` is set.
/// Newest first, with parent SHAs for the graph.
#[tauri::command]
pub async fn git_history(
    cwd: String,
    limit: Option<u32>,
    all: Option<bool>,
) -> Result<GitHistory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_history_scoped(&expand_home(&cwd), limit, all.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Files changed in one commit (first parent / root).
#[tauri::command]
pub async fn git_commit_files(cwd: String, sha: String) -> Result<Vec<GitChangedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_files_for(&expand_home(&cwd), &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Parent vs commit contents for one path in a historical commit.
#[tauri::command]
pub async fn git_commit_file_diff(
    cwd: String,
    sha: String,
    relative: String,
) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_commit_file_diff_for(&expand_home(&cwd), &sha, &relative)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stage a changed file (`git add`).
#[tauri::command]
pub async fn git_stage_file(cwd: String, relative: String) -> Result<(), String> {
    spawn_git_local_mutation(cwd, move |root| git_stage_file_for(root, &relative))
        .await
        .map_err(|e| e.to_string())?
}

/// Stage an explicit selection in one index transaction.
#[tauri::command]
pub async fn git_stage_files(cwd: String, relatives: Vec<String>) -> Result<(), String> {
    spawn_git_local_mutation(cwd, move |root| git_index_files_for(root, &relatives, true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_files(cwd: String, relatives: Vec<String>) -> Result<(), String> {
    spawn_git_local_mutation(cwd, move |root| {
        git_index_files_for(root, &relatives, false)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write `contents` into the index for one path, leaving the working tree alone.
#[tauri::command]
pub async fn git_stage_contents(
    cwd: String,
    relative: String,
    contents: String,
    expected_original: Option<String>,
) -> Result<(), String> {
    spawn_git_local_mutation(cwd, move |root| {
        git_stage_contents_for(
            root,
            &relative,
            contents.as_bytes(),
            expected_original.as_deref().map(str::as_bytes),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Unstage a file (`git restore --staged`).
#[tauri::command]
pub async fn git_unstage_file(cwd: String, relative: String) -> Result<(), String> {
    spawn_git_local_mutation(cwd, move |root| git_unstage_file_for(root, &relative))
        .await
        .map_err(|e| e.to_string())?
}

/// Discard uncommitted changes so the file matches HEAD (or delete if untracked).
#[tauri::command]
pub async fn git_discard_file(cwd: String, relative: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_discard_file_for(root, &relative))
        .await
        .map_err(|e| e.to_string())?
}

/// Discard every unstaged change (restore tracked files; delete untracked).
#[tauri::command]
pub async fn git_discard_files(cwd: String, relatives: Vec<String>) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| {
        git_discard_selection_for(root, Some(&relatives))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Discard every unstaged change (restore tracked files; delete untracked).
#[tauri::command]
pub async fn git_discard_all(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_discard_all_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Stage every changed file in the repo.
#[tauri::command]
pub async fn git_stage_all(cwd: String) -> Result<(), String> {
    spawn_git_local_mutation(cwd, git_stage_all_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Unstage every staged file.
#[tauri::command]
pub async fn git_unstage_all(cwd: String) -> Result<(), String> {
    spawn_git_local_mutation(cwd, git_unstage_all_for)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStagedContext {
    pub branch: Option<String>,
    pub summary: String,
    pub patch: String,
}

/// Staged diff (or unstaged vs HEAD if nothing is staged) for commit text generation.
#[tauri::command]
pub async fn git_staged_context(cwd: String) -> Result<GitStagedContext, String> {
    tauri::async_runtime::spawn_blocking(move || git_staged_context_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Create a commit from the current index, or rewrite HEAD with it when `amend` is set.
/// `signoff` adds a `Signed-off-by` trailer.
#[tauri::command]
pub async fn git_commit(
    cwd: String,
    message: String,
    amend: bool,
    signoff: Option<bool>,
) -> Result<(), String> {
    spawn_git_local_mutation(cwd, move |root| {
        let mut extra = Vec::new();
        if amend {
            extra.push("--amend");
        }
        if signoff.unwrap_or(false) {
            extra.push("--signoff");
        }
        git_commit_args(root, &message, &extra)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Move HEAD back one commit, keeping its changes staged.
#[tauri::command]
pub async fn git_undo_last_commit(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_undo_last_commit_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Full message (subject and body) of the commit at HEAD.
#[tauri::command]
pub async fn git_head_message(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_head_message_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Push the current branch to its upstream, or set upstream on first push.
#[tauri::command]
pub async fn git_push(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_push_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Fast-forward the current branch from its upstream, or rebase onto it with `rebase`.
#[tauri::command]
pub async fn git_pull(cwd: String, rebase: Option<bool>) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_pull_for(root, rebase.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

/// Pull incoming commits, then push local commits.
#[tauri::command]
pub async fn git_sync(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_sync_changes_for)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRangeContext {
    pub base: String,
    pub head: String,
    pub commit_summary: String,
    pub diff_summary: String,
    pub diff_patch: String,
}

/// Commits and diff between the default branch and HEAD, for PR text generation.
#[tauri::command]
pub async fn git_range_context(cwd: String) -> Result<GitRangeContext, String> {
    tauri::async_runtime::spawn_blocking(move || git_range_context_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPr {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
}

/// Latest pull request for the current branch, if `gh` can see one.
#[tauri::command]
pub async fn git_pr_status(cwd: String) -> Result<Option<GitPr>, String> {
    tauri::async_runtime::spawn_blocking(move || git_pr_status_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
struct GitPrCreateInput {
    title: String,
    body: String,
    base: String,
    head: String,
}

/// Create a GitHub pull request with `gh` and return its URL.
#[tauri::command]
pub async fn git_pr_create(
    cwd: String,
    title: String,
    body: String,
    base: String,
    head: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_pr_create_for(
            &expand_home(&cwd),
            &GitPrCreateInput {
                title,
                body,
                base,
                head,
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAssignee {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItem {
    pub kind: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub state_reason: String,
    pub created_at: String,
    pub updated_at: String,
    pub labels: Vec<GitHubLabel>,
    pub assignees: Vec<GitHubAssignee>,
    pub draft: bool,
    pub repo: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatus {
    pub connected: bool,
    pub installed: bool,
    pub authenticated: bool,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitHubStarStatus {
    Starred,
    NotStarred,
    Unavailable,
}

const BYCODA_STAR_ENDPOINT: &str = "/user/starred/bahadryalcn/bycoda";

/// Whether the GitHub CLI is installed and has an active authenticated account.
#[tauri::command]
pub async fn git_github_status() -> Result<GitHubStatus, String> {
    tauri::async_runtime::spawn_blocking(git_github_status_for)
        .await
        .map_err(|error| error.to_string())
}

fn git_github_status_for() -> GitHubStatus {
    let Some(program) = crate::harness::resolve_gui_binary("gh") else {
        return GitHubStatus {
            connected: false,
            installed: false,
            authenticated: false,
        };
    };
    let mut cmd = Command::new(program);
    cmd.args(["auth", "status", "--active", "--hostname", "github.com"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat");
    crate::harness::apply_gui_env(&mut cmd);
    crate::hide_window_console(&mut cmd);
    let authenticated = cmd
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    GitHubStatus {
        connected: authenticated,
        installed: true,
        authenticated,
    }
}

/// Whether the active GitHub CLI account has starred the bycoda repository.
#[tauri::command]
pub async fn github_bycoda_star_status() -> Result<GitHubStarStatus, String> {
    tauri::async_runtime::spawn_blocking(github_bycoda_star_status_for)
        .await
        .map_err(|error| error.to_string())
}

fn github_bycoda_star_status_for() -> GitHubStarStatus {
    let result = gh_run(
        Path::new("."),
        &["api", "--silent", BYCODA_STAR_ENDPOINT],
        true,
    );
    github_star_status_from_result(result)
}

fn github_star_status_from_result(result: Result<String, String>) -> GitHubStarStatus {
    match result {
        Ok(_) => GitHubStarStatus::Starred,
        Err(error) if error.contains("HTTP 404") => GitHubStarStatus::NotStarred,
        Err(_) => GitHubStarStatus::Unavailable,
    }
}

/// Star the bycoda repository for the active GitHub CLI account.
#[tauri::command]
pub async fn github_star_bycoda() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        gh_run(
            Path::new("."),
            &["api", "--silent", "--method", "PUT", BYCODA_STAR_ENDPOINT],
            true,
        )
        .map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// `owner/repo` for the GitHub remote of this working copy, via `gh`.
#[tauri::command]
pub async fn git_github_repo(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_github_repo_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// The GitHub remote of this working copy and, when it is a fork, its parent.
#[tauri::command]
pub async fn git_github_repositories(cwd: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || git_github_repositories_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Open issues or pull requests for one GitHub repository, via `gh`.
#[tauri::command]
pub async fn git_github_work_items(
    cwd: String,
    repo: String,
    kind: String,
    assigned_to_me: bool,
    state: String,
    search: String,
    limit: Option<u32>,
) -> Result<Vec<GitHubWorkItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_items_for(
            &expand_home(&cwd),
            &repo,
            &kind,
            assigned_to_me,
            &state,
            &search,
            limit.unwrap_or(40),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One issue or pull request by number, used when session navigation misses
/// the existing Inbox cache.
#[tauri::command]
pub async fn git_github_work_item(
    cwd: String,
    repo: String,
    kind: String,
    number: i64,
) -> Result<GitHubWorkItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_for(&expand_home(&cwd), &repo, &kind, number)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemDetails {
    pub head_ref_oid: String,
    pub body: String,
    pub author: String,
    pub author_avatar_url: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub review_decision: String,
}

/// Issue or pull request body for the inbox detail pane.
#[tauri::command]
pub async fn git_github_work_item_details(
    cwd: String,
    repo: String,
    kind: String,
    number: i64,
) -> Result<GitHubWorkItemDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_details_for(&expand_home(&cwd), &repo, &kind, number)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemComment {
    pub id: String,
    pub kind: String,
    pub author: String,
    pub author_avatar_url: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
    pub state: String,
    pub path: String,
    pub line: Option<i64>,
    pub resolved: bool,
    pub thread_id: String,
    pub replies: Vec<GitHubWorkItemComment>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemCommit {
    pub oid: String,
    pub message_headline: String,
    pub author: String,
    pub committed_date: String,
    pub url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemThread {
    pub comments: Vec<GitHubWorkItemComment>,
    pub commits: Vec<GitHubWorkItemCommit>,
    pub truncated: bool,
    pub review_decision: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
}

/// Conversation for the inbox detail pane: comments, reviews, and review threads.
#[tauri::command]
pub async fn git_github_work_item_thread(
    cwd: String,
    repo: String,
    kind: String,
    number: i64,
) -> Result<GitHubWorkItemThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_thread_for(&expand_home(&cwd), &repo, &kind, number)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Post a conversation comment, or a reply on a review thread.
#[tauri::command]
pub async fn git_github_work_item_comment(
    cwd: String,
    repo: String,
    kind: String,
    number: i64,
    body: String,
    in_reply_to: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_comment_for(
            &expand_home(&cwd),
            &repo,
            &kind,
            number,
            &body,
            &in_reply_to,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Merge or change the lifecycle state of a GitHub pull request via `gh`.
#[tauri::command]
pub async fn git_github_pr_action(
    cwd: String,
    repo: String,
    number: i64,
    action: String,
    expected_head_oid: Option<String>,
) -> Result<GitHubWorkItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_pr_action_for(
            &expand_home(&cwd),
            &repo,
            number,
            &action,
            expected_head_oid.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrFile {
    pub path: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrDiff {
    pub head_oid: String,
    pub additions: i64,
    pub deletions: i64,
    pub files: Vec<GitHubPrFile>,
    pub patch: String,
    pub truncated: bool,
}

const MAX_PR_DIFF_BYTES: usize = 2 * 1024 * 1024;

/// Unified diff and file stats for a pull request, via `gh`.
/// When `full_context` is true, prefer a large-context `git diff` between the PR OIDs.
#[tauri::command]
pub async fn git_github_pr_diff(
    cwd: String,
    repo: String,
    number: i64,
    full_context: Option<bool>,
) -> Result<GitHubPrDiff, String> {
    let full_context = full_context.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        git_github_pr_diff_for(&expand_home(&cwd), &repo, number, full_context)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrCheck {
    pub name: String,
    pub workflow: String,
    pub state: String,
    pub url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrChecks {
    pub head_oid: String,
    pub checks: Vec<GitHubPrCheck>,
}

/// CI checks for one pull request, targeted explicitly by `repo` and `number` via `gh`.
#[tauri::command]
pub async fn git_github_pr_checks(
    cwd: String,
    repo: String,
    number: i64,
) -> Result<GitHubPrChecks, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_pr_checks_for(&expand_home(&cwd), &repo, number)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCheckDetails {
    steps: Vec<GitHubCheckStep>,
    annotations: Vec<GitHubCheckAnnotation>,
    notice: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct GitHubCheckStep {
    name: String,
    state: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct GitHubCheckAnnotation {
    #[serde(default)]
    path: String,
    #[serde(default, rename(deserialize = "start_line"))]
    line: u64,
    #[serde(default)]
    message: String,
    #[serde(default, rename(deserialize = "annotation_level"))]
    level: String,
}

#[tauri::command]
pub async fn git_github_check_details(
    cwd: String,
    repo: String,
    job_id: String,
) -> Result<GitHubCheckDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        github_check_details_with(&repo, &job_id, |endpoint| {
            gh_checked(
                &expand_home(&cwd),
                &["api", "--hostname", "github.com", endpoint],
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn github_check_details_with(
    repo: &str,
    job_id: &str,
    mut fetch: impl FnMut(&str) -> Result<String, String>,
) -> Result<GitHubCheckDetails, String> {
    let (owner, name) = split_github_repo(repo)?;
    // Only repository slugs and numeric IDs can enter API paths.
    if [&owner, &name].iter().any(|part| {
        matches!(part.as_str(), "." | "..")
            || !part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    }) || job_id.parse::<u64>().ok().filter(|id| *id > 0).is_none()
        || !job_id.bytes().all(|c| c.is_ascii_digit())
    {
        return Err("Invalid GitHub repository or job ID".into());
    }
    #[derive(Deserialize)]
    struct Step {
        name: String,
        status: String,
        conclusion: Option<String>,
        started_at: Option<String>,
        completed_at: Option<String>,
    }
    #[derive(Deserialize)]
    struct Job {
        id: u64,
        #[serde(default)]
        steps: Vec<Step>,
        check_run_url: Option<String>,
    }
    let prefix = format!("repos/{owner}/{name}");
    let json = fetch(&format!("{prefix}/actions/jobs/{job_id}"))?;
    let job: Job = serde_json::from_str(&json).map_err(|error| error.to_string())?;
    if job.id.to_string() != job_id {
        return Err("GitHub returned a different job".into());
    }
    let mut details = GitHubCheckDetails {
        steps: job
            .steps
            .into_iter()
            .map(|step| GitHubCheckStep {
                name: step.name,
                state: github_check_state(
                    &step.status,
                    step.conclusion.as_deref().unwrap_or_default(),
                ),
                started_at: step.started_at,
                completed_at: step.completed_at,
            })
            .collect(),
        annotations: vec![],
        notice: None,
    };
    let check_prefix = format!("https://api.github.com/{prefix}/check-runs/");
    let check_id = job
        .check_run_url
        .as_deref()
        .and_then(|value| value.strip_prefix(&check_prefix))
        .filter(|value| !value.is_empty() && value.bytes().all(|c| c.is_ascii_digit()));
    if let Some(check_id) = check_id {
        let annotations = fetch(&format!(
            "{prefix}/check-runs/{check_id}/annotations?per_page=100"
        ))
        .and_then(|json| {
            serde_json::from_str::<Vec<GitHubCheckAnnotation>>(&json)
                .map_err(|error| error.to_string())
        });
        match annotations {
            Ok(annotations) => {
                if annotations.len() == 100 {
                    details.notice = Some(
                        "Showing the first 100 annotations. View the full log on GitHub for more."
                            .into(),
                    );
                }
                details.annotations = annotations;
            }
            Err(_) => {
                details.notice =
                    Some("Could not load error annotations. View the full log on GitHub.".into())
            }
        }
    } else {
        details.notice =
            Some("Error annotations are unavailable. View the full log on GitHub.".into());
    }
    Ok(details)
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranches {
    pub current: Option<String>,
    pub detached: bool,
    pub branches: Vec<GitBranchEntry>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
    pub name: String,
    pub current: bool,
    pub remote: Option<String>,
}

/// Local branches, plus remote-only branches that can be checked out.
#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<GitBranches, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(git_branches_for(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

/// Switch to an existing local branch, or create a local tracking branch from a remote.
#[tauri::command]
pub async fn git_checkout(
    cwd: String,
    name: String,
    remote: Option<String>,
) -> Result<String, String> {
    spawn_git_mutation(cwd, move |root| {
        git_checkout_for(root, &name, remote.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a branch from HEAD and switch to it.
#[tauri::command]
pub async fn git_create_branch(cwd: String, name: String) -> Result<String, String> {
    spawn_git_mutation(cwd, move |root| git_create_branch_for(root, &name))
        .await
        .map_err(|e| e.to_string())?
}

/// Stash local changes. `mode` is `tracked`, `untracked` (the default, so a
/// checkout can proceed), or `staged`.
#[tauri::command]
pub async fn git_stash(
    cwd: String,
    message: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| {
        let mode = match mode.as_deref() {
            None | Some("untracked") => GitStashMode::IncludeUntracked,
            Some("tracked") => GitStashMode::Tracked,
            Some("staged") => GitStashMode::Staged,
            Some(_) => return Err("Invalid stash mode".to_string()),
        };
        git_stash_for(root, message.as_deref(), mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete every stash entry. This cannot be undone.
#[tauri::command]
pub async fn git_stash_clear(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_stash_clear_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Check out a commit without moving any branch (detached HEAD).
#[tauri::command]
pub async fn git_checkout_commit(cwd: String, sha: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_checkout_commit_for(root, &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Create a branch at a commit and switch to it.
#[tauri::command]
pub async fn git_create_branch_at(
    cwd: String,
    name: String,
    sha: String,
) -> Result<String, String> {
    spawn_git_mutation(cwd, move |root| git_create_branch_at_for(root, &name, &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Create a lightweight tag at a commit.
#[tauri::command]
pub async fn git_create_tag(cwd: String, name: String, sha: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_create_tag_for(root, &name, &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Apply a commit on top of HEAD.
#[tauri::command]
pub async fn git_cherry_pick(cwd: String, sha: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_cherry_pick_for(root, &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Commit the inverse of a commit on top of HEAD.
#[tauri::command]
pub async fn git_revert(cwd: String, sha: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_revert_for(root, &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Move the current branch to a commit. `mode` is `soft`, `mixed`, or `hard`.
#[tauri::command]
pub async fn git_reset(cwd: String, sha: String, mode: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_reset_for(root, &sha, &mode))
        .await
        .map_err(|e| e.to_string())?
}

/// The operation git stopped in the middle of: `merge`, `rebase`,
/// `cherry-pick`, or `revert`. `None` when the repository is idle.
#[tauri::command]
pub async fn git_operation_state(cwd: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(git_operation_state_for(&expand_home(&cwd)).map(str::to_string))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abandon the operation reported by `git_operation_state`.
#[tauri::command]
pub async fn git_operation_abort(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_operation_abort_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Finish the operation reported by `git_operation_state` once conflicts are staged.
#[tauri::command]
pub async fn git_operation_continue(cwd: String) -> Result<(), String> {
    spawn_git_mutation(cwd, git_operation_continue_for)
        .await
        .map_err(|e| e.to_string())?
}

/// Delete a local branch. Without `force`, git refuses an unmerged branch.
#[tauri::command]
pub async fn git_delete_branch(cwd: String, name: String, force: bool) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_delete_branch_for(root, &name, force))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_rename_branch(cwd: String, from: String, to: String) -> Result<String, String> {
    spawn_git_mutation(cwd, move |root| git_rename_branch_for(root, &from, &to))
        .await
        .map_err(|e| e.to_string())?
}

/// Merge a local or remote branch into the current one.
#[tauri::command]
pub async fn git_merge(cwd: String, reference: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_merge_for(root, &reference))
        .await
        .map_err(|e| e.to_string())?
}

/// Rebase the current branch onto a local or remote branch.
#[tauri::command]
pub async fn git_rebase(cwd: String, reference: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_rebase_for(root, &reference))
        .await
        .map_err(|e| e.to_string())?
}

/// Trust only this checkout after an explicit owner confirmation.
#[tauri::command]
pub async fn git_trust_repository(cwd: String, confirmed: bool) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_trust_repository_for(root, confirmed))
        .await
        .map_err(|e| e.to_string())?
}

fn git_trust_repository_for(root: &Path, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Repository trust requires owner confirmation".into());
    }
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let path = canonical.to_string_lossy().replace('\\', "/");
    let path = path
        .strip_prefix("//?/UNC/")
        .map(|p| format!("//{p}"))
        .unwrap_or_else(|| path.strip_prefix("//?/").unwrap_or(&path).to_string());
    if path.contains('*') {
        return Err("Wildcard repository trust is not allowed".into());
    }
    match git_checked(root, &["rev-parse", "--show-toplevel"]) {
        Ok(_) => return Ok(()),
        Err(error) if error.contains("dubious ownership") => {}
        Err(error) => return Err(error),
    }
    let safe = format!("safe.directory={path}");
    git_checked(root, &["-c", &safe, "rev-parse", "--show-toplevel"])?;
    let top = git_run(root, &["-c", &safe, "rev-parse", "--show-toplevel"])
        .ok_or_else(|| "Could not resolve repository root".to_string())?;
    if Path::new(top.trim())
        .canonicalize()
        .map_err(|e| e.to_string())?
        != canonical
    {
        return Err("Trust must target the repository root".into());
    }
    git_checked(
        root,
        &["config", "--global", "--add", "safe.directory", &path],
    )?;
    Ok(())
}

/// Fetch every remote, and with `prune` drop tracking branches deleted there.
#[tauri::command]
pub async fn git_fetch(cwd: String, prune: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = expand_home(&cwd);
        with_git_mutation_scope(&root, GitMutationScope::Fetch, || {
            git_fetch_for(&root, prune.unwrap_or(false))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a branch at a local or remote branch and switch to it.
#[tauri::command]
pub async fn git_create_branch_from(
    cwd: String,
    name: String,
    reference: String,
) -> Result<String, String> {
    spawn_git_mutation(cwd, move |root| {
        git_create_branch_from_for(root, &name, &reference)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete a branch on a remote (`git push <remote> --delete <name>`).
#[tauri::command]
pub async fn git_delete_remote_branch(
    cwd: String,
    remote: String,
    name: String,
) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| {
        git_delete_remote_branch_for(root, &remote, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

#[tauri::command]
pub async fn git_remotes(cwd: String) -> Result<Vec<GitRemote>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(git_remotes_for(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remote_add(cwd: String, name: String, url: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_remote_add_for(root, &name, &url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remote_remove(cwd: String, name: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_remote_remove_for(root, &name))
        .await
        .map_err(|e| e.to_string())?
}

/// Tag names, newest first.
#[tauri::command]
pub async fn git_tags(cwd: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(git_tags_for(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

/// Delete a local tag. Tags already pushed stay on the remote.
#[tauri::command]
pub async fn git_delete_tag(cwd: String, name: String) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| git_delete_tag_for(root, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub index: u32,
    pub sha: String,
    pub message: String,
    pub timestamp: i64,
}

#[tauri::command]
pub async fn git_stash_list(cwd: String) -> Result<Vec<GitStashEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || git_stash_list_checked(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Run `apply`, `pop`, or `drop` on one stash entry.
#[tauri::command]
pub async fn git_stash_action(
    cwd: String,
    action: String,
    index: u32,
    expected_sha: String,
) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| {
        git_stash_action_for(root, &action, index, &expected_sha)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Paths with unresolved merge conflicts, relative to the repository root.
#[tauri::command]
pub async fn git_conflicts(cwd: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(git_conflicts_for(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

/// Resolve a conflicted file by taking one whole side (`ours` or `theirs`) and staging it.
#[tauri::command]
pub async fn git_resolve_conflict(
    cwd: String,
    relative: String,
    side: String,
) -> Result<(), String> {
    spawn_git_mutation(cwd, move |root| {
        git_resolve_conflict_for(root, &relative, &side)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Commits that touched one file, newest first, following renames.
#[tauri::command]
pub async fn git_file_history(
    cwd: String,
    relative: String,
    limit: Option<u32>,
) -> Result<Vec<GitHistoryCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_file_history_for(&expand_home(&cwd), &relative, limit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub line: u32,
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub timestamp: i64,
    pub summary: String,
}

/// The commit that last changed each line, at a revision or in the working tree.
#[tauri::command]
pub async fn git_blame(
    cwd: String,
    relative: String,
    sha: Option<String>,
) -> Result<Vec<GitBlameLine>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_blame_at_for(&expand_home(&cwd), &relative, sha.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_message(cwd: String, sha: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_message_for(&expand_home(&cwd), &sha))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn git_diff_stats_for(root: &Path) -> GitDiffStats {
    let Some(changes) = git_changes_for(root) else {
        return GitDiffStats::default();
    };
    // Conflicted files count as files, but not their combined-diff lines.
    GitDiffStats {
        files: (changes.files.len() + changes.conflicts.len()) as i64,
        additions: changes.additions,
        deletions: changes.deletions,
    }
}

#[derive(Clone, Default)]
struct FileAcc {
    additions: i64,
    deletions: i64,
}

#[cfg(test)]
pub(crate) fn git_diff_index_for(root: &Path) -> GitDiffIndex {
    git_diff_index_checked(root, true).unwrap_or_default()
}

/// File list + counts only. Skips ahead/behind/remote lookups used by Git chrome.
pub(crate) fn git_diff_files_for(root: &Path) -> GitDiffIndex {
    git_diff_index_checked(root, false).unwrap_or_default()
}

fn git_diff_index_checked(root: &Path, include_sync: bool) -> Result<GitDiffIndex, String> {
    let Some(changes) = git_changes_for(root) else {
        return match git_checked(root, &["rev-parse", "--is-inside-work-tree"]) {
            Err(error) if error.to_lowercase().contains("not a git repository") => {
                Ok(GitDiffIndex::default())
            }
            Err(error) => Err(error),
            Ok(()) => {
                Err("Could not read Git status. Retry after checking repository access.".into())
            }
        };
    };
    let sync = if include_sync {
        git_sync_for(root, &changes.status)
    } else {
        GitSync::default()
    };
    let status = changes.status;
    Ok(GitDiffIndex {
        repository: true,
        // A detached HEAD is named by its short sha.
        branch: status.head.or_else(|| {
            status
                .oid
                .as_deref()
                .map(|oid| oid.chars().take(7).collect())
        }),
        head: status.oid,
        files: changes.files,
        additions: changes.additions,
        deletions: changes.deletions,
        remote: sync.remote,
        upstream: sync.upstream,
        default_branch: sync.default_branch,
        ahead: sync.ahead,
        behind: sync.behind,
        ahead_of_default: sync.ahead_of_default,
        head_pushed: sync.head_pushed,
        conflicts: changes.conflicts,
        operation: git_operation_state_for(root),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatusKind {
    /// Tracked, with `x` the index and `y` the working tree column.
    Changed,
    Unmerged,
    Untracked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StatusEntry {
    kind: StatusKind,
    x: char,
    y: char,
    /// Relative to the repository root, as git prints it.
    path: String,
}

/// `git status --porcelain=v2 --branch -z`: what the Changes panel needs to
/// know about HEAD, its upstream and every changed path, from one process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct StatusSnapshot {
    /// HEAD's commit; `None` before the first commit.
    oid: Option<String>,
    /// The checked-out branch; `None` when HEAD is detached.
    head: Option<String>,
    upstream: Option<String>,
    /// `(ahead, behind)` of the upstream; absent when its ref is gone.
    ahead_behind: Option<(i64, i64)>,
    entries: Vec<StatusEntry>,
}

fn parse_status_v2(text: &str) -> StatusSnapshot {
    let mut snapshot = StatusSnapshot::default();
    let mut records = text.split('\0');
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => snapshot.oid = Some(value.to_string()),
                "branch.head" if value != "(detached)" => snapshot.head = Some(value.to_string()),
                "branch.upstream" => snapshot.upstream = Some(value.to_string()),
                "branch.ab" => {
                    let mut parts = value.split(' ');
                    let count = |part: Option<&str>, sign: char| {
                        part.and_then(|part| part.strip_prefix(sign))
                            .and_then(|part| part.parse::<i64>().ok())
                    };
                    if let (Some(ahead), Some(behind)) =
                        (count(parts.next(), '+'), count(parts.next(), '-'))
                    {
                        snapshot.ahead_behind = Some((ahead, behind));
                    }
                }
                _ => {}
            }
            continue;
        }
        let Some((tag, rest)) = record.split_once(' ') else {
            continue;
        };
        // Fields before the path: `XY sub mH mI mW hH hI` and so on.
        let (kind, fields) = match tag {
            "1" => (StatusKind::Changed, 7),
            "2" => (StatusKind::Changed, 8),
            "u" => (StatusKind::Unmerged, 9),
            "?" => (StatusKind::Untracked, 0),
            _ => continue,
        };
        if tag == "2" {
            // A rename carries its old path as a record of its own.
            records.next();
        }
        let mut parts = rest.splitn(fields + 1, ' ');
        let mut xy = if fields == 0 {
            "??"
        } else {
            parts.next().unwrap_or("")
        }
        .chars();
        let (Some(x), Some(y)) = (xy.next(), xy.next()) else {
            continue;
        };
        let Some(path) = parts
            .nth(fields.saturating_sub(1))
            .filter(|path| !path.is_empty())
        else {
            continue;
        };
        snapshot.entries.push(StatusEntry {
            kind,
            x,
            y,
            path: path.to_string(),
        });
    }
    snapshot
}

/// The conflict kind for an unmerged entry's `XY` (see `conflict_kind`).
fn unmerged_kind(x: char, y: char) -> &'static str {
    match (x, y) {
        ('A', 'A') => "both-added",
        ('D', 'U') => "deleted-by-us",
        ('U', 'D') => "deleted-by-them",
        ('A', 'U') => "added-by-us",
        ('U', 'A') => "added-by-them",
        ('D', 'D') => "both-deleted",
        _ => "both-modified",
    }
}

/// `root` relative to its repository's top level (`""` at the top, else
/// `dir/`). It only changes when a repository is created or removed above
/// `root`, so it is asked for once; `None` (not cached) outside a repository.
fn git_prefix_for(root: &Path) -> Option<String> {
    if let Ok(guard) = GIT_PREFIX_CACHE.lock() {
        if let Some(prefix) = guard.as_ref().and_then(|cache| cache.get(root)) {
            return Some(prefix.clone());
        }
    }
    let output = git_output(root, &["rev-parse", "--show-prefix"])?;
    let prefix = String::from_utf8_lossy(&output)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    if let Ok(mut guard) = GIT_PREFIX_CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), prefix.clone());
    }
    Some(prefix)
}

fn forget_git_prefix(root: &Path) {
    if let Ok(mut guard) = GIT_PREFIX_CACHE.lock() {
        if let Some(cache) = guard.as_mut() {
            cache.remove(root);
        }
    }
}

static GIT_PREFIX_CACHE: Mutex<Option<HashMap<PathBuf, String>>> = Mutex::new(None);

struct GitChanges {
    status: StatusSnapshot,
    /// Sorted by path. Unmerged files are in `conflicts` instead.
    files: Vec<GitChangedFile>,
    additions: i64,
    deletions: i64,
    conflicts: Vec<GitConflictFile>,
}

/// Every changed path under `root` with its line counts: `git status` for the
/// paths and `git diff --numstat` for the counts. `None` outside a repository.
fn git_changes_for(root: &Path) -> Option<GitChanges> {
    git_changes_with(root, true)
}

/// What the line counts of a `git status` listing depend on: the listing, the
/// index, and the size and time of each listed file on disk.
#[derive(PartialEq, Eq)]
struct NumstatStamp {
    status: String,
    index: Option<SystemTime>,
    files: Vec<Option<(u64, Option<SystemTime>)>>,
}

fn numstat_stamp(root: &Path, prefix: &str, text: &str, status: &StatusSnapshot) -> NumstatStamp {
    let modified = |path: PathBuf| std::fs::metadata(path).ok();
    NumstatStamp {
        status: text.to_string(),
        index: find_git_dir(root)
            .and_then(|dir| modified(dir.join("index")))
            .and_then(|meta| meta.modified().ok()),
        files: status
            .entries
            .iter()
            .map(|entry| {
                let relative = entry.path.strip_prefix(prefix).unwrap_or(&entry.path);
                modified(root.join(relative)).map(|meta| (meta.len(), meta.modified().ok()))
            })
            .collect(),
    }
}

type NumstatCached = (NumstatStamp, HashMap<String, FileAcc>);

static GIT_NUMSTAT_CACHE: Mutex<Option<HashMap<PathBuf, NumstatCached>>> = Mutex::new(None);

/// Line counts for the listing `stamp` describes. The poll asks every couple
/// of seconds and almost always finds the same listing and the same files, so
/// the counts are kept and `git diff` only runs when something moved.
fn git_numstat_cached(root: &Path, stamp: NumstatStamp) -> HashMap<String, FileAcc> {
    if let Ok(guard) = GIT_NUMSTAT_CACHE.lock() {
        if let Some((cached, counts)) = guard.as_ref().and_then(|cache| cache.get(root)) {
            if *cached == stamp {
                return counts.clone();
            }
        }
    }
    let counts = git_numstat_for(root);
    if let Ok(mut guard) = GIT_NUMSTAT_CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), (stamp, counts.clone()));
    }
    counts
}

fn git_changes_with(root: &Path, retry: bool) -> Option<GitChanges> {
    let prefix = git_prefix_for(root)?;
    let text = git_run(
        root,
        &[
            // A rename stays a deletion and an addition, as in the diff views.
            "-c",
            "status.renames=false",
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )?;
    let status = parse_status_v2(&text);
    let counts = if status.entries.is_empty() {
        HashMap::new()
    } else {
        git_numstat_cached(root, numstat_stamp(root, &prefix, &text, &status))
    };

    struct Acc {
        x: char,
        y: char,
        untracked: bool,
    }
    let mut tracked: std::collections::BTreeMap<String, Acc> = std::collections::BTreeMap::new();
    let mut conflicts = Vec::new();
    for entry in &status.entries {
        let Some(relative) = entry.path.strip_prefix(prefix.as_str()) else {
            // The repository layout changed under a cached prefix.
            forget_git_prefix(root);
            return if retry {
                git_changes_with(root, false)
            } else {
                None
            };
        };
        let relative = path_to_js(Path::new(relative));
        if relative.is_empty() {
            continue;
        }
        match entry.kind {
            // Their combined diffs would otherwise show up as ordinary modified
            // rows, staged and unstaged at once, with the markers counted as additions.
            StatusKind::Unmerged => conflicts.push(GitConflictFile {
                path: path_to_js(&root.join(&relative)),
                relative,
                kind: unmerged_kind(entry.x, entry.y),
            }),
            StatusKind::Changed => {
                let acc = tracked.entry(relative).or_insert(Acc {
                    x: '.',
                    y: '.',
                    untracked: false,
                });
                acc.x = entry.x;
                acc.y = entry.y;
            }
            // A path removed from the index but still on disk is listed twice.
            StatusKind::Untracked => {
                tracked
                    .entry(relative)
                    .or_insert(Acc {
                        x: '.',
                        y: '.',
                        untracked: false,
                    })
                    .untracked = true;
            }
        }
    }
    conflicts.sort_by(|a, b| a.relative.cmp(&b.relative));

    let mut files = Vec::with_capacity(tracked.len());
    let mut additions = 0i64;
    let mut deletions = 0i64;
    let previous_lines = take_untracked_lines(root);
    let mut seen_lines = UntrackedLines::new();
    for (relative, acc) in tracked {
        let abs = root.join(&relative);
        let mut count = counts.get(&relative).cloned().unwrap_or_default();
        if acc.untracked && count.additions == 0 {
            count.additions =
                untracked_line_count(&previous_lines, &mut seen_lines, &abs, text_line_count);
        }
        additions += count.additions;
        deletions += count.deletions;
        let status = if acc.untracked {
            "untracked"
        } else if acc.y == 'D' || acc.x == 'D' {
            "deleted"
        } else if acc.x == 'A' || acc.y == 'A' {
            "added"
        } else {
            "modified"
        };
        files.push(GitChangedFile {
            path: path_to_js(&abs),
            relative,
            status: status.to_string(),
            additions: count.additions,
            deletions: count.deletions,
            staged: acc.x != '.',
            unstaged: acc.untracked || acc.y != '.',
        });
    }
    store_untracked_lines(root, seen_lines);
    Some(GitChanges {
        status,
        files,
        additions,
        deletions,
        conflicts,
    })
}

/// Added and removed lines per path under `root`, working tree against HEAD.
///
/// Plumbing only: porcelain `git diff` refreshes the index and writes it back
/// (whatever `GIT_OPTIONAL_LOCKS` says), which rewrote `.git/index` on every
/// poll and woke every index watcher. A file whose stat data alone is stale
/// is listed with `0 0`, which adds nothing.
fn git_numstat_for(root: &Path) -> HashMap<String, FileAcc> {
    const OPTIONS: [&str; 4] = ["--relative", "--no-renames", "--numstat", "-z"];
    let run = |command: &str, extra: &[&str]| {
        let mut args = vec![command];
        args.extend_from_slice(&OPTIONS);
        args.extend_from_slice(extra);
        args.extend(["--", "."]);
        git_run(root, &args)
    };
    let mut files = HashMap::new();
    if let Some(text) = run("diff-index", &["HEAD"]) {
        add_numstat_z(&text, &mut files);
    } else {
        // No commit yet: everything is in the index or the working tree.
        // `diff --cached` compares only the index and never refreshes it.
        for (command, extra) in [("diff-files", &[][..]), ("diff", &["--cached"][..])] {
            if let Some(text) = run(command, extra) {
                add_numstat_z(&text, &mut files);
            }
        }
    }
    files
}

/// `--numstat -z`: `<added>\t<removed>\t<path>` per NUL record, paths unquoted.
fn add_numstat_z(text: &str, files: &mut HashMap<String, FileAcc>) {
    for record in text.split('\0') {
        let mut parts = record.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        let entry = files.entry(path_to_js(Path::new(path))).or_default();
        if add != "-" && del != "-" {
            entry.additions += add.parse::<i64>().unwrap_or(0);
            entry.deletions += del.parse::<i64>().unwrap_or(0);
        }
    }
}

fn add_numstat_map(text: &str, files: &mut HashMap<String, FileAcc>) {
    let mut records = text.split('\0');
    while let Some(record) = records.next() {
        let mut parts = record.splitn(3, '\t');
        let Some(add) = parts.next() else { continue };
        let Some(del) = parts.next() else { continue };
        let Some(path) = parts.next() else { continue };
        let path = if path.is_empty() {
            let _old = records.next();
            let Some(destination) = records.next() else {
                continue;
            };
            destination
        } else {
            path
        };
        let relative = path_to_js(Path::new(path));
        if relative.is_empty() {
            continue;
        }
        let entry = files.entry(relative).or_default();
        if add != "-" && del != "-" {
            entry.additions += add.parse::<i64>().unwrap_or(0);
            entry.deletions += del.parse::<i64>().unwrap_or(0);
        }
    }
}

fn add_name_status(text: &str, statuses: &mut HashMap<String, &'static str>) {
    let mut records = text.split('\0');
    while let Some(code) = records.next() {
        let Some(path) = records.next() else { break };
        let status = match code.as_bytes().first() {
            Some(b'A') => "added",
            Some(b'D') => "deleted",
            Some(b'M' | b'T') => "modified",
            _ => continue,
        };
        let relative = path_to_js(Path::new(path));
        if !relative.is_empty() {
            statuses.insert(relative, status);
        }
    }
}

const MAX_UNTRACKED_BYTES: u64 = 1024 * 1024;

/// Line count of an untracked file with the size and time it was counted at.
type UntrackedLines = HashMap<PathBuf, (u64, Option<SystemTime>, i64)>;

static GIT_UNTRACKED_LINES_CACHE: Mutex<Option<HashMap<PathBuf, UntrackedLines>>> =
    Mutex::new(None);

fn take_untracked_lines(root: &Path) -> UntrackedLines {
    GIT_UNTRACKED_LINES_CACHE
        .lock()
        .ok()
        .and_then(|mut guard| guard.as_mut().and_then(|cache| cache.remove(root)))
        .unwrap_or_default()
}

/// Keeps only the files this call saw, so the cache follows the untracked set.
fn store_untracked_lines(root: &Path, seen: UntrackedLines) {
    if seen.is_empty() {
        return;
    }
    if let Ok(mut guard) = GIT_UNTRACKED_LINES_CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), seen);
    }
}

/// `count(abs)`, unless the file still has the size and time it was last
/// counted at; the poll would otherwise re-read every untracked file each tick.
fn untracked_line_count(
    previous: &UntrackedLines,
    seen: &mut UntrackedLines,
    abs: &Path,
    count: impl Fn(&Path) -> i64,
) -> i64 {
    let Ok(meta) = std::fs::metadata(abs) else {
        return 0;
    };
    let stamp = (meta.len(), meta.modified().ok());
    let lines = match previous.get(abs) {
        Some((len, modified, lines)) if (*len, *modified) == stamp => *lines,
        _ => count(abs),
    };
    seen.insert(abs.to_path_buf(), (stamp.0, stamp.1, lines));
    lines
}

fn text_line_count(path: &Path) -> i64 {
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_UNTRACKED_BYTES {
        return 0;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return 0;
    };
    if bytes.contains(&0) {
        return 0;
    }
    let mut lines = 1i64;
    for byte in &bytes {
        if *byte == b'\n' {
            lines += 1;
        }
    }
    if bytes.last() == Some(&b'\n') {
        lines -= 1;
    }
    lines
}

fn git_file_diff_for(root: &Path, relative: &str, staged: bool) -> Result<GitFileDiff, String> {
    let relative = resolve_repo_path(root, relative)?;
    let abs = root.join(&relative);
    if !abs.starts_with(root) {
        return Err("Invalid path".into());
    }
    let prefix = git_prefix_for(root).ok_or_else(|| "Not a git repository".to_string())?;
    let index_spec = format!(":{prefix}{relative}");
    let (original, current) = if staged {
        let head_spec = format!("HEAD:{prefix}{relative}");
        (git_blob(root, &head_spec), git_blob(root, &index_spec))
    } else {
        let current = if abs.is_file() {
            Some(std::fs::read(&abs).unwrap_or_default())
        } else {
            None
        };
        (git_blob(root, &index_spec), current)
    };
    let had_original = original.is_some();
    let had_current = current.is_some();
    let orig = original.unwrap_or_default();
    let current = current.unwrap_or_default();
    let binary = orig.contains(&0) || current.contains(&0);
    let too_large =
        orig.len() as u64 > MAX_TEXT_FILE_BYTES || current.len() as u64 > MAX_TEXT_FILE_BYTES;
    let status = if !had_original && had_current {
        if staged {
            "added"
        } else {
            "untracked"
        }
    } else if had_original && !had_current {
        "deleted"
    } else {
        "modified"
    };
    let (original_text, current_text) = if binary || too_large {
        (String::new(), String::new())
    } else {
        (
            String::from_utf8_lossy(&orig).into_owned(),
            String::from_utf8_lossy(&current).into_owned(),
        )
    };
    Ok(GitFileDiff {
        path: path_to_js(&abs),
        relative,
        status: status.to_string(),
        original: original_text,
        current: current_text,
        binary,
        too_large,
    })
}

/// Tips for the Graph filter: current HEAD, its upstream, and
/// the repo default branch. Omits `refs/stash` and unmerged local branches.
fn git_history_tips(root: &Path) -> Vec<String> {
    let mut tips = vec!["HEAD".to_string()];
    if git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some() {
        tips.push("@{upstream}".to_string());
    }
    if let Some(remote) = git_remote_name(root) {
        if let Some(branch) = git_default_branch(root, Some(remote.as_str())) {
            let spec = format!("{remote}/{branch}");
            if git_ref_exists(root, &format!("refs/remotes/{spec}")) {
                tips.push(spec);
            }
        }
    }
    tips
}

#[cfg(test)]
fn git_history_for(root: &Path, limit: Option<u32>) -> Result<GitHistory, String> {
    git_history_scoped(root, limit, false)
}

fn git_history_scoped(root: &Path, limit: Option<u32>, all: bool) -> Result<GitHistory, String> {
    if !git_is_work_tree(root) {
        return match git_checked(root, &["rev-parse", "--is-inside-work-tree"]) {
            Err(error) if error.to_lowercase().contains("not a git repository") => {
                Ok(GitHistory::default())
            }
            Err(error) => Err(error),
            Ok(()) => Ok(GitHistory::default()),
        };
    }
    let n = limit
        .unwrap_or(GIT_HISTORY_DEFAULT)
        .clamp(1, GIT_HISTORY_MAX);
    let count = n.to_string();
    let head = git_stdout(root, &["rev-parse", "HEAD"]);
    let remotes = git_remote_names(root);
    let tips = if all {
        // Not `--all`: that would pull in `refs/stash` and its index commits.
        vec![
            "HEAD".to_string(),
            "--branches".to_string(),
            "--remotes".to_string(),
            "--tags".to_string(),
        ]
    } else {
        git_history_tips(root)
    };
    let mut args = vec![
        "log".to_string(),
        "--topo-order".to_string(),
        "--decorate=short".to_string(),
        "--max-count".to_string(),
        count,
        "--format=%H%x00%h%x00%P%x00%an%x00%at%x00%D%x00%s%x1e".to_string(),
    ];
    args.extend(tips);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let Some(text) = git_run(root, &args_ref) else {
        if head.is_some() {
            return Err("Could not read Git history. Check repository access and retry.".into());
        }
        return Ok(GitHistory::default());
    };
    Ok(GitHistory {
        commits: parse_git_history_log(&text, head.as_deref(), &remotes),
        head,
    })
}

fn parse_git_history_log(
    text: &str,
    head: Option<&str>,
    remotes: &[String],
) -> Vec<GitHistoryCommit> {
    let mut commits = Vec::new();
    for record in text.split('\u{1e}') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let mut fields = record.split('\0');
        let Some(sha) = fields.next() else { continue };
        let Some(short_sha) = fields.next() else {
            continue;
        };
        let Some(parents) = fields.next() else {
            continue;
        };
        let Some(author) = fields.next() else {
            continue;
        };
        let Some(timestamp) = fields.next() else {
            continue;
        };
        let Some(decorations) = fields.next() else {
            continue;
        };
        let subject = fields.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }
        let (is_head, refs) = parse_git_decorations(decorations, head, sha, remotes);
        commits.push(GitHistoryCommit {
            sha: sha.to_string(),
            short_sha: if short_sha.is_empty() {
                sha.chars().take(7).collect()
            } else {
                short_sha.to_string()
            },
            parents: parents.split_whitespace().map(str::to_string).collect(),
            author: author.to_string(),
            timestamp: timestamp.parse().unwrap_or(0),
            subject: subject.to_string(),
            refs,
            head: is_head,
        });
    }
    commits
}

fn parse_git_decorations(
    raw: &str,
    head: Option<&str>,
    sha: &str,
    remotes: &[String],
) -> (bool, Vec<GitHistoryRef>) {
    let mut is_head = head == Some(sha);
    let mut refs = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some(name) = part.strip_prefix("HEAD -> ") {
            is_head = true;
            if !name.is_empty() {
                refs.push(GitHistoryRef {
                    name: name.to_string(),
                    kind: "local".into(),
                });
            }
        } else if part == "HEAD" {
            is_head = true;
        } else if let Some(tag) = part.strip_prefix("tag: ") {
            if !tag.is_empty() {
                refs.push(GitHistoryRef {
                    name: tag.to_string(),
                    kind: "tag".into(),
                });
            }
        } else if part.ends_with("/HEAD") {
            continue;
        } else if remotes
            .iter()
            .any(|remote| part == remote || part.starts_with(&format!("{remote}/")))
        {
            refs.push(GitHistoryRef {
                name: part.to_string(),
                kind: "remote".into(),
            });
        } else {
            refs.push(GitHistoryRef {
                name: part.to_string(),
                kind: "local".into(),
            });
        }
    }
    (is_head, refs)
}

fn git_remote_names(root: &Path) -> Vec<String> {
    git_run(root, &["remote"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

fn git_peel_commit(root: &Path, spec: &str) -> Result<String, String> {
    let spec = spec.trim();
    if spec.len() < 4 || spec.len() > 40 || !spec.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid commit".into());
    }
    let peeled = format!("{spec}^{{commit}}");
    git_stdout(root, &["rev-parse", "--verify", &peeled]).ok_or_else(|| "Unknown commit".into())
}

fn git_commit_files_for(root: &Path, sha: &str) -> Result<Vec<GitChangedFile>, String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let sha = git_peel_commit(root, sha)?;
    let mut files: HashMap<String, FileAcc> = HashMap::new();
    let mut statuses: HashMap<String, &'static str> = HashMap::new();
    if let Some(text) = git_run(
        root,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--no-renames",
            "--numstat",
            "-z",
            &sha,
        ],
    ) {
        add_numstat_map(&text, &mut files);
    }
    if let Some(names) = git_run(
        root,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--no-renames",
            "--name-status",
            "-z",
            &sha,
        ],
    ) {
        add_name_status(&names, &mut statuses);
    }
    let mut out = Vec::with_capacity(files.len().max(statuses.len()));
    let mut seen = HashSet::new();
    for (relative, acc) in files {
        seen.insert(relative.clone());
        let status = statuses.get(&relative).copied().unwrap_or("modified");
        out.push(GitChangedFile {
            path: path_to_js(&root.join(&relative)),
            relative,
            status: status.to_string(),
            additions: acc.additions,
            deletions: acc.deletions,
            staged: false,
            unstaged: false,
        });
    }
    for (relative, status) in statuses {
        if seen.contains(&relative) {
            continue;
        }
        out.push(GitChangedFile {
            path: path_to_js(&root.join(&relative)),
            relative,
            status: status.to_string(),
            additions: 0,
            deletions: 0,
            staged: false,
            unstaged: false,
        });
    }
    out.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(out)
}

fn git_commit_file_diff_for(root: &Path, sha: &str, relative: &str) -> Result<GitFileDiff, String> {
    let relative = resolve_repo_path(root, relative)?;
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let sha = git_peel_commit(root, sha)?;
    let parent = git_stdout(root, &["rev-parse", "--verify", &format!("{sha}^")]);
    let original_bytes = match &parent {
        Some(parent) => git_blob(root, &format!("{parent}:{relative}")).unwrap_or_default(),
        None => Vec::new(),
    };
    let current_bytes = git_blob(root, &format!("{sha}:{relative}")).unwrap_or_default();
    let binary = original_bytes.contains(&0) || current_bytes.contains(&0);
    let too_large = original_bytes.len() as u64 > MAX_TEXT_FILE_BYTES
        || current_bytes.len() as u64 > MAX_TEXT_FILE_BYTES;
    let status = if original_bytes.is_empty() && !current_bytes.is_empty() {
        "added"
    } else if !original_bytes.is_empty() && current_bytes.is_empty() {
        "deleted"
    } else {
        "modified"
    };
    let (original, current) = if binary || too_large {
        (String::new(), String::new())
    } else {
        (
            String::from_utf8_lossy(&original_bytes).into_owned(),
            String::from_utf8_lossy(&current_bytes).into_owned(),
        )
    };
    Ok(GitFileDiff {
        path: path_to_js(&root.join(&relative)),
        relative,
        status: status.to_string(),
        original,
        current,
        binary,
        too_large,
    })
}

/// `git add -A`, except for conflicted files: staging those would mark them
/// resolved with their conflict markers still in. Pathspec excludes do not
/// hold back unmerged paths, so with conflicts the other files are named.
pub(crate) fn git_stage_all_for(root: &Path) -> Result<(), String> {
    if git_unmerged_checked_for(root)?.is_empty() {
        return git_checked(root, &["add", "-A", "--", "."]);
    }
    let paths = git_diff_index_checked(root, false)?
        .files
        .into_iter()
        .map(|file| file.relative)
        .collect::<Vec<_>>();
    git_index_files_for(root, &paths, true)
}

pub(crate) fn git_stage_file_for(root: &Path, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    git_checked(root, &["--literal-pathspecs", "add", "--", &relative])
}

/// Send literal NUL-separated pathspecs over stdin, so a large selection is one
/// index transaction and cannot exceed Windows' command-line length limit.
fn git_index_files_for(root: &Path, relatives: &[String], staging: bool) -> Result<(), String> {
    if relatives.len() > 100_000 {
        return Err("Too many Git paths".into());
    }
    if relatives.is_empty() {
        return Ok(());
    }
    let mut paths = relatives
        .iter()
        .map(|path| resolve_repo_path(root, path))
        .collect::<Result<Vec<_>, _>>()?;
    let has_head = !staging && git_stdout(root, &["rev-parse", "--verify", "HEAD"]).is_some();
    if has_head {
        // Restoring only a rename destination leaves the old path staged as a
        // deletion. Include the source names for the selected renames too.
        let renames = git_run(
            root,
            &[
                "diff",
                "--cached",
                "--relative",
                "--name-status",
                "-z",
                "--diff-filter=R",
                "--find-renames",
            ],
        )
        .ok_or("Could not read staged renames")?;
        let mut records = renames.split('\0');
        while let Some(status) = records.next() {
            if status.is_empty() {
                break;
            }
            let (Some(source), Some(destination)) = (records.next(), records.next()) else {
                return Err("Could not read staged renames".into());
            };
            if paths
                .iter()
                .any(|path| path == destination || destination.starts_with(&format!("{path}/")))
            {
                paths.push(resolve_repo_path(root, source)?);
            }
        }
    }
    let args = if staging {
        vec!["add", "--pathspec-from-file=-", "--pathspec-file-nul"]
    } else if has_head {
        vec![
            "restore",
            "--staged",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ]
    } else {
        vec![
            "rm",
            "--cached",
            "-r",
            "-f",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ]
    };
    git_paths_checked(root, &args, &paths)
}

fn git_paths_checked(root: &Path, args: &[&str], paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let input = paths.join("\0") + "\0";
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let _turn = GIT_SPAWN_GATE.enter();
        let mut child = git_cmd()
            .arg("--literal-pathspecs")
            .arg("-C")
            .arg(root)
            .args(args)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut stdin = child.stdin.take().ok_or("Missing Git stdin")?;
        let bytes = input.as_bytes().to_vec();
        let input_deadline = Instant::now() + GIT_LOCAL_TIMEOUT;
        let (sender, written) = mpsc::channel();
        thread::spawn(move || {
            let _ = sender.send(stdin.write_all(&bytes));
        });
        let output = wait_with_timeout(child, GIT_LOCAL_TIMEOUT).map_err(|e| e.to_string())?;
        drop(_turn);
        if output.status.success() {
            return written
                .recv_timeout(input_deadline.saturating_duration_since(Instant::now()))
                .map_err(|e| format!("Git input did not close before its deadline: {e}"))?
                .map_err(|e| e.to_string());
        }
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if is_index_lock_error(&error) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
            continue;
        }
        return Err(if error.is_empty() {
            "Git index operation failed".into()
        } else {
            error
        });
    }
}

fn git_stage_contents_for(
    root: &Path,
    relative: &str,
    contents: &[u8],
    expected_original: Option<&[u8]>,
) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    if contents.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("File too large".into());
    }
    let index_path = root.join(
        git_run(root, &["rev-parse", "--git-path", "index"])
            .ok_or("Cannot locate Git index")?
            .trim(),
    );
    let lock_path = PathBuf::from(format!("{}.lock", index_path.display()));
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut lock = loop {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(lock) => break lock,
            Err(error) if error.kind() == ErrorKind::AlreadyExists && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    };
    let result = (|| {
        let index = match std::fs::read(&index_path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        if let Some(bytes) = &index {
            lock.write_all(bytes).map_err(|e| e.to_string())?;
        }
        drop(lock);
        let staged = git_run(
            root,
            &[
                "--literal-pathspecs",
                "ls-files",
                "--stage",
                "--",
                &relative,
            ],
        )
        .ok_or("Cannot read Git index")?;
        let fields: Vec<_> = staged.split_whitespace().collect();
        if let Some(expected_original) = expected_original {
            let expected_hash = git_hash_object(root, &relative, expected_original)?;
            if if staged.is_empty() {
                !expected_original.is_empty()
            } else {
                fields.get(1).copied() != Some(expected_hash.as_str())
                    || fields.get(2).copied() != Some("0")
            } {
                return Err(
                    "The Git index changed. Refresh the diff before staging this hunk.".into(),
                );
            }
        }
        let hash = git_hash_object(root, &relative, contents)?;
        let mode = git_index_mode(root, &relative).unwrap_or_else(|| "100644".into());
        let run = |args: &[&str]| -> Result<(), String> {
            let output = git_cmd()
                .arg("-C")
                .arg(root)
                .args(args)
                .env("GIT_INDEX_FILE", &lock_path)
                .output()
                .map_err(|e| e.to_string())?;
            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        };
        if index.is_none() {
            run(&["read-tree", "--empty"])?;
        }
        run(&[
            "update-index",
            "--add",
            "--cacheinfo",
            &mode,
            &hash,
            &relative,
        ])?;
        std::fs::rename(&lock_path, &index_path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&lock_path);
    }
    result
}

fn git_index_mode(root: &Path, relative: &str) -> Option<String> {
    let out = git_run(root, &["ls-files", "--stage", "--", relative])?;
    let mode = out.lines().next()?.split_whitespace().next()?;
    if mode.len() == 6 && mode.bytes().all(|b| b.is_ascii_digit()) {
        Some(mode.to_string())
    } else {
        None
    }
}

fn git_hash_object(root: &Path, relative: &str, contents: &[u8]) -> Result<String, String> {
    let _turn = GIT_SPAWN_GATE.enter();
    let mut child = git_cmd()
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(["hash-object", "-w", "--path", relative, "--stdin"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "hash-object stdin".to_string())?;
    let bytes = contents.to_vec();
    let input_deadline = Instant::now() + GIT_LOCAL_TIMEOUT;
    let (sender, written) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(stdin.write_all(&bytes));
    });
    let output = wait_with_timeout(child, GIT_LOCAL_TIMEOUT).map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = stderr.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        let msg = stdout.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        return Err("git hash-object failed".into());
    }
    written
        .recv_timeout(input_deadline.saturating_duration_since(Instant::now()))
        .map_err(|e| format!("Git input did not close before its deadline: {e}"))?
        .map_err(|e| e.to_string())?;
    let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if hash.len() != 40 && hash.len() != 64 {
        return Err("git hash-object returned an invalid hash".into());
    }
    Ok(hash)
}

fn git_unstage_file_for(root: &Path, relative: &str) -> Result<(), String> {
    git_index_files_for(root, &[relative.to_string()], false)
}

fn git_unstage_all_for(root: &Path) -> Result<(), String> {
    git_work_tree_checked(root)?;
    if git_stdout(root, &["rev-parse", "--verify", "HEAD"]).is_some() {
        git_checked(root, &["restore", "--staged", "--", "."])
    } else {
        let files = git_run(root, &["ls-files", "--cached"])
            .ok_or_else(|| "Could not read staged files".to_string())?;
        if files.trim().is_empty() {
            Ok(())
        } else {
            git_checked(root, &["rm", "--cached", "-r", "-f", "--", "."])
        }
    }
}

fn git_discard_file_for(root: &Path, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    let abs = root.join(&relative);
    let tracked = git_run(
        root,
        &["--literal-pathspecs", "ls-files", "-z", "--", &relative],
    )
    .ok_or("Could not determine whether the Git path is tracked; nothing was discarded")?;
    if tracked.is_empty() {
        if abs.is_file() {
            std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
        } else if abs.exists() {
            git_checked(
                root,
                &["--literal-pathspecs", "clean", "-fd", "--", &relative],
            )?;
        }
        return Ok(());
    }
    git_checked(
        root,
        &[
            "--literal-pathspecs",
            "restore",
            "--worktree",
            "--",
            &relative,
        ],
    )
}

fn git_discard_all_for(root: &Path) -> Result<(), String> {
    git_discard_selection_for(root, None)
}

fn git_discard_selection_for(root: &Path, relatives: Option<&[String]>) -> Result<(), String> {
    if relatives.is_some_and(|paths| paths.len() > 100_000) {
        return Err("Too many Git paths".into());
    }
    let selected = relatives
        .map(|paths| {
            paths
                .iter()
                .map(|p| resolve_repo_path(root, p))
                .collect::<Result<HashSet<_>, _>>()
        })
        .transpose()?;
    if selected.as_ref().is_some_and(HashSet::is_empty) {
        return Ok(());
    }
    let files = git_diff_index_checked(root, false)?
        .files
        .into_iter()
        .filter(|file| {
            file.unstaged
                && selected
                    .as_ref()
                    .is_none_or(|paths| paths.contains(&file.relative))
        })
        .collect::<Vec<_>>();
    if selected
        .as_ref()
        .is_some_and(|paths| paths.len() != files.len())
    {
        return Err("Selected files changed; refresh before discarding".into());
    }
    let mut tracked = Vec::new();
    let mut untracked = Vec::new();
    for file in files {
        let relative = resolve_repo_path(root, &file.relative)?;
        if file.status == "untracked" {
            untracked.push(root.join(relative));
        } else {
            tracked.push(relative);
        }
    }
    git_paths_checked(
        root,
        &[
            "restore",
            "--worktree",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ],
        &tracked,
    )?;
    for path in untracked {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn git_staged_context_for(root: &Path) -> Result<GitStagedContext, String> {
    let mut summary = git_run(root, &["diff", "--cached", "--stat", "--", "."]).unwrap_or_default();
    let mut patch =
        git_run(root, &["diff", "--cached", "--no-ext-diff", "--", "."]).unwrap_or_default();

    if summary.trim().is_empty() && patch.trim().is_empty() {
        summary = git_run(root, &["diff", "HEAD", "--stat", "--", "."]).unwrap_or_default();
        patch = git_run(root, &["diff", "HEAD", "--no-ext-diff", "--", "."]).unwrap_or_default();
        if let Some(untracked) = git_run(root, &["ls-files", "--others", "--exclude-standard"]) {
            let names = untracked.trim();
            if !names.is_empty() {
                if !summary.trim().is_empty() {
                    summary.push('\n');
                }
                summary.push_str("Untracked files:\n");
                summary.push_str(names);
            }
        }
    }

    if summary.trim().is_empty() && patch.trim().is_empty() {
        return Err("No changes to summarize".into());
    }

    Ok(GitStagedContext {
        branch: git_branch(root),
        summary,
        patch,
    })
}

pub(crate) fn git_commit_args(root: &Path, message: &str, extra: &[&str]) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Commit message cannot be empty".into());
    }
    let conflicts = git_unmerged_checked_for(root)?;
    if !conflicts.is_empty() {
        return Err(unmerged_message(&conflicts));
    }
    let mut args = vec!["commit"];
    args.extend_from_slice(extra);
    args.extend(["--cleanup=strip", "-m", message]);
    git_checked(root, &args).map_err(with_signing_hint)
}

/// Explain why signing fails here when the same commit works in a terminal.
fn with_signing_hint(error: String) -> String {
    if !error.contains("failed to sign") && !error.contains("ssh-keygen") {
        return error;
    }
    format!(
        "{error}\n\nGit couldn't sign this commit. bycoda runs git without a terminal, \
         so your signer needs a GUI passphrase prompt (e.g. pinentry-mac) or an unlocked agent."
    )
}

fn git_undo_last_commit_for(root: &Path) -> Result<(), String> {
    git_work_tree_checked(root)?;
    // `<sha> <parent>...`: one parent for an ordinary commit.
    let line = git_stdout(root, &["rev-list", "--parents", "-n", "1", "HEAD"])
        .ok_or_else(|| "No commits yet".to_string())?;
    match line.split_whitespace().count() {
        1 => Err("The first commit has no parent to go back to".into()),
        2 => git_checked(root, &["reset", "--soft", "HEAD~1"]),
        _ => Err("Cannot undo a merge commit".into()),
    }
}

fn git_pull_for(root: &Path, rebase: bool) -> Result<(), String> {
    git_work_tree_checked(root)?;
    if rebase {
        git_checked(root, &["pull", "--rebase"]).map_err(with_signing_hint)
    } else {
        git_checked(root, &["pull", "--ff-only"])
    }
}

fn git_head_message_for(root: &Path) -> Result<String, String> {
    git_stdout(root, &["log", "-1", "--pretty=%B"]).ok_or_else(|| "No commits yet".to_string())
}

fn git_push_for(root: &Path) -> Result<(), String> {
    if git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some() {
        return git_checked(root, &["push"]);
    }
    let remote = git_remote_name(root).ok_or_else(|| "No git remote to push to".to_string())?;
    git_checked(root, &["push", "-u", &remote, "HEAD"])
}

fn git_sync_changes_for(root: &Path) -> Result<(), String> {
    if git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some() {
        git_checked(root, &["pull", "--no-edit", "--ff"]).map_err(with_signing_hint)?;
        return git_checked(root, &["push"]);
    }
    git_push_for(root)
}

fn git_range_context_for(root: &Path) -> Result<GitRangeContext, String> {
    let head = git_branch(root).ok_or_else(|| "Not on a branch".to_string())?;
    let remote = git_remote_name(root);
    let default_branch = git_default_branch(root, remote.as_deref())
        .ok_or_else(|| "Could not resolve the default branch".to_string())?;
    let base_ref = match &remote {
        Some(remote)
            if git_ref_exists(root, &format!("refs/remotes/{remote}/{default_branch}")) =>
        {
            format!("{remote}/{default_branch}")
        }
        _ => default_branch.clone(),
    };
    let spec = format!("{base_ref}...HEAD");
    let commit_summary =
        git_run(root, &["log", "--format=%s", &format!("{base_ref}..HEAD")]).unwrap_or_default();
    let diff_summary = git_run(root, &["diff", "--stat", &spec]).unwrap_or_default();
    let diff_patch = git_run(root, &["diff", "--no-ext-diff", &spec]).unwrap_or_default();
    if commit_summary.trim().is_empty() && diff_patch.trim().is_empty() {
        return Err("No commits to include in a pull request".into());
    }
    Ok(GitRangeContext {
        base: default_branch,
        head,
        commit_summary,
        diff_summary,
        diff_patch,
    })
}

fn git_pr_status_for(root: &Path) -> Result<Option<GitPr>, String> {
    let Some(branch) = git_branch(root) else {
        return Ok(None);
    };
    let repo = git_github_repo_for(root)?;
    let head =
        github_pr_head_filter(&repo, &branch).ok_or("Could not resolve pull request owner")?;
    let json = gh_checked(
        root,
        &[
            "pr",
            "list",
            "--head",
            &head,
            "--json",
            "number,title,url,state",
            "--limit",
            "20",
            "--state",
            "all",
        ],
    )?;
    let _: Vec<GitPr> = serde_json::from_str(&json).map_err(|error| error.to_string())?;
    Ok(parse_gh_pr_list(&json))
}

fn github_pr_head_filter(repo: &str, branch: &str) -> Option<String> {
    let (owner, _) = split_github_repo(repo).ok()?;
    Some(format!("{owner}:{branch}"))
}

fn git_github_repo_for(root: &Path) -> Result<String, String> {
    let json = gh_checked(root, &["repo", "view", "--json", "nameWithOwner"])?;
    #[derive(Deserialize)]
    struct View {
        #[serde(rename = "nameWithOwner")]
        name_with_owner: String,
    }
    let view: View = serde_json::from_str(&json).map_err(|error| error.to_string())?;
    let slug = view.name_with_owner.trim();
    if slug.is_empty() || !slug.contains('/') {
        return Err("GitHub did not return a repository".into());
    }
    Ok(slug.to_string())
}

fn git_github_repositories_for(root: &Path) -> Result<Vec<String>, String> {
    let json = gh_checked(root, &["repo", "view", "--json", "nameWithOwner,parent"])?;
    parse_github_repositories(&json)
}

fn parse_github_repositories(json: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Owner {
        login: String,
    }
    #[derive(Deserialize)]
    struct Parent {
        name: String,
        owner: Owner,
    }
    #[derive(Deserialize)]
    struct View {
        #[serde(rename = "nameWithOwner")]
        name_with_owner: String,
        #[serde(default)]
        parent: Option<Parent>,
    }

    let view: View = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let (owner, name) = split_github_repo(&view.name_with_owner)?;
    let mut repos = vec![format!("{owner}/{name}")];
    if let Some(parent) = view.parent {
        let parent = format!("{}/{}", parent.owner.login, parent.name);
        let (owner, name) = split_github_repo(&parent)?;
        let parent = format!("{owner}/{name}");
        if !repos[0].eq_ignore_ascii_case(&parent) {
            repos.push(parent);
        }
    }
    Ok(repos)
}

fn git_github_work_items_for(
    root: &Path,
    repo: &str,
    kind: &str,
    assigned_to_me: bool,
    state: &str,
    search: &str,
    limit: u32,
) -> Result<Vec<GitHubWorkItem>, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let state = if state.trim().eq_ignore_ascii_case("all") {
        "all"
    } else {
        "open"
    };
    let limit = limit.clamp(1, 100).to_string();
    let fields = if kind == "pr" {
        "number,title,url,state,createdAt,updatedAt,labels,assignees,isDraft"
    } else {
        "number,title,url,state,stateReason,createdAt,updatedAt,labels,assignees"
    };
    let mut args = vec![
        kind.to_string(),
        "list".into(),
        "--state".into(),
        state.into(),
        "--limit".into(),
        limit,
        "--repo".into(),
        repo.clone(),
        "--json".into(),
        fields.into(),
    ];
    if assigned_to_me {
        args.push("--assignee".into());
        args.push("@me".into());
    }
    let search = search.trim();
    if !search.is_empty() {
        args.push("--search".into());
        args.push(search.to_string());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let json = gh_checked(root, &refs)?;
    parse_github_work_items(&json, kind, &repo)
}

fn git_github_work_item_for(
    root: &Path,
    repo: &str,
    kind: &str,
    number: i64,
) -> Result<GitHubWorkItem, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    if number <= 0 {
        return Err("GitHub task number must be positive".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let number = number.to_string();
    let fields = if kind == "pr" {
        "number,title,url,state,createdAt,updatedAt,labels,assignees,isDraft"
    } else {
        "number,title,url,state,stateReason,createdAt,updatedAt,labels,assignees"
    };
    let json = gh_checked(
        root,
        &[kind, "view", &number, "--repo", &repo, "--json", fields],
    )?;
    parse_github_work_item(&json, kind, &repo)
}

fn github_pr_action_args(
    repo: &str,
    number: i64,
    action: &str,
    expected_head_oid: &str,
) -> Result<Vec<String>, String> {
    if number <= 0 {
        return Err("GitHub pull request number must be positive".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let number = number.to_string();
    let args = match action.trim() {
        "merge" => vec!["pr", "merge", &number, "--repo", &repo, "--merge"],
        "squash" => vec!["pr", "merge", &number, "--repo", &repo, "--squash"],
        "rebase" => vec!["pr", "merge", &number, "--repo", &repo, "--rebase"],
        "draft" => vec!["pr", "ready", &number, "--repo", &repo, "--undo"],
        "ready" => vec!["pr", "ready", &number, "--repo", &repo],
        "close" => vec!["pr", "close", &number, "--repo", &repo],
        "reopen" => vec!["pr", "reopen", &number, "--repo", &repo],
        _ => return Err("Unknown GitHub pull request action".into()),
    };
    let mut args: Vec<String> = args.into_iter().map(str::to_string).collect();
    if matches!(action.trim(), "merge" | "squash" | "rebase") {
        validate_reviewed_head(expected_head_oid)?;
        args.extend(["--match-head-commit".into(), expected_head_oid.into()]);
    }
    Ok(args)
}

pub(crate) fn validate_reviewed_head(oid: &str) -> Result<(), String> {
    if oid.len() != 40 || !oid.bytes().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(
            "Refresh and review the pull request before merging: a reviewed head SHA is required"
                .into(),
        );
    }
    Ok(())
}

fn git_github_pr_action_for(
    root: &Path,
    repo: &str,
    number: i64,
    action: &str,
    expected_head_oid: &str,
) -> Result<GitHubWorkItem, String> {
    let args = github_pr_action_args(repo, number, action, expected_head_oid)?;
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    // Successful mutation commands do not always write to stdout. Their exit
    // status confirms the action ran; the follow-up view fetches the new state.
    gh_run(root, &refs, true)?;
    git_github_work_item_for(root, repo, "pr", number)
}

fn git_github_work_item_details_for(
    root: &Path,
    repo: &str,
    kind: &str,
    number: i64,
) -> Result<GitHubWorkItemDetails, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    if number <= 0 {
        return Err("Invalid GitHub item number".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let number = number.to_string();
    let fields = if kind == "pr" {
        "body,author,baseRefName,headRefName,headRefOid,reviewDecision"
    } else {
        "body,author"
    };
    let json = gh_checked(
        root,
        &[kind, "view", &number, "--repo", &repo, "--json", fields],
    )?;
    parse_github_work_item_details(&json)
}

fn parse_github_work_item_details(json: &str) -> Result<GitHubWorkItemDetails, String> {
    #[derive(Deserialize)]
    struct Author {
        #[serde(default)]
        login: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        #[serde(default)]
        body: String,
        #[serde(default)]
        head_ref_oid: String,
        #[serde(default)]
        author: Option<Author>,
        #[serde(default)]
        base_ref_name: String,
        #[serde(default)]
        head_ref_name: String,
        #[serde(default)]
        review_decision: Option<String>,
    }
    let row: Row = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let author = row.author.map(|author| author.login).unwrap_or_default();
    let author_avatar_url = github_avatar_url(&author);
    Ok(GitHubWorkItemDetails {
        body: row.body,
        head_ref_oid: row.head_ref_oid,
        author,
        author_avatar_url,
        base_ref_name: row.base_ref_name,
        head_ref_name: row.head_ref_name,
        review_decision: row.review_decision.unwrap_or_default(),
    })
}

const GITHUB_ISSUE_THREAD_QUERY: &str = r#"
query InboxIssueThread($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      comments(last: 40) {
        totalCount
        nodes {
          id
          author { login }
          body
          createdAt
          url
          isMinimized
        }
      }
    }
  }
}
"#;

const GITHUB_PR_THREAD_QUERY: &str = r#"
query InboxPullRequestThread($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
      baseRefName
      headRefName
      commits(last: 40) {
        totalCount
        nodes {
          commit {
            oid
            messageHeadline
            committedDate
            url
            author {
              name
              user { login }
            }
          }
        }
      }
      comments(last: 40) {
        totalCount
        nodes {
          id
          author { login }
          body
          createdAt
          url
          isMinimized
        }
      }
      reviews(last: 40) {
        totalCount
        nodes {
          id
          author { login }
          body
          state
          submittedAt
          url
        }
      }
      reviewThreads(last: 20) {
        totalCount
        nodes {
          id
          isResolved
          path
          comments(first: 8) {
            totalCount
            nodes {
              id
              author { login }
              body
              createdAt
              url
              path
              line
              originalLine
              isMinimized
            }
          }
        }
      }
    }
  }
}
"#;

const GITHUB_REVIEW_REPLY_MUTATION: &str = r#"
mutation InboxReviewReply($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: $threadId
    body: $body
  }) {
    comment { url }
  }
}
"#;

fn git_github_work_item_thread_for(
    root: &Path,
    repo: &str,
    kind: &str,
    number: i64,
) -> Result<GitHubWorkItemThread, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    if number <= 0 {
        return Err("Invalid GitHub item number".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let query = if kind == "pr" {
        GITHUB_PR_THREAD_QUERY
    } else {
        GITHUB_ISSUE_THREAD_QUERY
    };
    let owner_field = format!("owner={owner}");
    let name_field = format!("name={name}");
    let number_field = format!("number={number}");
    let json = gh_checked(
        root,
        &[
            "api",
            "graphql",
            "-f",
            &format!("query={query}"),
            "-F",
            &owner_field,
            "-F",
            &name_field,
            "-F",
            &number_field,
        ],
    )?;
    parse_github_work_item_thread(&json, kind)
}

fn github_comment_input<'a>(
    kind: &'a str,
    number: i64,
    body: &'a str,
) -> Result<(&'a str, &'a str), String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    if number <= 0 {
        return Err("Invalid GitHub item number".into());
    }
    let body = body.trim();
    if body.is_empty() {
        return Err("Comment cannot be empty".into());
    }
    Ok((kind, body))
}

fn git_github_work_item_comment_for(
    root: &Path,
    repo: &str,
    kind: &str,
    number: i64,
    body: &str,
    in_reply_to: &str,
) -> Result<String, String> {
    let (kind, body) = github_comment_input(kind, number, body)?;
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let reply = in_reply_to.trim();
    if !reply.is_empty() {
        if kind != "pr" {
            return Err("Review replies require a pull request".into());
        }
        github_review_reply_context(root, &repo, number, reply)?;
        return git_github_review_reply_for(root, reply, body);
    }
    let number = number.to_string();
    with_temp_markdown(body, |path| {
        let output = gh_checked(
            root,
            &[
                kind,
                "comment",
                &number,
                "--repo",
                &repo,
                "--body-file",
                path,
            ],
        )?;
        github_url_from_output(&output, "GitHub did not return a comment URL")
    })
}

const GITHUB_REVIEW_THREAD_TARGET_QUERY: &str = r#"query InboxReviewThreadTarget($id: ID!) {
  node(id: $id) { ... on PullRequestReviewThread {
    path line pullRequest { number title url repository { nameWithOwner } }
    comments(first: 1) { nodes { body author { login } } }
  } }
}"#;

pub(crate) fn github_review_reply_context(
    root: &Path,
    repo: &str,
    number: i64,
    thread_id: &str,
) -> Result<String, String> {
    split_github_repo(repo)?;
    if number <= 0 || !valid_github_node_id(thread_id) {
        return Err("Invalid review thread target".into());
    }
    let json = gh_checked(
        root,
        &[
            "api",
            "graphql",
            "-f",
            &format!("query={GITHUB_REVIEW_THREAD_TARGET_QUERY}"),
            "-F",
            &format!("id={thread_id}"),
        ],
    )?;
    parse_github_review_thread_target(&json, repo, number)
}

fn parse_github_review_thread_target(
    json: &str,
    repo: &str,
    number: i64,
) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if value
        .get("errors")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|errors| !errors.is_empty())
    {
        return Err("Could not verify review thread target".into());
    }
    let node = &value["data"]["node"];
    let pr = &node["pullRequest"];
    if pr["repository"]["nameWithOwner"].as_str() != Some(repo)
        || pr["number"].as_i64() != Some(number)
    {
        return Err(
            "Review thread does not belong to the approved repository and pull request".into(),
        );
    }
    let comment = &node["comments"]["nodes"][0];
    Ok(format!(
        "{} #{}: {}\n{}\n{}:{}\n{}: {}",
        repo,
        number,
        pr["title"].as_str().unwrap_or(""),
        pr["url"].as_str().unwrap_or(""),
        node["path"].as_str().unwrap_or(""),
        node["line"],
        comment["author"]["login"].as_str().unwrap_or(""),
        comment["body"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(2000)
            .collect::<String>()
    ))
}

fn git_github_review_reply_for(root: &Path, thread_id: &str, body: &str) -> Result<String, String> {
    if !valid_github_node_id(thread_id) {
        return Err("Invalid review thread".into());
    }
    let thread_field = format!("threadId={thread_id}");
    with_temp_markdown(body, |path| {
        let body_field = format!("body=@{path}");
        let json = gh_checked(
            root,
            &[
                "api",
                "graphql",
                "-f",
                &format!("query={GITHUB_REVIEW_REPLY_MUTATION}"),
                "-F",
                &thread_field,
                "-F",
                &body_field,
            ],
        )?;
        parse_github_review_reply_url(&json)
    })
}

pub(crate) fn with_temp_markdown(
    body: &str,
    run: impl FnOnce(&str) -> Result<String, String>,
) -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("bycoda-comment-{stamp}.md"));
    std::fs::write(&path, body).map_err(|error| error.to_string())?;
    let path_str = path.to_string_lossy().into_owned();
    let result = run(&path_str);
    let _ = std::fs::remove_file(&path);
    result
}

fn valid_github_node_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && id.len() < 256
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '='))
}

fn github_url_from_output(output: &str, missing: &str) -> Result<String, String> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with("http://") || line.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| {
            if output.trim().is_empty() {
                missing.to_string()
            } else {
                output.trim().to_string()
            }
        })
}

fn parse_github_review_reply_url(json: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if let Some(message) = value
        .get("errors")
        .and_then(|errors| errors.as_array())
        .and_then(|errors| errors.first())
        .and_then(|error| error.get("message"))
        .and_then(|message| message.as_str())
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        return Err(message.to_string());
    }
    let url = value
        .pointer("/data/addPullRequestReviewThreadReply/comment/url")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        return Ok(url.to_string());
    }
    Err("GitHub did not return a comment URL".into())
}

pub(crate) fn split_github_repo(slug: &str) -> Result<(String, String), String> {
    let slug = slug.trim();
    let Some((owner, name)) = slug.split_once('/') else {
        return Err("GitHub did not return a repository".into());
    };
    let owner = owner.trim();
    let name = name.trim();
    if owner.is_empty()
        || name.is_empty()
        || name.contains('/')
        || owner.chars().any(char::is_whitespace)
        || name.chars().any(char::is_whitespace)
    {
        return Err("GitHub did not return a repository".into());
    }
    Ok((owner.to_string(), name.to_string()))
}

#[derive(Deserialize)]
struct GithubGraphqlEnvelope {
    #[serde(default)]
    data: Option<GithubGraphqlData>,
    #[serde(default)]
    errors: Vec<GithubGraphqlError>,
}

#[derive(Deserialize)]
struct GithubGraphqlError {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct GithubGraphqlData {
    repository: Option<GithubGraphqlRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlRepository {
    issue: Option<GithubGraphqlIssue>,
    pull_request: Option<GithubGraphqlPullRequest>,
}

#[derive(Deserialize)]
struct GithubGraphqlIssue {
    #[serde(default)]
    comments: GithubGraphqlNodes<GithubGraphqlComment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlPullRequest {
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    commits: GithubGraphqlNodes<GithubGraphqlCommitNode>,
    #[serde(default)]
    comments: GithubGraphqlNodes<GithubGraphqlComment>,
    #[serde(default)]
    reviews: GithubGraphqlNodes<GithubGraphqlReview>,
    #[serde(default)]
    review_threads: GithubGraphqlNodes<GithubGraphqlReviewThread>,
}

#[derive(Deserialize)]
struct GithubGraphqlCommitNode {
    commit: GithubGraphqlCommit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlCommit {
    #[serde(default)]
    oid: String,
    #[serde(default)]
    message_headline: String,
    #[serde(default)]
    committed_date: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    author: Option<GithubGraphqlCommitAuthor>,
}

#[derive(Deserialize)]
struct GithubGraphqlCommitAuthor {
    #[serde(default)]
    name: String,
    #[serde(default)]
    user: Option<GithubGraphqlActor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlNodes<T> {
    total_count: i64,
    nodes: Vec<T>,
}

impl<T> Default for GithubGraphqlNodes<T> {
    fn default() -> Self {
        Self {
            total_count: 0,
            nodes: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlComment {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<GithubGraphqlActor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    path: String,
    #[serde(default)]
    line: Option<i64>,
    #[serde(default)]
    original_line: Option<i64>,
}

#[derive(Deserialize)]
struct GithubGraphqlReview {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<GithubGraphqlActor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    state: String,
    #[serde(default, rename = "submittedAt")]
    submitted_at: Option<String>,
    #[serde(default)]
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlReviewThread {
    #[serde(default)]
    id: String,
    #[serde(default)]
    is_resolved: bool,
    #[serde(default)]
    path: String,
    #[serde(default)]
    comments: GithubGraphqlNodes<GithubGraphqlComment>,
}

#[derive(Deserialize)]
struct GithubGraphqlActor {
    #[serde(default)]
    login: String,
}

fn parse_github_work_item_thread(json: &str, kind: &str) -> Result<GitHubWorkItemThread, String> {
    let envelope: GithubGraphqlEnvelope =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    let graphql_error = envelope
        .errors
        .iter()
        .map(|error| error.message.trim())
        .find(|message| !message.is_empty())
        .map(str::to_string);
    let Some(repository) = envelope.data.and_then(|data| data.repository) else {
        return Err(graphql_error.unwrap_or_else(|| "GitHub item not found".into()));
    };

    let mut comments = Vec::new();
    let mut commits = Vec::new();
    let mut truncated = false;
    let mut review_decision = String::new();
    let mut base_ref_name = String::new();
    let mut head_ref_name = String::new();

    if kind == "pr" {
        let Some(pull) = repository.pull_request else {
            return Err(graphql_error.unwrap_or_else(|| "GitHub pull request not found".into()));
        };
        review_decision = pull.review_decision.unwrap_or_default();
        base_ref_name = pull.base_ref_name;
        head_ref_name = pull.head_ref_name;
        truncated |= github_nodes_truncated(&pull.commits);
        commits.extend(pull.commits.nodes.into_iter().filter_map(|node| {
            let commit = node.commit;
            if commit.oid.trim().is_empty() || commit.committed_date.trim().is_empty() {
                return None;
            }
            let author = commit
                .author
                .map(|author| {
                    author
                        .user
                        .map(|user| user.login)
                        .filter(|login| !login.trim().is_empty())
                        .unwrap_or(author.name)
                })
                .unwrap_or_default();
            Some(GitHubWorkItemCommit {
                oid: commit.oid,
                message_headline: commit.message_headline,
                author,
                committed_date: commit.committed_date,
                url: commit.url,
            })
        }));
        truncated |= github_nodes_truncated(&pull.comments);
        comments.extend(
            pull.comments
                .nodes
                .into_iter()
                .filter_map(github_issue_comment),
        );
        truncated |= github_nodes_truncated(&pull.reviews);
        comments.extend(
            pull.reviews
                .nodes
                .into_iter()
                .filter_map(github_review_comment),
        );
        truncated |= github_nodes_truncated(&pull.review_threads);
        comments.extend(
            pull.review_threads
                .nodes
                .into_iter()
                .filter_map(github_review_thread),
        );
    } else {
        let Some(issue) = repository.issue else {
            return Err(graphql_error.unwrap_or_else(|| "GitHub issue not found".into()));
        };
        truncated |= github_nodes_truncated(&issue.comments);
        comments.extend(
            issue
                .comments
                .nodes
                .into_iter()
                .filter_map(github_issue_comment),
        );
    }

    comments.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(GitHubWorkItemThread {
        comments,
        commits,
        truncated,
        review_decision,
        base_ref_name,
        head_ref_name,
    })
}

fn github_nodes_truncated<T>(nodes: &GithubGraphqlNodes<T>) -> bool {
    (nodes.nodes.len() as i64) < nodes.total_count
}

fn github_actor_login(author: Option<GithubGraphqlActor>) -> String {
    author
        .map(|author| author.login)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn github_comment_id(kind: &str, id: &str, author: &str, created_at: &str) -> String {
    let id = id.trim();
    if !id.is_empty() {
        return id.to_string();
    }
    format!("{kind}:{author}:{created_at}")
}

fn github_issue_comment(comment: GithubGraphqlComment) -> Option<GitHubWorkItemComment> {
    github_mapped_comment(comment, "comment", "", false)
}

fn github_mapped_comment(
    comment: GithubGraphqlComment,
    kind: &str,
    fallback_path: &str,
    resolved: bool,
) -> Option<GitHubWorkItemComment> {
    if comment.is_minimized {
        return None;
    }
    let author = github_actor_login(comment.author);
    let created_at = comment.created_at.trim().to_string();
    let path = if comment.path.trim().is_empty() {
        fallback_path.trim().to_string()
    } else {
        comment.path.trim().to_string()
    };
    Some(GitHubWorkItemComment {
        id: github_comment_id(kind, &comment.id, &author, &created_at),
        kind: kind.to_string(),
        author_avatar_url: github_avatar_url(&author),
        author,
        body: comment.body,
        created_at,
        url: comment.url,
        state: String::new(),
        path,
        line: comment.line.or(comment.original_line),
        resolved,
        thread_id: String::new(),
        replies: Vec::new(),
    })
}

fn github_review_comment(review: GithubGraphqlReview) -> Option<GitHubWorkItemComment> {
    let state = review.state.trim().to_uppercase();
    if state.is_empty() || state == "PENDING" {
        return None;
    }
    let body = review.body.trim();
    if state == "COMMENTED" && body.is_empty() {
        return None;
    }
    let created_at = review
        .submitted_at
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if created_at.is_empty() {
        return None;
    }
    let author = github_actor_login(review.author);
    Some(GitHubWorkItemComment {
        id: github_comment_id("review", &review.id, &author, &created_at),
        kind: "review".into(),
        author_avatar_url: github_avatar_url(&author),
        author,
        body: review.body,
        created_at,
        url: review.url,
        state,
        path: String::new(),
        line: None,
        resolved: false,
        thread_id: String::new(),
        replies: Vec::new(),
    })
}

fn github_review_thread(thread: GithubGraphqlReviewThread) -> Option<GitHubWorkItemComment> {
    let thread_id = thread.id.trim().to_string();
    let mut mapped = thread.comments.nodes.into_iter().filter_map(|comment| {
        github_mapped_comment(comment, "review_comment", &thread.path, thread.is_resolved)
    });
    let mut first = mapped.next()?;
    first.thread_id = thread_id.clone();
    first.replies = mapped
        .map(|mut reply| {
            reply.thread_id = thread_id.clone();
            reply
        })
        .collect();
    Some(first)
}

fn github_avatar_url(login: &str) -> String {
    let login = login.trim();
    if login.is_empty() {
        return String::new();
    }
    let mut encoded = String::with_capacity(login.len());
    for byte in login.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    format!("https://avatars.githubusercontent.com/{encoded}?s=64")
}

const PR_FULL_CONTEXT_LINES: &str = "999999";

pub(crate) fn git_github_pr_diff_for(
    root: &Path,
    repo: &str,
    number: i64,
    full_context: bool,
) -> Result<GitHubPrDiff, String> {
    if number <= 0 {
        return Err("Invalid pull request number".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let number = number.to_string();
    let fields = if full_context {
        "files,additions,deletions,baseRefOid,headRefOid"
    } else {
        "files,additions,deletions,headRefOid"
    };
    let json = gh_run(
        root,
        &["pr", "view", &number, "--repo", &repo, "--json", fields],
        false,
    )?;
    let mut diff = parse_github_pr_diff_meta(&json)?;
    diff.head_oid = serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|error| error.to_string())?["headRefOid"]
        .as_str()
        .unwrap_or("")
        .to_string();
    validate_reviewed_head(&diff.head_oid)?;
    let (patch, truncated) = if full_context {
        let (base, head) = parse_github_pr_oids(&json)?;
        git_diff_full_context(root, &base, &head)?
    } else {
        (
            gh_run(root, &["pr", "diff", &number, "--repo", &repo], true)?,
            false,
        )
    };
    if !full_context {
        let current = gh_checked(
            root,
            &[
                "pr",
                "view",
                &number,
                "--repo",
                &repo,
                "--json",
                "headRefOid",
            ],
        )?;
        let current: serde_json::Value =
            serde_json::from_str(&current).map_err(|error| error.to_string())?;
        if current["headRefOid"].as_str() != Some(diff.head_oid.as_str()) {
            return Err(
                "Pull request head changed while loading the diff. Refresh and review again".into(),
            );
        }
    }
    if truncated || patch.len() > MAX_PR_DIFF_BYTES {
        diff.truncated = true;
    } else {
        diff.patch = patch;
    }
    if diff.additions == 0 && diff.deletions == 0 {
        diff.additions = diff.files.iter().map(|file| file.additions).sum();
        diff.deletions = diff.files.iter().map(|file| file.deletions).sum();
    }
    Ok(diff)
}

fn parse_github_pr_oids(json: &str) -> Result<(String, String), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        base_ref_oid: String,
        head_ref_oid: String,
    }
    let row: Row = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let base = row.base_ref_oid.trim();
    let head = row.head_ref_oid.trim();
    if base.is_empty() || head.is_empty() {
        return Err("Pull request is missing base or head commit".into());
    }
    Ok((base.to_string(), head.to_string()))
}

fn git_github_pr_checks_for(
    root: &Path,
    repo: &str,
    number: i64,
) -> Result<GitHubPrChecks, String> {
    let args = github_pr_checks_args(repo, number)?;
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let json = gh_checked(root, &refs)?;
    parse_github_pr_checks(&json)
}

fn github_pr_checks_args(repo: &str, number: i64) -> Result<Vec<String>, String> {
    if number <= 0 {
        return Err("GitHub pull request number must be positive".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    let repo = format!("{owner}/{name}");
    let number = number.to_string();
    Ok(vec![
        "pr".into(),
        "view".into(),
        number,
        "--repo".into(),
        repo,
        "--json".into(),
        "headRefOid,statusCheckRollup".into(),
    ])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubStatusCheckRow {
    #[serde(default, rename = "__typename")]
    typename: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    state: String,
    #[serde(default)]
    workflow_name: String,
    #[serde(default)]
    details_url: Option<String>,
    #[serde(default)]
    target_url: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    completed_at: Option<String>,
}

fn parse_github_pr_checks(json: &str) -> Result<GitHubPrChecks, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        #[serde(default)]
        head_ref_oid: String,
        #[serde(default)]
        status_check_rollup: Option<Vec<GitHubStatusCheckRow>>,
    }
    let row: Row = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let head_oid = row.head_ref_oid.trim().to_string();
    if head_oid.is_empty() {
        return Err("Pull request is missing head commit".into());
    }
    Ok(GitHubPrChecks {
        head_oid,
        checks: row
            .status_check_rollup
            .unwrap_or_default()
            .into_iter()
            .map(github_pr_check_from_row)
            .collect(),
    })
}

fn github_pr_check_from_row(row: GitHubStatusCheckRow) -> GitHubPrCheck {
    let is_status_context = if row.typename.is_empty() {
        !row.context.is_empty()
    } else {
        row.typename.eq_ignore_ascii_case("StatusContext")
    };
    if is_status_context {
        return GitHubPrCheck {
            name: row.context,
            workflow: String::new(),
            state: github_check_conclusion_state(&row.state),
            url: row.target_url.filter(|url| !url.trim().is_empty()),
            started_at: row.created_at,
            completed_at: None,
        };
    }
    GitHubPrCheck {
        name: row.name,
        workflow: row.workflow_name,
        state: github_check_state(&row.status, row.conclusion.as_deref().unwrap_or_default()),
        url: row.details_url.filter(|url| !url.trim().is_empty()),
        started_at: row.started_at,
        completed_at: row.completed_at,
    }
}

/// An unfinished CheckRun reports its execution state instead of a stale
/// conclusion. Only a completed or entirely missing status trusts the
/// conclusion; any other nonempty status stays unknown.
fn github_check_state(status: &str, conclusion: &str) -> String {
    match status.trim().to_ascii_uppercase().as_str() {
        "QUEUED" | "IN_PROGRESS" | "PENDING" | "WAITING" | "REQUESTED" => {
            return "pending".into();
        }
        "COMPLETED" | "" => return github_check_conclusion_state(conclusion),
        _ => {}
    }
    "unknown".into()
}

fn github_check_conclusion_state(value: &str) -> String {
    match value.trim().to_ascii_uppercase().as_str() {
        "SUCCESS" => "pass".into(),
        "FAILURE" | "ERROR" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => "fail".into(),
        "QUEUED" | "IN_PROGRESS" | "PENDING" | "WAITING" | "REQUESTED" => "pending".into(),
        "NEUTRAL" | "SKIPPED" => "skipping".into(),
        "CANCELLED" => "cancel".into(),
        _ => "unknown".into(),
    }
}

fn git_diff_full_context(root: &Path, base: &str, head: &str) -> Result<(String, bool), String> {
    ensure_git_commit(root, base)?;
    ensure_git_commit(root, head)?;
    ensure_merge_base(root, base, head)?;
    let context = format!("-U{PR_FULL_CONTEXT_LINES}");
    let three_dot = format!("{base}...{head}");
    let (bytes, truncated) = git_output_capped(
        root,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            &context,
            &three_dot,
        ],
        MAX_PR_DIFF_BYTES,
        None,
    )
    .ok_or_else(|| format!("git diff failed for {base}...{head}"))?;
    if truncated {
        return Ok((String::new(), true));
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), false))
}

fn ensure_merge_base(root: &Path, base: &str, head: &str) -> Result<(), String> {
    if merge_base_exists(root, base, head) {
        return Ok(());
    }
    if let Some(remote) = github_fetch_remote(root) {
        for deepen in ["50", "200", "800"] {
            git_checked(root, &["fetch", "--no-tags", "--deepen", deepen, &remote])?;
            if merge_base_exists(root, base, head) {
                return Ok(());
            }
        }
    }
    Err(format!(
        "Cannot find a merge base for {base} and {head}. Fetch more history and try again."
    ))
}

fn merge_base_exists(root: &Path, base: &str, head: &str) -> bool {
    git_output(root, &["merge-base", base, head]).is_some()
}

fn ensure_git_commit(root: &Path, oid: &str) -> Result<(), String> {
    let spec = format!("{oid}^{{commit}}");
    if git_output(root, &["cat-file", "-e", &spec]).is_some() {
        return Ok(());
    }
    if let Some(remote) = github_fetch_remote(root) {
        git_checked(root, &["fetch", "--no-tags", "--depth", "1", &remote, oid])?;
    }
    if git_output(root, &["cat-file", "-e", &spec]).is_some() {
        return Ok(());
    }
    Err(format!(
        "Missing git commit {oid}. Fetch the pull request refs and try again."
    ))
}

fn github_fetch_remote(root: &Path) -> Option<String> {
    if let Some(name) = gh_resolved_remote(root) {
        return Some(name);
    }
    if let Some(url) = gh_repo_view_url(root) {
        if let Some(name) = remote_matching_github_url(root, &url) {
            return Some(name);
        }
    }
    git_remote_name(root)
}

fn gh_resolved_remote(root: &Path) -> Option<String> {
    let listed = git_stdout(
        root,
        &["config", "--get-regexp", r"remote\..*\.gh-resolved"],
    )?;
    for line in listed.lines() {
        let key = line.split_whitespace().next()?;
        let name = key.strip_prefix("remote.")?.strip_suffix(".gh-resolved")?;
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

fn gh_repo_view_url(root: &Path) -> Option<String> {
    let text = gh_stdout(root, &["repo", "view", "--json", "url"])?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get("url")?
        .as_str()
        .map(str::to_owned)
        .filter(|url| !url.trim().is_empty())
}

fn remote_matching_github_url(root: &Path, url: &str) -> Option<String> {
    let remotes = git_stdout(root, &["remote", "-v"])?;
    let wanted = normalize_github_remote_url(url);
    for line in remotes.lines() {
        let mut parts = line.split_whitespace();
        let name = parts.next()?;
        let remote_url = parts.next()?;
        if normalize_github_remote_url(remote_url) == wanted {
            return Some(name.to_string());
        }
    }
    None
}

fn normalize_github_remote_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    if let Some((_, rest)) = trimmed.split_once("github.com:") {
        return format!(
            "github.com/{}",
            rest.trim_start_matches('/').to_ascii_lowercase()
        );
    }
    if let Some((_, rest)) = trimmed.split_once("github.com/") {
        return format!(
            "github.com/{}",
            rest.trim_start_matches('/').to_ascii_lowercase()
        );
    }
    trimmed.to_ascii_lowercase()
}

fn parse_github_pr_diff_meta(json: &str) -> Result<GitHubPrDiff, String> {
    #[derive(Deserialize)]
    struct FileRow {
        path: String,
        #[serde(default)]
        additions: i64,
        #[serde(default)]
        deletions: i64,
    }
    #[derive(Deserialize)]
    struct Row {
        #[serde(default)]
        additions: i64,
        #[serde(default)]
        deletions: i64,
        #[serde(default)]
        files: Vec<FileRow>,
    }
    let row: Row = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(GitHubPrDiff {
        head_oid: String::new(),
        additions: row.additions,
        deletions: row.deletions,
        files: row
            .files
            .into_iter()
            .map(|file| GitHubPrFile {
                path: file.path,
                additions: file.additions,
                deletions: file.deletions,
            })
            .collect(),
        patch: String::new(),
        truncated: false,
    })
}

fn parse_github_work_items(
    json: &str,
    kind: &str,
    repo: &str,
) -> Result<Vec<GitHubWorkItem>, String> {
    #[derive(Deserialize)]
    struct RowLabel {
        name: String,
        #[serde(default)]
        color: String,
    }
    #[derive(Deserialize)]
    struct RowAssignee {
        login: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        number: i64,
        title: String,
        url: String,
        state: String,
        #[serde(default)]
        state_reason: String,
        #[serde(default)]
        created_at: String,
        #[serde(default)]
        updated_at: String,
        #[serde(default)]
        labels: Vec<RowLabel>,
        #[serde(default)]
        assignees: Vec<RowAssignee>,
        #[serde(default)]
        is_draft: bool,
    }
    let rows: Vec<Row> = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| GitHubWorkItem {
            kind: kind.to_string(),
            number: row.number,
            title: row.title,
            url: row.url,
            state: row.state.to_lowercase(),
            state_reason: row.state_reason.to_lowercase(),
            created_at: row.created_at,
            updated_at: row.updated_at,
            labels: row
                .labels
                .into_iter()
                .map(|label| GitHubLabel {
                    name: label.name,
                    color: label.color,
                })
                .collect(),
            assignees: row
                .assignees
                .into_iter()
                .map(|assignee| GitHubAssignee {
                    avatar_url: github_avatar_url(&assignee.login),
                    login: assignee.login,
                })
                .collect(),
            draft: row.is_draft,
            repo: repo.to_string(),
        })
        .collect())
}

fn parse_github_work_item(json: &str, kind: &str, repo: &str) -> Result<GitHubWorkItem, String> {
    let wrapped = format!("[{json}]");
    parse_github_work_items(&wrapped, kind, repo)?
        .into_iter()
        .next()
        .ok_or_else(|| "GitHub did not return a work item".into())
}

fn parse_gh_pr_list(json: &str) -> Option<GitPr> {
    #[derive(Deserialize)]
    struct Row {
        number: i64,
        title: String,
        url: String,
        state: String,
    }
    let rows: Vec<Row> = serde_json::from_str(json).ok()?;
    let mut best: Option<GitPr> = None;
    for row in rows {
        let pr = GitPr {
            number: row.number,
            title: row.title,
            url: row.url,
            state: row.state.to_lowercase(),
        };
        if pr.state == "open" {
            return Some(pr);
        }
        if best.is_none() {
            best = Some(pr);
        }
    }
    best
}

fn git_pr_create_for(root: &Path, input: &GitPrCreateInput) -> Result<String, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Pull request title cannot be empty".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let body_path = std::env::temp_dir().join(format!("bycoda-pr-{stamp}.md"));
    std::fs::write(&body_path, input.body.trim()).map_err(|e| e.to_string())?;
    let result = gh_checked(
        root,
        &[
            "pr",
            "create",
            "--title",
            title,
            "--body-file",
            &body_path.to_string_lossy(),
            "--base",
            input.base.trim(),
            "--head",
            input.head.trim(),
        ],
    );
    let _ = std::fs::remove_file(&body_path);
    result.and_then(|output| {
        output
            .lines()
            .rev()
            .find(|line| line.starts_with("http://") || line.starts_with("https://"))
            .map(|line| line.trim().to_string())
            .ok_or_else(|| {
                if output.trim().is_empty() {
                    "gh returned no pull request URL".into()
                } else {
                    output
                }
            })
    })
}

fn gh_stdout(root: &Path, args: &[&str]) -> Option<String> {
    gh_run(root, args, false).ok()
}

pub(crate) fn gh_checked(root: &Path, args: &[&str]) -> Result<String, String> {
    gh_run(root, args, false)
}

fn gh_run(root: &Path, args: &[&str], allow_empty: bool) -> Result<String, String> {
    let program = crate::harness::resolve_gui_binary("gh")
        .ok_or_else(|| "GitHub CLI (`gh`) is not installed.".to_string())?;
    let mut cmd = Command::new(&program);
    cmd.current_dir(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat");
    crate::harness::apply_gui_env(&mut cmd);
    crate::hide_window_console(&mut cmd);
    let output = cmd.output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "GitHub CLI (`gh`) is not installed.".to_string()
        } else {
            error.to_string()
        }
    })?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            if allow_empty {
                return Ok(String::new());
            }
            return Err("gh returned no output".into());
        }
        return Ok(text);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("gh {} failed", args.join(" "))
    };
    Err(detail)
}

pub(crate) fn resolve_repo_path(root: &Path, relative: &str) -> Result<String, String> {
    // This is an operation argument, not a human-readable rename summary.
    // Keep whitespace, arrows and wildcard characters literal.
    let relative = if cfg!(windows) {
        relative.replace('\\', "/")
    } else {
        relative.to_owned()
    };
    if relative.is_empty()
        || relative.contains('\0')
        || relative.starts_with('/')
        || Path::new(&relative).is_absolute()
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == ".." || part.eq_ignore_ascii_case(".git"))
    {
        return Err("Invalid path".into());
    }
    let abs = root.join(&relative);
    if !abs.starts_with(root) {
        return Err("Invalid path".into());
    }
    // Validate the nearest existing ancestor too, including a deleted leaf.
    // Lexical containment alone permits a symlink/junction to another checkout.
    let canonical_root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut ancestor = abs.as_path();
    loop {
        match std::fs::symlink_metadata(ancestor) {
            Ok(_) => {
                let canonical = std::fs::canonicalize(ancestor).map_err(|e| e.to_string())?;
                if !canonical.starts_with(&canonical_root) {
                    return Err("Path is outside the checkout".into());
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ancestor = ancestor.parent().ok_or("Invalid path")?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(relative)
}

/// Git for Windows puts a launcher (`cmd\git.exe`) on PATH that sets up the
/// environment and then starts the real `mingw64\bin\git.exe`: two processes
/// per call, about twice the cost. The panels run git constantly, so the real
/// binary is resolved once and given the directories the launcher would add.
struct DirectGit {
    exe: PathBuf,
    path: std::ffi::OsString,
    msystem: &'static str,
}

/// The real git binary behind the launcher found in `dirs`, with the tool
/// directories it expects on PATH. `None` for any other layout.
fn direct_git_from(
    dirs: impl IntoIterator<Item = PathBuf>,
    is_file: impl Fn(&Path) -> bool,
) -> Option<(PathBuf, Vec<PathBuf>, &'static str)> {
    let launcher_dir = dirs.into_iter().find(|dir| is_file(&dir.join("git.exe")))?;
    if !launcher_dir
        .file_name()?
        .to_str()?
        .eq_ignore_ascii_case("cmd")
    {
        return None;
    }
    let base = launcher_dir.parent()?;
    [
        ("mingw64", "MINGW64"),
        ("clangarm64", "CLANGARM64"),
        ("mingw32", "MINGW32"),
    ]
    .into_iter()
    .find_map(|(arch, msystem)| {
        let bin = base.join(arch).join("bin");
        let exe = bin.join("git.exe");
        is_file(&exe).then(|| (exe, vec![bin, base.join("usr").join("bin")], msystem))
    })
}

fn direct_git() -> Option<&'static DirectGit> {
    static DIRECT_GIT: std::sync::OnceLock<Option<DirectGit>> = std::sync::OnceLock::new();
    DIRECT_GIT
        .get_or_init(|| {
            if !cfg!(windows) {
                return None;
            }
            let inherited = std::env::var_os("PATH")?;
            let (exe, mut dirs, msystem) =
                direct_git_from(std::env::split_paths(&inherited), |path| path.is_file())?;
            dirs.extend(std::env::split_paths(&inherited));
            Some(DirectGit {
                exe,
                path: std::env::join_paths(dirs).ok()?,
                msystem,
            })
        })
        .as_ref()
}

/// `git` as found on PATH: on Windows the launcher, which prepares the
/// environment hooks, signers and credential helpers run in.
fn git_launcher_cmd() -> Command {
    let mut cmd = Command::new("git");
    crate::hide_window_console(&mut cmd);
    cmd
}

pub(crate) fn git_cmd() -> Command {
    let Some(direct) = direct_git() else {
        let mut cmd = git_launcher_cmd();
        cmd.env("PATH", crate::harness::cached_gui_search_path());
        return cmd;
    };
    let mut cmd = Command::new(&direct.exe);
    cmd.env("PATH", &direct.path);
    if std::env::var_os("MSYSTEM").is_none() {
        cmd.env("MSYSTEM", direct.msystem);
    }
    crate::hide_window_console(&mut cmd);
    cmd
}

fn git_cmd_for_args_with_path(args: &[&str], gui_path: impl FnOnce() -> String) -> Command {
    if matches!(
        args.first().copied(),
        Some("commit" | "push" | "pull" | "fetch" | "clone")
    ) {
        // Signers, hooks, credential helpers, and git-lfs may need the login-shell PATH.
        let mut cmd = git_launcher_cmd();
        cmd.env("PATH", gui_path());
        return cmd;
    }
    git_cmd()
}

/// How long a push, pull or fetch may run before it is stopped. A stuck
/// credential helper would otherwise hold the Changes panel busy for good.
const GIT_NETWORK_TIMEOUT: Duration = Duration::from_secs(300);
const GIT_LOCAL_TIMEOUT: Duration = Duration::from_secs(120);

fn git_is_network_command(args: &[&str]) -> bool {
    matches!(args.first().copied(), Some("push" | "pull" | "fetch"))
}

/// `Command::output` with a deadline: the child is killed when it passes.
fn output_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
) -> std::io::Result<std::process::Output> {
    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    wait_with_timeout(child, timeout)
}

fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
) -> std::io::Result<std::process::Output> {
    // Drained on their own threads so a chatty child cannot fill a pipe and stall.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            let _ = sender.send(buf);
        });
        receiver
    };
    let stdout = drain(
        child
            .stdout
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
    );
    let stderr = drain(
        child
            .stderr
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                ErrorKind::TimedOut,
                format!(
                    "git did not finish within {} minutes and was stopped",
                    timeout.as_secs() / 60
                ),
            ));
        }
        thread::sleep(Duration::from_millis(25));
    };
    Ok(std::process::Output {
        status,
        stdout: receive_git_output(stdout, deadline)?,
        stderr: receive_git_output(stderr, deadline)?,
    })
}

fn receive_git_output(
    receiver: mpsc::Receiver<Vec<u8>>,
    deadline: Instant,
) -> std::io::Result<Vec<u8>> {
    // A credential/filter helper may keep inherited pipes open after Git exits.
    // The deadline covers output collection as well as the direct child.
    receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|error| {
            std::io::Error::new(
                ErrorKind::TimedOut,
                format!("Git output did not close before its deadline: {error}"),
            )
        })
}

fn git_cmd_for_args(args: &[&str]) -> Command {
    git_cmd_for_args_with_path(args, crate::harness::gui_search_path)
}

/// How long a git process is given to get going before the next may start.
const GIT_STARTUP_WINDOW: Duration = Duration::from_millis(200);

/// Lets one git process start at a time.
///
/// Process creation is hooked by security software on many Windows machines,
/// and there two processes created at the same moment can leave one of them
/// waiting about five seconds before it runs at all (measured with `cmd /c
/// exit` as much as with git). The panels ask for git from several threads at
/// once, so their processes are started one after another instead. A claim
/// lapses after `GIT_STARTUP_WINDOW`: a push or a long diff holds nobody up.
struct GitSpawnGate {
    holder: Mutex<Option<(u64, Instant)>>,
    freed: std::sync::Condvar,
    next: std::sync::atomic::AtomicU64,
}

static GIT_SPAWN_GATE: GitSpawnGate = GitSpawnGate {
    holder: Mutex::new(None),
    freed: std::sync::Condvar::new(),
    next: std::sync::atomic::AtomicU64::new(0),
};

struct GitSpawnTurn(Option<(&'static GitSpawnGate, u64)>);

impl GitSpawnGate {
    /// A turn at the shared gate; free of charge where creation does not stall.
    fn enter(&'static self) -> GitSpawnTurn {
        if cfg!(windows) {
            self.wait_turn()
        } else {
            GitSpawnTurn(None)
        }
    }

    fn enter_cancellable(&'static self, cancel: Option<&AtomicBool>) -> Option<GitSpawnTurn> {
        if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            return None;
        }
        if cfg!(windows) {
            self.wait_turn_cancellable(cancel)
        } else {
            Some(GitSpawnTurn(None))
        }
    }

    fn wait_turn(&'static self) -> GitSpawnTurn {
        self.wait_turn_cancellable(None)
            .unwrap_or(GitSpawnTurn(None))
    }

    fn wait_turn_cancellable(&'static self, cancel: Option<&AtomicBool>) -> Option<GitSpawnTurn> {
        let Ok(mut holder) = self.holder.lock() else {
            return Some(GitSpawnTurn(None));
        };
        while let Some((_, since)) = *holder {
            if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
                return None;
            }
            let Some(left) = GIT_STARTUP_WINDOW.checked_sub(since.elapsed()) else {
                break;
            };
            // A busy gate must not hide cancellation behind other Git callers.
            let wait = if cancel.is_some() {
                left.min(Duration::from_millis(50))
            } else {
                left
            };
            holder = match self.freed.wait_timeout(holder, wait) {
                Ok((holder, _)) => holder,
                Err(_) => return Some(GitSpawnTurn(None)),
            };
        }
        if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            return None;
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        *holder = Some((id, Instant::now()));
        Some(GitSpawnTurn(Some((self, id))))
    }
}

impl Drop for GitSpawnTurn {
    fn drop(&mut self) {
        let Some((gate, id)) = self.0 else { return };
        if let Ok(mut holder) = gate.holder.lock() {
            // A lapsed claim may already belong to the next process.
            if matches!(*holder, Some((held, _)) if held == id) {
                *holder = None;
                gate.freed.notify_one();
            }
        }
    }
}

/// `Command::output` for git, taking a turn at the spawn gate.
pub(crate) fn git_cmd_output(cmd: &mut Command) -> std::io::Result<std::process::Output> {
    let _turn = GIT_SPAWN_GATE.enter();
    cmd.env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    output_with_timeout(cmd, GIT_LOCAL_TIMEOUT)
}

pub(crate) fn git_checked(root: &Path, args: &[&str]) -> Result<(), String> {
    let command = args.iter().find(|arg| !arg.starts_with('-')).copied();
    if !matches!(command, Some("add" | "restore" | "rm")) {
        return git_checked_once(root, args);
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match git_checked_once(root, args) {
            Err(error) if is_index_lock_error(&error) && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(100));
            }
            result => return result,
        }
    }
}

fn is_index_lock_error(error: &str) -> bool {
    error.contains("index.lock") && error.contains("File exists")
}

fn git_checked_once(root: &Path, args: &[&str]) -> Result<(), String> {
    let mut cmd = git_cmd_for_args(args);
    cmd.arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    let _turn = GIT_SPAWN_GATE.enter();
    let output = if git_is_network_command(args) {
        output_with_timeout(&mut cmd, GIT_NETWORK_TIMEOUT)
    } else {
        output_with_timeout(&mut cmd, GIT_LOCAL_TIMEOUT)
    }
    .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let msg = stderr.trim();
    if !msg.is_empty() {
        return Err(msg.to_string());
    }
    let msg = stdout.trim();
    if !msg.is_empty() {
        return Err(msg.to_string());
    }
    Err(format!("git {} failed", args.join(" ")))
}

fn git_blob(root: &Path, spec: &str) -> Option<Vec<u8>> {
    git_output(root, &["cat-file", "-p", spec])
}

pub(crate) fn git_run(root: &Path, args: &[&str]) -> Option<String> {
    git_output(root, args).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub(crate) fn git_output(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = git_cmd_output(
        git_cmd_for_args(args)
            .arg("--no-pager")
            .arg("-C")
            .arg(root)
            .args(args)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0"),
    )
    .ok()?;
    if git_status_ok(&output.status, args) {
        return Some(output.stdout);
    }
    None
}

/// Queued 8 KiB chunks allowed between the git reader and the consumer.
///
/// `max_bytes` caps the buffer being built, not what the reader can run ahead:
/// with an unbounded channel a slow or descheduled consumer lets the reader
/// queue output with no limit at all. A small bound instead lets git's own
/// stdout pipe (16 KiB on macOS, 64 KiB on Linux) fill and stall the child, so
/// a read now holds `max_bytes` plus this queue, one scratch chunk, and the
/// kernel's pipe — not `max_bytes` alone.
///
/// Cancelling is unaffected: the receiver is dropped on return, which unblocks
/// a reader parked in `send`. A reader parked in `read` instead is a different
/// case, and `stop` explains why that one is left detached.
const GIT_OUTPUT_QUEUE_CHUNKS: usize = 16;

pub(crate) fn git_output_capped(
    root: &Path,
    args: &[&str],
    max_bytes: usize,
    cancel: Option<&AtomicBool>,
) -> Option<(Vec<u8>, bool)> {
    let mut child = git_cmd();
    let child = child
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let _turn = GIT_SPAWN_GATE.enter_cancellable(cancel)?;
    let mut child = child.spawn().ok()?;
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let (sender, receiver) = mpsc::sync_channel(GIT_OUTPUT_QUEUE_CHUNKS);
    let reader = thread::Builder::new()
        .name("git-output-reader".to_string())
        .spawn(move || {
            let mut chunk = vec![0u8; 8192];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) => {
                        let _ = sender.send(Ok(Vec::new()));
                        break;
                    }
                    Ok(read) => {
                        if sender.send(Ok(chunk[..read].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
                }
            }
        });
    let mut reader = match reader {
        Ok(reader) => Some(reader),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let stop = |child: &mut std::process::Child, reader: &mut Option<thread::JoinHandle<()>>| {
        let _ = child.kill();
        let _ = child.wait();
        // Dropping the handle detaches the reader. A killed git process can leave
        // a shell descendant holding the pipe, so joining here would re-block the
        // cancelled search until that unrelated descendant exits.
        reader.take();
    };

    let mut buf = Vec::new();
    loop {
        if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            stop(&mut child, &mut reader);
            return None;
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(chunk)) if chunk.is_empty() => break,
            Ok(Ok(chunk)) => {
                let remaining = max_bytes.saturating_sub(buf.len());
                if chunk.len() > remaining {
                    buf.extend_from_slice(&chunk[..remaining]);
                    stop(&mut child, &mut reader);
                    return Some((buf, true));
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(Err(_)) => {
                stop(&mut child, &mut reader);
                return None;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
                    stop(&mut child, &mut reader);
                    return None;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                stop(&mut child, &mut reader);
                return None;
            }
        }
    }
    let _ = reader.take().map(thread::JoinHandle::join);
    let status = child.wait().ok()?;
    if git_status_ok(&status, args) {
        Some((buf, false))
    } else {
        None
    }
}

fn git_status_ok(status: &std::process::ExitStatus, args: &[&str]) -> bool {
    status.success()
        || (status.code() == Some(1) && matches!(args.first().copied(), Some("diff" | "grep")))
}

fn git_branch(root: &Path) -> Option<String> {
    git_head_branch(root).or_else(|| git_stdout(root, &["rev-parse", "--short", "HEAD"]))
}

fn git_head_branch(root: &Path) -> Option<String> {
    git_stdout(root, &["symbolic-ref", "--short", "HEAD"]).filter(|branch| branch != "HEAD")
}

fn git_is_work_tree(root: &Path) -> bool {
    git_stdout(root, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true")
}

fn git_branches_for(root: &Path) -> GitBranches {
    // One listing names both kinds of ref and marks the checked-out branch:
    // the branch pickers reload this after every commit or checkout.
    let Some(listing) = git_run(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)\t%(HEAD)",
            "refs/heads",
            "refs/remotes",
        ],
    ) else {
        return GitBranches::default();
    };
    // No marked branch: HEAD is detached, or on a branch with no commit yet.
    let current_branch = listing
        .lines()
        .find_map(|line| {
            let (refname, head) = line.trim().split_once('\t')?;
            (head.trim() == "*")
                .then(|| refname.strip_prefix("refs/heads/"))
                .flatten()
                .map(str::to_string)
        })
        .or_else(|| git_head_branch(root));
    // Only a detached HEAD needs its sha.
    let head_sha = if current_branch.is_none() {
        git_stdout(root, &["rev-parse", "--short", "HEAD"])
    } else {
        None
    };
    let detached = current_branch.is_none() && head_sha.is_some();
    let current = current_branch.clone().or(head_sha);

    let mut branches = Vec::new();
    let mut local_names = HashSet::new();
    let mut remote_refs = Vec::new();
    for line in listing.lines() {
        let (refname, head) = line.trim().split_once('\t').unwrap_or((line.trim(), ""));
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            if name.is_empty() {
                continue;
            }
            local_names.insert(name.to_string());
            branches.push(GitBranchEntry {
                name: name.to_string(),
                current: head.trim() == "*",
                remote: None,
            });
        } else if let Some(full) = refname.strip_prefix("refs/remotes/") {
            remote_refs.push(full);
        }
    }

    if let Some(name) = &current_branch {
        if !local_names.contains(name) {
            local_names.insert(name.clone());
            branches.push(GitBranchEntry {
                name: name.clone(),
                current: true,
                remote: None,
            });
        }
    }

    for full in remote_refs {
        let Some((remote, name)) = full.split_once('/') else {
            continue;
        };
        if remote.is_empty() || name.is_empty() || name == "HEAD" || name.ends_with("/HEAD") {
            continue;
        }
        if local_names.contains(name) {
            continue;
        }
        branches.push(GitBranchEntry {
            name: name.to_string(),
            current: false,
            remote: Some(remote.to_string()),
        });
    }

    branches.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then(a.remote.is_some().cmp(&b.remote.is_some()))
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
            .then_with(|| a.remote.cmp(&b.remote))
    });

    GitBranches {
        current,
        detached,
        branches,
    }
}

fn git_checkout_for(root: &Path, name: &str, remote: Option<&str>) -> Result<String, String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let name = git_branch_name(root, name)?;
    if let Some(remote) = remote.map(str::trim).filter(|value| !value.is_empty()) {
        if git_head_branch(root).as_deref() == Some(name.as_str()) {
            return Ok(name);
        }
        git_switch(root, &["checkout", "--track", &format!("{remote}/{name}")])?;
        return Ok(name);
    }
    if git_head_branch(root).as_deref() == Some(name.as_str()) {
        return Ok(name);
    }
    if git_ref_exists(root, &format!("refs/heads/{name}")) {
        git_switch(root, &["checkout", &name])?;
        return Ok(name);
    }
    if let Some(remote) = git_remote_name(root) {
        let spec = format!("refs/remotes/{remote}/{name}");
        if git_ref_exists(root, &spec) {
            git_switch(root, &["checkout", "--track", &format!("{remote}/{name}")])?;
            return Ok(name);
        }
    }
    Err(format!("Branch {name} not found"))
}

fn git_create_branch_for(root: &Path, name: &str) -> Result<String, String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let name = git_branch_name(root, name)?;
    if git_ref_exists(root, &format!("refs/heads/{name}"))
        || git_head_branch(root).as_deref() == Some(name.as_str())
    {
        return Err(format!("Branch {name} already exists"));
    }
    git_switch(root, &["checkout", "-b", &name])?;
    Ok(name)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GitStashMode {
    Tracked,
    IncludeUntracked,
    Staged,
}

fn git_stash_for(root: &Path, message: Option<&str>, mode: GitStashMode) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let mut args = vec!["stash", "push"];
    match mode {
        GitStashMode::Tracked => {}
        GitStashMode::IncludeUntracked => args.push("--include-untracked"),
        GitStashMode::Staged => args.push("--staged"),
    }
    if let Some(message) = message.map(str::trim).filter(|value| !value.is_empty()) {
        args.extend(["-m", message]);
    }
    git_checked(root, &args)
}

fn git_stash_clear_for(root: &Path) -> Result<(), String> {
    git_work_tree_checked(root)?;
    git_checked(root, &["stash", "clear"])
}

/// A commit id from the UI. Hex only, so it can never be read as an option.
fn git_commit_arg(sha: &str) -> Result<&str, String> {
    let sha = sha.trim();
    if (4..=64).contains(&sha.len()) && sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(sha)
    } else {
        Err("Invalid commit".into())
    }
}

fn git_work_tree_checked(root: &Path) -> Result<(), String> {
    if git_is_work_tree(root) {
        Ok(())
    } else {
        Err("Not a git repository".into())
    }
}

fn git_checkout_commit_for(root: &Path, sha: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    git_switch(root, &["checkout", "--detach", git_commit_arg(sha)?])
}

fn git_create_branch_at_for(root: &Path, name: &str, sha: &str) -> Result<String, String> {
    git_work_tree_checked(root)?;
    let sha = git_commit_arg(sha)?;
    let name = git_branch_name(root, name)?;
    if git_ref_exists(root, &format!("refs/heads/{name}")) {
        return Err(format!("Branch {name} already exists"));
    }
    git_switch(root, &["checkout", "-b", &name, sha])?;
    Ok(name)
}

/// A tag name from the UI that git accepts and cannot be read as an option.
fn git_tag_name(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Tag name cannot be empty".into());
    }
    let full = format!("refs/tags/{name}");
    if name.starts_with('-') || git_checked(root, &["check-ref-format", &full]).is_err() {
        return Err(format!("{name} is not a valid tag name"));
    }
    Ok(name.to_string())
}

fn git_create_tag_for(root: &Path, name: &str, sha: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let sha = git_commit_arg(sha)?;
    let name = git_tag_name(root, name)?;
    if git_ref_exists(root, &format!("refs/tags/{name}")) {
        return Err(format!("Tag {name} already exists"));
    }
    git_checked(root, &["tag", &name, sha])
}

fn git_tags_for(root: &Path) -> Vec<String> {
    git_run(
        root,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:lstrip=2)",
            "refs/tags",
        ],
    )
    .unwrap_or_default()
    .lines()
    .map(str::trim)
    .filter(|line| !line.is_empty())
    .map(str::to_string)
    .collect()
}

fn git_delete_tag_for(root: &Path, name: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let name = git_tag_name(root, name)?;
    if !git_ref_exists(root, &format!("refs/tags/{name}")) {
        return Err(format!("Tag {name} does not exist"));
    }
    git_checked(root, &["tag", "-d", &name])
}

/// A new remote's name: one word, not an option, valid in `refs/remotes/`.
fn git_remote_name_arg(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Remote name cannot be empty".into());
    }
    let valid = !name.starts_with('-')
        && !name.chars().any(|c| c.is_whitespace() || c.is_control())
        && git_checked(root, &["check-ref-format", &format!("refs/remotes/{name}")]).is_ok();
    if valid {
        Ok(name.to_string())
    } else {
        Err(format!("{name} is not a valid remote name"))
    }
}

/// An existing remote's name from the UI, checked against `git remote`.
fn git_known_remote(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.starts_with('-') || !git_remote_names(root).iter().any(|known| known == name) {
        return Err(format!("Remote {name} does not exist"));
    }
    Ok(name.to_string())
}

fn git_remotes_for(root: &Path) -> Vec<GitRemote> {
    git_run(root, &["remote", "-v"])
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once('\t')?;
            let url = rest.trim().strip_suffix("(fetch)")?.trim();
            Some(GitRemote {
                name: name.trim().to_string(),
                url: url.to_string(),
            })
        })
        .collect()
}

fn git_remote_add_for(root: &Path, name: &str, url: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let name = git_remote_name_arg(root, name)?;
    let url = url.trim();
    if url.is_empty() {
        return Err("Remote URL cannot be empty".into());
    }
    if url.starts_with('-') || url.chars().any(char::is_control) {
        return Err("Invalid remote URL".into());
    }
    if git_remote_names(root).contains(&name) {
        return Err(format!("Remote {name} already exists"));
    }
    git_checked(root, &["remote", "add", &name, url])
}

fn git_remote_remove_for(root: &Path, name: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let name = git_known_remote(root, name)?;
    git_checked(root, &["remote", "remove", &name])
}

fn git_cherry_pick_for(root: &Path, sha: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    git_checked(root, &["cherry-pick", git_commit_arg(sha)?])
}

fn git_revert_for(root: &Path, sha: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    git_checked(root, &["revert", "--no-edit", git_commit_arg(sha)?])
}

fn git_reset_for(root: &Path, sha: &str, mode: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err("Invalid reset mode".into()),
    };
    git_checked(root, &["reset", flag, git_commit_arg(sha)?])
}

fn git_dir_has(root: &Path, name: &str) -> bool {
    if let Some(dir) = find_git_dir(root) {
        return dir.join(name).exists();
    }
    git_stdout(root, &["rev-parse", "--git-path", name])
        .map(|path| root.join(path).exists())
        .unwrap_or(false)
}

pub(crate) fn git_operation_state_for(root: &Path) -> Option<&'static str> {
    // Rebase first: a rebase that stops on a conflict also leaves CHERRY_PICK_HEAD.
    if git_dir_has(root, "rebase-merge") || git_dir_has(root, "rebase-apply") {
        Some("rebase")
    } else if git_dir_has(root, "CHERRY_PICK_HEAD") {
        Some("cherry-pick")
    } else if git_dir_has(root, "REVERT_HEAD") {
        Some("revert")
    } else if git_dir_has(root, "MERGE_HEAD") {
        Some("merge")
    } else {
        None
    }
}

pub(crate) fn git_operation_abort_for(root: &Path) -> Result<(), String> {
    match git_operation_state_for(root) {
        Some(operation) => git_checked(root, &[operation, "--abort"]),
        None => Err("No operation in progress".into()),
    }
}

pub(crate) fn git_operation_continue_for(root: &Path) -> Result<(), String> {
    // `core.editor=true` accepts the prepared message instead of opening an editor.
    let Some(operation) = git_operation_state_for(root) else {
        return Err("No operation in progress".into());
    };
    let conflicts = git_unmerged_checked_for(root)?;
    if !conflicts.is_empty() {
        return Err(unmerged_message(&conflicts));
    }
    let result = match operation {
        "merge" => git_checked(root, &["-c", "core.editor=true", "commit", "--no-edit"]),
        _ => git_checked(root, &["-c", "core.editor=true", operation, "--continue"]),
    };
    // A rebase (or a multi-commit pick) that reaches a conflicting commit exits
    // non-zero but is working: the panel then shows the next conflicts.
    match result {
        Err(_) if git_operation_state_for(root).is_some() && !git_unmerged_for(root).is_empty() => {
            Ok(())
        }
        other => other,
    }
}

/// A local or remote branch named by the UI, safe to pass as a revision.
fn git_branch_ref_arg(root: &Path, reference: &str) -> Result<String, String> {
    let reference = reference.trim();
    if reference.is_empty() || reference.starts_with('-') {
        return Err("Invalid branch".into());
    }
    for qualified in [
        format!("refs/heads/{reference}"),
        format!("refs/remotes/{reference}"),
    ] {
        if git_ref_exists(root, &qualified) {
            return Ok(qualified);
        }
    }
    Err(format!("Branch {reference} does not exist"))
}

fn git_delete_branch_for(root: &Path, name: &str, force: bool) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let name = git_branch_name(root, name)?;
    if git_head_branch(root).as_deref() == Some(name.as_str()) {
        return Err("Cannot delete the current branch".into());
    }
    git_checked(root, &["branch", if force { "-D" } else { "-d" }, &name])
}

fn git_rename_branch_for(root: &Path, from: &str, to: &str) -> Result<String, String> {
    git_work_tree_checked(root)?;
    let from = git_branch_name(root, from)?;
    let to = git_branch_name(root, to)?;
    if git_ref_exists(root, &format!("refs/heads/{to}")) {
        return Err(format!("Branch {to} already exists"));
    }
    git_checked(root, &["branch", "-m", &from, &to])?;
    Ok(to)
}

fn git_merge_for(root: &Path, reference: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let reference = git_branch_ref_arg(root, reference)?;
    git_checked(root, &["merge", "--no-edit", &reference])
}

fn git_rebase_for(root: &Path, reference: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let reference = git_branch_ref_arg(root, reference)?;
    git_checked(root, &["rebase", &reference])
}

fn git_fetch_for(root: &Path, prune: bool) -> Result<(), String> {
    git_work_tree_checked(root)?;
    if git_remote_names(root).is_empty() {
        return Err("No git remote to fetch from".into());
    }
    // Explicit either way: a user's `fetch.prune` config must not decide this.
    let prune = if prune { "--prune" } else { "--no-prune" };
    git_checked(root, &["fetch", "--all", prune])
}

fn git_create_branch_from_for(root: &Path, name: &str, reference: &str) -> Result<String, String> {
    git_work_tree_checked(root)?;
    let name = git_branch_name(root, name)?;
    let reference = git_branch_ref_arg(root, reference)?;
    if git_ref_exists(root, &format!("refs/heads/{name}")) {
        return Err(format!("Branch {name} already exists"));
    }
    git_switch(root, &["checkout", "-b", &name, &reference])?;
    Ok(name)
}

fn git_delete_remote_branch_for(root: &Path, remote: &str, name: &str) -> Result<(), String> {
    git_work_tree_checked(root)?;
    let remote = git_known_remote(root, remote)?;
    let name = name.trim();
    // `--branch` also expands `@{-1}`; only accept a plain, already-normal name.
    if name.starts_with('-') || git_branch_name(root, name)? != name {
        return Err(format!("'{name}' is not a valid branch name"));
    }
    git_checked(root, &["push", &remote, "--delete", name])
}

#[cfg(test)]
fn git_stash_list_for(root: &Path) -> Vec<GitStashEntry> {
    git_stash_list_checked(root).unwrap_or_default()
}

fn git_stash_list_checked(root: &Path) -> Result<Vec<GitStashEntry>, String> {
    let Some(text) = git_run(
        root,
        &["stash", "list", "--format=%gd%x00%H%x00%gs%x00%ct%x1e"],
    ) else {
        return match git_checked(root, &["rev-parse", "--is-inside-work-tree"]) {
            Err(error) if error.to_lowercase().contains("not a git repository") => Ok(Vec::new()),
            Err(error) => Err(error),
            Ok(()) => Err("Could not read Git stashes. Check repository access and retry.".into()),
        };
    };
    Ok(text
        .split('\u{1e}')
        .filter_map(|record| {
            let mut fields = record.trim().split('\0');
            let index = fields
                .next()?
                .strip_prefix("stash@{")?
                .strip_suffix('}')?
                .parse()
                .ok()?;
            Some(GitStashEntry {
                index,
                sha: fields.next()?.to_string(),
                message: fields.next()?.to_string(),
                timestamp: fields.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            })
        })
        .collect())
}

fn git_stash_action_for(
    root: &Path,
    action: &str,
    index: u32,
    expected_sha: &str,
) -> Result<(), String> {
    git_work_tree_checked(root)?;
    if !matches!(action, "apply" | "pop" | "drop") {
        return Err("Invalid stash action".into());
    }
    if !matches!(expected_sha.len(), 40 | 64)
        || !expected_sha.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Expected stash SHA is required".into());
    }
    let selector = format!("stash@{{{index}}}");
    let check = || {
        if git_run(root, &["rev-parse", "--verify", &selector])
            .map(|s| s.trim().to_string())
            .as_deref()
            != Some(expected_sha)
        {
            Err("Stash list changed; refresh and select the stash again".to_string())
        } else {
            Ok(())
        }
    };
    check()?;
    if action != "drop" {
        git_checked(root, &["stash", "apply", expected_sha])?;
    }
    if action != "apply" {
        check()?;
        git_checked(root, &["stash", "drop", &selector])?;
    }
    Ok(())
}

pub(crate) fn git_conflicts_for(root: &Path) -> Vec<String> {
    git_run(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--name-only",
            "--relative",
            "--diff-filter=U",
        ],
    )
    .unwrap_or_default()
    .lines()
    .map(str::trim)
    .filter(|line| !line.is_empty())
    .map(str::to_string)
    .collect()
}

pub(crate) fn git_resolve_conflict_for(
    root: &Path,
    relative: &str,
    side: &str,
) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    let bit = side_stage(side)?;
    let stages = unmerged_stages_for(root, &relative);
    if stages == 0 {
        return Err("This file has no merge conflict".into());
    }
    // `checkout --ours/--theirs` fails when that side deleted the file; taking
    // the deletion is `git rm`.
    if !stage_has_side(stages, bit) {
        return git_checked(root, &["--literal-pathspecs", "rm", "-f", "--", &relative]);
    }
    let flag = if side == "ours" { "--ours" } else { "--theirs" };
    git_checked(
        root,
        &["--literal-pathspecs", "checkout", flag, "--", &relative],
    )?;
    git_checked(root, &["--literal-pathspecs", "add", "--", &relative])
}

fn git_file_history_for(
    root: &Path,
    relative: &str,
    limit: Option<u32>,
) -> Result<Vec<GitHistoryCommit>, String> {
    git_work_tree_checked(root)?;
    let relative = resolve_repo_path(root, relative)?;
    let count = limit
        .unwrap_or(GIT_HISTORY_DEFAULT)
        .clamp(1, GIT_HISTORY_MAX)
        .to_string();
    let head = git_stdout(root, &["rev-parse", "HEAD"]);
    let remotes = git_remote_names(root);
    let text = git_run(
        root,
        &[
            "--literal-pathspecs",
            "log",
            "--follow",
            "--decorate=short",
            "--max-count",
            &count,
            "--format=%H%x00%h%x00%P%x00%an%x00%at%x00%D%x00%s%x1e",
            "--",
            &relative,
        ],
    )
    .unwrap_or_default();
    Ok(parse_git_history_log(&text, head.as_deref(), &remotes))
}

#[cfg(test)]
fn git_blame_for(root: &Path, relative: &str) -> Result<Vec<GitBlameLine>, String> {
    git_blame_at_for(root, relative, None)
}

fn git_commit_message_for(root: &Path, sha: &str) -> Result<String, String> {
    git_work_tree_checked(root)?;
    let revision = format!("{}^{{commit}}", git_commit_arg(sha)?);
    git_stdout(root, &["show", "-s", "--format=%B", &revision, "--"])
        .ok_or_else(|| "Could not read commit message".to_string())
}

fn git_blame_at_for(
    root: &Path,
    relative: &str,
    sha: Option<&str>,
) -> Result<Vec<GitBlameLine>, String> {
    git_work_tree_checked(root)?;
    let relative = resolve_repo_path(root, relative)?;
    let mut args = vec!["--literal-pathspecs", "blame", "--line-porcelain"];
    if let Some(sha) = sha {
        args.push(git_commit_arg(sha)?);
    }
    args.extend(["--", &relative]);
    let text = git_run(root, &args).ok_or_else(|| "Could not blame this file".to_string())?;
    Ok(parse_git_blame(&text))
}

fn parse_git_blame(text: &str) -> Vec<GitBlameLine> {
    let mut lines = Vec::new();
    let mut current: Option<GitBlameLine> = None;
    for line in text.lines() {
        // The source line itself, tab-prefixed, closes each record.
        if line.starts_with('\t') {
            lines.extend(current.take());
            continue;
        }
        if let Some(entry) = current.as_mut() {
            if let Some(value) = line.strip_prefix("author ") {
                entry.author = value.to_string();
            } else if let Some(value) = line.strip_prefix("author-time ") {
                entry.timestamp = value.parse().unwrap_or(0);
            } else if let Some(value) = line.strip_prefix("summary ") {
                entry.summary = value.to_string();
            }
            continue;
        }
        let mut parts = line.split(' ');
        let (Some(sha), Some(_), Some(number)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        current = Some(GitBlameLine {
            line: number.parse().unwrap_or(0),
            sha: sha.to_string(),
            short_sha: sha.chars().take(7).collect(),
            author: String::new(),
            timestamp: 0,
            summary: String::new(),
        });
    }
    lines
}

fn git_switch(root: &Path, args: &[&str]) -> Result<(), String> {
    git_checked(root, args).map_err(map_local_changes_err)
}

fn map_local_changes_err(err: String) -> String {
    if checkout_blocked_by_changes(&err) {
        "Your local changes would be overwritten. Commit or stash them first.".into()
    } else {
        err
    }
}

fn checkout_blocked_by_changes(err: &str) -> bool {
    let text = err.to_ascii_lowercase();
    text.contains("would be overwritten")
        || text.contains("commit your changes or stash")
        || text.contains("please move or remove them before")
}

fn git_branch_name(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".into());
    }
    let output = git_cmd_output(
        git_cmd()
            .arg("-C")
            .arg(root)
            .args(["check-ref-format", "--branch", name])
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0"),
    )
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("'{name}' is not a valid branch name"));
    }
    let normalized = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if normalized.is_empty() {
        return Err(format!("'{name}' is not a valid branch name"));
    }
    Ok(normalized)
}

fn git_origin_repo(root: &Path) -> Option<String> {
    git_url_repo_name(&git_stdout(root, &["remote", "get-url", "origin"])?)
}

#[derive(Default, Clone)]
struct GitSync {
    remote: Option<String>,
    upstream: Option<String>,
    default_branch: Option<String>,
    ahead: i64,
    behind: i64,
    ahead_of_default: i64,
    head_pushed: bool,
}

/// Everything `git_sync_uncached` depends on: HEAD and its upstream as `git
/// status` reported them, and when the remote-tracking refs last changed.
#[derive(Clone, PartialEq, Eq)]
struct GitSyncKey {
    oid: Option<String>,
    head: Option<String>,
    upstream: Option<String>,
    ahead_behind: Option<(i64, i64)>,
    refs: GitRefsStamp,
}

/// Modification times of what a fetch, push or remote edit writes, plus the
/// count and newest time of the loose remote-tracking refs.
type GitRefsStamp = Option<([Option<SystemTime>; 3], usize, Option<SystemTime>)>;

fn git_refs_stamp(root: &Path) -> GitRefsStamp {
    let git_dir = find_git_dir(root)?;
    // A linked worktree keeps refs and config in the main repository.
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|text| git_dir.join(text.trim()))
        .unwrap_or_else(|| git_dir.clone());
    let modified = |path: PathBuf| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
    };
    let mut count = 0usize;
    let mut newest = None;
    let mut pending = vec![common.join("refs").join("remotes")];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                pending.push(entry.path());
                continue;
            }
            count += 1;
            newest = newest.max(meta.modified().ok());
        }
    }
    Some((
        [
            modified(common.join("packed-refs")),
            modified(common.join("config")),
            modified(git_dir.join("FETCH_HEAD")),
        ],
        count,
        newest,
    ))
}

/// The remote lookups cost four to six git processes and their answer only
/// moves with HEAD or the remote-tracking refs, so the 2 s index poll reuses
/// it. The age limit covers a ref change the stamp cannot see.
const GIT_SYNC_TTL: Duration = Duration::from_secs(60);

type GitSyncCached = (Instant, GitSyncKey, GitSync);

static GIT_SYNC_CACHE: Mutex<Option<HashMap<PathBuf, GitSyncCached>>> = Mutex::new(None);

fn git_sync_for(root: &Path, status: &StatusSnapshot) -> GitSync {
    let key = GitSyncKey {
        oid: status.oid.clone(),
        head: status.head.clone(),
        upstream: status.upstream.clone(),
        ahead_behind: status.ahead_behind,
        refs: git_refs_stamp(root),
    };
    if let Ok(guard) = GIT_SYNC_CACHE.lock() {
        if let Some((at, cached, sync)) = guard.as_ref().and_then(|cache| cache.get(root)) {
            if *cached == key && at.elapsed() < GIT_SYNC_TTL {
                return sync.clone();
            }
        }
    }
    let sync = git_sync_uncached(root, status);
    if let Ok(mut guard) = GIT_SYNC_CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), (Instant::now(), key, sync.clone()));
    }
    sync
}

fn git_sync_uncached(root: &Path, status: &StatusSnapshot) -> GitSync {
    let remote = git_remote_name(root);
    // `git status` names a configured upstream even after its ref is deleted,
    // and then reports no ahead/behind counts for it.
    let upstream = status.ahead_behind.and_then(|_| status.upstream.clone());
    let default_branch = git_default_branch(root, remote.as_deref());
    let default_ref = match (&remote, &default_branch) {
        (Some(remote), Some(branch)) => Some(format!("{remote}/{branch}")),
        _ => None,
    };
    let (ahead, behind) = if let Some(counts) = status.ahead_behind {
        counts
    } else if let Some(base) = default_ref.as_deref() {
        git_ahead_behind(root, base)
    } else {
        (0, 0)
    };
    let ahead_of_default = if let Some(base) = default_ref.as_deref() {
        git_ahead_behind(root, base).0
    } else {
        ahead
    };
    let head_pushed = git_stdout(
        root,
        &[
            "for-each-ref",
            "--count=1",
            "--contains",
            "HEAD",
            "refs/remotes",
        ],
    )
    .is_some();
    GitSync {
        remote,
        upstream,
        default_branch,
        ahead,
        behind,
        ahead_of_default,
        head_pushed,
    }
}

fn git_remote_name(root: &Path) -> Option<String> {
    let remotes = git_stdout(root, &["remote"])?;
    let mut names = remotes
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let first = names.next()?.to_string();
    if first == "origin" || names.any(|name| name == "origin") {
        return Some("origin".into());
    }
    Some(first)
}

fn git_default_branch(root: &Path, remote: Option<&str>) -> Option<String> {
    if let Some(remote) = remote {
        if let Some(head) = git_stdout(
            root,
            &[
                "symbolic-ref",
                "--short",
                &format!("refs/remotes/{remote}/HEAD"),
            ],
        ) {
            if let Some((_, name)) = head.split_once('/') {
                return Some(name.to_string());
            }
            return Some(head);
        }
        for name in ["main", "master"] {
            if git_ref_exists(root, &format!("refs/remotes/{remote}/{name}")) {
                return Some(name.to_string());
            }
        }
    }
    for name in ["main", "master"] {
        if git_ref_exists(root, &format!("refs/heads/{name}")) {
            return Some(name.to_string());
        }
    }
    None
}

fn git_ref_exists(root: &Path, spec: &str) -> bool {
    git_output(root, &["show-ref", "--verify", "--quiet", spec]).is_some()
}

fn git_ahead_behind(root: &Path, base: &str) -> (i64, i64) {
    let spec = format!("{base}...HEAD");
    let Some(text) = git_stdout(root, &["rev-list", "--left-right", "--count", &spec]) else {
        return (0, 0);
    };
    let mut parts = text.split_whitespace();
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn git_stdout(root: &Path, args: &[&str]) -> Option<String> {
    let output = git_cmd_output(git_cmd().arg("-C").arg(root).args(args)).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// When a file walk should stop early.
///
/// The flag variant is what a search uses. `AfterEntries` exists so the
/// per-entry check can be tested without a thread and a sleep: setting the flag
/// from outside only proves the walk stops *somewhere*, which the up-front
/// check would satisfy on its own, and timing a real cancellation is flaky on
/// loaded CI.
#[derive(Clone, Copy)]
enum WalkStop<'a> {
    Never,
    Flag(&'a AtomicBool),
    #[cfg(test)]
    AfterEntries(usize),
}

impl<'a> WalkStop<'a> {
    fn stopped(&self, _entries: usize) -> bool {
        match self {
            WalkStop::Never => false,
            WalkStop::Flag(flag) => flag.load(Ordering::Acquire),
            #[cfg(test)]
            WalkStop::AfterEntries(limit) => _entries >= *limit,
        }
    }
}

impl<'a> From<Option<&'a AtomicBool>> for WalkStop<'a> {
    fn from(cancel: Option<&'a AtomicBool>) -> Self {
        match cancel {
            Some(flag) => WalkStop::Flag(flag),
            None => WalkStop::Never,
        }
    }
}

fn walk_project_files(root: &Path, stop: WalkStop<'_>) -> Vec<ProjectFile> {
    let ignore = Ignore::load(root);
    let mut files = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    let mut visited = 0usize;
    let mut seen = 0usize;

    while let Some(dir) = dirs.pop() {
        if stop.stopped(seen) {
            break;
        }
        visited += 1;
        if visited > MAX_WALK_DIRS || files.len() >= MAX_PROJECT_FILES {
            break;
        }
        let Ok(reader) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in reader {
            seen += 1;
            if stop.stopped(seen) {
                return files;
            }
            let Ok(ent) = ent else { continue };
            let name = ent.file_name();
            let Some(name) = name.to_str() else { continue };
            if name == ".DS_Store" {
                continue;
            }
            let path = ent.path();
            let is_dir = match ent.file_type() {
                Ok(t) if t.is_symlink() => continue,
                Ok(t) => t.is_dir(),
                Err(_) => path.is_dir(),
            };
            if is_dir {
                if skip_walk_dir_name(name) || ignore.matches(name) || is_private_dir(&path) {
                    continue;
                }
                dirs.push(path);
                continue;
            }
            if ignore.matches(name) {
                continue;
            }
            let Ok(relative) = path.strip_prefix(root) else {
                continue;
            };
            let relative = path_to_js(relative);
            files.push(ProjectFile {
                name: name.to_string(),
                path: path_to_js(&path),
                relative,
            });
            if files.len() >= MAX_PROJECT_FILES {
                break;
            }
        }
    }
    files
}

fn skip_walk_dir_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | ".next"
            | ".nuxt"
            | ".output"
            | ".cache"
            | ".turbo"
            | ".parcel-cache"
            | ".vercel"
            | ".svelte-kit"
            | "coverage"
            | "__pycache__"
            | ".venv"
            | "venv"
            | ".tox"
            | ".mypy_cache"
            | ".pytest_cache"
            | ".gradle"
            | ".idea"
            | "Pods"
            | "vendor"
            | "bower_components"
            | ".yarn"
            | ".pnpm-store"
    )
}

fn path_has_skipped_dir(relative: &str) -> bool {
    relative
        .split(std::path::is_separator)
        .any(skip_walk_dir_name)
}

/// Directories the OS guards behind a consent prompt. macOS pops "would like to
/// access data from other apps" the first time a process reads another app's
/// container, and the grant is per-folder — so a walk that brushes past a few of
/// them prompts again on every launch. Nothing in here is a user project, so the
/// indexer treats them as if they did not exist.
fn is_private_dir(path: &Path) -> bool {
    if path.extension().is_some_and(|ext| ext == "app") {
        return true;
    }
    if !cfg!(target_os = "macos") {
        return false;
    }
    let guarded = [
        dirs_home().map(|home| PathBuf::from(home).join("Library")),
        dirs_home().map(|home| PathBuf::from(home).join(".Trash")),
        Some(PathBuf::from("/Library")),
        Some(PathBuf::from("/System")),
    ];
    guarded
        .iter()
        .flatten()
        .any(|guarded| path == guarded.as_path())
}

/// Roots too broad to index. Walking a home or volume root is never useful for
/// Quick Open — it buries project files under tens of thousands of dotfiles and
/// caches — and it is the one thing guaranteed to reach a private dir.
fn is_indexable_root(root: &Path) -> bool {
    if is_private_dir(root) {
        return false;
    }
    if root.parent().is_none() {
        return false;
    }
    let too_broad = [
        dirs_home().map(PathBuf::from),
        Some(PathBuf::from("/Users")),
        Some(PathBuf::from("/Applications")),
        Some(PathBuf::from("/Volumes")),
        Some(PathBuf::from("/home")),
    ];
    !too_broad
        .iter()
        .flatten()
        .any(|broad| root == broad.as_path())
}

fn resolve_under(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if name.starts_with('/') || name.starts_with('\\') {
        return Err("A file or folder name cannot start with a slash.".into());
    }

    let trimmed = name.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() || trimmed.chars().all(char::is_whitespace) {
        return Err("A file or folder name must be provided.".into());
    }

    let mut dest = parent.to_path_buf();
    for segment in trimmed.split(['/', '\\']) {
        if segment.is_empty() {
            continue;
        }
        if segment == "." || segment == ".." || segment.len() > 255 {
            return Err(format!(
                "The name {trimmed} is not valid as a file or folder name. Please choose a different name."
            ));
        }
        dest.push(segment);
    }

    if !dest.starts_with(parent) {
        return Err("Invalid path".into());
    }
    Ok(dest)
}

fn file_label(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(fallback)
        .to_string()
}

fn already_exists(label: &str) -> String {
    format!(
        "A file or folder {label} already exists at this location. Please choose a different name."
    )
}

/// Create a file or folder under `parent`. `name` may contain `/` or `\` to
/// nest. Returns the created path.
#[tauri::command(async)]
pub fn create_path(
    app: AppHandle,
    parent: String,
    name: String,
    is_dir: bool,
) -> Result<String, String> {
    let parent_dir = expand_home(&parent);
    let dest = resolve_under(&parent_dir, &name)?;
    crate::file_access::require(&app, &dest, true)?;
    let label = file_label(&dest, &name);

    if dest.exists() {
        return Err(already_exists(&label));
    }

    if is_dir {
        std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    } else {
        if let Some(dir) = dest.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::File::create_new(&dest).map_err(|e| {
            if e.kind() == ErrorKind::AlreadyExists {
                already_exists(&label)
            } else {
                e.to_string()
            }
        })?;
    }

    Ok(dest.to_string_lossy().into_owned())
}

pub(crate) fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return dirs_home()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(path));
    }
    let rest = path.strip_prefix("~/").or_else(|| {
        if cfg!(windows) {
            path.strip_prefix("~\\")
        } else {
            None
        }
    });
    if let Some(rest) = rest {
        if let Some(home) = dirs_home() {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

pub(crate) fn path_to_js(path: &Path) -> String {
    let text = path.to_string_lossy();
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

#[cfg(all(test, unix))]
#[test]
fn preserves_unix_backslash_filenames() {
    assert_eq!(path_to_js(Path::new(r"/tmp/a\b.txt")), r"/tmp/a\b.txt");
    assert_eq!(expand_home(r"~\literal"), PathBuf::from(r"~\literal"));
}

/// Name-only `.gitignore` subset for directories outside a git repository.
/// Inside a repository `git check-ignore` is the source of truth.
struct Ignore {
    exact: HashSet<String>,
    suffixes: Vec<String>,
}

impl Ignore {
    fn load(from: &Path) -> Self {
        let mut exact = HashSet::from([".git".into()]);
        let mut suffixes = Vec::new();
        let root = project_root(from);
        if let Ok(text) = std::fs::read_to_string(root.join(".gitignore")) {
            for raw in text.lines() {
                let line = raw.trim();
                if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
                    continue;
                }
                let line = line.trim_end_matches('/');
                if line.contains('/') {
                    continue;
                }
                if let Some(ext) = line.strip_prefix("*.") {
                    if !ext.is_empty() && !ext.contains('*') {
                        suffixes.push(format!(".{ext}"));
                    }
                    continue;
                }
                exact.insert(line.to_string());
            }
        }
        Self { exact, suffixes }
    }

    fn matches(&self, name: &str) -> bool {
        self.exact.contains(name) || self.suffixes.iter().any(|s| name.ends_with(s))
    }
}

fn project_root(start: &Path) -> PathBuf {
    let mut dir = start;
    loop {
        if dir.join(".git").exists() || dir.join(".gitignore").exists() {
            return dir.to_path_buf();
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return start.to_path_buf(),
        }
    }
}

/// Clone `url` into `parent`/`<repo-name>` and return the new directory.
#[tauri::command]
pub async fn clone_repo(url: String, parent: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || clone_repo_sync(&url, &parent))
        .await
        .map_err(|e| e.to_string())?
}

fn clone_repo_sync(url: &str, parent: &str) -> Result<String, String> {
    let url = url.trim();
    if !is_git_url(url) {
        return Err("Enter an https, ssh, or git URL".into());
    }
    let name = repo_name(url)?;
    let dest = expand_home(parent).join(&name);
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    let dest_str = dest.to_str().ok_or("Invalid destination path")?;
    let output = git_cmd_for_args(&["clone"])
        .args(["clone", "--", url, dest_str])
        .output()
        .map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                "git is not installed".into()
            } else {
                format!("git clone failed: {e}")
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("git clone failed");
        return Err(msg.trim().to_string());
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn is_git_url(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("git@")
        || url.starts_with("ssh://")
        || url.starts_with("git://")
}

fn repo_name(url: &str) -> Result<String, String> {
    git_url_repo_name(url).ok_or_else(|| "Could not infer repository name from URL".into())
}

fn git_url_repo_name(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let name = trimmed.rsplit(['/', ':']).next().unwrap_or("").trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['\\', '/']) {
        return None;
    }
    Some(name.to_string())
}

/// First few lines of a text file for tool previews.
#[tauri::command(async)]
pub fn read_file_preview(
    path: String,
    max_lines: usize,
    start_line: Option<usize>,
) -> Result<Vec<String>, String> {
    use std::io::{BufRead, BufReader};

    let path = expand_home(&path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let limit = max_lines.clamp(1, 12);
    let start = start_line.unwrap_or(1).max(1);
    let mut lines = Vec::new();
    for (i, line) in reader.lines().enumerate() {
        let line_no = i + 1;
        if line_no < start {
            continue;
        }
        if lines.len() >= limit {
            break;
        }
        let mut line = line.map_err(|e| e.to_string())?;
        if line.contains('\0') {
            return Err("Binary file".into());
        }
        if line.len() > 200 {
            line.truncate(199);
            line.push('…');
        }
        lines.push(line);
    }
    Ok(lines)
}

const MAX_STAT_FILES: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMtime {
    path: String,
    mtime_ms: Option<u64>,
    is_dir: bool,
}

fn file_mtime_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// Metadata only — used to notice disk changes on currently open editors.
#[tauri::command(async)]
pub fn stat_files(paths: Vec<String>) -> Result<Vec<FileMtime>, String> {
    if paths.len() > MAX_STAT_FILES {
        return Err("Too many paths".into());
    }
    Ok(paths
        .into_iter()
        .map(|path| {
            let expanded = expand_home(&path);
            let meta = std::fs::metadata(&expanded).ok();
            let is_dir = meta.as_ref().is_some_and(|meta| meta.is_dir());
            let mtime_ms = meta
                .filter(|meta| meta.is_file())
                .and_then(|meta| file_mtime_ms(&meta));
            FileMtime {
                path,
                mtime_ms,
                is_dir,
            }
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

/// Metadata for files the composer is attaching (picker, drop, paste).
#[tauri::command(async)]
pub fn inspect_paths(paths: Vec<String>) -> Vec<PathInfo> {
    paths
        .into_iter()
        .filter_map(|path| inspect_path_sync(&path))
        .collect()
}

fn inspect_path_sync(path: &str) -> Option<PathInfo> {
    let path = expand_home(path);
    let meta = std::fs::metadata(&path).ok()?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path.to_str().unwrap_or("attachment"))
        .to_string();
    Some(PathInfo {
        path: path_to_js(&path),
        name,
        size: meta.len(),
        is_dir: meta.is_dir(),
    })
}

/// Base64-encode a file so vision images can be sent inline over ACP.
#[tauri::command]
pub async fn read_file_base64(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_access::require(&app, &expand_home(&path), false)?;
        read_file_base64_sync(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_file_base64_sync(path: &str) -> Result<String, String> {
    let path = expand_home(path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_ATTACHMENT_EMBED_BYTES {
        return Err(format!(
            "File is too large to attach inline (maximum {} MB).",
            MAX_ATTACHMENT_EMBED_BYTES / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes,
    ))
}

/// Read only the next upload chunk, retaining the native file grant and size checks.
#[tauri::command]
pub async fn read_attachment_chunk(
    app: AppHandle,
    path: String,
    size: u64,
    offset: u64,
    length: u64,
) -> Result<AttachmentChunk, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::file_access::require(&app, &expand_home(&path), false)?;
        attachment_reads::read_chunk(&path, size, offset, length)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hash the acknowledged prefix with a fixed buffer, outside the renderer thread.
#[tauri::command]
pub async fn hash_attachment_prefix(
    app: AppHandle,
    path: String,
    size: u64,
    offset: u64,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::file_access::require(&app, &expand_home(&path), false)?;
        attachment_reads::hash_prefix(&path, size, offset)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a file as raw bytes for the image viewer.
///
/// Returns an `ipc::Response`, which reaches the webview as an ArrayBuffer, so
/// previews skip the 33% base64 inflation that inline attachments pay. The
/// caller decides what the bytes are by sniffing them; this only guards size.
#[tauri::command]
pub async fn read_binary_file(
    app: AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        crate::file_access::require(&app, &expand_home(&path), false)?;
        read_binary_file_sync(&path)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn read_binary_file_sync(path: &str) -> Result<Vec<u8>, String> {
    let path = expand_home(path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err(format!(
            "File is too large to preview (maximum {} MB).",
            MAX_PREVIEW_BYTES / 1024 / 1024
        ));
    }
    std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))
}

fn document_image_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("Image path must be project-relative".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root
        .join(relative_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("Image must be a file inside the project".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn read_project_image(
    app: AppHandle,
    root: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let path = document_image_path(&expand_home(&root), &path)?;
        crate::file_access::require(&app, &path, false)?;
        const LIMIT: u64 = 20 * 1024 * 1024;
        let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > LIMIT {
            return Err("Document image exceeds 20 MB".into());
        }
        let mut bytes = Vec::new();
        file.take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > LIMIT {
            return Err("Document image exceeds 20 MB".into());
        }
        Ok::<_, String>(bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Persist a pasted blob so non-image attachments have a real path.
#[tauri::command]
pub async fn write_attachment(
    app: AppHandle,
    name: String,
    data: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = write_attachment_sync(&name, &data)?;
        crate::file_access::grant_produced_file(
            &app,
            Path::new(&path),
            &std::env::temp_dir(),
            "bycoda-attachments",
        )?;
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn write_attachment_sync(name: &str, data: &str) -> Result<String, String> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
        .map_err(|_| "Attachment data is not valid base64.".to_string())?;
    if bytes.len() as u64 > MAX_ATTACHMENT_EMBED_BYTES {
        return Err(format!(
            "File is too large to attach (maximum {} MB).",
            MAX_ATTACHMENT_EMBED_BYTES / 1024 / 1024
        ));
    }
    let dir = std::env::temp_dir().join("bycoda-attachments");
    crate::file_access::produced_target(&dir, &std::env::temp_dir(), "bycoda-attachments")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = dir.join(format!(
        "{}-{}-{}",
        std::process::id(),
        stamp,
        safe_attachment_name(name)
    ));
    crate::file_access::produced_target(&path, &std::env::temp_dir(), "bycoda-attachments")?;
    // A pasted screenshot can be a picture of whatever was on screen, so keep
    // it owner-only rather than at the umask default of 0644 in a shared /tmp.
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&path)
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn save_generated_image(
    app: AppHandle,
    data: String,
    name: String,
) -> Result<GeneratedImageAsset, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let asset = save_generated_image_sync(&app, &data, &name)?;
        crate::file_access::grant_produced_file(
            &app,
            Path::new(&asset.path),
            &app.path().app_data_dir().map_err(|e| e.to_string())?,
            GENERATED_IMAGE_DIR,
        )?;
        Ok(asset)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_generated_image_sync(
    app: &AppHandle,
    data: &str,
    name: &str,
) -> Result<GeneratedImageAsset, String> {
    if data.len() as u64 > MAX_GENERATED_IMAGE_DATA_BYTES {
        return Err(format!(
            "Generated image is too large (maximum {} MB).",
            MAX_GENERATED_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let encoded: String = data
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace())
        .collect();
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|_| "Generated image data is not valid base64.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_GENERATED_IMAGE_BYTES {
        return Err(format!(
            "Generated image is too large (maximum {} MB).",
            MAX_GENERATED_IMAGE_BYTES / 1024 / 1024
        ));
    }
    if !is_png(&bytes) {
        return Err("Generated image data is not a PNG image.".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(GENERATED_IMAGE_DIR);
    crate::file_access::produced_target(
        &dir,
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        GENERATED_IMAGE_DIR,
    )?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_name = safe_attachment_name(name);
    let destination = dir.join(format!("{}-{}.png", Uuid::new_v4(), safe_name));
    crate::file_access::produced_target(
        &destination,
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        GENERATED_IMAGE_DIR,
    )?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|e| format!("{}: {e}", destination.display()))?;
    if let Err(error) = file.write_all(&bytes) {
        let _ = std::fs::remove_file(&destination);
        return Err(format!("{}: {error}", destination.display()));
    }
    Ok(GeneratedImageAsset {
        path: destination.to_string_lossy().into_owned(),
        mime_type: "image/png".into(),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
pub async fn delete_generated_images(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_generated_images_sync(&app, &paths))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn delete_generated_images_sync(
    app: &AppHandle,
    paths: &[String],
) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(GENERATED_IMAGE_DIR)
        .canonicalize()
        .map_err(|error| format!("Generated image directory is unavailable: {error}"))?;
    for path in paths {
        let candidate = match PathBuf::from(path).canonicalize() {
            Ok(candidate) => candidate,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        crate::file_access::produced_target(
            &candidate,
            &app.path().app_data_dir().map_err(|e| e.to_string())?,
            GENERATED_IMAGE_DIR,
        )?;
        if !candidate.starts_with(&root) || !candidate.is_file() {
            return Err("Invalid generated image path".into());
        }
        std::fs::remove_file(candidate).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

fn safe_attachment_name(name: &str) -> String {
    let leaf = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let cleaned: String = leaf
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.').trim_matches('-');
    if trimmed.is_empty() {
        "attachment".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// Format an editor buffer through the local project's installed formatter.
#[tauri::command]
pub async fn format_text_file(
    app: AppHandle,
    path: String,
    source: String,
    cursor_offset: usize,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = expand_home(&path);
        crate::file_access::require(&app, &path, false)?;
        crate::remote::local_editor_format_rpc(
            &app,
            serde_json::json!({ "path": path, "source": source, "cursorOffset": cursor_offset }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a reasonably sized UTF-8 file for the editor.
#[tauri::command]
pub async fn read_text_file(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_access::require(&app, &expand_home(&path), false)?;
        read_text_file_sync(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_text_file_sync(path: &str) -> Result<String, String> {
    let path = expand_home(path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large to edit (maximum {} MB).",
            MAX_TEXT_FILE_BYTES / 1024 / 1024
        ));
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if bytes.contains(&0) {
        return Err("Binary files cannot be edited.".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8.".into())
}

/// Atomically replace a text file from a temporary file in the same directory.
#[tauri::command]
pub async fn write_text_file(app: AppHandle, path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_access::require(&app, &expand_home(&path), true)?;
        write_text_file_sync(&path, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn write_text_file_sync(path: &str, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large to save (maximum {} MB).",
            MAX_TEXT_FILE_BYTES / 1024 / 1024
        ));
    }

    let requested = expand_home(path);
    let destination = if requested.exists() {
        std::fs::canonicalize(&requested).map_err(|e| format!("{}: {e}", requested.display()))?
    } else {
        requested
    };
    if destination.is_dir() {
        return Err("Cannot save text to a directory.".into());
    }

    let parent = destination
        .parent()
        .ok_or_else(|| "File has no parent directory.".to_string())?;
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid file name.".to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let mut temporary = None;
    for attempt in 0..100 {
        let candidate = parent.join(format!(
            ".{name}.bycoda-{}-{stamp}-{attempt}.tmp",
            std::process::id()
        ));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("{}: {error}", candidate.display())),
        }
    }

    let (temporary_path, mut file) =
        temporary.ok_or_else(|| "Could not create a temporary save file.".to_string())?;
    let write_result = (|| -> Result<(), String> {
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if let Ok(meta) = std::fs::metadata(&destination) {
            std::fs::set_permissions(&temporary_path, meta.permissions())
                .map_err(|e| e.to_string())?;
        }
        drop(file);
        std::fs::rename(&temporary_path, &destination).map_err(|e| e.to_string())?;
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    write_result
}

fn same_entry(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    let Ok(a_meta) = std::fs::metadata(a) else {
        return false;
    };
    let Ok(b_meta) = std::fs::metadata(b) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        a_meta.dev() == b_meta.dev() && a_meta.ino() == b_meta.ino()
    }
    #[cfg(not(unix))]
    {
        let _ = (a_meta, b_meta);
        match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
            (Ok(left), Ok(right)) => left == right,
            _ => false,
        }
    }
}

fn split_stem_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

fn unique_name_in(dir: &Path, name: &str) -> String {
    let (stem, ext) = split_stem_ext(name);
    let mut n = 0u32;
    loop {
        let candidate = match n {
            0 => name.to_string(),
            1 => format!("{stem} copy{ext}"),
            _ => format!("{stem} copy {n}{ext}"),
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
        if n > 1000 {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            return format!("{stem} copy {stamp}{ext}");
        }
    }
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    if meta.is_dir() {
        std::fs::create_dir(to).map_err(|e| format!("{}: {e}", to.display()))?;
        for ent in std::fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))? {
            let ent = ent.map_err(|e| e.to_string())?;
            copy_recursive(&ent.path(), &to.join(ent.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to)
            .map(|_| ())
            .map_err(|e| format!("{}: {e}", to.display()))
    }
}

fn rename_path_sync(path: &str, name: &str) -> Result<String, String> {
    let from = expand_home(path);
    if !from.exists() {
        return Err(format!("{}: No such file or directory", from.display()));
    }
    let parent = from
        .parent()
        .ok_or_else(|| "File has no parent directory.".to_string())?;
    let dest = resolve_under(parent, name)?;
    if same_entry(&from, &dest) {
        if from == dest {
            return Ok(from.to_string_lossy().into_owned());
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp = parent.join(format!(
            ".{}.bycoda-rename-{stamp}",
            file_label(&from, "tmp")
        ));
        std::fs::rename(&from, &tmp).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::rename(&tmp, &dest) {
            let _ = std::fs::rename(&tmp, &from);
            return Err(e.to_string());
        }
        return Ok(dest.to_string_lossy().into_owned());
    }
    if dest.exists() {
        return Err(already_exists(&file_label(&dest, name)));
    }
    if dest.starts_with(&from) {
        return Err("Cannot move a folder into itself.".into());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Rename `path` to `name` (relative to the current parent; `/` nests).
#[tauri::command]
pub async fn rename_path(app: AppHandle, path: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = expand_home(&path);
        crate::file_access::require(&app, &source, true)?;
        let parent = source.parent().ok_or("File has no parent directory")?;
        let destination = resolve_under(parent, &name)?;
        crate::file_access::require(&app, &destination, true)?;
        rename_path_sync(&path, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn delete_path_sync(path: &str) -> Result<(), String> {
    let path = expand_home(path);
    if !path.exists() {
        return Err(format!("{}: No such file or directory", path.display()));
    }
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))
    }
}

#[tauri::command]
pub async fn delete_path(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_access::require(&app, &expand_home(&path), true)?;
        delete_path_sync(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn dir_contains(dir: &Path, dest_parent: &Path) -> bool {
    let dir = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let dest_parent =
        std::fs::canonicalize(dest_parent).unwrap_or_else(|_| dest_parent.to_path_buf());
    dest_parent.starts_with(&dir)
}

#[cfg(test)]
fn copy_path_sync(from: &str, dest_parent: &str) -> Result<String, String> {
    copy_path_checked(from, dest_parent, |_, _| Ok(()))
}

fn copy_path_checked(
    from: &str,
    dest_parent: &str,
    validate: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<String, String> {
    let from = expand_home(from);
    if !from.exists() {
        return Err(format!("{}: No such file or directory", from.display()));
    }
    let dest_parent = expand_home(dest_parent);
    if !dest_parent.is_dir() {
        return Err(format!("{} is not a folder", dest_parent.display()));
    }
    if from.is_dir() && dir_contains(&from, &dest_parent) {
        return Err("Cannot paste a folder into itself.".into());
    }
    let name = unique_name_in(
        &dest_parent,
        &file_label(&from, from.to_str().unwrap_or("copy")),
    );
    let dest = dest_parent.join(&name);
    validate(&from, &dest)?;
    copy_recursive(&from, &dest)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn copy_path(
    app: AppHandle,
    from: String,
    dest_parent: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = expand_home(&from);
        let parent = expand_home(&dest_parent);
        crate::file_access::require(&app, &source, false)?;
        crate::file_access::require(&app, &parent, false)?;
        copy_path_checked(&from, &dest_parent, |source, destination| {
            crate::file_access::validate_copy_tree(&app, source, destination)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn move_path_sync(from: &str, dest_parent: &str) -> Result<String, String> {
    let from = expand_home(from);
    if !from.exists() {
        return Err(format!("{}: No such file or directory", from.display()));
    }
    let dest_parent = expand_home(dest_parent);
    if !dest_parent.is_dir() {
        return Err(format!("{} is not a folder", dest_parent.display()));
    }
    if from.is_dir() && dir_contains(&from, &dest_parent) {
        return Err("Cannot paste a folder into itself.".into());
    }
    let name = file_label(&from, from.to_str().unwrap_or("item"));
    let dest = dest_parent.join(&name);
    if same_entry(&from, &dest) {
        return Ok(from.to_string_lossy().into_owned());
    }
    if dest.exists() {
        return Err(already_exists(&name));
    }
    std::fs::rename(&from, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn move_path(
    app: AppHandle,
    from: String,
    dest_parent: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = expand_home(&from);
        let parent = expand_home(&dest_parent);
        crate::file_access::require(&app, &source, true)?;
        crate::file_access::require(&app, &parent, false)?;
        let destination = parent.join(file_label(&source, "item"));
        crate::file_access::validate_copy_tree(&app, &source, &destination)?;
        move_path_sync(&from, &dest_parent)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn reveal_path(path: String) -> Result<(), String> {
    let requested = expand_home(&path);
    // A reference to a file that was moved or not written yet still opens the
    // closest folder that exists, so the action never silently does nothing.
    let path = nearest_existing_path(&requested)
        .ok_or_else(|| format!("{}: No such file or directory", requested.display()))?;
    if !requested.exists() {
        return open::that(&path).map_err(|error| error.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let path_str = path.to_str().ok_or_else(|| "Invalid path".to_string())?;
        let status = Command::new("open")
            .args(["-R", path_str])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not reveal in Finder.".into());
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        // explorer.exe returns 1 even when it opened the folder.
        let path_str = path.to_string_lossy().replace('/', "\\");
        // Only the path may be quoted: with the whole `/select,…` argument in
        // quotes (what `arg` does for a path with spaces) explorer ignores it
        // and opens Documents.
        use std::os::windows::process::CommandExt;
        Command::new("explorer")
            .raw_arg(format!("/select,\"{path_str}\""))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let parent = path
            .parent()
            .ok_or_else(|| "File has no parent directory.".to_string())?;
        let status = Command::new("xdg-open")
            .arg(parent)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not open the containing folder.".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn open_path_with_default_app(path: String) -> Result<(), String> {
    // The Tauri opener command needs a static path scope, and its detached
    // launcher cannot report a failing `open` process back to the UI.
    tauri::async_runtime::spawn_blocking(move || {
        let requested = expand_home(&path);
        if !requested.is_absolute() {
            return Err("Expected an absolute file path".to_string());
        }
        let path = nearest_existing_path(&requested)
            .ok_or_else(|| format!("{}: No such file or directory", requested.display()))?;
        open::that(&path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The path itself when it exists, otherwise its closest existing ancestor.
fn nearest_existing_path(path: &std::path::Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|candidate| !candidate.as_os_str().is_empty() && candidate.exists())
        .map(normalize_native_separators)
}

/// Explorer and the shell resolve `\` reliably; mixed separators can open the
/// wrong folder on some Windows shells.
fn normalize_native_separators(path: &std::path::Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().replace('/', "\\"))
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commit_stats_keep_literal_paths_and_rename_destinations() {
        let mut counts = HashMap::new();
        add_numstat_map(
            "1\t2\t 한글 => \"name\".md \0-\t-\tbinary.png\x001\t0\t\0old\0new\tname.md\0",
            &mut counts,
        );
        assert_eq!(counts[" 한글 => \"name\".md "].additions, 1);
        assert_eq!(counts[" 한글 => \"name\".md "].deletions, 2);
        assert!(counts.contains_key("binary.png"));
        assert!(counts.contains_key("new\tname.md"));
        let mut statuses = HashMap::new();
        add_name_status("M\0 한글 => \"name\".md \0D\0new\tname.md\0", &mut statuses);
        assert_eq!(statuses[" 한글 => \"name\".md "], "modified");
        assert_eq!(statuses["new\tname.md"], "deleted");
    }

    #[test]
    fn document_images_reject_traversal_and_nonfiles() {
        let dir = tmp("document-images");
        let project = dir.0.join("project");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("image.png"), b"image").unwrap();
        std::fs::write(dir.0.join("outside.png"), b"private").unwrap();
        assert!(document_image_path(&project, "image.png").is_ok());
        for path in [
            "../outside.png",
            "/outside.png",
            "C:/outside.png",
            "image.png:stream",
            "",
            ".",
        ] {
            assert!(document_image_path(&project, path).is_err(), "{path}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.0.join("outside.png"), project.join("escape.png"))
                .unwrap();
            assert!(document_image_path(&project, "escape.png").is_err());
        }
    }
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;

    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn nearest_existing_path_falls_back_to_the_closest_folder() {
        let dir = tmp("nearest-existing");
        let folder = dir.0.join(".hidden build").join("packages");
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("setup 1.exe");
        std::fs::write(&file, b"x").unwrap();
        let same = |a: &Path, b: &Path| {
            assert_eq!(
                normalize_native_separators(a),
                normalize_native_separators(b)
            )
        };
        same(&nearest_existing_path(&file).unwrap(), &file);
        same(
            &nearest_existing_path(&folder.join("missing").join("later.exe")).unwrap(),
            &folder,
        );
        let mixed = PathBuf::from(format!("{}/", folder.to_string_lossy().replace('\\', "/")));
        assert!(nearest_existing_path(&mixed).unwrap().is_dir());
    }

    #[test]
    fn git_trust_repository_requires_confirmation_and_a_repository() {
        let dir = tmp("git-trust-repository");
        assert!(git_trust_repository_for(&dir.0, false)
            .unwrap_err()
            .contains("confirmation"));
        assert!(git_trust_repository_for(&dir.0, true).is_err());
        git_checked(&dir.0, &["init"]).unwrap();
        // An already trusted repository is idempotent and needs no global config write.
        git_trust_repository_for(&dir.0, true).unwrap();
    }

    #[test]
    fn git_index_checked_distinguishes_non_repository_from_read_failure() {
        let dir = tmp("git-index-read-state");
        assert!(!git_diff_index_checked(&dir.0, true).unwrap().repository);
        git_checked(&dir.0, &["init"]).unwrap();
        assert!(git_diff_index_checked(&dir.0, true).unwrap().repository);
        std::fs::write(dir.0.join(".git/index"), b"invalid index").unwrap();
        assert!(git_diff_index_checked(&dir.0, true).is_err());
    }

    #[test]
    fn git_history_reports_invalid_repository_access() {
        let dir = tmp("git-history-read-state");
        let missing = dir.0.join("missing");
        assert!(git_history_scoped(&missing, Some(10), false).is_err());
    }

    #[test]
    fn git_stash_reports_invalid_repository_access() {
        let dir = tmp("git-stash-read-state");
        assert!(git_stash_list_checked(&dir.0).unwrap().is_empty());
        assert!(git_stash_list_checked(&dir.0.join("missing")).is_err());
    }

    #[test]
    fn claude_shell_commands_match_only_requested_bash_tool_ids() {
        let dir = tmp("claude-shell-commands");
        let path = dir.0.join("session.jsonl");
        let records = [
            serde_json::json!({"type":"assistant","message":{"content":[
                {"type":"tool_use","id":"toolu_one","name":"Bash","input":{"command":"npm test"}},
                {"type":"tool_use","id":"toolu_read","name":"Read","input":{"command":"ignore"}}
            ]}}),
            serde_json::json!({"type":"assistant","message":{"content":[
                {"type":"tool_use","id":"toolu_two","name":"Bash","input":{"command":"git status"}}
            ]}}),
        ];
        std::fs::write(&path, records.map(|record| record.to_string()).join("\n")).unwrap();
        let commands =
            claude_shell_commands_from_file(&path, &["toolu_one".into(), "toolu_read".into()])
                .unwrap();
        assert_eq!(
            commands,
            HashMap::from([("toolu_one".into(), "npm test".into())])
        );
    }

    fn assistant_text(text: &str, concat: &str) -> OmpAssistantText {
        OmpAssistantText {
            text: text.into(),
            concat: concat.into(),
        }
    }

    #[test]
    fn generated_image_validation_accepts_png_only() {
        assert!(is_png(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        assert!(!is_png(&[0xff, 0xd8, 0xff, 0x00]));
        assert!(!is_png(b"<html>"));
        assert!(!is_png(&[]));
    }

    #[test]
    fn github_star_status_distinguishes_a_missing_star_from_an_unavailable_check() {
        assert_eq!(
            github_star_status_from_result(Ok(String::new())),
            GitHubStarStatus::Starred
        );
        assert_eq!(
            github_star_status_from_result(Err("gh: Not Found (HTTP 404)".into())),
            GitHubStarStatus::NotStarred
        );
        assert_eq!(
            github_star_status_from_result(Err("GitHub CLI is not installed".into())),
            GitHubStarStatus::Unavailable
        );
    }

    #[test]
    fn omp_active_assistant_texts_keep_active_message_order_with_both_forms() {
        let dir = tmp("omp-active-texts");
        let path = dir.0.join("session.jsonl");
        let records = [
            serde_json::json!({"type":"message","id":"u","message":{"role":"user","content":"User only"}}),
            serde_json::json!({"type":"message","id":"abandoned","parentId":"u","message":{"role":"assistant","content":"Off branch"}}),
            serde_json::json!({"type":"message","id":"a","parentId":"u","message":{"role":"assistant","content":[{"type":"text","text":"First."},{"type":"thinking","thinking":"Hidden"},{"type":"text","text":"Second."}]}}),
            serde_json::json!({"type":"message","id":"tool","parentId":"a","message":{"role":"assistant","content":[{"type":"toolCall","name":"read"}]}}),
            serde_json::json!({"type":"message","id":"b","parentId":"tool","message":{"role":"assistant","content":"Plain"}}),
            serde_json::json!({"type":"custom_message","id":"note","parentId":"b","content":"Note only"}),
        ];
        let jsonl = records.iter().map(|v| format!("{v}\n")).collect::<String>();
        std::fs::write(&path, jsonl).unwrap();
        assert_eq!(
            active_omp_assistant_texts(&path).unwrap(),
            [
                assistant_text("First.\nSecond.", "First.Second."),
                assistant_text("Plain", "Plain"),
            ]
        );
    }

    #[test]
    fn omp_active_assistant_texts_repeat_equal_messages_in_file_order() {
        let dir = tmp("omp-active-texts-repeats");
        let path = dir.0.join("session.jsonl");
        let records = [
            serde_json::json!({"type":"message","id":"a","message":{"role":"assistant","content":"First."}}),
            serde_json::json!({"type":"message","id":"off","parentId":"a","message":{"role":"assistant","content":"First.Second."}}),
            serde_json::json!({"type":"message","id":"b","parentId":"a","message":{"role":"assistant","content":[{"type":"text","text":"Second."}]}}),
            serde_json::json!({"type":"message","id":"c","parentId":"b","message":{"role":"assistant","content":"First.Second."}}),
            serde_json::json!({"type":"message","id":"d","parentId":"c","message":{"role":"assistant","content":"First.Second."}}),
        ];
        std::fs::write(
            &path,
            records.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
        assert_eq!(
            active_omp_assistant_texts(&path).unwrap(),
            [
                assistant_text("First.", "First."),
                assistant_text("Second.", "Second."),
                assistant_text("First.Second.", "First.Second."),
                assistant_text("First.Second.", "First.Second."),
            ]
        );
    }

    #[test]
    fn omp_interjections_require_displayed_assistant_anchors() {
        let dir = tmp("omp-interjections");
        let path = dir.0.join("session.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"message\",\"id\":\"u\",\"message\":{\"role\":\"user\",\"content\":\"Go\"}}\n",
                "{\"type\":\"custom_message\",\"id\":\"orphan\",\"parentId\":\"u\",\"display\":true}\n",
                "{\"type\":\"message\",\"id\":\"a1\",\"parentId\":\"orphan\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Answer\"}]}}\n",
                "{\"type\":\"custom_message\",\"id\":\"hidden\",\"parentId\":\"a1\",\"display\":false}\n",
                "invalid partial line\n",
                "{\"type\":\"message\",\"id\":\"a2\",\"parentId\":\"hidden\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Answer\"}]}}\n",
                "{\"type\":\"custom_message\",\"id\":\"review\",\"parentId\":\"a2\",\"display\":true,\"customType\":\"advisor\",\"details\":{\"notes\":[{\"note\":\"First\",\"severity\":\"nit\"},{\"note\":\"Second\",\"severity\":\"blocker\"}]}}\n",
                "{\"type\":\"message\",\"id\":\"a3\",\"parentId\":\"review\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Checked\"}]}}\n",
            ),
        )
        .unwrap();
        let anchors = parse_omp_interjections(&path).unwrap();
        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].after_assistant_text, "Answer");
        assert_eq!(anchors[0].after_occurrence, 2);
        assert_eq!(
            anchors[0].following_assistant_text.as_deref(),
            Some("Checked")
        );
        assert_eq!(anchors[0].text, "First\n\nSecond");
        assert_eq!(anchors[0].severity.as_deref(), Some("blocker"));
    }

    #[test]
    fn omp_interjections_do_not_coalesce_across_reasoning() {
        let dir = tmp("omp-interjections-reasoning");
        let path = dir.0.join("session.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"message\",\"id\":\"a\",\"message\":{\"role\":\"assistant\",\"content\":\"Answer\"}}\n",
                "{\"type\":\"custom_message\",\"id\":\"review\",\"parentId\":\"a\",\"display\":true,\"content\":\"Check\"}\n",
                "{\"type\":\"message\",\"id\":\"b\",\"parentId\":\"review\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"Wait\"},{\"type\":\"text\",\"text\":\"Checked\"}]}}\n",
            ),
        )
        .unwrap();
        let anchors = parse_omp_interjections(&path).unwrap();
        assert_eq!(anchors[0].following_assistant_text, None);
        assert_eq!(anchors[0].text, "Check");
    }
    #[test]
    fn omp_interjections_follow_active_ancestry_and_keep_text_forms() {
        let dir = tmp("omp-interjections-ancestry");
        let path = dir.0.join("session.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"message\",\"id\":\"a\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"One\"},{\"type\":\"text\",\"text\":\"Two\"}]}}\n",
                "{\"type\":\"custom_message\",\"id\":\"abandoned\",\"parentId\":\"a\",\"display\":true,\"content\":\"Wrong branch\"}\n",
                "{\"type\":\"message\",\"id\":\"t\",\"parentId\":\"a\",\"message\":{\"role\":\"toolResult\",\"content\":\"Done\"}}\n",
                "{\"type\":\"custom_message\",\"id\":\"first\",\"parentId\":\"t\",\"display\":true,\"content\":\"First\"}\n",
                "{\"type\":\"custom_message\",\"id\":\"second\",\"parentId\":\"first\",\"display\":true,\"content\":\"Second\"}\n",
                "{\"type\":\"compaction\",\"id\":\"meta\",\"parentId\":\"second\"}\n",
                "{\"type\":\"custom_message\",\"id\":\"third\",\"parentId\":\"meta\",\"display\":true,\"content\":\"Third\"}\n",
                "{\"type\":\"message\",\"id\":\"b\",\"parentId\":\"third\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Three\"},{\"type\":\"text\",\"text\":\"Four\"}]}}\n",
            ),
        )
        .unwrap();
        let anchors = parse_omp_interjections(&path).unwrap();
        assert_eq!(
            anchors.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["first", "second", "third"]
        );
        for anchor in &anchors {
            assert_eq!(anchor.after_assistant_text, "One\nTwo");
            assert_eq!(anchor.after_assistant_text_concat, "OneTwo");
            assert_eq!(anchor.after_occurrence, 1);
            assert_eq!(anchor.after_concat_occurrence, 1);
        }
        assert_eq!(anchors[0].following_assistant_text, None);
        assert_eq!(anchors[1].following_assistant_text, None);
        assert_eq!(
            anchors[2].following_assistant_text.as_deref(),
            Some("Three\nFour")
        );
        assert_eq!(
            anchors[2].following_assistant_text_concat.as_deref(),
            Some("ThreeFour")
        );
    }

    #[test]
    fn omp_interjections_do_not_cross_users_or_empty_assistant_messages() {
        let dir = tmp("omp-interjections-barriers");
        let path = dir.0.join("session.jsonl");
        for role in ["user", "assistant"] {
            let records = [
                serde_json::json!({"type":"message","id":"a","message":{"role":"assistant","content":"Earlier"}}),
                serde_json::json!({"type":"message","id":"barrier","parentId":"a","message":{"role":role,"content":[]}}),
                serde_json::json!({"type":"message","id":"tool","parentId":"barrier","message":{"role":"toolResult","content":"Done"}}),
                serde_json::json!({"type":"custom_message","id":"note","parentId":"tool","display":true,"content":"Note"}),
            ];
            let jsonl = records.map(|record| record.to_string()).join("\n");
            std::fs::write(&path, jsonl).unwrap();
            assert!(parse_omp_interjections(&path).unwrap().is_empty());
        }
    }

    #[test]
    fn stat_files_returns_mtime_for_existing_files_only() {
        let dir = tmp("stat-files");
        let path = dir.0.join("notes.md");
        std::fs::write(&path, "hi\n").unwrap();
        let path_string = path.to_string_lossy().into_owned();
        let missing = dir.0.join("gone.md").to_string_lossy().into_owned();

        let stats = stat_files(vec![
            path_string.clone(),
            missing.clone(),
            dir.0.to_string_lossy().into_owned(),
        ])
        .unwrap();
        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].path, path_string);
        assert!(stats[0].mtime_ms.is_some());
        assert_eq!(stats[1].path, missing);
        assert!(stats[1].mtime_ms.is_none());
        assert!(!stats[0].is_dir);
        assert!(!stats[1].is_dir);
        assert!(stats[2].is_dir);
    }

    #[test]
    fn project_location_follows_a_sibling_rename() {
        let parent = tmp("project-location-rename");
        let original = parent.0.join("bycoda");
        let renamed = parent.0.join("bycoda-personal");
        std::fs::create_dir(&original).unwrap();

        let first = resolve_project_location_sync(&path_to_js(&original), None)
            .unwrap()
            .unwrap();
        assert_eq!(first.path, path_to_js(&original));

        std::fs::rename(&original, &renamed).unwrap();
        let resolved = resolve_project_location_sync(&path_to_js(&original), Some(&first.identity))
            .unwrap()
            .unwrap();
        assert_eq!(resolved.path, path_to_js(&renamed));
        assert_eq!(resolved.identity, first.identity);
    }

    #[test]
    fn project_location_does_not_guess_without_a_saved_identity() {
        let parent = tmp("project-location-missing");
        let missing = parent.0.join("old-name");
        std::fs::create_dir(parent.0.join("some-project")).unwrap();

        assert_eq!(
            resolve_project_location_sync(&path_to_js(&missing), None).unwrap(),
            None
        );
    }

    #[test]
    fn untracked_line_counts_are_reused_until_the_file_changes() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("bycoda-untracked-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, b) = (dir.join("a.txt"), dir.join("b.txt"));
        std::fs::write(&a, "one\ntwo\n").unwrap();
        std::fs::write(&b, "x\n").unwrap();

        let reads = std::cell::Cell::new(0);
        let counter = |path: &Path| {
            reads.set(reads.get() + 1);
            text_line_count(path)
        };
        let poll = |previous: &UntrackedLines, paths: &[&PathBuf]| {
            let mut seen = UntrackedLines::new();
            let lines: Vec<i64> = paths
                .iter()
                .map(|path| untracked_line_count(previous, &mut seen, path, counter))
                .collect();
            (lines, seen)
        };

        let (lines, seen) = poll(&UntrackedLines::new(), &[&a, &b]);
        assert_eq!(lines, [2, 1]);
        assert_eq!(reads.get(), 2);

        // Unchanged size and time: no further read, same numbers.
        let (lines, seen) = poll(&seen, &[&a, &b]);
        assert_eq!(lines, [2, 1]);
        assert_eq!(reads.get(), 2);

        // A different size is recounted.
        std::fs::write(&a, "one\ntwo\nthree\n").unwrap();
        let (lines, seen) = poll(&seen, &[&a, &b]);
        assert_eq!(lines, [3, 1]);
        assert_eq!(reads.get(), 3);

        // The same size with a different time is recounted too.
        std::fs::write(&b, "y\n").unwrap();
        let file = std::fs::OpenOptions::new().write(true).open(&b).unwrap();
        file.set_modified(SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();
        drop(file);
        let (lines, seen) = poll(&seen, &[&a, &b]);
        assert_eq!(lines, [3, 1]);
        assert_eq!(reads.get(), 4);

        // A file that is gone is dropped from the next generation.
        std::fs::remove_file(&b).unwrap();
        let (lines, seen) = poll(&seen, &[&a, &b]);
        assert_eq!(lines, [3, 0]);
        assert_eq!(seen.len(), 1);
        assert!(seen.contains_key(&a));
        assert_eq!(reads.get(), 4);

        // The per-root cache holds only what the last call stored.
        let root = dir.join("root");
        store_untracked_lines(&root, seen);
        assert_eq!(take_untracked_lines(&root).len(), 1);
        assert!(take_untracked_lines(&root).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn editor_text_files_round_trip_without_leaving_a_temporary_file() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("bycoda-editor-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("example.rs");
        std::fs::write(&path, "fn old() {}\n").unwrap();
        let path_string = path.to_string_lossy().into_owned();

        assert_eq!(read_text_file_sync(&path_string).unwrap(), "fn old() {}\n");
        write_text_file_sync(&path_string, "fn new() {}\n").unwrap();
        assert_eq!(read_text_file_sync(&path_string).unwrap(), "fn new() {}\n");

        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("example.rs")]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn binary_reads_return_bytes_and_refuse_directories() {
        let dir = tmp("binary-read");
        let file = dir.0.join("shot.png");
        std::fs::write(&file, [0x89, b'P', b'N', b'G', 0x0d]).unwrap();

        let bytes = read_binary_file_sync(&file.to_string_lossy()).unwrap();
        assert_eq!(bytes, vec![0x89, b'P', b'N', b'G', 0x0d]);
        assert!(read_binary_file_sync(&dir.0.to_string_lossy()).is_err());
    }

    #[test]
    fn inspect_paths_reports_files_and_directories() {
        let dir = tmp("inspect-paths");
        let file = dir.0.join("notes.md");
        std::fs::write(&file, "hello\n").unwrap();
        let infos = inspect_paths(vec![
            file.to_string_lossy().into_owned(),
            dir.0.to_string_lossy().into_owned(),
        ]);
        assert_eq!(infos.len(), 2);
        let notes = infos.iter().find(|info| info.name == "notes.md").unwrap();
        assert!(!notes.is_dir);
        assert_eq!(notes.size, 6);
        let folder = infos.iter().find(|info| info.is_dir).unwrap();
        assert_eq!(folder.path, path_to_js(&dir.0));
    }

    #[test]
    fn attachment_bytes_round_trip_through_temp_dir() {
        let encoded =
            read_file_base64_sync(&write_attachment_sync("shot.png", "aGVsbG8=").unwrap()).unwrap();
        assert_eq!(encoded, "aGVsbG8=");
        assert_eq!(safe_attachment_name("../../secret.png"), "secret.png");
        assert_eq!(safe_attachment_name(""), "attachment");
    }

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        loop {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "bycoda-{label}-{}-{stamp}-{seq}",
                std::process::id()
            ));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Tmp(dir),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("{}", error),
            }
        }
    }

    #[test]
    fn claude_project_dir_flattens_every_separator() {
        let config = Path::new("/home/dev/.claude");
        assert_eq!(
            claude_project_dir(config, "/Users/medeni/Desktop/Projects/bycoda"),
            config.join("projects/-Users-medeni-Desktop-Projects-bycoda")
        );
        // Dots and underscores flatten too, which is why the mapping is one-way:
        // these three distinct paths share a single directory name.
        let dotted = claude_project_dir(config, "/a/b.c");
        assert_eq!(dotted, claude_project_dir(config, "/a/b-c"));
        assert_eq!(dotted, claude_project_dir(config, "/a/b_c"));

        // Everything that is not a letter or digit goes, not just the
        // characters that read as separators. Spaces and punctuation are
        // ordinary in project paths, and a Windows path carries a drive colon.
        assert_eq!(
            claude_project_dir(config, "/Users/me/My Project (v2)"),
            config.join("projects/-Users-me-My-Project--v2-")
        );
        assert_eq!(
            claude_project_dir(config, "C:\\Users\\dev\\proj"),
            config.join("projects/C--Users-dev-proj")
        );
        // Non-ASCII letters are replaced rather than transliterated: each one
        // becomes a single `-`, so `çalışma` is `-al--ma`, not `calisma`.
        assert_eq!(
            claude_project_dir(config, "/Users/me/çalışma"),
            config.join("projects/-Users-me--al--ma")
        );
    }

    #[test]
    fn summarize_claude_session_prefers_the_latest_generated_title() {
        let dir = tmp("claude-sessions");
        let path = dir.0.join("s1.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"type":"user","message":{"role":"user","content":"first prompt"}}"#,
                "\n",
                r#"{"type":"ai-title","aiTitle":"An early guess"}"#,
                "\n",
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
                "\n",
                r#"{"type":"ai-title","aiTitle":"What it settled on"}"#,
                "\n",
                // Subagent traffic belongs to a tool call the parent already shows.
                r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[]}}"#,
                "\n",
                "not json at all\n",
            ),
        )
        .unwrap();

        let (title, messages) = summarize_claude_session(&path).unwrap();
        assert_eq!(title, "What it settled on");
        assert_eq!(messages, 2);
    }

    #[test]
    fn summarize_claude_session_falls_back_to_the_first_prompt() {
        let dir = tmp("claude-sessions");
        let path = dir.0.join("s2.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"  spaced   out  "}]}}"#,
                "\n",
            ),
        )
        .unwrap();

        let (title, messages) = summarize_claude_session(&path).unwrap();
        assert_eq!(title, "spaced out");
        assert_eq!(messages, 1);
    }

    #[test]
    fn summarize_claude_session_skips_a_file_with_no_conversation() {
        let dir = tmp("claude-sessions");
        let path = dir.0.join("s3.jsonl");
        std::fs::write(&path, "{\"type\":\"mode\",\"mode\":\"normal\"}\n").unwrap();
        assert!(summarize_claude_session(&path).is_none());
    }

    #[test]
    fn claude_sessions_returns_empty_for_a_project_with_no_history() {
        let dir = tmp("claude-empty");
        let cwd = dir.0.join("nowhere").to_string_lossy().to_string();
        assert!(claude_sessions_sync(&dir.0, &cwd).unwrap().is_empty());
    }

    #[test]
    fn claude_sessions_reads_only_the_given_account_profile() {
        // An added account's CLI writes under its own config dir, so a
        // conversation recorded there must not be listed from another one.
        let dir = tmp("claude-accounts");
        let added = dir.0.join("added");
        let default = dir.0.join("default");
        let cwd = "/work/app";
        let project = claude_project_dir(&added, cwd);
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            project.join("s1.jsonl"),
            concat!(
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}"#,
                "\n",
            ),
        )
        .unwrap();

        let listed = claude_sessions_sync(&added, cwd).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "s1");
        assert!(claude_sessions_sync(&default, cwd).unwrap().is_empty());
    }

    #[test]
    fn split_stem_ext_keeps_dotfiles_whole() {
        assert_eq!(split_stem_ext("foo.ts"), ("foo", ".ts"));
        assert_eq!(split_stem_ext("foo.d.ts"), ("foo.d", ".ts"));
        assert_eq!(split_stem_ext(".gitignore"), (".gitignore", ""));
        assert_eq!(split_stem_ext("Makefile"), ("Makefile", ""));
    }

    #[test]
    fn rename_delete_and_copy_round_trip() {
        let dir = tmp("tree");
        let file = dir.0.join("notes.md");
        std::fs::write(&file, "hi\n").unwrap();
        let file_s = file.to_string_lossy().into_owned();
        let parent = dir.0.to_string_lossy().into_owned();

        let renamed = rename_path_sync(&file_s, "readme.md").unwrap();
        assert!(Path::new(&renamed).ends_with("readme.md"));
        assert!(!file.exists());
        assert_eq!(std::fs::read_to_string(&renamed).unwrap(), "hi\n");

        let copied = copy_path_sync(&renamed, &parent).unwrap();
        assert!(Path::new(&copied).ends_with("readme copy.md"));
        assert_eq!(std::fs::read_to_string(&copied).unwrap(), "hi\n");

        let nested = dir.0.join("docs");
        std::fs::create_dir(&nested).unwrap();
        let moved = move_path_sync(&copied, &nested.to_string_lossy()).unwrap();
        assert!(Path::new(&moved).ends_with("docs/readme copy.md"));
        assert!(!Path::new(&copied).exists());

        delete_path_sync(&renamed).unwrap();
        assert!(!Path::new(&renamed).exists());
        delete_path_sync(&nested.to_string_lossy()).unwrap();
        assert!(!nested.exists());
    }

    #[test]
    fn copy_folder_gets_a_unique_name_and_rejects_paste_into_self() {
        let dir = tmp("folder");
        let src = dir.0.join("src");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("a.rs"), "fn a() {}\n").unwrap();
        let parent = dir.0.to_string_lossy().into_owned();
        let src_s = src.to_string_lossy().into_owned();

        let copied = copy_path_sync(&src_s, &parent).unwrap();
        assert!(Path::new(&copied).ends_with("src copy"));
        assert!(Path::new(&copied).join("a.rs").exists());

        let err = copy_path_sync(&src_s, &src_s).unwrap_err();
        assert!(err.contains("itself"));
    }

    #[cfg(unix)]
    #[test]
    fn copy_rejects_paste_into_self_through_a_symlink_alias() {
        let dir = tmp("folder-alias");
        let src = dir.0.join("src");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("a.rs"), "fn a() {}\n").unwrap();
        let alias = dir.0.join("alias");
        std::os::unix::fs::symlink(&src, &alias).unwrap();
        let src_s = src.to_string_lossy().into_owned();
        let alias_s = alias.to_string_lossy().into_owned();

        let err = copy_path_sync(&src_s, &alias_s).unwrap_err();
        assert!(err.contains("itself"));
        let err = move_path_sync(&src_s, &alias_s).unwrap_err();
        assert!(err.contains("itself"));
    }

    fn relative_paths(files: &[ProjectFile]) -> Vec<&str> {
        files.iter().map(|f| f.relative.as_str()).collect()
    }

    #[test]
    fn walk_skips_vendor_dirs_and_gitignore_names() {
        let dir = tmp("index-walk");
        std::fs::write(dir.0.join("app.ts"), "x\n").unwrap();
        std::fs::create_dir_all(dir.0.join("src")).unwrap();
        std::fs::write(dir.0.join("src").join("main.ts"), "x\n").unwrap();
        std::fs::create_dir_all(dir.0.join("node_modules").join("pkg")).unwrap();
        std::fs::write(
            dir.0.join("node_modules").join("pkg").join("index.js"),
            "x\n",
        )
        .unwrap();
        std::fs::write(dir.0.join(".gitignore"), "secret.txt\n").unwrap();
        std::fs::write(dir.0.join("secret.txt"), "nope\n").unwrap();

        let files = walk_project_files(&dir.0, WalkStop::Never);
        let paths = relative_paths(&files);
        assert!(paths.contains(&"app.ts"));
        assert!(paths.contains(&"src/main.ts"));
        assert!(paths.contains(&".gitignore"));
        assert!(!paths.iter().any(|r| r.contains("node_modules")));
        assert!(!paths.contains(&"secret.txt"));
    }

    #[test]
    fn walk_stops_early_when_cancelled() {
        let dir = tmp("index-walk-cancelled");
        for index in 0..64 {
            std::fs::create_dir_all(dir.0.join(format!("dir{index}"))).unwrap();
            std::fs::write(dir.0.join(format!("dir{index}")).join("app.ts"), "x\n").unwrap();
        }
        let uncancelled = walk_project_files(&dir.0, WalkStop::Never);
        assert_eq!(uncancelled.len(), 64);

        let cancel = AtomicBool::new(true);
        assert!(walk_project_files(&dir.0, WalkStop::Flag(&cancel)).is_empty());
        // The same walk when nothing is cancelled must still see every file.
        let live = AtomicBool::new(false);
        assert_eq!(walk_project_files(&dir.0, WalkStop::Flag(&live)).len(), 64);
    }

    #[test]
    fn walk_stops_between_entries_not_only_before_the_first_directory() {
        let dir = tmp("index-walk-midway");
        // Flat, so the entries the walk accepts are files: a tree of
        // directories would be pushed, not collected, and stopping midway would
        // still look empty.
        for index in 0..64 {
            std::fs::write(dir.0.join(format!("file{index}.ts")), "x\n").unwrap();
        }
        let all = walk_project_files(&dir.0, WalkStop::Never);
        assert_eq!(all.len(), 64);

        // Stopping partway through the first directory's entries is the only
        // outcome that distinguishes the per-entry check from the up-front one:
        // no up-front check yields all 64, a check that fires on the first
        // directory yields 0.
        let midway = walk_project_files(&dir.0, WalkStop::AfterEntries(5));
        assert!(
            !midway.is_empty() && midway.len() < all.len(),
            "expected a partial listing, got {} of {}",
            midway.len(),
            all.len()
        );
    }

    #[test]
    fn walk_skips_app_bundles() {
        let dir = tmp("index-bundle");
        std::fs::write(dir.0.join("app.ts"), "x\n").unwrap();
        let bundle = dir.0.join("Some.app").join("Contents");
        std::fs::create_dir_all(&bundle).unwrap();
        std::fs::write(bundle.join("Info.plist"), "x\n").unwrap();

        let files = walk_project_files(&dir.0, WalkStop::Never);
        let paths = relative_paths(&files);
        assert!(paths.contains(&"app.ts"));
        assert!(!paths.iter().any(|r| r.contains("Some.app")));
    }

    #[test]
    fn home_root_is_not_indexed() {
        let Some(home) = dirs_home() else { return };
        let files = list_project_files_sync(&home).unwrap();
        assert!(files.is_empty());
        assert!(list_project_files_sync("~").unwrap().is_empty());
        assert!(!is_indexable_root(Path::new("/")));
    }

    #[test]
    fn project_dirs_stay_indexable() {
        let dir = tmp("index-root");
        assert!(is_indexable_root(&dir.0));
    }

    fn ignored_names(entries: &[DirEntry]) -> Vec<String> {
        entries
            .iter()
            .filter(|e| e.ignored)
            .map(|e| e.name.clone())
            .collect()
    }

    fn is_ignored(dir: &Path, name: &str) -> bool {
        ignored_names(&list_dir_sync(dir).unwrap())
            .iter()
            .any(|n| n == name)
    }

    #[test]
    fn list_dir_sorts_numbered_names_naturally_with_folders_first() {
        let dir = tmp("list-dir-natural-sort");
        for name in [
            "chapter-100.md",
            "chapter-11.md",
            "chapter-09.md",
            "chapter-10.md",
            "Chapter-2.md",
        ] {
            std::fs::write(dir.0.join(name), "").unwrap();
        }
        for name in ["volume-10", "volume-2"] {
            std::fs::create_dir(dir.0.join(name)).unwrap();
        }

        let names: Vec<_> = list_dir_sync(&dir.0)
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(
            names,
            [
                "volume-2",
                "volume-10",
                "Chapter-2.md",
                "chapter-09.md",
                "chapter-10.md",
                "chapter-11.md",
                "chapter-100.md",
            ]
        );
    }

    #[test]
    fn natural_name_sort_handles_multiple_and_large_numbers() {
        let mut names = [
            "part-2-chapter-10",
            "part-10-chapter-1",
            "part-2-chapter-2",
            "part-2-chapter-999999999999999999999999999999",
        ];
        names.sort_by(|a, b| compare_natural_names(a, b));
        assert_eq!(
            names,
            [
                "part-2-chapter-2",
                "part-2-chapter-10",
                "part-2-chapter-999999999999999999999999999999",
                "part-10-chapter-1",
            ]
        );
    }

    #[test]
    fn list_dir_marks_ignored_with_git_semantics() {
        let dir = tmp("list-dir-git");
        let init = Command::new("git")
            .args(["init"])
            .current_dir(&dir.0)
            .output();
        let Ok(init) = init else { return };
        if !init.status.success() {
            return;
        }
        std::fs::write(
            dir.0.join(".gitignore"),
            "*.zzlog\n!keep.zzlog\n/zz-dist\nzz-build/\nnested/*.zztmp\n",
        )
        .unwrap();
        std::fs::write(dir.0.join("a.zzlog"), "x\n").unwrap();
        std::fs::write(dir.0.join("keep.zzlog"), "x\n").unwrap();
        std::fs::write(dir.0.join("zz-build"), "x\n").unwrap();
        std::fs::create_dir_all(dir.0.join("zz-dist")).unwrap();
        std::fs::create_dir_all(dir.0.join("src").join("zz-dist")).unwrap();
        std::fs::create_dir_all(dir.0.join("nested")).unwrap();
        std::fs::write(dir.0.join("nested").join("x.zztmp"), "x\n").unwrap();
        std::fs::write(dir.0.join("nested").join("x.txt"), "x\n").unwrap();

        assert!(is_ignored(&dir.0, ".git"));
        assert!(is_ignored(&dir.0, "a.zzlog"));
        assert!(!is_ignored(&dir.0, "keep.zzlog"));
        assert!(is_ignored(&dir.0, "zz-dist"));
        assert!(!is_ignored(&dir.0.join("src"), "zz-dist"));
        assert!(!is_ignored(&dir.0, "zz-build"));
        assert!(is_ignored(&dir.0.join("nested"), "x.zztmp"));
        assert!(!is_ignored(&dir.0.join("nested"), "x.txt"));
    }

    #[test]
    fn ignored_names_cache_reuses_unchanged_listings_and_misses_on_change() {
        let cache: IgnoredNamesCache = Mutex::new(None);
        let calls = std::cell::Cell::new(0);
        let lookup = |_: &Path, names: &[&str]| {
            calls.set(calls.get() + 1);
            Some(
                names
                    .iter()
                    .filter(|n| n.ends_with(".log"))
                    .map(|n| n.to_string())
                    .collect::<HashSet<_>>(),
            )
        };
        let ttl = Duration::from_secs(60);
        let dir = Path::new("/proj");

        let first = cached_ignored_names(&cache, ttl, dir, &["a.log", "b.ts"], lookup);
        assert_eq!(calls.get(), 1);
        // Same set in another order is a hit with the same answer.
        let again = cached_ignored_names(&cache, ttl, dir, &["b.ts", "a.log"], lookup);
        assert_eq!(calls.get(), 1);
        assert_eq!(first, again);
        // A new entry changes the key.
        let grown = cached_ignored_names(&cache, ttl, dir, &["a.log", "b.ts", "c.log"], lookup);
        assert_eq!(calls.get(), 2);
        assert!(grown.unwrap().contains("c.log"));
        // Another directory is independent.
        cached_ignored_names(&cache, ttl, Path::new("/other"), &["a.log", "b.ts"], lookup);
        assert_eq!(calls.get(), 3);
    }

    #[test]
    fn ignored_names_cache_expires_and_caches_a_failed_lookup() {
        let cache: IgnoredNamesCache = Mutex::new(None);
        let calls = std::cell::Cell::new(0);
        let lookup = |_: &Path, _: &[&str]| {
            calls.set(calls.get() + 1);
            None
        };
        let dir = Path::new("/proj");
        let long = Duration::from_secs(60);
        assert!(cached_ignored_names(&cache, long, dir, &["x"], lookup).is_none());
        assert!(cached_ignored_names(&cache, long, dir, &["x"], lookup).is_none());
        assert_eq!(calls.get(), 1);
        // A zero TTL means every entry is already expired.
        cached_ignored_names(&cache, Duration::ZERO, dir, &["x"], lookup);
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn project_file_listing_sends_the_root_once() {
        let dir = tmp("listing-shape");
        std::fs::create_dir_all(dir.0.join("sub")).unwrap();
        std::fs::write(dir.0.join("sub").join("a.ts"), "x\n").unwrap();
        let cwd = dir.0.to_string_lossy().into_owned();
        let listing = project_file_listing(&cwd).unwrap();
        assert_eq!(listing.root, path_to_js(&dir.0));
        assert_eq!(
            listing.files,
            vec![ProjectFileEntry {
                name: "a.ts".into(),
                relative: "sub/a.ts".into()
            }]
        );
        let json = serde_json::to_value(&listing).unwrap();
        assert!(json["files"][0].get("path").is_none());
        // The wrapper's join must reproduce the old absolute path.
        let old = list_project_files_sync(&cwd).unwrap();
        assert_eq!(
            old[0].path,
            format!(
                "{}/{}",
                listing.root.trim_end_matches('/'),
                listing.files[0].relative
            )
        );
    }

    #[test]
    fn list_dir_falls_back_to_name_parser_outside_git() {
        let dir = tmp("list-dir-plain");
        std::fs::write(dir.0.join(".gitignore"), "secret.txt\n*.log\n").unwrap();
        std::fs::write(dir.0.join("secret.txt"), "x\n").unwrap();
        std::fs::write(dir.0.join("a.log"), "x\n").unwrap();
        std::fs::write(dir.0.join("app.ts"), "x\n").unwrap();

        let mut ignored = ignored_names(&list_dir_sync(&dir.0).unwrap());
        ignored.sort_unstable();
        assert_eq!(ignored, vec!["a.log", "secret.txt"]);
    }

    #[test]
    fn git_ls_files_includes_untracked_and_drops_ignored() {
        let dir = tmp("index-git");
        std::fs::write(dir.0.join("tracked.ts"), "x\n").unwrap();
        std::fs::write(dir.0.join("loose.ts"), "x\n").unwrap();
        std::fs::write(dir.0.join(".gitignore"), "ignored.ts\nnode_modules\n").unwrap();
        std::fs::write(dir.0.join("ignored.ts"), "x\n").unwrap();
        std::fs::create_dir_all(dir.0.join("node_modules")).unwrap();
        std::fs::write(dir.0.join("node_modules").join("pkg.js"), "x\n").unwrap();

        let init = Command::new("git")
            .args(["init"])
            .current_dir(&dir.0)
            .output();
        let Ok(init) = init else { return };
        if !init.status.success() {
            return;
        }
        let add = Command::new("git")
            .args(["add", "tracked.ts", ".gitignore"])
            .current_dir(&dir.0)
            .status();
        if add.map(|s| !s.success()).unwrap_or(true) {
            return;
        }

        let files = list_project_files_sync(&dir.0.to_string_lossy()).unwrap();
        let paths = relative_paths(&files);
        assert!(paths.contains(&"tracked.ts"));
        assert!(paths.contains(&"loose.ts"));
        assert!(!paths.contains(&"ignored.ts"));
        assert!(!paths.iter().any(|r| r.contains("node_modules")));
    }

    #[test]
    fn a_cancelled_git_listing_does_not_return_the_index() {
        let dir = tmp("index-git-cancel");
        if !init_git_commit(&dir.0, &[("tracked.ts", "x\n")]) {
            return;
        }
        let cancel = AtomicBool::new(true);
        assert!(
            git_ls_files(&dir.0, Some(&cancel)).is_none(),
            "cancelled ls-files must not look like a missing git index"
        );
        // The walk still sees the file, so falling through after a cancelled
        // `git_ls_files` would reintroduce the listing the cancel was meant
        // to drop.
        assert!(walk_project_files(&dir.0, WalkStop::Never)
            .iter()
            .any(|file| file.relative == "tracked.ts"));
        let files =
            list_project_files_sync_cancellable(&dir.0.to_string_lossy(), Some(&cancel)).unwrap();
        assert!(files.is_empty());
        assert!(git_ls_files(&dir.0, None)
            .unwrap()
            .iter()
            .any(|file| file.relative == "tracked.ts"));
    }

    fn init_git(dir: &Path, branch: &str, origin: Option<&str>) -> bool {
        let init = Command::new("git").args(["init"]).current_dir(dir).output();
        let Ok(init) = init else { return false };
        if !init.status.success() {
            return false;
        }
        let head = Command::new("git")
            .args(["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")])
            .current_dir(dir)
            .status();
        if head.map(|status| !status.success()).unwrap_or(true) {
            return false;
        }
        if let Some(url) = origin {
            let remote = Command::new("git")
                .args(["remote", "add", "origin", url])
                .current_dir(dir)
                .status();
            if remote.map(|status| !status.success()).unwrap_or(true) {
                return false;
            }
        }
        git(dir, &["config", "user.name", "Bycoda"])
            && git(dir, &["config", "user.email", "bycoda@test"])
            && git(dir, &["config", "commit.gpgsign", "false"])
            && git(dir, &["config", "core.autocrlf", "false"])
    }

    fn git_commit_for(root: &Path, message: &str) -> Result<(), String> {
        git_commit_args(root, message, &[])
    }

    fn git_commit_amend_for(root: &Path, message: &str) -> Result<(), String> {
        git_commit_args(root, message, &["--amend"])
    }

    #[test]
    fn git_info_reads_branch_and_origin_repo() {
        let dir = tmp("git-info");
        if !init_git(
            &dir.0,
            "fix-sidebar",
            Some("https://github.com/acme/widget.git"),
        ) {
            return;
        }
        let info = git_info_for(&dir.0);
        assert_eq!(info.branch.as_deref(), Some("fix-sidebar"));
        assert_eq!(info.repo.as_deref(), Some("widget"));
    }

    #[test]
    fn git_info_falls_back_to_folder_name_without_origin() {
        let dir = tmp("git-info-local");
        if !init_git(&dir.0, "main", None) {
            return;
        }
        let info = git_info_for(&dir.0);
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(
            info.repo.as_deref(),
            dir.0.file_name().and_then(|name| name.to_str())
        );
    }

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args([
                "-c",
                "user.name=Bycoda",
                "-c",
                "user.email=bycoda@test",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "Bycoda")
            .env("GIT_AUTHOR_EMAIL", "bycoda@test")
            .env("GIT_COMMITTER_NAME", "Bycoda")
            .env("GIT_COMMITTER_EMAIL", "bycoda@test")
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn init_git_commit(dir: &Path, files: &[(&str, &str)]) -> bool {
        if !init_git(dir, "main", None) {
            return false;
        }
        for (name, contents) in files {
            if std::fs::write(dir.join(name), contents).is_err() {
                return false;
            }
        }
        git(dir, &["add", "."]) && git(dir, &["commit", "-m", "init"])
    }

    #[test]
    fn status_v2_reads_branch_headers_and_entries() {
        let text = [
            "# branch.oid 1111111111111111111111111111111111111111",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -3",
            "1 .M N... 100644 100644 100644 aaaa bbbb src/with space.rs",
            "1 A. N... 000000 100644 100644 0000 cccc new.rs",
            "2 R. N... 100644 100644 100644 aaaa aaaa R100 moved.rs",
            "old name.rs",
            "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc both.rs",
            "? notes/çay.txt",
            "",
        ]
        .join("\0");
        let status = parse_status_v2(&text);
        assert_eq!(
            status.oid.as_deref(),
            Some("1111111111111111111111111111111111111111")
        );
        assert_eq!(status.head.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead_behind, Some((2, 3)));
        let seen: Vec<(StatusKind, char, char, &str)> = status
            .entries
            .iter()
            .map(|entry| (entry.kind, entry.x, entry.y, entry.path.as_str()))
            .collect();
        assert_eq!(
            seen,
            vec![
                (StatusKind::Changed, '.', 'M', "src/with space.rs"),
                (StatusKind::Changed, 'A', '.', "new.rs"),
                (StatusKind::Changed, 'R', '.', "moved.rs"),
                (StatusKind::Unmerged, 'U', 'U', "both.rs"),
                (StatusKind::Untracked, '?', '?', "notes/çay.txt"),
            ]
        );
    }

    #[test]
    fn status_v2_reads_an_unborn_or_detached_head() {
        let unborn = parse_status_v2("# branch.oid (initial)\0# branch.head main\0");
        assert_eq!(unborn.oid, None);
        assert_eq!(unborn.head.as_deref(), Some("main"));
        assert_eq!(unborn.ahead_behind, None);

        let detached = parse_status_v2("# branch.oid abcdef0123\0# branch.head (detached)\0");
        assert_eq!(detached.oid.as_deref(), Some("abcdef0123"));
        assert_eq!(detached.head, None);
    }

    #[test]
    fn git_diff_index_before_the_first_commit() {
        let dir = tmp("git-diff-unborn");
        if !init_git(&dir.0, "main", None) {
            return;
        }
        std::fs::write(dir.0.join("staged.txt"), "one\ntwo\n").unwrap();
        std::fs::write(dir.0.join("loose.txt"), "one\n").unwrap();
        assert!(git(&dir.0, &["add", "staged.txt"]));

        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.branch.as_deref(), Some("main"));
        assert_eq!(index.head, None);
        let seen: Vec<(&str, &str, i64, bool, bool)> = index
            .files
            .iter()
            .map(|file| {
                (
                    file.relative.as_str(),
                    file.status.as_str(),
                    file.additions,
                    file.staged,
                    file.unstaged,
                )
            })
            .collect();
        assert_eq!(
            seen,
            vec![
                ("loose.txt", "untracked", 1, false, true),
                ("staged.txt", "added", 2, true, false),
            ]
        );
    }

    #[test]
    fn git_diff_index_reports_deletions_and_non_ascii_paths() {
        let dir = tmp("git-diff-kinds");
        if !init_git_commit(
            &dir.0,
            &[
                ("gone.txt", "a\nb\n"),
                ("çay.txt", "bir\n"),
                ("kept.txt", "x\n"),
            ],
        ) {
            return;
        }
        std::fs::remove_file(dir.0.join("gone.txt")).unwrap();
        std::fs::write(dir.0.join("çay.txt"), "bir\niki\n").unwrap();
        // Removed from the index only: still on disk, so it reads as untracked.
        assert!(git(&dir.0, &["rm", "--cached", "-q", "kept.txt"]));

        let index = git_diff_index_for(&dir.0);
        let seen: Vec<(&str, &str, i64, i64, bool, bool)> = index
            .files
            .iter()
            .map(|file| {
                (
                    file.relative.as_str(),
                    file.status.as_str(),
                    file.additions,
                    file.deletions,
                    file.staged,
                    file.unstaged,
                )
            })
            .collect();
        assert_eq!(
            seen,
            vec![
                ("gone.txt", "deleted", 0, 2, false, true),
                ("kept.txt", "untracked", 1, 1, true, true),
                ("çay.txt", "modified", 1, 0, false, true),
            ]
        );
        assert_eq!(git_diff_stats_for(&dir.0).files, 3);
    }

    #[test]
    fn git_diff_stats_are_zero_outside_a_repo() {
        let dir = tmp("git-diff-none");
        std::fs::write(dir.0.join("notes.txt"), "hello\n").unwrap();
        assert_eq!(
            git_diff_stats_for(&dir.0),
            GitDiffStats {
                files: 0,
                additions: 0,
                deletions: 0
            }
        );
    }

    #[test]
    fn git_diff_stats_count_unstaged_and_untracked() {
        let dir = tmp("git-diff-dirty");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\ngamma\ndelta\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\nworld\n").unwrap();
        std::fs::write(dir.0.join("ignored.txt"), "nope\n").unwrap();
        std::fs::write(dir.0.join(".gitignore"), "ignored.txt\n").unwrap();

        let stats = git_diff_stats_for(&dir.0);
        // a.txt: -beta +delta; new.txt: +2; .gitignore: +1 untracked
        assert_eq!(stats.files, 3);
        assert_eq!(stats.additions, 4);
        assert_eq!(stats.deletions, 1);
    }

    #[test]
    fn git_diff_stats_are_zero_when_clean() {
        let dir = tmp("git-diff-clean");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(
            git_diff_stats_for(&dir.0),
            GitDiffStats {
                files: 0,
                additions: 0,
                deletions: 0
            }
        );
    }

    #[test]
    fn git_diff_index_lists_modified_and_untracked() {
        let dir = tmp("git-diff-index");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\ngamma\ndelta\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\nworld\n").unwrap();

        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.branch.as_deref(), Some("main"));
        assert_eq!(index.files.len(), 2);

        let modified = index
            .files
            .iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert_eq!(modified.status, "modified");
        assert_eq!(modified.additions, 1);
        assert_eq!(modified.deletions, 1);

        let untracked = index
            .files
            .iter()
            .find(|file| file.relative == "new.txt")
            .unwrap();
        assert_eq!(untracked.status, "untracked");
        assert_eq!(untracked.additions, 2);
        assert_eq!(untracked.deletions, 0);
    }

    #[test]
    fn git_diff_files_keep_paths_relative_to_nested_workspace() {
        let dir = tmp("git-diff-nested-workspace");
        let workspace = dir.0.join("sub");
        std::fs::create_dir_all(workspace.join("sub")).unwrap();
        assert!(init_git_commit(
            &dir.0,
            &[("sub/file.txt", "original\n"), ("sub/second.txt", "old\n")],
        ));
        std::fs::write(workspace.join("file.txt"), "staged\n").unwrap();
        assert!(git(&dir.0, &["add", "--", "sub/file.txt"]));
        std::fs::write(workspace.join("second.txt"), "unstaged\n").unwrap();
        // Without --relative this collides with the tracked sub/file.txt key.
        std::fs::write(workspace.join("sub/file.txt"), "untracked\n").unwrap();

        let changes = git_diff_files_for(&workspace);
        assert_eq!(changes.files.len(), 3);
        for (relative, staged, unstaged) in [
            ("file.txt", true, false),
            ("second.txt", false, true),
            ("sub/file.txt", false, true),
        ] {
            let file = changes
                .files
                .iter()
                .find(|file| file.relative == relative)
                .unwrap();
            assert_eq!(file.path, path_to_js(&workspace.join(relative)));
            assert_eq!((file.staged, file.unstaged), (staged, unstaged));
        }
        let staged = git_file_diff_for(&workspace, "file.txt", true).unwrap();
        assert_eq!(staged.original, "original\n");
        assert_eq!(staged.current, "staged\n");
    }

    #[test]
    fn git_file_diff_returns_both_sides() {
        let dir = tmp("git-file-diff");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\ngamma\ndelta\n").unwrap();

        let diff = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.original, "alpha\nbeta\ngamma\n");
        assert_eq!(diff.current, "alpha\ngamma\ndelta\n");
        assert!(!diff.binary);
        assert!(!diff.too_large);
    }

    #[test]
    fn git_file_diff_staged_reads_head_and_index() {
        let dir = tmp("git-file-diff-staged");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();

        let diff = git_file_diff_for(&dir.0, "a.txt", true).unwrap();
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.original, "alpha\n");
        assert_eq!(diff.current, "beta\n");
    }

    #[test]
    fn git_file_diff_staged_handles_additions_and_deletions() {
        let dir = tmp("git-file-diff-staged-status");
        if !init_git_commit(&dir.0, &[("gone.txt", "old\n")]) {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "new\n").unwrap();
        std::fs::remove_file(dir.0.join("gone.txt")).unwrap();
        assert!(git(&dir.0, &["add", "-A"]));

        let added = git_file_diff_for(&dir.0, "new.txt", true).unwrap();
        assert_eq!(added.status, "added");
        assert_eq!(added.original, "");
        assert_eq!(added.current, "new\n");

        let deleted = git_file_diff_for(&dir.0, "gone.txt", true).unwrap();
        assert_eq!(deleted.status, "deleted");
        assert_eq!(deleted.original, "old\n");
        assert_eq!(deleted.current, "");
    }

    #[test]
    fn git_file_diff_separates_staged_and_unstaged_changes() {
        let dir = tmp("git-file-diff-partial");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\ndelta\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\nBETA\ngamma\nDELTA\n").unwrap();
        git_stage_contents_for(&dir.0, "a.txt", b"alpha\nBETA\ngamma\ndelta\n", None).unwrap();

        let staged = git_file_diff_for(&dir.0, "a.txt", true).unwrap();
        assert_eq!(staged.original, "alpha\nbeta\ngamma\ndelta\n");
        assert_eq!(staged.current, "alpha\nBETA\ngamma\ndelta\n");

        let unstaged = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(unstaged.original, "alpha\nBETA\ngamma\ndelta\n");
        assert_eq!(unstaged.current, "alpha\nBETA\ngamma\nDELTA\n");
    }

    #[test]
    fn git_file_diff_untracked_has_empty_original() {
        let dir = tmp("git-file-diff-new");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "hello\n").unwrap();

        let diff = git_file_diff_for(&dir.0, "new.txt", false).unwrap();
        assert_eq!(diff.status, "untracked");
        assert_eq!(diff.original, "");
        assert_eq!(diff.current, "hello\n");
    }

    #[test]
    fn git_file_diff_deleted_has_empty_current() {
        let dir = tmp("git-file-diff-del");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::remove_file(dir.0.join("a.txt")).unwrap();

        let diff = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(diff.status, "deleted");
        assert_eq!(diff.original, "alpha\n");
        assert_eq!(diff.current, "");
    }

    #[test]
    fn git_file_diff_rejects_path_escape() {
        let dir = tmp("git-file-diff-escape");
        assert!(git_file_diff_for(&dir.0, "../secret.txt", false).is_err());
    }

    #[test]
    fn git_file_diff_rejects_outside_a_repo() {
        let dir = tmp("git-file-diff-none");
        std::fs::write(dir.0.join("notes.txt"), "hello\n").unwrap();
        assert!(git_file_diff_for(&dir.0, "notes.txt", false).is_err());
    }

    #[test]
    fn parse_git_decorations_classifies_head_local_remote_and_tags() {
        let remotes = vec!["origin".to_string()];
        let (head, refs) = parse_git_decorations(
            "HEAD -> main, origin/main, origin/HEAD, tag: v0.1.30, fix/foo",
            Some("abc"),
            "abc",
            &remotes,
        );
        assert!(head);
        assert_eq!(
            refs,
            vec![
                GitHistoryRef {
                    name: "main".into(),
                    kind: "local".into()
                },
                GitHistoryRef {
                    name: "origin/main".into(),
                    kind: "remote".into()
                },
                GitHistoryRef {
                    name: "v0.1.30".into(),
                    kind: "tag".into()
                },
                GitHistoryRef {
                    name: "fix/foo".into(),
                    kind: "local".into()
                },
            ]
        );
    }

    #[test]
    fn git_history_lists_commits_parents_and_head() {
        let dir = tmp("git-history");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "second"]));

        let history = git_history_for(&dir.0, Some(10)).unwrap();
        assert_eq!(history.commits.len(), 2);
        assert_eq!(history.commits[0].subject, "second");
        assert_eq!(history.commits[1].subject, "init");
        assert_eq!(
            history.commits[0].parents,
            vec![history.commits[1].sha.clone()]
        );
        assert!(history.commits[0].head);
        assert!(!history.commits[1].head);
        assert!(history.commits[0]
            .refs
            .iter()
            .any(|r| r.kind == "local" && r.name == "main"));
    }

    #[test]
    fn git_history_empty_outside_a_repo() {
        let dir = tmp("git-history-none");
        assert_eq!(
            git_history_for(&dir.0, None).unwrap(),
            GitHistory::default()
        );
    }

    #[test]
    fn git_commit_diff_reads_parent_and_current() {
        let dir = tmp("git-commit-diff");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "update a"]));
        let history = git_history_for(&dir.0, Some(1)).unwrap();
        let sha = &history.commits[0].sha;

        let files = git_commit_files_for(&dir.0, sha).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative, "a.txt");
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].path, path_to_js(&dir.0.join("a.txt")));

        let diff = git_commit_file_diff_for(&dir.0, sha, "a.txt").unwrap();
        assert_eq!(diff.original, "alpha\n");
        assert_eq!(diff.current, "beta\n");
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.path, path_to_js(&dir.0.join("a.txt")));
    }

    #[test]
    fn git_commit_diff_root_commit_is_added() {
        let dir = tmp("git-commit-root");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        let history = git_history_for(&dir.0, Some(1)).unwrap();
        let sha = &history.commits[0].sha;
        let files = git_commit_files_for(&dir.0, sha).unwrap();
        assert_eq!(files[0].status, "added");
        let diff = git_commit_file_diff_for(&dir.0, sha, "a.txt").unwrap();
        assert_eq!(diff.original, "");
        assert_eq!(diff.current, "alpha\n");
        assert_eq!(diff.status, "added");
    }

    #[test]
    fn git_commit_diff_rejects_bad_sha_and_path() {
        let dir = tmp("git-commit-bad");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git_commit_files_for(&dir.0, "../oops").is_err());
        assert!(git_commit_files_for(&dir.0, "not-hex!").is_err());
        let history = git_history_for(&dir.0, Some(1)).unwrap();
        let sha = &history.commits[0].sha;
        assert!(git_commit_file_diff_for(&dir.0, sha, "../secret.txt").is_err());
    }

    #[test]
    fn git_history_records_merge_parents() {
        let dir = tmp("git-history-merge");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "feature"]));
        std::fs::write(dir.0.join("feat.txt"), "one\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "feature work"]));
        assert!(git(&dir.0, &["checkout", "main"]));
        std::fs::write(dir.0.join("main.txt"), "two\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "main work"]));
        assert!(git(
            &dir.0,
            &["merge", "feature", "--no-ff", "-m", "Merge feature"]
        ));

        let history = git_history_for(&dir.0, Some(20)).unwrap();
        let merge = history
            .commits
            .iter()
            .find(|commit| commit.subject == "Merge feature")
            .unwrap();
        assert_eq!(merge.parents.len(), 2);
    }

    #[test]
    fn git_history_skips_stash_and_unmerged_branches() {
        let dir = tmp("git-history-auto");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "feature"]));
        std::fs::write(dir.0.join("feat.txt"), "one\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "feature only"]));
        std::fs::write(dir.0.join("wip.txt"), "stash me\n").unwrap();
        assert!(git(&dir.0, &["stash", "push", "-u", "-m", "wip stash"]));
        assert!(git(&dir.0, &["checkout", "main"]));
        std::fs::write(dir.0.join("main.txt"), "two\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "main only"]));

        let history = git_history_for(&dir.0, Some(20)).unwrap();
        let subjects: Vec<&str> = history
            .commits
            .iter()
            .map(|commit| commit.subject.as_str())
            .collect();
        assert!(subjects.contains(&"main only"));
        assert!(subjects.contains(&"init"));
        assert!(!subjects.iter().any(|s| s.contains("feature only")));
        assert!(!subjects
            .iter()
            .any(|s| s.contains("wip stash") || s.contains("WIP on")));
        assert!(!history
            .commits
            .iter()
            .any(|commit| commit.refs.iter().any(|r| r.name.contains("stash"))));
    }

    #[test]
    fn git_reliability_preserves_working_files_when_index_reads_fail() {
        let dir = tmp("git-reliability-corrupt");
        if !init_git_commit(&dir.0, &[("a.txt", "base\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "valuable draft\n").unwrap();
        std::fs::write(dir.0.join(".git/index"), "invalid index").unwrap();
        assert!(git_discard_file_for(&dir.0, "a.txt")
            .unwrap_err()
            .contains("nothing was discarded"));
        assert!(git_stage_all_for(&dir.0).is_err());
        assert!(git_commit_args(&dir.0, "never commit", &[]).is_err());
        assert!(git_discard_all_for(&dir.0).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "valuable draft\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join(".git/index")).unwrap(),
            "invalid index"
        );
    }

    #[test]
    fn git_reliability_discard_selection_preserves_index_and_other_drafts() {
        let dir = tmp("git-reliability-discard");
        if !init_git_commit(&dir.0, &[("a[1].txt", "base\n"), ("keep.txt", "keep\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a[1].txt"), "staged\n").unwrap();
        git_stage_file_for(&dir.0, "a[1].txt").unwrap();
        std::fs::write(dir.0.join("a[1].txt"), "draft\n").unwrap();
        std::fs::write(dir.0.join("keep.txt"), "keep draft\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "new\n").unwrap();
        assert!(
            git_discard_selection_for(&dir.0, Some(&["new.txt".into(), "missing.txt".into()]))
                .is_err()
        );
        assert!(dir.0.join("new.txt").exists());
        git_discard_selection_for(&dir.0, Some(&["a[1].txt".into(), "new.txt".into()])).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a[1].txt")).unwrap(),
            "staged\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("keep.txt")).unwrap(),
            "keep draft\n"
        );
        assert_eq!(git_run(&dir.0, &["show", ":a[1].txt"]).unwrap(), "staged\n");
        assert!(!dir.0.join("new.txt").exists());
    }

    #[test]
    fn git_reliability_unstages_both_names_of_selected_rename() {
        let dir = tmp("git-reliability-rename");
        if !init_git_commit(&dir.0, &[("old.txt", "base\n"), ("keep.txt", "keep\n")]) {
            return;
        }
        std::fs::rename(dir.0.join("old.txt"), dir.0.join("new.txt")).unwrap();
        std::fs::write(dir.0.join("keep.txt"), "staged\n").unwrap();
        git_stage_all_for(&dir.0).unwrap();
        git_checked(&dir.0, &["config", "diff.renames", "false"]).unwrap();
        git_index_files_for(&dir.0, &["new.txt".into()], false).unwrap();
        assert_eq!(
            git_run(&dir.0, &["diff", "--cached", "--name-only"])
                .unwrap()
                .trim(),
            "keep.txt"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("new.txt")).unwrap(),
            "base\n"
        );
        assert!(!dir.0.join("old.txt").exists());
    }

    #[test]
    fn git_reliability_serializes_whole_mutations_from_subdirectories() {
        let dir = tmp("git-reliability-queue");
        std::fs::create_dir_all(dir.0.join(".git")).unwrap();
        std::fs::create_dir_all(dir.0.join("sub")).unwrap();
        let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let mut threads = Vec::new();
        for root in [dir.0.clone(), dir.0.join("sub")] {
            let active = active.clone();
            let barrier = barrier.clone();
            threads.push(thread::spawn(move || {
                barrier.wait();
                with_git_mutation(&root, || {
                    assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                    thread::sleep(Duration::from_millis(100));
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                })
                .unwrap();
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }
        assert!(with_git_mutation(&dir.0, || Err::<(), _>("expected failure".into())).is_err());
        with_git_mutation(&dir.0, || Ok(())).unwrap();
    }

    #[test]
    fn git_reliability_fetch_overlaps_local_but_not_exclusive_mutations() {
        let dir = tmp("git-fetch-lanes");
        std::fs::create_dir_all(dir.0.join(".git")).unwrap();
        std::fs::create_dir_all(dir.0.join("sub")).unwrap();
        let (fetch_started, ready) = mpsc::channel();
        let (release_fetch, fetch_release) = mpsc::channel();
        let root = dir.0.clone();
        let fetch = thread::spawn(move || {
            with_git_mutation_scope(&root, GitMutationScope::Fetch, || {
                fetch_started.send(()).unwrap();
                fetch_release.recv().unwrap();
                Ok(())
            })
            .unwrap();
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();

        let (local_done, local_ready) = mpsc::channel();
        let root = dir.0.join("sub");
        let local = thread::spawn(move || {
            with_git_mutation_scope(&root, GitMutationScope::Local, || Ok(())).unwrap();
            local_done.send(()).unwrap();
        });
        local_ready.recv_timeout(Duration::from_secs(5)).unwrap();
        local.join().unwrap();

        let (exclusive_started, exclusive_ready) = mpsc::channel();
        let (release_exclusive, exclusive_release) = mpsc::channel();
        let root = dir.0.clone();
        let exclusive = thread::spawn(move || {
            with_git_mutation(&root, || {
                exclusive_started.send(()).unwrap();
                exclusive_release.recv().unwrap();
                Ok(())
            })
            .unwrap();
        });
        assert!(exclusive_ready
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_fetch.send(()).unwrap();
        fetch.join().unwrap();
        exclusive_ready
            .recv_timeout(Duration::from_secs(5))
            .unwrap();

        let (next_started, next_ready) = mpsc::channel();
        let root = dir.0.clone();
        let next = thread::spawn(move || {
            with_git_mutation_scope(&root, GitMutationScope::Fetch, || {
                next_started.send(()).unwrap();
                Ok(())
            })
            .unwrap();
        });
        assert!(next_ready.recv_timeout(Duration::from_millis(50)).is_err());
        release_exclusive.send(()).unwrap();
        exclusive.join().unwrap();
        next_ready.recv_timeout(Duration::from_secs(5)).unwrap();
        next.join().unwrap();
    }

    #[test]
    fn git_bulk_index_selection_preserves_unselected_files() {
        let dir = tmp("git-bulk-selection");
        if !init_git_commit(&dir.0, &[("base.txt", "base\n")]) {
            return;
        }
        let paths: Vec<_> = (0..700)
            .map(|i| format!("{i:03}-[literal] {}.txt", "x".repeat(100)))
            .collect();
        for path in &paths {
            std::fs::write(dir.0.join(path), "new\n").unwrap();
        }
        git_index_files_for(&dir.0, &paths[..300], true).unwrap();
        let staged = git_run(&dir.0, &["diff", "--cached", "--name-only", "-z"]).unwrap();
        assert_eq!(
            staged
                .split('\0')
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>(),
            paths[..300]
        );
        git_index_files_for(&dir.0, &paths[..200], false).unwrap();
        let staged = git_run(&dir.0, &["diff", "--cached", "--name-only", "-z"]).unwrap();
        assert_eq!(
            staged
                .split('\0')
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>(),
            paths[200..300]
        );
        assert!(paths.iter().all(|p| dir.0.join(p).exists()));
    }

    #[test]
    fn git_bulk_index_unborn_and_validation() {
        let dir = tmp("git-bulk-unborn");
        if git_checked(&dir.0, &["init", "-q"]).is_err() {
            return;
        }
        std::fs::write(dir.0.join("a[1].txt"), "new\n").unwrap();
        std::fs::write(dir.0.join("a1.txt"), "other\n").unwrap();
        assert!(
            git_index_files_for(&dir.0, &["a[1].txt".into(), "../outside.txt".into()], true)
                .is_err()
        );
        assert!(git_run(&dir.0, &["ls-files"]).unwrap().is_empty());
        let paths = vec!["a[1].txt".into()];
        git_index_files_for(&dir.0, &paths, true).unwrap();
        assert_eq!(git_run(&dir.0, &["ls-files"]).unwrap().trim(), "a[1].txt");
        git_index_files_for(&dir.0, &paths, false).unwrap();
        assert!(git_run(&dir.0, &["ls-files"]).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a[1].txt")).unwrap(),
            "new\n"
        );
    }

    #[test]
    fn git_bulk_index_waits_for_external_lock_without_deleting_it() {
        let dir = tmp("git-bulk-lock");
        if !init_git_commit(&dir.0, &[("a.txt", "base\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "new\n").unwrap();
        let lock = dir.0.join(".git/index.lock");
        std::fs::write(&lock, "external writer").unwrap();
        let release_path = lock.clone();
        let release = thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            std::fs::remove_file(release_path).unwrap();
        });
        git_index_files_for(&dir.0, &["a.txt".into()], true).unwrap();
        release.join().unwrap();
        std::fs::write(&lock, "keep external lock").unwrap();
        assert!(git_index_files_for(&dir.0, &["a.txt".into()], false)
            .unwrap_err()
            .contains("index.lock"));
        assert_eq!(
            std::fs::read_to_string(&lock).unwrap(),
            "keep external lock"
        );
    }

    #[test]
    fn git_stage_and_unstage_file() {
        let dir = tmp("git-stage");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        let staged = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(staged.staged);
        assert!(!staged.unstaged);

        git_unstage_file_for(&dir.0, "a.txt").unwrap();
        let unstaged = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(!unstaged.staged);
        assert!(unstaged.unstaged);
    }

    #[test]
    fn git_literal_file_actions_do_not_match_other_paths() {
        let dir = tmp("git-literal-paths");
        if !init_git_commit(&dir.0, &[("a[1].txt", "old\n"), ("a1.txt", "old\n")]) {
            return;
        }
        for name in ["a[1].txt", "a1.txt"] {
            std::fs::write(dir.0.join(name), "new\n").unwrap();
        }
        git_stage_file_for(&dir.0, "a[1].txt").unwrap();
        assert_eq!(
            git_stdout(&dir.0, &["diff", "--cached", "--name-only"])
                .unwrap()
                .trim(),
            "a[1].txt"
        );
        git_stage_all_for(&dir.0).unwrap();
        git_unstage_file_for(&dir.0, "a[1].txt").unwrap();
        assert_eq!(
            git_stdout(&dir.0, &["diff", "--cached", "--name-only"])
                .unwrap()
                .trim(),
            "a1.txt"
        );
        std::fs::write(dir.0.join("a1.txt"), "keep me\n").unwrap();
        git_discard_file_for(&dir.0, "a[1].txt").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a[1].txt")).unwrap(),
            "old\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a1.txt")).unwrap(),
            "keep me\n"
        );
    }

    #[test]
    fn git_unstage_before_first_commit_keeps_files() {
        let dir = tmp("git-unborn-unstage");
        assert!(git_unstage_all_for(&dir.0).is_err());
        if !git(&dir.0, &["init"]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "a\n").unwrap();
        std::fs::write(dir.0.join("b.txt"), "b\n").unwrap();
        git_stage_all_for(&dir.0).unwrap();
        git_unstage_file_for(&dir.0, "a.txt").unwrap();
        assert_eq!(git_stdout(&dir.0, &["ls-files"]).unwrap().trim(), "b.txt");
        git_unstage_all_for(&dir.0).unwrap();
        git_unstage_all_for(&dir.0).unwrap();
        assert!(git_stdout(&dir.0, &["ls-files"])
            .unwrap_or_default()
            .trim()
            .is_empty());
        assert_eq!(std::fs::read_to_string(dir.0.join("a.txt")).unwrap(), "a\n");
        assert_eq!(std::fs::read_to_string(dir.0.join("b.txt")).unwrap(), "b\n");
        std::fs::write(dir.0.join(".git/index"), "broken").unwrap();
        assert!(git_unstage_all_for(&dir.0).is_err());
    }

    #[test]
    fn git_unstage_literal_directory_before_first_commit_keeps_sibling() {
        let dir = tmp("git-unborn-literal-directory");
        if !git(&dir.0, &["init"]) {
            return;
        }
        for folder in ["src[1]", "src1"] {
            std::fs::create_dir_all(dir.0.join(folder).join("nested")).unwrap();
            std::fs::write(dir.0.join(folder).join("nested/a.txt"), "keep\n").unwrap();
        }
        git_stage_file_for(&dir.0, "src[1]").unwrap();
        assert_eq!(
            git_stdout(&dir.0, &["ls-files"]).unwrap().trim(),
            "src[1]/nested/a.txt"
        );
        git_stage_file_for(&dir.0, "src1").unwrap();
        git_unstage_file_for(&dir.0, "src[1]").unwrap();
        assert_eq!(
            git_stdout(&dir.0, &["ls-files"]).unwrap().trim(),
            "src1/nested/a.txt"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("src[1]/nested/a.txt")).unwrap(),
            "keep\n"
        );
    }

    #[test]
    fn git_stage_and_unstage_directory() {
        let dir = tmp("git-stage-directory");
        std::fs::create_dir_all(dir.0.join("src/nested")).unwrap();
        std::fs::create_dir_all(dir.0.join("src-other")).unwrap();
        if !init_git_commit(
            &dir.0,
            &[
                ("src/app.ts", "before\n"),
                ("src/nested/deleted.ts", "delete me\n"),
                ("src-other/app.ts", "before\n"),
                ("ready.txt", "before\n"),
                (".gitignore", "src/ignored.txt\n"),
            ],
        ) {
            return;
        }
        std::fs::write(dir.0.join("src/app.ts"), "after\n").unwrap();
        std::fs::remove_dir_all(dir.0.join("src/nested")).unwrap();
        std::fs::create_dir_all(dir.0.join("src/added")).unwrap();
        std::fs::write(dir.0.join("src/added/new.ts"), "new\n").unwrap();
        std::fs::write(dir.0.join("src/ignored.txt"), "ignored\n").unwrap();
        std::fs::write(dir.0.join("src-other/app.ts"), "outside\n").unwrap();
        std::fs::write(dir.0.join("ready.txt"), "ready\n").unwrap();
        git_stage_file_for(&dir.0, "ready.txt").unwrap();

        git_stage_file_for(&dir.0, "src").unwrap();
        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.files.len(), 5);
        for file in &index.files {
            let in_folder = file.relative.starts_with("src/");
            assert_eq!(file.staged, in_folder || file.relative == "ready.txt");
            assert_eq!(file.unstaged, file.relative == "src-other/app.ts");
        }

        git_unstage_file_for(&dir.0, "src").unwrap();
        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.files.len(), 5);
        for file in &index.files {
            assert_eq!(file.staged, file.relative == "ready.txt");
            assert_eq!(file.unstaged, file.relative != "ready.txt");
        }
        assert_eq!(
            std::fs::read_to_string(dir.0.join("src/app.ts")).unwrap(),
            "after\n"
        );
        assert!(!dir.0.join("src/nested").exists());
    }

    #[test]
    fn git_stage_and_unstage_deleted_directory() {
        let dir = tmp("git-stage-deleted-directory");
        std::fs::create_dir_all(dir.0.join("deleted/nested")).unwrap();
        if !init_git_commit(&dir.0, &[("deleted/nested/file.ts", "before\n")]) {
            return;
        }
        std::fs::remove_dir_all(dir.0.join("deleted")).unwrap();
        git_stage_file_for(&dir.0, "deleted").unwrap();
        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.files.len(), 1);
        assert!(index.files[0].staged);
        assert!(!index.files[0].unstaged);

        git_unstage_file_for(&dir.0, "deleted").unwrap();
        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.files.len(), 1);
        assert!(!index.files[0].staged);
        assert!(index.files[0].unstaged);
        assert!(!dir.0.join("deleted").exists());
    }

    #[test]
    fn git_stage_contents_stages_partial_hunk() {
        let dir = tmp("git-stage-contents");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\ndelta\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\nBETA\ngamma\nDELTA\n").unwrap();
        git_stage_contents_for(&dir.0, "a.txt", b"alpha\nBETA\ngamma\ndelta\n", None).unwrap();

        let file = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(file.staged);
        assert!(file.unstaged);

        let diff = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(diff.original, "alpha\nBETA\ngamma\ndelta\n");
        assert_eq!(diff.current, "alpha\nBETA\ngamma\nDELTA\n");
    }

    #[test]
    fn git_stage_contents_rejects_stale_base_and_preserves_external_lock() {
        let dir = tmp("git-stage-stale");
        let base = b"first\ncontext\nsecond\n";
        if !init_git_commit(&dir.0, &[("a.txt", "first\ncontext\nsecond\n")]) {
            return;
        }
        let external = b"first\ncontext\nSECOND\n";
        git_stage_contents_for(&dir.0, "a.txt", external, Some(base)).unwrap();
        let index_path = dir.0.join(".git/index");
        let before = std::fs::read(&index_path).unwrap();
        assert!(
            git_stage_contents_for(&dir.0, "a.txt", b"FIRST\ncontext\nsecond\n", Some(base))
                .unwrap_err()
                .contains("index changed")
        );
        assert_eq!(std::fs::read(&index_path).unwrap(), before);
        let lock = dir.0.join(".git/index.lock");
        std::fs::write(&lock, "another writer").unwrap();
        assert!(git_stage_contents_for(&dir.0, "a.txt", external, Some(external)).is_err());
        assert_eq!(std::fs::read(&lock).unwrap(), b"another writer");
        std::fs::remove_file(lock).unwrap();
        git_stage_contents_for(&dir.0, "a.txt", b"FIRST\ncontext\nSECOND\n", Some(external))
            .unwrap();
        assert_eq!(
            git_run(&dir.0, &["show", ":a.txt"]).unwrap(),
            "FIRST\ncontext\nSECOND\n"
        );
    }

    #[test]
    fn git_stage_contents_guards_untracked_before_first_commit() {
        let dir = tmp("git-stage-first-hunk");
        if !git(&dir.0, &["init"]) {
            return;
        }
        git_checked(&dir.0, &["config", "core.autocrlf", "false"]).unwrap();
        std::fs::write(dir.0.join("new.txt"), "first\nsecond\n").unwrap();
        git_stage_contents_for(&dir.0, "new.txt", b"first\n", Some(b"")).unwrap();
        assert_eq!(git_run(&dir.0, &["show", ":new.txt"]).unwrap(), "first\n");
    }

    #[test]
    fn git_discard_restores_tracked_and_deletes_untracked() {
        let dir = tmp("git-discard");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\n").unwrap();

        git_discard_file_for(&dir.0, "a.txt").unwrap();
        git_discard_file_for(&dir.0, "new.txt").unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "alpha\n"
        );
        assert!(!dir.0.join("new.txt").exists());
        assert!(git_diff_index_for(&dir.0).files.is_empty());
    }

    #[test]
    fn git_discard_all_restores_unstaged_and_keeps_staged() {
        let dir = tmp("git-discard-all");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n"), ("b.txt", "one\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        std::fs::write(dir.0.join("b.txt"), "two\n").unwrap();
        git_stage_file_for(&dir.0, "b.txt").unwrap();
        std::fs::write(dir.0.join("b.txt"), "three\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\n").unwrap();

        git_discard_all_for(&dir.0).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "alpha\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("b.txt")).unwrap(),
            "two\n"
        );
        assert!(!dir.0.join("new.txt").exists());
        let file = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "b.txt")
            .unwrap();
        assert!(file.staged);
        assert!(!file.unstaged);
        assert!(git_diff_index_for(&dir.0)
            .files
            .iter()
            .all(|file| !file.unstaged));
    }

    #[test]
    fn git_discard_keeps_staged_hunks() {
        let dir = tmp("git-discard-staged");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        std::fs::write(dir.0.join("a.txt"), "gamma\n").unwrap();
        git_discard_file_for(&dir.0, "a.txt").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "beta\n"
        );
        let file = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(file.staged);
        assert!(!file.unstaged);
    }

    #[test]
    fn git_commit_clears_staged_files() {
        let dir = tmp("git-commit");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        git_commit_for(&dir.0, "update a").unwrap();
        let index = git_diff_index_for(&dir.0);
        assert!(index.files.is_empty());
        assert_eq!(index.head, git_stdout(&dir.0, &["rev-parse", "HEAD"]));
        assert_eq!(
            git_stdout(&dir.0, &["log", "-1", "--pretty=%s"]).as_deref(),
            Some("update a")
        );
    }

    #[test]
    fn git_commit_rejects_empty_message() {
        let dir = tmp("git-commit-empty");
        assert!(git_commit_for(&dir.0, "   ").is_err());
    }

    #[test]
    fn git_commit_amend_rewrites_head_with_staged_changes() {
        let dir = tmp("git-commit-amend");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        git_commit_amend_for(&dir.0, "amended").unwrap();
        assert!(git_diff_index_for(&dir.0).files.is_empty());
        assert_eq!(
            git_stdout(&dir.0, &["rev-list", "--count", "HEAD"]).as_deref(),
            Some("1")
        );
        assert_eq!(
            git_stdout(&dir.0, &["log", "-1", "--pretty=%s"]).as_deref(),
            Some("amended")
        );
        assert_eq!(
            git_stdout(&dir.0, &["show", "HEAD:a.txt"]).as_deref(),
            Some("beta")
        );
    }

    #[test]
    fn git_commit_amend_rewords_without_staged_changes() {
        let dir = tmp("git-commit-reword");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        git_commit_amend_for(&dir.0, "reworded").unwrap();
        assert_eq!(
            git_stdout(&dir.0, &["rev-list", "--count", "HEAD"]).as_deref(),
            Some("1")
        );
        assert_eq!(
            git_stdout(&dir.0, &["log", "-1", "--pretty=%s"]).as_deref(),
            Some("reworded")
        );
    }

    #[test]
    fn git_head_message_returns_subject_and_body() {
        let dir = tmp("git-head-message");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        git_commit_for(&dir.0, "Subject line\n\nBody text").unwrap();
        assert_eq!(
            git_head_message_for(&dir.0).unwrap(),
            "Subject line\n\nBody text"
        );
    }

    #[test]
    fn git_head_message_fails_without_commits() {
        let dir = tmp("git-head-message-empty");
        if !init_git(&dir.0, "main", None) {
            return;
        }
        assert!(git_head_message_for(&dir.0).is_err());
    }

    #[test]
    fn git_staged_context_reads_cached_diff() {
        let dir = tmp("git-staged-context");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        let context = git_staged_context_for(&dir.0).unwrap();
        assert_eq!(context.branch.as_deref(), Some("main"));
        assert!(context.summary.contains("a.txt"));
        assert!(context.patch.contains("beta"));
    }

    #[test]
    fn git_staged_context_falls_back_to_unstaged() {
        let dir = tmp("git-staged-unstaged");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "gamma\n").unwrap();
        let context = git_staged_context_for(&dir.0).unwrap();
        assert!(context.patch.contains("gamma"));
    }

    #[test]
    fn git_sync_counts_unpushed_commits() {
        let repo = tmp("git-ahead-repo");
        let origin = tmp("git-ahead-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
        {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&repo.0, "a.txt").unwrap();
        git_commit_for(&repo.0, "second").unwrap();
        let index = git_diff_index_for(&repo.0);
        assert_eq!(index.remote.as_deref(), Some("origin"));
        assert_eq!(index.upstream.as_deref(), Some("origin/main"));
        assert_eq!(index.default_branch.as_deref(), Some("main"));
        assert_eq!(index.ahead, 1);
        assert_eq!(index.behind, 0);
        assert_eq!(index.ahead_of_default, 1);
    }

    #[test]
    fn git_sync_counts_feature_branch_without_upstream() {
        let repo = tmp("git-feature-repo");
        let origin = tmp("git-feature-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
            || !git(&repo.0, &["checkout", "-b", "feature"])
        {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&repo.0, "a.txt").unwrap();
        git_commit_for(&repo.0, "feature work").unwrap();
        let index = git_diff_index_for(&repo.0);
        assert_eq!(index.branch.as_deref(), Some("feature"));
        assert_eq!(index.upstream, None);
        assert_eq!(index.ahead, 1);
        assert_eq!(index.ahead_of_default, 1);
        let range = git_range_context_for(&repo.0).unwrap();
        assert_eq!(range.base, "main");
        assert_eq!(range.head, "feature");
        assert!(range.commit_summary.contains("feature work"));
    }

    #[test]
    fn git_sync_marks_head_pushed_without_upstream() {
        let repo = tmp("git-pushed-repo");
        let origin = tmp("git-pushed-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
            || !git(&repo.0, &["checkout", "-b", "feature"])
        {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&repo.0, "a.txt").unwrap();
        git_commit_for(&repo.0, "feature work").unwrap();
        assert!(!git_diff_index_for(&repo.0).head_pushed);
        if !git(&repo.0, &["push", "origin", "feature"]) {
            return;
        }
        let index = git_diff_index_for(&repo.0);
        assert_eq!(index.upstream, None);
        assert!(index.head_pushed);
    }

    #[test]
    fn git_sync_pulls_then_pushes() {
        let origin = tmp("git-sync-origin");
        let a = tmp("git-sync-a");
        let b = tmp("git-sync-b");
        if !init_git_commit(&a.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&a.0, &["remote", "add", "origin", &origin_url])
            || !git(&a.0, &["push", "-u", "origin", "main"])
            || !git(&origin.0, &["symbolic-ref", "HEAD", "refs/heads/main"])
            || Command::new("git")
                .args(["clone", "-b", "main", &origin_url, "."])
                .current_dir(&b.0)
                .status()
                .map(|status| !status.success())
                .unwrap_or(true)
            || !git(&b.0, &["config", "user.name", "Bycoda"])
            || !git(&b.0, &["config", "user.email", "bycoda@test"])
            || !git(&b.0, &["config", "commit.gpgsign", "false"])
            || !git(&b.0, &["config", "core.autocrlf", "false"])
            || !git(&b.0, &["checkout", "--", "."])
        {
            return;
        }

        std::fs::write(a.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&a.0, "a.txt").unwrap();
        git_commit_for(&a.0, "from-a").unwrap();
        git_sync_changes_for(&a.0).unwrap();

        git_sync_changes_for(&b.0).unwrap();
        assert_eq!(
            std::fs::read_to_string(b.0.join("a.txt")).unwrap(),
            "beta\n"
        );
        assert_eq!(git_diff_index_for(&b.0).ahead, 0);
        assert_eq!(git_diff_index_for(&b.0).behind, 0);

        std::fs::write(b.0.join("b.txt"), "from-b\n").unwrap();
        git_stage_file_for(&b.0, "b.txt").unwrap();
        git_commit_for(&b.0, "from-b").unwrap();
        std::fs::write(a.0.join("c.txt"), "from-a-again\n").unwrap();
        git_stage_file_for(&a.0, "c.txt").unwrap();
        git_commit_for(&a.0, "from-a-again").unwrap();
        git_sync_changes_for(&a.0).unwrap();
        git_sync_changes_for(&b.0).unwrap();
        assert!(b.0.join("c.txt").exists());
        git_sync_changes_for(&a.0).unwrap();
        assert!(a.0.join("b.txt").exists());
    }

    #[test]
    fn parse_gh_pr_list_prefers_open() {
        let json = r#"[{"number":2,"title":"Old","url":"https://example.com/2","state":"MERGED"},{"number":3,"title":"Now","url":"https://example.com/3","state":"OPEN"}]"#;
        let pr = parse_gh_pr_list(json).unwrap();
        assert_eq!(pr.number, 3);
        assert_eq!(pr.state, "open");
        assert_eq!(pr.title, "Now");
    }

    #[test]
    fn pr_head_filter_qualifies_branch_with_repo_owner() {
        assert_eq!(
            github_pr_head_filter("bahadryalcn/bycoda", "main").as_deref(),
            Some("bahadryalcn:main")
        );
    }

    #[test]
    fn parse_github_repositories_includes_a_forks_parent() {
        let json = r#"{
            "nameWithOwner": "EricRasputin/bycoda-eric",
            "parent": {
                "name": "bycoda",
                "owner": { "login": "bahadryalcn" }
            }
        }"#;
        assert_eq!(
            parse_github_repositories(json).unwrap(),
            vec!["EricRasputin/bycoda-eric", "bahadryalcn/bycoda"]
        );
    }

    #[test]
    fn parse_github_repositories_keeps_a_normal_repo_single() {
        let json = r#"{
            "nameWithOwner": "bahadryalcn/bycoda",
            "parent": null
        }"#;
        assert_eq!(
            parse_github_repositories(json).unwrap(),
            vec!["bahadryalcn/bycoda"]
        );
    }

    #[test]
    fn parse_github_work_items_maps_issue_fields() {
        let json = r#"[{
            "number": 5138,
            "title": "Promo codes fail to apply",
            "url": "https://github.com/acme/web/issues/5138",
            "state": "OPEN",
            "stateReason": "",
            "createdAt": "2026-08-20T09:00:00Z",
            "updatedAt": "2026-08-27T08:00:00Z",
            "labels": [{"name": "bug", "color": "d73a4a"}],
            "assignees": [{"login": "maya"}]
        }]"#;
        let items = parse_github_work_items(json, "issue", "acme/web").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "issue");
        assert_eq!(items[0].number, 5138);
        assert_eq!(items[0].state, "open");
        assert_eq!(items[0].state_reason, "");
        assert_eq!(items[0].repo, "acme/web");
        assert_eq!(items[0].labels[0].name, "bug");
        assert_eq!(items[0].assignees[0].login, "maya");
        assert_eq!(
            items[0].assignees[0].avatar_url,
            "https://avatars.githubusercontent.com/maya?s=64"
        );
        assert!(!items[0].draft);
        let payload = serde_json::to_value(&items[0]).unwrap();
        assert_eq!(payload["createdAt"], "2026-08-20T09:00:00Z");
        assert_eq!(payload["updatedAt"], "2026-08-27T08:00:00Z");
    }

    #[test]
    fn parse_github_work_items_reads_issue_state_reason() {
        let json = r#"[{
            "number": 42,
            "title": "Ship the fix",
            "url": "https://github.com/acme/web/issues/42",
            "state": "CLOSED",
            "stateReason": "COMPLETED"
        }]"#;
        let items = parse_github_work_items(json, "issue", "acme/web").unwrap();
        assert_eq!(items[0].state, "closed");
        assert_eq!(items[0].state_reason, "completed");
        assert_eq!(
            serde_json::to_value(&items[0]).unwrap()["stateReason"],
            "completed"
        );
    }

    #[test]
    fn parse_github_work_items_reads_draft_prs() {
        let json = r#"[{
            "number": 12,
            "title": "WIP checkout",
            "url": "https://github.com/acme/web/pull/12",
            "state": "OPEN",
            "isDraft": true
        }]"#;
        let items = parse_github_work_items(json, "pr", "acme/web").unwrap();
        assert_eq!(items[0].kind, "pr");
        assert!(items[0].draft);
        assert!(items[0].labels.is_empty());
        assert_eq!(items[0].repo, "acme/web");
    }

    #[test]
    fn github_work_item_creation_time_reaches_frontend() {
        for (kind, resource) in [("pr", "pull"), ("issue", "issues")] {
            let json = r#"{
            "number": 12,
            "title": "Checkout",
            "url": "https://github.com/acme/web/pull/12",
            "state": "OPEN",
            "createdAt": "2026-09-01T08:00:00Z",
            "updatedAt": "2026-09-11T08:00:00Z"
        }"#;
            let json = json.replace("/pull/", &format!("/{resource}/"));
            let item = parse_github_work_item(&json, kind, "acme/web").unwrap();
            let payload = serde_json::to_value(item).unwrap();
            assert_eq!(payload["kind"], kind);
            assert_eq!(payload["createdAt"], "2026-09-01T08:00:00Z");
            assert_eq!(payload["updatedAt"], "2026-09-11T08:00:00Z");
        }
    }

    #[test]
    fn parse_github_work_item_reads_view_shape() {
        let json = r#"{
            "number": 12,
            "title": "WIP checkout",
            "url": "https://github.com/acme/web/pull/12",
            "state": "OPEN",
            "isDraft": true
        }"#;
        let item = parse_github_work_item(json, "pr", "acme/web").unwrap();
        assert_eq!(item.number, 12);
        assert_eq!(item.kind, "pr");
        assert_eq!(item.repo, "acme/web");
        assert!(item.draft);
    }

    #[test]
    fn parse_github_work_item_details_reads_body_and_author() {
        let json = r#"{
            "body": "Steps to reproduce",
            "author": {"login": "maya"}
        }"#;
        let details = parse_github_work_item_details(json).unwrap();
        assert_eq!(details.body, "Steps to reproduce");
        assert_eq!(details.author, "maya");
        assert_eq!(
            details.author_avatar_url,
            "https://avatars.githubusercontent.com/maya?s=64"
        );
        assert_eq!(details.base_ref_name, "");
        assert_eq!(details.review_decision, "");
    }

    #[test]
    fn parse_github_work_item_details_reads_pr_review_meta() {
        let json = r#"{
            "body": "Move the banner",
            "author": {"login": "ayush-porwal"},
            "baseRefName": "main",
            "headRefName": "agent-terminal",
            "reviewDecision": "REVIEW_REQUIRED"
        }"#;
        let details = parse_github_work_item_details(json).unwrap();
        assert_eq!(details.base_ref_name, "main");
        assert_eq!(details.head_ref_name, "agent-terminal");
        assert_eq!(details.review_decision, "REVIEW_REQUIRED");
    }

    #[test]
    fn split_github_repo_reads_owner_and_name() {
        assert_eq!(
            split_github_repo(" bahadryalcn/bycoda ").unwrap(),
            ("bahadryalcn".into(), "bycoda".into())
        );
        assert!(split_github_repo("bycoda").is_err());
        assert!(split_github_repo("acme/web extra").is_err());
    }

    #[test]
    fn github_merge_modes_atomically_bind_reviewed_head() {
        for action in ["merge", "squash", "rebase"] {
            let reviewed = "a".repeat(40);
            let args = github_pr_action_args("acme/web", 42, action, &reviewed).unwrap();
            assert_eq!(&args[args.len() - 2..], ["--match-head-commit", &reviewed]);
            // A provider seeing head B receives expected A, and rejects instead of merging B.
            assert_ne!(args.last().unwrap(), &"b".repeat(40));
            assert!(github_pr_action_args("acme/web", 42, action, "").is_err());
            assert!(github_pr_action_args("acme/web", 42, action, "malformed").is_err());
        }
    }

    #[test]
    fn github_review_thread_target_is_bound_before_mutation() {
        let fixture = serde_json::json!({"data":{"node":{"pullRequest":{"repository":{"nameWithOwner":"acme/web"},"number":42,"title":"Reviewed fix","url":"https://github.com/acme/web/pull/42"},"path":"src/app.ts","line":7,"comments":{"nodes":[{"body":"Please fix this","author":{"login":"reviewer"}}]}}}}).to_string();
        let context = parse_github_review_thread_target(&fixture, "acme/web", 42).unwrap();
        assert!(context.contains("Reviewed fix"));
        assert!(context.contains("Please fix this"));
        assert!(parse_github_review_thread_target(&fixture, "acme/web", 43).is_err());
        assert!(parse_github_review_thread_target(&fixture, "other/web", 42).is_err());
        assert!(
            parse_github_review_thread_target(r#"{"data":{"node":null}}"#, "acme/web", 42).is_err()
        );
    }

    #[test]
    fn github_pr_actions_map_to_non_interactive_gh_commands() {
        assert_eq!(
            github_pr_action_args("acme/web", 42, "squash", &"a".repeat(40)).unwrap(),
            [
                "pr",
                "merge",
                "42",
                "--repo",
                "acme/web",
                "--squash",
                "--match-head-commit",
                &"a".repeat(40)
            ]
        );
        assert_eq!(
            github_pr_action_args("acme/web", 42, "draft", "").unwrap(),
            ["pr", "ready", "42", "--repo", "acme/web", "--undo"]
        );
        assert_eq!(
            github_pr_action_args("acme/web", 42, "reopen", "").unwrap(),
            ["pr", "reopen", "42", "--repo", "acme/web"]
        );
        assert!(github_pr_action_args("acme/web", 42, "delete", "").is_err());
        assert!(github_pr_action_args("acme/web", 0, "merge", "").is_err());
        assert!(github_pr_action_args("invalid", 42, "merge", "").is_err());
    }

    #[test]
    fn parse_github_work_item_thread_merges_conversation() {
        let json = r#"{
            "data": {
                "repository": {
                    "pullRequest": {
                        "reviewDecision": "APPROVED",
                        "baseRefName": "main",
                        "headRefName": "agent-terminal",
                        "commits": {
                            "totalCount": 2,
                            "nodes": [
                                {
                                    "commit": {
                                        "oid": "abcdef123456",
                                        "messageHeadline": "Show linked activity",
                                        "committedDate": "2026-08-31T11:45:00Z",
                                        "url": "https://github.com/acme/web/commit/abcdef123456",
                                        "author": {
                                            "name": "Maya Smith",
                                            "user": {"login": "maya"}
                                        }
                                    }
                                }
                            ]
                        },
                        "comments": {
                            "totalCount": 50,
                            "nodes": [
                                {
                                    "id": "IC_1",
                                    "author": {"login": "maya"},
                                    "body": "Looks good",
                                    "createdAt": "2026-08-31T10:00:00Z",
                                    "url": "https://github.com/acme/web/pull/1#issuecomment-1",
                                    "isMinimized": false
                                },
                                {
                                    "id": "IC_hidden",
                                    "author": {"login": "bot"},
                                    "body": "hidden",
                                    "createdAt": "2026-08-31T10:05:00Z",
                                    "isMinimized": true
                                }
                            ]
                        },
                        "reviews": {
                            "totalCount": 2,
                            "nodes": [
                                {
                                    "id": "PRR_empty",
                                    "author": {"login": "ada"},
                                    "body": "",
                                    "state": "COMMENTED",
                                    "submittedAt": "2026-08-31T11:00:00Z"
                                },
                                {
                                    "id": "PRR_2",
                                    "author": {"login": "ada"},
                                    "body": "Ship it",
                                    "state": "APPROVED",
                                    "submittedAt": "2026-08-31T12:00:00Z",
                                    "url": "https://github.com/acme/web/pull/1#pullrequestreview-2"
                                }
                            ]
                        },
                        "reviewThreads": {
                            "totalCount": 1,
                            "nodes": [
                                {
                                    "id": "PRRT_1",
                                    "isResolved": true,
                                    "path": "src/app.ts",
                                    "comments": {
                                        "totalCount": 2,
                                        "nodes": [
                                            {
                                                "id": "PRRC_1",
                                                "author": {"login": "lin"},
                                                "body": "Nit: name",
                                                "createdAt": "2026-08-31T11:30:00Z",
                                                "url": "https://github.com/acme/web/pull/1#discussion_r1",
                                                "path": "src/app.ts",
                                                "line": 12,
                                                "isMinimized": false
                                            },
                                            {
                                                "id": "PRRC_2",
                                                "author": {"login": "maya"},
                                                "body": "Fixed",
                                                "createdAt": "2026-08-31T11:40:00Z",
                                                "path": "src/app.ts",
                                                "line": 12,
                                                "isMinimized": false
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        }"#;
        let thread = parse_github_work_item_thread(json, "pr").unwrap();
        assert!(thread.truncated);
        assert_eq!(thread.review_decision, "APPROVED");
        assert_eq!(thread.base_ref_name, "main");
        assert_eq!(thread.head_ref_name, "agent-terminal");
        assert_eq!(thread.commits.len(), 1);
        assert_eq!(thread.commits[0].oid, "abcdef123456");
        assert_eq!(thread.commits[0].message_headline, "Show linked activity");
        assert_eq!(thread.commits[0].author, "maya");
        assert_eq!(
            thread
                .comments
                .iter()
                .map(|comment| comment.id.as_str())
                .collect::<Vec<_>>(),
            ["IC_1", "PRRC_1", "PRR_2"]
        );
        assert_eq!(thread.comments[1].kind, "review_comment");
        assert_eq!(thread.comments[1].path, "src/app.ts");
        assert_eq!(thread.comments[1].line, Some(12));
        assert_eq!(thread.comments[1].thread_id, "PRRT_1");
        assert!(thread.comments[1].resolved);
        assert_eq!(thread.comments[1].replies.len(), 1);
        assert_eq!(thread.comments[1].replies[0].author, "maya");
        assert_eq!(thread.comments[1].replies[0].thread_id, "PRRT_1");
        assert_eq!(thread.comments[2].kind, "review");
        assert_eq!(thread.comments[2].state, "APPROVED");
    }

    #[test]
    fn parse_github_work_item_thread_reads_issue_comments() {
        let json = r#"{
            "data": {
                "repository": {
                    "issue": {
                        "comments": {
                            "totalCount": 1,
                            "nodes": [
                                {
                                    "id": "IC_9",
                                    "author": {"login": "maya"},
                                    "body": "Still happens",
                                    "createdAt": "2026-08-31T09:00:00Z"
                                }
                            ]
                        }
                    }
                }
            }
        }"#;
        let thread = parse_github_work_item_thread(json, "issue").unwrap();
        assert!(!thread.truncated);
        assert_eq!(thread.comments.len(), 1);
        assert_eq!(thread.comments[0].author, "maya");
        assert_eq!(thread.comments[0].body, "Still happens");
    }

    #[test]
    fn github_comment_input_rejects_empty_or_unknown() {
        assert_eq!(
            github_comment_input("issue", 12, "Looks good").unwrap(),
            ("issue", "Looks good")
        );
        assert!(github_comment_input("issue", 12, "  ").is_err());
        assert!(github_comment_input("gist", 12, "Hi").is_err());
        assert!(github_comment_input("pr", 0, "Hi").is_err());
    }

    #[test]
    fn valid_github_node_id_allows_graphql_ids() {
        assert!(valid_github_node_id("PRRT_kwDOBQfyJc5nX8x-"));
        assert!(valid_github_node_id("IC_kwDOA=="));
        assert!(!valid_github_node_id(""));
        assert!(!valid_github_node_id("thread id"));
        assert!(!valid_github_node_id("id\nPRRT_1"));
    }

    #[test]
    fn github_url_from_output_reads_the_last_http_line() {
        assert_eq!(
            github_url_from_output(
                "Posted\nhttps://github.com/acme/web/issues/1#issuecomment-9\n",
                "missing"
            )
            .unwrap(),
            "https://github.com/acme/web/issues/1#issuecomment-9"
        );
        assert_eq!(
            github_url_from_output("", "GitHub did not return a comment URL").unwrap_err(),
            "GitHub did not return a comment URL"
        );
    }

    #[test]
    fn parse_github_review_reply_url_reads_graphql() {
        let json = r#"{
            "data": {
                "addPullRequestReviewThreadReply": {
                    "comment": { "url": "https://github.com/acme/web/pull/1#discussion_r9" }
                }
            }
        }"#;
        assert_eq!(
            parse_github_review_reply_url(json).unwrap(),
            "https://github.com/acme/web/pull/1#discussion_r9"
        );
        let error = parse_github_review_reply_url(
            r#"{"data":null,"errors":[{"message":"Could not resolve to a node"}]}"#,
        )
        .unwrap_err();
        assert!(error.contains("Could not resolve to a node"));
    }

    #[test]
    fn parse_github_work_item_thread_reads_graphql_errors() {
        let json = r#"{
            "data": {"repository": null},
            "errors": [{"message": "Could not resolve to a Repository"}]
        }"#;
        let error = parse_github_work_item_thread(json, "pr").unwrap_err();
        assert!(error.contains("Could not resolve to a Repository"));
    }

    #[test]
    fn github_avatar_url_encodes_bot_logins() {
        assert_eq!(
            github_avatar_url("dependabot[bot]"),
            "https://avatars.githubusercontent.com/dependabot%5Bbot%5D?s=64"
        );
        assert_eq!(github_avatar_url("  "), "");
    }

    #[test]
    fn parse_github_pr_diff_meta_reads_files_and_totals() {
        let json = r#"{
            "additions": 971,
            "deletions": 225,
            "files": [
                {"path": "next.config.ts", "additions": 4, "deletions": 0},
                {"path": "package.json", "additions": 2, "deletions": 2}
            ]
        }"#;
        let diff = parse_github_pr_diff_meta(json).unwrap();
        assert_eq!(diff.additions, 971);
        assert_eq!(diff.deletions, 225);
        assert_eq!(diff.files.len(), 2);
        assert_eq!(diff.files[0].path, "next.config.ts");
        assert_eq!(diff.files[0].additions, 4);
        assert_eq!(diff.patch, "");
        assert!(!diff.truncated);
    }

    #[test]
    fn parse_github_pr_oids_reads_base_and_head() {
        let json = r#"{
            "baseRefOid": "aaa111",
            "headRefOid": "bbb222",
            "files": []
        }"#;
        assert_eq!(
            parse_github_pr_oids(json).unwrap(),
            ("aaa111".into(), "bbb222".into())
        );
    }

    #[test]
    fn github_status_context_keeps_its_report_time() {
        let checks = parse_github_pr_checks(
            r#"{
            "headRefOid": "abc",
            "statusCheckRollup": [{
                "__typename": "StatusContext", "context": "External tests",
                "state": "SUCCESS", "createdAt": "2030-01-01T10:00:00Z",
                "targetUrl": "https://ci.example/project/web"
            }]
        }"#,
        )
        .unwrap();
        assert_eq!(
            checks.checks[0].started_at.as_deref(),
            Some("2030-01-01T10:00:00Z")
        );
    }

    #[test]
    fn github_pr_checks_args_target_repo_and_number() {
        assert_eq!(
            github_pr_checks_args("acme/web", 42).unwrap(),
            [
                "pr",
                "view",
                "42",
                "--repo",
                "acme/web",
                "--json",
                "headRefOid,statusCheckRollup"
            ]
        );
        assert!(github_pr_checks_args("acme/web", 0).is_err());
        assert!(github_pr_checks_args("invalid", 42).is_err());
    }

    #[test]
    fn github_check_details_reads_steps_and_failure_annotations() {
        let details = github_check_details_with("acme/web", "123", |path| {
            match path {
                "repos/acme/web/actions/jobs/123" => Ok(r#"{
                    "id":123, "status":"completed", "conclusion":"failure",
                    "check_run_url":"https://api.github.com/repos/acme/web/check-runs/456",
                    "steps":[
                        {"name":"Install","status":"completed","conclusion":"success"},
                        {"name":"Run tests","status":"completed","conclusion":"failure",
                         "started_at":"2030-01-01T10:00:00Z","completed_at":"2030-01-01T10:00:12Z"}
                    ]
                }"#.into()),
                "repos/acme/web/check-runs/456/annotations?per_page=100" => Ok(r#"[
                    {"path":"src/app.test.ts","start_line":42,"message":"Expected 2, received 1","annotation_level":"failure"}
                ]"#.into()),
                _ => panic!("Unexpected request: {path}"),
            }
        }).unwrap();
        assert_eq!(details.steps[0].state, "pass");
        assert_eq!(details.steps[1].state, "fail");
        assert_eq!(details.steps[1].name, "Run tests");
        assert_eq!(details.annotations[0].message, "Expected 2, received 1");
        assert_eq!(details.annotations[0].line, 42);
        assert!(details.notice.is_none());
    }

    #[test]
    fn parse_github_pr_checks_maps_check_run_states() {
        let json = r#"{
            "headRefOid": "abc123",
            "statusCheckRollup": [
                {
                    "__typename": "CheckRun",
                    "name": "build",
                    "status": "COMPLETED",
                    "conclusion": "SUCCESS",
                    "workflowName": "CI",
                    "detailsUrl": "https://github.com/acme/web/actions/runs/1",
                    "startedAt": "2026-09-16T10:00:00Z",
                    "completedAt": "2026-09-16T10:05:00Z"
                },
                {
                    "__typename": "CheckRun",
                    "name": "e2e",
                    "status": "IN_PROGRESS",
                    "conclusion": "FAILURE",
                    "workflowName": "E2E",
                    "detailsUrl": "https://github.com/acme/web/actions/runs/2",
                    "startedAt": "2026-09-16T11:00:00Z"
                },
                {
                    "__typename": "CheckRun",
                    "name": "scan",
                    "status": "COMPLETED",
                    "conclusion": "ACTION_REQUIRED"
                }
            ]
        }"#;
        let checks = parse_github_pr_checks(json).unwrap();
        assert_eq!(checks.head_oid, "abc123");
        assert_eq!(checks.checks.len(), 3);
        let build = &checks.checks[0];
        assert_eq!(build.name, "build");
        assert_eq!(build.state, "pass");
        assert_eq!(build.workflow, "CI");
        assert_eq!(
            build.url.as_deref(),
            Some("https://github.com/acme/web/actions/runs/1")
        );
        assert_eq!(build.started_at.as_deref(), Some("2026-09-16T10:00:00Z"));
        assert_eq!(build.completed_at.as_deref(), Some("2026-09-16T10:05:00Z"));
        let e2e = &checks.checks[1];
        assert_eq!(e2e.state, "pending");
        assert_eq!(e2e.completed_at, None);
        assert_eq!(checks.checks[2].state, "fail");
    }

    #[test]
    fn parse_github_pr_checks_maps_status_context_states() {
        let json = r#"{
            "headRefOid": "abc123",
            "statusCheckRollup": [
                {
                    "__typename": "StatusContext",
                    "context": "ci/lab",
                    "state": "SUCCESS",
                    "targetUrl": "https://ci.example.com/1"
                },
                {
                    "__typename": "StatusContext",
                    "context": "security/scan",
                    "state": "FAILURE",
                    "targetUrl": "https://ci.example.com/2"
                },
                {
                    "__typename": "StatusContext",
                    "context": "legacy/status",
                    "state": "PENDING"
                }
            ]
        }"#;
        let checks = parse_github_pr_checks(json).unwrap();
        let lab = &checks.checks[0];
        assert_eq!(lab.name, "ci/lab");
        assert_eq!(lab.state, "pass");
        assert_eq!(lab.workflow, "");
        assert_eq!(lab.url.as_deref(), Some("https://ci.example.com/1"));
        assert_eq!(lab.started_at, None);
        assert_eq!(lab.completed_at, None);
        assert_eq!(checks.checks[1].state, "fail");
        let legacy = &checks.checks[2];
        assert_eq!(legacy.state, "pending");
        assert_eq!(legacy.url, None);
    }

    #[test]
    fn parse_github_pr_checks_combines_rollup_states_and_unknown_values() {
        let json = r#"{
            "headRefOid": "abc123",
            "statusCheckRollup": [
                {"__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "SKIPPED"},
                {"__typename": "CheckRun", "name": "announce", "status": "COMPLETED", "conclusion": "CANCELLED"},
                {"__typename": "CheckRun", "name": "unit", "status": "COMPLETED", "conclusion": "TIMED_OUT"},
                {"__typename": "CheckRun", "name": "stale", "status": "COMPLETED", "conclusion": "STALE"},
                {"__typename": "StatusContext", "context": "deploy/expected", "state": "EXPECTED"},
                {"__typename": "CheckRun", "name": "plan", "status": "QUEUED", "conclusion": "SUCCESS"}
            ]
        }"#;
        let checks = parse_github_pr_checks(json).unwrap();
        let states: Vec<&str> = checks.checks.iter().map(|c| c.state.as_str()).collect();
        assert_eq!(
            states,
            ["skipping", "cancel", "fail", "unknown", "unknown", "pending"]
        );
    }

    #[test]
    fn parse_github_pr_checks_unknown_status_never_trusts_conclusion() {
        let json = r#"{
            "headRefOid": "abc123",
            "statusCheckRollup": [
                {
                    "__typename": "CheckRun",
                    "name": "mystery",
                    "status": "RUNNING",
                    "conclusion": "SUCCESS"
                },
                {"__typename": "CheckRun", "name": "done", "status": "COMPLETED", "conclusion": "SUCCESS"},
                {"__typename": "CheckRun", "name": "legacy", "conclusion": "SUCCESS"}
            ]
        }"#;
        let checks = parse_github_pr_checks(json).unwrap();
        assert_eq!(checks.checks[0].state, "unknown");
        assert_eq!(checks.checks[1].state, "pass");
        assert_eq!(checks.checks[2].state, "pass");
    }

    #[test]
    fn parse_github_pr_checks_treats_missing_rollup_as_empty() {
        let checks = parse_github_pr_checks(r#"{"headRefOid": "abc123"}"#).unwrap();
        assert_eq!(checks.head_oid, "abc123");
        assert!(checks.checks.is_empty());
        let null_checks =
            parse_github_pr_checks(r#"{"headRefOid": "abc123", "statusCheckRollup": null}"#)
                .unwrap();
        assert!(null_checks.checks.is_empty());
    }

    #[test]
    fn parse_github_pr_checks_fills_missing_check_data() {
        let json = r#"{
            "headRefOid": "abc123",
            "statusCheckRollup": [
                {"__typename": "CheckRun", "status": "COMPLETED"},
                {"__typename": "CheckRun", "name": "legacy", "conclusion": "SUCCESS"},
                {"context": "fallback/status", "state": "SUCCESS"}
            ]
        }"#;
        let checks = parse_github_pr_checks(json).unwrap();
        let bare = &checks.checks[0];
        assert_eq!(bare.name, "");
        assert_eq!(bare.workflow, "");
        assert_eq!(bare.state, "unknown");
        assert_eq!(bare.url, None);
        assert_eq!(bare.started_at, None);
        assert_eq!(bare.completed_at, None);
        assert_eq!(checks.checks[1].state, "pass");
        let fallback = &checks.checks[2];
        assert_eq!(fallback.name, "fallback/status");
        assert_eq!(fallback.state, "pass");
        assert_eq!(fallback.workflow, "");
    }

    #[test]
    fn parse_github_pr_checks_rejects_invalid_responses() {
        assert!(parse_github_pr_checks("not json").is_err());
        assert!(parse_github_pr_checks(r#"{"statusCheckRollup": []}"#).is_err());
        assert!(parse_github_pr_checks(r#"{"headRefOid": "", "statusCheckRollup": []}"#).is_err());
        assert!(
            parse_github_pr_checks(r#"{"headRefOid": "abc", "statusCheckRollup": ["nope"]}"#)
                .is_err()
        );
    }

    #[test]
    fn git_diff_full_context_includes_distant_lines() {
        let dir = tmp("git-full-context");
        let original = (1..=40)
            .map(|i| format!("line-{i}"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        if !init_git_commit(&dir.0, &[("big.txt", &original)]) {
            return;
        }
        let base = git_run(&dir.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        let updated = original.replace("line-30", "LINE-30");
        std::fs::write(dir.0.join("big.txt"), &updated).unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "edit"]) {
            return;
        }
        let head = git_run(&dir.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        let (patch, truncated) = git_diff_full_context(&dir.0, &base, &head).unwrap();
        assert!(!truncated);
        assert!(
            patch.contains("line-1"),
            "expected distant context in patch:\n{patch}"
        );
        assert!(patch.contains("LINE-30"), "expected changed line:\n{patch}");
        let default = git_run(&dir.0, &["diff", &base, &head]).unwrap_or_default();
        assert!(
            !default.contains("line-1"),
            "default context should omit distant lines"
        );
    }

    #[test]
    fn git_diff_full_context_uses_canonical_plain_output() {
        let dir = tmp("git-full-context-canonical");
        if !init_git_commit(&dir.0, &[("file.txt", "alpha\n")]) {
            return;
        }
        let base = git_run(&dir.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        std::fs::write(dir.0.join("file.txt"), "beta\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "edit"]) {
            return;
        }
        let head = git_run(&dir.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        let helper = dir.0.join("ext-diff.sh");
        std::fs::write(&helper, "#!/bin/sh\necho EXTERNAL\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&helper).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&helper, permissions).unwrap();
        }
        if !git(&dir.0, &["config", "color.ui", "always"])
            || !git(&dir.0, &["config", "color.diff", "always"])
            || !git(&dir.0, &["config", "diff.noprefix", "true"])
            || !git(
                &dir.0,
                &["config", "diff.external", &helper.to_string_lossy()],
            )
        {
            return;
        }
        let raw = git_run(&dir.0, &["diff", &format!("{base}...{head}")]).unwrap_or_default();
        assert!(
            raw.contains("EXTERNAL") || !raw.contains("diff --git a/file.txt b/file.txt"),
            "hostile git settings should change a default diff:\n{raw}"
        );
        let (patch, truncated) = git_diff_full_context(&dir.0, &base, &head).unwrap();
        assert!(!truncated);
        assert!(
            patch.contains("diff --git a/file.txt b/file.txt"),
            "expected canonical prefixes:\n{patch}"
        );
        assert!(
            !patch.contains('\u{1b}') && !patch.contains("EXTERNAL"),
            "expected plain git diff output:\n{patch}"
        );
    }

    #[test]
    fn git_diff_full_context_errors_without_a_merge_base() {
        let dir = tmp("git-full-context-unrelated");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        let base = git_run(&dir.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        if !git(&dir.0, &["checkout", "--orphan", "other"]) {
            return;
        }
        let _ = std::fs::remove_file(dir.0.join("a.txt"));
        std::fs::write(dir.0.join("b.txt"), "beta\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "other"]) {
            return;
        }
        let head = git_run(&dir.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        assert!(git_run(&dir.0, &["merge-base", &base, &head]).is_none());
        let two_dot = git_run(&dir.0, &["diff", &base, &head]).unwrap_or_default();
        assert!(
            two_dot.contains("alpha") || two_dot.contains("beta"),
            "two-dot should invent a comparison:\n{two_dot}"
        );
        let err = git_diff_full_context(&dir.0, &base, &head).unwrap_err();
        assert!(
            err.to_lowercase().contains("merge base"),
            "expected merge-base error, got {err}"
        );
    }

    #[test]
    fn ensure_git_commit_fetches_from_gh_resolved_remote() {
        let remote = tmp("git-full-context-upstream");
        if !init_git_commit(&remote.0, &[("note.txt", "hello\n")]) {
            return;
        }
        let oid = git_run(&remote.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        let decoy = tmp("git-full-context-origin");
        if !init_git_commit(&decoy.0, &[("other.txt", "decoy\n")]) {
            return;
        }
        let local = tmp("git-full-context-local");
        if !init_git_commit(&local.0, &[("local.txt", "local\n")]) {
            return;
        }
        let upstream_url = remote.0.to_string_lossy().into_owned();
        let origin_url = decoy.0.to_string_lossy().into_owned();
        if !git(&local.0, &["remote", "add", "origin", &origin_url])
            || !git(&local.0, &["remote", "add", "upstream", &upstream_url])
            || !git(&local.0, &["config", "remote.upstream.gh-resolved", "base"])
        {
            return;
        }
        assert_eq!(github_fetch_remote(&local.0).as_deref(), Some("upstream"));
        let spec = format!("{oid}^{{commit}}");
        assert!(git_output(&local.0, &["cat-file", "-e", &spec]).is_none());
        ensure_git_commit(&local.0, &oid).unwrap();
        assert!(git_output(&local.0, &["cat-file", "-e", &spec]).is_some());
    }

    #[test]
    fn git_output_capped_keeps_queued_chunks_complete_and_ordered() {
        let dir = tmp("git-output-bounded-queue");
        // ~200 KiB, comfortably past the 128 KiB the reader queue can hold, so
        // the reader is guaranteed to park in `send` while the consumer is
        // behind. Every other cap test here uses a cap below a single 8 KiB
        // chunk, which never fills one queue slot and so cannot catch a lost,
        // duplicated, or reordered chunk.
        let body: String = (0..12_000).map(|index| format!("line {index}\n")).collect();
        if !init_git_commit(&dir.0, &[("many.txt", &body)]) {
            return;
        }

        let (full, truncated) =
            git_output_capped(&dir.0, &["show", ":many.txt"], 1 << 20, None).unwrap();
        assert!(!truncated);
        assert_eq!(full, body.as_bytes(), "queued chunks lost or reordered");

        // Spans several chunks and lands mid-line.
        let (capped, truncated) =
            git_output_capped(&dir.0, &["show", ":many.txt"], 24_576, None).unwrap();
        assert!(truncated);
        assert_eq!(capped, body.as_bytes()[..24_576]);
    }

    #[test]
    fn git_output_capped_stops_before_buffering_the_rest() {
        let dir = tmp("git-output-capped");
        let big = "x".repeat(80_000);
        if !init_git_commit(&dir.0, &[("big.txt", &format!("{big}\n"))]) {
            return;
        }
        std::fs::write(dir.0.join("big.txt"), format!("y{big}\n")).unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "edit"]) {
            return;
        }
        let (bytes, truncated) =
            git_output_capped(&dir.0, &["diff", "HEAD~1", "HEAD"], 1024, None).unwrap();
        assert!(truncated);
        assert!(bytes.len() <= 1024);
        let (head, truncated) =
            git_output_capped(&dir.0, &["rev-parse", "HEAD"], 1024, None).unwrap();
        assert!(!truncated);
        assert!(!head.is_empty());
    }

    // Windows may run the real binary directly, with the launcher's tool
    // directories added in front of the inherited PATH.
    #[cfg(not(windows))]
    #[test]
    fn read_only_git_cmd_includes_gui_install_dirs() {
        let cmd = git_cmd();
        let path = cmd
            .get_envs()
            .find(|(key, _)| *key == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, value)| value)
            .unwrap();
        let dirs: Vec<_> = std::env::split_paths(path).collect();
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
    }

    #[test]
    fn read_only_git_never_resolves_login_shell_path() {
        for action in ["status", "diff", "rev-parse", "ls-files", "cat-file"] {
            let cmd = git_cmd_for_args_with_path(&[action], || {
                panic!("read-only git must not resolve the login-shell PATH")
            });
            assert!(cmd
                .get_envs()
                .any(|(key, value)| key == std::ffi::OsStr::new("PATH") && value.is_some()));
        }
    }

    #[test]
    fn direct_git_is_the_binary_behind_the_windows_launcher() {
        let files = [
            PathBuf::from("C:/Git/cmd/git.exe"),
            PathBuf::from("C:/Git/mingw64/bin/git.exe"),
        ];
        let is_file = |path: &Path| files.iter().any(|file| file == path);
        let (exe, dirs, msystem) = direct_git_from(
            [PathBuf::from("C:/Windows"), PathBuf::from("C:/Git/cmd")],
            is_file,
        )
        .unwrap();
        assert_eq!(exe, PathBuf::from("C:/Git/mingw64/bin/git.exe"));
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("C:/Git/mingw64/bin"),
                PathBuf::from("C:/Git/usr/bin")
            ]
        );
        assert_eq!(msystem, "MINGW64");
    }

    #[test]
    fn direct_git_is_not_guessed_for_other_layouts() {
        // A shim directory (scoop, a package manager) is not the launcher.
        let shim = PathBuf::from("C:/scoop/shims/git.exe");
        assert!(direct_git_from([PathBuf::from("C:/scoop/shims")], |path| path == shim).is_none());
        assert!(direct_git_from([PathBuf::from("C:/Windows")], |_| false).is_none());
    }

    #[test]
    fn output_with_timeout_does_not_wait_for_inherited_pipes_forever() {
        let (sender, receiver) = mpsc::channel();
        let started = Instant::now();
        let error = receive_git_output(receiver, started + Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
        drop(sender);
    }

    #[test]
    fn output_with_timeout_stops_a_command_that_overruns() {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("ping");
            cmd.args(["-n", "30", "127.0.0.1"]);
            cmd
        } else {
            let mut cmd = Command::new("sleep");
            cmd.arg("30");
            cmd
        };
        let started = Instant::now();
        let error = output_with_timeout(&mut cmd, Duration::from_millis(200)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn git_actions_that_need_helpers_use_login_shell_path() {
        for action in ["commit", "push", "pull", "fetch", "clone"] {
            let cmd = git_cmd_for_args_with_path(&[action], || "gui-git-path".into());
            assert!(cmd.get_envs().any(|(key, value)| {
                key == std::ffi::OsStr::new("PATH")
                    && value == Some(std::ffi::OsStr::new("gui-git-path"))
            }));
        }
    }

    #[test]
    fn signing_hint_ignores_other_errors() {
        let error = "nothing to commit, working tree clean".to_string();
        assert_eq!(with_signing_hint(error.clone()), error);
    }

    #[test]
    fn git_commit_reports_signing_failure_with_hint() {
        let dir = tmp("git-commit-signing");
        if !init_git_commit(&dir.0, &[("a.txt", "a\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "b\n").unwrap();
        for args in [
            ["config", "commit.gpgsign", "true"],
            ["config", "gpg.format", "openpgp"],
            ["config", "gpg.program", "/nonexistent/bycoda-gpg"],
        ] {
            assert!(git(&dir.0, &args));
        }
        assert!(git(&dir.0, &["add", "."]));
        let error = git_commit_for(&dir.0, "signed").unwrap_err();
        assert!(error.contains("Git couldn't sign this commit"), "{error}");
    }

    #[test]
    fn queued_git_spawn_observes_cancellation_before_starting_a_process() {
        static GATE: GitSpawnGate = GitSpawnGate {
            holder: Mutex::new(None),
            freed: std::sync::Condvar::new(),
            next: std::sync::atomic::AtomicU64::new(0),
        };
        let _held = GATE.wait_turn();
        let cancel = Arc::new(AtomicBool::new(false));
        let setter = cancel.clone();
        let worker = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            setter.store(true, Ordering::Release);
        });
        assert!(GATE.wait_turn_cancellable(Some(&cancel)).is_none());
        worker.join().unwrap();
        // Cancellation must not replace the claim of the running process.
        assert_eq!(GATE.holder.lock().unwrap().as_ref().unwrap().0, 0);
    }

    #[test]
    fn git_output_capped_cancels_a_silent_child() {
        let dir = tmp("git-output-cancel-silent");
        if !init_git_commit(&dir.0, &[("a.txt", "a\n")]) {
            return;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let setter = cancel.clone();
        let setter_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            setter.store(true, Ordering::Release);
        });
        let started = Instant::now();

        let result = git_output_capped(
            &dir.0,
            &["-c", "alias.slow=!sleep 5", "slow"],
            1024,
            Some(&cancel),
        );
        setter_thread.join().unwrap();

        assert!(result.is_none());
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn git_stage_rejects_path_escape() {
        let dir = tmp("git-stage-escape");
        assert!(git_stage_file_for(&dir.0, "../secret.txt").is_err());
        assert!(git_discard_file_for(&dir.0, "../secret.txt").is_err());
    }

    #[test]
    fn git_branches_empty_outside_a_repo() {
        let dir = tmp("git-branches-none");
        std::fs::write(dir.0.join("notes.txt"), "hello\n").unwrap();
        assert_eq!(git_branches_for(&dir.0), GitBranches::default());
    }

    #[test]
    fn git_branches_lists_unborn_head() {
        let dir = tmp("git-branches-unborn");
        if !init_git(&dir.0, "main", None) {
            return;
        }
        let listed = git_branches_for(&dir.0);
        assert_eq!(listed.current.as_deref(), Some("main"));
        assert!(!listed.detached);
        assert!(listed
            .branches
            .iter()
            .any(|branch| { branch.name == "main" && branch.current && branch.remote.is_none() }));
    }

    #[test]
    fn git_create_and_checkout_branch() {
        let dir = tmp("git-branch-switch");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(
            git_create_branch_for(&dir.0, "feat/picker").unwrap(),
            "feat/picker"
        );
        let listed = git_branches_for(&dir.0);
        assert_eq!(listed.current.as_deref(), Some("feat/picker"));
        assert_eq!(git_checkout_for(&dir.0, "main", None).unwrap(), "main");
        assert_eq!(git_head_branch(&dir.0).as_deref(), Some("main"));
        assert!(git_create_branch_for(&dir.0, "feat/picker").is_err());
        assert!(git_create_branch_for(&dir.0, "bad name").is_err());
        assert!(git_checkout_for(&dir.0, "missing", None).is_err());
    }

    #[test]
    fn git_stash_lets_checkout_proceed() {
        let dir = tmp("git-stash-checkout");
        if !init_git_commit(&dir.0, &[("a.txt", "main\n")]) {
            return;
        }
        if git_create_branch_for(&dir.0, "feature").is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "feature\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "feature"]) {
            return;
        }
        if git_checkout_for(&dir.0, "main", None).is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "dirty\n").unwrap();
        let err = git_checkout_for(&dir.0, "feature", None).unwrap_err();
        assert!(checkout_blocked_by_changes(&err), "{err}");
        git_stash_for(&dir.0, Some("wip"), GitStashMode::IncludeUntracked).unwrap();
        assert_eq!(
            git_checkout_for(&dir.0, "feature", None).unwrap(),
            "feature"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "feature\n"
        );
    }

    #[test]
    fn git_stash_includes_untracked_that_block_checkout() {
        let dir = tmp("git-stash-untracked");
        if !init_git_commit(&dir.0, &[("a.txt", "main\n")]) {
            return;
        }
        if git_create_branch_for(&dir.0, "feature").is_err() {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "on-feature\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "add new"]) {
            return;
        }
        if git_checkout_for(&dir.0, "main", None).is_err() {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "untracked\n").unwrap();
        let err = git_checkout_for(&dir.0, "feature", None).unwrap_err();
        assert!(checkout_blocked_by_changes(&err), "{err}");
        git_stash_for(&dir.0, None, GitStashMode::IncludeUntracked).unwrap();
        assert_eq!(
            git_checkout_for(&dir.0, "feature", None).unwrap(),
            "feature"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("new.txt")).unwrap(),
            "on-feature\n"
        );
    }

    #[test]
    fn git_commit_lets_checkout_proceed() {
        let dir = tmp("git-commit-checkout");
        if !init_git_commit(&dir.0, &[("a.txt", "main\n")]) {
            return;
        }
        if git_create_branch_for(&dir.0, "feature").is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "feature\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "feature"]) {
            return;
        }
        if git_checkout_for(&dir.0, "main", None).is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "dirty\n").unwrap();
        git_checked(&dir.0, &["add", "-A", "--", "."]).unwrap();
        git_commit_for(&dir.0, "save dirty").unwrap();
        assert_eq!(
            git_checkout_for(&dir.0, "feature", None).unwrap(),
            "feature"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "feature\n"
        );
    }

    #[test]
    fn git_branches_lists_remote_only_branch() {
        let repo = tmp("git-branch-remote-repo");
        let origin = tmp("git-branch-remote-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
            || git_create_branch_for(&repo.0, "feature").is_err()
            || !git(&repo.0, &["push", "-u", "origin", "feature"])
            || git_checkout_for(&repo.0, "main", None).is_err()
            || !git(&repo.0, &["branch", "-D", "feature"])
        {
            return;
        }
        let listed = git_branches_for(&repo.0);
        assert_eq!(listed.current.as_deref(), Some("main"));
        let remote = listed
            .branches
            .iter()
            .find(|branch| branch.name == "feature")
            .unwrap();
        assert_eq!(remote.remote.as_deref(), Some("origin"));
        assert!(!listed
            .branches
            .iter()
            .any(|branch| branch.name == "main" && branch.remote.is_some()));
        assert_eq!(
            git_checkout_for(&repo.0, "feature", Some("origin")).unwrap(),
            "feature"
        );
        assert_eq!(git_head_branch(&repo.0).as_deref(), Some("feature"));
    }

    fn commit_file(dir: &Path, name: &str, contents: &str, message: &str) -> String {
        std::fs::write(dir.join(name), contents).unwrap();
        assert!(git(dir, &["add", "."]));
        assert!(git(dir, &["commit", "-m", message]));
        git_stdout(dir, &["rev-parse", "HEAD"]).unwrap()
    }

    #[test]
    fn git_history_all_includes_other_branches() {
        let dir = tmp("git-history-all");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "side"]));
        commit_file(&dir.0, "b.txt", "beta\n", "on side");
        assert!(git(&dir.0, &["checkout", "main"]));

        let current = git_history_scoped(&dir.0, None, false).unwrap();
        assert!(current.commits.iter().all(|c| c.subject != "on side"));
        let all = git_history_scoped(&dir.0, None, true).unwrap();
        assert!(all.commits.iter().any(|c| c.subject == "on side"));
    }

    #[test]
    fn git_commit_actions_move_head_and_refs() {
        let dir = tmp("git-commit-actions");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        let first = git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap();
        let second = commit_file(&dir.0, "b.txt", "beta\n", "second");

        git_create_tag_for(&dir.0, "v1", &first).unwrap();
        assert_eq!(
            git_stdout(&dir.0, &["rev-parse", "v1"]).as_deref(),
            Some(first.as_str())
        );
        assert!(git_create_tag_for(&dir.0, "v1", &first).is_err());
        assert!(git_create_tag_for(&dir.0, "-bad", &first).is_err());

        assert_eq!(
            git_create_branch_at_for(&dir.0, "from-first", &first).unwrap(),
            "from-first"
        );
        assert_eq!(git_head_branch(&dir.0).as_deref(), Some("from-first"));
        assert!(!dir.0.join("b.txt").exists());

        git_cherry_pick_for(&dir.0, &second).unwrap();
        assert!(dir.0.join("b.txt").exists());

        let picked = git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap();
        git_revert_for(&dir.0, &picked).unwrap();
        assert!(!dir.0.join("b.txt").exists());

        git_reset_for(&dir.0, &picked, "hard").unwrap();
        assert!(dir.0.join("b.txt").exists());
        assert!(git_reset_for(&dir.0, &picked, "bogus").is_err());
        assert!(git_reset_for(&dir.0, "--hard", "soft").is_err());

        git_checkout_commit_for(&dir.0, &first).unwrap();
        assert_eq!(git_head_branch(&dir.0), None);
    }

    #[test]
    fn git_operation_state_reports_and_aborts_a_conflicted_cherry_pick() {
        let dir = tmp("git-operation-state");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(git_operation_state_for(&dir.0), None);
        assert!(git_operation_abort_for(&dir.0).is_err());

        assert!(git(&dir.0, &["checkout", "-b", "side"]));
        let side = commit_file(&dir.0, "a.txt", "side\n", "side change");
        assert!(git(&dir.0, &["checkout", "main"]));
        commit_file(&dir.0, "a.txt", "main\n", "main change");

        assert!(git_cherry_pick_for(&dir.0, &side).is_err());
        assert_eq!(git_operation_state_for(&dir.0), Some("cherry-pick"));

        git_operation_abort_for(&dir.0).unwrap();
        assert_eq!(git_operation_state_for(&dir.0), None);
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "main\n"
        );
    }

    #[test]
    fn git_branch_operations_delete_rename_merge_and_rebase() {
        let dir = tmp("git-branch-ops");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "side"]));
        commit_file(&dir.0, "b.txt", "beta\n", "on side");
        assert!(git(&dir.0, &["checkout", "main"]));

        assert!(git_delete_branch_for(&dir.0, "main", true).is_err());
        assert!(git_delete_branch_for(&dir.0, "side", false).is_err());
        assert!(git_merge_for(&dir.0, "--help").is_err());
        assert!(git_merge_for(&dir.0, "missing").is_err());

        assert_eq!(
            git_rename_branch_for(&dir.0, "side", "feature").unwrap(),
            "feature"
        );
        assert!(git_rename_branch_for(&dir.0, "feature", "main").is_err());

        git_merge_for(&dir.0, "feature").unwrap();
        assert!(dir.0.join("b.txt").exists());
        git_delete_branch_for(&dir.0, "feature", false).unwrap();
        assert!(!git_ref_exists(&dir.0, "refs/heads/feature"));

        assert!(git(&dir.0, &["checkout", "-b", "topic", "HEAD~1"]));
        commit_file(&dir.0, "c.txt", "gamma\n", "on topic");
        git_rebase_for(&dir.0, "main").unwrap();
        assert!(dir.0.join("b.txt").exists() && dir.0.join("c.txt").exists());

        assert!(git_fetch_for(&dir.0, false).is_err());
    }

    #[test]
    fn git_branch_operations_ignore_same_named_tags() {
        let dir = tmp("git-branch-tag-collision");
        if !init_git_commit(&dir.0, &[("base.txt", "base\n")]) {
            return;
        }
        let base = git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap();
        assert!(git(&dir.0, &["checkout", "-b", "topic"]));
        let topic = commit_file(&dir.0, "topic.txt", "topic\n", "topic change");
        assert!(git(&dir.0, &["checkout", "main"]));
        assert!(git(&dir.0, &["tag", "topic", &base]));
        assert!(git(
            &dir.0,
            &["update-ref", "refs/remotes/origin/topic", &topic]
        ));
        assert!(git(&dir.0, &["tag", "origin/topic", &base]));

        for (name, expected) in [
            ("topic", "refs/heads/topic"),
            ("origin/topic", "refs/remotes/origin/topic"),
        ] {
            assert_eq!(git_branch_ref_arg(&dir.0, name).unwrap(), expected);
            assert!(git(
                &dir.0,
                &["checkout", "-b", &format!("merge-{name}"), &base]
            ));
            git_merge_for(&dir.0, name).unwrap();
            assert_eq!(git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap(), topic);

            assert!(git(
                &dir.0,
                &["checkout", "-b", &format!("rebase-{name}"), &base]
            ));
            git_rebase_for(&dir.0, name).unwrap();
            assert_eq!(git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap(), topic);

            git_create_branch_from_for(&dir.0, &format!("from-{name}"), name).unwrap();
            assert_eq!(git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap(), topic);
        }
        // A local branch keeps precedence over a same-named remote branch.
        assert!(git(&dir.0, &["branch", "origin/topic", &base]));
        assert_eq!(
            git_branch_ref_arg(&dir.0, "origin/topic").unwrap(),
            "refs/heads/origin/topic"
        );
    }

    #[test]
    fn git_stash_entries_list_apply_and_drop() {
        let dir = tmp("git-stash-list");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(git_stash_list_for(&dir.0), Vec::new());
        std::fs::write(dir.0.join("a.txt"), "changed\n").unwrap();
        git_stash_for(&dir.0, Some("my work"), GitStashMode::IncludeUntracked).unwrap();

        let entries = git_stash_list_for(&dir.0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].index, 0);
        assert!(entries[0].message.ends_with("my work"));
        assert_eq!(entries[0].sha.len(), 40);

        assert!(git_stash_action_for(&dir.0, "clear", 0, &entries[0].sha).is_err());
        git_stash_action_for(&dir.0, "apply", 0, &entries[0].sha).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "changed\n"
        );
        git_stash_action_for(&dir.0, "drop", 0, &entries[0].sha).unwrap();
        assert_eq!(git_stash_list_for(&dir.0), Vec::new());
    }

    #[test]
    fn git_stash_rejects_shifted_selection() {
        let dir = tmp("git-stash-stale");
        if !init_git_commit(&dir.0, &[("a.txt", "base\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "A\n").unwrap();
        git_stash_for(&dir.0, Some("A"), GitStashMode::Tracked).unwrap();
        let selected = git_stash_list_for(&dir.0)[0].sha.clone();
        std::fs::write(dir.0.join("a.txt"), "B\n").unwrap();
        git_stash_for(&dir.0, Some("B"), GitStashMode::Tracked).unwrap();
        let before = git_run(&dir.0, &["stash", "list", "--format=%H"]).unwrap();
        for action in ["apply", "pop", "drop"] {
            assert!(git_stash_action_for(&dir.0, action, 0, &selected)
                .unwrap_err()
                .contains("Stash list changed"));
            assert_eq!(
                git_run(&dir.0, &["stash", "list", "--format=%H"]).unwrap(),
                before
            );
            assert_eq!(
                std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
                "base\n"
            );
        }
    }

    /// A repo with one commit on `main`, pushed to a fresh bare `origin`.
    fn repo_with_origin(label: &str) -> Option<(Tmp, Tmp)> {
        let repo = tmp(&format!("{label}-repo"));
        let origin = tmp(&format!("{label}-origin"));
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")])
            || !git(&origin.0, &["init", "--bare"])
        {
            return None;
        }
        let url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
        {
            return None;
        }
        Some((repo, origin))
    }

    #[test]
    fn git_commit_signoff_and_undo_last_commit() {
        let dir = tmp("git-undo-commit");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git_undo_last_commit_for(&dir.0).is_err());

        std::fs::write(dir.0.join("b.txt"), "beta\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        git_commit_args(&dir.0, "second", &["--signoff"]).unwrap();
        let message = git_head_message_for(&dir.0).unwrap();
        assert!(message.contains("Signed-off-by: Bycoda <bycoda@test>"));

        git_undo_last_commit_for(&dir.0).unwrap();
        assert_eq!(git_head_message_for(&dir.0).unwrap().trim(), "init");
        assert_eq!(
            git_stdout(&dir.0, &["diff", "--cached", "--name-only"]).as_deref(),
            Some("b.txt")
        );

        assert!(git(&dir.0, &["commit", "-m", "second again"]));
        assert!(git(&dir.0, &["checkout", "-b", "side"]));
        commit_file(&dir.0, "c.txt", "gamma\n", "on side");
        assert!(git(&dir.0, &["checkout", "main"]));
        commit_file(&dir.0, "d.txt", "delta\n", "on main");
        assert!(git(&dir.0, &["merge", "--no-ff", "--no-edit", "side"]));
        let error = git_undo_last_commit_for(&dir.0).unwrap_err();
        assert!(error.contains("merge"), "{error}");
    }

    #[test]
    fn git_stash_modes_and_clear() {
        let dir = tmp("git-stash-modes");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n"), ("b.txt", "beta\n")]) {
            return;
        }
        let write = |name: &str, contents: &str| {
            std::fs::write(dir.0.join(name), contents).unwrap();
        };

        write("a.txt", "changed\n");
        write("new.txt", "untracked\n");
        git_stash_for(&dir.0, None, GitStashMode::Tracked).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "alpha\n"
        );
        assert!(dir.0.join("new.txt").exists());

        write("a.txt", "again\n");
        git_stash_for(&dir.0, None, GitStashMode::IncludeUntracked).unwrap();
        assert!(!dir.0.join("new.txt").exists());

        write("a.txt", "staged\n");
        write("b.txt", "unstaged\n");
        assert!(git(&dir.0, &["add", "a.txt"]));
        git_stash_for(&dir.0, Some("only index"), GitStashMode::Staged).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "alpha\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("b.txt")).unwrap(),
            "unstaged\n"
        );

        assert_eq!(git_stash_list_for(&dir.0).len(), 3);
        git_stash_clear_for(&dir.0).unwrap();
        assert_eq!(git_stash_list_for(&dir.0), Vec::new());
    }

    #[test]
    fn git_fetch_prunes_only_when_asked() {
        let Some((repo, origin)) = repo_with_origin("git-fetch-prune") else {
            return;
        };
        if !git(&repo.0, &["push", "origin", "main:feature"]) || !git(&repo.0, &["fetch", "origin"])
        {
            return;
        }
        assert!(git_ref_exists(&repo.0, "refs/remotes/origin/feature"));
        assert!(git(&origin.0, &["branch", "-D", "feature"]));

        git_fetch_for(&repo.0, false).unwrap();
        assert!(git_ref_exists(&repo.0, "refs/remotes/origin/feature"));
        git_fetch_for(&repo.0, true).unwrap();
        assert!(!git_ref_exists(&repo.0, "refs/remotes/origin/feature"));
    }

    #[test]
    fn git_pull_rebase_replays_local_commits() {
        let Some((repo, origin)) = repo_with_origin("git-pull-rebase") else {
            return;
        };
        let other = tmp("git-pull-rebase-other");
        let url = origin.0.to_string_lossy().into_owned();
        if !git(&other.0, &["clone", "--branch", "main", &url, "."]) {
            return;
        }
        commit_file(&other.0, "remote.txt", "remote\n", "remote work");
        assert!(git(&other.0, &["push", "origin", "main"]));
        commit_file(&repo.0, "local.txt", "local\n", "local work");

        assert!(git_pull_for(&repo.0, false).is_err());
        git_pull_for(&repo.0, true).unwrap();
        assert!(repo.0.join("remote.txt").exists() && repo.0.join("local.txt").exists());
        // Rebased, so no merge commit: HEAD has a single parent.
        let parents = git_stdout(&repo.0, &["rev-list", "--parents", "-n", "1", "HEAD"]).unwrap();
        assert_eq!(parents.split_whitespace().count(), 2);
    }

    #[test]
    fn git_delete_remote_branch_validates_and_deletes() {
        let Some((repo, origin)) = repo_with_origin("git-delete-remote") else {
            return;
        };
        if !git(&repo.0, &["push", "origin", "main:feature"]) {
            return;
        }
        assert!(git_ref_exists(&origin.0, "refs/heads/feature"));

        assert!(git_delete_remote_branch_for(&repo.0, "nope", "feature").is_err());
        assert!(git_delete_remote_branch_for(&repo.0, "--help", "feature").is_err());
        assert!(git_delete_remote_branch_for(&repo.0, "origin", "-x").is_err());
        assert!(git_delete_remote_branch_for(&repo.0, "origin", "@{-1}").is_err());
        assert!(git_delete_remote_branch_for(&repo.0, "origin", "bad name").is_err());
        assert!(git_ref_exists(&origin.0, "refs/heads/feature"));

        git_delete_remote_branch_for(&repo.0, "origin", "feature").unwrap();
        assert!(!git_ref_exists(&origin.0, "refs/heads/feature"));
        assert!(git_ref_exists(&origin.0, "refs/heads/main"));
        assert!(git_delete_remote_branch_for(&repo.0, "origin", "feature").is_err());
    }

    #[test]
    fn git_create_branch_from_a_remote_branch() {
        let Some((repo, _origin)) = repo_with_origin("git-branch-from") else {
            return;
        };
        if !git(&repo.0, &["checkout", "-b", "feature"])
            || git_checkout_for(&repo.0, "main", None).is_err()
        {
            return;
        }
        commit_file(&repo.0, "main.txt", "main\n", "main moves on");
        assert!(git(&repo.0, &["push", "origin", "main"]));

        assert!(git_create_branch_from_for(&repo.0, "topic", "--help").is_err());
        assert!(git_create_branch_from_for(&repo.0, "topic", "missing").is_err());
        assert!(git_create_branch_from_for(&repo.0, "feature", "origin/main").is_err());
        assert!(git_create_branch_from_for(&repo.0, "bad name", "origin/main").is_err());

        assert_eq!(
            git_create_branch_from_for(&repo.0, "topic", "origin/main").unwrap(),
            "topic"
        );
        assert_eq!(git_head_branch(&repo.0).as_deref(), Some("topic"));
        assert!(repo.0.join("main.txt").exists());
    }

    #[test]
    fn git_remotes_add_list_and_remove() {
        let dir = tmp("git-remotes");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(git_remotes_for(&dir.0), Vec::new());

        git_remote_add_for(
            &dir.0,
            " upstream ",
            " https://example.com/acme/widget.git ",
        )
        .unwrap();
        assert_eq!(
            git_remotes_for(&dir.0),
            vec![GitRemote {
                name: "upstream".into(),
                url: "https://example.com/acme/widget.git".into(),
            }]
        );

        assert!(git_remote_add_for(&dir.0, "upstream", "https://example.com/other.git").is_err());
        assert!(git_remote_add_for(&dir.0, "", "https://example.com/x.git").is_err());
        assert!(git_remote_add_for(&dir.0, "-x", "https://example.com/x.git").is_err());
        assert!(git_remote_add_for(&dir.0, "bad name", "https://example.com/x.git").is_err());
        assert!(git_remote_add_for(&dir.0, "fresh", "  ").is_err());
        assert!(git_remote_add_for(&dir.0, "fresh", "--upload-pack=evil").is_err());
        assert_eq!(git_remotes_for(&dir.0).len(), 1);

        assert!(git_remote_remove_for(&dir.0, "missing").is_err());
        assert!(git_remote_remove_for(&dir.0, "--help").is_err());
        git_remote_remove_for(&dir.0, "upstream").unwrap();
        assert_eq!(git_remotes_for(&dir.0), Vec::new());
    }

    #[test]
    fn git_tags_list_and_delete() {
        let dir = tmp("git-tags");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(git_tags_for(&dir.0), Vec::<String>::new());
        let head = git_stdout(&dir.0, &["rev-parse", "HEAD"]).unwrap();
        git_create_tag_for(&dir.0, "v1", &head).unwrap();
        git_create_tag_for(&dir.0, "release/v2", &head).unwrap();
        let mut tags = git_tags_for(&dir.0);
        tags.sort();
        assert_eq!(tags, vec!["release/v2".to_string(), "v1".to_string()]);

        assert!(git_delete_tag_for(&dir.0, "missing").is_err());
        assert!(git_delete_tag_for(&dir.0, "-d").is_err());
        assert!(git_delete_tag_for(&dir.0, "").is_err());
        git_delete_tag_for(&dir.0, "v1").unwrap();
        assert_eq!(git_tags_for(&dir.0), vec!["release/v2".to_string()]);
    }

    #[test]
    fn git_conflicts_resolve_and_continue() {
        let dir = tmp("git-conflicts");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "side"]));
        let side = commit_file(&dir.0, "a.txt", "side\n", "side change");
        assert!(git(&dir.0, &["checkout", "main"]));
        commit_file(&dir.0, "a.txt", "main\n", "main change");
        assert_eq!(git_conflicts_for(&dir.0), Vec::<String>::new());

        assert!(git_cherry_pick_for(&dir.0, &side).is_err());
        assert_eq!(git_conflicts_for(&dir.0), vec!["a.txt".to_string()]);
        assert!(git_resolve_conflict_for(&dir.0, "a.txt", "mine").is_err());

        git_resolve_conflict_for(&dir.0, "a.txt", "theirs").unwrap();
        assert_eq!(git_conflicts_for(&dir.0), Vec::<String>::new());
        git_operation_continue_for(&dir.0).unwrap();
        assert_eq!(git_operation_state_for(&dir.0), None);
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "side\n"
        );
        assert!(git_operation_continue_for(&dir.0).is_err());
    }

    #[test]
    fn git_file_history_and_blame_follow_one_file() {
        let dir = tmp("git-file-history");
        if !init_git_commit(&dir.0, &[("a.txt", "one\n"), ("b.txt", "other\n")]) {
            return;
        }
        let second = commit_file(&dir.0, "a.txt", "one\ntwo\n", "add two");
        commit_file(&dir.0, "b.txt", "changed\n", "touch b");

        let history = git_file_history_for(&dir.0, "a.txt", None).unwrap();
        assert_eq!(
            history
                .iter()
                .map(|c| c.subject.as_str())
                .collect::<Vec<_>>(),
            vec!["add two", "init"]
        );

        let blame = git_blame_for(&dir.0, "a.txt").unwrap();
        assert_eq!(blame.len(), 2);
        assert_eq!((blame[0].line, blame[0].summary.as_str()), (1, "init"));
        assert_eq!(blame[1].line, 2);
        assert_eq!(blame[1].sha, second);
        assert_eq!(blame[1].author, "Bycoda");
        assert!(git_blame_for(&dir.0, "../outside.txt").is_err());
    }

    #[test]
    fn git_selected_commit_message_and_blame_ignore_head_and_worktree() {
        let dir = tmp("git-selected-commit");
        if !init_git_commit(&dir.0, &[("old.txt", "one\n")]) {
            return;
        }
        let selected = commit_file(&dir.0, "old.txt", "historical\n", "subject\n\nfull body");
        assert!(git(&dir.0, &["mv", "old.txt", "new.txt"]));
        assert!(git(&dir.0, &["commit", "-qm", "rename"]));
        std::fs::write(dir.0.join("new.txt"), "uncommitted\n").unwrap();
        let lines = git_blame_at_for(&dir.0, "old.txt", Some(&selected)).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].sha, selected);
        assert_eq!(
            git_commit_message_for(&dir.0, &selected).unwrap().trim(),
            "subject\n\nfull body"
        );
        assert!(git_blame_at_for(&dir.0, "old.txt", Some("--help")).is_err());
        assert!(git_commit_message_for(&dir.0, "--help").is_err());
        let blob = git_stdout(&dir.0, &["rev-parse", "HEAD:new.txt"]).unwrap();
        assert!(git_commit_message_for(&dir.0, &blob).is_err());
    }

    #[test]
    fn change_counts_do_not_rewrite_the_git_index() {
        let repo = tmp("numstat-index");
        assert!(init_git_commit(
            &repo.0,
            &[("a.txt", "one\n"), ("b.txt", "one\n")]
        ));
        // Stale stat caches: a read that refreshed the index would rewrite it.
        // `a.txt` stays really modified so the counts are computed.
        thread::sleep(Duration::from_millis(1100));
        std::fs::write(repo.0.join("b.txt"), "two\n").unwrap();
        std::fs::write(repo.0.join("b.txt"), "one\n").unwrap();
        std::fs::write(repo.0.join("a.txt"), "one\nadded\n").unwrap();
        let index = repo.0.join(".git").join("index");
        let before = std::fs::read(&index).unwrap();
        let modified = std::fs::metadata(&index).unwrap().modified().unwrap();

        let changes = git_changes_for(&repo.0).unwrap();
        let a = changes
            .files
            .iter()
            .find(|f| f.relative == "a.txt")
            .unwrap();
        assert_eq!((a.additions, a.deletions), (1, 0));
        assert_eq!(changes.files.len(), 1, "only a.txt differs from HEAD");

        assert_eq!(
            std::fs::read(&index).unwrap(),
            before,
            "index bytes changed"
        );
        assert_eq!(
            std::fs::metadata(&index).unwrap().modified().unwrap(),
            modified,
            "index was rewritten"
        );
    }
}

#[cfg(test)]
mod spawn_gate_tests {
    use super::*;

    #[test]
    fn spawn_gate_hands_over_when_a_turn_ends_or_lapses() {
        // A gate of its own: the shared one is busy with the other tests.
        let gate: &'static GitSpawnGate = Box::leak(Box::new(GitSpawnGate {
            holder: Mutex::new(None),
            freed: std::sync::Condvar::new(),
            next: std::sync::atomic::AtomicU64::new(0),
        }));
        let first = gate.wait_turn();
        let started = Instant::now();
        let waiter = thread::spawn(move || {
            let _turn = gate.wait_turn();
            started.elapsed()
        });
        thread::sleep(Duration::from_millis(40));
        drop(first);
        // Freed well before the window would have lapsed on its own.
        let waited = waiter.join().unwrap();
        assert!(waited >= Duration::from_millis(30));
        assert!(waited < GIT_STARTUP_WINDOW);

        // A turn that is still held (a long push) stops blocking after the window.
        let _held = gate.wait_turn();
        let started = Instant::now();
        let _next = gate.wait_turn();
        assert!(started.elapsed() >= GIT_STARTUP_WINDOW - Duration::from_millis(20));
    }
}
