//! Finds a logo the project already ships (favicon, app icon) so the rail can
//! show it when the user has not picked a logo or a mascot. The match is copied
//! into the app's logo directory, which is the only place the webview may load
//! images from.

use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

use tauri::AppHandle;

use super::{logo_stem, project_logos_dir, validate_logo_bytes, MAX_LOGO_BYTES};
use crate::fs::expand_home;

/// Checked in order; the first readable, valid image wins.
const CANDIDATES: [&str; 22] = [
    "favicon.svg",
    "favicon.ico",
    "favicon.png",
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "app/favicon.ico",
    "app/favicon.png",
    "app/icon.svg",
    "app/icon.png",
    "app/icon.ico",
    "src/favicon.ico",
    "src/favicon.svg",
    "src/app/favicon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "assets/icon.svg",
    "assets/icon.png",
    "assets/logo.svg",
    "assets/logo.png",
    "static/favicon.svg",
    "static/favicon.png",
];

/// Files whose `<link rel="icon">` (or `{ rel: "icon", href }` route head) names the icon:
/// static HTML, Remix/TanStack roots and the default Astro layout.
const ICON_SOURCES: [&str; 8] = [
    "index.html",
    "public/index.html",
    "src/index.html",
    "app/root.tsx",
    "src/root.tsx",
    "app/routes/__root.tsx",
    "src/routes/__root.tsx",
    "src/layouts/Layout.astro",
];

const SOURCE_MAX_BYTES: u64 = 256 * 1024;
const DETECTED_EXT: [&str; 6] = ["svg", "png", "ico", "jpg", "jpeg", "webp"];

fn detected_stem(project: &str) -> String {
    format!("auto-{}", logo_stem(project))
}

fn read_limited(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}

fn image_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    DETECTED_EXT.contains(&ext.as_str()).then_some(ext)
}

/// Joins a project-relative path, refusing anything that escapes the root.
fn within_root(root: &Path, relative: &str) -> Option<PathBuf> {
    let relative = relative.trim_start_matches('/');
    if relative.is_empty() || relative.split(['/', '\\']).any(|part| part == "..") {
        return None;
    }
    let joined = root.join(relative);
    let resolved = joined.canonicalize().ok()?;
    resolved.starts_with(root).then_some(resolved)
}

fn attr_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(name) {
        let start = from + found;
        from = start + name.len();
        let boundary = start == 0 || !lower.as_bytes()[start - 1].is_ascii_alphanumeric();
        let rest = lower[from..].trim_start();
        if !boundary || !(rest.starts_with('=') || rest.starts_with(':')) {
            continue;
        }
        let value = rest[1..].trim_start();
        let Some(quote) = value.chars().next().filter(|ch| *ch == '"' || *ch == '\'') else {
            continue;
        };
        let offset = tag.len() - value.len() + 1;
        let end = tag[offset..].find(quote)?;
        return Some(&tag[offset..offset + end]);
    }
    None
}

fn is_icon_rel(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value == "icon" || value == "shortcut icon"
}

/// The first local icon `href` declared by an HTML `<link>` or a route `head()` object.
fn icon_href(source: &str) -> Option<String> {
    let lower = source.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find("<link") {
        let start = from + found;
        let end = lower[start..]
            .find('>')
            .map_or(source.len(), |end| start + end);
        let tag = &source[start..end];
        from = end;
        if attr_value(tag, "rel").is_some_and(is_icon_rel) {
            if let Some(href) = attr_value(tag, "href") {
                return Some(href.to_string());
            }
        }
    }
    source
        .split('}')
        .filter(|run| attr_value(run, "rel").is_some_and(is_icon_rel))
        .find_map(|run| attr_value(run, "href").map(str::to_string))
}

fn href_candidates(root: &Path, href: &str) -> Vec<PathBuf> {
    if href.contains("://") || href.starts_with("data:") || href.starts_with("//") {
        return Vec::new();
    }
    let clean = href.split(['?', '#']).next().unwrap_or_default();
    [
        format!("public/{}", clean.trim_start_matches('/')),
        clean.to_string(),
    ]
    .iter()
    .filter_map(|relative| within_root(root, relative))
    .collect()
}

/// Bytes and extension of the project's own logo, or `None` when it ships none.
fn find_project_logo(root: &Path) -> Option<(Vec<u8>, String)> {
    let valid = |path: &Path| {
        let ext = image_ext(path)?;
        let bytes = read_limited(path, MAX_LOGO_BYTES)?;
        validate_logo_bytes(&bytes, &ext).ok()?;
        Some((bytes, ext))
    };
    if let Some(found) = CANDIDATES
        .iter()
        .filter_map(|relative| within_root(root, relative))
        .find_map(|path| valid(&path))
    {
        return Some(found);
    }
    ICON_SOURCES.iter().find_map(|relative| {
        let source = read_limited(&within_root(root, relative)?, SOURCE_MAX_BYTES)?;
        let href = icon_href(&String::from_utf8_lossy(&source))?;
        href_candidates(root, &href)
            .iter()
            .find_map(|path| valid(path))
    })
}

fn remove_detected_except(dir: &Path, stem: &str, keep: Option<&Path>) {
    let prefix = format!("{stem}.");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if name.to_str().is_some_and(|name| name.starts_with(&prefix)) && keep != Some(&path) {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Copies the detected logo into `dir`, rewriting only when its bytes changed.
fn store_detected(dir: &Path, project: &str, root: &Path) -> Result<Option<String>, String> {
    let stem = detected_stem(project);
    let Some((bytes, ext)) = find_project_logo(root) else {
        remove_detected_except(dir, &stem, None);
        return Ok(None);
    };
    let dest = dir.join(format!("{stem}.{ext}"));
    if std::fs::read(&dest).ok().as_deref() != Some(bytes.as_slice()) {
        let temp = dir.join(format!(".{stem}-detect"));
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&temp, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    remove_detected_except(dir, &stem, Some(&dest));
    Ok(Some(dest.to_string_lossy().into_owned()))
}

fn detect_project_logo_sync(app: &AppHandle, project: &str) -> Result<Option<String>, String> {
    let Ok(root) = expand_home(project).canonicalize() else {
        return Ok(None);
    };
    if !root.is_dir() {
        return Ok(None);
    }
    store_detected(&project_logos_dir(app)?, project, &root)
}

/// The app-local copy of the logo the project ships, or `None` to keep the mascot.
#[tauri::command]
pub async fn detect_project_logo(
    app: AppHandle,
    project: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || detect_project_logo_sync(&app, &project))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bycoda-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn reads_icon_href_from_html_and_route_heads() {
        assert_eq!(
            icon_href(r#"<head><LINK href="/brand/mark.svg?v=2" rel="icon"></head>"#).as_deref(),
            Some("/brand/mark.svg?v=2")
        );
        assert_eq!(
            icon_href(
                r#"<link rel="stylesheet" href="a.css"><link rel='shortcut icon' href='f.png'>"#
            )
            .as_deref(),
            Some("f.png")
        );
        assert_eq!(
            icon_href(
                r#"links: [{ rel: "stylesheet", href: css }, { rel: "icon", href: "/logo.png" }]"#
            )
            .as_deref(),
            Some("/logo.png")
        );
        assert_eq!(
            icon_href(r#"<link rel="apple-touch-icon" href="a.png">"#),
            None
        );
    }

    #[test]
    fn prefers_well_known_files_and_rejects_invalid_or_escaping_ones() {
        let root = temp_dir("logo-root");
        std::fs::create_dir_all(root.join("public")).unwrap();
        // An invalid favicon is skipped, not shown broken.
        std::fs::write(root.join("favicon.svg"), b"not an svg").unwrap();
        std::fs::write(root.join("public/favicon.svg"), b"<svg/>").unwrap();
        let (bytes, ext) = find_project_logo(&root).unwrap();
        assert_eq!(
            (bytes.as_slice(), ext.as_str()),
            (b"<svg/>".as_slice(), "svg")
        );

        let html_root = temp_dir("logo-html");
        std::fs::create_dir_all(html_root.join("public/brand")).unwrap();
        std::fs::write(html_root.join("public/brand/mark.svg"), b"<svg></svg>").unwrap();
        std::fs::write(
            html_root.join("index.html"),
            r#"<link rel="icon" href="/brand/mark.svg">"#,
        )
        .unwrap();
        assert_eq!(find_project_logo(&html_root).unwrap().1, "svg");

        std::fs::write(
            html_root.join("index.html"),
            r#"<link rel="icon" href="../../x.svg">"#,
        )
        .unwrap();
        assert!(find_project_logo(&html_root).is_none());
        assert!(within_root(&html_root, "public/../../outside.svg").is_none());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(html_root).unwrap();
    }

    #[test]
    fn stores_a_copy_and_drops_it_when_the_project_loses_its_logo() {
        let root = temp_dir("logo-project");
        let dir = temp_dir("logo-store");
        assert_eq!(store_detected(&dir, "p", &root).unwrap(), None);
        std::fs::write(root.join("favicon.svg"), b"<svg/>").unwrap();
        let saved = store_detected(&dir, "p", &root).unwrap().unwrap();
        assert_eq!(std::fs::read(&saved).unwrap(), b"<svg/>");
        // The user's own logo shares the directory under a different stem.
        assert!(!Path::new(&saved)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(&format!("{}.", logo_stem("p"))));
        std::fs::remove_file(root.join("favicon.svg")).unwrap();
        assert_eq!(store_detected(&dir, "p", &root).unwrap(), None);
        assert!(!Path::new(&saved).exists());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
