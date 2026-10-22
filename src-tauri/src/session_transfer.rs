//! Moves a provider conversation transcript between local provider accounts so
//! the same provider thread id can be resumed under another credential profile.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::AppHandle;

use crate::fs::claude_project_dir;
use crate::turn_probe::find_codex_rollout;

const DEFAULT_ACCOUNT: &str = "default";
const MAX_SESSION_ID_LEN: usize = 128;
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > MAX_SESSION_ID_LEN
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid provider session id".into());
    }
    Ok(())
}

fn normalize_account(id: Option<String>) -> String {
    match id {
        Some(id) if !id.is_empty() => id,
        _ => DEFAULT_ACCOUNT.to_string(),
    }
}

fn account_home(app: &AppHandle, provider: &str, account: &str) -> Result<PathBuf, String> {
    if account != DEFAULT_ACCOUNT {
        return crate::harness::provider_account_path(app, provider, account);
    }
    let (env, dir) = if provider == "claude" {
        ("CLAUDE_CONFIG_DIR", ".claude")
    } else {
        ("CODEX_HOME", ".codex")
    };
    match std::env::var_os(env) {
        Some(path) if !path.is_empty() => Ok(PathBuf::from(path)),
        _ => {
            Ok(PathBuf::from(crate::dirs_home().ok_or("Home directory is unavailable")?).join(dir))
        }
    }
}

#[tauri::command]
pub async fn provider_transfer_session(
    app: AppHandle,
    provider: String,
    from_account_id: Option<String>,
    to_account_id: Option<String>,
    provider_session_id: String,
    cwd: String,
) -> Result<bool, String> {
    if provider != "claude" && provider != "codex" {
        return Err("Unsupported provider".into());
    }
    validate_session_id(&provider_session_id)?;
    let from = normalize_account(from_account_id);
    let to = normalize_account(to_account_id);
    if from == to {
        return Ok(true);
    }
    let from_dir = account_home(&app, &provider, &from)?;
    let to_dir = account_home(&app, &provider, &to)?;
    tauri::async_runtime::spawn_blocking(move || {
        if provider == "claude" {
            transfer_claude_session(&from_dir, &to_dir, &cwd, &provider_session_id)
        } else {
            transfer_codex_session(&from_dir, &to_dir, &provider_session_id)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn transfer_claude_session(
    from_dir: &Path,
    to_dir: &Path,
    cwd: &str,
    session_id: &str,
) -> Result<bool, String> {
    validate_session_id(session_id)?;
    let cwd = crate::fs::expand_home(cwd);
    let cwd = cwd.to_string_lossy();
    let src_project = claude_project_dir(from_dir, &cwd);
    let src_file = src_project.join(format!("{session_id}.jsonl"));
    if !src_file.is_file() {
        return Ok(false);
    }
    let dst_project = claude_project_dir(to_dir, &cwd);
    copy_file_if_newer(&src_file, &dst_project.join(format!("{session_id}.jsonl")))?;
    let src_sidecar = src_project.join(session_id);
    if src_sidecar.is_dir() {
        copy_dir_missing_or_newer(&src_sidecar, &dst_project.join(session_id))?;
    }
    Ok(true)
}

fn transfer_codex_session(
    from_dir: &Path,
    to_dir: &Path,
    session_id: &str,
) -> Result<bool, String> {
    validate_session_id(session_id)?;
    let Some(src) = find_codex_rollout(from_dir, session_id) else {
        return Ok(false);
    };
    // The probe matches by suffix; insist on a whole `-<id>` component.
    let named = src.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if !named.ends_with(&format!("-{session_id}.jsonl")) {
        return Ok(false);
    }
    let rel = src
        .strip_prefix(from_dir)
        .map_err(|_| "Rollout is outside the Codex home".to_string())?;
    copy_file_if_newer(&src, &to_dir.join(rel))?;
    Ok(true)
}

/// Copy `src` to `dst` atomically unless `dst` is already at least as new and
/// as large. The source is never touched.
fn copy_file_if_newer(src: &Path, dst: &Path) -> Result<(), String> {
    if let (Ok(s), Ok(d)) = (std::fs::metadata(src), std::fs::metadata(dst)) {
        let src_newer = matches!(
            (s.modified(), d.modified()),
            (Ok(a), Ok(b)) if a > b
        );
        if !src_newer && s.len() <= d.len() {
            return Ok(());
        }
    }
    let parent = dst.parent().ok_or("Invalid destination path")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    let tmp = parent.join(format!(
        ".transfer-{}-{}.tmp",
        std::process::id(),
        TEMP_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::copy(src, &tmp).map_err(|e| format!("Could not copy {}: {e}", src.display()))?;
    if let Err(e) = std::fs::rename(&tmp, dst) {
        // Some platforms will not rename over an existing file.
        let _ = std::fs::remove_file(dst);
        if let Err(e2) = std::fs::rename(&tmp, dst) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Could not place {}: {e} / {e2}", dst.display()));
        }
    }
    Ok(())
}

fn copy_dir_missing_or_newer(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Could not create {}: {e}", dst.display()))?;
    let entries = std::fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            copy_dir_missing_or_newer(&path, &target)?;
        } else if kind.is_file() {
            copy_file_if_newer(&path, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tmp() -> Tmp {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "bycoda-transfer-{}-{stamp}-{}",
            std::process::id(),
            TEMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Tmp(dir)
    }

    const ID: &str = "019a1b2c-0000-7000-8000-00000000abcd";

    #[test]
    fn claude_copy_includes_sidecar_dir() {
        let t = tmp();
        let (from, to) = (t.0.join("from"), t.0.join("to"));
        let cwd = "/work/app";
        let proj = claude_project_dir(&from, cwd);
        std::fs::create_dir_all(proj.join(ID).join("subagents")).unwrap();
        std::fs::write(proj.join(format!("{ID}.jsonl")), "{}\n").unwrap();
        std::fs::write(proj.join(ID).join("subagents").join("a.jsonl"), "x").unwrap();

        assert!(transfer_claude_session(&from, &to, cwd, ID).unwrap());
        let dst = claude_project_dir(&to, cwd);
        assert_eq!(
            std::fs::read_to_string(dst.join(format!("{ID}.jsonl"))).unwrap(),
            "{}\n"
        );
        assert!(dst.join(ID).join("subagents").join("a.jsonl").is_file());
        assert!(proj.join(format!("{ID}.jsonl")).is_file());
        // Idempotent, and does not clobber a larger target.
        std::fs::write(dst.join(format!("{ID}.jsonl")), "{}\n{}\n").unwrap();
        assert!(transfer_claude_session(&from, &to, cwd, ID).unwrap());
        assert_eq!(
            std::fs::read_to_string(dst.join(format!("{ID}.jsonl"))).unwrap(),
            "{}\n{}\n"
        );
    }

    #[test]
    fn codex_copy_preserves_date_path() {
        let t = tmp();
        let (from, to) = (t.0.join("from"), t.0.join("to"));
        let rel = format!("sessions/2026/10/01/rollout-2026-10-01T10-00-00-{ID}.jsonl");
        let src = from.join(&rel);
        std::fs::create_dir_all(src.parent().unwrap()).unwrap();
        std::fs::write(&src, "line\n").unwrap();

        assert!(transfer_codex_session(&from, &to, ID).unwrap());
        assert_eq!(std::fs::read_to_string(to.join(&rel)).unwrap(), "line\n");
        assert!(src.is_file());
    }

    #[test]
    fn missing_source_returns_false() {
        let t = tmp();
        let (from, to) = (t.0.join("from"), t.0.join("to"));
        assert!(!transfer_claude_session(&from, &to, "/work/app", ID).unwrap());
        assert!(!transfer_codex_session(&from, &to, ID).unwrap());
    }

    #[test]
    fn invalid_ids_are_rejected() {
        let t = tmp();
        let long = "a".repeat(200);
        for bad in ["", "../x", "a/b", "a\\b", "a.b", long.as_str()] {
            assert!(transfer_claude_session(&t.0, &t.0, "/w", bad).is_err());
            assert!(transfer_codex_session(&t.0, &t.0, bad).is_err());
        }
    }
}
