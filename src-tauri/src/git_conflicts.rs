//! Unmerged paths: what kind of conflict each is, the three versions git keeps
//! for it, and where the repository's git directory is. `git ls-files -u` is
//! the one source (the host in host/git-conflicts.ts reads the same listing).

use crate::fs::{git_output, git_run, MAX_TEXT_FILE_BYTES};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Bits for the stages git records for a path: base, ours, theirs.
const BASE: u8 = 1;
const OURS: u8 = 2;
const THEIRS: u8 = 4;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictFile {
    pub path: String,
    pub relative: String,
    pub kind: &'static str,
}

/// The conflict kind for the stages git recorded (`git status`: UU, AA, DU,
/// UD, AU, UA, DD). `ours` is the current branch, `theirs` the incoming side.
pub(crate) fn conflict_kind(stages: u8) -> &'static str {
    match stages {
        s if s == BASE | OURS | THEIRS => "both-modified",
        s if s == OURS | THEIRS => "both-added",
        s if s == BASE | THEIRS => "deleted-by-us",
        s if s == BASE | OURS => "deleted-by-them",
        s if s == OURS => "added-by-us",
        s if s == THEIRS => "added-by-them",
        _ => "both-deleted",
    }
}

struct UnmergedEntry {
    relative: String,
    stage: u8,
    sha: String,
}

/// Parses `git ls-files -u -z`: `<mode> <sha> <stage>\t<path>` per NUL record.
fn parse_unmerged(text: &str) -> Vec<UnmergedEntry> {
    text.split('\0')
        .filter_map(|record| {
            let (meta, relative) = record.split_once('\t')?;
            let mut fields = meta.split(' ');
            let _mode = fields.next()?;
            let sha = fields.next()?.to_string();
            let stage = match fields.next()? {
                "1" => BASE,
                "2" => OURS,
                "3" => THEIRS,
                _ => return None,
            };
            Some(UnmergedEntry {
                relative: relative.to_string(),
                stage,
                sha,
            })
        })
        .collect()
}

fn unmerged_entries(root: &Path, pathspec: &str) -> Vec<UnmergedEntry> {
    let text = git_run(root, &["ls-files", "-u", "-z", "--", pathspec]).unwrap_or_default();
    parse_unmerged(&text)
}

/// Unmerged files under `root`, relative to it, in one git call.
pub(crate) fn git_unmerged_for(root: &Path) -> Vec<GitConflictFile> {
    let mut grouped: Vec<(String, u8)> = Vec::new();
    for entry in unmerged_entries(root, ".") {
        match grouped.last_mut() {
            Some((relative, stages)) if *relative == entry.relative => *stages |= entry.stage,
            _ => grouped.push((entry.relative, entry.stage)),
        }
    }
    grouped
        .into_iter()
        .map(|(relative, stages)| GitConflictFile {
            path: crate::fs::path_to_js(&root.join(&relative)),
            relative,
            kind: conflict_kind(stages),
        })
        .collect()
}

/// Why a commit or continue is refused while conflicts remain.
pub(crate) fn unmerged_message(files: &[GitConflictFile]) -> String {
    const SHOWN: usize = 5;
    let mut names: Vec<&str> = files
        .iter()
        .take(SHOWN)
        .map(|file| file.relative.as_str())
        .collect();
    if files.len() > SHOWN {
        names.push("...");
    }
    let noun = if files.len() == 1 {
        "file has"
    } else {
        "files have"
    };
    format!(
        "Resolve the merge conflicts first. {} {noun} unresolved conflicts: {}",
        files.len(),
        names.join(", ")
    )
}

/// Stages (as a bitmask) git holds for one repo-relative path; 0 when it is
/// not conflicted.
pub(crate) fn unmerged_stages_for(root: &Path, relative: &str) -> u8 {
    unmerged_entries(root, relative)
        .iter()
        .filter(|entry| entry.relative == relative)
        .fold(0, |bits, entry| bits | entry.stage)
}

/// Resolving by taking one side: `ours` or `theirs` as a stage bit.
pub(crate) fn side_stage(side: &str) -> Result<u8, String> {
    match side {
        "ours" => Ok(OURS),
        "theirs" => Ok(THEIRS),
        _ => Err("Invalid side".into()),
    }
}

/// Whether the chosen side still has the file (if not, it deleted it).
pub(crate) fn stage_has_side(stages: u8, side: u8) -> bool {
    stages & side != 0
}

/// The repository's git directory, found without running git (the index poll
/// asks every 2 s). Follows the `gitdir:` file of a linked worktree.
pub(crate) fn find_git_dir(root: &Path) -> Option<PathBuf> {
    for dir in root.ancestors() {
        let dot_git = dir.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        if dot_git.is_file() {
            let text = std::fs::read_to_string(&dot_git).ok()?;
            let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
            return Some(dir.join(target));
        }
    }
    None
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictStages {
    pub path: String,
    pub relative: String,
    pub kind: &'static str,
    /// Text of each version; `None` when git has no such stage (normal for
    /// add and delete conflicts). Empty when the file is binary or too large.
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub binary: bool,
    pub too_large: bool,
}

/// The base, current (ours) and incoming (theirs) versions of a conflicted file.
pub(crate) fn git_conflict_stages_for(
    root: &Path,
    relative: &str,
) -> Result<GitConflictStages, String> {
    let relative = crate::fs::resolve_repo_path(root, relative)?;
    // `ls-files` reads the argument as a pathspec; only exact matches count.
    let entries: Vec<UnmergedEntry> = unmerged_entries(root, &relative)
        .into_iter()
        .filter(|entry| entry.relative == relative)
        .collect();
    if entries.is_empty() {
        return Err("This file has no merge conflict".into());
    }
    let stages = entries.iter().fold(0, |bits, entry| bits | entry.stage);
    let mut binary = false;
    let mut too_large = false;
    let mut read = |stage: u8| -> Result<Option<String>, String> {
        let Some(entry) = entries.iter().find(|entry| entry.stage == stage) else {
            return Ok(None);
        };
        let bytes = git_output(root, &["cat-file", "blob", &entry.sha])
            .ok_or_else(|| "Could not read this version of the file".to_string())?;
        binary |= bytes.contains(&0);
        too_large |= bytes.len() as u64 > MAX_TEXT_FILE_BYTES;
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    };
    let mut base = read(BASE)?;
    let mut ours = read(OURS)?;
    let mut theirs = read(THEIRS)?;
    if binary || too_large {
        for side in [&mut base, &mut ours, &mut theirs] {
            if side.is_some() {
                *side = Some(String::new());
            }
        }
    }
    Ok(GitConflictStages {
        path: crate::fs::path_to_js(&root.join(&relative)),
        relative,
        kind: conflict_kind(stages),
        base,
        ours,
        theirs,
        binary,
        too_large,
    })
}

/// The three versions of a conflicted file, for the read-only Compare view.
#[tauri::command]
pub async fn git_conflict_stages(
    cwd: String,
    relative: String,
) -> Result<GitConflictStages, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_conflict_stages_for(&crate::fs::expand_home(&cwd), &relative)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    pub struct Tmp(pub PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    pub fn tmp(label: &str) -> Tmp {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-{label}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Tmp(dir)
    }
    pub fn git(dir: &Path, args: &[&str]) -> bool {
        let ok = Command::new("git")
            .args([
                "-c",
                "user.name=M",
                "-c",
                "user.email=m@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .env("GIT_EDITOR", "true")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        // The code under test runs git itself: give each repository the
        // identity and line endings a bare CI runner lacks (autocrlf=true on Windows).
        if ok && args.first() == Some(&"init") {
            for (key, value) in [
                ("user.name", "M"),
                ("user.email", "m@t"),
                ("commit.gpgsign", "false"),
                ("core.autocrlf", "false"),
            ] {
                Command::new("git")
                    .args(["config", key, value])
                    .current_dir(dir)
                    .output()
                    .unwrap();
            }
        }
        ok
    }
    pub fn write(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
    }
    pub fn commit(dir: &Path, msg: &str) {
        assert!(git(dir, &["add", "-A"]));
        assert!(git(dir, &["commit", "-m", msg]));
    }

    /// main and side both touch uu.txt (UU) and add aa.txt (AA); side deletes
    /// du.txt that main changed (UD), main deletes ud.txt that side changed (DU).
    fn merge_repo(label: &str) -> Tmp {
        let d = tmp(label);
        let r = &d.0;
        assert!(git(r, &["init", "-q", "-b", "main"]));
        for name in ["uu", "du", "ud", "keep"] {
            write(r, &format!("{name}.txt"), "a\n");
        }
        commit(r, "init");
        assert!(git(r, &["checkout", "-q", "-b", "side"]));
        write(r, "uu.txt", "side\n");
        write(r, "ud.txt", "side\n");
        write(r, "aa.txt", "side\n");
        std::fs::remove_file(r.join("du.txt")).unwrap();
        commit(r, "side");
        assert!(git(r, &["checkout", "-q", "main"]));
        write(r, "uu.txt", "main\n");
        write(r, "du.txt", "main\n");
        write(r, "aa.txt", "main\n");
        std::fs::remove_file(r.join("ud.txt")).unwrap();
        commit(r, "main");
        assert!(!git(r, &["merge", "side"]));
        d
    }

    fn kinds(root: &Path) -> Vec<(String, &'static str)> {
        git_unmerged_for(root)
            .into_iter()
            .map(|file| (file.relative, file.kind))
            .collect()
    }

    fn read(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap()
    }

    #[test]
    fn kinds_follow_the_stages_git_keeps() {
        assert_eq!(conflict_kind(BASE | OURS | THEIRS), "both-modified");
        assert_eq!(conflict_kind(OURS | THEIRS), "both-added");
        assert_eq!(conflict_kind(BASE | THEIRS), "deleted-by-us");
        assert_eq!(conflict_kind(BASE | OURS), "deleted-by-them");
        assert_eq!(conflict_kind(OURS), "added-by-us");
        assert_eq!(conflict_kind(THEIRS), "added-by-them");
        assert_eq!(conflict_kind(BASE), "both-deleted");
    }

    #[test]
    fn parses_unmerged_listing_with_odd_paths() {
        let text = "100644 aaa 1\tdir/a b.txt\x00100644 bbb 2\tdir/a b.txt\x00100644 ccc 3\tx\x00";
        let entries = parse_unmerged(text);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].relative, "dir/a b.txt");
        assert_eq!((entries[1].stage, entries[1].sha.as_str()), (OURS, "bbb"));
        assert!(parse_unmerged("").is_empty());
    }

    #[test]
    fn host_parity_fixture_preserves_stages_paths_and_conflict_kinds() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../host/fixtures/git-conflicts-parity.json"
        ))
        .unwrap();
        let entries = parse_unmerged(fixture["listing"].as_str().unwrap());
        let expected = fixture["entries"].as_array().unwrap();
        assert_eq!(entries.len(), expected.len());
        for (entry, expected) in entries.iter().zip(expected) {
            assert_eq!(entry.relative, expected["relative"].as_str().unwrap());
            // The wire fixture uses Git ordinals; native entries store stage bits.
            let expected_stage = match expected["stage"].as_u64().unwrap() {
                1 => BASE,
                2 => OURS,
                3 => THEIRS,
                stage => panic!("Unexpected Git stage in parity fixture: {stage}"),
            };
            assert_eq!(entry.stage, expected_stage);
            assert_eq!(entry.sha, expected["sha"].as_str().unwrap());
        }
        for example in fixture["kinds"].as_array().unwrap() {
            let stages = example["stages"]
                .as_array()
                .unwrap()
                .iter()
                .fold(0, |stages, stage| {
                    stages
                        | match stage.as_u64().unwrap() {
                            1 => BASE,
                            2 => OURS,
                            3 => THEIRS,
                            _ => unreachable!(),
                        }
                });
            assert_eq!(conflict_kind(stages), example["kind"].as_str().unwrap());
        }
    }

    #[test]
    fn merge_conflicts_leave_the_ordinary_file_list() {
        let d = merge_repo("conflict-merge");
        let r = &d.0;
        write(r, "keep.txt", "a\nb\n");
        write(r, "new.txt", "one\ntwo\n");

        let index = git_diff_index_for(r);
        assert_eq!(
            index
                .conflicts
                .iter()
                .map(|c| (c.relative.as_str(), c.kind))
                .collect::<Vec<_>>(),
            vec![
                ("aa.txt", "both-added"),
                ("du.txt", "deleted-by-them"),
                ("ud.txt", "deleted-by-us"),
                ("uu.txt", "both-modified"),
            ]
        );
        assert_eq!(index.operation, Some("merge"));
        // Only the two ordinary edits remain, each listed once.
        let files: Vec<_> = index
            .files
            .iter()
            .map(|f| (f.relative.as_str(), f.status.as_str(), f.staged, f.unstaged))
            .collect();
        assert_eq!(
            files,
            vec![
                ("keep.txt", "modified", false, true),
                ("new.txt", "untracked", false, true),
            ]
        );
        // Conflict-marker lines are not counted as additions.
        assert_eq!((index.additions, index.deletions), (3, 0));
        let stats = git_diff_stats_for(r);
        assert_eq!((stats.files, stats.additions, stats.deletions), (6, 3, 0));
    }

    #[test]
    fn cherry_pick_conflict_reports_its_operation() {
        let d = tmp("conflict-pick");
        let r = &d.0;
        assert!(git(r, &["init", "-q", "-b", "main"]));
        write(r, "a.txt", "alpha\n");
        commit(r, "init");
        assert!(git(r, &["checkout", "-q", "-b", "side"]));
        write(r, "a.txt", "side\n");
        commit(r, "side");
        assert!(git(r, &["checkout", "-q", "main"]));
        write(r, "a.txt", "main\n");
        commit(r, "main");
        assert!(!git(r, &["cherry-pick", "side"]));

        let index = git_diff_index_for(r);
        assert!(index.files.is_empty());
        assert_eq!(kinds(r), vec![("a.txt".to_string(), "both-modified")]);
        assert_eq!(index.operation, Some("cherry-pick"));
    }

    #[test]
    fn stash_pop_conflict_has_no_operation() {
        let d = tmp("conflict-stash");
        let r = &d.0;
        assert!(git(r, &["init", "-q", "-b", "main"]));
        write(r, "a.txt", "alpha\n");
        commit(r, "init");
        write(r, "a.txt", "stashed\n");
        assert!(git(r, &["stash"]));
        write(r, "a.txt", "committed\n");
        commit(r, "main");
        assert!(!git(r, &["stash", "pop"]));

        let index = git_diff_index_for(r);
        assert_eq!(index.operation, None);
        assert!(index.files.is_empty());
        assert_eq!(kinds(r), vec![("a.txt".to_string(), "both-modified")]);
        assert_eq!(git_diff_stats_for(r).files, 1);
    }

    #[test]
    fn rebase_continue_lands_on_the_next_conflicting_commit() {
        let d = tmp("conflict-rebase");
        let r = &d.0;
        assert!(git(r, &["init", "-q", "-b", "main"]));
        write(r, "a.txt", "base\n");
        commit(r, "init");
        assert!(git(r, &["checkout", "-q", "-b", "feature"]));
        write(r, "a.txt", "one\n");
        commit(r, "feature one");
        write(r, "a.txt", "two\n");
        commit(r, "feature two");
        assert!(git(r, &["checkout", "-q", "main"]));
        write(r, "a.txt", "main\n");
        commit(r, "main");
        assert!(git(r, &["checkout", "-q", "feature"]));
        assert!(!git(r, &["rebase", "main"]));

        assert_eq!(git_operation_state_for(r), Some("rebase"));
        assert_eq!(git_diff_index_for(r).operation, Some("rebase"));
        assert_eq!(kinds(r), vec![("a.txt".to_string(), "both-modified")]);
        // Continuing before resolving explains itself instead of running git.
        let refused = git_operation_continue_for(r).unwrap_err();
        assert!(refused.contains("a.txt"), "{refused}");

        write(r, "a.txt", "merged\n");
        git_stage_file_for(r, "a.txt").unwrap();
        assert!(git_unmerged_for(r).is_empty());
        // The second commit conflicts with the resolution: not an error.
        git_operation_continue_for(r).unwrap();
        assert_eq!(git_operation_state_for(r), Some("rebase"));
        assert_eq!(kinds(r), vec![("a.txt".to_string(), "both-modified")]);

        write(r, "a.txt", "final\n");
        git_stage_file_for(r, "a.txt").unwrap();
        git_operation_continue_for(r).unwrap();
        assert_eq!(git_operation_state_for(r), None);
        assert!(git_diff_index_for(r).conflicts.is_empty());
        assert_eq!(read(r, "a.txt"), "final\n");
    }

    #[test]
    fn resolving_by_side_handles_deleted_files() {
        let d = merge_repo("conflict-resolve");
        let r = &d.0;
        // deleted-by-us: we removed it, they changed it. Keeping ours deletes.
        git_resolve_conflict_for(r, "ud.txt", "ours").unwrap();
        assert!(!r.join("ud.txt").exists());
        // deleted-by-them: they removed it, we changed it. Keep ours.
        git_resolve_conflict_for(r, "du.txt", "ours").unwrap();
        assert_eq!(read(r, "du.txt"), "main\n");
        git_resolve_conflict_for(r, "aa.txt", "theirs").unwrap();
        assert_eq!(read(r, "aa.txt"), "side\n");
        assert_eq!(kinds(r), vec![("uu.txt".to_string(), "both-modified")]);
        assert!(git_resolve_conflict_for(r, "uu.txt", "mine").is_err());
        assert!(git_resolve_conflict_for(r, "keep.txt", "ours").is_err());
        git_resolve_conflict_for(r, "uu.txt", "theirs").unwrap();
        assert!(git_diff_index_for(r).conflicts.is_empty());

        // The other choices: take the deletion, keep the other side's file.
        let d = merge_repo("conflict-resolve-delete");
        let r = &d.0;
        git_resolve_conflict_for(r, "du.txt", "theirs").unwrap();
        assert!(!r.join("du.txt").exists());
        git_resolve_conflict_for(r, "ud.txt", "theirs").unwrap();
        assert_eq!(read(r, "ud.txt"), "side\n");
        assert_eq!(
            git_unmerged_for(r)
                .iter()
                .map(|f| f.relative.as_str())
                .collect::<Vec<_>>(),
            vec!["aa.txt", "uu.txt"]
        );
    }

    #[test]
    fn commit_and_stage_all_refuse_to_sweep_up_conflicts() {
        let d = merge_repo("conflict-commit");
        let r = &d.0;
        write(r, "keep.txt", "edited\n");
        git_stage_all_for(r).unwrap();
        let index = git_diff_index_for(r);
        assert_eq!(index.conflicts.len(), 4, "still unresolved after Stage All");
        assert!(index
            .files
            .iter()
            .any(|f| f.relative == "keep.txt" && f.staged));

        let message = git_commit_args(r, "wip", &[]).unwrap_err();
        assert!(
            message.contains("uu.txt") && message.contains("4 files"),
            "{message}"
        );
        let message = git_operation_continue_for(r).unwrap_err();
        assert!(message.contains("aa.txt"), "{message}");
    }

    #[test]
    fn conflict_stages_are_read_only_and_confined() {
        let d = merge_repo("conflict-stages");
        let r = &d.0;
        let uu = git_conflict_stages_for(r, "uu.txt").unwrap();
        assert_eq!(uu.kind, "both-modified");
        assert_eq!(
            (uu.base.as_deref(), uu.ours.as_deref(), uu.theirs.as_deref()),
            (Some("a\n"), Some("main\n"), Some("side\n"))
        );
        assert!(!uu.binary && !uu.too_large);
        // A missing stage is normal for add and delete conflicts.
        let aa = git_conflict_stages_for(r, "aa.txt").unwrap();
        assert_eq!(
            (aa.base, aa.ours.as_deref(), aa.theirs.as_deref()),
            (None, Some("main\n"), Some("side\n"))
        );
        let ud = git_conflict_stages_for(r, "ud.txt").unwrap();
        assert_eq!(ud.kind, "deleted-by-us");
        assert_eq!((ud.ours, ud.theirs.as_deref()), (None, Some("side\n")));

        for bad in [
            "../outside.txt",
            "/etc/passwd",
            "keep.txt",
            "--help",
            "-u",
            "",
            "uu.txt/..",
        ] {
            assert!(git_conflict_stages_for(r, bad).is_err(), "{bad}");
        }
        // Reading changes nothing.
        assert_eq!(git_unmerged_for(r).len(), 4);
    }

    #[test]
    fn binary_conflicts_are_flagged_without_contents() {
        let d = tmp("conflict-binary");
        let r = &d.0;
        assert!(git(r, &["init", "-q", "-b", "main"]));
        std::fs::write(r.join("b.bin"), [0u8, 1, 2]).unwrap();
        commit(r, "init");
        assert!(git(r, &["checkout", "-q", "-b", "side"]));
        std::fs::write(r.join("b.bin"), [0u8, 9, 9]).unwrap();
        commit(r, "side");
        assert!(git(r, &["checkout", "-q", "main"]));
        std::fs::write(r.join("b.bin"), [0u8, 7, 7]).unwrap();
        commit(r, "main");
        assert!(!git(r, &["merge", "side"]));
        let stages = git_conflict_stages_for(r, "b.bin").unwrap();
        assert!(stages.binary);
        assert_eq!(
            (
                stages.base.as_deref(),
                stages.ours.as_deref(),
                stages.theirs.as_deref()
            ),
            (Some(""), Some(""), Some(""))
        );
    }

    #[test]
    fn project_in_a_subfolder_sees_its_own_conflicts() {
        let d = tmp("conflict-sub");
        let r = &d.0;
        std::fs::create_dir(r.join("sub")).unwrap();
        assert!(git(r, &["init", "-q", "-b", "main"]));
        write(r, "sub/x.txt", "a\n");
        write(r, "top.txt", "a\n");
        commit(r, "init");
        assert!(git(r, &["checkout", "-q", "-b", "side"]));
        write(r, "sub/x.txt", "side\n");
        write(r, "top.txt", "side\n");
        commit(r, "side");
        assert!(git(r, &["checkout", "-q", "main"]));
        write(r, "sub/x.txt", "main\n");
        write(r, "top.txt", "main\n");
        commit(r, "main");
        assert!(!git(r, &["merge", "side"]));

        let sub = r.join("sub");
        let index = git_diff_index_for(&sub);
        assert_eq!(index.operation, Some("merge"));
        assert!(index.files.is_empty());
        assert_eq!(kinds(&sub), vec![("x.txt".to_string(), "both-modified")]);
        assert!(index.conflicts[0].path.ends_with("/sub/x.txt"));
        assert_eq!(
            git_conflict_stages_for(&sub, "x.txt")
                .unwrap()
                .ours
                .as_deref(),
            Some("main\n")
        );
        git_resolve_conflict_for(&sub, "x.txt", "theirs").unwrap();
        assert_eq!(kinds(r), vec![("top.txt".to_string(), "both-modified")]);
    }

    #[test]
    fn git_dir_follows_a_worktree_pointer() {
        let d = tmp("conflict-gitdir");
        let r = &d.0;
        std::fs::create_dir_all(r.join("real/wt")).unwrap();
        std::fs::create_dir_all(r.join("work/deep")).unwrap();
        write(r, "work/.git", "gitdir: ../real/wt\n");
        assert_eq!(
            find_git_dir(&r.join("work/deep")),
            Some(r.join("work/../real/wt"))
        );
        std::fs::create_dir(r.join("plain")).unwrap();
        std::fs::create_dir(r.join("plain/.git")).unwrap();
        assert_eq!(find_git_dir(&r.join("plain")), Some(r.join("plain/.git")));
    }
}
