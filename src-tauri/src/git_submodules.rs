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
pub async fn git_submodules(cwd: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list(&expand_home(&cwd)))
        .await
        .map_err(|error| error.to_string())?
}

/// Discover initialized gitlinks without fetching or moving any working tree.
fn list(cwd: &Path) -> Result<Vec<String>, String> {
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
    paths.sort();
    Ok(paths)
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
