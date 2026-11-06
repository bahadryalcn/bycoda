use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::fs::{expand_home, git_stream_output, GIT_LOCAL_TIMEOUT};

const MAX_INDEX_RECORD_BYTES: usize = 64 * 1024;

#[derive(Default)]
struct IndexRecords {
    pending: Vec<u8>,
}

impl IndexRecords {
    fn feed(
        &mut self,
        bytes: &[u8],
        mut record: impl FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        for part in bytes.split_inclusive(|byte| *byte == 0) {
            let terminated = part.last() == Some(&0);
            let data = if terminated {
                &part[..part.len() - 1]
            } else {
                part
            };
            if self.pending.len().saturating_add(data.len()) > MAX_INDEX_RECORD_BYTES {
                return Err("Git index record is too large".into());
            }
            self.pending.extend_from_slice(data);
            if terminated {
                record(&self.pending)?;
                self.pending.clear();
            }
        }
        Ok(())
    }

    fn finish(self) -> Result<(), String> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err("Git index output was incomplete".into())
        }
    }
}

#[tauri::command]
pub async fn git_submodules(
    cwd: String,
    include_repositories: Option<bool>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_options(&expand_home(&cwd), include_repositories.unwrap_or(false))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Discover initialized gitlinks without fetching or moving any working tree.
#[cfg(test)]
fn list(cwd: &Path) -> Result<Vec<String>, String> {
    list_options(cwd, false)
}

fn list_options(cwd: &Path, include_repositories: bool) -> Result<Vec<String>, String> {
    let root = cwd.canonicalize().map_err(|error| error.to_string())?;
    let deadline = Instant::now() + GIT_LOCAL_TIMEOUT;
    let mut queue = vec![root.clone()];
    let mut seen = HashSet::from([root.clone()]);
    let mut paths = Vec::new();
    let mut index = 0;
    while index < queue.len() {
        let parent = queue[index].clone();
        index += 1;
        let mut parser = IndexRecords::default();
        git_stream_output(
            &parent,
            &["ls-files", "--stage", "-z", "--", "."],
            deadline,
            false,
            |chunk| {
                parser.feed(chunk, |entry| {
                    let entry = String::from_utf8_lossy(entry);
                    let Some((metadata, path)) = entry.split_once('\t') else {
                        return Err("Git index record is invalid".into());
                    };
                    let fields: Vec<_> = metadata.split(' ').collect();
                    if fields.len() != 3 || !matches!(fields[2], "0" | "1" | "2" | "3") {
                        return Err("Git index record is invalid".into());
                    }
                    if fields[0] != "160000" {
                        return Ok(());
                    }
                    let Ok(child) = parent.join(path).canonicalize() else {
                        return Ok(());
                    };
                    if seen.contains(&child) || !child.join(".git").exists() {
                        return Ok(());
                    }
                    let Ok(relative) = child.strip_prefix(&root) else {
                        return Ok(());
                    };
                    let mut top = Vec::new();
                    git_stream_output(
                        &child,
                        &["rev-parse", "--show-toplevel"],
                        deadline,
                        true,
                        |chunk| {
                            if top.len().saturating_add(chunk.len()) > MAX_INDEX_RECORD_BYTES {
                                return Err("Submodule repository path is too large".into());
                            }
                            top.extend_from_slice(chunk);
                            Ok(())
                        },
                    )?;
                    let top = String::from_utf8_lossy(&top);
                    if PathBuf::from(top.trim()).canonicalize().ok().as_ref() != Some(&child) {
                        return Ok(());
                    }
                    if paths.len() >= 256 {
                        return Err("Too many nested submodules".to_string());
                    }
                    paths.push(
                        relative
                            .to_string_lossy()
                            .replace(std::path::MAIN_SEPARATOR, "/"),
                    );
                    seen.insert(child.clone());
                    queue.push(child);
                    Ok(())
                })
            },
        )?;
        parser.finish()?;
    }
    if include_repositories {
        discover_repositories(&root, deadline, &mut seen, &mut paths)?;
    }
    paths.sort();
    Ok(paths)
}

const SKIP_DIRECTORIES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".pnpm",
    ".yarn",
    ".cache",
    ".next",
    ".nuxt",
    ".output",
    ".turbo",
    ".expo",
    "target",
    "dist",
    "build",
    "coverage",
    "temp",
];

fn linked(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

/// Read-only opt-in discovery includes ignored source roots, skipping all directory links.
fn discover_repositories(
    root: &Path,
    deadline: Instant,
    seen: &mut HashSet<PathBuf>,
    paths: &mut Vec<String>,
) -> Result<(), String> {
    let mut queue = vec![(root.to_path_buf(), 0usize)];
    let mut index = 0usize;
    let mut entries = 0usize;
    while index < queue.len() {
        if Instant::now() >= deadline {
            return Err("Repository discovery timed out".into());
        }
        if index >= 10_000 {
            return Err("Repository discovery directory limit exceeded".into());
        }
        let (directory, depth) = queue[index].clone();
        index += 1;
        // Recheck queued paths at the read boundary; this is not an atomic snapshot.
        let metadata = std::fs::symlink_metadata(&directory).map_err(|error| error.to_string())?;
        if !metadata.is_dir()
            || linked(&metadata)
            || directory
                .canonicalize()
                .map_err(|error| error.to_string())?
                != directory
            || !directory.starts_with(root)
        {
            return Err("Repository discovery directory changed".into());
        }
        #[cfg(windows)]
        for ancestor in directory.ancestors() {
            let metadata =
                std::fs::symlink_metadata(ancestor).map_err(|error| error.to_string())?;
            if !metadata.is_dir() || linked(&metadata) {
                return Err("Repository discovery directory changed".into());
            }
        }
        for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
            if Instant::now() >= deadline {
                return Err("Repository discovery timed out".into());
            }
            entries += 1;
            if entries > 200_000 {
                return Err("Repository discovery entry limit exceeded".into());
            }
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let skip = if cfg!(windows) {
                name.to_ascii_lowercase()
            } else {
                name.into_owned()
            };
            if SKIP_DIRECTORIES.contains(&skip.as_str()) {
                continue;
            }
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if !metadata.is_dir() || linked(&metadata) {
                continue;
            }
            if depth >= 64 {
                return Err("Repository discovery depth limit exceeded".into());
            }
            let child = path.canonicalize().map_err(|error| error.to_string())?;
            if child != path || !child.starts_with(root) {
                continue;
            }
            let git = match std::fs::symlink_metadata(child.join(".git")) {
                Ok(metadata) => Some(metadata),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.to_string()),
            };
            if git.is_some_and(|metadata| {
                !linked(&metadata) && (metadata.is_file() || metadata.is_dir())
            }) && !seen.contains(&child)
            {
                let mut top = Vec::new();
                git_stream_output(
                    &child,
                    &["rev-parse", "--show-toplevel"],
                    deadline,
                    true,
                    |chunk| {
                        if top.len().saturating_add(chunk.len()) > MAX_INDEX_RECORD_BYTES {
                            return Err("Repository path is too large".into());
                        }
                        top.extend_from_slice(chunk);
                        Ok(())
                    },
                )?;
                let top = String::from_utf8_lossy(&top);
                if PathBuf::from(top.trim()).canonicalize().ok().as_ref() == Some(&child) {
                    if paths.len() >= 256 {
                        return Err("Too many nested repositories".into());
                    }
                    paths.push(
                        child
                            .strip_prefix(root)
                            .map_err(|error| error.to_string())?
                            .to_string_lossy()
                            .replace(std::path::MAIN_SEPARATOR, "/"),
                    );
                    seen.insert(child.clone());
                }
            }
            queue.push((child, depth + 1));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_records_stream_without_retaining_the_index() {
        let mut parser = IndexRecords::default();
        let mut count = 0usize;
        let data = b"100644 abc 0\tfile\0";
        for _ in 0..200_000 {
            for chunk in data.chunks(7) {
                parser
                    .feed(chunk, |record| {
                        assert_eq!(record, b"100644 abc 0\tfile");
                        count += 1;
                        Ok(())
                    })
                    .unwrap();
                assert!(parser.pending.len() < data.len());
            }
        }
        parser.finish().unwrap();
        assert_eq!(count, 200_000);
    }

    #[test]
    fn index_records_reject_oversized_and_truncated_records() {
        let mut parser = IndexRecords::default();
        assert!(parser
            .feed(&vec![b'x'; MAX_INDEX_RECORD_BYTES + 1], |_| Ok(()))
            .is_err());
        let mut parser = IndexRecords::default();
        parser.feed(b"unfinished", |_| Ok(())).unwrap();
        assert!(parser.finish().is_err());
        let mut parser = IndexRecords::default();
        assert!(parser.feed(b"entry\0", |_| Err("stop".into())).is_err());
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("bycoda-submodules-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn repo(&self, path: &str) -> PathBuf {
            let dir = self.0.join(path);
            std::fs::create_dir_all(&dir).unwrap();
            run(&dir, &["init", "-q"]);
            run(&dir, &["config", "user.name", "Test"]);
            run(&dir, &["config", "user.email", "test@example.test"]);
            run(&dir, &["config", "commit.gpgsign", "false"]);
            std::fs::write(dir.join("file.txt"), "original\n").unwrap();
            run(&dir, &["add", "file.txt"]);
            run(&dir, &["commit", "-qm", "initial"]);
            dir
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run(cwd: &Path, args: &[&str]) -> String {
        let output =
            crate::fs::git_cmd_output(crate::fs::git_cmd().arg("-C").arg(cwd).args(args)).unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    #[test]
    fn large_index_discovers_gitlink_without_gitmodules() {
        use std::io::Write;
        use std::process::Stdio;
        let fixture = Fixture::new();
        let parent = fixture.repo("parent");
        let child = fixture.repo("parent/child");
        let blob = run(&parent, &["rev-parse", "HEAD:file.txt"]);
        let commit = run(&child, &["rev-parse", "HEAD"]);
        let mut command = crate::fs::git_cmd();
        let mut process = command
            .arg("-C")
            .arg(&parent)
            .args(["update-index", "--index-info"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        {
            let mut input = process.stdin.take().unwrap();
            for index in 0..50_000 {
                writeln!(input, "100644 {blob}\tstaged-{index:05}").unwrap();
            }
            writeln!(input, "160000 {commit}\tchild").unwrap();
        }
        let output = process.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!parent.join(".gitmodules").exists());
        assert_eq!(list(&parent).unwrap(), vec!["child"]);
    }

    #[test]
    fn discovers_nested_modules_and_skips_uninitialized_without_mutation() {
        let fixture = Fixture::new();
        let source = fixture.repo("source");
        let parent = fixture.repo("parent");
        run(
            &parent,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "--",
                source.to_str().unwrap(),
                "core pack",
            ],
        );
        let child = parent.join("core pack");
        // A freshly added nested gitlink is discoverable before the parent commits it.
        run(
            &child,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "--",
                source.to_str().unwrap(),
                "nested",
            ],
        );
        std::fs::write(child.join("file.txt"), "local changes\n").unwrap();
        let before = run(&parent, &["status", "--porcelain"]);
        assert_eq!(
            list(&parent).unwrap(),
            vec!["core pack", "core pack/nested"]
        );
        assert_eq!(before, run(&parent, &["status", "--porcelain"]));
        assert_eq!(
            std::fs::read_to_string(child.join("file.txt")).unwrap(),
            "local changes\n"
        );
        run(&child, &["submodule", "deinit", "-f", "--", "nested"]);
        assert_eq!(list(&parent).unwrap(), vec!["core pack"]);
        assert!(list(&source).unwrap().is_empty());
    }

    #[test]
    fn opt_in_discovers_ignored_repositories_and_gitfiles_without_following_links() {
        let fixture = Fixture::new();
        let parent = fixture.repo("parent");
        let mobile = fixture.repo("parent/mobile");
        let outside = fixture.repo("outside");
        fixture.repo("parent/node_modules/dependency");
        std::fs::write(parent.join(".gitignore"), "mobile/\nnode_modules/\n").unwrap();
        std::fs::write(mobile.join("file.txt"), "independent draft\n").unwrap();
        run(&mobile, &["add", "file.txt"]);
        std::fs::write(mobile.join("file.txt"), "independent unsaved change\n").unwrap();
        let review = parent.join("review-copy");
        run(
            &outside,
            &["worktree", "add", "-qb", "review", review.to_str().unwrap()],
        );
        #[cfg(windows)]
        {
            let mut command = std::process::Command::new("cmd");
            crate::hide_window_console(&mut command);
            let output = crate::fs::git_cmd_output(
                command
                    .args(["/c", "mklink", "/J"])
                    .arg(parent.join("external"))
                    .arg(&outside),
            )
            .unwrap();
            assert!(output.status.success());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, parent.join("external")).unwrap();
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        assert!(discover_repositories(
            &parent.join("external"),
            Instant::now() + GIT_LOCAL_TIMEOUT,
            &mut seen,
            &mut paths
        )
        .unwrap_err()
        .contains("directory changed"));
        let before = run(&parent, &["status", "--porcelain"]);
        let index = run(&mobile, &["diff", "--cached"]);
        assert!(list(&parent).unwrap().is_empty());
        assert_eq!(
            list_options(&parent, true).unwrap(),
            vec!["mobile", "review-copy"]
        );
        assert_eq!(run(&parent, &["status", "--porcelain"]), before);
        assert_eq!(run(&mobile, &["diff", "--cached"]), index);
        assert_eq!(
            std::fs::read_to_string(mobile.join("file.txt")).unwrap(),
            "independent unsaved change\n"
        );
    }

    #[test]
    fn opt_in_reports_depth_and_deadline_limits_instead_of_empty_success() {
        let fixture = Fixture::new();
        let parent = fixture.repo("parent");
        let mut nested = parent.clone();
        for _ in 0..66 {
            nested = nested.join("d");
        }
        std::fs::create_dir_all(nested).unwrap();
        assert!(list_options(&parent, true)
            .unwrap_err()
            .contains("depth limit"));
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        assert!(
            discover_repositories(&parent, Instant::now(), &mut seen, &mut paths)
                .unwrap_err()
                .contains("timed out")
        );
    }

    #[test]
    fn discovers_conflicted_gitlinks_once_with_nested_modules() {
        use std::io::Write;
        use std::process::Stdio;

        let fixture = Fixture::new();
        let source = fixture.repo("source");
        let parent = fixture.repo("parent");
        run(
            &parent,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "--",
                source.to_str().unwrap(),
                "core pack",
            ],
        );
        let child = parent.join("core pack");
        run(
            &child,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "--",
                source.to_str().unwrap(),
                "nested",
            ],
        );
        let sha = run(&child, &["rev-parse", "HEAD"]);
        let input = format!(
            "0 {}\tcore pack\n160000 {sha} 1\tcore pack\n160000 {sha} 2\tcore pack\n160000 {sha} 3\tcore pack\n",
            "0".repeat(40)
        );
        let mut command = crate::fs::git_cmd();
        let mut process = command
            .arg("-C")
            .arg(&parent)
            .args(["update-index", "--index-info"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        process
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        let output = process.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let before = run(&parent, &["ls-files", "--stage"]);
        assert!(before.contains(&format!("160000 {sha} 1\tcore pack")));
        assert!(!before.contains(&format!("160000 {sha} 0\tcore pack")));
        assert_eq!(
            list(&parent).unwrap(),
            vec!["core pack", "core pack/nested"]
        );
        assert_eq!(run(&parent, &["ls-files", "--stage"]), before);
        run(&child, &["submodule", "deinit", "-f", "--", "nested"]);
        assert_eq!(list(&parent).unwrap(), vec!["core pack"]);
    }
}
