#[cfg(test)]
use std::collections::HashMap;
use std::collections::{BTreeMap, BTreeSet, HashMap as LockMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[cfg(test)]
use crate::fs::GitDiffStats;
use crate::fs::{
    expand_home, git_checked, git_cmd, git_cmd_output, git_diff_files_for, git_output, path_to_js,
    resolve_repo_path, GitChangedFile, GitDiffIndex, MAX_TEXT_FILE_BYTES,
};
pub(crate) mod file_revert;
pub(crate) mod turn;

const MAX_SNAPSHOT_FILES: usize = 2000;
/// Above this many paths in one capture, a single directory diff is cheaper
/// than one Git process per file pair.
const MAX_PAIRWISE_STATS: usize = 8;
const MAX_TOPLEVEL_CACHE: usize = 64;

static TOPLEVEL_CACHE: std::sync::OnceLock<Mutex<LockMap<PathBuf, String>>> =
    std::sync::OnceLock::new();

/// `git rev-parse --show-toplevel`, cached per root (successful lookups only).
fn cached_toplevel(root: &Path) -> String {
    let cache = TOPLEVEL_CACHE.get_or_init(|| Mutex::new(LockMap::new()));
    if let Some(hit) = cache.lock().ok().and_then(|c| c.get(root).cloned()) {
        return hit;
    }
    let top = git_output(root, &["rev-parse", "--show-toplevel"])
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    if !top.trim().is_empty() {
        if let Ok(mut cache) = cache.lock() {
            if cache.len() >= MAX_TOPLEVEL_CACHE {
                cache.clear();
            }
            cache.insert(root.to_path_buf(), top.clone());
        }
    }
    top
}

#[derive(Clone)]
pub struct CheckpointStore {
    root: PathBuf,
    leases: PathBuf,
    gates: Arc<Mutex<LockMap<String, Weak<Mutex<()>>>>>,
    barrier: Arc<turn::RecoveryBarrier>,
    active_turn_index: Arc<Mutex<turn::ActiveTurnIndex>>,
}

fn checkpoint_gate(gates: &mut LockMap<String, Weak<Mutex<()>>>, key: String) -> Arc<Mutex<()>> {
    gates.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
        return gate;
    }
    let gate = Arc::new(Mutex::new(()));
    gates.insert(key, Arc::downgrade(&gate));
    gate
}

impl CheckpointStore {
    fn new(root: PathBuf) -> Self {
        #[cfg(test)]
        let leases = root.join(".active-leases");
        #[cfg(not(test))]
        let leases = crate::dirs_home()
            .map(PathBuf::from)
            .unwrap_or_else(|| root.clone())
            .join(".bycoda-host/checkpoint-active");
        Self {
            root,
            leases,
            gates: Arc::new(Mutex::new(LockMap::new())),
            barrier: Arc::new(turn::RecoveryBarrier::default()),
            active_turn_index: Arc::new(Mutex::new(turn::ActiveTurnIndex::default())),
        }
    }

    /// Command entry point: waits for startup recovery of an overlapping turn,
    /// then takes the gates. Waiting while holding a gate would deadlock with recovery.
    fn coordinated<T>(
        &self,
        session_id: &str,
        cwds: &[&str],
        operation: impl FnOnce(&Self) -> Result<T, String>,
    ) -> Result<T, String> {
        self.barrier.wait(session_id, cwds);
        self.exclusive(session_id, cwds, operation)
    }

    fn exclusive<T>(
        &self,
        session_id: &str,
        cwds: &[&str],
        operation: impl FnOnce(&Self) -> Result<T, String>,
    ) -> Result<T, String> {
        // A session manifest and all affected working trees have one owner.
        // Git's absolute top-level unifies subdirectories; canonicalize unifies
        // symlink aliases. Different worktrees may proceed independently.
        let session_gate = {
            let mut gates = self
                .gates
                .lock()
                .map_err(|_| "Checkpoint lock registry poisoned")?;
            checkpoint_gate(&mut gates, format!("session:{session_id}"))
        };
        let _session = session_gate
            .lock()
            .map_err(|_| "Checkpoint session lock poisoned")?;
        let saved = read_manifest(&self.session_dir(session_id))?;
        let mut keys = BTreeSet::new();
        for cwd in cwds
            .iter()
            .copied()
            .chain(saved.as_ref().map(|m| m.cwd.as_str()))
        {
            let root = match project_root(cwd) {
                Ok(root) => root,
                Err(_) if !cwds.contains(&cwd) => continue,
                Err(error) => return Err(error),
            };
            // Unversioned folders need no Git process or global spawn-gate wait.
            let top = if has_git_marker(&root)? {
                cached_toplevel(&root)
            } else {
                String::new()
            };
            let path = if top.trim().is_empty() {
                root
            } else {
                PathBuf::from(top.trim())
            };
            let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
            let key = canonical.to_string_lossy().into_owned();
            keys.insert(if cfg!(windows) {
                key.to_lowercase()
            } else {
                key
            });
        }
        let repo_gates: Vec<_> = {
            let mut gates = self
                .gates
                .lock()
                .map_err(|_| "Checkpoint lock registry poisoned")?;
            keys.into_iter()
                .map(|key| checkpoint_gate(&mut gates, format!("repo:{key}")))
                .collect()
        };
        let mut guards = Vec::new();
        for gate in &repo_gates {
            guards.push(
                gate.lock()
                    .map_err(|_| "Checkpoint repository lock poisoned")?,
            );
        }
        operation(self)
    }

    fn session_dir(&self, session_id: &str) -> PathBuf {
        self.root.join(session_id)
    }

    #[cfg(test)]
    fn ensure(&self, session_id: &str, cwd: &str) -> Result<(), String> {
        self.ensure_timed(session_id, cwd).map(|_| ())
    }

    fn ensure_timed(&self, session_id: &str, cwd: &str) -> Result<CheckpointTimings, String> {
        let mut timings = CheckpointTimings::default();
        let disk_started = std::time::Instant::now();
        let root = project_root(cwd)?;
        let dir = self.session_dir(session_id);
        if let Some(manifest) = read_manifest(&dir)? {
            if same_cwd(&manifest.cwd, cwd) {
                return Ok(timings);
            }
            let _ = std::fs::remove_dir_all(&dir);
        }
        std::fs::create_dir_all(dir.join("files")).map_err(|e| e.to_string())?;

        let mut files = BTreeMap::new();
        let mut tracked = BTreeSet::new();
        let mut relatives = Vec::new();
        let mut seen = HashSet::new();
        timings.disk_ms += disk_started.elapsed().as_secs_f64() * 1000.0;
        let git_started = std::time::Instant::now();
        for file in git_diff_files_for(&root).files {
            if seen.len() >= MAX_SNAPSHOT_FILES {
                break;
            }
            let Ok(relative) = resolve_repo_path(&root, &file.relative) else {
                continue;
            };
            if seen.insert(relative.clone()) {
                relatives.push(relative);
            }
        }
        let in_head = paths_in_head(&root, &relatives);
        timings.git_ms = git_started.elapsed().as_secs_f64() * 1000.0;
        let snapshot_started = std::time::Instant::now();
        for relative in relatives {
            if in_head.contains(&relative) {
                tracked.insert(relative.clone());
            }
            files.insert(relative.clone(), snapshot_file(&dir, &root, &relative)?);
        }
        write_manifest(
            &dir,
            &Manifest {
                cwd: root.to_string_lossy().into_owned(),
                files,
                touched: BTreeSet::new(),
                tracked,
                prepared: BTreeSet::new(),
                after: BTreeMap::new(),
                stats: BTreeMap::new(),
                diverged: BTreeSet::new(),
                undo_blocked: BTreeSet::new(),
            },
        )?;
        timings.disk_ms += snapshot_started.elapsed().as_secs_f64() * 1000.0;
        Ok(timings)
    }

    fn prepare(&self, session_id: &str, cwd: &str, paths: &[String]) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }
        self.retire_resolved_paths(session_id, cwd)?;
        let root = project_root(cwd)?;
        let dir = self.session_dir(session_id);
        file_revert::prepare(&dir, &root, paths)?;
        let mut manifest = match read_manifest(&dir)? {
            Some(manifest) if same_cwd(&manifest.cwd, cwd) => manifest,
            _ => return Ok(()),
        };

        let mut dirty = false;
        let valid: Vec<String> = paths
            .iter()
            .filter_map(|path| relative_to_root(&root, path).ok())
            .collect();
        // Looked up once, and only if some path gets past the early exits.
        let mut in_head: Option<HashSet<String>> = None;
        for path in paths {
            let Ok(relative) = relative_to_root(&root, path) else {
                continue;
            };
            // Keep the original pre-edit snapshot across later edits by this
            // session. The first tool-start event owns the safe undo boundary.
            if manifest.touched.contains(&relative) && manifest.prepared.contains(&relative) {
                if !after_matches_worktree(&dir, &root, &manifest, &relative)
                    && manifest.diverged.insert(relative)
                {
                    dirty = true;
                }
                continue;
            }
            if manifest.prepared.contains(&relative) {
                continue;
            }
            if manifest.touched.contains(&relative) {
                // Upgrade a legacy or completion-only claim by dropping its
                // untrusted state and starting at this real tool boundary.
                release_path(&mut manifest, &relative);
                dirty = true;
            }
            let before = snapshot_file(&dir, &root, &relative)?;
            if manifest.files.insert(relative.clone(), before) != Some(before) {
                dirty = true;
            }
            if manifest.prepared.insert(relative.clone()) {
                dirty = true;
            }
            let head = in_head.get_or_insert_with(|| paths_in_head(&root, &valid));
            if head.contains(&relative) && manifest.tracked.insert(relative) {
                dirty = true;
            }
        }
        if dirty {
            write_manifest(&dir, &manifest)?;
        }
        Ok(())
    }

    fn capture(&self, session_id: &str, cwd: &str, paths: &[String]) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }
        let root = project_root(cwd)?;
        let dir = self.session_dir(session_id);
        file_revert::capture(&dir, &root, paths)?;
        let mut manifest = match read_manifest(&dir)? {
            Some(manifest) if same_cwd(&manifest.cwd, cwd) => manifest,
            _ => return Ok(()),
        };

        let mut dirty = false;
        let valid: Vec<String> = paths
            .iter()
            .filter_map(|path| relative_to_root(&root, path).ok())
            .collect();
        // Paths already recorded as tracked were found in HEAD earlier.
        let unknown: Vec<String> = valid
            .iter()
            .filter(|relative| !manifest.tracked.contains(*relative))
            .cloned()
            .collect();
        let mut in_head = if unknown.is_empty() {
            HashSet::new()
        } else {
            paths_in_head(&root, &unknown)
        };
        in_head.extend(
            valid
                .iter()
                .filter(|relative| manifest.tracked.contains(*relative))
                .cloned(),
        );
        for path in paths {
            if manifest.touched.len() >= MAX_SNAPSHOT_FILES {
                break;
            }
            let Ok(relative) = relative_to_root(&root, path) else {
                continue;
            };
            manifest.touched.insert(relative.clone());
            let tracked_in_head = in_head.contains(&relative);
            if tracked_in_head {
                manifest.tracked.insert(relative.clone());
            }
            if !manifest.files.contains_key(&relative)
                && !root.join(&relative).exists()
                && !tracked_in_head
            {
                // A completion without a matching prepare event is retained
                // for review but is deliberately not undoable.
                manifest
                    .files
                    .insert(relative.clone(), snapshot_file(&dir, &root, &relative)?);
            }
            let after = snapshot_after_file(&dir, &root, &relative)?;
            manifest.after.insert(relative.clone(), after);
            dirty = true;
        }
        if dirty {
            // Compare the captured directories once, rather than start one Git
            // process per edited file. Missing snapshots are empty blobs.
            let stats = batch_session_stats(&dir, &manifest, &valid);
            for relative in &valid {
                manifest.stats.remove(relative);
                if let Some(stats) = stats.as_ref().and_then(|stats| stats.get(relative)) {
                    manifest.stats.insert(relative.clone(), stats.clone());
                }
            }
            write_manifest(&dir, &manifest)?;
            turn::record_structured_capture(&dir, &valid)?;
        }
        Ok(())
    }

    fn status(&self, session_id: &str, cwd: &str) -> Result<CheckpointStatus, String> {
        self.turn_review_ready(session_id, cwd)?;
        self.retire_resolved_paths(session_id, cwd)?;
        let Some(manifest) = self.load_matching(session_id, cwd)? else {
            return Ok(CheckpointStatus { files: Vec::new() });
        };
        let root = project_root(cwd)?;
        let mut foreign_touched = self.foreign_touched_paths(cwd, session_id);
        if !self.turn_undo_safe(session_id, cwd)? {
            foreign_touched.extend(manifest.touched.iter().cloned());
        }
        Ok(diff_from_manifest(
            &self.session_dir(session_id),
            &root,
            &manifest,
            &foreign_touched,
        ))
    }

    fn apply(
        &self,
        session_id: &str,
        from_cwd: &str,
        to_cwd: &str,
    ) -> Result<CheckpointApplyResult, String> {
        let manifest = self
            .load_matching(session_id, from_cwd)?
            .ok_or("This worker has no recoverable change checkpoint")?;
        let from_root = project_root(from_cwd)?;
        let to_root = project_root(to_cwd)?;
        if same_cwd(from_cwd, to_cwd) {
            return Err("An isolated worker cannot be integrated into itself".into());
        }
        if git_head(&from_root)? != git_head(&to_root)? {
            return Err(
                "The worker or lead branch moved while this task was running. The worker worktree was kept for manual review."
                    .into(),
            );
        }
        let dir = self.session_dir(session_id);
        let changed = verified_worker_delta(&dir, &from_root, &manifest)?;

        // Preflight every path before writing any of them. A retry may see a
        // mixture of before/after states if the app stopped during a previous
        // application; both are safe and make this operation idempotent.
        let mut already_applied = 0;
        for relative in &changed {
            if path_contains_symlink(&to_root, relative) {
                return Err(format!(
                    "Cannot integrate {relative}: the target path contains a symbolic link. The worker worktree was kept."
                ));
            }
            let before = manifest
                .files
                .get(relative)
                .copied()
                .ok_or_else(|| format!("Missing original snapshot for {relative}"))?;
            let after = manifest
                .after
                .get(relative)
                .copied()
                .ok_or_else(|| format!("Missing worker snapshot for {relative}"))?;
            let target = worktree_snapshot(&to_root, relative);
            let before_state = stored_snapshot(&dir, relative, before, false);
            let after_state = stored_snapshot(&dir, relative, after, true);
            if target == after_state {
                already_applied += 1;
            } else if target != before_state {
                return Err(format!(
                    "Cannot integrate {relative}: the lead checkout changed since this worker started. The worker worktree was kept."
                ));
            }
        }

        for relative in &changed {
            let after = manifest.after.get(relative).copied().unwrap();
            let target = worktree_snapshot(&to_root, relative);
            let after_state = stored_snapshot(&dir, relative, after, true);
            if target != after_state {
                write_state(&to_root, relative, after_state.0, after_state.1)?;
            }
        }
        Ok(CheckpointApplyResult {
            files: changed,
            already_applied,
        })
    }

    fn cleanup_safe(&self, session_id: &str, cwd: &str) -> Result<bool, String> {
        let Some(manifest) = self.load_matching(session_id, cwd)? else {
            return Ok(false);
        };
        let root = project_root(cwd)?;
        Ok(
            verified_worker_delta(&self.session_dir(session_id), &root, &manifest)
                .map(|changed| changed.is_empty())
                .unwrap_or(false),
        )
    }

    fn forget(&self, session_id: &str) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        if dir.exists() {
            std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn file_diff(
        &self,
        session_id: &str,
        cwd: &str,
        relative: &str,
    ) -> Result<CheckpointFileDiff, String> {
        self.turn_review_ready(session_id, cwd)?;
        self.retire_resolved_paths(session_id, cwd)?;
        let Some(manifest) = self.load_matching(session_id, cwd)? else {
            return Err("Session changes are no longer available".into());
        };
        let root = project_root(cwd)?;
        let relative = resolve_repo_path(&root, relative)?;
        if !manifest.touched.contains(&relative) || !manifest.prepared.contains(&relative) {
            return Err("This file was not changed by the session".into());
        }
        if manifest.diverged.contains(&relative) {
            return Err(
                "Exact lines are unavailable because the file changed between this session's edits"
                    .into(),
            );
        }

        let dir = self.session_dir(session_id);
        let before = manifest
            .files
            .get(&relative)
            .copied()
            .ok_or_else(|| "Session baseline is unavailable".to_string())?;
        let after = manifest
            .after
            .get(&relative)
            .copied()
            .ok_or_else(|| "Session result is unavailable".to_string())?;
        let original = read_snapshot(&dir, &relative, before);
        let current = read_after_snapshot(&dir, &relative, after);
        let too_large =
            matches!(original, FileState::Skipped) || matches!(current, FileState::Skipped);
        let binary = state_is_binary(&original) || state_is_binary(&current);
        let (original, current) = if binary || too_large {
            (String::new(), String::new())
        } else {
            (state_text(original), state_text(current))
        };
        let status = manifest
            .stats
            .get(&relative)
            .map(|stats| stats.status.clone())
            .unwrap_or_else(|| "modified".into());
        Ok(CheckpointFileDiff {
            path: path_to_js(&root.join(&relative)),
            relative,
            status,
            original,
            current,
            binary,
            too_large,
        })
    }

    /// Remaining git line counts for each session, using one working-tree index.
    #[cfg(test)]
    fn stats_for_sessions(
        &self,
        cwd: &str,
        session_ids: &[String],
    ) -> Result<HashMap<String, GitDiffStats>, String> {
        let mut out = HashMap::new();
        if session_ids.is_empty() {
            return Ok(out);
        }
        let root = project_root(cwd)?;
        let index = git_diff_files_for(&root);
        for session_id in session_ids {
            let Some(manifest) = self.load_matching(session_id, cwd)? else {
                out.insert(session_id.clone(), GitDiffStats::default());
                continue;
            };
            let foreign_touched = self.foreign_touched_paths(cwd, session_id);
            let status = diff_from_manifest_with(
                &index,
                &self.session_dir(session_id),
                &root,
                &manifest,
                &foreign_touched,
            );
            out.insert(session_id.clone(), stats_from_status(&status));
        }
        Ok(out)
    }

    fn undo(
        &self,
        session_id: &str,
        cwd: &str,
        relative: Option<&str>,
    ) -> Result<CheckpointStatus, String> {
        let Some(mut manifest) = self.load_matching(session_id, cwd)? else {
            return Ok(CheckpointStatus { files: Vec::new() });
        };
        self.turn_review_ready(session_id, cwd)?;
        if !self.turn_undo_safe(session_id, cwd)? {
            return Err("Cannot safely undo: HEAD changed or a turn overlaps this checkout".into());
        }
        let root = project_root(cwd)?;
        let dir = self.session_dir(session_id);
        let foreign_touched = self.foreign_touched_paths(cwd, session_id);
        let changed = diff_from_manifest(&dir, &root, &manifest, &foreign_touched);
        if let Some(relative) = relative {
            let relative = resolve_repo_path(&root, relative)?;
            let Some(file) = changed.files.iter().find(|file| file.relative == relative) else {
                return self.status(session_id, cwd);
            };
            if !file.undoable {
                return Err(format!(
                    "Cannot safely undo {relative}: it changed outside this session"
                ));
            }
            restore_one(&dir, &root, &manifest, &relative)?;
            release_path(&mut manifest, &relative);
            write_manifest(&dir, &manifest)?;
            return self.status(session_id, cwd);
        }
        if changed.files.iter().any(|file| !file.undoable) {
            return Err(
                "Cannot safely undo all: one or more files changed outside this session".into(),
            );
        }
        for file in &changed.files {
            restore_one(&dir, &root, &manifest, &file.relative)?;
        }
        let _ = std::fs::remove_dir_all(&dir);
        Ok(CheckpointStatus { files: Vec::new() })
    }

    fn keep(
        &self,
        session_id: &str,
        cwd: &str,
        relative: Option<&str>,
    ) -> Result<CheckpointStatus, String> {
        self.turn_review_ready(session_id, cwd)?;
        let Some(mut manifest) = self.load_matching(session_id, cwd)? else {
            return Ok(CheckpointStatus { files: Vec::new() });
        };
        let root = project_root(cwd)?;
        let dir = self.session_dir(session_id);
        let Some(relative) = relative else {
            let _ = std::fs::remove_dir_all(&dir);
            return Ok(CheckpointStatus { files: Vec::new() });
        };
        let relative = resolve_repo_path(&root, relative)?;
        release_path(&mut manifest, &relative);
        write_manifest(&dir, &manifest)?;
        self.status(session_id, cwd)
    }

    fn load_matching(&self, session_id: &str, cwd: &str) -> Result<Option<Manifest>, String> {
        let dir = self.session_dir(session_id);
        let Some(manifest) = read_manifest(&dir)? else {
            return Ok(None);
        };
        if !same_cwd(&manifest.cwd, cwd) {
            return Ok(None);
        }
        Ok(Some(manifest))
    }

    /// Paths already claimed by another live session in the same project.
    fn foreign_touched_paths(&self, cwd: &str, except_session_id: &str) -> HashSet<String> {
        let mut paths = HashSet::new();
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(_) => return paths,
        };
        for entry in entries.flatten() {
            let session_id = entry.file_name().to_string_lossy().into_owned();
            if session_id == except_session_id
                || validate_id(&session_id, "session").is_err()
                || !entry.file_type().is_ok_and(|kind| kind.is_dir())
            {
                continue;
            }
            let dir = entry.path();
            let Ok(Some(manifest)) = read_manifest(&dir) else {
                continue;
            };
            if !same_cwd(&manifest.cwd, cwd) {
                continue;
            }
            paths.extend(manifest.touched.intersection(&manifest.prepared).cloned());
        }
        paths
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    cwd: String,
    files: BTreeMap<String, SnapshotKind>,
    #[serde(default)]
    touched: BTreeSet<String>,
    #[serde(default)]
    tracked: BTreeSet<String>,
    /// Paths captured before a structured edit started. Only these are safe
    /// candidates for Undo.
    #[serde(default)]
    prepared: BTreeSet<String>,
    /// Worktree contents immediately after the session's latest edit.
    #[serde(default)]
    after: BTreeMap<String, SnapshotKind>,
    /// Stable line counts for the session-owned before/after pair.
    #[serde(default)]
    stats: BTreeMap<String, ChangeStats>,
    /// Paths whose contents changed between two edits by this session.
    #[serde(default)]
    diverged: BTreeSet<String>,
    #[serde(default)]
    undo_blocked: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ChangeStats {
    status: String,
    additions: i64,
    deletions: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SnapshotKind {
    Contents,
    Missing,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum FileState {
    Contents(Vec<u8>),
    Missing,
    Skipped,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFile {
    pub path: String,
    pub relative: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    /// False when the file changed between this session's own edit snapshots,
    /// so its net line ownership cannot be reconstructed exactly.
    pub exact: bool,
    pub undoable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointStatus {
    pub files: Vec<CheckpointFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileDiff {
    pub path: String,
    pub relative: String,
    pub status: String,
    pub original: String,
    pub current: String,
    pub binary: bool,
    pub too_large: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointApplyResult {
    pub files: Vec<String>,
    pub already_applied: usize,
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("checkpoints");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let store = CheckpointStore::new(dir);
    // Only a read-only scan runs before commands are accepted. Settling
    // interrupted turns runs git, so it stays off the UI thread.
    let recovery = store.plan_recovery();
    app.manage(store.clone());
    spawn_recovery(recovery);
    start_orphan_pruning(app, store);
    Ok(())
}

fn spawn_recovery(recovery: turn::RecoveryPlan) {
    // If the spawn fails, the plan is dropped and its tickets release waiters.
    let spawned = std::thread::Builder::new()
        .name("checkpoint-recover".into())
        .spawn(move || recovery.run());
    if let Err(error) = spawned {
        eprintln!("checkpoint recovery thread: {error}");
    }
}

/// Orphans are only garbage, so this waits for startup to settle and walks the
/// directory on its own thread. It never prunes without a successful read of
/// the session list: a failed or empty read is not "no sessions".
fn start_orphan_pruning(app: &AppHandle, store: CheckpointStore) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("checkpoint-prune".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let Some(sessions) = app.try_state::<crate::session_store::SessionStore>() else {
                return;
            };
            match sessions.session_ids() {
                Ok(known) if !known.is_empty() => {
                    let removed =
                        store.prune_orphans(&known, std::time::Duration::from_secs(48 * 60 * 60));
                    if removed > 0 {
                        eprintln!("Removed {removed} checkpoint folders of deleted sessions");
                    }
                }
                Ok(_) => {}
                Err(error) => eprintln!("Checkpoint pruning skipped: {error}"),
            }
        });
    if let Err(error) = spawned {
        eprintln!("checkpoint prune thread: {error}");
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointTimings {
    checkpoint_wait_ms: f64,
    git_ms: f64,
    disk_ms: f64,
}

#[tauri::command]
pub async fn session_checkpoint_ensure(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
) -> Result<CheckpointTimings, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        store.coordinated(&session_id, &[&cwd], |store| {
            let waited = started.elapsed().as_secs_f64() * 1000.0;
            let mut timings = store.ensure_timed(&session_id, &cwd)?;
            timings.checkpoint_wait_ms = waited;
            Ok(timings)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_prepare(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    if paths.len() > MAX_SNAPSHOT_FILES {
        return Err("Too many paths".into());
    }
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            store.prepare(&session_id, &cwd, &paths)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_capture(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    if paths.len() > MAX_SNAPSHOT_FILES {
        return Err("Too many paths".into());
    }
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            store.capture(&session_id, &cwd, &paths)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_status(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
) -> Result<CheckpointStatus, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            store.status(&session_id, &cwd)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read the desktop's checkpoint store for a host-authorized Conversation Tool.
/// Never consult the host store: desktop turns capture their snapshots here.
pub(crate) fn conversation_checkpoint_read(
    app: &AppHandle,
    action: &str,
    session_id: &str,
    cwd: &str,
    relative: Option<&str>,
) -> Result<serde_json::Value, String> {
    validate_id(session_id, "session")?;
    let store = app.state::<CheckpointStore>();
    store.coordinated(session_id, &[cwd], |store| match action {
        "checkpoints.status" => {
            serde_json::to_value(store.status(session_id, cwd)?).map_err(|error| error.to_string())
        }
        "checkpoints.diff" => serde_json::to_value(store.file_diff(
            session_id,
            cwd,
            relative.ok_or("Checkpoint relative path required")?,
        )?)
        .map_err(|error| error.to_string()),
        _ => Err("Unsupported checkpoint read".into()),
    })
}

#[tauri::command]
pub async fn session_checkpoint_apply(
    store: State<'_, CheckpointStore>,
    session_id: String,
    from_cwd: String,
    to_cwd: String,
) -> Result<CheckpointApplyResult, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&from_cwd, &to_cwd], |store| {
            crate::fs::with_git_mutation(&crate::fs::expand_home(&to_cwd), || {
                store.apply(&session_id, &from_cwd, &to_cwd)
            })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_cleanup_safe(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
) -> Result<bool, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            store.cleanup_safe(&session_id, &cwd)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_forget(
    store: State<'_, CheckpointStore>,
    session_id: String,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[], |store| store.forget(&session_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_file_diff(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    relative: String,
) -> Result<CheckpointFileDiff, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            store.file_diff(&session_id, &cwd, &relative)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_undo(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    relative: Option<String>,
) -> Result<CheckpointStatus, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            crate::fs::with_git_mutation(&crate::fs::expand_home(&cwd), || {
                store.undo(&session_id, &cwd, relative.as_deref())
            })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_checkpoint_keep(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    relative: Option<String>,
) -> Result<CheckpointStatus, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |store| {
            store.keep(&session_id, &cwd, relative.as_deref())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reconstruct the worker-owned delta and reject anything that was not
/// captured at a structured tool boundary. This is stricter than the review
/// UI because cleanup must never discard an ambiguous edit.
fn verified_worker_delta(
    dir: &Path,
    root: &Path,
    manifest: &Manifest,
) -> Result<Vec<String>, String> {
    if !manifest.diverged.is_empty() {
        return Err(format!(
            "Cannot safely integrate files that changed outside the worker: {}",
            manifest
                .diverged
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let current_dirty: BTreeSet<String> = git_diff_files_for(root)
        .files
        .into_iter()
        .map(|file| file.relative)
        .collect();
    if let Some(relative) = current_dirty
        .iter()
        .find(|relative| !manifest.files.contains_key(*relative))
    {
        return Err(format!(
            "Cannot safely integrate {relative}: its change was not captured for this worker. The worker worktree was kept."
        ));
    }

    let mut changed = Vec::new();
    for (relative, before) in &manifest.files {
        if path_contains_symlink(root, relative) {
            return Err(format!(
                "Cannot safely integrate {relative}: the worker path contains a symbolic link. The worker worktree was kept."
            ));
        }
        if *before == SnapshotKind::Skipped {
            return Err(format!(
                "Cannot safely integrate {relative}: this file type or size cannot be checkpointed. The worker worktree was kept."
            ));
        }
        let before_state = stored_snapshot(dir, relative, *before, false);
        if manifest.touched.contains(relative) {
            if !manifest.prepared.contains(relative) {
                return Err(format!(
                    "Cannot safely integrate {relative}: its pre-edit state was not captured. The worker worktree was kept."
                ));
            }
            let after = manifest
                .after
                .get(relative)
                .copied()
                .ok_or_else(|| format!("Missing worker snapshot for {relative}"))?;
            if after == SnapshotKind::Skipped {
                return Err(format!(
                    "Cannot safely integrate {relative}: this file type or size cannot be checkpointed. The worker worktree was kept."
                ));
            }
            let after_state = stored_snapshot(dir, relative, after, true);
            if worktree_snapshot(root, relative) != after_state {
                return Err(format!(
                    "Cannot safely integrate {relative}: it changed after the worker checkpoint. The worker worktree was kept."
                ));
            }
            if before_state != after_state {
                changed.push(relative.clone());
            }
        } else if worktree_snapshot(root, relative) != before_state {
            return Err(format!(
                "Cannot safely integrate {relative}: its change was not attributed to this worker. The worker worktree was kept."
            ));
        }
    }
    changed.sort();
    Ok(changed)
}

fn write_state(
    root: &Path,
    relative: &str,
    state: FileState,
    mode: Option<u32>,
) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    if path_contains_symlink(root, &relative) {
        return Err(format!("Cannot write through symbolic link {relative}"));
    }
    match state {
        FileState::Contents(bytes) => {
            let path = root.join(relative);
            write_worktree(&path, &bytes)?;
            set_file_mode(&path, mode)
        }
        FileState::Missing => remove_worktree(root, &relative),
        FileState::Skipped => Err(format!("Cannot write unsupported file {relative}")),
    }
}

fn stored_snapshot(
    dir: &Path,
    relative: &str,
    kind: SnapshotKind,
    after: bool,
) -> (FileState, Option<u32>) {
    let blob_root = if after {
        dir.join("after")
    } else {
        dir.join("files")
    };
    (
        read_snapshot_at(&blob_root, relative, kind),
        snapshot_mode(&blob_root, relative, kind),
    )
}

fn worktree_snapshot(root: &Path, relative: &str) -> (FileState, Option<u32>) {
    (
        read_worktree(root, relative),
        file_mode(&root.join(relative)),
    )
}

fn path_contains_symlink(root: &Path, relative: &str) -> bool {
    let mut current = root.to_path_buf();
    for part in relative.split('/') {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return true,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
            Err(_) => return true,
        }
    }
    false
}

fn git_head(root: &Path) -> Result<Vec<u8>, String> {
    let output = git_cmd_output(
        git_cmd()
            .arg("-C")
            .arg(root)
            .args(["rev-parse", "--verify", "HEAD"])
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0"),
    )
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output.stdout)
}

fn diff_from_manifest(
    dir: &Path,
    root: &Path,
    manifest: &Manifest,
    foreign_touched: &HashSet<String>,
) -> CheckpointStatus {
    diff_from_manifest_with(
        &git_diff_files_for(root),
        dir,
        root,
        manifest,
        foreign_touched,
    )
}

fn diff_from_manifest_with(
    index: &GitDiffIndex,
    dir: &Path,
    root: &Path,
    manifest: &Manifest,
    foreign_touched: &HashSet<String>,
) -> CheckpointStatus {
    let by_relative: BTreeMap<&str, &GitChangedFile> = index
        .files
        .iter()
        .map(|file| (file.relative.as_str(), file))
        .collect();
    let git_dirty: HashSet<&str> = by_relative.keys().copied().collect();
    let mut files = Vec::new();

    for relative in &manifest.touched {
        // Without a tool-start snapshot there is no trustworthy session
        // boundary. Never guess from the shared working tree.
        if !manifest.prepared.contains(relative) {
            continue;
        }
        if session_snapshot_differs(dir, manifest, relative) == Some(false) {
            continue;
        }
        if !file_differs(dir, root, manifest, relative, &git_dirty) {
            continue;
        }
        // Review is always scoped to this session's captured before/after
        // snapshots. A foreign claim can make restoring the file unsafe, but
        // it does not make this session's recorded diff or counts inexact.
        let exact = !manifest.diverged.contains(relative);
        let undoable = exact
            && !manifest.undo_blocked.contains(relative)
            && !foreign_touched.contains(relative)
            && !path_contains_symlink(root, relative)
            && resolve_repo_path(root, relative).is_ok()
            && after_matches_worktree(dir, root, manifest, relative);
        let session_change = manifest.stats.get(relative).map(|stats| {
            let additions = if exact { stats.additions } else { 0 };
            let deletions = if exact { stats.deletions } else { 0 };
            (stats.status.clone(), additions, deletions)
        });
        files.push(describe_change(
            root,
            relative,
            by_relative.get(relative.as_str()).copied(),
            exact,
            undoable,
            session_change,
        ));
    }

    files.sort_by(|a, b| a.relative.cmp(&b.relative));
    CheckpointStatus { files }
}

fn session_snapshot_differs(dir: &Path, manifest: &Manifest, relative: &str) -> Option<bool> {
    let before = manifest.files.get(relative).copied()?;
    let after = manifest.after.get(relative).copied()?;
    Some(read_snapshot(dir, relative, before) != read_after_snapshot(dir, relative, after))
}

#[cfg(test)]
fn stats_from_status(status: &CheckpointStatus) -> GitDiffStats {
    let mut additions = 0i64;
    let mut deletions = 0i64;
    for file in &status.files {
        additions += file.additions;
        deletions += file.deletions;
    }
    GitDiffStats {
        files: status.files.len() as i64,
        additions,
        deletions,
    }
}

fn file_differs(
    dir: &Path,
    root: &Path,
    manifest: &Manifest,
    relative: &str,
    git_dirty: &HashSet<&str>,
) -> bool {
    // Once a tracked path is clean against HEAD, its session change was
    // committed (or otherwise resolved) and no longer needs review.
    if !git_dirty.contains(relative)
        && (manifest.tracked.contains(relative) || in_head(root, relative))
    {
        return false;
    }
    match manifest.files.get(relative) {
        Some(SnapshotKind::Skipped) => false,
        Some(kind) => read_worktree(root, relative) != read_snapshot(dir, relative, *kind),
        None => {
            git_dirty.contains(relative)
                || (root.join(relative).is_file() && !in_head(root, relative))
        }
    }
}

fn describe_change(
    root: &Path,
    relative: &str,
    git: Option<&GitChangedFile>,
    exact: bool,
    undoable: bool,
    session_change: Option<(String, i64, i64)>,
) -> CheckpointFile {
    if let Some((status, additions, deletions)) = session_change {
        return CheckpointFile {
            path: path_to_js(&root.join(relative)),
            relative: relative.to_string(),
            status,
            additions,
            deletions,
            exact,
            undoable,
        };
    }
    if let Some(file) = git {
        return CheckpointFile {
            path: file.path.clone(),
            relative: file.relative.clone(),
            status: file.status.clone(),
            additions: file.additions,
            deletions: file.deletions,
            exact,
            undoable,
        };
    }
    let abs = root.join(relative);
    let status = if !abs.exists() { "deleted" } else { "modified" };
    CheckpointFile {
        path: path_to_js(&abs),
        relative: relative.to_string(),
        status: status.into(),
        additions: 0,
        deletions: 0,
        exact,
        undoable,
    }
}

fn batch_session_stats(
    dir: &Path,
    manifest: &Manifest,
    relatives: &[String],
) -> Option<BTreeMap<String, ChangeStats>> {
    let numstat = |before: PathBuf, after: PathBuf| {
        let output = git_cmd_output(
            git_cmd()
                .args([
                    "diff",
                    "--no-index",
                    "--no-ext-diff",
                    "--no-renames",
                    "--numstat",
                    "-z",
                    "--",
                ])
                .arg(before)
                .arg(after),
        )
        .ok()?;
        if !output.status.success() && output.status.code() != Some(1) {
            return None;
        }
        Some(output.stdout)
    };
    let counts = if relatives.len() <= MAX_PAIRWISE_STATS {
        // Diff only this call's file pairs; a session-wide directory diff
        // makes every capture cost O(files captured so far).
        let mut counts = BTreeMap::new();
        for relative in relatives {
            let (Some(before), Some(after)) =
                (manifest.files.get(relative), manifest.after.get(relative))
            else {
                continue;
            };
            if *before == SnapshotKind::Skipped || *after == SnapshotKind::Skipped {
                continue;
            }
            let stdout = numstat(
                state_blob_path(&dir.join("files"), relative).ok()?,
                state_blob_path(&dir.join("after"), relative).ok()?,
            )?;
            counts.extend(parse_batch_numstat(
                &stdout,
                std::slice::from_ref(relative),
            )?);
        }
        counts
    } else {
        let stdout = numstat(dir.join("files"), dir.join("after"))?;
        parse_batch_numstat(&stdout, relatives)?
    };
    let mut result = BTreeMap::new();
    for relative in relatives {
        let Some(before) = manifest.files.get(relative) else {
            continue;
        };
        let Some(after) = manifest.after.get(relative) else {
            continue;
        };
        if *before == SnapshotKind::Skipped || *after == SnapshotKind::Skipped {
            continue;
        }
        let Some((additions, deletions)) = counts.get(relative).copied().unwrap_or(Some((0, 0)))
        else {
            continue;
        };
        result.insert(
            relative.clone(),
            ChangeStats {
                status: match (before, after) {
                    (SnapshotKind::Missing, SnapshotKind::Missing) => "modified",
                    (SnapshotKind::Missing, _) => "added",
                    (_, SnapshotKind::Missing) => "deleted",
                    _ => "modified",
                }
                .into(),
                additions,
                deletions,
            },
        );
    }
    Some(result)
}

fn parse_batch_numstat(
    bytes: &[u8],
    relatives: &[String],
) -> Option<BTreeMap<String, Option<(i64, i64)>>> {
    let mut fields = bytes.split(|byte| *byte == 0).peekable();
    let mut result = BTreeMap::new();
    while let Some(record) = fields.next() {
        if record.is_empty() {
            continue;
        }
        let mut row = record.splitn(3, |byte| *byte == b'\t');
        let additions = std::str::from_utf8(row.next()?).ok()?.parse::<i64>().ok();
        let deletions = std::str::from_utf8(row.next()?).ok()?.parse::<i64>().ok();
        let mut path = row.next()?;
        // With -z, different source/destination names use two following paths.
        if path.is_empty() {
            fields.next()?;
            path = fields.next()?;
        }
        let path = String::from_utf8_lossy(path).replace('\\', "/");
        let relative = relatives
            .iter()
            .filter(|relative| path == **relative || path.ends_with(&format!("/{relative}")))
            .max_by_key(|relative| relative.len());
        if let Some(relative) = relative {
            result.insert(relative.clone(), additions.zip(deletions));
        }
        // Other files may have only a before snapshot and are not this capture.
    }
    Some(result)
}

fn after_matches_worktree(dir: &Path, root: &Path, manifest: &Manifest, relative: &str) -> bool {
    let Some(kind) = manifest.after.get(relative).copied() else {
        return false;
    };
    if kind == SnapshotKind::Skipped {
        return false;
    }
    let current = read_worktree(root, relative);
    let recorded = read_after_snapshot(dir, relative, kind);
    current != FileState::Skipped && recorded != FileState::Skipped && current == recorded
}

fn release_path(manifest: &mut Manifest, relative: &str) {
    manifest.files.remove(relative);
    manifest.touched.remove(relative);
    manifest.tracked.remove(relative);
    manifest.prepared.remove(relative);
    manifest.after.remove(relative);
    manifest.stats.remove(relative);
    manifest.diverged.remove(relative);
    manifest.undo_blocked.remove(relative);
}

fn restore_one(dir: &Path, root: &Path, manifest: &Manifest, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    if !after_matches_worktree(dir, root, manifest, &relative) {
        return Err(format!(
            "Cannot safely undo {relative}: it changed while preparing undo"
        ));
    }
    if turn::has_recorded_turn(dir)? {
        let kind = manifest
            .files
            .get(&relative)
            .copied()
            .ok_or("Missing turn file baseline")?;
        let (state, mode) = stored_snapshot(dir, &relative, kind, false);
        // Workspace undo restores working-copy contents while preserving the
        // real staging area, including the owner's partial staging.
        return write_state(root, &relative, state, mode);
    }
    match manifest.files.get(&relative) {
        Some(SnapshotKind::Skipped) => Ok(()),
        Some(kind) => restore_snapshot(dir, root, &relative, *kind),
        None => revert_new_change(root, &relative),
    }
}

// Non-Git projects support undo too. A malformed/unreadable Git marker still
// requires Git to succeed; only a genuinely unversioned path skips index work.
fn has_git_marker(root: &Path) -> Result<bool, String> {
    for path in root.ancestors() {
        match std::fs::symlink_metadata(path.join(".git")) {
            Ok(_) => return Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(false)
}

fn reset_checkpoint_index(root: &Path, relative: &str) -> Result<(), String> {
    if has_git_marker(root)? {
        // Omitting explicit HEAD also supports repositories before their first commit.
        git_checked(root, &["reset", "-q", "--", relative])?;
    }
    Ok(())
}

fn restore_snapshot(
    dir: &Path,
    root: &Path,
    relative: &str,
    kind: SnapshotKind,
) -> Result<(), String> {
    match kind {
        SnapshotKind::Skipped => Ok(()),
        SnapshotKind::Missing => {
            reset_checkpoint_index(root, relative)?;
            remove_worktree(root, relative)
        }
        SnapshotKind::Contents => {
            let bytes = match read_snapshot(dir, relative, kind) {
                FileState::Contents(bytes) => bytes,
                _ => return Ok(()),
            };
            write_worktree(&root.join(relative), &bytes)?;
            reset_checkpoint_index(root, relative)?;
            Ok(())
        }
    }
}

fn revert_new_change(root: &Path, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    if in_head(root, &relative) {
        return git_checked(
            root,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                &relative,
            ],
        );
    }
    reset_checkpoint_index(root, &relative)?;
    remove_worktree(root, &relative)
}

fn in_head(root: &Path, relative: &str) -> bool {
    paths_in_head(root, &[relative.to_string()]).contains(relative)
}

/// Argument-length budget per `ls-tree` call (Windows allows ~32k chars).
const HEAD_LOOKUP_CHUNK_CHARS: usize = 24_000;

/// Which of `paths` exist in HEAD (as a blob or a tree, like `cat-file -e
/// HEAD:<path>`), answered with one `ls-tree` per argument-length chunk.
/// An unborn HEAD makes every call fail, so nothing is in HEAD.
fn paths_in_head(root: &Path, paths: &[String]) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut unique: Vec<&str> = paths.iter().map(String::as_str).collect();
    unique.sort_unstable();
    unique.dedup();
    let mut start = 0;
    while start < unique.len() {
        let mut end = start;
        let mut chars = 0;
        while end < unique.len()
            && (end == start || chars + unique[end].len() < HEAD_LOOKUP_CHUNK_CHARS)
        {
            chars += unique[end].len() + 1;
            end += 1;
        }
        // Not recursive: a directory path matches its own tree entry, as with
        // cat-file. `--full-tree` keeps paths repo-root relative like
        // `HEAD:<path>`; `-z` leaves names unquoted; matching below is exact.
        let mut args = vec![
            "--literal-pathspecs",
            "ls-tree",
            "--full-tree",
            "--name-only",
            "-z",
            "HEAD",
            "--",
        ];
        args.extend_from_slice(&unique[start..end]);
        if let Some(out) = git_output(root, &args) {
            for name in out.split(|byte| *byte == 0).filter(|name| !name.is_empty()) {
                if let Ok(name) = std::str::from_utf8(name) {
                    found.insert(name.to_string());
                }
            }
        }
        start = end;
    }
    found
}

fn snapshot_file(dir: &Path, root: &Path, relative: &str) -> Result<SnapshotKind, String> {
    snapshot_file_at(&dir.join("files"), root, relative)
}

fn snapshot_after_file(dir: &Path, root: &Path, relative: &str) -> Result<SnapshotKind, String> {
    snapshot_file_at(&dir.join("after"), root, relative)
}

fn snapshot_file_at(blob_root: &Path, root: &Path, relative: &str) -> Result<SnapshotKind, String> {
    resolve_repo_path(root, relative)?;
    if path_contains_symlink(root, relative) {
        return Ok(SnapshotKind::Skipped);
    }
    let abs = root.join(relative);
    let meta = match std::fs::symlink_metadata(&abs) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let blob = state_blob_path(blob_root, relative)?;
            if let Some(parent) = blob.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(blob, []).map_err(|e| e.to_string())?;
            return Ok(SnapshotKind::Missing);
        }
        Err(error) => return Err(error.to_string()),
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Ok(SnapshotKind::Skipped);
    }
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Ok(SnapshotKind::Skipped);
    }
    let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
    let blob = state_blob_path(blob_root, relative)?;
    if let Some(parent) = blob.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&blob, bytes).map_err(|e| e.to_string())?;
    set_file_mode(&blob, file_mode(&abs))?;
    Ok(SnapshotKind::Contents)
}

#[cfg(unix)]
fn file_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::symlink_metadata(path)
        .ok()
        .filter(|meta| meta.is_file() && !meta.file_type().is_symlink())
        .map(|meta| meta.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn file_mode(_path: &Path) -> Option<u32> {
    None
}

#[cfg(unix)]
fn set_file_mode(path: &Path, mode: Option<u32>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_file_mode(_path: &Path, _mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

fn snapshot_mode(blob_root: &Path, relative: &str, kind: SnapshotKind) -> Option<u32> {
    if kind != SnapshotKind::Contents {
        return None;
    }
    state_blob_path(blob_root, relative)
        .ok()
        .and_then(|path| file_mode(&path))
}

fn read_snapshot(dir: &Path, relative: &str, kind: SnapshotKind) -> FileState {
    read_snapshot_at(&dir.join("files"), relative, kind)
}

fn read_after_snapshot(dir: &Path, relative: &str, kind: SnapshotKind) -> FileState {
    read_snapshot_at(&dir.join("after"), relative, kind)
}

fn read_snapshot_at(blob_root: &Path, relative: &str, kind: SnapshotKind) -> FileState {
    match kind {
        SnapshotKind::Missing => FileState::Missing,
        SnapshotKind::Skipped => FileState::Skipped,
        SnapshotKind::Contents => match state_blob_path(blob_root, relative)
            .ok()
            .and_then(|path| std::fs::read(path).ok())
        {
            Some(bytes) => FileState::Contents(bytes),
            None => FileState::Skipped,
        },
    }
}

fn read_worktree(root: &Path, relative: &str) -> FileState {
    if resolve_repo_path(root, relative).is_err() || path_contains_symlink(root, relative) {
        return FileState::Skipped;
    }
    let abs = root.join(relative);
    let meta = match std::fs::symlink_metadata(&abs) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return FileState::Missing,
        Err(_) => return FileState::Skipped,
    };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_TEXT_FILE_BYTES {
        return FileState::Skipped;
    }
    std::fs::read(&abs)
        .map(FileState::Contents)
        .unwrap_or(FileState::Skipped)
}

fn state_is_binary(state: &FileState) -> bool {
    matches!(state, FileState::Contents(bytes) if bytes.contains(&0))
}

fn state_text(state: FileState) -> String {
    match state {
        FileState::Contents(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        FileState::Missing | FileState::Skipped => String::new(),
    }
}

fn write_worktree(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.is_dir() {
        return Err(format!("{} is a directory", path.display()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

fn remove_worktree(root: &Path, relative: &str) -> Result<(), String> {
    let abs = root.join(relative);
    if abs.is_file() || abs.is_symlink() {
        std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
        return Ok(());
    }
    if abs.is_dir() {
        if has_git_marker(root)? {
            git_checked(root, &["clean", "-fd", "--", relative])?;
        }
        if abs.exists() {
            std::fs::remove_dir_all(&abs).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn state_blob_path(blob_root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.starts_with('/')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "..")
    {
        return Err("Invalid path".into());
    }
    Ok(blob_root.join(relative))
}

fn read_manifest(dir: &Path) -> Result<Option<Manifest>, String> {
    let path = dir.join("manifest.json");
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn write_manifest(dir: &Path, manifest: &Manifest) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = dir.join("manifest.json");
    let tmp = dir.join("manifest.json.tmp");
    let bytes = serde_json::to_vec(manifest).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, dest).map_err(|e| e.to_string())
}

fn project_root(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() || trimmed == "~" {
        return Err("cwd is required".into());
    }
    let root = expand_home(trimmed);
    if !root.is_dir() {
        return Err(format!("{}: Not a directory", root.display()));
    }
    Ok(root)
}

fn same_cwd(saved: &str, cwd: &str) -> bool {
    let Ok(left) = project_root(saved) else {
        return false;
    };
    let Ok(right) = project_root(cwd) else {
        return false;
    };
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => {
            if cfg!(windows) {
                left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
            } else {
                left == right
            }
        }
        _ => false,
    }
}

fn relative_to_root(root: &Path, path: &str) -> Result<String, String> {
    let trimmed = path;
    if trimmed.is_empty() {
        return Err("Invalid path".into());
    }
    let expanded = expand_home(trimmed);
    if expanded.is_absolute() {
        let relative = expanded
            .strip_prefix(root)
            .map_err(|_| "Path is outside the project".to_string())?;
        let relative = relative.to_string_lossy().replace('\\', "/");
        return resolve_repo_path(root, &relative);
    }
    resolve_repo_path(root, trimmed)
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("Invalid {label} id"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn rollback_new_file_in_unborn_repository_clears_index_and_worktree() {
        let root = tmp("unborn-rollback");
        assert!(git(&root.0, &["init"]));
        let file = root.0.join("new.txt");
        std::fs::write(&file, "new").unwrap();
        assert!(git(&root.0, &["add", "new.txt"]));
        revert_new_change(&root.0, "new.txt").unwrap();
        assert!(!file.exists());
        assert!(git_output(&root.0, &["ls-files"]).unwrap().is_empty());
    }

    #[test]
    fn failed_git_reset_does_not_delete_new_worktree_file() {
        let root = tmp("failed-reset");
        std::fs::write(root.0.join(".git"), "invalid git marker").unwrap();
        let file = root.0.join("keep.txt");
        std::fs::write(&file, "keep").unwrap();
        assert!(revert_new_change(&root.0, "keep.txt").is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "keep");
    }

    #[test]
    fn failed_git_clean_does_not_delete_worktree_directory() {
        let root = tmp("failed-clean");
        std::fs::write(root.0.join(".git"), "invalid git marker").unwrap();
        let directory = root.0.join("keep");
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("keep.txt"), "keep").unwrap();
        assert!(remove_worktree(&root.0, "keep").is_err());
        assert!(directory.join("keep.txt").exists());
    }

    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

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
                "bycoda-checkpoint-{label}-{}-{stamp}-{seq}",
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
    fn batched_numstat_handles_zero_binary_and_nul_paths() {
        let relatives = vec![
            "file.txt".into(),
            "folder/tab\tname.txt".into(),
            "binary.dat".into(),
        ];
        let rows=parse_batch_numstat(b"2\t1\t/root/after/file.txt\0-\t-\t/root/after/binary.dat\x003\t0\t\0/root/files/folder/tab\tname.txt\0/root/after/folder/tab\tname.txt\0",&relatives).unwrap();
        assert_eq!(rows.get("file.txt"), Some(&Some((2, 1))));
        assert_eq!(rows.get("folder/tab\tname.txt"), Some(&Some((3, 0))));
        assert_eq!(rows.get("binary.dat"), Some(&None));
    }

    #[test]
    fn unrelated_repository_checkpoint_gates_do_not_block_each_other() {
        let (_tmp, store) = store();
        let first = tmp("gate-first");
        let second = tmp("gate-second");
        let (entered_rx, release_tx, worker) = {
            let (entered_tx, entered_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let cloned = store.clone();
            let cwd = first.0.to_string_lossy().into_owned();
            let worker = std::thread::spawn(move || {
                cloned
                    .exclusive("first", &[&cwd], |_| {
                        entered_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        Ok(())
                    })
                    .unwrap()
            });
            (entered_rx, release_tx, worker)
        };
        entered_rx.recv().unwrap();
        let cloned = store.clone();
        let cwd = second.0.to_string_lossy().into_owned();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let independent = std::thread::spawn(move || {
            cloned.exclusive("second", &[&cwd], |_| Ok(())).unwrap();
            done_tx.send(()).unwrap();
        });
        let completed = done_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_ok();
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        independent.join().unwrap();
        assert!(completed);
    }

    #[test]
    fn canonical_subdirectory_aliases_share_repository_gate() {
        let (_tmp, store) = store();
        let repo = tmp("gate-alias");
        if !init_git_commit(&repo.0, &[("sub/file.txt", "initial")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let alias = repo.0.join("sub").to_string_lossy().into_owned();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let cloned = store.clone();
        let worker = std::thread::spawn(move || {
            cloned
                .exclusive("first", &[&cwd], |_| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap()
        });
        entered_rx.recv().unwrap();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let cloned = store.clone();
        let other = std::thread::spawn(move || {
            cloned.exclusive("second", &[&alias], |_| Ok(())).unwrap();
            done_tx.send(()).unwrap();
        });
        let blocked = done_rx
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err();
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        other.join().unwrap();
        assert!(blocked);
    }

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "bycoda")
            .env("GIT_AUTHOR_EMAIL", "bycoda@test")
            .env("GIT_COMMITTER_NAME", "bycoda")
            .env("GIT_COMMITTER_EMAIL", "bycoda@test")
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn init_git_commit(dir: &Path, files: &[(&str, &str)]) -> bool {
        if !git(dir, &["init", "-b", "main"]) && !git(dir, &["init"]) {
            return false;
        }
        let _ = git(dir, &["config", "user.email", "bycoda@test"]);
        let _ = git(dir, &["config", "user.name", "bycoda"]);
        let _ = git(dir, &["config", "core.autocrlf", "false"]);
        for (name, contents) in files {
            let path = dir.join(name);
            if let Some(parent) = path.parent() {
                if std::fs::create_dir_all(parent).is_err() {
                    return false;
                }
            }
            if std::fs::write(&path, contents).is_err() {
                return false;
            }
        }
        git(dir, &["add", "."]) && git(dir, &["commit", "-m", "init"])
    }

    fn store() -> (Tmp, CheckpointStore) {
        let dir = tmp("store");
        let store = CheckpointStore::new(dir.0.clone());
        (dir, store)
    }

    fn relatives(status: &CheckpointStatus) -> Vec<&str> {
        status
            .files
            .iter()
            .map(|file| file.relative.as_str())
            .collect()
    }

    fn record(store: &CheckpointStore, id: &str, cwd: &str, paths: &[&str]) {
        let owned: Vec<String> = paths.iter().map(|path| (*path).to_string()).collect();
        store.capture(id, cwd, &owned).unwrap();
        // Most legacy tests write before calling this helper. Mark their
        // already-captured baselines as if a tool-start prepare event ran;
        // dedicated tests below exercise the real prepare/capture lifecycle.
        let root = project_root(cwd).unwrap();
        let dir = store.session_dir(id);
        let mut manifest = read_manifest(&dir).unwrap().unwrap();
        for path in paths {
            manifest
                .prepared
                .insert(relative_to_root(&root, path).unwrap());
        }
        write_manifest(&dir, &manifest).unwrap();
    }

    #[test]
    fn undo_accepts_a_linked_ancestor_and_refuses_a_link_inside_the_checkout() {
        let temp = tmp("undo-ancestor");
        let repo = temp.0.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(init_git_commit(&repo, &[("sub/file.txt", "before\n")]));
        let link = |path: &Path, target: &Path| {
            #[cfg(unix)]
            std::os::unix::fs::symlink(target, path).unwrap();
            #[cfg(windows)]
            {
                let mut command = Command::new("cmd");
                crate::hide_window_console(&mut command);
                let output = command
                    .args(["/c", "mklink", "/J"])
                    .arg(path.to_string_lossy().replace('/', "\\"))
                    .arg(target.to_string_lossy().replace('/', "\\"))
                    .output()
                    .unwrap();
                assert!(
                    output.status.success(),
                    "{}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        };
        let unlink = |path: &Path| {
            #[cfg(windows)]
            std::fs::remove_dir(path).unwrap();
            #[cfg(unix)]
            std::fs::remove_file(path).unwrap();
        };
        let alias = temp.0.join("ancestor");
        link(&alias, &temp.0);
        let cwd = alias.join("repo").to_string_lossy().into_owned();
        let canonical = crate::fs::path_to_js(&repo.canonicalize().unwrap());
        let (_root, store) = store();
        store.ensure("safe", &cwd).unwrap();
        std::fs::write(repo.join("sub/file.txt"), "changed\n").unwrap();
        record(&store, "safe", &cwd, &["sub/file.txt"]);
        store.undo("safe", &canonical, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("sub/file.txt")).unwrap(),
            "before\n"
        );

        store.ensure("linked", &cwd).unwrap();
        std::fs::write(repo.join("sub/file.txt"), "changed again\n").unwrap();
        record(&store, "linked", &cwd, &["sub/file.txt"]);
        std::fs::remove_dir_all(repo.join("sub")).unwrap();
        let outside = temp.0.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("file.txt"), "must survive\n").unwrap();
        link(&repo.join("sub"), &outside);
        assert!(store.undo("linked", &canonical, None).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.join("file.txt")).unwrap(),
            "must survive\n"
        );
        unlink(&repo.join("sub"));
        unlink(&alias);
    }

    #[test]
    fn undo_reverts_only_session_files_and_keeps_user_dirty() {
        let repo = tmp("keep-user");
        if !init_git_commit(&repo.0, &[("user.txt", "mine\n"), ("clean.txt", "head\n")]) {
            return;
        }
        std::fs::write(repo.0.join("user.txt"), "mine-dirty\n").unwrap();
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();

        store.ensure("s1", &cwd).unwrap();

        std::fs::write(repo.0.join("user.txt"), "agent-on-user\n").unwrap();
        std::fs::write(repo.0.join("clean.txt"), "agent-on-clean\n").unwrap();
        std::fs::write(repo.0.join("new.txt"), "created\n").unwrap();
        record(&store, "s1", &cwd, &["user.txt", "clean.txt", "new.txt"]);

        let status = store.status("s1", &cwd).unwrap();
        assert_eq!(relatives(&status), vec!["clean.txt", "new.txt", "user.txt"]);

        store.undo("s1", &cwd, None).unwrap();

        assert_eq!(
            std::fs::read_to_string(repo.0.join("user.txt")).unwrap(),
            "mine-dirty\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.0.join("clean.txt")).unwrap(),
            "head\n"
        );
        assert!(!repo.0.join("new.txt").exists());
        assert!(store.status("s1", &cwd).unwrap().files.is_empty());
    }

    #[test]
    fn undo_does_not_touch_untouched_user_files() {
        let repo = tmp("untouched");
        if !init_git_commit(&repo.0, &[("keep.txt", "head\n"), ("edit.txt", "head\n")]) {
            return;
        }
        std::fs::write(repo.0.join("keep.txt"), "user\n").unwrap();
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();

        std::fs::write(repo.0.join("edit.txt"), "agent\n").unwrap();
        std::fs::write(repo.0.join("created.txt"), "new\n").unwrap();
        record(&store, "s1", &cwd, &["edit.txt", "created.txt"]);

        let status = store.status("s1", &cwd).unwrap();
        assert_eq!(relatives(&status), vec!["created.txt", "edit.txt"]);

        store.undo("s1", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("keep.txt")).unwrap(),
            "user\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.0.join("edit.txt")).unwrap(),
            "head\n"
        );
        assert!(!repo.0.join("created.txt").exists());
    }

    #[test]
    fn ensure_is_idempotent_across_turns() {
        let repo = tmp("idempotent");
        if !init_git_commit(&repo.0, &[("a.txt", "head\n")]) {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "user\n").unwrap();
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("a.txt"), "agent-1\n").unwrap();
        record(&store, "s1", &cwd, &["a.txt"]);
        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("b.txt"), "agent-2\n").unwrap();
        record(&store, "s1", &cwd, &["b.txt"]);

        store.undo("s1", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "user\n"
        );
        assert!(!repo.0.join("b.txt").exists());
    }

    #[test]
    fn keep_clears_review_and_leaves_files() {
        let repo = tmp("keep");
        if !init_git_commit(&repo.0, &[("a.txt", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
        std::fs::write(repo.0.join("b.txt"), "new\n").unwrap();
        record(&store, "s1", &cwd, &["a.txt", "b.txt"]);
        assert!(!store.status("s1", &cwd).unwrap().files.is_empty());

        store.keep("s1", &cwd, None).unwrap();
        assert!(store.status("s1", &cwd).unwrap().files.is_empty());
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "agent\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.0.join("b.txt")).unwrap(),
            "new\n"
        );
    }

    #[test]
    fn keep_one_file_then_undo_the_rest() {
        let repo = tmp("keep-one");
        if !init_git_commit(&repo.0, &[("a.txt", "head-a\n"), ("b.txt", "head-b\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("a.txt"), "agent-a\n").unwrap();
        std::fs::write(repo.0.join("b.txt"), "agent-b\n").unwrap();
        record(&store, "s1", &cwd, &["a.txt", "b.txt"]);

        store.keep("s1", &cwd, Some("a.txt")).unwrap();
        let status = store.status("s1", &cwd).unwrap();
        assert_eq!(relatives(&status), vec!["b.txt"]);

        store.undo("s1", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "agent-a\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.0.join("b.txt")).unwrap(),
            "head-b\n"
        );
    }

    #[test]
    fn ensure_baselines_other_session_dirty_files() {
        let repo = tmp("ensure-baseline");
        if !init_git_commit(&repo.0, &[("plan.md", "old\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();

        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("plan.md"), "session-one\n").unwrap();
        record(&store, "s1", &cwd, &["plan.md"]);

        store.ensure("s2", &cwd).unwrap();
        assert!(store.status("s2", &cwd).unwrap().files.is_empty());
    }

    #[test]
    fn other_session_edits_do_not_appear_in_review() {
        let repo = tmp("two-sessions");
        if !init_git_commit(&repo.0, &[("plan.md", "old\n"), ("readme.md", "old\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();

        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("plan.md"), "session-one\n").unwrap();
        record(&store, "s1", &cwd, &["plan.md"]);
        assert_eq!(
            relatives(&store.status("s1", &cwd).unwrap()),
            vec!["plan.md"]
        );

        store.ensure("s2", &cwd).unwrap();
        std::fs::write(repo.0.join("readme.md"), "session-two\n").unwrap();
        record(&store, "s2", &cwd, &["readme.md"]);

        assert_eq!(
            relatives(&store.status("s1", &cwd).unwrap()),
            vec!["plan.md"]
        );
        assert_eq!(
            relatives(&store.status("s2", &cwd).unwrap()),
            vec!["readme.md"]
        );

        store.undo("s1", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("plan.md")).unwrap(),
            "old\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.0.join("readme.md")).unwrap(),
            "session-two\n"
        );
    }

    #[test]
    fn read_only_session_has_no_changes_when_another_session_edits() {
        let repo = tmp("read-only-session");
        if !init_git_commit(&repo.0, &[("app.ts", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("writer", &cwd).unwrap();
        store.ensure("reader", &cwd).unwrap();

        store.prepare("writer", &cwd, &["app.ts".into()]).unwrap();
        std::fs::write(repo.0.join("app.ts"), "writer\n").unwrap();
        store.capture("writer", &cwd, &["app.ts".into()]).unwrap();

        assert_eq!(
            relatives(&store.status("writer", &cwd).unwrap()),
            vec!["app.ts"]
        );
        assert!(store.status("reader", &cwd).unwrap().files.is_empty());
    }

    #[test]
    fn status_counts_only_the_session_delta_from_its_pre_edit_snapshot() {
        let repo = tmp("session-counts");
        if !init_git_commit(&repo.0, &[("app.ts", "head\n")]) {
            return;
        }
        std::fs::write(repo.0.join("app.ts"), "user-one\nuser-two\n").unwrap();
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        store.prepare("s1", &cwd, &["app.ts".into()]).unwrap();
        std::fs::write(repo.0.join("app.ts"), "user-one\nuser-two\nagent\n").unwrap();
        store.capture("s1", &cwd, &["app.ts".into()]).unwrap();

        let status = store.status("s1", &cwd).unwrap();
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].additions, 1);
        assert_eq!(status.files[0].deletions, 0);
        assert!(status.files[0].exact);
        assert!(status.files[0].undoable);
        assert_eq!(status.files[0].path, path_to_js(&repo.0.join("app.ts")));

        let diff = store.file_diff("s1", &cwd, "app.ts").unwrap();
        assert_eq!(diff.original, "user-one\nuser-two\n");
        assert_eq!(diff.current, "user-one\nuser-two\nagent\n");
        assert_eq!(diff.path, path_to_js(&repo.0.join("app.ts")));

        // Review remains the captured session result, not a later shared
        // working-tree state.
        std::fs::write(repo.0.join("app.ts"), "user-one\nuser-two\nagent\nother\n").unwrap();
        let diff = store.file_diff("s1", &cwd, "app.ts").unwrap();
        assert_eq!(diff.current, "user-one\nuser-two\nagent\n");
    }

    #[test]
    fn shared_file_keeps_session_scoped_review_but_disables_unsafe_undo() {
        let repo = tmp("shared-file");
        if !init_git_commit(&repo.0, &[("app.ts", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        store.ensure("s2", &cwd).unwrap();

        store.prepare("s1", &cwd, &["app.ts".into()]).unwrap();
        std::fs::write(repo.0.join("app.ts"), "session-one\n").unwrap();
        store.capture("s1", &cwd, &["app.ts".into()]).unwrap();

        store.prepare("s2", &cwd, &["app.ts".into()]).unwrap();
        std::fs::write(repo.0.join("app.ts"), "session-one\nsession-two\n").unwrap();
        store.capture("s2", &cwd, &["app.ts".into()]).unwrap();

        let s1 = store.status("s1", &cwd).unwrap();
        let s2 = store.status("s2", &cwd).unwrap();
        assert!(s1.files[0].exact);
        assert!(s2.files[0].exact);
        assert_eq!((s1.files[0].additions, s1.files[0].deletions), (1, 1));
        assert_eq!((s2.files[0].additions, s2.files[0].deletions), (1, 0));
        assert!(!s1.files[0].undoable);
        assert!(!s2.files[0].undoable);
        let s1_diff = store.file_diff("s1", &cwd, "app.ts").unwrap();
        assert_eq!(s1_diff.original, "head\n");
        assert_eq!(s1_diff.current, "session-one\n");
        let s2_diff = store.file_diff("s2", &cwd, "app.ts").unwrap();
        assert_eq!(s2_diff.original, "session-one\n");
        assert_eq!(s2_diff.current, "session-one\nsession-two\n");
        assert!(store.undo("s1", &cwd, None).is_err());
        assert_eq!(
            std::fs::read_to_string(repo.0.join("app.ts")).unwrap(),
            "session-one\nsession-two\n"
        );

        // Accepting s1 releases its ownership without touching the file. The
        // second session can then safely undo back to the contents it started
        // from, preserving s1's accepted line.
        store.keep("s1", &cwd, None).unwrap();
        assert!(store.status("s2", &cwd).unwrap().files[0].undoable);
        store.undo("s2", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("app.ts")).unwrap(),
            "session-one\n"
        );
    }

    #[test]
    fn undo_refuses_a_file_changed_after_the_session_edit() {
        let repo = tmp("changed-after");
        if !init_git_commit(&repo.0, &[("app.ts", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        store.prepare("s1", &cwd, &["app.ts".into()]).unwrap();
        std::fs::write(repo.0.join("app.ts"), "agent\n").unwrap();
        store.capture("s1", &cwd, &["app.ts".into()]).unwrap();

        std::fs::write(repo.0.join("app.ts"), "agent\nother\n").unwrap();

        assert!(!store.status("s1", &cwd).unwrap().files[0].undoable);
        assert!(store.undo("s1", &cwd, None).is_err());
        assert_eq!(
            std::fs::read_to_string(repo.0.join("app.ts")).unwrap(),
            "agent\nother\n"
        );
    }

    #[test]
    fn capture_missing_path_lets_non_git_undo_delete() {
        let project = tmp("nongit");
        let cwd = project.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        store
            .prepare(
                "s1",
                &cwd,
                &[project.0.join("made.txt").to_string_lossy().into_owned()],
            )
            .unwrap();
        std::fs::write(project.0.join("made.txt"), "hello\n").unwrap();
        store
            .capture(
                "s1",
                &cwd,
                &[project.0.join("made.txt").to_string_lossy().into_owned()],
            )
            .unwrap();
        assert_eq!(
            relatives(&store.status("s1", &cwd).unwrap()),
            vec!["made.txt"]
        );
        store.undo("s1", &cwd, None).unwrap();
        assert!(!project.0.join("made.txt").exists());
    }

    #[test]
    fn late_capture_is_not_attributed_to_the_session() {
        let repo = tmp("late-capture");
        if !init_git_commit(&repo.0, &[("a.txt", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();
        std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
        store.capture("s1", &cwd, &["a.txt".into()]).unwrap();
        assert!(store.status("s1", &cwd).unwrap().files.is_empty());
        store.undo("s1", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "agent\n"
        );

        // A later structured edit in that same session replaces the
        // untrusted completion-only claim with a real boundary.
        store.ensure("s1", &cwd).unwrap();
        store.capture("s1", &cwd, &["a.txt".into()]).unwrap();
        store.prepare("s1", &cwd, &["a.txt".into()]).unwrap();
        std::fs::write(repo.0.join("a.txt"), "same-session-valid\n").unwrap();
        store.capture("s1", &cwd, &["a.txt".into()]).unwrap();
        assert!(store.status("s1", &cwd).unwrap().files[0].undoable);
        store.undo("s1", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "agent\n"
        );

        // An old/unprepared claim is not ownership and must not block a later
        // session that recorded a trustworthy before/after pair.
        store.ensure("s2", &cwd).unwrap();
        store.prepare("s2", &cwd, &["a.txt".into()]).unwrap();
        std::fs::write(repo.0.join("a.txt"), "second-session\n").unwrap();
        store.capture("s2", &cwd, &["a.txt".into()]).unwrap();
        assert!(store.status("s2", &cwd).unwrap().files[0].undoable);
        store.undo("s2", &cwd, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "agent\n"
        );
    }

    #[test]
    fn committed_session_changes_leave_review() {
        let repo = tmp("committed");
        if !init_git_commit(&repo.0, &[("edit.txt", "head\n"), ("delete.txt", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();

        std::fs::write(repo.0.join("edit.txt"), "agent\n").unwrap();
        std::fs::write(repo.0.join("created.txt"), "new\n").unwrap();
        std::fs::remove_file(repo.0.join("delete.txt")).unwrap();
        record(
            &store,
            "s1",
            &cwd,
            &["edit.txt", "created.txt", "delete.txt"],
        );
        assert_eq!(
            relatives(&store.status("s1", &cwd).unwrap()),
            vec!["created.txt", "delete.txt", "edit.txt"]
        );

        assert!(git(&repo.0, &["add", "-A"]));
        assert!(git(&repo.0, &["commit", "-m", "agent changes"]));
        assert!(store.status("s1", &cwd).unwrap().files.is_empty());
    }

    #[test]
    fn deleting_untracked_baseline_still_needs_review() {
        let repo = tmp("delete-untracked");
        if !init_git_commit(&repo.0, &[("tracked.txt", "head\n")]) {
            return;
        }
        std::fs::write(repo.0.join("loose.txt"), "user\n").unwrap();
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();

        std::fs::remove_file(repo.0.join("loose.txt")).unwrap();
        record(&store, "s1", &cwd, &["loose.txt"]);
        assert_eq!(
            relatives(&store.status("s1", &cwd).unwrap()),
            vec!["loose.txt"]
        );
    }

    #[test]
    fn session_stats_match_git_not_edit_churn() {
        let repo = tmp("stats-churn");
        if !init_git_commit(&repo.0, &[("a.txt", "head\n")]) {
            return;
        }
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();

        std::fs::write(repo.0.join("a.txt"), "one\ntwo\nthree\nfour\n").unwrap();
        record(&store, "s1", &cwd, &["a.txt"]);
        std::fs::write(repo.0.join("a.txt"), "head\nworld\n").unwrap();
        record(&store, "s1", &cwd, &["a.txt"]);

        let stats = store.stats_for_sessions(&cwd, &["s1".into()]).unwrap();
        let s1 = stats.get("s1").expect("s1 stats");
        assert_eq!(s1.files, 1);
        assert_eq!(s1.additions, 1);
        assert_eq!(s1.deletions, 0);
    }

    #[test]
    fn session_stats_are_scoped_to_touched_files() {
        let repo = tmp("stats-scoped");
        if !init_git_commit(&repo.0, &[("a.txt", "a\n"), ("b.txt", "b\n")]) {
            return;
        }
        std::fs::write(repo.0.join("b.txt"), "user\n").unwrap();
        let cwd = repo.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("s1", &cwd).unwrap();

        std::fs::write(repo.0.join("a.txt"), "a\nA\n").unwrap();
        record(&store, "s1", &cwd, &["a.txt"]);

        let stats = store.stats_for_sessions(&cwd, &["s1".into()]).unwrap();
        let s1 = stats.get("s1").expect("s1 stats");
        assert_eq!(s1.files, 1);
        assert_eq!(s1.additions, 1);
        assert_eq!(s1.deletions, 0);
        assert_eq!(relatives(&store.status("s1", &cwd).unwrap()), vec!["a.txt"]);
    }

    #[test]
    fn isolated_worker_delta_applies_idempotently_to_matching_baseline() {
        let source = tmp("apply-source");
        let target = tmp("apply-target");
        if !init_git_commit(&source.0, &[("a.txt", "head\n")]) {
            return;
        }
        let source_path = source.0.to_string_lossy().into_owned();
        let target_path = target.0.to_string_lossy().into_owned();
        if !git(&source.0, &["clone", &source_path, &target_path]) {
            return;
        }
        std::fs::write(source.0.join("a.txt"), "user baseline\n").unwrap();
        std::fs::write(target.0.join("a.txt"), "user baseline\n").unwrap();
        let from = source.0.to_string_lossy().into_owned();
        let to = target.0.to_string_lossy().into_owned();
        let (_root, store) = store();

        store.ensure("worker", &from).unwrap();
        assert!(store.cleanup_safe("worker", &from).unwrap());
        store.prepare("worker", &from, &["a.txt".into()]).unwrap();
        std::fs::write(source.0.join("a.txt"), "worker result\n").unwrap();
        store.capture("worker", &from, &["a.txt".into()]).unwrap();
        assert!(!store.cleanup_safe("worker", &from).unwrap());

        let applied = store.apply("worker", &from, &to).unwrap();
        assert_eq!(applied.files, ["a.txt"]);
        assert_eq!(applied.already_applied, 0);
        assert_eq!(
            std::fs::read_to_string(target.0.join("a.txt")).unwrap(),
            "worker result\n"
        );
        let retried = store.apply("worker", &from, &to).unwrap();
        assert_eq!(retried.already_applied, 1);
    }

    #[test]
    fn isolated_worker_integration_keeps_both_sides_on_conflict_or_unknown_edit() {
        let source = tmp("apply-conflict-source");
        let target = tmp("apply-conflict-target");
        if !init_git_commit(&source.0, &[("a.txt", "head\n")]) {
            return;
        }
        let source_path = source.0.to_string_lossy().into_owned();
        let target_path = target.0.to_string_lossy().into_owned();
        if !git(&source.0, &["clone", &source_path, &target_path]) {
            return;
        }
        let from = source.0.to_string_lossy().into_owned();
        let to = target.0.to_string_lossy().into_owned();
        let (_root, store) = store();
        store.ensure("worker", &from).unwrap();
        store.prepare("worker", &from, &["a.txt".into()]).unwrap();
        std::fs::write(source.0.join("a.txt"), "worker\n").unwrap();
        store.capture("worker", &from, &["a.txt".into()]).unwrap();
        std::fs::write(target.0.join("a.txt"), "lead changed\n").unwrap();

        let conflict = store.apply("worker", &from, &to).unwrap_err();
        assert!(conflict.contains("lead checkout changed"));
        assert_eq!(
            std::fs::read_to_string(source.0.join("a.txt")).unwrap(),
            "worker\n"
        );
        assert_eq!(
            std::fs::read_to_string(target.0.join("a.txt")).unwrap(),
            "lead changed\n"
        );

        std::fs::write(source.0.join("unreported.txt"), "unknown\n").unwrap();
        assert!(!store.cleanup_safe("worker", &from).unwrap());
        assert!(store
            .apply("worker", &from, &to)
            .unwrap_err()
            .contains("not captured"));
    }

    #[test]
    fn paths_in_head_answers_many_paths_at_once() {
        let repo = tmp("in-head");
        if !init_git_commit(
            &repo.0,
            &[
                ("tracked.txt", "a\n"),
                ("dir/with space.txt", "b\n"),
                ("dir/\u{00fc}n\u{00ef}code-\u{65e5}.txt", "c\n"),
                ("gone.txt", "d\n"),
            ],
        ) {
            return;
        }
        std::fs::remove_file(repo.0.join("gone.txt")).unwrap();
        std::fs::write(repo.0.join("untracked.txt"), "u\n").unwrap();
        let wanted: Vec<String> = [
            "tracked.txt",
            "dir/with space.txt",
            "dir/\u{00fc}n\u{00ef}code-\u{65e5}.txt",
            "gone.txt",
            "untracked.txt",
            "missing/nope.txt",
            "Tracked.txt",
        ]
        .iter()
        .map(|path| path.to_string())
        .collect();
        let mut found: Vec<_> = paths_in_head(&repo.0, &wanted).into_iter().collect();
        found.sort();
        assert_eq!(
            found,
            vec![
                "dir/with space.txt".to_string(),
                "dir/\u{00fc}n\u{00ef}code-\u{65e5}.txt".to_string(),
                "gone.txt".to_string(),
                "tracked.txt".to_string(),
            ]
        );
        assert!(in_head(&repo.0, "tracked.txt"));
        assert!(in_head(&repo.0, "dir"));
        assert!(!in_head(&repo.0, "untracked.txt"));
        assert!(paths_in_head(&repo.0, &[]).is_empty());
    }

    #[test]
    fn paths_in_head_is_empty_on_unborn_head() {
        let repo = tmp("in-head-unborn");
        if !git(&repo.0, &["init"]) {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "a\n").unwrap();
        let _ = git(&repo.0, &["add", "a.txt"]);
        assert!(paths_in_head(&repo.0, &["a.txt".to_string()]).is_empty());
        assert!(!in_head(&repo.0, "a.txt"));
    }

    #[test]
    fn paths_in_head_chunks_long_path_lists() {
        let repo = tmp("in-head-chunks");
        let names: Vec<String> = (0..400)
            .map(|index| format!("long/{}/file-{index}.txt", "d".repeat(100)))
            .collect();
        let files: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "x\n")).collect();
        if !init_git_commit(&repo.0, &files) {
            return;
        }
        // Even indices are in HEAD, odd ones are not.
        let wanted: Vec<String> = names
            .iter()
            .enumerate()
            .map(|(index, name)| {
                if index % 2 == 0 {
                    name.clone()
                } else {
                    format!("{name}.absent")
                }
            })
            .collect();
        assert!(wanted.iter().map(|path| path.len()).sum::<usize>() > HEAD_LOOKUP_CHUNK_CHARS);
        let found = paths_in_head(&repo.0, &wanted);
        assert_eq!(found.len(), 200);
        assert!(names
            .iter()
            .step_by(2)
            .all(|name| found.contains(name.as_str())));
    }

    #[test]
    fn paths_in_head_from_a_subdirectory_uses_repo_root_paths() {
        let repo = tmp("in-head-sub");
        if !init_git_commit(&repo.0, &[("pkg/a.txt", "a\n"), ("top.txt", "t\n")]) {
            return;
        }
        let sub = repo.0.join("pkg");
        let found = paths_in_head(&sub, &["pkg/a.txt".to_string(), "top.txt".to_string()]);
        assert_eq!(found.len(), 2);
        assert!(!in_head(&sub, "a.txt"));
    }

    #[test]
    fn rejects_invalid_session_id() {
        let err = validate_id("../x", "session").unwrap_err();
        assert!(err.contains("Invalid"));
    }
    include!("checkpoint/turn_tests.rs");
}
