use std::collections::BTreeSet;

pub(super) fn includes(path: &[u8], captured: &BTreeSet<String>, ambiguous: bool) -> bool {
    (!ambiguous && captured.is_empty()) || captured.iter().any(|name| name.as_bytes() == path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unrelated_non_utf8_paths_do_not_match_or_alias_captured_names() {
        let captured = BTreeSet::from(["file\u{fffd}.txt".to_owned(), "ok.txt".to_owned()]);
        assert!(!includes(b"file\xff.txt", &captured, false));
        assert!(includes("file\u{fffd}.txt".as_bytes(), &captured, false));
        assert!(includes(b"ok.txt", &captured, true));
        assert!(!includes(b"other.txt", &captured, true));
    }
}
