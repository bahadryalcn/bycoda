use super::*;

struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("bycoda-replace-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn options(query: &str) -> ReplaceOptions {
    ReplaceOptions {
        search: SearchOptions {
            cwd: String::new(),
            query: query.into(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
            include: None,
            exclude: None,
            search_id: String::new(),
        },
        replacement: "new".into(),
        dry_run: true,
        revisions: HashMap::new(),
    }
}
fn apply(root: &Path, options: &mut ReplaceOptions) -> ReplaceResult {
    let preview = replace_sync(root, options, |_| Ok(())).unwrap();
    options.revisions = preview.revisions;
    options.dry_run = false;
    replace_sync(root, options, |_| Ok(())).unwrap()
}

#[test]
fn plain_case_word_and_line_endings() {
    for (case, word, expected, count) in [
        (false, false, "new new newx\r\nnew\n", 4),
        (true, false, "new OLD newx\r\nnew\n", 3),
        (false, true, "new new oldx\r\nnew\n", 3),
    ] {
        let project = Project::new();
        std::fs::write(project.0.join("a.txt"), "old OLD oldx\r\nold\n").unwrap();
        let mut options = options("old");
        options.search.case_sensitive = case;
        options.search.whole_word = word;
        let result = apply(&project.0, &mut options);
        assert_eq!(result.files_changed, 1);
        assert_eq!(result.replacements, count);
        assert!(result.failures.is_empty());
        assert_eq!(
            std::fs::read_to_string(project.0.join("a.txt")).unwrap(),
            expected
        );
    }
}

#[test]
fn regex_captures_include_exclude_and_bom() {
    let project = Project::new();
    for name in ["a.txt", "skip.txt", "a.md"] {
        std::fs::write(project.0.join(name), "\u{feff}old12 old34\r\n").unwrap();
    }
    let mut options = options("old([[:digit:]]+)");
    options.search.regex = true;
    options.search.include = Some("*.txt".into());
    options.search.exclude = Some("skip.txt".into());
    options.replacement = "$1-new".into();
    let result = apply(&project.0, &mut options);
    assert_eq!(result.replacements, 2);
    assert_eq!(result.files_changed, 1);
    assert_eq!(
        std::fs::read_to_string(project.0.join("a.txt")).unwrap(),
        "\u{feff}12-new 34-new\r\n"
    );
    assert_eq!(
        std::fs::read_to_string(project.0.join("skip.txt")).unwrap(),
        "\u{feff}old12 old34\r\n"
    );
    assert_eq!(
        std::fs::read_to_string(project.0.join("a.md")).unwrap(),
        "\u{feff}old12 old34\r\n"
    );
}

#[test]
fn dry_run_and_changed_revision_never_write() {
    let project = Project::new();
    let path = project.0.join("a.txt");
    std::fs::write(&path, "old old").unwrap();
    let mut options = options("old");
    let preview = replace_sync(&project.0, &options, |_| Ok(())).unwrap();
    assert_eq!(preview.replacements, 2);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "old old");
    options.revisions = preview.revisions;
    options.dry_run = false;
    std::fs::write(&path, "old edited").unwrap();
    let result = replace_sync(&project.0, &options, |_| Ok(())).unwrap();
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.files_changed, 0);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "old edited");
}

#[test]
fn literal_dollars_binary_and_invalid_utf8() {
    let project = Project::new();
    std::fs::write(project.0.join("a.txt"), "old").unwrap();
    std::fs::write(project.0.join("binary"), b"old\0old").unwrap();
    std::fs::write(project.0.join("invalid"), b"old\xff").unwrap();
    let mut options = options("old");
    options.replacement = "$1".into();
    let result = apply(&project.0, &mut options);
    assert_eq!(result.files_changed, 1);
    assert_eq!(
        std::fs::read_to_string(project.0.join("a.txt")).unwrap(),
        "$1"
    );
}

#[test]
fn output_limit_and_missing_captures_do_not_corrupt_files() {
    let project = Project::new();
    let path = project.0.join("a.txt");
    std::fs::write(&path, "old").unwrap();
    let mut options = options("old");
    options.search.regex = true;
    options.replacement = "$1".into();
    let result = apply(&project.0, &mut options);
    assert!(result.failures.is_empty());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
    std::fs::write(&path, "old old").unwrap();
    options.dry_run = true;
    options.replacement = "x".repeat(512 * 1024);
    let result = replace_sync(&project.0, &options, |_| Ok(())).unwrap();
    assert!(result.failures[0].contains("exceed 512 KiB"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "old old");
}

#[test]
fn anchored_regex_keeps_bom_at_start() {
    let pattern = regex::Regex::new("^").unwrap();
    let (content, count) =
        replace_lines("\u{feff}old", &[1], &pattern, "new", true, false).unwrap();
    assert_eq!(content, "\u{feff}newold");
    assert_eq!(count, 1);
}
