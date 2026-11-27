use super::*;

struct Repo(PathBuf);
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn repo() -> Repo {
    let dir = std::env::temp_dir().join(format!("bycoda-worktree-test-{}", uuid::Uuid::new_v4()));
    let root = dir.join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git_checked(&root, &["init", "-b", "main"]).unwrap();
    git_checked(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ],
    )
    .unwrap();
    Repo(dir)
}

#[test]
fn orphaned_orchestration_cleanup_preserves_unmerged_branch() {
    let repo = repo();
    let root = repo.0.join("repo");
    let branch = "mc/orch-retained";
    let path = repo.0.join("worker");
    git(
        &root,
        &["worktree", "add", "-b", branch, path.to_str().unwrap()],
    )
    .unwrap();
    git(
        &path,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "unmerged worker result",
        ],
    )
    .unwrap();
    let tip = git(&path, &["rev-parse", "HEAD"]).unwrap();
    git(&root, &["worktree", "remove", path.to_str().unwrap()]).unwrap();
    // Retry the old cleanup endpoint after its directory has already gone.
    let result = tauri::async_runtime::block_on(git_orchestration_branch_remove(
        root.to_string_lossy().into_owned(),
        branch.into(),
    ));
    assert!(
        result.is_err(),
        "directory cleanup must not authorize branch deletion"
    );
    assert_eq!(git(&root, &["rev-parse", branch]).unwrap(), tip);
}

#[test]
fn reviewed_removal_detects_git_session_and_process_drift() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "reviewed", "main", false).unwrap();
    let path = Path::new(&tree.path);
    // Publish the fixture HEAD locally; no network or owner repository is used.
    git_checked(&root, &["update-ref", "refs/remotes/fixture/main", "HEAD"]).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let before = removal_review(&conn, &root, path, false, false).unwrap();
    assert_removal_review(&before, &before).unwrap();
    std::fs::write(path.join("new-file"), "private fixture").unwrap();
    let dirty = removal_review(&conn, &root, path, false, false).unwrap();
    assert!(assert_removal_review(&before, &dirty).is_err());
    assert!(assert_removal_review(&dirty, &dirty).is_err());
    std::fs::remove_file(path.join("new-file")).unwrap();
    conn.execute("INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at) VALUES ('new-session',?1,'codex','test','supervised','Fixture','[]',1,1)", [&tree.path]).unwrap();
    let linked = removal_review(&conn, &root, path, false, false).unwrap();
    assert!(assert_removal_review(&before, &linked).is_err());
    let processes = removal_review(&conn, &root, path, true, true).unwrap();
    assert!(assert_removal_review(&processes, &processes).is_err());
    assert!(removal_review(&conn, &root, &root, false, false).is_err());
    git_checked(&root, &["worktree", "lock", &tree.path]).unwrap();
    assert!(removal_review(&conn, &root, path, false, false).is_err());
    assert!(path.exists());
}

#[test]
fn reviewed_removal_preserves_branch_and_canonical_session_cleanup() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "reviewed-cleanup", "main", false).unwrap();
    let path = Path::new(&tree.path);
    git_checked(&root, &["update-ref", "refs/remotes/fixture/main", "HEAD"]).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    conn.execute("INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at) VALUES ('idle',?1,'codex','test','supervised','Keep fixture','[]',1,1)", [&tree.path]).unwrap();
    let review = removal_review(&conn, &root, path, false, false).unwrap();
    crate::fs::with_git_mutation(&root, || {
        let _reservation = crate::worktree_lifecycle::reserve_removal(path)?;
        let current = removal_review(&conn, &root, path, false, false)?;
        assert_removal_review(&review, &current)?;
        remove_with_sessions(|| Ok(&**conn), &root, path, false, true)
    })
    .unwrap();
    assert!(!path.exists());
    assert_eq!(
        git(&root, &["rev-parse", "refs/heads/reviewed-cleanup"])
            .unwrap()
            .trim(),
        review.head
    );
    let retained: (String, i64) = conn
        .query_row(
            "SELECT title,worktree_removed FROM sessions WHERE id='idle'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(retained, ("Keep fixture".into(), 1));
}

#[test]
fn parses_literal_paths_and_worktree_flags() {
    let trees = parse_worktrees("worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /a\nquoted\"path\0HEAD def\0detached\0locked reason\0prunable missing\0\0");
    assert!(trees[0].is_main);
    assert_eq!(trees[1].path, "/a\nquoted\"path");
    assert!(trees[1].locked && trees[1].prunable);
    assert!(!trees[1].is_main);
}

#[test]
fn bounded_map_keeps_order_and_never_exceeds_the_limit() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let active = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);
    let items: Vec<usize> = (0..12).collect();
    let results = map_bounded(&items, 3, |item| {
        let now = active.fetch_add(1, Ordering::SeqCst) + 1;
        peak.fetch_max(now, Ordering::SeqCst);
        std::thread::sleep(std::time::Duration::from_millis(15));
        active.fetch_sub(1, Ordering::SeqCst);
        item * 2
    })
    .unwrap();
    assert_eq!(
        results,
        items.iter().map(|item| item * 2).collect::<Vec<_>>()
    );
    assert!(peak.load(Ordering::SeqCst) <= 3);
    assert!(map_bounded(&Vec::<usize>::new(), 3, |item| *item)
        .unwrap()
        .is_empty());
}

#[test]
fn session_dirs_match_nested_sessions_once_per_worktree_in_row_order() {
    let repo = repo();
    let root = repo.0.join("repo");
    let sibling = repo.0.join("repo-sibling");
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::create_dir_all(&sibling).unwrap();
    let text = |path: &Path| path_to_js(path);
    let sessions = SessionDirs::new(vec![
        ("root".into(), text(&root)),
        ("nested".into(), text(&root.join("src"))),
        ("again".into(), text(&root)),
        ("sibling".into(), text(&sibling)),
        ("gone".into(), text(&root.join("missing-directory"))),
    ]);
    // One resolved key per distinct directory, however many sessions share it.
    assert_eq!(sessions.keys.len(), 4);
    assert_eq!(
        sessions.ids_under(&WorkingDirKey::new(&root)),
        ["root", "nested", "again", "gone"]
    );
    assert_eq!(
        sessions.ids_under(&WorkingDirKey::new(&sibling)),
        ["sibling"]
    );
    assert!(contains_working_dir(&root, &root.join("src")));
    assert!(!contains_working_dir(&root, &sibling));
}

#[test]
fn session_ids_ignore_removed_sessions() {
    let repo = repo();
    let root = repo.0.join("repo");
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    for (id, removed) in [("kept", 0), ("removed", 1)] {
        conn.execute("INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at,worktree_removed) VALUES (?1,?2,'codex','test','supervised','Fixture','[]',1,1,?3)", rusqlite::params![id, path_to_js(&root), removed]).unwrap();
    }
    assert_eq!(session_ids(&conn, &root).unwrap(), ["kept"]);
}

#[test]
fn worktree_probes_report_dirty_clean_and_missing_in_order() {
    let repo = repo();
    let root = repo.0.join("repo");
    let dirty = create(&root, "probe-dirty", "main", false).unwrap();
    std::fs::write(Path::new(&dirty.path).join("untracked"), "fixture").unwrap();
    let missing = repo.0.join("never-created");
    // More entries than STATUS_PARALLELISM, so results must be reassembled.
    let mut paths = vec![root.clone(), PathBuf::from(&dirty.path), missing];
    paths.extend(std::iter::repeat_n(root.clone(), STATUS_PARALLELISM + 2));
    let probes = map_bounded(&paths, STATUS_PARALLELISM, |path| probe_worktree(path)).unwrap();
    assert_eq!(probes.len(), paths.len());
    assert!(!probes[0].missing && probes[0].dirty == Some(false));
    assert_eq!(probes[1].dirty, Some(true));
    assert!(probes[2].missing && probes[2].dirty.is_none() && probes[2].unpushed.is_none());
    assert!(probes[3..].iter().all(|probe| probe.dirty == Some(false)));
}

#[cfg(windows)]
#[test]
fn removal_deletes_long_paths_without_changing_repository_config() {
    let repo = repo();
    let root = repo.0.join("repo");
    git_checked(&root, &["config", "core.longpaths", "false"]).unwrap();
    let tree = create(&root, "feature/long-path", "main", false).unwrap();
    let path = Path::new(&tree.path);
    // Use an extended path to create the fixture independently of Git's
    // long-path setting, as package managers do for nested dependencies.
    let mut nested = path.canonicalize().unwrap();
    for _ in 0..8 {
        nested.push("nested-dependency-with-a-long-package-name");
    }
    std::fs::create_dir_all(&nested).unwrap();
    let file = nested.join("package.json");
    std::fs::write(&file, "{}").unwrap();
    assert!(file.as_os_str().len() > 260);

    assert!(check_removal(&root, path, false, false).is_err());
    assert!(remove(&root, path, false).is_err());
    assert!(file.exists());
    assert!(list(&root)
        .unwrap()
        .iter()
        .any(|entry| entry.path == tree.path));

    remove(&root, path, true).unwrap();
    assert!(!path.exists());
    assert!(!file.exists());
    assert_eq!(list(&root).unwrap().len(), 1);
    assert_eq!(
        git(&root, &["config", "--get", "core.longpaths"])
            .unwrap()
            .trim(),
        "false"
    );
    assert!(git(
        &root,
        &["rev-parse", "--verify", "refs/heads/feature/long-path"]
    )
    .is_ok());
}

#[test]
fn isolates_changes_and_preserves_branch_on_removal() {
    let repo = repo();
    let root = repo.0.join("repo");
    std::fs::write(root.join("main-only"), "main change").unwrap();
    git_checked(&root, &["add", "main-only"]).unwrap();
    let tree = create(&root, "feature/test", "main", false).unwrap();
    let path = Path::new(&tree.path);
    assert!(!path.join("main-only").exists());
    assert!(git(path, &["diff", "--cached", "--name-only"])
        .unwrap()
        .is_empty());
    std::fs::write(path.join("feature-only"), "feature change").unwrap();
    git_checked(path, &["add", "feature-only"]).unwrap();
    git_checked(
        path,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "feature commit",
        ],
    )
    .unwrap();
    let commit = git(path, &["rev-parse", "HEAD"]).unwrap();
    git_checked(
        &root,
        &[
            "update-ref",
            "refs/bycoda/rewinds/native-removal/rescue-head",
            commit.trim(),
        ],
    )
    .unwrap();
    assert_ne!(commit, git(&root, &["rev-parse", "HEAD"]).unwrap());
    assert_eq!(
        git(&root, &["diff", "--cached", "--name-only"])
            .unwrap()
            .trim(),
        "main-only"
    );
    assert!(!root.join("feature-only").exists());
    std::fs::write(path.join("uncommitted"), "keep unless forced").unwrap();
    assert!(remove(&root, path, false).is_err());
    assert!(path.join("uncommitted").exists());
    assert!(remove(&root, &root, true).is_err());
    remove(&root, path, true).unwrap();
    assert!(root.join("main-only").exists());
    assert_eq!(
        git(&root, &["rev-parse", "--verify", "refs/heads/feature/test"]).unwrap(),
        commit
    );
    assert_eq!(
        git(
            &root,
            &[
                "rev-parse",
                "refs/bycoda/rewinds/native-removal/rescue-head"
            ]
        )
        .unwrap(),
        commit
    );
}

#[cfg(windows)]
fn directory_link(link: &Path, target: &Path) {
    let mut command = Command::new("cmd");
    crate::hide_window_console(&mut command);
    let output = command
        .args(["/c", "mklink", "/J"])
        .arg(link.to_string_lossy().replace('/', "\\"))
        .arg(target.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(unix)]
fn directory_link(link: &Path, target: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[test]
fn worktree_removal_allows_linked_ancestors_and_detaches_dependency_links() {
    let repo = repo();
    let alias = repo.0.join("ancestor");
    directory_link(&alias, &repo.0);
    let root = alias.join("repo");
    let tree = create(&root, "junction-sentinel", "main", false).unwrap();
    let aliased_path = alias.join("repo-worktrees/junction-sentinel");
    let path = aliased_path.as_path();
    assert!(same_path(path, Path::new(&tree.path)));
    let sentinel = repo.0.join("main-node-modules");
    std::fs::create_dir_all(sentinel.join("package")).unwrap();
    std::fs::write(sentinel.join("package/sentinel.txt"), "must survive").unwrap();
    // A Unix directory symlink is a file entry to Git, unlike a Windows
    // junction. Ignore either entry type so this fixture is clean on both.
    std::fs::write(path.join(".gitignore"), "node_modules\ntemp/\n").unwrap();
    git_checked(path, &["add", ".gitignore"]).unwrap();
    git_checked(
        path,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "ignore generated directories",
        ],
    )
    .unwrap();
    directory_link(&path.join("node_modules"), &sentinel);
    std::fs::create_dir_all(path.join("temp/verification")).unwrap();
    std::fs::write(
        path.join("temp/verification/evidence.txt"),
        "retained evidence",
    )
    .unwrap();
    assert!(
        git(path, &["status", "--porcelain", "--untracked-files=all"])
            .unwrap()
            .is_empty()
    );
    remove(&root, path, false).unwrap();
    assert!(!path.exists());
    assert_eq!(
        std::fs::read_to_string(sentinel.join("package/sentinel.txt")).unwrap(),
        "must survive"
    );
    let archives = std::fs::read_dir(root.join(".git/bycoda-worktree-evidence"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(archives.len(), 1);
    assert_eq!(
        std::fs::read_to_string(archives[0].join("verification/evidence.txt")).unwrap(),
        "retained evidence"
    );
    assert!(git(&root, &["rev-parse", "refs/heads/junction-sentinel"]).is_ok());
    #[cfg(windows)]
    std::fs::remove_dir(alias).unwrap();
    #[cfg(unix)]
    std::fs::remove_file(alias).unwrap();
}

#[test]
fn worktree_removal_rejects_linked_target_before_touching_external_directory() {
    let repo = repo();
    let sentinel = repo.0.join("sentinel");
    std::fs::create_dir_all(&sentinel).unwrap();
    std::fs::write(sentinel.join("keep"), "retained").unwrap();
    let alias = repo.0.join("alias");
    directory_link(&alias, &sentinel);
    assert!(crate::worktree_lifecycle::reserve_removal(&alias).is_err());
    assert!(remove(&repo.0.join("repo"), &alias, true).is_err());
    assert_eq!(
        std::fs::read_to_string(sentinel.join("keep")).unwrap(),
        "retained"
    );
    #[cfg(windows)]
    std::fs::remove_dir(alias).unwrap();
    #[cfg(unix)]
    std::fs::remove_file(alias).unwrap();
}

#[cfg(windows)]
#[test]
fn worktree_removal_retries_after_a_real_windows_handle_is_released() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "locked-removal", "main", false).unwrap();
    let path = Path::new(&tree.path);
    std::fs::create_dir_all(path.join("generated")).unwrap();
    let locked = path.join("generated/locked.bin");
    std::fs::write(&locked, "handle blocks deletion").unwrap();
    let handle = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(&locked)
        .unwrap();
    let database = repo.0.join("removal-sessions.db");
    {
        let store = SessionStore::open(database.clone()).unwrap();
        let conn = store.lock_conn().unwrap();
        assert!(remove_with_sessions(|| Ok(&**conn), &root, path, true, true).is_err());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }
    assert!(locked.exists());
    assert!(crate::worktree_lifecycle::reserve_spawn(path).is_err());
    assert!(git(&root, &["rev-parse", "refs/heads/locked-removal"]).is_ok());
    // Startup must retain the durable retry journal and process-start fence.
    let store = SessionStore::open(database).unwrap();
    let conn = store.lock_conn().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
    assert!(crate::worktree_lifecycle::reserve_spawn(path).is_err());
    drop(handle);
    remove_with_sessions(|| Ok(&**conn), &root, path, true, true).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
    assert!(!path.exists());
    assert!(git(&root, &["rev-parse", "refs/heads/locked-removal"]).is_ok());
}

#[test]
fn worktree_reserved_managed_directory_requires_host_without_native_session() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "before-native-persist", "main", false).unwrap();
    let reserved = repo.0.join("wt-123456789abc");
    git(
        &root,
        &["worktree", "move", &tree.path, &path_to_js(&reserved)],
    )
    .unwrap();
    git(
        &reserved,
        &["branch", "-m", "renamed-before-native-persist"],
    )
    .unwrap();
    assert!(check_removal(&root, &reserved, true, false).is_err());
    assert!(remove(&root, &reserved, true).is_err());
    assert!(reserved.exists());
    assert!(git(
        &root,
        &["rev-parse", "refs/heads/renamed-before-native-persist"]
    )
    .is_ok());
}

#[test]
fn worktree_registered_managed_path_cannot_bypass_host_after_branch_rename() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "managed-renamed", "main", false).unwrap();
    let path = Path::new(&tree.path);
    git(path, &["branch", "-m", "user-renamed-branch"]).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    conn.execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,worktree_cwd,workspace_id,workspace_revision)
        VALUES('managed-session',?1,'codex','m','supervised','Retain',1,1,?2,'owned-workspace',1)",
        rusqlite::params![path_to_js(&root),tree.path]).unwrap();
    assert!(assert_legacy_workspace(&conn, path).is_err());
    assert!(removal_review(&conn, &root, path, false, false).is_err());
    assert!(remove_with_sessions(|| Ok(&**conn), &root, path, true, true).is_err());
    assert!(path.exists());
    assert!(git(&root, &["rev-parse", "refs/heads/user-renamed-branch"]).is_ok());
    let legacy = create(&root, "genuine-legacy", "main", false).unwrap();
    assert!(assert_legacy_workspace(&conn, Path::new(&legacy.path)).is_ok());
}

#[test]
fn worktree_managed_branches_require_authoritative_host_cleanup_even_with_force() {
    let repo = repo();
    let root = repo.0.join("repo");
    for branch in ["by/managed-session", "by/managed-task-1a2b3c4d"] {
        let tree = create(&root, branch, "main", false).unwrap();
        git(
            &root,
            &[
                "config",
                &format!("branch.{branch}.bycodaWorkspace"),
                "ws-1",
            ],
        )
        .unwrap();
        let path = Path::new(&tree.path);
        std::fs::write(path.join("dirty-source"), "retained source").unwrap();
        let error = remove(&root, path, true).unwrap_err();
        assert!(error.contains("Host workspace cleanup plan/apply"));
        assert!(path.join("dirty-source").exists());
        assert!(check_removal(&root, path, true, false).is_err());
    }
}

#[test]
fn worktree_removal_reconciles_only_journaled_unregistered_remnants() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "recover-remnants", "main", false).unwrap();
    let path = Path::new(&tree.path);
    let journal = removal_journal_directory(&root).unwrap();
    std::fs::create_dir_all(&journal).unwrap();
    let receipt = journal.join("interrupted.json");
    std::fs::create_dir_all(path.join("nested")).unwrap();
    std::fs::write(path.join("nested/remnant"), "generated").unwrap();
    let saved = NativeRemovalJournal {
        path: tree.path.clone(),
        branch: "recover-remnants".into(),
        head: tree.head.clone(),
        manifest: native_removal_manifest(path).unwrap(),
    };
    std::fs::write(&receipt, serde_json::to_vec(&saved).unwrap()).unwrap();
    git_checked(&root, &["worktree", "remove", "--force", "--", &tree.path]).unwrap();
    // Model Git having unregistered a directory while a Windows handle left
    // contents behind. A later retry must use the durable receipt, not adopt
    // any arbitrary unregistered directory under the managed root.
    std::fs::create_dir_all(path.join("nested")).unwrap();
    std::fs::write(path.join("nested/remnant"), "generated").unwrap();
    std::fs::write(path.join("new-source"), "must not be removed").unwrap();
    assert!(remove(&root, path, false).is_err());
    assert!(path.join("new-source").exists());
    std::fs::remove_file(path.join("new-source")).unwrap();
    remove(&root, path, false).unwrap();
    assert!(!path.exists());
    assert!(!receipt.exists());
    assert!(git(&root, &["rev-parse", "refs/heads/recover-remnants"]).is_ok());
    let unknown = repo.0.join("unknown");
    std::fs::create_dir_all(&unknown).unwrap();
    std::fs::write(unknown.join("keep"), "unknown source").unwrap();
    assert!(remove(&root, &unknown, true).is_err());
    assert!(unknown.join("keep").exists());
}

// Regression: a receipt whose recovery branch was later deleted failed
// `rev-parse --verify` on every launch ("Needed a single revision") although its
// folder was already gone, so the removal stayed pending forever.
#[test]
fn removal_recovery_finishes_a_gone_worktree_whose_branch_was_deleted() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "gone-branch", "main", false).unwrap();
    let path = Path::new(&tree.path);
    let journal = removal_journal_directory(&root).unwrap();
    std::fs::create_dir_all(&journal).unwrap();
    let receipt = journal.join("interrupted.json");
    let saved = NativeRemovalJournal {
        path: tree.path.clone(),
        branch: "gone-branch".into(),
        head: tree.head.clone(),
        manifest: native_removal_manifest(path).unwrap(),
    };
    std::fs::write(&receipt, serde_json::to_vec(&saved).unwrap()).unwrap();
    git_checked(&root, &["worktree", "remove", "--force", "--", &tree.path]).unwrap();
    git_checked(&root, &["branch", "-D", "gone-branch"]).unwrap();
    assert!(!path.exists());
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let journal_row = serde_json::json!({ "project_cwd": path_to_js(&root), "sessions": [] });
    conn.execute(
        "INSERT INTO worktree_removals (path, sessions_json) VALUES (?1, ?2)",
        rusqlite::params![tree.path, journal_row.to_string()],
    )
    .unwrap();
    reconcile_removals(&conn).unwrap();
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(pending, 0);
    assert!(!receipt.exists());
}

#[test]
fn orchestration_worktree_starts_from_the_lead_checkout_contents() {
    let repo = repo();
    let root = repo.0.join("repo");
    std::fs::write(root.join("tracked.txt"), "head\n").unwrap();
    std::fs::write(root.join("deleted.txt"), "delete me\n").unwrap();
    git_checked(&root, &["add", "."]).unwrap();
    git_checked(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "files",
        ],
    )
    .unwrap();
    std::fs::write(root.join("tracked.txt"), "lead dirty\n").unwrap();
    std::fs::write(root.join("untracked.txt"), "lead new\n").unwrap();
    std::fs::remove_file(root.join("deleted.txt")).unwrap();

    let tree = create_seeded(&root, "mc/orch-testworker").unwrap();
    let worker = Path::new(&tree.path);
    assert_eq!(
        std::fs::read_to_string(worker.join("tracked.txt")).unwrap(),
        "lead dirty\n"
    );
    assert_eq!(
        std::fs::read_to_string(worker.join("untracked.txt")).unwrap(),
        "lead new\n"
    );
    assert!(!worker.join("deleted.txt").exists());
    assert_eq!(
        create_seeded(&root, "mc/orch-testworker").unwrap().path,
        tree.path
    );

    std::fs::write(root.join("tracked.txt"), "later lead edit\n").unwrap();
    assert!(create_seeded(&root, "mc/orch-testworker").is_err());
    assert_eq!(
        std::fs::read_to_string(worker.join("tracked.txt")).unwrap(),
        "lead dirty\n"
    );
    remove(&root, worker, true).unwrap();
}

#[test]
fn reuses_branches_and_rejects_locked_or_unregistered_paths() {
    let repo = repo();
    let root = repo.0.join("repo");
    git_checked(&root, &["branch", "existing"]).unwrap();
    let tree = create(&root, "existing", "HEAD", true).unwrap();
    assert!(create(&root, "existing", "HEAD", true).is_err());
    assert!(create(&root, "main", "HEAD", true).is_err());
    assert!(create(&root, "bad name", "HEAD", false).is_err());
    assert!(create(&root, "valid", "--help", false).is_err());
    git_checked(&root, &["worktree", "lock", &tree.path]).unwrap();
    assert!(remove(&root, Path::new(&tree.path), true).is_err());
    assert!(remove(&root, &repo.0, true).is_err());
}

#[test]
fn renames_only_temporary_worktree_branches() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "by/12345678", "main", false).unwrap();
    let renamed = rename_branch(&root, Path::new(&tree.path), "by/faster-worktrees").unwrap();
    assert_eq!(renamed.branch.as_deref(), Some("by/faster-worktrees"));
    assert!(git(
        &root,
        &["rev-parse", "--verify", "refs/heads/by/faster-worktrees"]
    )
    .is_ok());
    assert!(rename_branch(&root, &root, "by/nope").is_err());

    let regular = create(&root, "feature/manual", "main", false).unwrap();
    assert!(rename_branch(&root, Path::new(&regular.path), "by/should-not-change").is_err());

    // A managed branch is renamed by Host only.
    let managed = create(&root, "by/87654321", "main", false).unwrap();
    git(
        &root,
        &["config", "branch.by/87654321.bycodaWorkspace", "ws-1"],
    )
    .unwrap();
    assert!(rename_branch(&root, Path::new(&managed.path), "by/stolen").is_err());
}

#[test]
fn removal_preflight_is_read_only_and_rejects_blockers() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "feature", "main", false).unwrap();
    let path = Path::new(&tree.path);
    std::fs::write(path.join("keep-me"), "local changes").unwrap();
    assert!(check_removal(&root, path, true, true)
        .unwrap_err()
        .contains("terminals"));
    assert!(check_removal(&root, path, false, false).is_err());
    check_removal(&root, path, true, false).unwrap();
    assert!(path.join("keep-me").exists());
    assert_eq!(list(&root).unwrap().len(), 2);
    assert!(check_removal(&root, &root, true, false).is_err());
    assert!(check_removal(&root, &repo.0, true, false).is_err());
    git_checked(&root, &["worktree", "lock", &tree.path]).unwrap();
    assert!(check_removal(&root, path, true, false)
        .unwrap_err()
        .contains("locked"));
    assert!(path.join("keep-me").exists());
}

#[test]
fn references_include_archived_sessions_and_directly_opened_worktrees() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "feature", "main", false).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    for (id, cwd, worktree, archived) in [
        ("shared", path_to_js(&root), Some(tree.path.clone()), 0),
        ("archived", path_to_js(&root), Some(tree.path.clone()), 1),
        ("direct", tree.path.clone(), None, 0),
        ("main", path_to_js(&root), None, 0),
    ] {
        conn.execute(
            "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at, worktree_cwd, archived) VALUES (?1, ?2, 'codex', 'test', 'supervised', 'Test', '[]', 0, 0, ?3, ?4)",
            rusqlite::params![id, cwd, worktree, archived],
        ).unwrap();
    }
    let mut ids = session_ids(&conn, Path::new(&tree.path)).unwrap();
    ids.sort();
    assert_eq!(ids, vec!["archived", "direct", "shared"]);
    assert!(!contains_working_dir(
        &root,
        &PathBuf::from(format!("{}-other", root.display()))
    ));
}

#[test]
fn removal_preserves_shared_archived_and_direct_sessions() {
    let repo = repo();
    let root = repo.0.join("repo").canonicalize().unwrap();
    let tree = create(&root, "feature", "main", false).unwrap();
    let path = Path::new(&tree.path);
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let blocks = r#"[{"id":"u","role":"user","text":"Keep my conversation"}]"#;
    for (id, cwd, worktree, archived) in [
        ("shared", path_to_js(&root), Some(tree.path.clone()), 0),
        ("archived", path_to_js(&root), Some(tree.path.clone()), 1),
        ("direct", tree.path.clone(), None, 0),
        ("main", path_to_js(&root), None, 0),
    ] {
        conn.execute(
            "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at, worktree_cwd, archived, branch, provider_session_id) VALUES (?1, ?2, 'codex', 'test', 'supervised', 'Keep title', ?3, 10, 20, ?4, ?5, 'feature', 'provider')",
            rusqlite::params![id, cwd, blocks, worktree, archived],
        ).unwrap();
    }
    assert!(remove_with_sessions(|| Ok(&**conn), &root, path, true, false).is_err());
    // An actual Git removal failure must roll back the database changes.
    std::fs::write(path.join("dirty"), "uncommitted").unwrap();
    assert!(remove_with_sessions(|| Ok(&**conn), &root, path, false, true).is_err());
    assert_eq!(session_ids(&conn, path).unwrap().len(), 3);
    let mut removed = remove_with_sessions(|| Ok(&**conn), path, path, true, true).unwrap();
    removed.session_ids.sort();
    assert_eq!(removed.session_ids, vec!["archived", "direct", "shared"]);
    // Git omits the verbatim prefix added by canonicalize() on Windows.
    assert!(same_path(Path::new(&removed.project_cwd), &root));
    assert!(!path.exists());
    assert!(session_ids(&conn, path).unwrap().is_empty());
    for id in &removed.session_ids {
        let row: (String, String, String, i64, i64, i64, Option<String>, Option<String>, String) = conn.query_row(
            "SELECT cwd, title, blocks_json, created_at, updated_at, worktree_removed, branch, provider_session_id, worktree_cwd FROM sessions WHERE id = ?1", [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?)),
        ).unwrap();
        let expected_cwd = if id == "direct" {
            removed.project_cwd.clone()
        } else {
            path_to_js(&root)
        };
        assert_eq!(
            row,
            (
                expected_cwd,
                "Keep title".into(),
                blocks.into(),
                10,
                20,
                1,
                None,
                None,
                tree.path.clone()
            )
        );
    }
    let archived: bool = conn
        .query_row(
            "SELECT archived FROM sessions WHERE id = 'archived'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(archived);
    let main_removed: bool = conn
        .query_row(
            "SELECT worktree_removed FROM sessions WHERE id = 'main'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!main_removed);
    assert!(git(&root, &["rev-parse", "--verify", "refs/heads/feature"]).is_ok());
}

#[test]
fn startup_recovers_interruptions_before_and_after_git_removal() {
    type StoredContext = (
        String,
        Option<String>,
        bool,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
    );
    for git_removed in [false, true] {
        let repo = repo();
        let root = repo.0.join("repo");
        let tree = create(&root, "feature", "main", false).unwrap();
        let main = list(&root).unwrap().remove(0).path;
        let db = repo.0.join("sessions.db");
        {
            let store = SessionStore::open(db.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            conn.execute(
                "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, created_at, updated_at, branch, provider_session_id, context_used, context_window)
                 VALUES ('s1', ?1, 'codex', 'test', 'supervised', 'Keep title', 10, 20, 'feature', 'provider', 12, 100)",
                [&tree.path],
            ).unwrap();
            conn.execute(
                "INSERT INTO in_flight_sessions VALUES ('s1', ?1, 3)",
                [&tree.path],
            )
            .unwrap();
            prepare_removal(&conn, Path::new(&tree.path), &main, &["s1".into()]).unwrap();
            if git_removed {
                remove(&root, Path::new(&tree.path), true).unwrap();
            }
            // Drop the connection without finalizing, as on process exit.
        }
        let store = SessionStore::open(db).unwrap();
        let conn = store.lock_conn().unwrap();
        // Opening only fences the worktree; Git recovery runs after launch.
        let deferred: i64 = conn
            .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(deferred, 1);
        reconcile_removals(&conn).unwrap();
        let state: StoredContext = conn.query_row(
            "SELECT cwd, worktree_cwd, worktree_removed, branch, provider_session_id, context_used, context_window FROM sessions WHERE id = 's1'", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        ).unwrap();
        if git_removed {
            assert_eq!(state, (main, Some(tree.path), true, None, None, None, None));
        } else {
            assert_eq!(
                state,
                (
                    tree.path.clone(),
                    None,
                    false,
                    Some("feature".into()),
                    Some("provider".into()),
                    Some(12),
                    Some(100)
                )
            );
            let in_flight: (String, i64) = conn
                .query_row(
                    "SELECT cwd, sort_index FROM in_flight_sessions WHERE session_id = 's1'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(in_flight, (tree.path, 3));
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn database_failures_keep_worktree_and_session_state_consistent() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "feature", "main", false).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    conn.execute(
        "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, created_at, updated_at)
         VALUES ('s1', ?1, 'codex', 'test', 'supervised', 'Keep title', 10, 20)",
        [&tree.path],
    ).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_prepare BEFORE INSERT ON worktree_removals
         BEGIN SELECT RAISE(ABORT, 'journal unavailable'); END;",
    )
    .unwrap();
    assert!(
        remove_with_sessions(|| Ok(&**conn), &root, Path::new(&tree.path), true, true).is_err()
    );
    assert!(Path::new(&tree.path).exists());
    assert_eq!(session_ids(&conn, Path::new(&tree.path)).unwrap(), ["s1"]);
    conn.execute_batch("DROP TRIGGER fail_prepare").unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_cleanup BEFORE DELETE ON worktree_removals
         BEGIN SELECT RAISE(ABORT, 'cleanup unavailable'); END;",
    )
    .unwrap();
    let removed =
        remove_with_sessions(|| Ok(&**conn), &root, Path::new(&tree.path), true, true).unwrap();
    assert_eq!(removed.session_ids, ["s1"]);
    assert!(!Path::new(&tree.path).exists());
    let detached: bool = conn
        .query_row(
            "SELECT worktree_removed FROM sessions WHERE id = 's1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(detached);
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktree_removals", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(pending, 1);
    conn.execute_batch("DROP TRIGGER fail_cleanup").unwrap();
    reconcile_removals(&conn).unwrap();
    let detached: bool = conn
        .query_row(
            "SELECT worktree_removed FROM sessions WHERE id = 's1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(detached);
}

#[test]
fn worktree_removal_releases_session_store_during_filesystem_removal() {
    struct Probe<'a> {
        conn: StoreConn<'a>,
        existed: bool,
        path: &'a Path,
        spanned: &'a std::cell::Cell<bool>,
    }
    impl std::ops::Deref for Probe<'_> {
        type Target = rusqlite::Connection;
        fn deref(&self) -> &rusqlite::Connection {
            &self.conn
        }
    }
    impl Drop for Probe<'_> {
        fn drop(&mut self) {
            if self.existed && !self.path.exists() {
                self.spanned.set(true);
            }
        }
    }
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "short-locks", "main", false).unwrap();
    let path = Path::new(&tree.path);
    let store = SessionStore::open_in_memory().unwrap();
    let spanned = std::cell::Cell::new(false);
    let locks = std::cell::Cell::new(0);
    remove_with_sessions(
        || {
            locks.set(locks.get() + 1);
            Ok(Probe {
                conn: store.lock_conn().map(StoreConn)?,
                existed: path.exists(),
                path,
                spanned: &spanned,
            })
        },
        &root,
        path,
        true,
        true,
    )
    .unwrap();
    assert!(!path.exists());
    assert!(
        !spanned.get(),
        "a session store lock spanned the directory removal"
    );
    assert!(locks.get() >= 3);
}

#[test]
fn startup_defers_removal_recovery_and_keeps_unlistable_rows_pending() {
    let repo = repo();
    let missing_root = repo.0.join("moved-project");
    let blocked = repo.0.join("orphan-worktree");
    std::fs::create_dir_all(blocked.join(".git")).unwrap();
    let legacy = repo.0.join("legacy-worktree");
    let database = repo.0.join("startup-recovery.db");
    {
        let store = SessionStore::open(database.clone()).unwrap();
        let conn = store.lock_conn().unwrap();
        let current = serde_json::json!({
            "project_cwd": path_to_js(&missing_root),
            "sessions": [],
        });
        conn.execute(
            "INSERT INTO worktree_removals (path, sessions_json) VALUES (?1, ?2), (?3, '[]'), ('bad', 'not json')",
            rusqlite::params![path_to_js(&blocked), current.to_string(), path_to_js(&legacy)],
        )
        .unwrap();
    }
    // Opening must neither run Git nor fail on an unreachable project root or
    // a corrupt journal; it only fences process starts in pending worktrees.
    let store = SessionStore::open(database).unwrap();
    assert!(crate::worktree_lifecycle::reserve_spawn(&blocked).is_err());
    let conn = store.lock_conn().unwrap();
    let pending = |conn: &rusqlite::Connection| -> Vec<String> {
        conn.prepare("SELECT path FROM worktree_removals ORDER BY path")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    assert_eq!(pending(&conn).len(), 3);
    // The deferred pass settles what it can and leaves the rest for a retry.
    reconcile_removals(&conn).unwrap();
    let mut expected = vec![path_to_js(&blocked), "bad".to_string()];
    expected.sort();
    assert_eq!(pending(&conn), expected);
    assert!(crate::worktree_lifecycle::reserve_spawn(&blocked).is_err());
}
#[test]
fn live_editor_registry_allows_cleanup_before_the_first_report() {
    let store = SessionStore::open_in_memory().unwrap();
    let buffers = crate::native_workspace::editor_buffers::EditorBuffers::default();
    let terminals = crate::pty::PtyHost::new();
    let agents = crate::harness::HarnessHost::new();
    let check = || {
        managed_cleanup_local_check(
            &store,
            &terminals,
            &agents,
            &buffers,
            "workspace",
            Path::new("/fixture"),
        )
    };
    assert!(check().is_ok());
    buffers.report(
        "main",
        &serde_json::from_value::<Vec<_>>(serde_json::json!([
            {"path":"/fixture-sibling/dirty.txt","dirty":true},
            {"path":"/fixture/clean.txt","dirty":false}
        ]))
        .unwrap(),
    );
    assert!(check().is_ok());
    buffers.report(
        "secondary",
        &serde_json::from_value::<Vec<_>>(serde_json::json!([
            {"path":"/fixture/dirty.txt","dirty":true}
        ]))
        .unwrap(),
    );
    assert!(check().unwrap_err().contains("unsaved workspace files"));
    buffers.clear("secondary");
    assert!(check().is_ok());
}

#[test]
fn local_removal_refuses_unsaved_editors_of_any_window() {
    use crate::native_workspace::editor_buffers::EditorBuffers;
    use crate::native_workspace::BufferState;
    let editors = EditorBuffers::default();
    let tree = std::path::Path::new("/repo-trees/feature");
    assert!(refuse_unsaved_editors(&editors, tree).is_ok());
    editors.report(
        "second-window",
        &[serde_json::from_value::<BufferState>(
            serde_json::json!({"path": "/repo-trees/feature/README.md", "dirty": true}),
        )
        .unwrap()],
    );
    assert!(refuse_unsaved_editors(&editors, tree)
        .unwrap_err()
        .contains("unsaved files"));
    assert!(
        refuse_unsaved_editors(&editors, std::path::Path::new("/repo-trees/feature-2")).is_ok()
    );
    editors.clear("second-window");
    assert!(refuse_unsaved_editors(&editors, tree).is_ok());
}

fn branch_exists(root: &Path, branch: &str) -> bool {
    git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_ok()
}

#[test]
fn delete_branch_removes_a_merged_branch_after_removal() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "merged-branch", "main", false).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let removed = remove_with_branch(
        || Ok(&**conn),
        &root,
        Path::new(&tree.path),
        true,
        true,
        true,
    )
    .unwrap();
    assert!(!Path::new(&tree.path).exists());
    assert!(!branch_exists(&root, "merged-branch"));
    assert!(removed.branch_notice.is_none());
}

#[test]
fn delete_branch_keeps_an_unmerged_branch_and_reports() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "unmerged-branch", "main", false).unwrap();
    git_checked(
        Path::new(&tree.path),
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "unmerged work",
        ],
    )
    .unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let removed = remove_with_branch(
        || Ok(&**conn),
        &root,
        Path::new(&tree.path),
        true,
        true,
        true,
    )
    .unwrap();
    assert!(!Path::new(&tree.path).exists());
    assert!(branch_exists(&root, "unmerged-branch"));
    assert!(removed.branch_notice.is_some());
}

#[test]
fn removal_keeps_the_branch_by_default() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "kept-branch", "main", false).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let removed = remove_with_branch(
        || Ok(&**conn),
        &root,
        Path::new(&tree.path),
        true,
        true,
        false,
    )
    .unwrap();
    assert!(branch_exists(&root, "kept-branch"));
    assert!(removed.branch_notice.is_none());
}

#[test]
fn light_probe_reports_missing_without_git_state() {
    let repo = repo();
    let present = light_probe(&repo.0.join("repo"));
    assert!(!present.missing);
    assert!(present.dirty.is_none() && present.unpushed.is_none());
    let gone = light_probe(&repo.0.join("nope"));
    assert!(gone.missing);
}

#[test]
fn worktree_missing_folder_is_not_mistaken_for_a_managed_workspace() {
    let repo = repo();
    let root = repo.0.join("repo");
    let tree = create(&root, "by/hand-made-gone", "main", false).unwrap();
    let path = std::path::PathBuf::from(&tree.path);
    std::fs::remove_dir_all(&path).unwrap();
    // The marker is read from the repository, so a deleted folder does not fail the check closed.
    assert!(!branch_is_managed(&root, "by/hand-made-gone"));
    if let Err(error) = removal_target(&root, &path) {
        assert!(
            !error.contains("Host workspace cleanup plan/apply"),
            "{error}"
        );
    }
}
