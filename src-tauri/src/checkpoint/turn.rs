//! Workspace boundaries complement structured-edit ownership, including shell edits.
use super::*;
use std::sync::{Condvar, PoisonError};
#[path = "leases.rs"]
mod leases;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Turn {
    id: String,
    cwd: String,
    before: Option<String>,
    head: Option<String>,
    active: bool,
    shared: bool,
    error: Option<String>,
    #[serde(default)]
    prepared_before: BTreeSet<String>,
    #[serde(default)]
    dirty_before: BTreeMap<String, SnapshotKind>,
    #[serde(default)]
    captured: BTreeSet<String>,
}

fn read_turn(dir: &Path) -> Result<Option<Turn>, String> {
    match std::fs::read(dir.join("turn.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
pub(super) fn has_recorded_turn(dir: &Path) -> Result<bool, String> {
    Ok(read_turn(dir)?.is_some())
}
fn save_turn(dir: &Path, turn: &Turn) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("turn.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(turn).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, dir.join("turn.json")).map_err(|e| e.to_string())
}
pub(super) fn record_structured_capture(dir: &Path, paths: &[String]) -> Result<(), String> {
    if let Some(mut turn) = read_turn(dir)?.filter(|t| t.active) {
        turn.captured.extend(paths.iter().cloned());
        save_turn(dir, &turn)?;
    }
    Ok(())
}
fn head(root: &Path) -> Option<String> {
    git_output(root, &["rev-parse", "--verify", "HEAD"])
        .map(|v| String::from_utf8_lossy(&v).trim().to_owned())
}
fn output(root: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut command = git_cmd();
    command.current_dir(root).args(args);
    command.env("GIT_LITERAL_PATHSPECS", "1");
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    let out = git_cmd_output(&mut command).map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(out.stdout)
}
fn tree(root: &Path, dir: &Path, id: &str, phase: &str) -> Result<String, String> {
    if git_output(root, &["config", "--bool", "core.sparseCheckout"])
        .is_some_and(|v| v.starts_with(b"true"))
    {
        return Err("Workspace checkpoints are unavailable for sparse checkouts".into());
    }
    let index = dir.join(format!("index-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let initial = if head(root).is_some() {
            "HEAD"
        } else {
            "--empty"
        };
        output(root, &["read-tree", initial], Some(&index))?;
        output(root, &["add", "-A", "--", "."], Some(&index))?;
        let tree = String::from_utf8(output(root, &["write-tree"], Some(&index))?)
            .map_err(|e| e.to_string())?
            .trim()
            .to_owned();
        // A namespaced tree reference protects snapshot blobs from Git GC. It
        // creates no commit and never touches the real staging index or HEAD.
        let session = dir
            .file_name()
            .ok_or("Invalid checkpoint directory")?
            .to_string_lossy();
        let reference = format!("refs/bycoda/checkpoints/{session}/{id}/{phase}");
        output(root, &["update-ref", &reference, &tree], None)?;
        Ok(tree)
    })();
    let _ = std::fs::remove_file(&index);
    let _ = std::fs::remove_file(index.with_extension("lock"));
    result
}
fn overlap(a: &str, b: &str) -> bool {
    let normalize = |s: &str| {
        let p = std::fs::canonicalize(s).unwrap_or_else(|_| PathBuf::from(s));
        let s = p.to_string_lossy().replace('\\', "/");
        let s = s
            .strip_prefix("//?/")
            .unwrap_or(&s)
            .trim_end_matches('/')
            .to_owned();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    let (a, b) = (normalize(a), normalize(b));
    a == b || a.starts_with(&(b.clone() + "/")) || b.starts_with(&(a + "/"))
}
/// Longest a command waits for startup recovery of an overlapping turn.
const RECOVERY_WAIT: std::time::Duration = std::time::Duration::from_secs(60);

/// Session/checkout pairs whose interrupted turn is still being settled by
/// startup recovery. Commands for those pairs wait before taking any gate, since
/// recovery itself needs the gates.
#[derive(Default)]
pub(super) struct RecoveryBarrier {
    pending: Mutex<Vec<(String, String)>>,
    settled: Condvar,
}

/// Holds one barrier entry. Dropping it releases waiters, including during a panic.
pub(super) struct RecoveryTicket {
    barrier: Arc<RecoveryBarrier>,
    session: String,
    cwd: String,
}

impl RecoveryBarrier {
    pub(super) fn register(self: &Arc<Self>, session: &str, cwd: &str) -> RecoveryTicket {
        self.lock().push((session.into(), cwd.into()));
        RecoveryTicket {
            barrier: self.clone(),
            session: session.into(),
            cwd: cwd.into(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<(String, String)>> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn wait(&self, session: &str, cwds: &[&str]) {
        self.wait_for(session, cwds, RECOVERY_WAIT);
    }

    pub(super) fn wait_for(&self, session: &str, cwds: &[&str], timeout: std::time::Duration) {
        let deadline = std::time::Instant::now() + timeout;
        let mut pending = self.lock();
        while blocks(&pending, session, cwds) {
            let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
                eprintln!(
                    "Checkpoint recovery for session {session} is still pending after {timeout:?}; continuing"
                );
                return;
            };
            pending = self
                .settled
                .wait_timeout(pending, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

fn blocks(pending: &[(String, String)], session: &str, cwds: &[&str]) -> bool {
    pending.iter().any(|(pending_session, pending_cwd)| {
        pending_session == session
            || cwds
                .iter()
                .any(|cwd| !cwd.is_empty() && overlap(cwd, pending_cwd))
    })
}

impl Drop for RecoveryTicket {
    fn drop(&mut self) {
        let mut pending = self.barrier.lock();
        if let Some(index) = pending
            .iter()
            .position(|(session, cwd)| *session == self.session && *cwd == self.cwd)
        {
            pending.remove(index);
        }
        drop(pending);
        self.barrier.settled.notify_all();
    }
}

/// Snapshot of the startup scan. Settling runs git, so it happens in `run`
/// on a background thread, never while the app is starting its UI.
pub(super) struct RecoveryPlan {
    store: CheckpointStore,
    active: Vec<(RecoveryTicket, String, Turn)>,
    settled: Vec<(String, Turn)>,
}

impl RecoveryPlan {
    pub(super) fn run(self) {
        for (ticket, session, turn) in self.active {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.store.exclusive(&session, &[&turn.cwd], |s| {
                    s.finish_turn(&session, &turn.cwd, &turn.id, true)
                })
            }));
            match outcome {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("Interrupted checkpoint could not settle: {error}"),
                Err(_) => {
                    eprintln!("Interrupted checkpoint recovery panicked for session {session}")
                }
            }
            // Released only after settlement, so a waiter never sees "still recording".
            drop(ticket);
        }
        for (session, turn) in self.settled {
            // A previous peer may have resurrected this exact settled
            // lease. Re-read under the session gate before retiring it.
            let _ = self.store.exclusive(&session, &[&turn.cwd], |s| {
                if let Some(current) = read_turn(&s.session_dir(&session))? {
                    if !current.active && current.id == turn.id && same_cwd(&current.cwd, &turn.cwd)
                    {
                        leases::release(&s.leases, &session, &turn.id)?;
                    }
                }
                Ok(())
            });
        }
    }
}

impl CheckpointStore {
    /// Retire accepted results in the existing manifest, without touching the
    /// working tree or the owner's index. A later edit must get a new baseline.
    pub(super) fn retire_resolved_paths(&self, session_id: &str, cwd: &str) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        let Some(turn) = read_turn(&dir)?.filter(|t| same_cwd(&t.cwd, cwd) && !t.active) else {
            return Ok(());
        };
        let Some(mut manifest) = self.load_matching(session_id, cwd)? else {
            return Ok(());
        };
        if manifest.touched.is_empty() {
            return Ok(());
        }
        let root = project_root(cwd)?;
        let Some(current_head) = head(&root).filter(|h| Some(h) != turn.head.as_ref()) else {
            return Ok(());
        };
        let prefix = output(&root, &["rev-parse", "--show-prefix"], None)?;
        let prefix = String::from_utf8(prefix).map_err(|e| e.to_string())?;
        let mut pending = BTreeSet::new();
        for args in [
            vec![
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--relative",
                "--name-only",
                "-z",
                &current_head,
                "--",
                ".",
            ],
            vec![
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                ".",
            ],
        ] {
            for path in output(&root, &args, None)?
                .split(|b| *b == 0)
                .filter(|p| !p.is_empty())
            {
                pending.insert(String::from_utf8(path.to_vec()).map_err(|e| e.to_string())?);
            }
        }
        let mut resolved = Vec::new();
        for relative in &manifest.touched {
            let Some(kind) = manifest.after.get(relative).copied() else {
                continue;
            };
            let result = read_after_snapshot(&dir, relative, kind);
            if result == FileState::Skipped || resolve_repo_path(&root, relative).is_err() {
                continue;
            }
            let entry = output(
                &root,
                &["ls-tree", "-z", &current_head, "--", relative],
                None,
            )?;
            let matches = if entry.is_empty() {
                result == FileState::Missing
            } else {
                let header = String::from_utf8_lossy(
                    entry.split(|b| *b == b'\t').next().unwrap_or_default(),
                );
                let fields: Vec<_> = header.split_whitespace().collect();
                if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") {
                    false
                } else {
                    let size = String::from_utf8_lossy(&output(
                        &root,
                        &["cat-file", "-s", fields[2]],
                        None,
                    )?)
                    .trim()
                    .parse::<u64>()
                    .map_err(|e| e.to_string())?;
                    if size > MAX_TEXT_FILE_BYTES {
                        continue;
                    }
                    let filter_path = format!("--path={}{relative}", prefix.trim_end());
                    let bytes = output(
                        &root,
                        &["cat-file", "--filters", &filter_path, fields[2]],
                        None,
                    )?;
                    let mode_matches = cfg!(windows)
                        || snapshot_mode(&dir.join("after"), relative, kind)
                            .is_some_and(|mode| (mode & 0o111 != 0) == (fields[0] == "100755"));
                    mode_matches && result == FileState::Contents(bytes)
                }
            };
            if matches
                || (!pending.contains(relative)
                    && (!entry.is_empty() || manifest.tracked.contains(relative)))
            {
                resolved.push(relative.clone());
            }
        }
        // HEAD can move independently of our checkpoint gate. Do not persist
        // conclusions assembled across two different commits.
        if head(&root).as_deref() != Some(current_head.as_str()) {
            return Ok(());
        }
        if !resolved.is_empty() {
            for relative in resolved {
                release_path(&mut manifest, &relative);
            }
            write_manifest(&dir, &manifest)?;
        }
        Ok(())
    }
    fn active_turns(&self, session_id: &str, cwd: &str) -> Result<Vec<(PathBuf, Turn)>, String> {
        let mut turns = Vec::new();
        if !self.root.exists() {
            return Ok(turns);
        }
        for entry in std::fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name().to_string_lossy() == session_id {
                continue;
            }
            if let Some(turn) = read_turn(&entry.path())? {
                if turn.active && overlap(cwd, &turn.cwd) {
                    turns.push((entry.path(), turn));
                }
            }
        }
        Ok(turns)
    }
    pub(super) fn turn_review_ready(&self, session_id: &str, cwd: &str) -> Result<(), String> {
        if let Some(turn) =
            read_turn(&self.session_dir(session_id))?.filter(|t| same_cwd(&t.cwd, cwd))
        {
            if let Some(error) = turn.error {
                return Err(format!("Workspace checkpoint failed: {error}"));
            }
            if turn.active {
                return Err("Workspace checkpoint is still recording this turn".into());
            }
        }
        Ok(())
    }
    pub(super) fn turn_undo_safe(&self, session_id: &str, cwd: &str) -> Result<bool, String> {
        let turn = read_turn(&self.session_dir(session_id))?;
        let safe = turn.filter(|t| same_cwd(&t.cwd, cwd)).is_none_or(|t| {
            !t.active && !t.shared && t.error.is_none() && t.head == head(Path::new(cwd))
        });
        Ok(safe
            && self.active_turns(session_id, cwd)?.is_empty()
            && !leases::active(&self.leases, cwd)?)
    }
    pub(super) fn begin_turn(&self, session_id: &str, cwd: &str, id: &str) -> Result<(), String> {
        if let Some(previous) = read_turn(&self.session_dir(session_id))? {
            if previous.active && (previous.id != id || !same_cwd(&previous.cwd, cwd)) {
                // Settle membership in the previous checkout before ensure changes its manifest.
                let _ = self.finish_turn(session_id, &previous.cwd, &previous.id, true);
                leases::release(&self.leases, session_id, &previous.id)?;
            }
        }
        leases::publish(&self.leases, session_id, id, cwd)
            .map_err(|e| format!("checkpoint-coordination: {e}"))?;
        let result = self.begin_turn_inner(session_id, cwd, id);
        if let Err(error) = &result {
            let failed = Turn {
                id: id.into(),
                cwd: cwd.into(),
                before: None,
                head: head(Path::new(cwd)),
                active: true,
                shared: true,
                error: Some(error.clone()),
                prepared_before: BTreeSet::new(),
                dirty_before: BTreeMap::new(),
                captured: BTreeSet::new(),
            };
            save_turn(&self.session_dir(session_id), &failed)?;
        }
        result
    }
    fn begin_turn_inner(&self, session_id: &str, cwd: &str, id: &str) -> Result<(), String> {
        self.ensure_timed(session_id, cwd)?;
        let root = project_root(cwd)?;
        if !has_git_marker(&root)? {
            save_turn(
                &self.session_dir(session_id),
                &Turn {
                    id: id.into(),
                    cwd: cwd.into(),
                    before: None,
                    head: None,
                    active: true,
                    shared: leases::shared(&self.leases, session_id, id)?,
                    error: None,
                    prepared_before: BTreeSet::new(),
                    dirty_before: BTreeMap::new(),
                    captured: BTreeSet::new(),
                },
            )?;
            return Ok(());
        }
        let dir = self.session_dir(session_id);
        let previous = read_turn(&dir)?;
        if let Some(previous) = &previous {
            if previous.active && previous.id == id {
                return previous.error.clone().map_or(Ok(()), Err);
            }
            if previous.active {
                // A restarted caller cannot prove the crashed turn's ownership.
                self.finish_turn(session_id, cwd, &previous.id, true)?;
            }
        }
        self.retire_resolved_paths(session_id, cwd)?;
        let has_owned_changes = self
            .load_matching(session_id, cwd)?
            .is_some_and(|m| !m.touched.is_empty());
        let prepared_before = self
            .load_matching(session_id, cwd)?
            .map(|m| m.prepared)
            .unwrap_or_default();
        let mut dirty_before = BTreeMap::new();
        if let Some(mut manifest) = self.load_matching(session_id, cwd)? {
            for path in &manifest.touched {
                if !after_matches_worktree(&dir, &root, &manifest, path) {
                    manifest.diverged.insert(path.clone());
                }
            }
            let dirty = git_diff_files_for(&root).files;
            if dirty.len() > MAX_SNAPSHOT_FILES {
                return Err("Too many dirty files for checkpoint".into());
            }
            for file in dirty {
                let relative = resolve_repo_path(&root, &file.relative)?;
                dirty_before.insert(
                    relative.clone(),
                    snapshot_file_at(&dir.join("turn-files"), &root, &relative)?,
                );
                if !manifest.prepared.contains(&relative) {
                    manifest
                        .files
                        .insert(relative.clone(), snapshot_file(&dir, &root, &relative)?);
                }
            }
            write_manifest(&dir, &manifest)?;
        }
        let mut turn = Turn {
            id: id.into(),
            cwd: cwd.into(),
            before: None,
            head: if has_owned_changes {
                previous
                    .as_ref()
                    .map(|t| t.head.clone())
                    .unwrap_or_else(|| head(&root))
            } else {
                head(&root)
            },
            active: true,
            shared: has_owned_changes && previous.as_ref().is_some_and(|t| t.shared),
            error: None,
            prepared_before,
            dirty_before,
            captured: BTreeSet::new(),
        };
        save_turn(&dir, &turn)?;
        let capture = (|| {
            turn.shared |= leases::shared(&self.leases, session_id, id)?;
            for (other_dir, mut other) in self.active_turns(session_id, cwd)? {
                turn.shared = true;
                other.shared = true;
                save_turn(&other_dir, &other)?;
            }
            tree(&root, &dir, id, "before")
        })();
        match capture {
            Ok(before) => turn.before = Some(before),
            Err(error) => turn.error = Some(error),
        }
        turn.shared |= read_turn(&dir)?.is_some_and(|t| t.shared);
        save_turn(&dir, &turn)?;
        turn.error.map_or(Ok(()), Err)
    }
    pub(super) fn finish_turn(
        &self,
        session_id: &str,
        cwd: &str,
        id: &str,
        interrupted: bool,
    ) -> Result<(), String> {
        let dir = self.session_dir(session_id);
        let Some(mut turn) =
            read_turn(&dir)?.filter(|t| t.active && t.id == id && same_cwd(&t.cwd, cwd))
        else {
            leases::release(&self.leases, session_id, id)?;
            return Ok(());
        };
        let ambiguous = leases::shared(&self.leases, session_id, id)?;
        turn.shared |= ambiguous;
        turn.shared |= interrupted;
        let result = (|| {
            if turn.before.is_none() && turn.error.is_none() {
                return Ok(());
            }
            let before = turn.before.as_deref().ok_or_else(|| {
                turn.error
                    .clone()
                    .unwrap_or_else(|| "Missing turn baseline".into())
            })?;
            let root = project_root(cwd)?;
            let after = tree(&root, &dir, id, "after")?;
            let changed = output(
                &root,
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                    "--relative",
                    "--name-only",
                    "-z",
                    before,
                    &after,
                    "--",
                    ".",
                ],
                None,
            )?;
            let mut manifest = self
                .load_matching(session_id, cwd)?
                .ok_or("Missing checkpoint manifest")?;
            let paths = changed
                .split(|b| *b == 0)
                .filter(|p| !p.is_empty())
                .map(|p| String::from_utf8(p.to_vec()).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            // A checkout-wide diff cannot attribute simultaneous shell edits.
            // Only this session's explicit tool completions prove membership.
            let paths: Vec<_> = paths
                .into_iter()
                .filter(|path| {
                    (!ambiguous && turn.captured.is_empty()) || turn.captured.contains(path)
                })
                .collect();
            if paths.len() > MAX_SNAPSHOT_FILES {
                return Err("Too many changed files for workspace checkpoint".into());
            }
            for path in &paths {
                let relative = resolve_repo_path(&root, path)?;
                if path_contains_symlink(&root, &relative) {
                    continue;
                }
                if turn.captured.contains(&relative) && manifest.prepared.contains(&relative) {
                    if manifest.after.get(&relative).is_some_and(|kind| {
                        read_after_snapshot(&dir, &relative, *kind)
                            != read_worktree(&root, &relative)
                    }) {
                        manifest.undo_blocked.insert(relative.clone());
                    }
                    // Keep the tool's before/after pair, including a new file's
                    // missing before state. Later edits belong to their writer.
                    continue;
                }
                let blob = output(&root, &["ls-tree", "-z", before, "--", &relative], None)?;
                let mut before_mode;
                let state = if blob.is_empty() {
                    before_mode = None;
                    FileState::Missing
                } else {
                    let header = blob
                        .split(|b| *b == b'\t')
                        .next()
                        .ok_or("Invalid checkpoint blob")?;
                    let fields = String::from_utf8_lossy(header);
                    let mut fields = fields.split_whitespace();
                    let mode = fields.next().ok_or("Invalid checkpoint mode")?;
                    let _kind = fields.next();
                    let oid = fields.next().ok_or("Invalid checkpoint object")?;
                    if !matches!(mode, "100644" | "100755") {
                        continue;
                    }
                    before_mode = Some(if mode == "100755" { 0o755 } else { 0o644 });
                    let size =
                        String::from_utf8_lossy(&output(&root, &["cat-file", "-s", oid], None)?)
                            .trim()
                            .parse::<u64>()
                            .map_err(|e| e.to_string())?;
                    if size > MAX_TEXT_FILE_BYTES {
                        return Err("Checkpoint file is too large".into());
                    }
                    if !manifest.prepared.contains(&relative)
                        && manifest.files.contains_key(&relative)
                    {
                        before_mode =
                            snapshot_mode(&dir.join("files"), &relative, manifest.files[&relative]);
                        read_snapshot(&dir, &relative, manifest.files[&relative])
                    } else {
                        FileState::Contents(output(
                            &root,
                            &["cat-file", "--filters", &format!("--path={relative}"), oid],
                            None,
                        )?)
                    }
                };
                let final_state = read_worktree(&root, &relative);
                if turn.captured.contains(&relative)
                    && manifest.after.get(&relative).is_some_and(|kind| {
                        read_after_snapshot(&dir, &relative, *kind) != final_state
                    })
                {
                    manifest.undo_blocked.insert(relative.clone());
                }
                if !turn.prepared_before.contains(&relative) {
                    let state = if let Some(kind) = turn.dirty_before.get(&relative) {
                        before_mode = snapshot_mode(&dir.join("turn-files"), &relative, *kind);
                        read_snapshot_at(&dir.join("turn-files"), &relative, *kind)
                    } else {
                        state
                    };
                    let destination = state_blob_path(&dir.join("files"), &relative)?;
                    if let Some(parent) = destination.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let kind = match &state {
                        FileState::Missing => {
                            std::fs::write(&destination, []).map_err(|e| e.to_string())?;
                            SnapshotKind::Missing
                        }
                        FileState::Contents(bytes) => {
                            std::fs::write(&destination, bytes).map_err(|e| e.to_string())?;
                            SnapshotKind::Contents
                        }
                        FileState::Skipped => SnapshotKind::Skipped,
                    };
                    manifest.files.insert(relative.clone(), kind);
                    set_file_mode(&destination, before_mode)?;
                    manifest.prepared.insert(relative.clone());
                }
                // Shared/interrupted ownership disables Undo through the turn
                // guard. Its captured before/after diff remains readable.
                manifest.touched.insert(relative.clone());
                manifest.after.insert(
                    relative.clone(),
                    snapshot_after_file(&dir, &root, &relative)?,
                );
            }
            manifest.tracked.extend(paths_in_head(&root, &paths));
            if let Some(stats) = batch_session_stats(&dir, &manifest, &paths) {
                for path in &paths {
                    manifest.stats.remove(path);
                    if let Some(value) = stats.get(path) {
                        manifest.stats.insert(path.clone(), value.clone());
                    }
                }
            }
            write_manifest(&dir, &manifest)
        })();
        turn.active = false;
        turn.shared |= leases::shared(&self.leases, session_id, id)?;
        if let Err(error) = &result {
            turn.error = Some(error.clone());
        }
        save_turn(&dir, &turn)?;
        leases::release(&self.leases, session_id, id)?;
        result
    }
    /// Synchronous recovery for tests; production startup uses `plan_recovery`.
    #[cfg(test)]
    pub(super) fn recover_interrupted_turns(&self) {
        self.plan_recovery().run();
    }

    /// Git-free scan of every session record. Active turns are registered with
    /// the barrier here, so commands arriving after this call already wait.
    pub(super) fn plan_recovery(&self) -> RecoveryPlan {
        let mut plan = RecoveryPlan {
            store: self.clone(),
            active: Vec::new(),
            settled: Vec::new(),
        };
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return plan;
        };
        for entry in entries.flatten() {
            let session = entry.file_name().to_string_lossy().into_owned();
            if validate_id(&session, "session").is_err() {
                continue;
            }
            match read_turn(&entry.path()) {
                Ok(Some(turn)) if turn.active => {
                    let ticket = self.barrier.register(&session, &turn.cwd);
                    plan.active.push((ticket, session, turn));
                }
                Ok(Some(turn)) => plan.settled.push((session, turn)),
                Ok(None) => {}
                Err(error) => eprintln!(
                    "Checkpoint record for session {session} is unreadable and was not recovered: {error}"
                ),
            }
        }
        plan
    }

    /// Deletes snapshot directories whose session no longer exists. Deleting a
    /// conversation never released them, so they piled up by the hundred
    /// thousand files. Recent and active-turn directories are left alone: a
    /// session may hold a checkpoint shortly before its first save.
    pub(crate) fn prune_orphans(
        &self,
        known_sessions: &HashSet<String>,
        min_age: std::time::Duration,
    ) -> usize {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return 0;
        };
        let now = std::time::SystemTime::now();
        let mut removed = 0;
        for entry in entries.flatten() {
            let session = entry.file_name().to_string_lossy().into_owned();
            if validate_id(&session, "session").is_err() || known_sessions.contains(&session) {
                continue;
            }
            let dir = entry.path();
            let old_enough = |dir: &Path| {
                std::fs::metadata(dir)
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|modified| now.duration_since(modified).ok())
                    .is_some_and(|age| age >= min_age)
            };
            if !dir.is_dir() || !old_enough(&dir) {
                continue;
            }
            let result = self.exclusive(&session, &[], |_| {
                // Re-check under the session gate: a turn may have begun since.
                if !old_enough(&dir)
                    || read_turn(&dir).map_or(true, |t| t.is_some_and(|t| t.active))
                {
                    return Ok(false);
                }
                std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
                Ok(true)
            });
            if matches!(result, Ok(true)) {
                removed += 1;
            }
        }
        removed
    }
}

#[tauri::command]
pub async fn session_checkpoint_begin_turn(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    turn_id: String,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    validate_id(&turn_id, "turn")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |s| {
            s.begin_turn(&session_id, &cwd, &turn_id)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn session_checkpoint_finish_turn(
    store: State<'_, CheckpointStore>,
    session_id: String,
    cwd: String,
    turn_id: String,
    interrupted: Option<bool>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    validate_id(&turn_id, "turn")?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.coordinated(&session_id, &[&cwd], |s| {
            s.finish_turn(&session_id, &cwd, &turn_id, interrupted.unwrap_or(false))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
