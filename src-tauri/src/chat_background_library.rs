//! Library of every chat background image the owner applied (added, dropped or AI-drawn), kept
//! under `backgrounds/library/` so an image can be picked again and saved themes can refer to it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::chat_background::{backgrounds_dir, validate_background_file};
use crate::file_access::durable_write;
use crate::fs::expand_home;

/// Most images the library keeps; older unprotected ones are evicted past it.
const MAX_LIBRARY_IMAGES: usize = 60;
/// Byte budget of the library (each image is at most 25 MB).
const MAX_LIBRARY_BYTES: u64 = 400 * 1024 * 1024;
const ID_HEX_LEN: usize = 24;
const MAX_PROMPT_CHARS: usize = 400;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryImage {
    pub id: String,
    pub path: String,
    pub created_ms: u64,
    pub bytes: u64,
    /// `generated` for AI-drawn images, `added` for anything the owner picked or dropped.
    pub source: String,
    pub prompt: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Sidecar {
    source: Option<String>,
    prompt: Option<String>,
    created_ms: Option<u64>,
}

/// An entry the eviction rule looks at.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Candidate {
    id: String,
    created_ms: u64,
    bytes: u64,
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = backgrounds_dir(app)?.join("library");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_valid_id(id: &str) -> bool {
    id.len() == ID_HEX_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn content_id(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut id = String::with_capacity(ID_HEX_LEN);
    for byte in digest.iter().take(ID_HEX_LEN / 2) {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

fn normalize_source(source: &str) -> &'static str {
    if source == "generated" {
        "generated"
    } else {
        "added"
    }
}

fn normalize_prompt(prompt: Option<String>) -> Option<String> {
    let text = prompt?.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text.chars().take(MAX_PROMPT_CHARS).collect())
    }
}

fn sidecar_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

fn read_sidecar(dir: &Path, id: &str) -> Sidecar {
    std::fs::read(sidecar_path(dir, id))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn millis_since_epoch(time: std::time::SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

/// Image files in the library, newest first. Files that are not `<id>.<ext>` are ignored.
fn read_library(dir: &Path) -> Result<Vec<LibraryImage>, String> {
    let mut images = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let (Some(stem), Some(ext)) = (
            path.file_stem().and_then(|v| v.to_str()),
            path.extension().and_then(|v| v.to_str()),
        ) else {
            continue;
        };
        if !is_valid_id(stem) || ext == "json" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let sidecar = read_sidecar(dir, stem);
        let modified = meta.modified().map_or(0, millis_since_epoch);
        images.push(LibraryImage {
            id: stem.to_string(),
            path: path.to_string_lossy().into_owned(),
            created_ms: sidecar.created_ms.unwrap_or(modified),
            bytes: meta.len(),
            source: normalize_source(sidecar.source.as_deref().unwrap_or("added")).to_string(),
            prompt: sidecar.prompt,
        });
    }
    images.sort_by(|a, b| {
        b.created_ms
            .cmp(&a.created_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(images)
}

/// Ids to delete so the library fits the count and byte caps: oldest first, never a protected id
/// (referenced by a saved theme, or the image just added). Protected images may exceed the caps.
fn eviction_victims(
    entries: &[Candidate],
    protected: &HashSet<String>,
    max_count: usize,
    max_bytes: u64,
) -> Vec<String> {
    let mut count = entries.len();
    let mut bytes: u64 = entries.iter().map(|entry| entry.bytes).sum();
    let mut oldest: Vec<&Candidate> = entries.iter().collect();
    oldest.sort_by(|a, b| {
        a.created_ms
            .cmp(&b.created_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut victims = Vec::new();
    for entry in oldest {
        if count <= max_count && bytes <= max_bytes {
            break;
        }
        if protected.contains(&entry.id) {
            continue;
        }
        count -= 1;
        bytes -= entry.bytes;
        victims.push(entry.id.clone());
    }
    victims
}

fn remove_image(dir: &Path, image: &LibraryImage) -> Result<(), String> {
    for path in [PathBuf::from(&image.path), sidecar_path(dir, &image.id)] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn add_sync(
    app: &AppHandle,
    source_path: &str,
    source: &str,
    prompt: Option<String>,
    protected_ids: Vec<String>,
) -> Result<LibraryImage, String> {
    let source_file = expand_home(source_path);
    let ext = validate_background_file(&source_file)?;
    let bytes =
        std::fs::read(&source_file).map_err(|e| format!("{}: {e}", source_file.display()))?;
    let id = content_id(&bytes);
    let dir = library_dir(app)?;
    let existing = read_library(&dir)?;
    if let Some(found) = existing.iter().find(|image| image.id == id) {
        return Ok(found.clone());
    }
    durable_write(&dir.join(format!("{id}.{ext}")), &bytes)?;
    let sidecar = Sidecar {
        source: Some(normalize_source(source).to_string()),
        prompt: normalize_prompt(prompt),
        created_ms: Some(millis_since_epoch(std::time::SystemTime::now())),
    };
    let json = serde_json::to_vec(&sidecar).map_err(|e| e.to_string())?;
    durable_write(&sidecar_path(&dir, &id), &json)?;

    let mut all = read_library(&dir)?;
    let candidates: Vec<Candidate> = all
        .iter()
        .map(|image| Candidate {
            id: image.id.clone(),
            created_ms: image.created_ms,
            bytes: image.bytes,
        })
        .collect();
    let mut protected: HashSet<String> = protected_ids.into_iter().collect();
    protected.insert(id.clone());
    let victims: HashSet<String> = eviction_victims(
        &candidates,
        &protected,
        MAX_LIBRARY_IMAGES,
        MAX_LIBRARY_BYTES,
    )
    .into_iter()
    .collect();
    for image in all.iter().filter(|image| victims.contains(&image.id)) {
        remove_image(&dir, image)?;
    }
    all.retain(|image| !victims.contains(&image.id));
    all.into_iter()
        .find(|image| image.id == id)
        .ok_or_else(|| "Could not store the image.".to_string())
}

#[tauri::command]
pub async fn list_background_library(app: AppHandle) -> Result<Vec<LibraryImage>, String> {
    tauri::async_runtime::spawn_blocking(move || read_library(&library_dir(&app)?))
        .await
        .map_err(|e| e.to_string())?
}

/// Copies a validated image into the library (same id for the same bytes). `protected_ids` are the
/// images saved themes use; eviction past the caps never removes them.
#[tauri::command]
pub async fn add_background_library_image(
    app: AppHandle,
    source_path: String,
    source: String,
    prompt: Option<String>,
    protected_ids: Vec<String>,
) -> Result<LibraryImage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        add_sync(&app, &source_path, &source, prompt, protected_ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_background_library_image(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_valid_id(&id) {
            return Err("Invalid image id".to_string());
        }
        let dir = library_dir(&app)?;
        match read_library(&dir)?.iter().find(|image| image.id == id) {
            Some(image) => remove_image(&dir, image),
            None => Ok(()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, created_ms: u64, bytes: u64) -> Candidate {
        Candidate {
            id: id.into(),
            created_ms,
            bytes,
        }
    }

    #[test]
    fn same_bytes_share_an_id_and_different_bytes_do_not() {
        assert_eq!(content_id(b"abc"), content_id(b"abc"));
        assert_ne!(content_id(b"abc"), content_id(b"abd"));
        assert!(is_valid_id(&content_id(b"abc")));
    }

    #[test]
    fn ids_reject_paths_and_wrong_lengths() {
        assert!(!is_valid_id("../../etc/passwd"));
        assert!(!is_valid_id("abc"));
        assert!(!is_valid_id(&"G".repeat(ID_HEX_LEN)));
    }

    #[test]
    fn evicts_oldest_first_down_to_the_count_cap() {
        let entries = [entry("c", 3, 1), entry("a", 1, 1), entry("b", 2, 1)];
        let victims = eviction_victims(&entries, &HashSet::new(), 2, u64::MAX);
        assert_eq!(victims, vec!["a".to_string()]);
    }

    #[test]
    fn evicts_until_the_byte_budget_fits() {
        let entries = [entry("a", 1, 40), entry("b", 2, 40), entry("c", 3, 40)];
        let victims = eviction_victims(&entries, &HashSet::new(), 10, 70);
        assert_eq!(victims, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn never_evicts_protected_images_even_over_the_cap() {
        let entries = [entry("a", 1, 1), entry("b", 2, 1), entry("c", 3, 1)];
        let protected: HashSet<String> = ["a".to_string(), "b".to_string()].into();
        let victims = eviction_victims(&entries, &protected, 1, u64::MAX);
        assert_eq!(victims, vec!["c".to_string()]);
        let all: HashSet<String> = ["a", "b", "c"].map(String::from).into();
        assert!(eviction_victims(&entries, &all, 1, u64::MAX).is_empty());
    }

    #[test]
    fn keeps_everything_under_the_caps() {
        let entries = [entry("a", 1, 1), entry("b", 2, 1)];
        assert!(eviction_victims(&entries, &HashSet::new(), 2, 10).is_empty());
    }

    #[test]
    fn prompts_are_collapsed_and_capped() {
        assert_eq!(
            normalize_prompt(Some("  a   b \n c ".into())).as_deref(),
            Some("a b c")
        );
        assert_eq!(normalize_prompt(Some("   ".into())), None);
        let long = normalize_prompt(Some("x".repeat(MAX_PROMPT_CHARS + 50))).unwrap();
        assert_eq!(long.chars().count(), MAX_PROMPT_CHARS);
    }

    #[test]
    fn unknown_sources_count_as_added() {
        assert_eq!(normalize_source("generated"), "generated");
        assert_eq!(normalize_source("anything"), "added");
    }
}
