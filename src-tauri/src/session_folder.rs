//! Working folders for projectless sessions. New chats use a reserved path under
//! `~/.bycoda-host/scratch`. Bare `~` still resolves to the legacy folder choice or home.

use std::path::{Path, PathBuf};

use crate::dirs_home;
use crate::fs::{expand_home, write_text_file_sync};

const SCRATCH_PREFIX: &str = "~/.bycoda-host/scratch/session-";

fn choice_path() -> Option<PathBuf> {
    Some(
        PathBuf::from(dirs_home()?)
            .join(".bycoda-host")
            .join("session-folder.json"),
    )
}

fn parse_folder(raw: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let folder = value.get("folder")?.as_str()?.trim();
    (!folder.is_empty()).then(|| folder.to_string())
}

fn is_local_absolute(folder: &str) -> bool {
    let unc = folder.starts_with("\\\\") || folder.starts_with("//");
    !unc && !folder.contains("://") && !folder.contains('\0') && Path::new(folder).is_absolute()
}

fn configured_in(path: &Path) -> Option<String> {
    parse_folder(&std::fs::read_to_string(path).ok()?)
}

fn resolve_in(cwd: &str, choice: Option<&Path>, home: Option<&Path>) -> PathBuf {
    if cwd == "~" {
        let folder = choice
            .and_then(configured_in)
            .filter(|folder| is_local_absolute(folder));
        if let Some(folder) = folder {
            let folder = PathBuf::from(folder);
            if folder.is_dir() || std::fs::create_dir_all(&folder).is_ok() {
                return folder;
            }
        }
        if let Some(home) = home {
            return home.to_path_buf();
        }
    }
    expand_home(cwd)
}

/// Like `expand_home`, with on-demand creation for managed scratch paths
/// and the legacy folder override for bare `~`.
pub(crate) fn resolve_session_cwd(cwd: &str) -> Result<PathBuf, String> {
    let home = dirs_home().map(PathBuf::from);
    if let Some(id) = cwd.strip_prefix(SCRATCH_PREFIX) {
        return create_scratch_folder(id, &home.ok_or("No home folder")?);
    }
    Ok(resolve_in(cwd, choice_path().as_deref(), home.as_deref()))
}

fn create_scratch_folder(id: &str, home: &Path) -> Result<PathBuf, String> {
    if id.len() > 180 || crate::session_store::validate_id(id, "session").is_err() {
        return Err("Invalid session scratch directory".into());
    }
    let root = home.join(".bycoda-host").join("scratch");
    let folder = root.join(format!("session-{id}"));
    for path in [&root, &folder] {
        std::fs::create_dir_all(path).map_err(|error| format!("{}: {error}", path.display()))?;
        if !std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir()) {
            return Err(format!(
                "Invalid session scratch directory: {}",
                path.display()
            ));
        }
    }
    Ok(folder)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFolder {
    /// The saved choice, if any.
    pub chosen: Option<String>,
    /// What a session without a project uses when nothing is chosen.
    pub home: Option<String>,
}

#[tauri::command(async)]
pub fn session_folder() -> SessionFolder {
    SessionFolder {
        chosen: choice_path().as_deref().and_then(configured_in),
        home: dirs_home().map(|home| crate::fs::path_to_js(Path::new(&home))),
    }
}

/// Saves the folder for sessions without a project; None goes back to home.
#[tauri::command(async)]
pub fn set_session_folder(folder: Option<String>) -> Result<(), String> {
    let path = choice_path().ok_or("No home folder")?;
    let Some(folder) = folder
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty())
    else {
        return match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        };
    };
    if !is_local_absolute(&folder) {
        return Err("Choose an absolute folder on this computer".into());
    }
    std::fs::create_dir_all(&folder).map_err(|e| format!("{folder}: {e}"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_text_file_sync(
        &path.to_string_lossy(),
        &serde_json::json!({ "folder": folder }).to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-session-folder-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unset_resolves_to_home() {
        let root = temp("unset");
        let home = root.join("home");
        let resolved = resolve_in("~", Some(&root.join("missing.json")), Some(&home));
        assert_eq!(resolved, home);
    }

    #[test]
    fn scratch_is_stable_per_session_and_rejects_traversal() {
        let home = temp("scratch-session");
        let id = "00000000-0000-4000-8000-000000000001";
        let folder = create_scratch_folder(id, &home).unwrap();
        std::fs::write(folder.join("output.txt"), "keep").unwrap();
        assert_eq!(create_scratch_folder(id, &home).unwrap(), folder);
        assert!(folder.join("output.txt").is_file());
        assert_ne!(
            create_scratch_folder("00000000-0000-4000-8000-000000000002", &home).unwrap(),
            folder
        );
        assert!(create_scratch_folder("../elsewhere", &home).is_err());
    }

    #[test]
    fn set_folder_is_created_and_used() {
        let root = temp("set");
        let target = root.join("work").join("scratch");
        let choice = root.join("session-folder.json");
        std::fs::write(
            &choice,
            serde_json::json!({ "folder": target.to_string_lossy() }).to_string(),
        )
        .unwrap();
        let resolved = resolve_in("~", Some(&choice), Some(&root));
        assert_eq!(resolved, target);
        assert!(target.is_dir());
    }

    #[test]
    fn relative_choice_falls_back_to_home() {
        let root = temp("relative");
        let choice = root.join("session-folder.json");
        std::fs::write(&choice, r#"{"folder":"relative/dir"}"#).unwrap();
        assert_eq!(resolve_in("~", Some(&choice), Some(&root)), root);
    }

    #[test]
    fn subpaths_are_not_redirected() {
        let root = temp("sub");
        let choice = root.join("session-folder.json");
        let target = root.join("elsewhere");
        std::fs::write(
            &choice,
            serde_json::json!({ "folder": target.to_string_lossy() }).to_string(),
        )
        .unwrap();
        assert_eq!(
            resolve_in("~/x", Some(&choice), Some(&root)),
            expand_home("~/x")
        );
        assert!(!target.exists());
    }
}
