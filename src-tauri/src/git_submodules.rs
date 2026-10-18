use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::fs::{expand_home, git_run};

#[tauri::command]
pub async fn git_submodules(cwd: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list(&expand_home(&cwd)))
        .await
        .map_err(|error| error.to_string())?
}

/// Discover initialized gitlinks without fetching or moving any working tree.
fn list(cwd: &Path) -> Result<Vec<String>, String> {
    let root = cwd.canonicalize().map_err(|error| error.to_string())?;
    let mut queue = vec![root.clone()];
    let mut seen = HashSet::from([root.clone()]);
    let mut paths = Vec::new();
    let mut index = 0;
    while index < queue.len() {
        let parent = queue[index].clone();
        index += 1;
        let entries = git_run(&parent, &["ls-files", "--stage", "-z", "--", "."])
            .ok_or_else(|| "Could not read submodules".to_string())?;
        for entry in entries.split('\0') {
            let Some((metadata, path)) = entry.split_once('\t') else {
                continue;
            };
            let fields: Vec<_> = metadata.split(' ').collect();
            if fields.len() != 3
                || fields[0] != "160000"
                || !matches!(fields[2], "0" | "1" | "2" | "3")
            {
                continue;
            }
            let Ok(child) = parent.join(path).canonicalize() else {
                continue;
            };
            if seen.contains(&child) || !child.join(".git").exists() {
                continue;
            }
            let Ok(relative) = child.strip_prefix(&root) else {
                continue;
            };
            let top = git_run(&child, &["rev-parse", "--show-toplevel"])
                .ok_or_else(|| "Could not read submodule repository".to_string())?;
            if PathBuf::from(top.trim()).canonicalize().ok().as_ref() != Some(&child) {
                continue;
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
        }
    }
    paths.sort();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

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
