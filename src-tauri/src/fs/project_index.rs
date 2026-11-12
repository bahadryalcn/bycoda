use super::{
    git_output_capped, path_has_skipped_dir, path_to_js, ProjectFile, MAX_LS_FILES_BYTES,
    MAX_PROJECT_FILES, MAX_WALK_DIRS,
};
use std::collections::HashSet;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};

/// Git reports nested repositories as directory entries rather than their files.
/// Enumerate each repository separately so its own ignore rules still apply.
pub(super) fn git_ls_files_inner(
    root: &Path,
    cancel: Option<&AtomicBool>,
    incomplete: &AtomicBool,
) -> Option<Vec<ProjectFile>> {
    let canonical_root = root.canonicalize().ok()?;
    let mut pending = vec![root.to_path_buf()];
    let mut repositories = HashSet::from([canonical_root.clone()]);
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    while let Some(repository) = pending.pop() {
        let (raw, truncated) = git_output_capped(
            &repository,
            &["ls-files", "-co", "--exclude-standard", "-z"],
            MAX_LS_FILES_BYTES,
            cancel,
        )?;
        if truncated {
            incomplete.store(true, Ordering::Relaxed);
            return None;
        }
        for rel in raw.split(|b| *b == 0) {
            if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
                return Some(Vec::new());
            }
            if rel.is_empty() {
                continue;
            }
            let decoded = String::from_utf8_lossy(rel);
            let relative_path = Path::new(decoded.as_ref());
            if relative_path
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
            {
                continue;
            }
            let path = repository.join(relative_path);
            let relative = path_to_js(path.strip_prefix(root).ok()?);
            if path_has_skipped_dir(&relative) {
                continue;
            }
            if path.is_dir() {
                if std::fs::symlink_metadata(&path)
                    .map_or(true, |metadata| metadata.file_type().is_symlink())
                {
                    continue;
                }
                let Ok(canonical) = path.canonicalize() else {
                    continue;
                };
                if !canonical.starts_with(&canonical_root) || repositories.contains(&canonical) {
                    continue;
                }
                if repositories.len() >= MAX_WALK_DIRS {
                    incomplete.store(true, Ordering::Relaxed);
                    continue;
                }
                repositories.insert(canonical);
                pending.push(path);
                continue;
            }
            // An uninitialized submodule has no files to enumerate.
            if decoded.ends_with('/') || !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name == ".DS_Store" || !seen.insert(relative.clone()) {
                continue;
            }
            files.push(ProjectFile {
                name: name.to_string(),
                path: path_to_js(&path),
                relative,
            });
            if files.len() >= MAX_PROJECT_FILES {
                incomplete.store(true, Ordering::Relaxed);
                return Some(files);
            }
        }
    }
    Some(files)
}
