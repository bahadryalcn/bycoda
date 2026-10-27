//! Per-message content history. No Git index, commit, ref or provider lifecycle mutation.
use super::*;

const HISTORY_BYTES: u64 = 64 * 1024 * 1024;
const BASELINE_BYTES: u64 = 64 * 1024 * 1024;
const HISTORY_TURNS: usize = 4096;
const DISCOVERY_FILES: usize = 100_000;
const HISTORY_METADATA_BYTES: usize = 4 * 1024 * 1024;
const UNAVAILABLE: &str = "File history for this message is unavailable or has been pruned.";
const FOREIGN: &str = "The file changed after this session last wrote it.";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    cwd: String,
    turns: Vec<FileTurn>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileTurn {
    id: String,
    user_block_id: String,
    active: bool,
    unavailable: Option<String>,
    files: BTreeMap<String, Pair>,
    #[serde(default)]
    baseline: BTreeMap<String, SnapshotKind>,
    #[serde(default)]
    baseline_complete: bool,
    #[serde(default)]
    baseline_skipped_stamps: BTreeMap<String, String>,
    #[serde(default)]
    bytes: Option<u64>,
    #[serde(default)]
    provider_calls: BTreeSet<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFileChange {
    path: String,
    kind: String,
    contents: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Pair {
    before: SnapshotKind,
    after: Option<SnapshotKind>,
    #[serde(default)]
    conflict: bool,
    #[serde(default)]
    provider_after: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertFile {
    path: String,
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertPlan {
    files: Vec<RevertFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unavailable: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SkippedFile {
    path: String,
    reason: String,
}

#[derive(Debug, Default, Serialize)]
pub struct RevertResult {
    reverted: Vec<String>,
    skipped: Vec<SkippedFile>,
}

fn journal_path(dir: &Path) -> PathBuf {
    dir.join("files-history.json")
}

fn load(dir: &Path) -> Result<Option<Journal>, String> {
    match std::fs::read(journal_path(dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn save(dir: &Path, journal: &Journal) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("files-history-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(
        &tmp,
        serde_json::to_vec(journal).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, journal_path(dir)).map_err(|e| e.to_string())
}

fn turn_dir(dir: &Path, id: &str) -> Result<PathBuf, String> {
    validate_id(id, "turn")?;
    Ok(dir.join("files-history").join(id))
}

fn safe_relative(root: &Path, path: &str) -> Result<String, String> {
    let path = relative_to_root(root, path)?;
    // Windows normalizes trailing dots/spaces and accepts alternate data streams.
    // Reject aliases too, rather than allowing them to address checkout metadata.
    if path.split('/').any(|part| {
        part.eq_ignore_ascii_case(".git")
            || (cfg!(windows) && (part.contains(':') || part.ends_with('.') || part.ends_with(' ')))
    }) {
        return Err("Unsafe file history path".into());
    }
    Ok(path)
}

fn disk_bytes(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                disk_bytes(&entry.path())
            } else {
                entry.metadata().map_or(0, |meta| meta.len())
            }
        })
        .sum()
}

fn stamp(root: &Path, path: &str) -> String {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    if path_contains_symlink(root, path) {
        return "unsafe".into();
    }
    let Ok(mut file) = std::fs::File::open(root.join(path)) else {
        return "missing".into();
    };
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => return format!("{:x}", hash.finalize()),
            Ok(size) => hash.update(&buffer[..size]),
            Err(_) => return "unreadable".into(),
        }
    }
}

fn prune(dir: &Path, journal: &mut Journal, limit: u64) -> Result<(), String> {
    // Settled turn sizes are immutable. Do not rescan the whole journal on every
    // edit-tool boundary; read a legacy size once and retain it in the index.
    let mut sizes = Vec::with_capacity(journal.turns.len());
    for turn in &mut journal.turns {
        let bytes = match turn.bytes {
            Some(bytes) => bytes,
            None => disk_bytes(&turn_dir(dir, &turn.id)?),
        };
        turn.bytes = Some(bytes);
        sizes.push(bytes);
    }
    let mut total: u64 = sizes.iter().sum();
    let metadata_cost = |turn: &FileTurn| {
        turn.files
            .keys()
            .map(|path| path.len() * 2 + 128)
            .sum::<usize>()
            + turn
                .provider_calls
                .iter()
                .map(|call| call.len() + 32)
                .sum::<usize>()
    };
    let mut metadata: usize = journal.turns.iter().map(metadata_cost).sum();
    for (turn, size) in journal.turns.iter_mut().zip(&mut sizes) {
        if total <= limit && metadata <= HISTORY_METADATA_BYTES {
            break;
        }
        total = total.saturating_sub(*size);
        metadata = metadata.saturating_sub(metadata_cost(turn));
        let path = turn_dir(dir, &turn.id)?;
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
        turn.files.clear();
        turn.provider_calls.clear();
        turn.bytes = Some(0);
        turn.unavailable = Some(UNAVAILABLE.into());
    }
    while journal.turns.len() > HISTORY_TURNS {
        let turn = journal.turns.remove(0);
        let path = turn_dir(dir, &turn.id)?;
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Listing is read-only. Git supplies ignore handling; plain folders use a bounded walk.
fn discover(root: &Path) -> Result<(BTreeSet<String>, bool), String> {
    let mut paths = BTreeSet::new();
    if has_git_marker(root)? {
        let bytes = git_output(
            root,
            &[
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                ".",
            ],
        )
        .ok_or("Could not list checkout files")?;
        for path in bytes.split(|b| *b == 0).filter(|p| !p.is_empty()) {
            let path = std::str::from_utf8(path).map_err(|e| e.to_string())?;
            if let Ok(relative) = safe_relative(root, path) {
                paths.insert(relative);
            }
            if paths.len() > DISCOVERY_FILES {
                return Ok((paths, false));
            }
        }
        return Ok((paths, true));
    }
    fn walk(root: &Path, here: &Path, paths: &mut BTreeSet<String>) -> Result<bool, String> {
        for entry in std::fs::read_dir(here).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if matches!(
                    entry.file_name().to_str(),
                    Some(".git" | "node_modules" | "target")
                ) {
                    continue;
                }
                if !walk(root, &entry.path(), paths)? {
                    return Ok(false);
                }
            } else if kind.is_file() {
                let path = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                paths.insert(safe_relative(root, &path)?);
                if paths.len() > DISCOVERY_FILES {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
    let complete = walk(root, root, &mut paths)?;
    Ok((paths, complete))
}

impl CheckpointStore {
    /// Lightweight turn start: bounded raw working-file baseline, no Git tree snapshot.
    pub(super) fn begin_files_turn(
        &self,
        session: &str,
        cwd: &str,
        id: &str,
        user_block_id: &str,
    ) -> Result<(), String> {
        validate_id(session, "session")?;
        validate_id(id, "turn")?;
        if user_block_id.is_empty() {
            return Err("A user message ID is required".into());
        }
        let root = std::fs::canonicalize(project_root(cwd)?).map_err(|e| e.to_string())?;
        let dir = self.session_dir(session);
        let mut journal = load(&dir)?
            .filter(|j| same_cwd(&j.cwd, cwd))
            .unwrap_or_default();
        journal.cwd = root.to_string_lossy().into_owned();
        if let Some(turn) = journal.turns.last_mut().filter(|turn| turn.active) {
            if turn.id == id {
                return Ok(());
            }
            turn.active = false;
            turn.baseline.clear();
            turn.unavailable =
                Some("This turn was interrupted before its file history settled.".into());
            let _ = turn::leases::release(&self.leases, session, &turn.id);
        }
        if journal.turns.iter().any(|turn| turn.id == id) {
            return Err("Turn ID was already recorded".into());
        }
        // This observation lease never denies or delays admission. Overlap only limits attribution.
        turn::leases::publish(&self.leases, session, id, cwd)?;
        let baseline_dir = dir.join("files-baseline");
        if baseline_dir.exists() {
            std::fs::remove_dir_all(&baseline_dir).map_err(|e| e.to_string())?;
        }
        let mut turn = FileTurn {
            id: id.into(),
            user_block_id: user_block_id.into(),
            active: true,
            unavailable: None,
            files: BTreeMap::new(),
            baseline: BTreeMap::new(),
            baseline_complete: false,
            baseline_skipped_stamps: BTreeMap::new(),
            bytes: Some(0),
            provider_calls: BTreeSet::new(),
        };
        match discover(&root) {
            Ok((paths, complete)) => {
                turn.baseline_complete = complete;
                let mut bytes = 0;
                for path in paths {
                    let size = std::fs::symlink_metadata(root.join(&path)).map_or(0, |m| m.len());
                    let kind = if bytes + size <= BASELINE_BYTES {
                        let kind = snapshot_file_at(&baseline_dir, &root, &path)?;
                        if kind == SnapshotKind::Contents {
                            bytes += size;
                        }
                        kind
                    } else {
                        SnapshotKind::Skipped
                    };
                    if kind == SnapshotKind::Skipped {
                        turn.baseline_skipped_stamps
                            .insert(path.clone(), stamp(&root, &path));
                    }
                    turn.baseline.insert(path, kind);
                }
            }
            Err(error) => {
                turn.unavailable = Some(format!("File baseline could not be captured: {error}"))
            }
        }
        journal.turns.push(turn);
        prune(&dir, &mut journal, HISTORY_BYTES)?;
        save(&dir, &journal)
    }

    pub(super) fn finish_files_turn(
        &self,
        session: &str,
        cwd: &str,
        id: &str,
        interrupted: bool,
    ) -> Result<bool, String> {
        let dir = self.session_dir(session);
        let Some(mut journal) = load(&dir)?.filter(|j| same_cwd(&j.cwd, cwd)) else {
            return Ok(false);
        };
        let Some(turn) = journal.turns.last_mut().filter(|t| t.active && t.id == id) else {
            return Ok(false);
        };
        let root = PathBuf::from(&journal.cwd);
        let baseline_dir = dir.join("files-baseline");
        let shared = turn::leases::shared(&self.leases, session, id)? || interrupted;
        if !shared && turn.unavailable.is_none() {
            let (current, complete) = discover(&root)?;
            if !complete || !turn.baseline_complete {
                turn.unavailable = Some("This folder exceeded the file discovery limit.".into());
            }
            let all: BTreeSet<_> = current
                .into_iter()
                .chain(turn.baseline.keys().cloned())
                .collect();
            let history_dir = turn_dir(&dir, id)?;
            for path in all {
                // Structured edit completions record what this session last wrote. Do not adopt
                // subsequent foreign writes, even on an otherwise exclusive turn.
                if turn.files.get(&path).is_some_and(|p| p.after.is_some()) {
                    continue;
                }
                let before_kind = turn
                    .baseline
                    .get(&path)
                    .copied()
                    .unwrap_or(SnapshotKind::Missing);
                let before = read_snapshot_at(&baseline_dir, &path, before_kind);
                let after = read_worktree(&root, &path);
                if before_kind == SnapshotKind::Skipped {
                    if turn.baseline_skipped_stamps.get(&path) != Some(&stamp(&root, &path)) {
                        turn.unavailable =
                            Some("A changed file exceeded the file history size limit.".into());
                    }
                    continue;
                }
                if before == after
                    && snapshot_mode(&baseline_dir, &path, before_kind)
                        == file_mode(&root.join(&path))
                {
                    continue;
                }
                if before == FileState::Skipped || after == FileState::Skipped {
                    turn.unavailable = Some(
                        "A changed file exceeded the baseline limit or could not be read safely."
                            .into(),
                    );
                    continue;
                }
                if !turn.files.contains_key(&path) {
                    copy_state(
                        &history_dir.join("before"),
                        &path,
                        &before,
                        snapshot_mode(&baseline_dir, &path, before_kind),
                    )?;
                    turn.files.insert(
                        path.clone(),
                        Pair {
                            before: before_kind,
                            after: None,
                            conflict: false,
                            provider_after: false,
                        },
                    );
                }
                let after = snapshot_file_at(&history_dir.join("after"), &root, &path)?;
                turn.files.get_mut(&path).unwrap().after = Some(after);
            }
        }
        if self.light_turn_active(session, id)? {
            merge_light_review(&dir, &root, turn)?;
        }
        turn.active = false;
        turn.baseline.clear();
        turn.baseline_skipped_stamps.clear();
        turn.bytes = Some(disk_bytes(&turn_dir(&dir, id)?));
        prune(&dir, &mut journal, HISTORY_BYTES)?;
        save(&dir, &journal)?;
        self.settle_light_turn(session, id, shared)?;
        turn::leases::release(&self.leases, session, id)?;
        if baseline_dir.exists() {
            std::fs::remove_dir_all(baseline_dir).map_err(|e| e.to_string())?;
        }
        Ok(true)
    }
}

/// Keep existing per-file review and Undo fed by the lightweight raw journal.
/// Earlier aggregate baselines and their safety flags are never reset by a new turn.
fn merge_light_review(dir: &Path, root: &Path, turn: &FileTurn) -> Result<(), String> {
    let Some(mut manifest) = read_manifest(dir)? else {
        return Ok(());
    };
    let history = turn_dir(dir, &turn.id)?;
    let mut changed = Vec::new();
    for (path, pair) in &turn.files {
        let Some(after_kind) = pair.after else {
            continue;
        };
        if safe_relative(root, path).is_err() {
            continue;
        }
        let before = read_snapshot_at(&history.join("before"), path, pair.before);
        let after = read_snapshot_at(&history.join("after"), path, after_kind);
        if before == FileState::Skipped || after == FileState::Skipped {
            continue;
        }
        if !manifest.touched.contains(path) && manifest.touched.len() >= MAX_SNAPSHOT_FILES {
            continue;
        }
        if manifest.touched.contains(path) && manifest.prepared.contains(path) {
            if let Some(kind) = manifest.after.get(path) {
                let aggregate_after = read_after_snapshot(dir, path, *kind);
                // Structured completion already advanced the aggregate. Otherwise
                // only an uninterrupted before->after chain remains exact.
                if aggregate_after != before && aggregate_after != after {
                    manifest.diverged.insert(path.clone());
                }
            }
        } else {
            let blocked = manifest.undo_blocked.contains(path);
            if manifest.touched.contains(path) {
                release_path(&mut manifest, path);
            }
            copy_state(
                &dir.join("files"),
                path,
                &before,
                snapshot_mode(&history.join("before"), path, pair.before),
            )?;
            manifest.files.insert(path.clone(), pair.before);
            manifest.prepared.insert(path.clone());
            if blocked {
                manifest.undo_blocked.insert(path.clone());
            }
        }
        if pair.conflict {
            manifest.diverged.insert(path.clone());
        }
        copy_state(
            &dir.join("after"),
            path,
            &after,
            snapshot_mode(&history.join("after"), path, after_kind),
        )?;
        manifest.after.insert(path.clone(), after_kind);
        manifest.touched.insert(path.clone());
        changed.push(path.clone());
    }
    if changed.is_empty() {
        return Ok(());
    }
    manifest.tracked.extend(paths_in_head(root, &changed));
    if let Some(stats) = batch_session_stats(dir, &manifest, &changed) {
        for path in &changed {
            manifest.stats.remove(path);
            if let Some(stats) = stats.get(path) {
                manifest.stats.insert(path.clone(), stats.clone());
            }
        }
    }
    write_manifest(dir, &manifest)
}

fn refresh_reverted_review(
    dir: &Path,
    restored: &BTreeMap<String, (FileState, Option<u32>)>,
) -> Result<(), String> {
    let Some(mut manifest) = read_manifest(dir)? else {
        return Ok(());
    };
    let mut paths = Vec::new();
    for (path, (state, mode)) in restored {
        if !manifest.touched.contains(path) || !manifest.prepared.contains(path) {
            continue;
        }
        // Use the bytes this operation restored, not a new working-tree read
        // that could adopt a foreign write after our per-file guard released.
        copy_state(&dir.join("after"), path, state, *mode)?;
        let kind = match state {
            FileState::Contents(_) => SnapshotKind::Contents,
            FileState::Missing => SnapshotKind::Missing,
            FileState::Skipped => continue,
        };
        manifest.after.insert(path.clone(), kind);
        paths.push(path.clone());
    }
    if let Some(stats) = batch_session_stats(dir, &manifest, &paths) {
        for path in &paths {
            manifest.stats.remove(path);
            if let Some(stats) = stats.get(path) {
                manifest.stats.insert(path.clone(), stats.clone());
            }
        }
    }
    write_manifest(dir, &manifest)
}

fn copy_state(root: &Path, path: &str, state: &FileState, mode: Option<u32>) -> Result<(), String> {
    let destination = state_blob_path(root, path)?;
    std::fs::create_dir_all(destination.parent().ok_or("Invalid snapshot path")?)
        .map_err(|e| e.to_string())?;
    match state {
        FileState::Contents(bytes) => {
            std::fs::write(&destination, bytes).map_err(|e| e.to_string())?
        }
        FileState::Missing => std::fs::write(&destination, []).map_err(|e| e.to_string())?,
        FileState::Skipped => return Err("File state is unavailable".into()),
    }
    set_file_mode(&destination, mode)
}

/// Runs at structured tool boundaries, before aggregate session snapshots can mask later turns.
pub(super) fn prepare(dir: &Path, root: &Path, paths: &[String]) -> Result<(), String> {
    let Some(mut journal) = load(dir)? else {
        return Ok(());
    };
    let Some(turn) = journal.turns.last_mut().filter(|t| t.active) else {
        return Ok(());
    };
    let history_dir = turn_dir(dir, &turn.id)?;
    for path in paths {
        let Ok(path) = safe_relative(root, path) else {
            continue;
        };
        if let Some(pair) = turn.files.get_mut(&path) {
            if let Some(kind) = pair.after {
                pair.conflict |= read_snapshot_at(&history_dir.join("after"), &path, kind)
                    != read_worktree(root, &path);
                pair.conflict |= snapshot_mode(&history_dir.join("after"), &path, kind)
                    != file_mode(&root.join(&path));
            }
            continue;
        }
        let before = snapshot_file_at(&history_dir.join("before"), root, &path)?;
        if before == SnapshotKind::Skipped {
            turn.unavailable = Some("An edited file could not be captured safely.".into());
        }
        turn.files.insert(
            path,
            Pair {
                before,
                after: None,
                conflict: false,
                provider_after: false,
            },
        );
    }
    turn.bytes = Some(disk_bytes(&history_dir));
    prune(dir, &mut journal, HISTORY_BYTES)?;
    save(dir, &journal)
}

pub(super) fn capture(dir: &Path, root: &Path, paths: &[String]) -> Result<(), String> {
    let Some(mut journal) = load(dir)? else {
        return Ok(());
    };
    let Some(turn) = journal.turns.last_mut().filter(|t| t.active) else {
        return Ok(());
    };
    let history_dir = turn_dir(dir, &turn.id)?;
    for path in paths {
        let Ok(path) = safe_relative(root, path) else {
            continue;
        };
        let Some(pair) = turn.files.get_mut(&path) else {
            continue;
        };
        pair.after = Some(snapshot_file_at(&history_dir.join("after"), root, &path)?);
        pair.provider_after = false;
    }
    turn.bytes = Some(disk_bytes(&history_dir));
    prune(dir, &mut journal, HISTORY_BYTES)?;
    save(dir, &journal)
}

/// Codex add/delete notifications carry the actual full contents consumed or
/// produced by the operation. They can arrive after the disk has advanced through
/// a delete/recreate pair, so observing that disk is not a pre-edit barrier.
fn capture_provider_changes(
    dir: &Path,
    root: &Path,
    call_id: &str,
    changes: &[ProviderFileChange],
) -> Result<(), String> {
    if call_id.is_empty() || call_id.len() > 512 {
        return Err("Invalid provider file-change proof".into());
    }
    let Some(mut journal) = load(dir)?.filter(|j| same_cwd(&j.cwd, &root.to_string_lossy())) else {
        return Err("File history belongs to another checkout".into());
    };
    let turn = journal
        .turns
        .last_mut()
        .filter(|turn| turn.active)
        .ok_or("No active turn is recording file history")?;
    if changes.is_empty() || changes.len() > 1024 {
        turn.unavailable = Some("Provider file-change proof is unsupported or incomplete".into());
        return save(dir, &journal);
    }
    if turn.provider_calls.contains(call_id) {
        return Ok(());
    }
    if turn.provider_calls.len() >= 4096 {
        return Err("The turn exceeded the provider proof limit".into());
    }
    // Validate the entire batch before writing snapshots or changing its chain.
    let changes = changes
        .iter()
        .map(|change| {
            if !matches!(change.kind.as_str(), "add" | "delete" | "update")
                || change.contents.len() as u64 > MAX_TEXT_FILE_BYTES
            {
                return Err("Unsupported provider file-change proof".to_string());
            }
            let path = safe_relative(root, &change.path)?;
            if path_contains_symlink(root, &path) {
                return Err("Unsafe provider file-change path".into());
            }
            Ok((path, change))
        })
        .collect::<Result<Vec<_>, String>>();
    let changes = match changes {
        Ok(changes) => changes,
        Err(reason) => {
            turn.unavailable = Some(reason);
            return save(dir, &journal);
        }
    };
    let history = turn_dir(dir, &turn.id)?;
    for (path, change) in changes {
        let contents = FileState::Contents(change.contents.as_bytes().to_vec());
        let (before, after, before_kind, after_kind) = if change.kind == "update" {
            let after = read_worktree(root, &path);
            let FileState::Contents(ref bytes) = after else {
                turn.unavailable = Some("Provider update contents are unavailable".into());
                return save(dir, &journal);
            };
            let before = std::str::from_utf8(bytes)
                .ok()
                .and_then(|after| reverse_provider_diff(after, &change.contents).ok());
            let Some(before) = before else {
                turn.unavailable =
                    Some("Provider update diff could not verify the pre-edit contents".into());
                return save(dir, &journal);
            };
            if before.len() as u64 > MAX_TEXT_FILE_BYTES {
                turn.unavailable =
                    Some("Provider pre-edit contents exceeded the file size limit".into());
                return save(dir, &journal);
            }
            (
                FileState::Contents(before.into_bytes()),
                after,
                SnapshotKind::Contents,
                SnapshotKind::Contents,
            )
        } else if change.kind == "delete" {
            (
                contents,
                FileState::Missing,
                SnapshotKind::Contents,
                SnapshotKind::Missing,
            )
        } else {
            (
                FileState::Missing,
                contents,
                SnapshotKind::Missing,
                SnapshotKind::Contents,
            )
        };
        let baseline_kind = turn
            .baseline
            .get(&path)
            .copied()
            .unwrap_or(SnapshotKind::Missing);
        // Codex AddFile can overwrite an existing file. Its new contents alone
        // do not prove the previous file was absent. Only a chained proven
        // deletion, or an observed complete/nonignored missing baseline, permits
        // restoring that absence. Keep ambiguity local to this path.
        let proven_deletion = turn
            .files
            .get(&path)
            .is_some_and(|pair| pair.provider_after && pair.after == Some(SnapshotKind::Missing));
        let ambiguous_add = change.kind == "add"
            && !proven_deletion
            && (baseline_kind != SnapshotKind::Missing
                || !turn.baseline_complete
                || add_path_excluded(root, &path));
        let before_mode = if change.kind == "update" {
            file_mode(&root.join(&path))
        } else if before == read_snapshot_at(&dir.join("files-baseline"), &path, baseline_kind) {
            snapshot_mode(&dir.join("files-baseline"), &path, baseline_kind)
        } else {
            None
        };
        let after_mode = if matches!(after, FileState::Contents(_)) {
            file_mode(&root.join(&path))
        } else {
            None
        };
        if let Some(pair) = turn.files.get_mut(&path) {
            pair.conflict |= ambiguous_add;
            if let Some(previous_after) = pair.after {
                // A provider-proven chain must still consume exactly our last
                // output. Foreign contributions between own edits stay fenced.
                pair.conflict |=
                    read_snapshot_at(&history.join("after"), &path, previous_after) != before;
            } else {
                copy_state(&history.join("before"), &path, &before, before_mode)?;
                pair.before = before_kind;
            }
            pair.after = Some(after_kind);
            pair.provider_after = true;
        } else {
            copy_state(&history.join("before"), &path, &before, before_mode)?;
            turn.files.insert(
                path.clone(),
                Pair {
                    before: before_kind,
                    after: Some(after_kind),
                    conflict: ambiguous_add,
                    provider_after: true,
                },
            );
        }
        copy_state(&history.join("after"), &path, &after, after_mode)?;
    }
    turn.provider_calls.insert(call_id.into());
    turn.bytes = Some(disk_bytes(&history));
    prune(dir, &mut journal, HISTORY_BYTES)?;
    save(dir, &journal)
}

fn add_path_excluded(root: &Path, path: &str) -> bool {
    match has_git_marker(root) {
        Ok(true) => {
            let result = git_cmd_output(git_cmd().current_dir(root).args([
                "check-ignore",
                "--no-index",
                "--quiet",
                "--",
                path,
            ]));
            // Exit 1 is Git's explicit nonignored classification. Failed reads
            // and other exit codes are unknown, never evidence of absence.
            !result.is_ok_and(|output| output.status.code() == Some(1))
        }
        Ok(false) => path
            .split('/')
            .any(|part| matches!(part, "node_modules" | "target")),
        Err(_) => true,
    }
}

/// Reverse only verified unified hunks. Unchanged lines come from the current
/// file, retaining peer changes outside the provider's edit. No paths in a diff
/// header are interpreted and no Git index or working-copy file is touched.
fn reverse_provider_diff(after: &str, diff: &str) -> Result<String, String> {
    let source: Vec<&str> = after.split_inclusive('\n').collect();
    let lines: Vec<&str> = diff.split_inclusive('\n').collect();
    let mut index = lines
        .iter()
        .position(|line| line.starts_with("@@ "))
        .ok_or("Missing unified hunks")?;
    let mut cursor = 0;
    let mut old_cursor = 0;
    let mut old_line_open = false;
    let mut before = String::new();
    while index < lines.len() {
        let header: Vec<_> = lines[index].split_whitespace().collect();
        if header.len() < 4 || header[0] != "@@" || header[3] != "@@" {
            return Err("Invalid hunk".into());
        }
        let range = |value: &str, prefix: char| -> Result<(usize, usize), String> {
            let value = value.strip_prefix(prefix).ok_or("Invalid hunk range")?;
            let (start, count) = value.split_once(',').unwrap_or((value, "1"));
            Ok((
                start.parse().map_err(|_| "Invalid hunk start")?,
                count.parse().map_err(|_| "Invalid hunk count")?,
            ))
        };
        let (old_start, expected_old) = range(header[1], '-')?;
        let (new_start, expected_new) = range(header[2], '+')?;
        let start = if expected_new == 0 {
            new_start
        } else {
            new_start.checked_sub(1).ok_or("Invalid hunk offset")?
        };
        if start < cursor || start > source.len() {
            return Err("Hunk is outside current contents".into());
        }
        let unchanged = &source[cursor..start];
        if old_line_open && !unchanged.is_empty() {
            return Err("Invalid missing newline before unchanged lines".into());
        }
        before.extend(unchanged.iter().copied());
        if let Some(last) = unchanged.last() {
            old_line_open = !last.ends_with('\n');
        }
        old_cursor += start - cursor;
        let old_offset = if expected_old == 0 {
            old_start
        } else {
            old_start.checked_sub(1).ok_or("Invalid old hunk offset")?
        };
        if old_offset != old_cursor {
            return Err("Old hunk location does not match contents".into());
        }
        cursor = start;
        index += 1;
        let mut old = 0;
        let mut new = 0;
        while index < lines.len() && !lines[index].starts_with("@@ ") {
            let line = lines[index].strip_suffix('\n').unwrap_or(lines[index]);
            let operation = *line.as_bytes().first().ok_or("Invalid hunk line")?;
            if !matches!(operation, b' ' | b'+' | b'-') {
                return Err("Unsupported hunk line".into());
            }
            let mut content = format!("{}\n", &line[1..]);
            index += 1;
            if index < lines.len() && lines[index].starts_with("\\ No newline at end of file") {
                content.pop();
                index += 1;
            }
            if operation != b'-' {
                if source.get(cursor).copied() != Some(content.as_str()) {
                    return Err("Provider changed lines no longer match".into());
                }
                cursor += 1;
                new += 1;
            }
            if operation != b'+' {
                if old_line_open {
                    return Err("Invalid missing newline inside old contents".into());
                }
                before.push_str(&content);
                old_line_open = !content.ends_with('\n');
                old += 1;
            }
        }
        if old != expected_old || new != expected_new {
            return Err("Incomplete unified hunk".into());
        }
        old_cursor += old;
    }
    if old_line_open && cursor < source.len() {
        return Err("Invalid missing newline before trailing contents".into());
    }
    before.extend(source[cursor..].iter().copied());
    Ok(before)
}

struct Candidate {
    path: String,
    before: FileState,
    after: FileState,
    mode: Option<u32>,
    after_mode: Option<u32>,
    conflict: bool,
}

fn candidates(dir: &Path, message: &str) -> Result<(PathBuf, Vec<Candidate>), String> {
    let journal = load(dir)?.ok_or(UNAVAILABLE)?;
    let start = journal
        .turns
        .iter()
        .position(|t| t.user_block_id == message)
        .ok_or(UNAVAILABLE)?;
    let root = std::fs::canonicalize(&journal.cwd).map_err(|e| e.to_string())?;
    let mut files: BTreeMap<String, Candidate> = BTreeMap::new();
    for turn in &journal.turns[start..] {
        if turn.active {
            return Err("A turn is still recording file history.".into());
        }
        if let Some(reason) = &turn.unavailable {
            return Err(reason.clone());
        }
        let history_dir = turn_dir(dir, &turn.id)?;
        for (path, pair) in &turn.files {
            let Some(after_kind) = pair.after else {
                continue;
            };
            let before = read_snapshot_at(&history_dir.join("before"), path, pair.before);
            let after = read_snapshot_at(&history_dir.join("after"), path, after_kind);
            if before == FileState::Skipped || after == FileState::Skipped {
                return Err(UNAVAILABLE.into());
            }
            let mode = snapshot_mode(&history_dir.join("before"), path, pair.before);
            let after_mode = snapshot_mode(&history_dir.join("after"), path, after_kind);
            if before == after && mode == after_mode {
                continue;
            }
            match files.get_mut(path) {
                Some(file) => {
                    file.conflict |= pair.conflict || file.after != before;
                    file.conflict |= file.after_mode != mode;
                    file.after = after;
                    file.after_mode = after_mode;
                }
                None => {
                    files.insert(
                        path.clone(),
                        Candidate {
                            path: path.clone(),
                            before,
                            after,
                            mode,
                            after_mode,
                            conflict: pair.conflict,
                        },
                    );
                }
            }
        }
    }
    Ok((root, files.into_values().collect()))
}

fn conflict(root: &Path, file: &Candidate) -> Option<String> {
    if safe_relative(root, &file.path).is_err() || path_contains_symlink(root, &file.path) {
        Some("The path is outside this checkout or contains a symbolic link.".into())
    } else if file.conflict
        || read_worktree(root, &file.path) != file.after
        || file_mode(&root.join(&file.path)) != file.after_mode
    {
        Some(FOREIGN.into())
    } else {
        None
    }
}

/// Move current bytes aside before comparing them. Publishing by hard-link is exclusive:
/// a writer that creates a new destination during the operation always wins.
fn apply_file(root: &Path, file: &Candidate) -> Result<(), String> {
    use std::io::Write;
    let path = root.join(&file.path);
    let parent = path.parent().ok_or("Invalid file path")?;
    // Windows sharing is mandatory even for uncooperative writers: deny new writes
    // through the old file handle, and deny renaming any existing parent directory.
    #[cfg(windows)]
    let mut _parents = guard_parent_directories(root, &file.path)?;
    #[cfg(windows)]
    let _original = if file.after != FileState::Missing {
        Some(guard_file(&path)?)
    } else {
        None
    };
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    _parents.extend(guard_parent_directories(root, &file.path)?);
    if let Some(reason) = conflict(root, file) {
        return Err(reason);
    }
    let tag = uuid::Uuid::new_v4();
    let staged = parent.join(format!(".bycoda-revert-{tag}.tmp"));
    let rescue = parent.join(format!(".bycoda-revert-{tag}.rescue"));
    if let FileState::Contents(bytes) = &file.before {
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .map_err(|e| e.to_string())?;
        output.write_all(bytes).map_err(|e| e.to_string())?;
        set_file_mode(&staged, file.mode)?;
    }
    let mut held = false;
    #[cfg(windows)]
    let mut _held_guard = None;
    let result = (|| {
        if let Some(reason) = conflict(root, file) {
            return Err(reason);
        }
        if file.after != FileState::Missing {
            std::fs::rename(&path, &rescue).map_err(|e| e.to_string())?;
            held = true;
            #[cfg(windows)]
            {
                _held_guard = Some(guard_file(&rescue)?);
            }
            let held_state = match std::fs::symlink_metadata(&rescue) {
                Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {
                    std::fs::read(&rescue)
                        .map(FileState::Contents)
                        .map_err(|e| e.to_string())?
                }
                _ => return Err(FOREIGN.into()),
            };
            if held_state != file.after {
                return Err(FOREIGN.into());
            }
        }
        if path_contains_symlink(root, &file.path) {
            return Err("The destination path changed during revert.".into());
        }
        if matches!(file.before, FileState::Contents(_)) {
            std::fs::hard_link(&staged, &path)
                .map_err(|e| format!("The destination changed during revert: {e}"))?;
        } else if path.exists() {
            return Err("The destination changed during revert.".into());
        }
        if held {
            std::fs::remove_file(&rescue).map_err(|e| e.to_string())?;
            held = false;
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(staged);
    if held {
        if std::fs::hard_link(&rescue, &path).is_ok() {
            let _ = std::fs::remove_file(&rescue);
        } else {
            return Err(format!(
                "The destination changed during revert; previous content is preserved at {}",
                rescue.display()
            ));
        }
    }
    result
}

#[cfg(windows)]
fn guard_file(path: &Path) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
        .map_err(|e| format!("The file is busy or changed during revert: {e}"))
}

#[cfg(windows)]
fn guard_parent_directories(root: &Path, relative: &str) -> Result<Vec<std::fs::File>, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let mut guards = Vec::new();
    let mut current = root.to_path_buf();
    let parent = Path::new(relative).parent().ok_or("Invalid file path")?;
    for part in std::iter::once(None).chain(parent.components().map(Some)) {
        if let Some(part) = part {
            current.push(part);
        }
        let handle = match std::fs::OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&current)
        {
            Ok(handle) => handle,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(format!("A parent directory is busy or changed: {e}")),
        };
        if handle
            .metadata()
            .map_err(|e| e.to_string())?
            .file_attributes()
            & FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err("A parent directory is a junction or symbolic link.".into());
        }
        guards.push(handle);
    }
    Ok(guards)
}

impl CheckpointStore {
    /// Call only after the conversation rewind has persisted, including keep-files rewinds.
    /// Removing the obsolete suffix prevents later turns from inheriting abandoned history.
    pub(crate) fn forget_files_from_message(
        &self,
        session: &str,
        message: &str,
    ) -> Result<(), String> {
        validate_id(session, "session")?;
        self.exclusive(session, &[], |store| {
            let dir = store.session_dir(session);
            let Some(mut journal) = load(&dir)? else {
                return Ok(());
            };
            let Some(start) = journal
                .turns
                .iter()
                .position(|t| t.user_block_id == message)
            else {
                return Ok(());
            };
            if journal.turns[start..].iter().any(|t| t.active) {
                return Err("A turn is still recording file history.".into());
            }
            let removed: Vec<_> = journal.turns.drain(start..).map(|turn| turn.id).collect();
            save(&dir, &journal)?;
            for id in removed {
                let path = turn_dir(&dir, &id)?;
                if path.exists() {
                    std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
    }

    fn files_revert_plan(&self, session: &str, message: &str) -> Result<RevertPlan, String> {
        validate_id(session, "session")?;
        let (root, candidates) = match candidates(&self.session_dir(session), message) {
            Ok(result) => result,
            Err(reason) => {
                return Ok(RevertPlan {
                    files: Vec::new(),
                    unavailable: Some(reason),
                })
            }
        };
        Ok(RevertPlan {
            unavailable: None,
            files: candidates
                .into_iter()
                .map(|file| RevertFile {
                    path: file.path.clone(),
                    action: if file.before == FileState::Missing {
                        "delete"
                    } else {
                        "restore"
                    },
                    conflict: conflict(&root, &file),
                })
                .collect(),
        })
    }

    fn files_revert(&self, session: &str, message: &str) -> Result<RevertResult, String> {
        validate_id(session, "session")?;
        let (root, candidates) = candidates(&self.session_dir(session), message)?;
        let mut result = RevertResult::default();
        let mut restored = BTreeMap::new();
        for file in candidates {
            let apply = || -> Result<(), String> {
                if let Some(reason) = conflict(&root, &file) {
                    return Err(reason);
                }
                apply_file(&root, &file)
            };
            match apply() {
                Ok(()) => {
                    restored.insert(file.path.clone(), (file.before, file.mode));
                    result.reverted.push(file.path);
                }
                Err(reason) => result.skipped.push(SkippedFile {
                    path: file.path,
                    reason,
                }),
            }
        }
        refresh_reverted_review(&self.session_dir(session), &restored)?;
        Ok(result)
    }
}

fn current_checkout(conn: &rusqlite::Connection, session: &str) -> Result<String, String> {
    use rusqlite::OptionalExtension;
    let (cwd, removed): (String, bool) = conn.query_row(
        "SELECT COALESCE(NULLIF(worktree_cwd,''),cwd),worktree_removed FROM sessions WHERE id=?1",
        [session], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|e| e.to_string())?.ok_or("Session not found")?;
    if removed {
        return Err("This session's checkout has been removed.".into());
    }
    Ok(cwd)
}

fn assert_checkout(dir: &Path, cwd: &str) -> Result<(), String> {
    if load(dir)?.is_some_and(|j| !same_cwd(&j.cwd, cwd)) {
        return Err("The session now uses a different checkout than its file history.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn session_checkpoint_file_changes(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    call_id: String,
    changes: Vec<ProviderFileChange>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(&cwd)?;
        store.exclusive(&session_id, &[&cwd], |store| {
            capture_provider_changes(&store.session_dir(&session_id), &root, &call_id, &changes)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_files_forget_from_message(
    store: State<'_, CheckpointStore>,
    session_id: String,
    user_block_id: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.forget_files_from_message(&session_id, &user_block_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_files_revert_plan(
    app: AppHandle,
    store: State<'_, CheckpointStore>,
    session_id: String,
    user_block_id: String,
) -> Result<RevertPlan, String> {
    validate_id(&session_id, "session")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = app.state::<crate::session_store::SessionStore>();
        let conn = sessions.lock_conn()?;
        let cwd = match current_checkout(&conn, &session_id).and_then(|cwd| {
            assert_checkout(&store.session_dir(&session_id), &cwd)?;
            Ok(cwd)
        }) {
            Ok(cwd) => cwd,
            Err(reason) => {
                return Ok(RevertPlan {
                    files: Vec::new(),
                    unavailable: Some(reason),
                })
            }
        };
        store.exclusive(&session_id, &[&cwd], |s| {
            s.files_revert_plan(&session_id, &user_block_id)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_files_revert(
    app: AppHandle,
    store: State<'_, CheckpointStore>,
    session_id: String,
    user_block_id: String,
    plan_token: Option<String>,
) -> Result<RevertResult, String> {
    validate_id(&session_id, "session")?;
    let _ = plan_token; // Plans are advisory; every content/path check is repeated during apply.
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = app.state::<crate::session_store::SessionStore>();
        let conn = sessions.lock_conn()?;
        let cwd = current_checkout(&conn, &session_id)?;
        assert_checkout(&store.session_dir(&session_id), &cwd)?;
        store.exclusive(&session_id, &[&cwd], |s| {
            s.files_revert(&session_id, &user_block_id)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        dir: PathBuf,
        repo: PathBuf,
        store: CheckpointStore,
    }
    impl Fixture {
        fn new(git: bool) -> Self {
            let dir =
                std::env::temp_dir().join(format!("bycoda-file-revert-{}", uuid::Uuid::new_v4()));
            let repo = dir.join("repo");
            std::fs::create_dir_all(&repo).unwrap();
            std::fs::write(repo.join("a.txt"), "base\n").unwrap();
            if git {
                git_checked(&repo, &["init"]).unwrap();
                git_checked(&repo, &["config", "user.email", "fixture@example.invalid"]).unwrap();
                git_checked(&repo, &["config", "user.name", "Fixture"]).unwrap();
                git_checked(&repo, &["add", "."]).unwrap();
                git_checked(&repo, &["commit", "-m", "base"]).unwrap();
            }
            let store = CheckpointStore::new(dir.join("checkpoints"));
            Self { dir, repo, store }
        }
        fn cwd(&self) -> String {
            self.repo.to_string_lossy().into_owned()
        }
        fn begin(&self, session: &str, turn: &str) {
            self.store
                .begin_checkpoint_turn(
                    session,
                    &self.cwd(),
                    turn,
                    &format!("message-{turn}"),
                    false,
                )
                .unwrap();
        }
        fn finish(&self, session: &str, turn: &str) {
            self.store
                .finish_files_turn(session, &self.cwd(), turn, false)
                .unwrap();
        }
        fn write(&self, path: &str, content: &str) {
            std::fs::write(self.repo.join(path), content).unwrap();
        }
        fn read(&self, path: &str) -> String {
            std::fs::read_to_string(self.repo.join(path)).unwrap()
        }
        fn attributed(&self, session: &str, path: &str, contents: &str) {
            let dir = self.store.session_dir(session);
            prepare(&dir, &self.repo, &[path.into()]).unwrap();
            self.write(path, contents);
            capture(&dir, &self.repo, &[path.into()]).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn checkpoint_files_revert_codex_late_delete_add_notifications_keep_each_message_boundary() {
        let f = Fixture::new(true);
        let dir = f.store.session_dir("session");
        for (turn, before, after) in [("one", "base\n", "one\n"), ("two", "one\n", "two\n")] {
            f.begin("session", turn);
            // Real Codex fileChange starts/completions can reach the renderer
            // only after both DeleteFile and AddFile already changed the disk.
            std::fs::remove_file(f.repo.join("a.txt")).unwrap();
            f.write("a.txt", after);
            let deletion = ProviderFileChange {
                path: "a.txt".into(),
                kind: "delete".into(),
                contents: before.into(),
            };
            capture_provider_changes(&dir, &f.repo, &format!("{turn}-delete"), &[deletion])
                .unwrap();
            let addition = ProviderFileChange {
                path: "a.txt".into(),
                kind: "add".into(),
                contents: after.into(),
            };
            capture_provider_changes(&dir, &f.repo, &format!("{turn}-add"), &[addition]).unwrap();
            f.finish("session", turn);
        }
        let plan = f.store.files_revert_plan("session", "message-two").unwrap();
        assert!(plan.unavailable.is_none());
        assert_eq!(plan.files[0].action, "restore");
        assert!(plan.files[0].conflict.is_none());
        assert_eq!(
            f.store
                .files_revert("session", "message-two")
                .unwrap()
                .reverted,
            ["a.txt"]
        );
        assert_eq!(f.read("a.txt"), "one\n");
    }

    #[test]
    fn checkpoint_files_revert_provider_proofs_preserve_peer_before_and_after_edits() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        let dir = f.store.session_dir("session");
        // The provider deleted peer contents, not the older turn-start baseline.
        f.write("a.txt", "own after peer\n");
        capture_provider_changes(
            &dir,
            &f.repo,
            "delete",
            &[ProviderFileChange {
                path: "a.txt".into(),
                kind: "delete".into(),
                contents: "peer before tool\n".into(),
            }],
        )
        .unwrap();
        capture_provider_changes(
            &dir,
            &f.repo,
            "add",
            &[ProviderFileChange {
                path: "a.txt".into(),
                kind: "add".into(),
                contents: "own after peer\n".into(),
            }],
        )
        .unwrap();
        // A duplicated notification cannot reset the before state or its chain.
        capture_provider_changes(
            &dir,
            &f.repo,
            "delete",
            &[ProviderFileChange {
                path: "a.txt".into(),
                kind: "delete".into(),
                contents: "peer before tool\n".into(),
            }],
        )
        .unwrap();
        f.finish("session", "one");
        assert!(f
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .files[0]
            .conflict
            .is_none());
        f.write("a.txt", "peer after tool\n");
        assert_eq!(
            f.store
                .files_revert("session", "message-one")
                .unwrap()
                .skipped[0]
                .reason,
            FOREIGN
        );
        f.write("a.txt", "own after peer\n");
        assert_eq!(
            f.store
                .files_revert("session", "message-one")
                .unwrap()
                .reverted,
            ["a.txt"]
        );
        assert_eq!(f.read("a.txt"), "peer before tool\n");
    }

    #[test]
    fn checkpoint_files_revert_provider_update_preserves_outside_hunk_peer_bytes() {
        let f = Fixture::new(false);
        f.write("a.txt", "old owner\nold\n");
        f.begin("session", "one");
        f.write("a.txt", "peer outside hunk\nnew\n");
        let dir = f.store.session_dir("session");
        capture_provider_changes(
            &dir,
            &f.repo,
            "update",
            &[ProviderFileChange {
                path: "a.txt".into(),
                kind: "update".into(),
                contents: "@@ -2 +2 @@\n-old\n+new\n".into(),
            }],
        )
        .unwrap();
        f.finish("session", "one");
        assert_eq!(
            f.store
                .files_revert("session", "message-one")
                .unwrap()
                .reverted,
            ["a.txt"]
        );
        assert_eq!(f.read("a.txt"), "peer outside hunk\nold\n");
    }

    #[test]
    fn checkpoint_files_revert_provider_add_over_existing_or_ignored_path_stays_conflicted() {
        for (ignored, peer_before) in [(false, false), (false, true), (true, true)] {
            let f = Fixture::new(true);
            f.write("counter.txt", "zero\n");
            let path = if ignored { "ignored.txt" } else { "a.txt" };
            if ignored {
                f.write(".gitignore", "ignored.txt\n");
                f.write(path, "ignored original\n");
            }
            f.begin("session", "one");
            if peer_before {
                f.write(path, "peer before AddFile\n");
            }
            f.write(path, "provider overwrote existing contents\n");
            f.write("counter.txt", "one\n");
            f.write("new.txt", "genuinely new\n");
            let dir = f.store.session_dir("session");
            capture_provider_changes(
                &dir,
                &f.repo,
                "add-overwrite",
                &[ProviderFileChange {
                    path: path.into(),
                    kind: "add".into(),
                    contents: "provider overwrote existing contents\n".into(),
                }],
            )
            .unwrap();
            capture_provider_changes(
                &dir,
                &f.repo,
                "counter-update",
                &[ProviderFileChange {
                    path: "counter.txt".into(),
                    kind: "update".into(),
                    contents: "@@ -1 +1 @@\n-zero\n+one\n".into(),
                }],
            )
            .unwrap();
            capture_provider_changes(
                &dir,
                &f.repo,
                "new-add",
                &[ProviderFileChange {
                    path: "new.txt".into(),
                    kind: "add".into(),
                    contents: "genuinely new\n".into(),
                }],
            )
            .unwrap();
            f.finish("session", "one");
            let plan = f.store.files_revert_plan("session", "message-one").unwrap();
            assert!(plan.unavailable.is_none());
            assert!(plan
                .files
                .iter()
                .find(|file| file.path == path)
                .unwrap()
                .conflict
                .is_some());
            let result = f.store.files_revert("session", "message-one").unwrap();
            assert_eq!(result.reverted, ["counter.txt", "new.txt"]);
            assert_eq!(result.skipped[0].path, path);
            assert_eq!(f.read(path), "provider overwrote existing contents\n");
            assert_eq!(f.read("counter.txt"), "zero\n");
            assert!(!f.repo.join("new.txt").exists());
        }
    }

    #[test]
    fn checkpoint_files_revert_provider_chain_mismatch_remains_conflicted() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        let dir = f.store.session_dir("session");
        for (call, kind, contents) in [
            ("delete-base", "delete", "base\n"),
            ("add-own", "add", "own first\n"),
            ("delete-peer", "delete", "peer between tools\n"),
            ("add-last", "add", "own last\n"),
        ] {
            capture_provider_changes(
                &dir,
                &f.repo,
                call,
                &[ProviderFileChange {
                    path: "a.txt".into(),
                    kind: kind.into(),
                    contents: contents.into(),
                }],
            )
            .unwrap();
        }
        f.write("a.txt", "own last\n");
        f.finish("session", "one");
        assert!(f
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .files[0]
            .conflict
            .is_some());
        assert!(f
            .store
            .files_revert("session", "message-one")
            .unwrap()
            .reverted
            .is_empty());
        assert_eq!(f.read("a.txt"), "own last\n");
    }

    #[test]
    fn checkpoint_files_revert_provider_invalid_updates_fail_closed() {
        assert!(reverse_provider_diff(
            "new\n",
            "@@ -1,2 +1 @@\n-old\n\\ No newline at end of file\n-more\n+new\n"
        )
        .is_err());
        let unsupported = Fixture::new(false);
        unsupported.begin("session", "one");
        unsupported.write("a.txt", "unsupported provider edit\n");
        capture_provider_changes(
            &unsupported.store.session_dir("session"),
            &unsupported.repo,
            "unknown-kind",
            &[],
        )
        .unwrap();
        unsupported.finish("session", "one");
        assert!(unsupported
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .unavailable
            .is_some());
        for diff in ["@@ -1 +1 @@\n-old\n+new\n", "not a unified diff"] {
            let f = Fixture::new(false);
            f.begin("session", "one");
            f.write("a.txt", "peer changed the edited hunk\n");
            capture_provider_changes(
                &f.store.session_dir("session"),
                &f.repo,
                "update",
                &[ProviderFileChange {
                    path: "a.txt".into(),
                    kind: "update".into(),
                    contents: diff.into(),
                }],
            )
            .unwrap();
            f.finish("session", "one");
            assert!(f
                .store
                .files_revert_plan("session", "message-one")
                .unwrap()
                .unavailable
                .is_some());
            assert!(f.store.files_revert("session", "message-one").is_err());
            assert_eq!(f.read("a.txt"), "peer changed the edited hunk\n");
        }
        assert_eq!(reverse_provider_diff("new", "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n").unwrap(), "old");
        assert_eq!(
            reverse_provider_diff("a\nnew\nz\n", "@@ -1,0 +2 @@\n+new\n").unwrap(),
            "a\nz\n"
        );
    }

    #[test]
    fn checkpoint_files_revert_multiple_shell_turns_restores_second_message_boundary() {
        let f = Fixture::new(true);
        f.begin("session", "one");
        f.write("a.txt", "one\n");
        f.finish("session", "one");
        f.begin("session", "two");
        f.write("a.txt", "two\n");
        f.write("new.txt", "new\n");
        f.finish("session", "two");
        f.begin("session", "three");
        f.write("a.txt", "three\n");
        f.finish("session", "three");
        let plan = f.store.files_revert_plan("session", "message-two").unwrap();
        assert!(plan.unavailable.is_none(), "{plan:?}");
        assert_eq!(plan.files.len(), 2);
        assert_eq!(plan.files[1].action, "delete");
        let result = f.store.files_revert("session", "message-two").unwrap();
        assert_eq!(result.reverted, ["a.txt", "new.txt"]);
        assert!(result.skipped.is_empty());
        assert_eq!(f.read("a.txt"), "one\n");
        assert!(!f.repo.join("new.txt").exists());
        assert!(
            git_output(&f.repo, &["for-each-ref", "refs/bycoda/checkpoints/"])
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn checkpoint_files_revert_rechecks_drift_after_plan_and_preserves_foreign_edits() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.attributed("session", "a.txt", "owned\n");
        f.finish("session", "one");
        assert!(f
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .files[0]
            .conflict
            .is_none());
        f.write("a.txt", "someone else\n");
        let result = f.store.files_revert("session", "message-one").unwrap();
        assert!(result.reverted.is_empty());
        assert_eq!(result.skipped[0].reason, FOREIGN);
        assert_eq!(f.read("a.txt"), "someone else\n");
    }

    #[test]
    fn checkpoint_files_revert_overlap_only_retains_attributed_files() {
        let f = Fixture::new(true);
        f.begin("one", "one");
        f.begin("two", "two");
        f.attributed("one", "a.txt", "mine\n");
        f.write("other.txt", "foreign shell\n");
        f.finish("one", "one");
        f.finish("two", "two");
        let result = f.store.files_revert("one", "message-one").unwrap();
        assert_eq!(result.reverted, ["a.txt"]);
        assert_eq!(f.read("other.txt"), "foreign shell\n");
    }

    #[test]
    fn checkpoint_files_revert_repeated_attributed_file_keeps_each_turn_baseline() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.attributed("session", "a.txt", "one\n");
        f.finish("session", "one");
        f.begin("session", "two");
        f.attributed("session", "a.txt", "two\n");
        f.attributed("session", "a.txt", "two again\n");
        f.finish("session", "two");
        assert_eq!(
            f.store
                .files_revert("session", "message-two")
                .unwrap()
                .reverted,
            ["a.txt"]
        );
        assert_eq!(f.read("a.txt"), "one\n");
    }

    #[test]
    fn checkpoint_files_revert_pruned_or_older_history_is_unavailable() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.write("a.txt", "one\n");
        f.finish("session", "one");
        f.begin("session", "two");
        f.write("a.txt", "two\n");
        f.finish("session", "two");
        let dir = f.store.session_dir("session");
        let mut journal = load(&dir).unwrap().unwrap();
        let last_size = disk_bytes(&turn_dir(&dir, "two").unwrap());
        prune(&dir, &mut journal, last_size).unwrap();
        save(&dir, &journal).unwrap();
        assert!(f
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .unavailable
            .is_some());
        assert!(f
            .store
            .files_revert_plan("session", "message-two")
            .unwrap()
            .unavailable
            .is_none());
        assert!(f
            .store
            .files_revert_plan("session", "older")
            .unwrap()
            .unavailable
            .is_some());
    }

    #[test]
    fn checkpoint_files_revert_pruning_removes_zero_byte_snapshot_entries() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.write("empty.txt", "");
        f.finish("session", "one");
        f.begin("session", "two");
        f.write("a.txt", "two\n");
        f.finish("session", "two");
        let dir = f.store.session_dir("session");
        let old = turn_dir(&dir, "one").unwrap();
        assert_eq!(disk_bytes(&old), 0);
        assert!(old.exists());
        let mut journal = load(&dir).unwrap().unwrap();
        prune(&dir, &mut journal, 1).unwrap();
        assert!(!old.exists());
    }

    #[test]
    fn checkpoint_files_revert_light_review_refreshes_stale_flags_without_unlocking_old_files() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.store
            .prepare("session", &f.cwd(), &["a.txt".into()])
            .unwrap();
        f.write("a.txt", "unsafe old owned edit\n");
        f.store
            .capture("session", &f.cwd(), &["a.txt".into()])
            .unwrap();
        f.finish("session", "one");
        let dir = f.store.session_dir("session");
        let mut old: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("turn.json")).unwrap()).unwrap();
        old["shared"] = true.into();
        old["error"] = "old capture failed".into();
        old["head"] = "outdated-head".into();
        std::fs::write(dir.join("turn.json"), serde_json::to_vec(&old).unwrap()).unwrap();

        f.begin("session", "two");
        assert!(f
            .store
            .status("session", &f.cwd())
            .unwrap_err()
            .contains("still recording"));
        f.store
            .prepare("session", &f.cwd(), &["fresh.txt".into()])
            .unwrap();
        f.write("fresh.txt", "fresh owned edit\n");
        f.store
            .capture("session", &f.cwd(), &["fresh.txt".into()])
            .unwrap();
        f.finish("session", "two");
        let status = f.store.status("session", &f.cwd()).unwrap();
        assert_eq!(status.files.len(), 2);
        assert!(
            !status
                .files
                .iter()
                .find(|file| file.relative == "a.txt")
                .unwrap()
                .undoable
        );
        assert!(
            status
                .files
                .iter()
                .find(|file| file.relative == "fresh.txt")
                .unwrap()
                .undoable
        );
        f.store
            .undo("session", &f.cwd(), Some("fresh.txt"))
            .unwrap();
        assert!(!f.repo.join("fresh.txt").exists());
        assert_eq!(f.read("a.txt"), "unsafe old owned edit\n");
    }

    #[test]
    fn checkpoint_files_revert_light_shell_review_exists_and_keeps_original_aggregate_baseline() {
        let f = Fixture::new(false);
        assert!(read_manifest(&f.store.session_dir("session"))
            .unwrap()
            .is_none());
        f.begin("session", "one");
        f.write("a.txt", "one\n");
        f.finish("session", "one");
        assert!(f.store.status("session", &f.cwd()).unwrap().files[0].undoable);
        f.begin("session", "two");
        f.write("a.txt", "two\n");
        f.finish("session", "two");
        let diff = f.store.file_diff("session", &f.cwd(), "a.txt").unwrap();
        assert_eq!(diff.original, "base\n");
        assert_eq!(diff.current, "two\n");
        f.store.files_revert("session", "message-two").unwrap();
        let diff = f.store.file_diff("session", &f.cwd(), "a.txt").unwrap();
        assert_eq!(diff.original, "base\n");
        assert_eq!(diff.current, "one\n");
        assert!(f.store.status("session", &f.cwd()).unwrap().files[0].undoable);
        f.store.undo("session", &f.cwd(), Some("a.txt")).unwrap();
        assert_eq!(f.read("a.txt"), "base\n");
    }

    #[test]
    fn checkpoint_files_revert_light_review_preserves_diverged_path_guards() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.store
            .prepare("session", &f.cwd(), &["a.txt".into()])
            .unwrap();
        f.write("a.txt", "one\n");
        f.store
            .capture("session", &f.cwd(), &["a.txt".into()])
            .unwrap();
        f.finish("session", "one");
        f.write("a.txt", "foreign between turns\n");
        f.begin("session", "two");
        f.store
            .prepare("session", &f.cwd(), &["a.txt".into(), "fresh.txt".into()])
            .unwrap();
        f.write("a.txt", "two\n");
        f.write("fresh.txt", "fresh\n");
        f.store
            .capture("session", &f.cwd(), &["a.txt".into(), "fresh.txt".into()])
            .unwrap();
        f.finish("session", "two");
        let status = f.store.status("session", &f.cwd()).unwrap();
        let old = status
            .files
            .iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(!old.exact);
        assert!(!old.undoable);
        assert!(
            status
                .files
                .iter()
                .find(|file| file.relative == "fresh.txt")
                .unwrap()
                .undoable
        );
    }

    #[test]
    fn checkpoint_files_revert_experimental_begin_still_captures_a_git_tree() {
        let f = Fixture::new(true);
        f.store
            .begin_checkpoint_turn("session", &f.cwd(), "one", "message-one", true)
            .unwrap();
        let dir = f.store.session_dir("session");
        let turn: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("turn.json")).unwrap()).unwrap();
        assert!(turn["before"].as_str().is_some_and(|tree| !tree.is_empty()));
        f.write("a.txt", "one\n");
        f.store
            .finish_checkpoint_turn("session", &f.cwd(), "one", false)
            .unwrap();
        assert!(f.store.status("session", &f.cwd()).unwrap().files[0].undoable);
        assert!(f
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .unavailable
            .is_none());
    }

    #[test]
    fn checkpoint_files_revert_forgets_only_the_successfully_rewound_suffix() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.write("a.txt", "one\n");
        f.finish("session", "one");
        f.begin("session", "two");
        f.write("a.txt", "two\n");
        f.finish("session", "two");
        f.store
            .forget_files_from_message("session", "message-two")
            .unwrap();
        let journal = load(&f.store.session_dir("session")).unwrap().unwrap();
        assert_eq!(journal.turns.len(), 1);
        assert_eq!(journal.turns[0].id, "one");
        assert_eq!(f.read("a.txt"), "two\n"); // Keep-files rewind leaves content alone.
        assert!(!turn_dir(&f.store.session_dir("session"), "two")
            .unwrap()
            .exists());
        f.begin("session", "three");
        f.write("a.txt", "three\n");
        f.finish("session", "three");
        assert_eq!(
            f.store
                .files_revert("session", "message-three")
                .unwrap()
                .reverted,
            ["a.txt"]
        );
        assert_eq!(f.read("a.txt"), "two\n");
    }

    #[test]
    fn checkpoint_files_revert_requires_the_current_persisted_session_checkout() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.finish("session", "one");
        let sessions = crate::session_store::SessionStore::open_in_memory().unwrap();
        let conn = sessions.lock_conn().unwrap();
        conn.execute("INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,created_at,updated_at) VALUES (?1,?2,'test','test','test','test',1,1)", rusqlite::params!["session", f.cwd()]).unwrap();
        assert!(assert_checkout(
            &f.store.session_dir("session"),
            &current_checkout(&conn, "session").unwrap()
        )
        .is_ok());
        let other = f.dir.join("other");
        std::fs::create_dir(&other).unwrap();
        conn.execute(
            "UPDATE sessions SET worktree_cwd=?1 WHERE id='session'",
            [other.to_string_lossy().as_ref()],
        )
        .unwrap();
        assert!(assert_checkout(
            &f.store.session_dir("session"),
            &current_checkout(&conn, "session").unwrap()
        )
        .is_err());
        conn.execute(
            "UPDATE sessions SET worktree_removed=1 WHERE id='session'",
            [],
        )
        .unwrap();
        assert!(current_checkout(&conn, "session").is_err());
        assert!(current_checkout(&conn, "missing").is_err());
    }

    #[test]
    fn checkpoint_files_revert_worktree_keeps_commits_and_index() {
        let mut f = Fixture::new(true);
        let worktree = f.dir.join("worktree");
        git_checked(
            &f.repo,
            &[
                "worktree",
                "add",
                "-b",
                "session",
                &worktree.to_string_lossy(),
            ],
        )
        .unwrap();
        f.repo = worktree;
        f.begin("session", "one");
        f.write("a.txt", "committed session edit\n");
        git_checked(&f.repo, &["add", "a.txt"]).unwrap();
        git_checked(&f.repo, &["commit", "-m", "session edit"]).unwrap();
        f.finish("session", "one");
        let head = git_output(&f.repo, &["rev-parse", "HEAD"]).unwrap();
        let index = git_output(&f.repo, &["ls-files", "--stage"]).unwrap();
        let result = f.store.files_revert("session", "message-one").unwrap();
        assert_eq!(result.reverted, ["a.txt"]);
        assert_eq!(f.read("a.txt"), "base\n");
        assert_eq!(head, git_output(&f.repo, &["rev-parse", "HEAD"]).unwrap());
        assert_eq!(
            index,
            git_output(&f.repo, &["ls-files", "--stage"]).unwrap()
        );
        assert!(!git_output(&f.repo, &["diff", "--name-only"])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn checkpoint_files_revert_foreign_change_between_owned_turns_is_conflict() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.attributed("session", "a.txt", "one\n");
        f.finish("session", "one");
        f.write("a.txt", "foreign intervening edit\n");
        f.begin("session", "two");
        f.attributed("session", "a.txt", "two\n");
        f.finish("session", "two");
        assert!(f
            .store
            .files_revert_plan("session", "message-one")
            .unwrap()
            .files[0]
            .conflict
            .is_some());
        assert!(f
            .store
            .files_revert("session", "message-one")
            .unwrap()
            .reverted
            .is_empty());
        assert_eq!(f.read("a.txt"), "two\n");
    }

    #[test]
    fn checkpoint_files_revert_overlap_preserves_peer_content_before_our_tool() {
        let f = Fixture::new(false);
        f.begin("one", "one");
        f.begin("two", "two");
        f.attributed("two", "a.txt", "peer first\n");
        f.attributed("one", "a.txt", "mine after peer\n");
        f.finish("one", "one");
        f.finish("two", "two");
        let result = f.store.files_revert("one", "message-one").unwrap();
        assert_eq!(result.reverted, ["a.txt"]);
        assert_eq!(f.read("a.txt"), "peer first\n");
    }

    #[test]
    fn checkpoint_files_revert_does_not_adopt_unattributed_write_after_tool() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.attributed("session", "a.txt", "attributed\n");
        f.write("a.txt", "unattributed later write\n");
        f.finish("session", "one");
        let result = f.store.files_revert("session", "message-one").unwrap();
        assert!(result.reverted.is_empty());
        assert_eq!(result.skipped[0].reason, FOREIGN);
        assert_eq!(f.read("a.txt"), "unattributed later write\n");
    }

    #[test]
    fn checkpoint_files_revert_never_records_git_metadata_or_windows_aliases() {
        let f = Fixture::new(true);
        f.begin("session", "one");
        let dir = f.store.session_dir("session");
        prepare(&dir, &f.repo, &[".git/HEAD".into(), ".GiT/config".into()]).unwrap();
        assert!(load(&dir).unwrap().unwrap().turns[0].files.is_empty());
        #[cfg(windows)]
        for path in [".git./HEAD", ".git /HEAD", ".git:stream", "a.txt:stream"] {
            assert!(safe_relative(&f.repo, path).is_err(), "{path}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn checkpoint_files_revert_skips_an_existing_open_writer() {
        use std::io::Write;
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.write("a.txt", "own\n");
        f.finish("session", "one");
        let mut writer = std::fs::OpenOptions::new()
            .write(true)
            .open(f.repo.join("a.txt"))
            .unwrap();
        let result = f.store.files_revert("session", "message-one").unwrap();
        assert!(result.reverted.is_empty());
        assert!(result.skipped[0].reason.contains("busy"));
        writer.write_all(b"peer\n").unwrap();
        drop(writer);
        assert_eq!(f.read("a.txt"), "peer\n");
    }

    #[cfg(windows)]
    #[test]
    fn checkpoint_files_revert_guards_deny_parent_rename_and_new_writers() {
        let f = Fixture::new(false);
        let _parents = guard_parent_directories(&f.repo, "a.txt").unwrap();
        assert!(std::fs::rename(&f.repo, f.dir.join("moved")).is_err());
        let _file = guard_file(&f.repo.join("a.txt")).unwrap();
        assert!(std::fs::OpenOptions::new()
            .write(true)
            .open(f.repo.join("a.txt"))
            .is_err());
    }

    #[test]
    fn checkpoint_files_revert_never_follows_directory_links() {
        let f = Fixture::new(false);
        f.begin("session", "one");
        f.write("a.txt", "owned\n");
        f.finish("session", "one");
        let outside = f.dir.join("outside.txt");
        std::fs::rename(f.repo.join("a.txt"), &outside).unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, f.repo.join("a.txt"));
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, f.repo.join("a.txt"));
        if linked.is_err() {
            return;
        } // Windows may deny unprivileged symbolic links.
        let result = f.store.files_revert("session", "message-one").unwrap();
        assert!(result.reverted.is_empty());
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(std::fs::read_to_string(outside).unwrap(), "owned\n");
    }
}
