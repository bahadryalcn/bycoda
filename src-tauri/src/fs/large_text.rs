//! Text reads for the editor, and read-only paging for files above its limit.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
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

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextSlice {
    text: String,
    /// Byte offset where `text` starts.
    offset: u64,
    /// Byte offset just past `text`; the next page starts here.
    end: u64,
    size: u64,
}

/// One page of a large text file, starting at `offset` and cut at line breaks.
#[tauri::command]
pub async fn read_text_file_slice(
    app: AppHandle,
    window: tauri::Window,
    path: String,
    offset: u64,
) -> Result<TextSlice, String> {
    let admission = admit_window_buffers(&window)?;
    run_admitted_blocking(admission, move || {
        let path = expand_home(&path);
        crate::file_access::require(&app, &path, false)?;
        read_slice(&path, offset, SLICE_BYTES)
    })
    .await
}

fn read_slice(path: &Path, offset: u64, limit: u64) -> Result<TextSlice, String> {
    let mut file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    let size = meta.len();
    let start = offset.min(size);
    // Read from one byte early so a page that begins right after a line
    // break keeps its first line; otherwise it skips to the next break.
    let base = start.saturating_sub(1);
    file.seek(SeekFrom::Start(base))
        .map_err(|e| e.to_string())?;
    let want = limit + (start - base);
    let mut bytes = Vec::with_capacity(want.min(size - base) as usize);
    file.take(want)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Err("Binary files cannot be previewed.".into());
    }

    // A page that starts mid-line begins after the next line break, so it
    // never shows half a line; the previous page ended on a break.
    let mut head = 0;
    if start > 0 {
        if let Some(index) = bytes.iter().position(|&b| b == b'\n') {
            head = index + 1;
        } else {
            head = 1;
        }
    }
    let at_eof = base + bytes.len() as u64 >= size;
    let mut tail = bytes.len();
    if !at_eof {
        match bytes[head..].iter().rposition(|&b| b == b'\n') {
            Some(index) => tail = head + index + 1,
            // One line longer than a page: cut it at a character boundary.
            None => tail = head + utf8_prefix_len(&bytes[head..]),
        }
    }
    let tail = tail.max(head);
    Ok(TextSlice {
        text: String::from_utf8_lossy(&bytes[head..tail]).into_owned(),
        offset: base + head as u64,
        end: base + tail as u64,
        size,
    })
}

/// Length of `bytes` without a trailing, incomplete UTF-8 sequence.
fn utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => bytes.len(),
    }
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

    #[test]
    fn pages_cut_at_line_breaks_and_cover_the_file() {
        let (_dir, path) = write(b"aaaa\nbbbb\ncccc\ndddd\n");
        let first = read_slice(&path, 0, 12).unwrap();
        assert_eq!(first.text, "aaaa\nbbbb\n");
        assert_eq!((first.offset, first.end, first.size), (0, 10, 20));
        let second = read_slice(&path, first.end, 12).unwrap();
        assert_eq!(second.text, "cccc\ndddd\n");
        assert_eq!((second.offset, second.end), (10, 20));
        // An offset inside a line resumes at the next line.
        let inside = read_slice(&path, 2, 12).unwrap();
        assert_eq!(inside.text, "bbbb\n");
        assert_eq!((inside.offset, inside.end), (5, 10));
    }

    #[test]
    fn long_line_is_cut_at_a_character_boundary() {
        let (_dir, path) = write("ééééé\n".as_bytes());
        let slice = read_slice(&path, 0, 5).unwrap();
        assert_eq!(slice.text, "éé");
        assert_eq!(slice.end, 4);
    }

    #[test]
    fn binary_content_is_rejected() {
        let (_dir, path) = write(b"ab\0cd");
        assert!(read_slice(&path, 0, 16).is_err());
    }
}
