//! Workspace boundaries complement structured-edit ownership, including shell edits.
use super::*;
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
impl CheckpointStore {
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
                return Ok(());
            }
            if previous.active {
                // A restarted caller cannot prove the crashed turn's ownership.
                self.finish_turn(session_id, cwd, &previous.id, true)?;
            }
        }
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
        turn.shared |= interrupted;
        let result = (|| {
            if turn.before.is_none() && turn.error.is_none() {
                return Ok(());
            }
            let before = turn.before.as_deref().ok_or("Missing turn baseline")?;
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
            if paths.len() > MAX_SNAPSHOT_FILES {
                return Err("Too many changed files for workspace checkpoint".into());
            }
            for path in &paths {
                let relative = resolve_repo_path(&root, path)?;
                if path_contains_symlink(&root, &relative) {
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
    pub(super) fn recover_interrupted_turns(&self) {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let session = entry.file_name().to_string_lossy().into_owned();
            if validate_id(&session, "session").is_err() {
                continue;
            }
            if let Ok(Some(turn)) = read_turn(&entry.path()) {
                if turn.active {
                    let result = self.exclusive(&session, &[&turn.cwd], |s| {
                        s.finish_turn(&session, &turn.cwd, &turn.id, true)
                    });
                    if let Err(error) = result {
                        eprintln!("Interrupted checkpoint could not settle: {error}");
                    }
                }
            }
        }
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
        store.exclusive(&session_id, &[&cwd], |s| {
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
        store.exclusive(&session_id, &[&cwd], |s| {
            s.finish_turn(&session_id, &cwd, &turn_id, interrupted.unwrap_or(false))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
