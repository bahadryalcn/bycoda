//! Text reads for the editor, and read-only paging for files above its limit.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::{expand_home, text_admission, MAX_TEXT_FILE_BYTES};
use crate::native_window_lifecycle::{admit_window_buffers, run_admitted_blocking};

/// Bytes read per page; small enough for a plain text view to stay responsive.
const SLICE_BYTES: u64 = 1024 * 1024;

/// Read a reasonably sized UTF-8 file for the editor.
#[tauri::command]
pub async fn read_text_file(
    app: AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<String, String> {
    let admission = admit_window_buffers(&window)?;
    text_admission::run(admission, move || {
        crate::file_access::require(&app, &expand_home(&path), false)?;
        read_text_file_sync(&path)
    })
    .await
}

/// The "too large" message is matched by the UI (`isTooLargeToEdit`), which
/// then opens the file with `read_text_file_slice` instead.
pub(super) fn read_text_file_sync(path: &str) -> Result<String, String> {
    let path = expand_home(path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large to edit (maximum {} MB).",
            MAX_TEXT_FILE_BYTES / 1024 / 1024
        ));
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if bytes.contains(&0) {
        return Err("Binary files cannot be edited.".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8.".into())
}

/// Identity of the file a paged view opened. The first page reports it and every
/// later page sends it back, so a file edited, truncated or replaced between
/// pages is refused instead of showing bytes from two different versions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    size: u64,
    /// Modification time in microseconds since the Unix epoch (0 when unknown).
    modified_us: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextSlice {
    text: String,
    /// Byte offset where `text` starts.
    offset: u64,
    /// Byte offset just past `text`; the next page starts exactly here, even
    /// when this page ended inside a line that is longer than a page.
    end: u64,
    size: u64,
    modified_us: u64,
}

const FILE_CHANGED: &str = "The file changed while it was open. Reopen it to continue.";

/// One page of a large text file, starting exactly at byte `offset` (page 0, or
/// an `offset`/`end` an earlier page returned) and cut at a line break, or at a
/// character boundary inside a line longer than a page. `expected` is the identity
/// the first page reported.
#[tauri::command]
pub async fn read_text_file_slice(
    app: AppHandle,
    window: tauri::Window,
    path: String,
    offset: u64,
    expected: Option<FileStamp>,
) -> Result<TextSlice, String> {
    let admission = admit_window_buffers(&window)?;
    run_admitted_blocking(admission, move || {
        let path = expand_home(&path);
        crate::file_access::require(&app, &path, false)?;
        read_slice(&path, offset, SLICE_BYTES, expected)
    })
    .await
}

fn file_stamp(file: &File) -> Result<FileStamp, String> {
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    let modified_us = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_micros() as u64);
    Ok(FileStamp {
        size: meta.len(),
        modified_us,
    })
}

fn read_slice(
    path: &Path,
    offset: u64,
    limit: u64,
    expected: Option<FileStamp>,
) -> Result<TextSlice, String> {
    // A page must hold at least one whole UTF-8 character to make progress.
    let limit = limit.max(4);
    let mut file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let opened = file_stamp(&file)?;
    if expected.is_some_and(|expected| expected != opened) {
        return Err(FILE_CHANGED.into());
    }
    let size = opened.size;
    let start = offset.min(size);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    // Never read past the size the identity was taken at, so a file that grows
    // while it is read cannot make a page longer than the bound.
    let want = limit.min(size - start);
    let mut bytes = Vec::with_capacity(want as usize);
    file.by_ref()
        .take(want)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    // A write during the read changes the stamp, so the page never mixes versions.
    if file_stamp(&file)? != opened {
        return Err(FILE_CHANGED.into());
    }
    if bytes.contains(&0) {
        return Err("Binary files cannot be previewed.".into());
    }

    let mut tail = bytes.len();
    if start + (tail as u64) < size {
        tail = match bytes.iter().rposition(|&b| b == b'\n') {
            Some(index) => index + 1,
            // One line longer than a page: cut it at a character boundary; the
            // next page continues from this exact byte, not from a line break.
            None => complete_utf8_len(&bytes),
        };
    }
    Ok(TextSlice {
        text: String::from_utf8_lossy(&bytes[..tail]).into_owned(),
        offset: start,
        end: start + tail as u64,
        size,
        modified_us: opened.modified_us,
    })
}

/// Length of `bytes` without a trailing, incomplete UTF-8 sequence. Invalid
/// bytes elsewhere stay in place (decoded lossily) so no byte is dropped.
fn complete_utf8_len(bytes: &[u8]) -> usize {
    let len = bytes.len();
    for back in 1..=len.min(3) {
        let byte = bytes[len - back];
        if byte & 0xC0 == 0x80 {
            continue;
        }
        let needed = match byte {
            0xC2..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF4 => 4,
            _ => return len,
        };
        return if back < needed { len - back } else { len };
    }
    len
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(content: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.jsonl");
        std::fs::write(&path, content).unwrap();
        (dir, path)
    }

    /// Pages through the whole file the way the viewer does: every page starts
    /// at the previous page's `end` and carries the first page's identity.
    fn read_all(path: &Path, limit: u64) -> (String, Vec<TextSlice>) {
        let mut text = String::new();
        let mut pages = Vec::new();
        let mut offset = 0;
        let mut expected = None;
        loop {
            let page = read_slice(path, offset, limit, expected).unwrap();
            assert_eq!(page.offset, offset);
            assert!(page.end - page.offset <= limit.max(4));
            expected = Some(FileStamp {
                size: page.size,
                modified_us: page.modified_us,
            });
            text.push_str(&page.text);
            offset = page.end;
            let done = page.end >= page.size;
            assert!(done || page.end > page.offset, "page made no progress");
            pages.push(page);
            if done {
                return (text, pages);
            }
        }
    }

    #[test]
    fn pages_cut_at_line_breaks_and_cover_the_file() {
        let (_dir, path) = write(b"aaaa\nbbbb\ncccc\ndddd\n");
        let first = read_slice(&path, 0, 12, None).unwrap();
        assert_eq!(first.text, "aaaa\nbbbb\n");
        assert_eq!((first.offset, first.end, first.size), (0, 10, 20));
        let second = read_slice(&path, first.end, 12, None).unwrap();
        assert_eq!(second.text, "cccc\ndddd\n");
        assert_eq!((second.offset, second.end), (10, 20));
        // Past the end is an empty page, not an error.
        let past = read_slice(&path, 99, 12, None).unwrap();
        assert_eq!((past.text.as_str(), past.offset, past.end), ("", 20, 20));
    }

    #[test]
    fn long_line_is_cut_at_a_character_boundary() {
        let (_dir, path) = write("ééééé\n".as_bytes());
        let slice = read_slice(&path, 0, 5, None).unwrap();
        assert_eq!(slice.text, "éé");
        assert_eq!(slice.end, 4);
    }

    #[test]
    fn a_line_longer_than_a_page_continues_without_skipping_content() {
        let content = format!("{}\nshort\n{}", "é1".repeat(40), "x".repeat(37));
        let (_dir, path) = write(content.as_bytes());
        let (text, pages) = read_all(&path, 11);
        assert_eq!(text, content);
        assert!(pages.len() > 6);
    }

    #[test]
    fn a_page_continues_from_the_exact_offset_after_a_mid_line_cut() {
        let (_dir, path) = write(b"abcdefghij\nz\n");
        let first = read_slice(&path, 0, 4, None).unwrap();
        assert_eq!((first.text.as_str(), first.end), ("abcd", 4));
        let second = read_slice(&path, first.end, 4, None).unwrap();
        assert_eq!(
            (second.text.as_str(), second.offset, second.end),
            ("efgh", 4, 8)
        );
        let third = read_slice(&path, second.end, 4, None).unwrap();
        assert_eq!(third.text, "ij\n");
        assert_eq!(third.end, 11);
    }

    #[test]
    fn multibyte_characters_are_never_split_across_pages() {
        // 2-, 3- and 4-byte characters on one line, cut at every possible width.
        let content = "aé€😀b".repeat(25);
        let (_dir, path) = write(content.as_bytes());
        for limit in 4..=24 {
            let (text, pages) = read_all(&path, limit);
            assert_eq!(text, content, "limit {limit}");
            for page in pages {
                assert!(!page.text.contains('\u{FFFD}'), "limit {limit}");
            }
        }
    }

    #[test]
    fn invalid_bytes_are_kept_and_a_trailing_partial_sequence_waits_for_the_next_page() {
        // A stray 0xFF in the middle, then a 3-byte character that a 7-byte page
        // would cut after two of its bytes.
        let mut content = b"ab\xFFcd".to_vec();
        content.extend_from_slice("€".as_bytes());
        content.extend_from_slice(b"ef");
        let (_dir, path) = write(&content);
        let first = read_slice(&path, 0, 7, None).unwrap();
        assert_eq!(first.end, 5);
        assert_eq!(first.text, "ab\u{FFFD}cd");
        let (text, _) = read_all(&path, 7);
        assert_eq!(text, String::from_utf8_lossy(&content));
    }

    #[test]
    fn a_read_is_bounded_by_the_page_size_not_the_file_size() {
        let (_dir, path) = write("x".repeat(100).as_bytes());
        let page = read_slice(&path, 10, 8, None).unwrap();
        assert_eq!((page.offset, page.end, page.text.len()), (10, 18, 8));
    }

    #[test]
    fn a_file_changed_between_pages_is_refused() {
        let (_dir, path) = write(b"aaaa\nbbbb\ncccc\ndddd\n");
        let first = read_slice(&path, 0, 12, None).unwrap();
        let stamp = FileStamp {
            size: first.size,
            modified_us: first.modified_us,
        };
        // Unchanged: the next page is served.
        assert!(read_slice(&path, first.end, 12, Some(stamp)).is_ok());
        // Edited to a different size: the stale offset is rejected.
        std::fs::write(&path, b"aaaa\nbbbb\ncccc\ndddd\neeee\n").unwrap();
        let error = read_slice(&path, first.end, 12, Some(stamp)).unwrap_err();
        assert_eq!(error, FILE_CHANGED);
        // Truncated below the offset: also rejected rather than an empty page.
        std::fs::write(&path, b"aa\n").unwrap();
        assert_eq!(
            read_slice(&path, first.end, 12, Some(stamp)).unwrap_err(),
            FILE_CHANGED
        );
    }

    #[test]
    fn binary_content_is_rejected() {
        let (_dir, path) = write(b"ab\0cd");
        assert!(read_slice(&path, 0, 16, None).is_err());
    }
}
