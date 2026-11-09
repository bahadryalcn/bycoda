use super::logs::read_tail;

fn file(bytes: &[u8]) -> tempfile::NamedTempFile {
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new().unwrap();
    file.write_all(bytes).unwrap();
    file
}

#[test]
fn small_file_is_returned_whole() {
    let f = file(b"a\nb\n");
    assert_eq!(read_tail(f.path(), 100), Some(("a\nb\n".into(), false)));
}

#[test]
fn large_file_drops_partial_first_line() {
    let f = file(b"first line\nsecond\nthird\n");
    let (text, truncated) = read_tail(f.path(), 12).unwrap();
    assert!(truncated);
    assert_eq!(text, "third\n");
}

#[test]
fn tail_without_newline_is_empty_when_truncated() {
    let f = file(b"abcdefghij");
    assert_eq!(read_tail(f.path(), 4), Some((String::new(), true)));
}

#[test]
fn invalid_utf8_is_decoded_lossily() {
    let f = file(b"ok \xff\xfe bad\n");
    let (text, truncated) = read_tail(f.path(), 100).unwrap();
    assert!(!truncated);
    assert!(text.contains('\u{fffd}'));
}

#[test]
fn missing_file_is_none() {
    assert_eq!(
        read_tail(std::path::Path::new("no-such-file.log"), 10),
        None
    );
}
