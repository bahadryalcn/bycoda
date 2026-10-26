use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::fs::{expand_home, git_checked, git_diff_files_for, path_to_js, resolve_repo_path};
use crate::session_store::SessionStore;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
    pub missing: bool,
    pub dirty: Option<bool>,
    pub unpushed: Option<u64>,
    pub session_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktrees {
    pub worktrees: Vec<Worktree>,
    pub default_root: String,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.env("PATH", crate::harness::cached_gui_search_path());
    crate::hide_window_console(&mut command);
    let output = crate::fs::git_cmd_output(
        command
            .arg("-C")
            .arg(root)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0"),
    )
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    String::from_utf8(output.stdout).map_err(|_| "Git returned a non-UTF-8 path".into())
}

fn parse_worktrees(text: &str) -> Vec<Worktree> {
    let mut result = Vec::new();
    let mut current = Worktree::default();
    for field in text.split('\0') {
        if field.is_empty() {
            if !current.path.is_empty() {
                current.is_main = result.is_empty();
                result.push(std::mem::take(&mut current));
            }
        } else if let Some(path) = field.strip_prefix("worktree ") {
            current.path = path_to_js(Path::new(path));
        } else if let Some(head) = field.strip_prefix("HEAD ") {
            current.head = head.into();
        } else if let Some(branch) = field.strip_prefix("branch refs/heads/") {
            current.branch = Some(branch.into());
        } else if field == "locked" || field.starts_with("locked ") {
            current.locked = true;
        } else if field == "prunable" || field.starts_with("prunable ") {
            current.prunable = true;
        }
    }
    result
}

fn list(root: &Path) -> Result<Vec<Worktree>, String> {
    Ok(parse_worktrees(&git(
        root,
        &["worktree", "list", "--porcelain", "-z"],
    )?))
}

fn same_path(a: &Path, b: &Path) -> bool {
    let a = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let b = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

pub(crate) fn contains_working_dir(root: &Path, cwd: &Path) -> bool {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    if cfg!(windows) {
        let root = path_to_js(&root).to_lowercase();
        let cwd = path_to_js(&cwd).to_lowercase();
        cwd == root || cwd.starts_with(&format!("{}/", root.trim_end_matches('/')))
    } else {
        cwd.starts_with(root)
    }
}

fn session_ids(conn: &rusqlite::Connection, path: &Path) -> Result<Vec<String>, String> {
    let mut query = conn
        .prepare("SELECT id, COALESCE(NULLIF(worktree_cwd, ''), cwd) FROM sessions WHERE worktree_removed = 0")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, cwd) = row.map_err(|e| e.to_string())?;
        let cwd = expand_home(&cwd);
        if contains_working_dir(path, &cwd) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn default_root(main: &Path) -> PathBuf {
    let name = main.file_name().unwrap_or_default().to_string_lossy();
    main.with_file_name(format!("{name}-worktrees"))
}

#[tauri::command(async)]
pub fn git_worktrees(cwd: String, store: State<'_, SessionStore>) -> Result<Worktrees, String> {
    let mut worktrees = list(&expand_home(&cwd))?;
    let main = worktrees.first().ok_or("No working copies found")?;
    let default_root = path_to_js(&default_root(Path::new(&main.path)));
    {
        let conn = store.lock_conn()?;
        for tree in &mut worktrees {
            tree.session_ids = session_ids(&conn, Path::new(&tree.path))?;
        }
    }
    for tree in &mut worktrees {
        let path = Path::new(&tree.path);
        tree.missing = !path.is_dir();
        if !tree.missing {
            tree.dirty = git(path, &["status", "--porcelain", "--untracked-files=normal"])
                .ok()
                .map(|status| !status.is_empty());
            tree.unpushed = git(path, &["rev-list", "--count", "HEAD", "--not", "--remotes"])
                .ok()
                .and_then(|count| count.trim().parse().ok());
        }
    }
    Ok(Worktrees {
        worktrees,
        default_root,
    })
}

fn create(root: &Path, branch: &str, base: &str, existing: bool) -> Result<Worktree, String> {
    let branch = branch.trim();
    if branch.starts_with('-') || branch.starts_with('@') || branch.is_empty() {
        return Err("Enter a valid branch name".into());
    }
    git(root, &["check-ref-format", "--branch", branch])?;
    let trees = list(root)?;
    if trees
        .iter()
        .any(|tree| tree.branch.as_deref() == Some(branch))
    {
        return Err("This branch already has a working copy. Select it from the picker.".into());
    }
    let main = trees.first().ok_or("No working copies found")?;
    let parent = default_root(Path::new(&main.path));
    let slug: String = branch
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let path = parent.join(slug);
    if path.exists() {
        return Err(format!(
            "{} already exists. Choose another branch name.",
            path.display()
        ));
    }
    // Resolve user-supplied refs before passing them to worktree add. Never
    // interpret a ref as an option, and only accept existing local branches.
    let source = if existing {
        format!("refs/heads/{branch}")
    } else {
        base.trim().to_owned()
    };
    let commit = git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{source}^{{commit}}"),
        ],
    )?;
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let path_str = path_to_js(&path);
    if existing {
        git_checked(root, &["worktree", "add", "--", &path_str, branch])?;
    } else {
        git_checked(
            root,
            &[
                "worktree",
                "add",
                "--no-track",
                "-b",
                branch,
                "--",
                &path_str,
                commit.trim(),
            ],
        )?;
    }
    list(root)?
        .into_iter()
        .find(|tree| same_path(Path::new(&tree.path), &path))
        .ok_or_else(|| {
            "Worktree created, but could not be found. Refresh the working copies.".into()
        })
}

#[tauri::command(async)]
pub async fn git_worktree_create(
    cwd: String,
    branch: String,
    base: String,
    existing: bool,
) -> Result<Worktree, String> {
    crate::fs::spawn_git_mutation(cwd, move |root| create(root, &branch, &base, existing))
        .await
        .map_err(|error| error.to_string())?
}

fn copy_checkout_state(source: &Path, target: &Path) -> Result<(), String> {
    for file in git_diff_files_for(source).files {
        let relative = resolve_repo_path(source, &file.relative)?;
        let from = source.join(&relative);
        let to = target.join(&relative);
        if path_contains_symlink(source, &relative) || path_contains_symlink(target, &relative) {
            return Err(format!(
                "Cannot seed orchestration worktree: {relative} contains a symbolic link"
            ));
        }
        match std::fs::symlink_metadata(&from) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() => {
                return Err(format!(
                    "Cannot seed orchestration worktree: {relative} is not a regular file"
                ));
            }
            Ok(meta) => {
                if let Some(parent) = to.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
                std::fs::set_permissions(&to, meta.permissions()).map_err(|e| e.to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if to.is_file() || to.is_symlink() {
                    std::fs::remove_file(&to).map_err(|e| e.to_string())?;
                } else if to.exists() {
                    return Err(format!(
                        "Cannot seed orchestration worktree: {relative} is a directory"
                    ));
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
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

#[cfg(unix)]
fn file_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::symlink_metadata(path)
        .ok()
        .map(|meta| meta.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn file_mode(_path: &Path) -> Option<u32> {
    None
}

fn checkout_state_matches(source: &Path, target: &Path) -> bool {
    let source_files = git_diff_files_for(source).files;
    let target_files = git_diff_files_for(target).files;
    let source_paths: Vec<&str> = source_files
        .iter()
        .map(|file| file.relative.as_str())
        .collect();
    let target_paths: Vec<&str> = target_files
        .iter()
        .map(|file| file.relative.as_str())
        .collect();
    if source_paths != target_paths {
        return false;
    }
    source_paths.into_iter().all(|relative| {
        if path_contains_symlink(source, relative) || path_contains_symlink(target, relative) {
            return false;
        }
        let from = source.join(relative);
        let to = target.join(relative);
        match (
            std::fs::symlink_metadata(&from),
            std::fs::symlink_metadata(&to),
        ) {
            (Err(left), Err(right))
                if left.kind() == std::io::ErrorKind::NotFound
                    && right.kind() == std::io::ErrorKind::NotFound =>
            {
                true
            }
            (Ok(left), Ok(right)) if left.is_file() && right.is_file() => {
                file_mode(&from) == file_mode(&to)
                    && matches!(
                        (std::fs::read(from), std::fs::read(to)),
                        (Ok(left), Ok(right)) if left == right
                    )
            }
            _ => false,
        }
    })
}

fn create_seeded(root: &Path, branch: &str) -> Result<Worktree, String> {
    if let Some(tree) = list(root)?
        .into_iter()
        .find(|tree| tree.branch.as_deref() == Some(branch))
    {
        let source_head = git(root, &["rev-parse", "HEAD"])?;
        if tree.head != source_head.trim() || !checkout_state_matches(root, Path::new(&tree.path)) {
            return Err(format!(
                "The recovered orchestration worktree for {branch} is incomplete or has unexpected changes. It was kept for manual review."
            ));
        }
        return Ok(tree);
    }
    let branch_ref = format!("refs/heads/{branch}");
    let branch_exists = git(root, &["rev-parse", "--verify", &branch_ref]).is_ok();
    if branch_exists {
        let head = git(root, &["rev-parse", "HEAD"])?;
        let branch_head = git(root, &["rev-parse", &branch_ref])?;
        if head.trim() != branch_head.trim() {
            return Err(format!(
                "The recovery branch {branch} no longer starts at this checkout. Remove or rename it before retrying."
            ));
        }
    }
    let tree = create(root, branch, "HEAD", branch_exists)?;
    if let Err(error) = copy_checkout_state(root, Path::new(&tree.path)) {
        let _ = remove(root, Path::new(&tree.path), true);
        if !branch_exists {
            let _ = git(root, &["branch", "-D", branch]);
        }
        return Err(error);
    }
    Ok(tree)
}

/// Create an isolated worker checkout with the lead checkout's current file
/// contents as its baseline. Reusing the deterministic branch makes a crash
/// between Git creation and run-state persistence recoverable.
#[tauri::command(async)]
pub async fn git_orchestration_worktree_create(
    cwd: String,
    branch: String,
) -> Result<Worktree, String> {
    crate::fs::spawn_git_mutation(cwd, move |root| create_seeded(root, branch.trim()))
        .await
        .map_err(|error| error.to_string())?
}

fn rename_branch(root: &Path, path: &Path, branch: &str) -> Result<Worktree, String> {
    let branch = branch.trim();
    if branch.starts_with('-') || branch.starts_with('@') || branch.is_empty() {
        return Err("Enter a valid branch name".into());
    }
    git(root, &["check-ref-format", "--branch", branch])?;
    let tree = list(root)?
        .into_iter()
        .find(|tree| same_path(Path::new(&tree.path), path))
        .ok_or("This path is not a registered worktree of this repository")?;
    if tree.is_main {
        return Err("The main working copy cannot be renamed here".into());
    }
    let current = tree.branch.as_deref().ok_or("The worktree is detached")?;
    if !current.starts_with("mc/") && !current.starts_with("bycoda/") {
        return Err("Only automatically created worktree branches can be renamed".into());
    }
    if current == branch {
        return Ok(tree);
    }
    git(Path::new(&tree.path), &["branch", "-m", branch])?;
    list(root)?
        .into_iter()
        .find(|entry| same_path(Path::new(&entry.path), path))
        .ok_or_else(|| "Branch renamed, but its worktree could not be found".into())
}

#[tauri::command(async)]
pub async fn git_worktree_rename_branch(
    cwd: String,
    path: String,
    branch: String,
) -> Result<Worktree, String> {
    crate::fs::spawn_git_mutation(cwd, move |root| {
        rename_branch(root, &expand_home(&path), &branch)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn removal_target(root: &Path, path: &Path) -> Result<Worktree, String> {
    crate::worktree_lifecycle::validate_removal_path(path)?;
    let tree = list(root)?
        .into_iter()
        .find(|tree| same_path(Path::new(&tree.path), path))
        .ok_or("This path is not a registered worktree of this repository")?;
    if tree.is_main {
        return Err("The main working copy cannot be deleted".into());
    }
    if tree.locked {
        return Err("This worktree is locked. Unlock it in Git before deleting it.".into());
    }
    if tree.branch.is_none() {
        // There is no branch retaining detached commits after removal.
        return Err("Create a branch for this detached worktree before deleting it.".into());
    }
    let reserved_directory = Path::new(&tree.path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.strip_prefix("wt-").is_some_and(|id| {
                id.len() == 12 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
        });
    if reserved_directory
        || tree.branch.as_deref().is_some_and(|branch| {
            branch.starts_with("bycoda/s/") || branch.starts_with("bycoda/t/")
        })
    {
        return Err(
            "Managed workspaces must be removed through Host workspace cleanup plan/apply.".into(),
        );
    }
    Ok(tree)
}

fn assert_legacy_workspace(conn: &rusqlite::Connection, path: &Path) -> Result<(), String> {
    let mut statement = conn.prepare("SELECT COALESCE(NULLIF(worktree_cwd,''),cwd) FROM sessions WHERE workspace_id IS NOT NULL").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for row in rows {
        if same_path(Path::new(&row.map_err(|e| e.to_string())?), path) {
            return Err(
                "Managed workspaces must be removed through Host workspace cleanup plan/apply."
                    .into(),
            );
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn git_worktree_check_remove(
    cwd: String,
    path: String,
    force: bool,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
) -> Result<(), String> {
    let path = expand_home(&path);
    assert_legacy_workspace(&*store.lock_conn()?, &path)?;
    check_removal(
        &expand_home(&cwd),
        &path,
        force,
        terminals.has_working_dir(&path),
    )
}

fn check_removal(root: &Path, path: &Path, force: bool, has_terminals: bool) -> Result<(), String> {
    let tree = removal_target(root, path)?;
    if has_terminals {
        return Err("Close the terminals using this worktree first.".into());
    }
    // Sessions and their agents still exist during preflight. The actual
    // removal below checks them again after the session deletion lifecycle.
    if !force
        && !git(
            Path::new(&tree.path),
            &[
                "-c",
                "core.longpaths=true",
                "status",
                "--porcelain",
                "--untracked-files=normal",
            ],
        )?
        .is_empty()
    {
        return Err("This worktree has uncommitted or untracked changes.".into());
    }
    Ok(())
}

/// An optimistic snapshot, compared again while the native removal reservation is held.
/// External Git/filesystem writers do not participate in that reservation.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeRemovalReview {
    project_cwd: String,
    common_dir: String,
    path: String,
    branch: Option<String>,
    head: String,
    status: String,
    unpushed: u64,
    session_ids: Vec<String>,
    has_terminals: bool,
    has_agents: bool,
}

fn removal_review(
    conn: &rusqlite::Connection,
    root: &Path,
    path: &Path,
    has_terminals: bool,
    has_agents: bool,
) -> Result<WorktreeRemovalReview, String> {
    assert_legacy_workspace(conn, path)?;
    let tree = removal_target(root, path)?;
    let trees = list(root)?;
    let main = trees.first().ok_or("No working copies found")?;
    let status = git(path, &["status", "--porcelain", "--untracked-files=normal"])?;
    if status.len() > 1024 * 1024 {
        return Err("Worktree status exceeds the removal review budget".into());
    }
    let unpushed = git(path, &["rev-list", "--count", "HEAD", "--not", "--remotes"])?
        .trim()
        .parse::<u64>()
        .map_err(|_| "Cannot verify unpublished commits")?;
    let mut session_ids = session_ids(conn, path)?;
    session_ids.sort();
    if session_ids.len() > 500 {
        return Err("Too many linked sessions to review".into());
    }
    Ok(WorktreeRemovalReview {
        project_cwd: path_to_js(
            &expand_home(&main.path)
                .canonicalize()
                .map_err(|e| e.to_string())?,
        ),
        common_dir: git(
            root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?
        .trim()
        .to_owned(),
        path: path_to_js(&path.canonicalize().map_err(|e| e.to_string())?),
        branch: tree.branch,
        head: tree.head,
        status,
        unpushed,
        session_ids,
        has_terminals,
        has_agents,
    })
}

fn assert_removal_review(
    expected: &WorktreeRemovalReview,
    current: &WorktreeRemovalReview,
) -> Result<(), String> {
    if expected != current {
        return Err("Worktree changed. Review it again before removing it.".into());
    }
    if !current.status.is_empty()
        || current.unpushed != 0
        || current.has_terminals
        || current.has_agents
    {
        return Err("Worktree has changes, unpublished commits, or active processes.".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn git_worktree_removal_review(
    cwd: String,
    path: String,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
    agents: State<'_, crate::harness::HarnessHost>,
) -> Result<WorktreeRemovalReview, String> {
    let path = expand_home(&path);
    let conn = store.lock_conn()?;
    removal_review(
        &conn,
        &expand_home(&cwd),
        &path,
        terminals.has_working_dir(&path),
        agents.has_working_dir(&path),
    )
}

fn remove(root: &Path, path: &Path, force: bool) -> Result<(), String> {
    let result = remove_inner(root, path, force);
    if result.is_ok() {
        crate::worktree_lifecycle::finish_removal_recovery(path);
    }
    result
}

fn remove_inner(root: &Path, path: &Path, force: bool) -> Result<(), String> {
    crate::worktree_lifecycle::validate_removal_path(path)?;
    if !list(root)?
        .iter()
        .any(|entry| same_path(Path::new(&entry.path), path))
    {
        return recover_remnants(root, path);
    }
    let tree = removal_target(root, path)?;
    let path = Path::new(&tree.path);
    crate::worktree_lifecycle::validate_removal_path(path)?;
    if path.try_exists().map_err(|e| e.to_string())? {
        // Status is read before detaching anything; failure is unknown, never clean.
        let status = git(
            path,
            &[
                "-c",
                "core.longpaths=true",
                "status",
                "--porcelain",
                "--untracked-files=all",
            ],
        )?;
        if !force && !status.is_empty() {
            return Err("Cleanup blocked: uncommitted changes".into());
        }
        let links = removal_links(path)?;
        persist_native_removal(root, &tree)?;
        crate::worktree_lifecycle::block_removal_recovery(path);
        for link in &links {
            detach_removal_link(link)?;
        }
        preserve_removal_evidence(root, path)?;
        // A tracked symlink is now absent, but its committed state is retained on
        // the local branch. The original source status was checked above.
        return git_remove_and_reconcile(root, &tree, force || !links.is_empty());
    }
    persist_native_removal(root, &tree)?;
    crate::worktree_lifecycle::block_removal_recovery(path);
    git_remove_and_reconcile(root, &tree, force)
}

fn persist_native_removal(root: &Path, tree: &Worktree) -> Result<(), String> {
    let journal = removal_journal_directory(root)?;
    std::fs::create_dir_all(&journal).map_err(|e| e.to_string())?;
    let receipt = journal.join(format!("{}.json", uuid::Uuid::new_v4()));
    let saved = NativeRemovalJournal {
        path: tree.path.clone(),
        branch: tree
            .branch
            .clone()
            .ok_or("Cannot retain a detached worktree")?,
        head: tree.head.clone(),
        manifest: native_removal_manifest(Path::new(&tree.path))?,
    };
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&receipt)
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&file, &saved).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

fn git_remove_and_reconcile(root: &Path, tree: &Worktree, force: bool) -> Result<(), String> {
    // Git for Windows can unregister the worktree even when MAX_PATH prevents
    // deleting its contents. Enable long paths for this invocation only.
    let mut args = vec!["-c", "core.longpaths=true", "worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.extend(["--", tree.path.as_str()]);
    let result = git_checked(root, &args);
    let registered = list(root)?.iter().any(|entry| entry.path == tree.path);
    if !registered {
        return recover_remnants(root, Path::new(&tree.path));
    }
    result.and_then(|_| {
        Err(
            "Worktree removal left its Git registration; retry after releasing locked handles"
                .into(),
        )
    })
}

#[derive(Serialize, Deserialize)]
struct NativeRemovalJournal {
    path: String,
    branch: String,
    head: String,
    #[serde(default)]
    manifest: std::collections::BTreeMap<String, String>,
}

fn native_removal_manifest(
    root: &Path,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut manifest = std::collections::BTreeMap::new();
    if !root.try_exists().map_err(|e| e.to_string())? {
        return Ok(manifest);
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        crate::worktree_lifecycle::validate_removal_path(&directory)?;
        for entry in std::fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            let key = path_to_js(path.strip_prefix(root).map_err(|e| e.to_string())?);
            let fingerprint = if crate::worktree_lifecycle::is_link_or_reparse(&metadata) {
                validate_removal_link(&path)?;
                format!(
                    "link:{}",
                    std::fs::read_link(&path)
                        .map_err(|e| e.to_string())?
                        .display()
                )
            } else if metadata.is_dir() {
                pending.push(path);
                "directory".into()
            } else if metadata.is_file() {
                let mut options = std::fs::OpenOptions::new();
                options.read(true);
                #[cfg(windows)]
                {
                    use std::os::windows::fs::OpenOptionsExt;
                    options.custom_flags(
                        windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT,
                    );
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.custom_flags(libc::O_NOFOLLOW);
                }
                let mut file = options.open(&path).map_err(|e| e.to_string())?;
                let opened = file.metadata().map_err(|e| e.to_string())?;
                if !opened.is_file() || crate::worktree_lifecycle::is_link_or_reparse(&opened) {
                    return Err(
                        "Cleanup blocked: source entry changed while capturing removal".into(),
                    );
                }
                let mut hash = Sha256::new();
                let mut buffer = [0u8; 65536];
                loop {
                    let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
                    if count == 0 {
                        break;
                    }
                    hash.update(&buffer[..count]);
                }
                format!("file:{:x}", hash.finalize())
            } else {
                return Err("Cleanup blocked: unsupported remnant entry".into());
            };
            manifest.insert(key, fingerprint);
        }
    }
    Ok(manifest)
}

fn removal_journal_directory(root: &Path) -> Result<PathBuf, String> {
    crate::worktree_lifecycle::validate_removal_path(root)?;
    let common = git(
        root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let directory = Path::new(common.trim()).join("bycoda-worktree-removals");
    crate::worktree_lifecycle::validate_removal_path(&directory)?;
    Ok(directory)
}

fn native_removal_receipts(root: &Path, path: &Path) -> Result<Vec<PathBuf>, String> {
    let directory = removal_journal_directory(root)?;
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut receipts = Vec::new();
    for entry in entries {
        let receipt = entry.map_err(|e| e.to_string())?.path();
        crate::worktree_lifecycle::validate_removal_path(&receipt)?;
        let saved: NativeRemovalJournal =
            serde_json::from_slice(&std::fs::read(&receipt).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if path_to_js(path) == saved.path {
            receipts.push(receipt);
        }
    }
    Ok(receipts)
}

fn finish_native_removal_receipts(root: &Path, path: &Path) -> Result<(), String> {
    for receipt in native_removal_receipts(root, path)? {
        std::fs::remove_file(receipt).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn recover_remnants(root: &Path, path: &Path) -> Result<(), String> {
    let directory = removal_journal_directory(root)?;
    let entries = std::fs::read_dir(&directory)
        .map_err(|_| "This path is not a registered worktree of this repository".to_string())?;
    for entry in entries {
        let receipt = entry.map_err(|e| e.to_string())?.path();
        crate::worktree_lifecycle::validate_removal_path(&receipt)?;
        let saved: NativeRemovalJournal =
            serde_json::from_slice(&std::fs::read(&receipt).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if path_to_js(path) != saved.path {
            continue;
        }
        let branch = format!("refs/heads/{}", saved.branch);
        if git(
            root,
            &["rev-parse", "--verify", "--end-of-options", &branch],
        )?
        .trim()
            != saved.head
        {
            return Err("Cleanup blocked: recovery branch changed".into());
        }
        let current = native_removal_manifest(path)?;
        if current
            .iter()
            .any(|(path, fingerprint)| saved.manifest.get(path) != Some(fingerprint))
        {
            return Err("Cleanup blocked: directory remnants contain new or changed source".into());
        }
        remove_remnants(path)?;
        finish_native_removal_receipts(root, path)?;
        return Ok(());
    }
    Err("This path is not a registered worktree of this repository".into())
}

/// Preflight the complete tree before detaching any link. Unknown Windows reparse
/// tags (cloud placeholders, volume mounts, filters, etc.) are never traversed.
fn removal_links(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut links = Vec::new();
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        crate::worktree_lifecycle::validate_removal_path(&directory)?;
        for entry in std::fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if crate::worktree_lifecycle::is_link_or_reparse(&metadata) {
                validate_removal_link(&path)?;
                links.push(path);
            } else if metadata.is_dir() {
                pending.push(path);
            } else if !metadata.is_file() {
                return Err(format!(
                    "Cleanup blocked: unsupported entry {}",
                    path.display()
                ));
            }
        }
    }
    Ok(links)
}

#[cfg(windows)]
fn validate_removal_link(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileAttributeTagInfo, GetFileInformationByHandleEx, FILE_ATTRIBUTE_TAG_INFO,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    let file = std::fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| format!("Cannot inspect reparse point {}: {e}", path.display()))?;
    let mut info: FILE_ATTRIBUTE_TAG_INFO = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileAttributeTagInfo,
            (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
            std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // IO_REPARSE_TAG_SYMLINK and IO_REPARSE_TAG_MOUNT_POINT. The latter is
    // accepted only for ordinary drive/UNC junction targets, not volume mounts.
    let target = std::fs::read_link(path).map_err(|e| e.to_string())?;
    let text = target.to_string_lossy().replace('/', "\\").to_lowercase();
    if info.ReparseTag != 0xa000000c
        && !(info.ReparseTag == 0xa0000003 && target.is_absolute() && !text.contains("volume{"))
    {
        return Err(format!(
            "Cleanup blocked: unknown or unsafe reparse point {}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn validate_removal_link(path: &Path) -> Result<(), String> {
    if !std::fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(format!(
            "Cleanup blocked: unsupported link {}",
            path.display()
        ));
    }
    Ok(())
}

fn detach_removal_link(path: &Path) -> Result<(), String> {
    crate::worktree_lifecycle::validate_removal_path(path.parent().ok_or("Link has no parent")?)?;
    validate_removal_link(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if metadata.file_attributes() & 0x10 != 0 {
            return std::fs::remove_dir(path).map_err(|e| e.to_string());
        }
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

fn preserve_removal_evidence(root: &Path, path: &Path) -> Result<(), String> {
    let evidence = path.join("temp");
    match std::fs::symlink_metadata(&evidence) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
        Ok(_) => {}
    }
    let common = git(
        root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let archive = Path::new(common.trim()).join("bycoda-worktree-evidence");
    crate::worktree_lifecycle::validate_removal_path(&archive)?;
    if archive.starts_with(path) {
        return Err("Cleanup blocked: evidence archive is inside the worktree".into());
    }
    std::fs::create_dir_all(&archive).map_err(|e| e.to_string())?;
    let destination = archive.join(uuid::Uuid::new_v4().to_string());
    std::fs::rename(&evidence, destination)
        .map_err(|e| format!("Cannot preserve temp evidence: {e}"))
}

/// Retry-safe after Git has unregistered a partially deleted Windows directory.
/// Never use recursive remove_dir_all on a tree containing unchecked reparse points.
fn remove_remnants(path: &Path) -> Result<(), String> {
    crate::worktree_lifecycle::validate_removal_path(path)?;
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
        Ok(metadata) if !metadata.is_dir() => {
            return Err("Cleanup blocked: worktree remnant is not a directory".into())
        }
        Ok(_) => {}
    }
    for link in removal_links(path)? {
        detach_removal_link(&link)?;
    }
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if crate::worktree_lifecycle::is_link_or_reparse(&metadata) {
            return Err("Cleanup blocked: entry changed during removal".into());
        }
        if metadata.is_dir() {
            remove_remnants(&path)?;
        } else {
            crate::worktree_lifecycle::validate_removal_path(path.parent().unwrap())?;
            std::fs::remove_file(path)
                .map_err(|e| format!("Cleanup pending; release locked handles and retry: {e}"))?;
        }
    }
    std::fs::remove_dir(path)
        .map_err(|e| format!("Cleanup pending; release locked handles and retry: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoval {
    session_ids: Vec<String>,
    project_cwd: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct SessionBeforeRemoval {
    id: String,
    cwd: String,
    worktree_cwd: Option<String>,
    branch: Option<String>,
    provider_session_id: Option<String>,
    context_used: Option<i64>,
    context_window: Option<i64>,
    in_flight_cwd: Option<String>,
    in_flight_sort_index: Option<i64>,
    detached_cwd: String,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum SessionRemovalJournal {
    Current {
        project_cwd: String,
        sessions: Vec<SessionBeforeRemoval>,
    },
    Legacy(Vec<SessionBeforeRemoval>),
}

impl SessionRemovalJournal {
    fn into_parts(self) -> (Option<String>, Vec<SessionBeforeRemoval>) {
        match self {
            Self::Current {
                project_cwd,
                sessions,
            } => (Some(project_cwd), sessions),
            Self::Legacy(sessions) => (None, sessions),
        }
    }
}

/// Make sessions safe to reopen *before* touching Git. A small metadata journal
/// lets a failed/interrupted deletion restore their original working context.
fn prepare_removal(
    conn: &rusqlite::Connection,
    path: &Path,
    project_cwd: &str,
    ids: &[String],
) -> Result<Vec<SessionBeforeRemoval>, String> {
    use rusqlite::OptionalExtension;
    let pending: Option<String> = conn
        .query_row(
            "SELECT sessions_json FROM worktree_removals WHERE path = ?1",
            [path_to_js(path)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(json) = pending {
        return Ok(serde_json::from_str::<SessionRemovalJournal>(&json)
            .map_err(|e| e.to_string())?
            .into_parts()
            .1);
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut saved = Vec::new();
    for id in ids {
        let mut session = tx
            .query_row(
                "SELECT s.cwd, s.worktree_cwd, s.branch, s.provider_session_id,
                    s.context_used, s.context_window, f.cwd, f.sort_index
             FROM sessions s LEFT JOIN in_flight_sessions f ON f.session_id = s.id
             WHERE s.id = ?1",
                [id],
                |row| {
                    Ok(SessionBeforeRemoval {
                        id: id.clone(),
                        cwd: row.get(0)?,
                        worktree_cwd: row.get(1)?,
                        branch: row.get(2)?,
                        provider_session_id: row.get(3)?,
                        context_used: row.get(4)?,
                        context_window: row.get(5)?,
                        in_flight_cwd: row.get(6)?,
                        in_flight_sort_index: row.get(7)?,
                        detached_cwd: String::new(),
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        session.detached_cwd = if contains_working_dir(path, &expand_home(&session.cwd)) {
            project_cwd.to_owned()
        } else {
            session.cwd.clone()
        };
        tx.execute(
            "UPDATE sessions SET worktree_removed = 1,
               worktree_cwd = COALESCE(NULLIF(worktree_cwd, ''), cwd),
               cwd = ?2, branch = NULL, provider_session_id = NULL,
               context_used = NULL, context_window = NULL WHERE id = ?1",
            rusqlite::params![id, session.detached_cwd],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM in_flight_sessions WHERE session_id = ?1", [id])
            .map_err(|e| e.to_string())?;
        saved.push(session);
    }
    tx.execute(
        "INSERT INTO worktree_removals (path, sessions_json) VALUES (?1, ?2)",
        rusqlite::params![
            path_to_js(path),
            serde_json::to_string(&SessionRemovalJournal::Current {
                project_cwd: project_cwd.to_owned(),
                sessions: saved.clone(),
            })
            .map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(saved)
}

fn finish_removal(
    conn: &rusqlite::Connection,
    path: &str,
    restore: &[SessionBeforeRemoval],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for session in restore {
        // A cleanup failure can leave a journal until the next launch. Do not
        // overwrite sessions which the user has since reattached or deleted.
        let changed = tx
            .execute(
                "UPDATE sessions SET cwd = ?2, worktree_cwd = ?3, branch = ?4,
               provider_session_id = ?5, context_used = ?6, context_window = ?7,
               worktree_removed = 0
             WHERE id = ?1 AND worktree_removed = 1 AND cwd = ?8 AND worktree_cwd = ?9",
                rusqlite::params![
                    session.id,
                    session.cwd,
                    session.worktree_cwd,
                    session.branch,
                    session.provider_session_id,
                    session.context_used,
                    session.context_window,
                    session.detached_cwd,
                    session
                        .worktree_cwd
                        .as_deref()
                        .filter(|cwd| !cwd.is_empty())
                        .unwrap_or(&session.cwd)
                ],
            )
            .map_err(|e| e.to_string())?;
        if changed > 0 {
            if let (Some(cwd), Some(index)) = (&session.in_flight_cwd, session.in_flight_sort_index)
            {
                tx.execute(
                    "INSERT OR REPLACE INTO in_flight_sessions (session_id, cwd, sort_index) VALUES (?1, ?2, ?3)",
                    rusqlite::params![session.id, cwd, index],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    tx.execute("DELETE FROM worktree_removals WHERE path = ?1", [path])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub(crate) fn reconcile_removals(conn: &rusqlite::Connection) -> Result<(), String> {
    let pending = conn
        .prepare("SELECT path, sessions_json FROM worktree_removals")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    for (path, json) in pending {
        let (project, saved) = serde_json::from_str::<SessionRemovalJournal>(&json)
            .map_err(|e| e.to_string())?
            .into_parts();
        if let Some(project) = project {
            let root = Path::new(&project);
            match native_removal_receipts(root, Path::new(&path)) {
                Ok(receipts) if !receipts.is_empty() => {
                    crate::worktree_lifecycle::block_removal_recovery(Path::new(&path));
                    // Registered partial removals need a fresh explicit review;
                    // never force through new source changes during startup.
                    let registered = list(root)?.iter().any(|entry| entry.path == path);
                    if registered {
                        continue;
                    }
                    if let Err(error) = recover_remnants(root, Path::new(&path)) {
                        eprintln!("Worktree cleanup remains pending: {error}");
                        continue;
                    }
                    crate::worktree_lifecycle::finish_removal_recovery(Path::new(&path));
                }
                Ok(_) => {}
                Err(error) => {
                    crate::worktree_lifecycle::block_removal_recovery(Path::new(&path));
                    eprintln!("Cannot reconcile pending worktree cleanup: {error}");
                    continue;
                }
            }
        }
        // A surviving Git link means removal did not finish. If the link/folder
        // is gone, the already-persisted detached sessions are the final state.
        let restore = if Path::new(&path)
            .join(".git")
            .try_exists()
            .map_err(|e| e.to_string())?
        {
            saved
        } else {
            Vec::new()
        };
        finish_removal(conn, &path, &restore)?;
    }
    Ok(())
}

fn remove_with_sessions(
    conn: &rusqlite::Connection,
    root: &Path,
    path: &Path,
    force: bool,
    keep_sessions: bool,
) -> Result<WorktreeRemoval, String> {
    assert_legacy_workspace(conn, path)?;
    let tree = match removal_target(root, path) {
        Ok(tree) => tree,
        Err(error) => {
            if native_removal_receipts(root, path)?.is_empty()
                || list(root)?
                    .iter()
                    .any(|entry| same_path(Path::new(&entry.path), path))
            {
                return Err(error);
            }
            remove(root, path, force)?;
            finish_removal(conn, &path_to_js(path), &[])?;
            let main = list(root)?
                .into_iter()
                .find(|entry| entry.is_main)
                .ok_or("No main working copy found")?;
            return Ok(WorktreeRemoval {
                session_ids: Vec::new(),
                project_cwd: main.path,
            });
        }
    };
    let worktrees = list(root)?;
    let main = worktrees
        .iter()
        .find(|tree| tree.is_main)
        .ok_or("No main working copy found")?;
    let ids = session_ids(conn, path)?;
    if !keep_sessions && !ids.is_empty() {
        return Err("Sessions still use this worktree. Move or delete those sessions first (including archived sessions).".into());
    }
    let saved = prepare_removal(conn, Path::new(&tree.path), &main.path, &ids)?;
    // Use the main copy even if Settings was opened directly on the target.
    if let Err(error) = remove(Path::new(&main.path), path, force) {
        if !native_removal_receipts(Path::new(&main.path), path)?.is_empty() {
            // Keep the durable DB journal and process-start fence through partial
            // failures; startup recovery or an explicit cleanup retry settles it.
            return Err(error);
        }
        // A partial Windows deletion may already have removed .git/registration.
        // Keep sessions detached in that case; restoring them would resume into
        // a broken directory. The filesystem receipt retains retry authority.
        let still_registered = list(Path::new(&main.path))?
            .iter()
            .any(|entry| entry.path == tree.path);
        let restore = if still_registered {
            saved.as_slice()
        } else {
            &[]
        };
        finish_removal(conn, &tree.path, restore).map_err(|restore| {
            format!("{error}. Sessions remain detached until recovery on restart: {restore}")
        })?;
        return Err(error);
    }
    // Git has succeeded and the sessions are already durably detached. A
    // cleanup failure must not tell the UI to resume them in the deleted path.
    if let Err(error) = finish_removal(conn, &tree.path, &[]) {
        eprintln!("Worktree removed; recovery journal cleanup will retry on restart: {error}");
    }
    Ok(WorktreeRemoval {
        session_ids: ids,
        project_cwd: main.path.clone(),
    })
}

fn managed_cleanup_local_check(
    store: &SessionStore,
    terminals: &crate::pty::PtyHost,
    agents: &crate::harness::HarnessHost,
    workspace_id: &str,
    path: &Path,
) -> Result<(), String> {
    if terminals.has_working_dir(path) || agents.has_working_dir(path) {
        return Err("Close the terminals and agent processes using this worktree first.".into());
    }
    crate::native_workspace::assert_buffers_settled(store, path)?;
    let sessions = {
        let conn = store.lock_conn()?;
        let mut statement = conn
            .prepare("SELECT id FROM sessions WHERE workspace_id=?1")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    for session in sessions {
        crate::session_store::rewind::assert_writable(store, &session)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn managed_worktree_removal_plan(
    app: tauri::AppHandle,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
    agents: State<'_, crate::harness::HarnessHost>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let workspace_id = request["workspaceId"]
        .as_str()
        .ok_or("Workspace ID is required")?;
    let host = crate::remote::NativeWorkspaceTransport::connect(&app, "workspaces.lifecycle.v1")?;
    let plan = host.call("workspaces.cleanup.plan", request.clone())?;
    let token = plan["token"]
        .as_str()
        .ok_or("Host returned no cleanup preview token")?;
    let path = Path::new(
        plan["path"]
            .as_str()
            .ok_or("Host returned no cleanup path")?,
    );
    crate::worktree_lifecycle::validate_removal_path(path)?;
    if plan["workspaceId"] != workspace_id
        || plan["expectedRevision"] != request["expectedRevision"]
    {
        return Err("Workspace cleanup identity or revision changed; preview again".into());
    }
    managed_cleanup_local_check(&store, &terminals, &agents, workspace_id, path)?;
    let raw = serde_json::to_string(&plan).map_err(|e| e.to_string())?;
    store.lock_conn()?.execute("INSERT INTO native_cleanup_plans(token,workspace_id,plan_json) VALUES(?1,?2,?3)
        ON CONFLICT(token) DO UPDATE SET plan_json=excluded.plan_json WHERE native_cleanup_plans.workspace_id=excluded.workspace_id",
        rusqlite::params![token,workspace_id,raw]).map_err(|e|e.to_string())?;
    Ok(plan)
}

#[tauri::command(async)]
pub fn managed_worktree_removal_apply(
    app: tauri::AppHandle,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
    agents: State<'_, crate::harness::HarnessHost>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let workspace_id = request["workspaceId"]
        .as_str()
        .ok_or("Workspace ID is required")?;
    let token = request["planToken"]
        .as_str()
        .ok_or("Cleanup preview token is required")?;
    let raw: String = store
        .lock_conn()?
        .query_row(
            "SELECT plan_json FROM native_cleanup_plans WHERE token=?1 AND workspace_id=?2",
            rusqlite::params![token, workspace_id],
            |row| row.get(0),
        )
        .map_err(|_| "Open a fresh cleanup preview on this computer before applying".to_string())?;
    let plan: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if plan["expectedRevision"] != request["expectedRevision"] {
        return Err("Workspace cleanup revision changed; preview again".into());
    }
    let path = Path::new(
        plan["path"]
            .as_str()
            .ok_or("Host returned no cleanup path")?,
    );
    let _reservation = crate::worktree_lifecycle::reserve_removal(path)?;
    managed_cleanup_local_check(&store, &terminals, &agents, workspace_id, path)?;
    let host = crate::remote::NativeWorkspaceTransport::connect(&app, "workspaces.lifecycle.v1")?;
    // No native force-removal fallback. An unknown response remains the same Host operation.
    let receipt = host.call("workspaces.cleanup.apply", request.clone())?;
    if receipt["workspaceId"] != workspace_id
        || receipt["retainedBranchRef"] != plan["branchRef"]
        || !receipt["workspaceRevision"]
            .as_i64()
            .is_some_and(|revision| revision > 0)
        || !receipt["operationId"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
        || !matches!(
            receipt["directoryState"].as_str(),
            Some("present" | "pendingRemoval" | "removing" | "removed" | "blocked")
        )
    {
        return Err(
            "Host returned a different cleanup receipt; reconnect and inspect status".into(),
        );
    }
    if receipt["directoryState"] == "removed" {
        store.lock_conn()?.execute("UPDATE sessions SET worktree_removed=1,workspace_revision=?2,provider_session_id=NULL,context_used=NULL,context_window=NULL WHERE workspace_id=?1",
            rusqlite::params![workspace_id,receipt["workspaceRevision"].as_i64()]).map_err(|e|e.to_string())?;
    }
    Ok(receipt)
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn git_worktree_remove(
    cwd: String,
    path: String,
    force: bool,
    keep_sessions: Option<bool>,
    expected_review: Option<WorktreeRemovalReview>,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
    agents: State<'_, crate::harness::HarnessHost>,
) -> Result<WorktreeRemoval, String> {
    let root = expand_home(&cwd);
    crate::fs::with_git_mutation(&root, || {
        let path = expand_home(&path);
        let _reservation = crate::worktree_lifecycle::reserve_removal(&path)?;
        if terminals.has_working_dir(&path) || agents.has_working_dir(&path) {
            return Err(
                "Close the terminals and agent processes using this worktree first.".into(),
            );
        }
        let conn = store.lock_conn()?;
        if let Some(expected) = expected_review.as_ref() {
            if force {
                return Err("Reviewed removal cannot use force".into());
            }
            let current = removal_review(
                &conn,
                &root,
                &path,
                terminals.has_working_dir(&path),
                agents.has_working_dir(&path),
            )?;
            assert_removal_review(expected, &current)?;
        }
        remove_with_sessions(&conn, &root, &path, force, keep_sessions.unwrap_or(false))
    })
}

#[tauri::command(async)]
pub fn git_orchestration_worktree_remove(
    cwd: String,
    path: String,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
    agents: State<'_, crate::harness::HarnessHost>,
) -> Result<WorktreeRemoval, String> {
    let root = expand_home(&cwd);
    crate::fs::with_git_mutation(&root, || {
        let path = expand_home(&path);
        let _reservation = crate::worktree_lifecycle::reserve_removal(&path)?;
        if terminals.has_working_dir(&path) || agents.has_working_dir(&path) {
            return Err(
                "Close the terminals and agent processes using this worktree first.".into(),
            );
        }
        let conn = store.lock_conn()?;
        // Directory retirement must retain the local branch and rescue refs.
        remove_with_sessions(&conn, &root, &path, true, true)
    })
}

#[tauri::command(async)]
pub async fn git_orchestration_branch_remove(cwd: String, branch: String) -> Result<(), String> {
    crate::fs::spawn_git_mutation(cwd, move |root| {
        let branch = branch.trim();
        if !branch.starts_with("mc/orch-") {
            return Err("Only orchestration temporary branches can be removed here".into());
        }
        git(root, &["check-ref-format", "--branch", branch])?;
        let branch_ref = format!("refs/heads/{branch}");
        if git(root, &["rev-parse", "--verify", &branch_ref]).is_err() {
            return Ok(());
        }
        if list(root)?
            .iter()
            .any(|tree| tree.branch.as_deref() == Some(branch))
        {
            return Err("The orchestration branch still has a worktree".into());
        }
        git(root, &["branch", "-D", branch]).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repo(PathBuf);
    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn repo() -> Repo {
        let dir =
            std::env::temp_dir().join(format!("bycoda-worktree-test-{}", uuid::Uuid::new_v4()));
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
            remove_with_sessions(&conn, &root, path, false, true)
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
    fn junction(link: &Path, target: &Path) {
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

    #[cfg(windows)]
    #[test]
    fn worktree_removal_detaches_node_modules_junction_and_preserves_external_sentinel() {
        let repo = repo();
        let root = repo.0.join("repo");
        let tree = create(&root, "junction-sentinel", "main", false).unwrap();
        let path = Path::new(&tree.path);
        let sentinel = repo.0.join("main-node-modules");
        std::fs::create_dir_all(sentinel.join("package")).unwrap();
        std::fs::write(sentinel.join("package/sentinel.txt"), "must survive").unwrap();
        std::fs::write(path.join(".gitignore"), "node_modules/\ntemp/\n").unwrap();
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
        junction(&path.join("node_modules"), &sentinel);
        std::fs::create_dir_all(path.join("temp/verification")).unwrap();
        std::fs::write(
            path.join("temp/verification/evidence.txt"),
            "retained evidence",
        )
        .unwrap();
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
    }

    #[cfg(windows)]
    #[test]
    fn worktree_removal_rejects_linked_target_before_touching_external_directory() {
        let repo = repo();
        let sentinel = repo.0.join("sentinel");
        std::fs::create_dir_all(&sentinel).unwrap();
        std::fs::write(sentinel.join("keep"), "retained").unwrap();
        let alias = repo.0.join("alias");
        junction(&alias, &sentinel);
        assert!(crate::worktree_lifecycle::reserve_removal(&alias).is_err());
        assert!(remove(&repo.0.join("repo"), &alias, true).is_err());
        assert_eq!(
            std::fs::read_to_string(sentinel.join("keep")).unwrap(),
            "retained"
        );
        std::fs::remove_dir(alias).unwrap();
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
            assert!(remove_with_sessions(&conn, &root, path, true, true).is_err());
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
        remove_with_sessions(&conn, &root, path, true, true).unwrap();
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
        assert!(remove_with_sessions(&conn, &root, path, true, true).is_err());
        assert!(path.exists());
        assert!(git(&root, &["rev-parse", "refs/heads/user-renamed-branch"]).is_ok());
        let legacy = create(&root, "genuine-legacy", "main", false).unwrap();
        assert!(assert_legacy_workspace(&conn, Path::new(&legacy.path)).is_ok());
    }

    #[test]
    fn worktree_managed_branches_require_authoritative_host_cleanup_even_with_force() {
        let repo = repo();
        let root = repo.0.join("repo");
        for branch in ["bycoda/s/managed-session", "bycoda/t/managed-task"] {
            let tree = create(&root, branch, "main", false).unwrap();
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
        let tree = create(&root, "mc/12345678", "main", false).unwrap();
        let renamed = rename_branch(&root, Path::new(&tree.path), "mc/faster-worktrees").unwrap();
        assert_eq!(renamed.branch.as_deref(), Some("mc/faster-worktrees"));
        assert!(git(
            &root,
            &["rev-parse", "--verify", "refs/heads/mc/faster-worktrees"]
        )
        .is_ok());
        assert!(rename_branch(&root, &root, "mc/nope").is_err());

        let regular = create(&root, "feature/manual", "main", false).unwrap();
        assert!(rename_branch(&root, Path::new(&regular.path), "mc/should-not-change").is_err());
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
        assert!(remove_with_sessions(&conn, &root, path, true, false).is_err());
        // An actual Git removal failure must roll back the database changes.
        std::fs::write(path.join("dirty"), "uncommitted").unwrap();
        assert!(remove_with_sessions(&conn, &root, path, false, true).is_err());
        assert_eq!(session_ids(&conn, path).unwrap().len(), 3);
        let mut removed = remove_with_sessions(&conn, path, path, true, true).unwrap();
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
        assert!(remove_with_sessions(&conn, &root, Path::new(&tree.path), true, true).is_err());
        assert!(Path::new(&tree.path).exists());
        assert_eq!(session_ids(&conn, Path::new(&tree.path)).unwrap(), ["s1"]);
        conn.execute_batch("DROP TRIGGER fail_prepare").unwrap();
        conn.execute_batch(
            "CREATE TRIGGER fail_cleanup BEFORE DELETE ON worktree_removals
             BEGIN SELECT RAISE(ABORT, 'cleanup unavailable'); END;",
        )
        .unwrap();
        let removed =
            remove_with_sessions(&conn, &root, Path::new(&tree.path), true, true).unwrap();
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
}
