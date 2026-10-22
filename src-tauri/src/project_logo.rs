use std::{
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

use crate::fs::expand_home;

const MAX_LOGO_BYTES: u64 = 2 * 1024 * 1024;
const ALLOWED_EXT: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

fn project_logos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("project-logos");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Projects are keyed by their full path, which sanitizing alone cannot keep
/// apart: `a-b/c` and `a/b/c` both collapse to `a-b-c`, and a deep checkout can
/// outgrow the filesystem's name limit. So every stem carries a hash of the
/// whole key and keeps only as much of its readable tail as fits.
const MAX_STEM_CHARS: usize = 96;
/// `-` plus the hex hash.
const HASH_CHARS: usize = 17;

fn fnv1a(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

fn sanitize_project_key(project: &str) -> String {
    let trimmed = project.trim();
    if trimmed.is_empty() {
        return "project".into();
    }
    let safe: String = trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let head = MAX_STEM_CHARS - HASH_CHARS;
    let readable: String = if safe.chars().count() <= head {
        safe
    } else {
        safe.chars().skip(safe.chars().count() - head).collect()
    };
    format!("{readable}-{:016x}", fnv1a(trimmed))
}

fn logo_stem(project: &str) -> String {
    sanitize_project_key(project)
}

fn remove_existing_logos(dir: &Path, project: &str) -> Result<(), String> {
    remove_existing_logos_except(dir, project, None)
}

fn remove_existing_logos_except(
    dir: &Path,
    project: &str,
    keep: Option<&Path>,
) -> Result<(), String> {
    let stem = logo_stem(project);
    let prefix = format!("{stem}.");
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if (name == stem || name.starts_with(&prefix)) && keep != Some(entry.path().as_path()) {
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn validate_logo_bytes(bytes: &[u8], ext: &str) -> Result<(), String> {
    if bytes.len() as u64 > MAX_LOGO_BYTES {
        return Err("Logo is too large (maximum 2 MB).".into());
    }
    if ext == "svg" {
        use quick_xml::events::Event;
        let mut reader = quick_xml::Reader::from_reader(bytes);
        let mut depth = 0usize;
        let mut root = false;
        loop {
            match reader
                .read_event()
                .map_err(|_| "Logo is not a valid SVG image.")?
            {
                Event::Start(node) if depth == 0 => {
                    if root || node.local_name().as_ref() != "svg" {
                        return Err("Logo must contain one SVG root element.".into());
                    }
                    root = true;
                    depth += 1;
                }
                Event::Empty(node) if depth == 0 => {
                    if root || node.local_name().as_ref() != "svg" {
                        return Err("Logo must contain one SVG root element.".into());
                    }
                    root = true;
                }
                Event::Start(_) => depth += 1,
                Event::End(_) => {
                    depth = depth.checked_sub(1).ok_or("Invalid SVG element nesting.")?
                }
                Event::DocType(_) => return Err("SVG document types are not supported.".into()),
                Event::Text(text)
                    if depth == 0 && !text.as_ref().chars().all(char::is_whitespace) =>
                {
                    return Err("Invalid SVG document text.".into())
                }
                Event::Eof => break,
                _ => {}
            }
        }
        return if root && depth == 0 {
            Ok(())
        } else {
            Err("Logo is not a complete SVG image.".into())
        };
    }
    let format = match ext {
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "gif" => image::ImageFormat::Gif,
        "webp" => image::ImageFormat::WebP,
        _ => return Err("Logo must be a PNG, JPG, GIF, WebP, or SVG image.".into()),
    };
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map(|_| ())
        .map_err(|_| "Logo could not be decoded as the selected image format.".into())
}

fn persist_logo_bytes(
    dir: &Path,
    project: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<String, String> {
    validate_logo_bytes(bytes, ext)?;
    let stem = logo_stem(project);
    let dest = dir.join(format!("{stem}.{ext}"));
    let temp = dir.join(format!(".{stem}-upload"));
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    // Install the validated replacement before retiring any previous asset.
    std::fs::rename(&temp, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    // The replacement is already committed. Cleanup failure must not report a
    // failed save and leave the caller pointing at a retired extension.
    if let Err(error) = remove_existing_logos_except(dir, project, Some(&dest)) {
        eprintln!("Could not remove retired project logo: {error}");
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn save_project_logo_sync(
    app: &AppHandle,
    project: &str,
    source_path: &str,
) -> Result<String, String> {
    let source = expand_home(source_path);
    let meta = std::fs::metadata(&source).map_err(|e| format!("{}: {e}", source.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_LOGO_BYTES {
        return Err(format!(
            "Logo is too large (maximum {} MB).",
            MAX_LOGO_BYTES / 1024 / 1024
        ));
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err("Logo must be a PNG, JPG, GIF, WebP, or SVG image.".into());
    }

    let mut bytes = Vec::new();
    std::fs::File::open(&source)
        .map_err(|e| e.to_string())?
        .take(MAX_LOGO_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let dir = project_logos_dir(app)?;
    persist_logo_bytes(&dir, project, &ext, &bytes)
}

fn remove_project_logo_sync(app: &AppHandle, project: &str) -> Result<(), String> {
    let dir = project_logos_dir(app)?;
    remove_existing_logos(&dir, project)
}

#[tauri::command]
pub async fn save_project_logo(
    app: AppHandle,
    project: String,
    source_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_project_logo_sync(&app, &project, &source_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drops a logo file the app itself copied in. Logos saved before the key scheme
/// changed live under a stem we can no longer derive, so the caller hands us the
/// path it had stored; anything outside the logo directory is ignored.
fn forget_logo_file_sync(app: &AppHandle, path: &str) -> Result<(), String> {
    let dir = project_logos_dir(app)?;
    let file = expand_home(path);
    if file.parent() != Some(dir.as_path()) || !file.is_file() {
        return Ok(());
    }
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn forget_logo_file(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || forget_logo_file_sync(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_project_logo(app: AppHandle, project: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_project_logo_sync(&app, &project))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_fake_truncated_and_mismatched_images() {
        for ext in ALLOWED_EXT {
            assert!(validate_logo_bytes(b"plain text", ext).is_err(), "{ext}");
        }
        assert!(validate_logo_bytes(b"\x89PNG\r\n\x1a\n", "png").is_err());
        let image = image::DynamicImage::new_rgba8(2, 2);
        for (ext, format) in [
            ("png", image::ImageFormat::Png),
            ("jpg", image::ImageFormat::Jpeg),
            ("gif", image::ImageFormat::Gif),
            ("webp", image::ImageFormat::WebP),
        ] {
            let mut encoded = Cursor::new(Vec::new());
            image.to_rgb8().write_to(&mut encoded, format).unwrap();
            assert!(validate_logo_bytes(encoded.get_ref(), ext).is_ok(), "{ext}");
            if ext != "png" {
                assert!(validate_logo_bytes(encoded.get_ref(), "png").is_err());
            }
        }
    }

    #[test]
    fn validates_svg_structure_and_limits() {
        assert!(validate_logo_bytes(
            br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>"#,
            "svg"
        )
        .is_ok());
        assert!(validate_logo_bytes(b"<svg/>", "svg").is_ok());
        for bytes in [
            b"<svg>".as_slice(),
            b"<html/>",
            b"<svg></path>",
            b"<svg/><svg/>",
        ] {
            assert!(validate_logo_bytes(bytes, "svg").is_err());
        }
        assert!(validate_logo_bytes(&vec![0; MAX_LOGO_BYTES as usize + 1], "png").is_err());
        let mut oversized = Cursor::new(Vec::new());
        image::RgbImage::new(8193, 1)
            .write_to(&mut oversized, image::ImageFormat::Png)
            .unwrap();
        assert!(validate_logo_bytes(oversized.get_ref(), "png").is_err());
    }

    #[test]
    fn invalid_replacement_preserves_previous_asset_and_valid_replacement_retires_it() {
        let dir = std::env::temp_dir().join(format!("bycoda-logo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join(format!("{}.png", logo_stem("project")));
        std::fs::write(&old, b"previous asset").unwrap();
        assert!(persist_logo_bytes(&dir, "project", "png", b"fake png").is_err());
        assert_eq!(std::fs::read(&old).unwrap(), b"previous asset");
        let blocked_upload = dir.join(format!(".{}-upload", logo_stem("project")));
        std::fs::create_dir(&blocked_upload).unwrap();
        assert!(persist_logo_bytes(&dir, "project", "svg", b"<svg/>").is_err());
        assert_eq!(std::fs::read(&old).unwrap(), b"previous asset");
        std::fs::remove_dir(blocked_upload).unwrap();
        let saved = persist_logo_bytes(&dir, "project", "svg", b"<svg/>").unwrap();
        assert!(!old.exists());
        assert_eq!(std::fs::read(saved).unwrap(), b"<svg/>");
        let replaced = persist_logo_bytes(&dir, "project", "svg", b"<svg><path/></svg>").unwrap();
        assert_eq!(std::fs::read(replaced).unwrap(), b"<svg><path/></svg>");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sanitize_project_key_replaces_unsafe_characters() {
        assert!(sanitize_project_key("agent-terminal").starts_with("agent-terminal-"));
        assert!(sanitize_project_key("foo/bar").starts_with("foo-bar-"));
        assert_eq!(sanitize_project_key("  "), "project");
    }

    #[test]
    fn sanitize_project_key_separates_paths_that_sanitize_alike() {
        // `-` survives and `/` becomes `-`, so only the hash tells these apart.
        assert_ne!(
            sanitize_project_key("/Users/me/cortex-finance/agentbase"),
            sanitize_project_key("/Users/me/cortex/finance/agentbase"),
        );
        // A sibling folder cannot be a filename prefix of its neighbour either.
        let stem = sanitize_project_key("/Users/me/proj");
        assert!(!sanitize_project_key("/Users/me/proj.old").starts_with(&format!("{stem}.")));
    }

    #[test]
    fn sanitize_project_key_shortens_long_paths_without_colliding() {
        let base = "/Users/me/".to_string() + &"deep/".repeat(40);
        let a = sanitize_project_key(&format!("{base}agentbase"));
        let b = sanitize_project_key(&format!("{base}other/agentbase"));
        assert!(a.chars().count() <= MAX_STEM_CHARS);
        assert!(b.chars().count() <= MAX_STEM_CHARS);
        assert_ne!(a, b);
        assert_eq!(a, sanitize_project_key(&format!("{base}agentbase")));
    }
}
