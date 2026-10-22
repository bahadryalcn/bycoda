//! Watches the `.git` files that describe a checkout's refs, HEAD, index and
//! stash, and tells the webviews showing that checkout when they change. Git
//! views reload on real repository changes rather than on hints or polling.
//!
//! Only metadata is watched: the gitdir and the common dir non-recursively,
//! `refs/` recursively, and the stash reflog. `objects/` and the working tree
//! are not.

use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const EVENT: &str = "bycoda-git-watch";
/// Quiet time that ends a burst, such as a commit writing several files.
const SETTLE: Duration = Duration::from_millis(300);
/// A steady stream of changes still reports at least this often.
const MAX_DELAY: Duration = Duration::from_secs(1);

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Change {
    /// The index or the working tree's view of it may differ.
    index: bool,
    /// Commits, branches, tags, stashes or worktrees may differ.
    refs: bool,
}

impl Change {
    const ALL: Change = Change {
        index: true,
        refs: true,
    };

    fn any(self) -> bool {
        self.index || self.refs
    }

    fn merge(&mut self, other: Change) {
        self.index |= other.index;
        self.refs |= other.refs;
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
struct Payload {
    cwd: String,
    index: bool,
    refs: bool,
}

enum Signal {
    Paths(Vec<PathBuf>),
    /// The OS dropped events; everything may have changed.
    All,
}

struct Sub {
    count: usize,
    git_dir: String,
    common_dir: String,
    paths: Vec<PathBuf>,
    /// Optional folders that did not exist yet (no stash, no worktrees).
    missing: Vec<(PathBuf, RecursiveMode)>,
}

#[derive(Default)]
struct Inner {
    watcher: Option<RecommendedWatcher>,
    /// Watched path and how many subscriptions share it.
    watched: HashMap<PathBuf, usize>,
    /// Keyed by webview label and the cwd string it registered.
    subs: HashMap<(String, String), Sub>,
}

#[derive(Default)]
pub struct GitWatchHost {
    inner: Arc<Mutex<Inner>>,
}

fn lock(inner: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Forward slashes, no trailing slash or verbatim prefix; case-folded on
/// Windows, where paths compare case-insensitively.
fn norm(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let text = text.strip_prefix("//?/").unwrap_or(&text);
    let text = text.trim_end_matches('/');
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text.to_string()
    }
}

fn relative<'a>(path: &'a str, dir: &str) -> Option<&'a str> {
    path.strip_prefix(dir)?.strip_prefix('/')
}

/// What a change to `path` means for the checkout with these git dirs.
fn classify(path: &str, git_dir: &str, common_dir: &str) -> Change {
    let mut change = Change::default();
    if path
        .rsplit('/')
        .next()
        .is_some_and(|name| name.ends_with(".lock"))
    {
        return change;
    }
    if let Some(name) = relative(path, git_dir).filter(|rest| !rest.contains('/')) {
        match name {
            "index" => change.index = true,
            "HEAD" | "ORIG_HEAD" | "MERGE_HEAD" | "CHERRY_PICK_HEAD" | "REVERT_HEAD"
            | "REBASE_HEAD" | "rebase-merge" | "rebase-apply" => change = Change::ALL,
            _ => {}
        }
    }
    if let Some(rest) = relative(path, common_dir) {
        let worktree_entry = rest
            .strip_prefix("worktrees/")
            .is_some_and(|name| !name.contains('/'));
        if matches!(
            rest,
            "packed-refs" | "config" | "refs" | "worktrees" | "logs/refs/stash"
        ) || rest.starts_with("refs/")
            || worktree_entry
        {
            change.refs = true;
        }
    }
    change
}

/// Paths an event changed in a way git views care about. Reading a folder can
/// update its access time, which Windows reports as a change to the folder
/// itself; a real ref change also reports the file inside it.
fn meaningful_paths(event: notify::Event) -> Vec<PathBuf> {
    match event.kind {
        EventKind::Access(_) => Vec::new(),
        EventKind::Modify(ModifyKind::Name(_)) => event.paths,
        EventKind::Modify(_) => event
            .paths
            .into_iter()
            .filter(|path| !path.is_dir())
            .collect(),
        _ => event.paths,
    }
}

struct Planned {
    path: PathBuf,
    mode: RecursiveMode,
    /// Without it the checkout's refs or HEAD would go unseen.
    required: bool,
}

/// The paths to watch for a checkout.
fn watch_plan(git_dir: &Path, common_dir: &Path) -> Vec<Planned> {
    let planned = |path: PathBuf, mode, required| Planned {
        path,
        mode,
        required,
    };
    let mut plan = vec![planned(
        git_dir.to_path_buf(),
        RecursiveMode::NonRecursive,
        true,
    )];
    if norm(git_dir) != norm(common_dir) {
        plan.push(planned(
            common_dir.to_path_buf(),
            RecursiveMode::NonRecursive,
            true,
        ));
    }
    plan.push(planned(
        common_dir.join("refs"),
        RecursiveMode::Recursive,
        true,
    ));
    plan.push(planned(
        common_dir.join("logs").join("refs"),
        RecursiveMode::NonRecursive,
        false,
    ));
    plan.push(planned(
        common_dir.join("worktrees"),
        RecursiveMode::NonRecursive,
        false,
    ));
    plan
}

/// The checkout's gitdir and common dir, absolute.
fn resolve(cwd: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = Path::new(cwd);
    let text = crate::fs::git_run(
        root,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-dir",
            "--git-common-dir",
        ],
    )
    .ok_or_else(|| format!("{cwd} is not a Git checkout"))?;
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let mut next = || {
        lines
            .next()
            .map(|line| root.join(line))
            .ok_or_else(|| "git rev-parse gave no directory".to_string())
    };
    let git_dir = next()?;
    let common_dir = next()?;
    // FSEvents reports resolved paths (`/private/var/…` for `/var/…`).
    if cfg!(target_os = "macos") {
        let real = |path: PathBuf| std::fs::canonicalize(&path).unwrap_or(path);
        return Ok((real(git_dir), real(common_dir)));
    }
    Ok((git_dir, common_dir))
}

impl GitWatchHost {
    fn ensure_watcher(&self, inner: &mut Inner, app: &AppHandle) -> Result<(), String> {
        if inner.watcher.is_some() {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel::<Signal>();
        let watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            let signal = match result {
                Ok(event) if event.need_rescan() => Signal::All,
                Ok(event) => Signal::Paths(meaningful_paths(event)),
                Err(_) => Signal::All,
            };
            if !matches!(&signal, Signal::Paths(paths) if paths.is_empty()) {
                let _ = sender.send(signal);
            }
        })
        .map_err(|error| error.to_string())?;
        inner.watcher = Some(watcher);
        let shared = Arc::clone(&self.inner);
        let app = app.clone();
        std::thread::Builder::new()
            .name("git-watch".into())
            .spawn(move || deliver(receiver, shared, app))
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn watch(&self, app: &AppHandle, label: &str, cwd: &str) -> Result<(), String> {
        let key = (label.to_string(), cwd.to_string());
        {
            let mut inner = lock(&self.inner);
            if let Some(sub) = inner.subs.get_mut(&key) {
                sub.count += 1;
                return Ok(());
            }
        }
        // Outside the lock: this runs git.
        let (git_dir, common_dir) = resolve(cwd)?;
        let mut inner = lock(&self.inner);
        if let Some(sub) = inner.subs.get_mut(&key) {
            sub.count += 1;
            return Ok(());
        }
        self.ensure_watcher(&mut inner, app)?;
        let mut paths = Vec::new();
        let mut missing = Vec::new();
        for Planned {
            path,
            mode,
            required,
        } in watch_plan(&git_dir, &common_dir)
        {
            match acquire(&mut inner, &path, mode) {
                Ok(()) => paths.push(path),
                // Watched once git creates it.
                Err(_) if !required && !path.exists() => missing.push((path, mode)),
                // A partial watch would look complete while missing changes, so
                // the views keep their own refresh triggers instead.
                Err(error) => {
                    release(&mut inner, paths);
                    return Err(format!("Couldn't watch {}: {error}", path.display()));
                }
            }
        }
        inner.subs.insert(
            key,
            Sub {
                count: 1,
                git_dir: norm(&git_dir),
                common_dir: norm(&common_dir),
                paths,
                missing,
            },
        );
        Ok(())
    }

    fn unwatch(&self, label: &str, cwd: &str) {
        let mut inner = lock(&self.inner);
        let key = (label.to_string(), cwd.to_string());
        let Some(sub) = inner.subs.get_mut(&key) else {
            return;
        };
        sub.count -= 1;
        if sub.count > 0 {
            return;
        }
        if let Some(sub) = inner.subs.remove(&key) {
            release(&mut inner, sub.paths);
        }
    }

    /// Drops every subscription of a webview: it closed or reloaded.
    pub fn window_closed(&self, label: &str) {
        let mut inner = lock(&self.inner);
        let keys: Vec<_> = inner
            .subs
            .keys()
            .filter(|(owner, _)| owner == label)
            .cloned()
            .collect();
        for key in keys {
            if let Some(sub) = inner.subs.remove(&key) {
                release(&mut inner, sub.paths);
            }
        }
    }
}

fn acquire(inner: &mut Inner, path: &Path, mode: RecursiveMode) -> Result<(), String> {
    if let Some(count) = inner.watched.get_mut(path) {
        *count += 1;
        return Ok(());
    }
    let watcher = inner.watcher.as_mut().ok_or("No watcher")?;
    watcher
        .watch(path, mode)
        .map_err(|error| error.to_string())?;
    inner.watched.insert(path.to_path_buf(), 1);
    Ok(())
}

fn release(inner: &mut Inner, paths: Vec<PathBuf>) {
    for path in paths {
        let Some(count) = inner.watched.get_mut(&path) else {
            continue;
        };
        *count -= 1;
        if *count == 0 {
            inner.watched.remove(&path);
            if let Some(watcher) = inner.watcher.as_mut() {
                let _ = watcher.unwatch(&path);
            }
        }
    }
}

/// Starts watching optional folders that git has created since.
fn adopt_created(inner: &mut Inner) {
    let keys: Vec<_> = inner
        .subs
        .iter()
        .filter(|(_, sub)| sub.missing.iter().any(|(path, _)| path.exists()))
        .map(|(key, _)| key.clone())
        .collect();
    for key in keys {
        let Some(mut sub) = inner.subs.remove(&key) else {
            continue;
        };
        for (path, mode) in std::mem::take(&mut sub.missing) {
            if path.exists() && acquire(inner, &path, mode).is_ok() {
                sub.paths.push(path);
            } else {
                sub.missing.push((path, mode));
            }
        }
        inner.subs.insert(key, sub);
    }
}

/// Coalesces a burst of file events into one report per webview.
fn deliver(receiver: Receiver<Signal>, inner: Arc<Mutex<Inner>>, app: AppHandle) {
    while let Ok(first) = receiver.recv() {
        let mut all = false;
        let mut paths = Vec::new();
        let mut take = |signal: Signal| match signal {
            Signal::All => all = true,
            Signal::Paths(more) => paths.extend(more),
        };
        take(first);
        let started = Instant::now();
        loop {
            let left = MAX_DELAY.saturating_sub(started.elapsed());
            if left.is_zero() {
                break;
            }
            match receiver.recv_timeout(SETTLE.min(left)) {
                Ok(signal) => take(signal),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let paths: Vec<String> = paths.iter().map(|path| norm(path)).collect();
        let reports = {
            let mut inner = lock(&inner);
            adopt_created(&mut inner);
            reports(&inner.subs, &paths, all)
        };
        for (label, payloads) in reports {
            let _ = app.emit_to(label.as_str(), EVENT, payloads);
        }
    }
}

fn reports(
    subs: &HashMap<(String, String), Sub>,
    paths: &[String],
    all: bool,
) -> HashMap<String, Vec<Payload>> {
    let mut out: HashMap<String, Vec<Payload>> = HashMap::new();
    for ((label, cwd), sub) in subs {
        let mut change = if all { Change::ALL } else { Change::default() };
        for path in paths {
            change.merge(classify(path, &sub.git_dir, &sub.common_dir));
        }
        if change.any() {
            out.entry(label.clone()).or_default().push(Payload {
                cwd: cwd.clone(),
                index: change.index,
                refs: change.refs,
            });
        }
    }
    out
}

/// Starts reporting `.git` changes of the checkout at `cwd` to this webview.
/// Fails when `cwd` is not a Git checkout or cannot be fully watched.
#[tauri::command]
pub async fn git_watch(app: AppHandle, webview: tauri::Webview, cwd: String) -> Result<(), String> {
    let label = webview.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        app.state::<GitWatchHost>().watch(&app, &label, &cwd)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn git_unwatch(state: tauri::State<'_, GitWatchHost>, webview: tauri::Webview, cwd: String) {
    state.unwatch(webview.label(), &cwd);
}

/// Forgets this webview's watches; a reloaded page starts from none.
#[tauri::command]
pub fn git_watch_reset(state: tauri::State<'_, GitWatchHost>, webview: tauri::Webview) {
    state.window_closed(webview.label());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    const GIT: &str = "/r/.git";

    #[test]
    fn classifies_checkout_files() {
        assert_eq!(
            classify("/r/.git/index", GIT, GIT),
            Change {
                index: true,
                refs: false
            }
        );
        assert_eq!(classify("/r/.git/HEAD", GIT, GIT), Change::ALL);
        assert_eq!(classify("/r/.git/rebase-merge", GIT, GIT), Change::ALL);
        assert_eq!(
            classify("/r/.git/refs/heads/main", GIT, GIT),
            Change {
                index: false,
                refs: true
            }
        );
        assert_eq!(
            classify("/r/.git/refs/stash", GIT, GIT),
            Change {
                index: false,
                refs: true
            }
        );
        assert_eq!(
            classify("/r/.git/logs/refs/stash", GIT, GIT),
            Change {
                index: false,
                refs: true
            }
        );
        assert_eq!(
            classify("/r/.git/packed-refs", GIT, GIT),
            Change {
                index: false,
                refs: true
            }
        );
    }

    #[test]
    fn ignores_locks_objects_and_fetch_head() {
        for path in [
            "/r/.git/index.lock",
            "/r/.git/packed-refs.lock",
            "/r/.git/refs/heads/main.lock",
            "/r/.git/objects/ab/cdef",
            "/r/.git/FETCH_HEAD",
            "/r/.git/logs/HEAD",
            "/r/src/main.rs",
            "/other/.git/HEAD",
        ] {
            assert!(!classify(path, GIT, GIT).any(), "{path}");
        }
    }

    #[test]
    fn separates_a_linked_worktree_from_its_repository() {
        let tree = "/r/.git/worktrees/feature";
        // The worktree's own HEAD and index belong to it alone.
        assert_eq!(
            classify("/r/.git/worktrees/feature/HEAD", tree, GIT),
            Change::ALL
        );
        assert!(!classify("/r/.git/HEAD", tree, GIT).any());
        assert!(!classify("/r/.git/index", tree, GIT).any());
        // Shared refs reach both.
        assert!(classify("/r/.git/refs/heads/feature", tree, GIT).refs);
        // The main checkout only learns that the worktree list changed.
        assert!(!classify("/r/.git/worktrees/feature/HEAD", GIT, GIT).any());
        assert!(classify("/r/.git/worktrees/feature", GIT, GIT).refs);
    }

    #[test]
    fn normalizes_separators_and_verbatim_prefixes() {
        let expected = if cfg!(windows) {
            "c:/repo/.git"
        } else {
            "C:/repo/.git"
        };
        assert_eq!(norm(Path::new(r"\\?\C:\repo\.git\")), expected);
    }

    #[test]
    fn drops_access_and_folder_metadata_events() {
        let dir = std::env::temp_dir();
        let file = dir.join("not-a-folder-git-watch");
        let event = |kind| {
            notify::Event::new(kind)
                .add_path(dir.clone())
                .add_path(file.clone())
        };
        assert!(
            meaningful_paths(event(EventKind::Access(notify::event::AccessKind::Any))).is_empty()
        );
        assert_eq!(
            meaningful_paths(event(EventKind::Modify(ModifyKind::Any))),
            vec![file.clone()]
        );
        let renamed = EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::To));
        assert_eq!(meaningful_paths(event(renamed)).len(), 2);
        let created = EventKind::Create(notify::event::CreateKind::Folder);
        assert_eq!(meaningful_paths(event(created)).len(), 2);
    }

    fn sub(git_dir: &str, common_dir: &str) -> Sub {
        Sub {
            count: 1,
            git_dir: git_dir.into(),
            common_dir: common_dir.into(),
            paths: Vec::new(),
            missing: Vec::new(),
        }
    }

    #[test]
    fn reports_each_subscription_once_per_burst() {
        let mut subs = HashMap::new();
        subs.insert(("main".to_string(), "/r".to_string()), sub(GIT, GIT));
        subs.insert(
            ("main".to_string(), "/w".to_string()),
            sub("/r/.git/worktrees/w", GIT),
        );
        let paths = vec![
            "/r/.git/index".to_string(),
            "/r/.git/refs/heads/x".to_string(),
        ];
        let mut out = reports(&subs, &paths, false).remove("main").unwrap();
        out.sort_by(|a, b| a.cwd.cmp(&b.cwd));
        assert_eq!(
            out,
            vec![
                Payload {
                    cwd: "/r".into(),
                    index: true,
                    refs: true
                },
                Payload {
                    cwd: "/w".into(),
                    index: false,
                    refs: true
                },
            ]
        );
        assert!(reports(&subs, &["/r/.git/objects/x".into()], false).is_empty());
        assert_eq!(reports(&subs, &[], true)["main"].len(), 2);
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?}");
    }

    fn temp_repo() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("git-watch-{}", uuid::Uuid::new_v4()));
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q"]);
        (base, repo)
    }

    fn watch_all(
        git_dir: &Path,
        common_dir: &Path,
    ) -> (RecommendedWatcher, Receiver<notify::Result<notify::Event>>) {
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(sender).unwrap();
        for planned in watch_plan(git_dir, common_dir) {
            let _ = watcher.watch(&planned.path, planned.mode);
        }
        (watcher, receiver)
    }

    #[test]
    fn resolves_main_and_linked_worktree_dirs() {
        let (base, repo) = temp_repo();
        git(&repo, &["commit", "-q", "--allow-empty", "-m", "init"]);
        git(&repo, &["worktree", "add", "-q", "../tree"]);

        let (git_dir, common_dir) = resolve(&repo.to_string_lossy()).unwrap();
        assert_eq!(norm(&git_dir), norm(&common_dir));
        assert!(norm(&git_dir).ends_with("/repo/.git"));

        let (tree_git, tree_common) = resolve(&base.join("tree").to_string_lossy()).unwrap();
        assert!(norm(&tree_git).ends_with("/repo/.git/worktrees/tree"));
        assert_eq!(norm(&tree_common), norm(&common_dir));

        let nested = repo.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        assert_eq!(
            norm(&resolve(&nested.to_string_lossy()).unwrap().0),
            norm(&git_dir)
        );

        assert!(resolve(&base.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_apps_own_reads_do_not_report_changes() {
        let (base, repo) = temp_repo();
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        git(&repo, &["add", "a.txt"]);
        git(&repo, &["commit", "-q", "-m", "init"]);
        std::fs::write(repo.join("a.txt"), "two\n").unwrap();
        git(&repo, &["stash", "-q"]);
        let cwd = repo.to_string_lossy().to_string();
        let (git_dir, common_dir) = resolve(&cwd).unwrap();
        let (watcher, receiver) = watch_all(&git_dir, &common_dir);
        // A stale stat cache: a read that refreshed it would rewrite the index.
        std::thread::sleep(Duration::from_millis(1100));
        std::fs::write(repo.join("a.txt"), "three\n").unwrap();
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        while receiver.recv_timeout(Duration::from_millis(500)).is_ok() {}

        tauri::async_runtime::block_on(async {
            crate::fs::git_diff_stats(cwd.clone()).await.unwrap();
            crate::fs::git_diff_index(cwd.clone()).await.unwrap();
            crate::fs::git_branches(cwd.clone()).await.unwrap();
            crate::fs::git_stash_list(cwd.clone()).await.unwrap();
            crate::fs::git_history(cwd.clone(), Some(50), Some(true))
                .await
                .unwrap();
        });

        let mut paths = Vec::new();
        while let Ok(event) = receiver.recv_timeout(Duration::from_millis(1000)) {
            paths.extend(
                meaningful_paths(event.unwrap())
                    .iter()
                    .map(|path| norm(path)),
            );
        }
        let mut subs = HashMap::new();
        subs.insert(
            ("main".to_string(), cwd),
            sub(&norm(&git_dir), &norm(&common_dir)),
        );
        assert!(reports(&subs, &paths, false).is_empty(), "{paths:?}");
        drop(watcher);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_watched_worktree_can_still_be_removed() {
        let (base, repo) = temp_repo();
        git(&repo, &["commit", "-q", "--allow-empty", "-m", "init"]);
        git(&repo, &["worktree", "add", "-q", "../tree"]);
        let (git_dir, common_dir) = resolve(&base.join("tree").to_string_lossy()).unwrap();
        let (watcher, receiver) = watch_all(&git_dir, &common_dir);
        git(&repo, &["worktree", "remove", "../tree"]);
        assert!(!base.join("tree").exists());
        assert!(!git_dir.exists());
        assert!(receiver.recv_timeout(Duration::from_secs(5)).is_ok());
        drop(watcher);
        let _ = std::fs::remove_dir_all(&base);
    }
}
