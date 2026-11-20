use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const MAX_ROWS: usize = 128;
const MAX_ENTRIES: usize = 1024;
const MAX_METADATA: u64 = 16 * 1024;
const MAX_TRANSCRIPT: u64 = 64 * 1024;
const MAX_TOTAL: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowArtifact {
    agent_id: String,
    metadata: String,
    transcript: String,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowResolution {
    provider_session_id: String,
    run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
}

fn xml_field<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let (before, rest) = text.split_once(&format!("<{name}>"))?;
    let (value, after) = rest.split_once(&format!("</{name}>"))?;
    if before.contains(&format!("<{name}>"))
        || after.contains(&format!("<{name}>"))
        || value.contains('<')
        || value.contains('>')
    {
        return None;
    }
    Some(value)
}

fn resolve_workflow(
    config: &Path,
    cwd: &str,
    call_id: &str,
    known_session: Option<&str>,
) -> Result<Option<WorkflowResolution>, String> {
    if !safe_name(call_id, 200) || !Path::new(cwd).is_absolute() {
        return Err("Invalid workflow lookup".into());
    }
    if let Some(id) = known_session {
        let uuid = uuid::Uuid::parse_str(id).map_err(|_| "Invalid provider session id")?;
        if uuid.hyphenated().to_string() != id {
            return Err("Invalid provider session id".into());
        }
    }
    let root = match std::fs::canonicalize(config) {
        Ok(root) => root,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let project = crate::fs::claude_project_dir(&root, cwd);
    let relative = project.strip_prefix(&root).map_err(|e| e.to_string())?;
    let mut component = root.clone();
    for part in relative.components() {
        component.push(part);
        match std::fs::symlink_metadata(&component) {
            Ok(_) => reject_link(&component)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        }
    }
    let project = contained(&project, &root)?;
    let mut paths = Vec::new();
    if let Some(id) = known_session {
        let path = project.join(format!("{id}.jsonl"));
        if !path.exists() {
            return Ok(None);
        }
        paths.push((id.to_owned(), path));
    } else {
        for (index, entry) in std::fs::read_dir(&project)
            .map_err(|e| e.to_string())?
            .enumerate()
        {
            if index >= 4096 {
                return Ok(None);
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Some(id) = name.strip_suffix(".jsonl") else {
                continue;
            };
            let Ok(uuid) = uuid::Uuid::parse_str(id) else {
                continue;
            };
            if uuid.hyphenated().to_string() != id {
                continue;
            }
            paths.push((id.to_owned(), entry.path()));
            if paths.len() > 256 {
                return Ok(None);
            }
        }
    }
    let mut total = 0u64;
    let mut match_found = None;
    for (session_id, path) in paths {
        reject_link(&path)?;
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        total = total.saturating_add(size);
        if size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024 {
            return Ok(None);
        }
        let text = read_bounded(&path, &project, 16 * 1024 * 1024, false)?;
        let mut saw_call = false;
        let mut candidate: Option<(String, String)> = None;
        let mut notifications = Vec::new();
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(row) = serde_json::from_str::<Value>(line) else {
                return Ok(None);
            };
            let content = &row["message"]["content"];
            if row["type"] == "assistant"
                && content.as_array().is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block["type"] == "tool_use"
                            && block["name"] == "Workflow"
                            && block["id"] == call_id
                    })
                })
            {
                saw_call = true;
            }
            if row["type"] == "user"
                && saw_call
                && content.as_array().is_some_and(|blocks| {
                    blocks
                        .iter()
                        .filter(|block| block["type"] == "tool_result")
                        .count()
                        == 1
                        && blocks.iter().any(|block| {
                            block["type"] == "tool_result" && block["tool_use_id"] == call_id
                        })
                })
            {
                let result = row
                    .get("toolUseResult")
                    .or_else(|| row.get("tool_use_result"))
                    .unwrap_or(&Value::Null);
                let field = |a: &str, b: &str| {
                    result
                        .get(a)
                        .or_else(|| result.get(b))
                        .and_then(Value::as_str)
                };
                if field("taskType", "task_type") == Some("local_workflow") {
                    if let (Some(task), Some(run)) =
                        (field("taskId", "task_id"), field("runId", "run_id"))
                    {
                        if safe_name(task, 200)
                            && run.strip_prefix("wf_").is_some_and(|s| safe_name(s, 80))
                        {
                            let next = (task.to_owned(), run.to_owned());
                            if candidate.as_ref().is_some_and(|prior| prior != &next) {
                                return Ok(None);
                            }
                            candidate = Some(next);
                        }
                    }
                }
            }
            if row["type"] == "user"
                && row["origin"]["kind"] == "task-notification"
                && row["origin"]["producer"] == "session-task"
            {
                if let Some(content) = content
                    .as_str()
                    .filter(|s| s.trim_start().starts_with("<task-notification>"))
                {
                    if let (Some(task), Some(status)) =
                        (xml_field(content, "task-id"), xml_field(content, "status"))
                    {
                        if matches!(status, "completed" | "failed" | "stopped") {
                            notifications.push((task.to_owned(), status.to_owned()));
                        }
                    }
                }
            }
        }
        if let Some((task, run_id)) = candidate {
            let statuses: std::collections::HashSet<_> = notifications
                .into_iter()
                .filter(|(id, _)| id == &task)
                .map(|(_, status)| status)
                .collect();
            if statuses.len() > 1 || match_found.is_some() {
                return Ok(None);
            }
            match_found = Some(WorkflowResolution {
                provider_session_id: session_id,
                run_id,
                status: statuses.into_iter().next(),
            });
        }
    }
    Ok(match_found)
}

#[tauri::command]
pub async fn harness_claude_workflow_resolve(
    app: AppHandle,
    cwd: String,
    provider_account_id: Option<String>,
    provider_session_id: Option<String>,
    call_id: String,
) -> Result<Option<WorkflowResolution>, String> {
    let config = crate::fs::claude_config_dir(&app, provider_account_id.as_deref())?;
    crate::harness::run_blocking("harness_claude_workflow_resolve", move || {
        resolve_workflow(&config, &cwd, &call_id, provider_session_id.as_deref())
    })
    .await
}

fn safe_name(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn contained(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) {
        return Err("Workflow artifact is outside its provider folder".into());
    }
    Ok(canonical)
}

#[cfg(windows)]
fn opened_path(file: &std::fs::File) -> Result<PathBuf, String> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut buffer = vec![0u16; 32768];
    let len = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle() as _,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if len == 0 || len >= buffer.len() {
        return Err("Cannot verify opened workflow artifact".into());
    }
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len])))
}

#[cfg(target_os = "linux")]
fn opened_path(file: &std::fs::File) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn opened_path(file: &std::fs::File) -> Result<PathBuf, String> {
    use std::os::{fd::AsRawFd, unix::ffi::OsStrExt};
    let mut buffer = [0u8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) } == -1 {
        return Err("Cannot verify opened workflow artifact".into());
    }
    let end = buffer.iter().position(|&b| b == 0).unwrap_or(buffer.len());
    Ok(PathBuf::from(std::ffi::OsStr::from_bytes(&buffer[..end])))
}

fn reject_link(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let linked = metadata.file_type().is_symlink();
    if linked {
        return Err("Workflow artifact path contains a link".into());
    }
    Ok(())
}

fn read_bounded(path: &Path, dir: &Path, limit: u64, tail: bool) -> Result<String, String> {
    reject_link(path)?;
    let canonical = contained(path, dir)?;
    if canonical.parent() != Some(dir) {
        return Err("Workflow artifact is outside its workflow".into());
    }
    let mut file = std::fs::File::open(&canonical).map_err(|e| e.to_string())?;
    if opened_path(&file)? != canonical {
        return Err("Opened workflow artifact changed".into());
    }
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || (!tail && metadata.len() > limit) {
        return Err("Workflow artifact exceeds its limit or is not a file".into());
    }
    let truncated = tail && metadata.len() > limit;
    if truncated {
        file.seek(SeekFrom::End(-(limit as i64)))
            .map_err(|e| e.to_string())?;
    }
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if truncated {
        bytes = match bytes.iter().position(|&b| b == b'\n') {
            Some(index) => bytes.split_off(index + 1),
            None => Vec::new(),
        };
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn artifacts(
    config_dir: &Path,
    cwd: &str,
    session_id: &str,
    run_id: &str,
) -> Result<Vec<WorkflowArtifact>, String> {
    let uuid = uuid::Uuid::parse_str(session_id).map_err(|_| "Invalid provider session id")?;
    if uuid.hyphenated().to_string() != session_id
        || !run_id
            .strip_prefix("wf_")
            .is_some_and(|suffix| safe_name(suffix, 80))
    {
        return Err("Invalid workflow identity".into());
    }
    let root = match std::fs::canonicalize(config_dir) {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let dir = crate::fs::claude_project_dir(&root, &crate::fs::expand_home(cwd).to_string_lossy())
        .join(session_id)
        .join("subagents")
        .join("workflows")
        .join(run_id);
    let relative = dir.strip_prefix(&root).map_err(|e| e.to_string())?;
    let mut component_path = root.clone();
    for component in relative.components() {
        component_path.push(component);
        match std::fs::symlink_metadata(&component_path) {
            Ok(_) => reject_link(&component_path)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.to_string()),
        }
    }
    let dir = match contained(&dir, &root) {
        Ok(dir) => dir,
        Err(_) if !dir.exists() => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .take(MAX_ENTRIES)
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(id) = name
            .strip_prefix("agent-")
            .and_then(|s| s.strip_suffix(".meta.json"))
        else {
            continue;
        };
        if safe_name(id, 80) {
            names.push(id.to_owned());
        }
    }
    names.sort();
    let mut result = Vec::new();
    let mut total = 0;
    for id in names.into_iter().take(MAX_ROWS) {
        let metadata_path = dir.join(format!("agent-{id}.meta.json"));
        let transcript_path = dir.join(format!("agent-{id}.jsonl"));
        if !transcript_path.exists() {
            continue;
        }
        let metadata = read_bounded(&metadata_path, &dir, MAX_METADATA, false)?;
        let transcript = read_bounded(&transcript_path, &dir, MAX_TRANSCRIPT, true)?;
        total += metadata.len() + transcript.len();
        if total > MAX_TOTAL {
            break;
        }
        result.push(WorkflowArtifact {
            agent_id: id,
            metadata,
            transcript,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn harness_claude_workflow_artifacts(
    app: AppHandle,
    cwd: String,
    provider_account_id: Option<String>,
    provider_session_id: String,
    run_id: String,
) -> Result<Vec<WorkflowArtifact>, String> {
    let config_dir = crate::fs::claude_config_dir(&app, provider_account_id.as_deref())?;
    crate::harness::run_blocking("harness_claude_workflow_artifacts", move || {
        artifacts(&config_dir, &cwd, &provider_session_id, &run_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    const SESSION: &str = "d0897ea8-f733-472a-bc5e-869c3fb23027";
    const RUN: &str = "wf_6e2a3c4b-343";

    #[test]
    fn resolves_only_unambiguous_workflow_call() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().join("repo").to_string_lossy().into_owned();
        let project = crate::fs::claude_project_dir(dir.path(), &cwd);
        std::fs::create_dir_all(&project).unwrap();
        let transcript = [
            serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Workflow","id":"toolu_test"}]}}),
            serde_json::json!({"type":"user","toolUseResult":{"taskType":"local_workflow","taskId":"task1","runId":"wf_one"},"message":{"content":[{"type":"tool_result","tool_use_id":"toolu_test"}]}}),
            serde_json::json!({"type":"user","origin":{"kind":"task-notification","producer":"session-task"},"message":{"content":"<task-notification><task-id>task1</task-id><status>completed</status></task-notification>"}}),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
        std::fs::write(project.join(format!("{SESSION}.jsonl")), &transcript).unwrap();
        assert_eq!(
            resolve_workflow(dir.path(), &cwd, "toolu_test", None).unwrap(),
            Some(WorkflowResolution {
                provider_session_id: SESSION.into(),
                run_id: "wf_one".into(),
                status: Some("completed".into())
            })
        );
        let other = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        std::fs::write(project.join(format!("{other}.jsonl")), &transcript).unwrap();
        assert_eq!(
            resolve_workflow(dir.path(), &cwd, "toolu_test", None).unwrap(),
            None
        );
        assert!(
            resolve_workflow(dir.path(), &cwd, "toolu_test", Some(SESSION))
                .unwrap()
                .is_some()
        );
        assert_eq!(
            resolve_workflow(dir.path(), &cwd, "missing", None).unwrap(),
            None
        );
    }

    fn fixture(root: &Path) -> PathBuf {
        let dir = crate::fs::claude_project_dir(root, "/project")
            .join(SESSION)
            .join("subagents/workflows")
            .join(RUN);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_only_matching_pairs_and_tail_lines() {
        let temp = tempfile::tempdir().unwrap();
        let dir = fixture(temp.path());
        std::fs::write(dir.join("agent-a.meta.json"), "{}").unwrap();
        std::fs::write(
            dir.join("agent-a.jsonl"),
            format!("{}\nlast\n", "x".repeat(MAX_TRANSCRIPT as usize)),
        )
        .unwrap();
        std::fs::write(dir.join("agent-unpaired.meta.json"), "{}").unwrap();
        let rows = artifacts(temp.path(), "/project", SESSION, RUN).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].agent_id, "a");
        assert_eq!(rows[0].transcript, "last\n");
        assert!(artifacts(temp.path(), "/project", "../session", RUN).is_err());
        assert!(artifacts(temp.path(), "/project", SESSION, "wf_../escape").is_err());
        assert!(artifacts(temp.path(), "/project", SESSION, "wf_").is_err());
    }

    #[test]
    fn rejects_other_workflow_file_within_account() {
        let temp = tempfile::tempdir().unwrap();
        let dir = fixture(temp.path());
        let other = dir.parent().unwrap().join("wf_other");
        std::fs::create_dir(&other).unwrap();
        let file = other.join("agent-a.jsonl");
        std::fs::write(&file, "private").unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        assert!(read_bounded(&file, &dir, MAX_TRANSCRIPT, true).is_err());
    }

    #[test]
    fn rejects_oversized_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let dir = fixture(temp.path());
        std::fs::write(
            dir.join("agent-a.meta.json"),
            vec![b'x'; MAX_METADATA as usize + 1],
        )
        .unwrap();
        std::fs::write(dir.join("agent-a.jsonl"), "hello\n").unwrap();
        assert!(artifacts(temp.path(), "/project", SESSION, RUN).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let temp = tempfile::tempdir().unwrap();
        let dir = fixture(temp.path());
        let other = dir.parent().unwrap().join("wf_other");
        std::fs::create_dir(&other).unwrap();
        std::fs::write(dir.join("agent-a.meta.json"), "{}").unwrap();
        std::fs::write(other.join("transcript"), "private").unwrap();
        std::os::unix::fs::symlink(other.join("transcript"), dir.join("agent-a.jsonl")).unwrap();
        assert!(artifacts(temp.path(), "/project", SESSION, RUN).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_workflow_directory_link_within_account() {
        let temp = tempfile::tempdir().unwrap();
        let dir = fixture(temp.path());
        let other = dir.parent().unwrap().join("wf_other");
        std::fs::remove_dir(&dir).unwrap();
        std::fs::create_dir(&other).unwrap();
        std::os::unix::fs::symlink(&other, &dir).unwrap();
        assert!(artifacts(temp.path(), "/project", SESSION, RUN).is_err());
    }
}
