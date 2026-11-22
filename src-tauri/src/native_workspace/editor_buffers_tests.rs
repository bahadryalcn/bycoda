use super::*;

fn buf(path: &str, dirty: bool) -> BufferState {
    BufferState {
        path: path.into(),
        dirty,
    }
}

#[test]
fn unreported_window_has_nothing() {
    let registry = EditorBuffers::default();
    assert!(registry.dirty_under("/a/b").is_empty());
    assert!(registry.snapshot().is_empty());
}

#[test]
fn report_replaces_and_clear_removes() {
    let registry = EditorBuffers::default();
    registry.report("main", &[buf("/a/b/x.ts", true)]);
    registry.report("main", &[buf("/a/b/y.ts", true)]);
    assert_eq!(registry.dirty_under("/a/b"), vec!["/a/b/y.ts"]);
    registry.report("other", &[buf("/a/b/z.ts", false)]);
    assert_eq!(registry.snapshot().len(), 2);
    registry.report("main", &[]);
    assert!(registry.dirty_under("/a/b").is_empty());
    registry.clear("other");
    assert!(registry.snapshot().is_empty());
}

#[test]
fn dirty_under_matches_inside_equal_and_not_sibling_prefix() {
    let registry = EditorBuffers::default();
    registry.report(
        "main",
        &[
            buf("/a/b/src/x.ts", true),
            buf("/a/b", true),
            buf("/a/bc/y.ts", true),
            buf("/a/other/z.ts", true),
            buf("/a/b/clean.ts", false),
        ],
    );
    assert_eq!(registry.dirty_under("/a/b"), vec!["/a/b", "/a/b/src/x.ts"]);
    assert_eq!(registry.dirty_under("/a/b/"), vec!["/a/b", "/a/b/src/x.ts"]);
    assert_eq!(registry.dirty_under("/a/bc"), vec!["/a/bc/y.ts"]);
    assert!(registry.dirty_under("/a/b/src/x").is_empty());
}

#[test]
fn dirty_under_spans_windows_and_dedups() {
    let registry = EditorBuffers::default();
    registry.report("one", &[buf("/w/f.ts", true)]);
    registry.report("two", &[buf("/w/f.ts", true), buf("/w/g.ts", true)]);
    assert_eq!(registry.dirty_under("/w"), vec!["/w/f.ts", "/w/g.ts"]);
}

#[test]
fn windows_paths_compare_case_insensitively_with_either_separator() {
    let registry = EditorBuffers::default();
    registry.report("main", &[buf(r"C:\Repo\Src\a.ts", true)]);
    assert_eq!(registry.dirty_under("c:/repo"), vec![r"C:\Repo\Src\a.ts"]);
    assert!(registry.dirty_under(r"C:\Repo2").is_empty());
}
