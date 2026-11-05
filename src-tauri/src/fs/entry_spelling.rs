use std::path::{Path, PathBuf};

/// Resolve Unicode aliases through actual directory entries, never string identity alone.
/// Exact spellings win, including distinct files and hard links on case-sensitive volumes.
#[cfg(unix)]
fn entry_spelling(path: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::MetadataExt;
    use std::path::Component;
    use unicode_normalization::UnicodeNormalization;

    if !path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let original = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    let mut resolved = PathBuf::new();
    for component in path.components() {
        let Component::Normal(name) = component else {
            resolved.push(component.as_os_str());
            continue;
        };
        let requested = resolved.join(name);
        let metadata = std::fs::symlink_metadata(&requested).map_err(|error| error.to_string())?;
        let Some(text) = name.to_str() else {
            return Ok(path.to_path_buf());
        };
        let normalized: String = text.nfd().collect();
        let entries = std::fs::read_dir(&resolved).map_err(|error| error.to_string())?;
        let mut alias = None;
        let mut exact = None;
        let mut ambiguous = false;
        for (index, entry) in entries.enumerate() {
            // A slow or huge directory must not turn file navigation into an unbounded scan.
            if index >= 100_000 {
                return Ok(path.to_path_buf());
            }
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.file_name() == name {
                exact = Some(entry.path());
                break;
            }
            let candidate_name = entry.file_name();
            let Some(candidate_text) = candidate_name.to_str() else {
                continue;
            };
            if candidate_text.nfd().ne(normalized.chars()) {
                continue;
            }
            let candidate =
                std::fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if candidate.dev() == metadata.dev() && candidate.ino() == metadata.ino() {
                ambiguous |= alias.is_some();
                alias = Some(entry.path());
            }
        }
        resolved = match exact {
            Some(exact) => exact,
            None if !ambiguous => alias.unwrap_or(requested),
            None => return Ok(path.to_path_buf()),
        };
    }
    let current = std::fs::symlink_metadata(&resolved).map_err(|error| error.to_string())?;
    if original.dev() != current.dev() || original.ino() != current.ino() {
        return Err("File identity changed while resolving its directory entry".into());
    }
    Ok(resolved)
}

#[cfg(not(unix))]
fn entry_spelling(path: &Path) -> Result<PathBuf, String> {
    Ok(path.to_path_buf())
}

#[tauri::command]
pub async fn resolve_file_entry_spelling(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<String, String> {
    let admission = crate::native_window_lifecycle::admit_window_buffers(&window)?;
    super::run_admitted_blocking(admission, move || {
        let requested = super::expand_home(&path);
        crate::file_access::require(&app, &requested, false)?;
        let resolved = entry_spelling(&requested)?;
        crate::file_access::require(&app, &resolved, false)?;
        Ok(super::path_to_js(&resolved))
    })
    .await
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn exact_distinct_unicode_names_and_hard_links_remain_distinct() {
        let root = tempfile::tempdir().unwrap();
        let composed = root.path().join("caf\u{e9}.txt");
        let decomposed = root.path().join("cafe\u{301}.txt");
        std::fs::write(&composed, "first").unwrap();
        if !decomposed.exists() {
            std::fs::hard_link(&composed, &decomposed).unwrap();
            assert_eq!(entry_spelling(&composed).unwrap(), composed);
            assert_eq!(entry_spelling(&decomposed).unwrap(), decomposed);
        } else {
            // Normalization-insensitive filesystems resolve both names to one actual entry.
            assert_eq!(
                entry_spelling(&composed).unwrap(),
                entry_spelling(&decomposed).unwrap()
            );
        }
    }
}
