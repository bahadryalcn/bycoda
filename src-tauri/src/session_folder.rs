//! The folder where sessions without a project run. Those sessions are stored
//! with the bare cwd `~`; this module maps that sentinel to the folder the user
//! chose, or to the home folder when none is set. The choice lives in
//! `~/.bycoda-host/session-folder.json`, which the Bycoda Host reads too.

use std::path::{Path, PathBuf};

use crate::dirs_home;
use crate::fs::{expand_home, write_text_file_sync};

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

/// Like `expand_home`, except the bare `~` of a session without a project
/// becomes the configured session folder. `~/x` is left to `expand_home`.
pub(crate) fn resolve_session_cwd(cwd: &str) -> PathBuf {
    let home = dirs_home().map(PathBuf::from);
    resolve_in(cwd, choice_path().as_deref(), home.as_deref())
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
