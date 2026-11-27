use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::AppHandle;

/// Files younger than this may belong to an in-flight preview or save whose reference the
/// renderer has not recorded yet.
const MIN_AGE: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone)]
struct Candidate {
    path: PathBuf,
    is_file: bool,
    len: u64,
    modified: Option<SystemTime>,
}

#[derive(Serialize, Default, Debug, PartialEq, Eq)]
pub struct Reclaimed {
    pub count: u32,
    pub bytes: u64,
}

/// Canonical keep paths that live directly in the store; anything else cannot match a store file.
fn canonical_keep(root: &Path, keep: &[String]) -> HashSet<PathBuf> {
    keep.iter()
        .filter_map(|path| Path::new(path).canonicalize().ok())
        .filter(|path| path.parent() == Some(root))
        .collect()
}

/// Regular, unreferenced, old-enough content-addressed files (`asset-*`, written by
/// store_background_bytes). Legacy slot files keep their own lifecycle. A missing modified time
/// is treated as recent.
fn select_reclaimable<'a>(
    entries: &'a [Candidate],
    keep: &HashSet<PathBuf>,
    now: SystemTime,
) -> Vec<&'a Candidate> {
    entries
        .iter()
        .filter(|entry| entry.is_file && !keep.contains(&entry.path))
        .filter(|entry| {
            entry
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("asset-"))
        })
        .filter(|entry| {
            entry
                .modified
                .is_some_and(|time| now.duration_since(time).is_ok_and(|age| age >= MIN_AGE))
        })
        .collect()
}

fn reclaim_sync(app: &AppHandle, keep: Vec<String>) -> Result<Reclaimed, String> {
    // Share the store lock so a save cannot reuse a file this sweep is about to delete.
    let _guard = super::store_lock().lock().map_err(|e| e.to_string())?;
    let root = super::backgrounds_dir(app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let keep = canonical_keep(&root, &keep);
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        // file_type does not follow symlinks, so links and directories are never candidates.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        entries.push(Candidate {
            path: root.join(entry.file_name()),
            is_file: kind.is_file(),
            len: metadata.len(),
            modified: metadata.modified().ok(),
        });
    }
    let mut reclaimed = Reclaimed::default();
    for entry in select_reclaimable(&entries, &keep, SystemTime::now()) {
        if std::fs::remove_file(&entry.path).is_ok() {
            reclaimed.count += 1;
            reclaimed.bytes += entry.len;
        }
    }
    Ok(reclaimed)
}

/// Deletes stored backgrounds the renderer no longer references. The renderer passes every path
/// it can still reach; the library subfolder and anything recent are left alone.
#[tauri::command]
pub async fn chat_background_reclaim(
    app: AppHandle,
    keep: Vec<String>,
) -> Result<Reclaimed, String> {
    tauri::async_runtime::spawn_blocking(move || reclaim_sync(&app, keep))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &Path, is_file: bool, age: Duration, now: SystemTime) -> Candidate {
        Candidate {
            path: path.to_path_buf(),
            is_file,
            len: 10,
            modified: Some(now - age),
        }
    }

    #[test]
    fn selects_only_old_unreferenced_regular_files() {
        let root = Path::new("/store");
        let now = SystemTime::now();
        let old = Duration::from_secs(3600);
        let kept = root.join("asset-kept.png");
        let entries = vec![
            entry(&kept, true, old, now),
            entry(
                &root.join("asset-recent.png"),
                true,
                Duration::from_secs(5),
                now,
            ),
            entry(&root.join("library"), false, old, now),
            entry(&root.join("asset-orphan.html"), true, old, now),
            // Legacy single-slot files (chat-background.*, project-*.*) are never swept.
            entry(&root.join("chat-background.png"), true, old, now),
            entry(&root.join("project-0123456789abcdef.png"), true, old, now),
            Candidate {
                modified: None,
                ..entry(&root.join("asset-unknown.png"), true, old, now)
            },
        ];
        let keep = HashSet::from([kept]);
        let picked = select_reclaimable(&entries, &keep, now);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].path, root.join("asset-orphan.html"));
    }

    #[test]
    fn keep_entries_outside_the_store_or_nested_are_ignored() {
        let store = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let root = store.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("library")).unwrap();
        std::fs::write(root.join("library").join("a.png"), b"x").unwrap();
        std::fs::write(root.join("kept.png"), b"x").unwrap();
        std::fs::write(other.path().join("elsewhere.png"), b"x").unwrap();
        let keep = canonical_keep(
            &root,
            &[
                root.join("kept.png").to_string_lossy().into_owned(),
                other
                    .path()
                    .join("elsewhere.png")
                    .to_string_lossy()
                    .into_owned(),
                root.join("library")
                    .join("a.png")
                    .to_string_lossy()
                    .into_owned(),
                root.join("missing.png").to_string_lossy().into_owned(),
            ],
        );
        assert_eq!(keep, HashSet::from([root.join("kept.png")]));
    }
}
