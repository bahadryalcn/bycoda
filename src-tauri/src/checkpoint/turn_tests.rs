// Included in the existing checkpoint test module to reuse its isolated fixtures.

#[test]
fn turn_shared_review_includes_own_new_files_without_adopting_peer_edits() {
    let repo = tmp("turn-own-new");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("first", &cwd, "one").unwrap();
    store.begin_turn("peer", &cwd, "two").unwrap();
    std::fs::write(repo.0.join("new.txt"), "new\n").unwrap();
    // Some providers report the created path only at tool completion.
    store.capture("first", &cwd, &["new.txt".into()]).unwrap();
    store.prepare("peer", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "peer\n").unwrap();
    store.capture("peer", &cwd, &["a.txt".into()]).unwrap();
    store.finish_turn("first", &cwd, "one", false).unwrap();
    store.finish_turn("peer", &cwd, "two", false).unwrap();
    let status = store.status("first", &cwd).unwrap();
    assert_eq!(relatives(&status), vec!["new.txt"]);
    assert_eq!(status.files[0].status, "added");
    assert_eq!(
        store.file_diff("first", &cwd, "new.txt").unwrap().current,
        "new\n"
    );
    assert_eq!(
        relatives(&store.status("peer", &cwd).unwrap()),
        vec!["a.txt"]
    );
}

#[test]
fn turn_tool_start_preserves_owner_edits_made_after_turn_start() {
    let repo = tmp("turn-tool-boundary");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("session", &cwd, "one").unwrap();
    std::fs::write(repo.0.join("a.txt"), "owner\n").unwrap();
    store.prepare("session", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    store.capture("session", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("owner-only.txt"), "owner file\n").unwrap();
    store.finish_turn("session", &cwd, "one", false).unwrap();
    assert_eq!(
        relatives(&store.status("session", &cwd).unwrap()),
        vec!["a.txt"]
    );
    assert_eq!(
        store.file_diff("session", &cwd, "a.txt").unwrap().original,
        "owner\n"
    );
    store.undo("session", &cwd, None).unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "owner\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("owner-only.txt")).unwrap(),
        "owner file\n"
    );
}

#[test]
fn turn_native_host_overlap_remains_unsafe_after_both_finish() {
    let repo = tmp("turn-host-overlap");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    std::fs::create_dir_all(&store.leases).unwrap();
    let host = store.leases.join("host-peer-turn.json");
    std::fs::write(
        &host,
        serde_json::to_vec(&serde_json::json!({
            "owner": "host", "sessionId": "peer", "turnId": "turn", "cwd": cwd, "shared": false
        }))
        .unwrap(),
    )
    .unwrap();
    store.begin_turn("session", &cwd, "turn").unwrap();
    let lease: serde_json::Value = serde_json::from_slice(&std::fs::read(&host).unwrap()).unwrap();
    assert_eq!(lease["shared"], true);
    store.prepare("session", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    store.capture("session", &cwd, &["a.txt".into()]).unwrap();
    store.finish_turn("session", &cwd, "turn", false).unwrap();
    std::fs::remove_file(host).unwrap();
    assert!(!store.status("session", &cwd).unwrap().files[0].undoable);
    assert!(store.undo("session", &cwd, None).is_err());
    assert_eq!(std::fs::read_dir(&store.leases).unwrap().count(), 0);
}

#[test]
fn turn_structured_capture_does_not_adopt_later_external_changes() {
    let repo = tmp("turn-later-structured");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("session", &cwd, "turn").unwrap();
    store.prepare("session", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    store.capture("session", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "owner\n").unwrap();
    store.finish_turn("session", &cwd, "turn", false).unwrap();
    assert!(!store.status("session", &cwd).unwrap().files[0].undoable);
    assert_eq!(
        store.file_diff("session", &cwd, "a.txt").unwrap().current,
        "agent\n"
    );
    assert!(store.undo("session", &cwd, None).is_err());
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "owner\n"
    );
}

#[test]
fn turn_later_shell_edits_keep_cumulative_ownership() {
    let repo = tmp("turn-cumulative");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    for (turn, contents) in [("one", "first\n"), ("two", "second\n")] {
        store.begin_turn("session", &cwd, turn).unwrap();
        std::fs::write(repo.0.join("a.txt"), contents).unwrap();
        store.finish_turn("session", &cwd, turn, false).unwrap();
    }
    assert!(store.status("session", &cwd).unwrap().files[0].undoable);
    store.undo("session", &cwd, None).unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "base\n"
    );
}

#[test]
fn turn_non_git_and_failed_baseline_release_membership_only_on_settlement() {
    let repo = tmp("turn-failed-baseline");
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("session", &cwd, "plain").unwrap();
    assert!(store
        .file_diff("session", &cwd, "a.txt")
        .unwrap_err()
        .contains("still recording"));
    store.finish_turn("session", &cwd, "plain", false).unwrap();
    assert_eq!(std::fs::read_dir(&store.leases).unwrap().count(), 0);
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    assert!(git(&repo.0, &["config", "core.sparseCheckout", "true"]));
    let error = store.begin_turn("session", &cwd, "failed").unwrap_err();
    assert!(error.contains("sparse checkouts"));
    assert_eq!(
        store.begin_turn("session", &cwd, "failed").unwrap_err(),
        error
    );
    assert!(store
        .file_diff("session", &cwd, "a.txt")
        .unwrap_err()
        .contains("Workspace checkpoint failed"));
    assert_eq!(std::fs::read_dir(&store.leases).unwrap().count(), 1);
    assert_eq!(
        store
            .finish_turn("session", &cwd, "failed", false)
            .unwrap_err(),
        error
    );
    assert!(store
        .file_diff("session", &cwd, "a.txt")
        .unwrap_err()
        .contains(&error));
    assert_eq!(std::fs::read_dir(&store.leases).unwrap().count(), 0);
    assert!(git(&repo.0, &["config", "core.sparseCheckout", "false"]));
    store.begin_turn("session", &cwd, "recovered").unwrap();
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    store
        .finish_turn("session", &cwd, "recovered", false)
        .unwrap();
    assert!(store.status("session", &cwd).unwrap().files[0].undoable);
    store.undo("session", &cwd, None).unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "base\n"
    );
}

#[test]
fn turn_shell_changes_preserve_dirty_bytes_and_real_staging() {
    let repo = tmp("turn-shell");
    assert!(init_git_commit(
        &repo.0,
        &[
            ("a.txt", "base\n"),
            ("deleted.txt", "keep\n"),
            ("shell.txt", "old\n")
        ]
    ));
    std::fs::write(repo.0.join("a.txt"), "owner staged\r\n").unwrap();
    assert!(git(&repo.0, &["add", "--", "a.txt"]));
    std::fs::write(repo.0.join("a.txt"), "owner staged\r\nowner unstaged\r\n").unwrap();
    let index = std::fs::read(repo.0.join(".git/index")).unwrap();
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("session", &cwd, "turn").unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        assert!(std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "echo shell>shell.txt"])
            .current_dir(&repo.0)
            .creation_flags(0x08000000)
            .status()
            .unwrap()
            .success());
    }
    #[cfg(not(windows))]
    assert!(std::process::Command::new("sh")
        .args(["-c", "printf 'shell\\n' >shell.txt"])
        .current_dir(&repo.0)
        .status()
        .unwrap()
        .success());
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    std::fs::write(repo.0.join("new.txt"), "new\n").unwrap();
    std::fs::remove_file(repo.0.join("deleted.txt")).unwrap();
    store.finish_turn("session", &cwd, "turn", false).unwrap();
    let status = store.status("session", &cwd).unwrap();
    assert_eq!(
        relatives(&status),
        vec!["a.txt", "deleted.txt", "new.txt", "shell.txt"]
    );
    assert!(status.files.iter().all(|f| f.undoable));
    assert_eq!(std::fs::read(repo.0.join(".git/index")).unwrap(), index);
    store.undo("session", &cwd, None).unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "owner staged\r\nowner unstaged\r\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("deleted.txt")).unwrap(),
        "keep\n"
    );
    assert!(!repo.0.join("new.txt").exists());
    assert_eq!(std::fs::read(repo.0.join(".git/index")).unwrap(), index);
}

#[test]
fn turn_structured_edit_and_shell_review_stay_exact() {
    let repo = tmp("turn-structured");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("session", &cwd, "turn").unwrap();
    store.prepare("session", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "structured\n").unwrap();
    store.capture("session", &cwd, &["a.txt".into()]).unwrap();
    store.finish_turn("session", &cwd, "turn", false).unwrap();
    assert!(store.status("session", &cwd).unwrap().files[0].exact);
    assert!(store.status("session", &cwd).unwrap().files[0].undoable);
}

#[test]
fn turn_head_and_later_edit_guards_never_overwrite_owner_work() {
    let repo = tmp("turn-head");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("session", &cwd, "turn").unwrap();
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    store.finish_turn("session", &cwd, "turn", false).unwrap();
    std::fs::write(repo.0.join("a.txt"), "owner\n").unwrap();
    assert!(store.undo("session", &cwd, None).is_err());
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "owner\n"
    );
    std::fs::write(repo.0.join("a.txt"), "agent\n").unwrap();
    std::fs::write(repo.0.join("other.txt"), "head\n").unwrap();
    assert!(git(&repo.0, &["add", "--", "other.txt"]));
    assert!(git(&repo.0, &["commit", "-m", "move HEAD"]));
    assert!(!store.status("session", &cwd).unwrap().files[0].undoable);
    assert!(store
        .undo("session", &cwd, None)
        .unwrap_err()
        .contains("HEAD changed"));
}

#[test]
fn turn_overlap_and_interrupted_continuation_remain_locked() {
    let repo = tmp("turn-overlap");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("first", &cwd, "one").unwrap();
    store.begin_turn("second", &cwd, "two").unwrap();
    store.prepare("first", &cwd, &["a.txt".into()]).unwrap();
    std::fs::write(repo.0.join("a.txt"), "shared\n").unwrap();
    store.capture("first", &cwd, &["a.txt".into()]).unwrap();
    store.finish_turn("first", &cwd, "one", false).unwrap();
    assert!(!store.status("first", &cwd).unwrap().files[0].undoable);
    assert!(store.undo("first", &cwd, None).is_err());
    store.finish_turn("second", &cwd, "two", false).unwrap();
    store.keep("first", &cwd, None).unwrap();
    store.begin_turn("first", &cwd, "crashed").unwrap();
    std::fs::write(repo.0.join("a.txt"), "partial\n").unwrap();
    store.begin_turn("first", &cwd, "resumed").unwrap();
    std::fs::write(repo.0.join("a.txt"), "resumed\n").unwrap();
    store.finish_turn("first", &cwd, "crashed", false).unwrap();
    assert!(store.status("first", &cwd).is_err());
    store.finish_turn("first", &cwd, "resumed", false).unwrap();
    assert_eq!(
        store.file_diff("first", &cwd, "a.txt").unwrap().current,
        "resumed\n"
    );
    assert!(store.undo("first", &cwd, None).is_err());
}

#[test]
fn turn_literal_names_and_sibling_checkouts_stay_independent() {
    let repo = tmp("turn-literal");
    let sibling = tmp("turn-literal-sibling");
    assert!(init_git_commit(
        &repo.0,
        &[("[ab].txt", "literal\n"), ("a.txt", "other\n")]
    ));
    assert!(init_git_commit(&sibling.0, &[("a.txt", "sibling\n")]));
    let cwd = repo.0.to_string_lossy().into_owned();
    let other = sibling.0.to_string_lossy().into_owned();
    let (_tmp, store) = store();
    store.begin_turn("first", &cwd, "one").unwrap();
    store.begin_turn("second", &other, "two").unwrap();
    std::fs::write(repo.0.join("[ab].txt"), "agent\n").unwrap();
    store.finish_turn("first", &cwd, "one", false).unwrap();
    assert!(store.status("first", &cwd).unwrap().files[0].undoable);
    store.undo("first", &cwd, Some("[ab].txt")).unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.0.join("[ab].txt")).unwrap(),
        "literal\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
        "other\n"
    );
    assert!(resolve_repo_path(&repo.0, "../escape").is_err());
}

#[test]
fn turn_symlink_ancestor_cannot_escape_even_for_a_missing_leaf() {
    let repo = tmp("turn-path");
    let outside = tmp("turn-path-outside");
    assert!(init_git_commit(&repo.0, &[("a.txt", "base\n")]));
    std::fs::write(outside.0.join("a.txt"), "outside\n").unwrap();
    let link = repo.0.join("escape");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        assert!(std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside.0)
            .creation_flags(0x08000000)
            .status()
            .unwrap()
            .success());
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside.0, &link).unwrap();
    assert!(resolve_repo_path(&repo.0, "escape/a.txt").is_err());
    assert!(resolve_repo_path(&repo.0, "escape/missing.txt").is_err());
    assert_eq!(
        std::fs::read_to_string(outside.0.join("a.txt")).unwrap(),
        "outside\n"
    );
}
