use crate::control::receipts::WindowIssuer;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

struct Preview {
    content: String,
    root: Option<PathBuf>,
}

enum PreviewState {
    Pending,
    Cancelled,
    Failed,
    Ready(Preview),
}
struct PreviewRecord {
    owner: Arc<WindowIssuer>,
    state: PreviewState,
}
#[derive(Default)]
struct PreviewRegistry {
    entries: HashMap<String, PreviewRecord>,
    sealed: bool,
    expired: PreviewFence,
}

const FENCE_BYTES: usize = 1024 * 1024;
struct PreviewFence {
    bits: Vec<u8>,
    set_bits: usize,
}
impl Default for PreviewFence {
    fn default() -> Self {
        Self {
            bits: vec![0; FENCE_BYTES],
            set_bits: 0,
        }
    }
}
impl PreviewFence {
    fn indexes(key: &str) -> [usize; 4] {
        let digest = Sha256::digest(key.as_bytes());
        std::array::from_fn(|i| {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&digest[i * 8..i * 8 + 8]);
            (u64::from_le_bytes(bytes) % (FENCE_BYTES as u64 * 8)) as usize
        })
    }
    fn contains(&self, key: &str) -> bool {
        Self::indexes(key)
            .into_iter()
            .all(|i| self.bits[i / 8] & (1 << (i % 8)) != 0)
    }
    fn insert(&mut self, key: &str) {
        for i in Self::indexes(key) {
            let bit = 1 << (i % 8);
            if self.bits[i / 8] & bit == 0 {
                self.bits[i / 8] |= bit;
                self.set_bits += 1;
            }
        }
    }
    fn saturated(&self) -> bool {
        self.set_bits >= FENCE_BYTES * 8 / 4
    }
}

impl PreviewRegistry {
    fn reap(&mut self) {
        let expired = &mut self.expired;
        self.entries.retain(|token, entry| {
            if entry.owner.is_retired() {
                expired.insert(token);
                false
            } else {
                true
            }
        });
    }
    fn begin(&mut self, owner: &Arc<WindowIssuer>, token: &str) -> Result<(), String> {
        self.reap();
        if let Some(entry) = self.entries.get(token) {
            if !Arc::ptr_eq(&entry.owner, owner) {
                return Err("Preview belongs to another page.".into());
            }
            if matches!(entry.state, PreviewState::Cancelled) {
                self.expired.insert(token);
                self.entries.remove(token);
                return Err("Preview was closed before creation.".into());
            }
            return Err("Preview token was already used.".into());
        }
        if self.sealed || self.expired.saturated() {
            return Err("HTML preview admission is unavailable until restart.".into());
        }
        if self.expired.contains(token) {
            return Err("Preview token was already used.".into());
        }
        if self.entries.len() >= 64 {
            return Err("Too many open HTML previews.".into());
        }
        self.entries.insert(
            token.into(),
            PreviewRecord {
                owner: owner.clone(),
                state: PreviewState::Pending,
            },
        );
        Ok(())
    }
    fn finish(
        &mut self,
        owner: &Arc<WindowIssuer>,
        token: &str,
        result: Result<Preview, String>,
    ) -> Result<String, String> {
        let entry = self
            .entries
            .get_mut(token)
            .ok_or("Preview creation is unavailable.")?;
        if !Arc::ptr_eq(&entry.owner, owner) {
            return Err("Preview belongs to another page.".into());
        }
        if matches!(entry.state, PreviewState::Cancelled) {
            self.expired.insert(token);
            self.entries.remove(token);
            return Err("Preview was closed before creation.".into());
        }
        if !matches!(entry.state, PreviewState::Pending) {
            return Err("Preview creation is unavailable.".into());
        }
        match result {
            Ok(preview) => {
                entry.state = PreviewState::Ready(preview);
                Ok(token.into())
            }
            Err(error) => {
                entry.state = PreviewState::Failed;
                Err(error)
            }
        }
    }
    fn close(&mut self, owner: &Arc<WindowIssuer>, token: &str) -> Result<(), String> {
        self.reap();
        if let Some(entry) = self.entries.get_mut(token) {
            if !Arc::ptr_eq(&entry.owner, owner) {
                return Err("Preview belongs to another page.".into());
            }
            if matches!(entry.state, PreviewState::Pending | PreviewState::Cancelled) {
                entry.state = PreviewState::Cancelled;
            } else {
                self.expired.insert(token);
                self.entries.remove(token);
            }
        } else {
            if self.expired.contains(token) {
                return Ok(());
            }
            if self.entries.len() >= 4096 {
                self.sealed = true;
                return Err("HTML preview admission is unavailable until restart.".into());
            }
            self.entries.insert(
                token.into(),
                PreviewRecord {
                    owner: owner.clone(),
                    state: PreviewState::Cancelled,
                },
            );
        }
        Ok(())
    }
}

fn previews() -> &'static Mutex<PreviewRegistry> {
    static PREVIEWS: OnceLock<Mutex<PreviewRegistry>> = OnceLock::new();
    PREVIEWS.get_or_init(|| Mutex::new(PreviewRegistry::default()))
}

#[tauri::command(async)]
pub fn create_html_preview(
    window: tauri::WebviewWindow,
    token: String,
    path: String,
    content: String,
) -> Result<String, String> {
    validate_token(&token)?;
    let owner = crate::control::receipts::capture(&window)?;
    owner.with_live(|| {
        previews()
            .lock()
            .map_err(|e| e.to_string())?
            .begin(&owner, &token)
    })?;
    let result = make_preview(path, content);
    owner.with_live(|| {
        previews()
            .lock()
            .map_err(|e| e.to_string())?
            .finish(&owner, &token, result)
    })
}

fn make_preview(path: String, content: String) -> Result<Preview, String> {
    if content.len() > 16 * 1024 * 1024 {
        return Err("HTML preview is limited to 16 MiB.".into());
    }
    let root = if path.starts_with("remote://") {
        None // Remote HTML is already read by the owning host; never read its assets locally.
    } else {
        html_file_url(Path::new(&path))?;
        Some(
            Path::new(&path)
                .canonicalize()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("HTML file has no containing folder")?
                .to_path_buf(),
        )
    };
    Ok(Preview { content, root })
}

#[tauri::command]
pub fn close_html_preview(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    validate_token(&token)?;
    let owner = crate::control::receipts::capture(&window)?;
    owner.with_live(|| {
        previews()
            .lock()
            .map_err(|e| e.to_string())?
            .close(&owner, &token)
    })
}

fn validate_token(token: &str) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(token).map_err(|_| "Invalid preview token.")?;
    if id.to_string() != token || id.get_version_num() != 4 {
        return Err("Invalid preview token.".into());
    }
    Ok(())
}

fn preview_asset(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let base = url::Url::from_directory_path(root).map_err(|_| "Invalid preview folder")?;
    let candidate = base
        .join(relative)
        .map_err(|e| e.to_string())?
        .to_file_path()
        .map_err(|_| "Invalid asset path")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !candidate.starts_with(root) || !candidate.is_file() {
        return Err("Asset is outside the preview folder".into());
    }
    // Never serve hidden files or folders (.env, .git, .ssh, ...) to the page.
    let hidden = candidate.strip_prefix(root).is_ok_and(|rel| {
        rel.components()
            .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
    });
    if hidden {
        return Err("Hidden files are not served by HTML previews".into());
    }
    if candidate.metadata().map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Preview asset is too large".into());
    }
    Ok(candidate)
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn preview_content(path: &str) -> Result<(Vec<u8>, &'static str), String> {
    let (token, relative) = path
        .trim_start_matches('/')
        .split_once('/')
        .ok_or("Invalid preview URL")?;
    let entries = previews().lock().map_err(|e| e.to_string())?;
    let record = entries.entries.get(token).ok_or("Preview has closed")?;
    if !record.owner.is_live() {
        return Err("Preview has closed".into());
    }
    let PreviewState::Ready(entry) = &record.state else {
        return Err("Preview has closed".into());
    };
    if relative == "index.html" {
        return Ok((
            entry.content.as_bytes().to_vec(),
            "text/html; charset=utf-8",
        ));
    }
    let root = entry
        .root
        .as_ref()
        .ok_or("Relative assets are unavailable for remote previews")?;
    let asset = preview_asset(root, relative)?;
    Ok((
        std::fs::read(&asset).map_err(|e| e.to_string())?,
        mime(&asset),
    ))
}

pub fn respond(request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let result = if request.method() == tauri::http::Method::GET {
        preview_content(request.uri().path())
    } else {
        Err("Unsupported preview request".into())
    };
    let (status, body, content_type) = match result {
        Ok((body, content_type)) => (200, body, content_type),
        Err(error) => (404, error.into_bytes(), "text/plain; charset=utf-8"),
    };
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
        .body(body)
        .expect("static preview response headers")
}

fn html_file_url(path: &Path) -> Result<String, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("Could not open HTML file: {error}"))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !path.is_file()
        || !(extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm"))
    {
        return Err("Go Live requires an existing HTML file.".into());
    }
    url::Url::from_file_path(&path)
        .map(|url| url.to_string())
        .map_err(|_| "Could not create the HTML file URL.".into())
}

fn chrome_command() -> Command {
    #[cfg(windows)]
    {
        for variable in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
            if let Some(base) = std::env::var_os(variable) {
                let executable = PathBuf::from(base).join("Google/Chrome/Application/chrome.exe");
                if executable.is_file() {
                    return Command::new(executable);
                }
            }
        }
        Command::new("chrome.exe")
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/open");
        command.args(["-a", "Google Chrome"]);
        command
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Command::new("google-chrome")
    }
}

fn launch_html(path: &Path) -> Result<(), String> {
    let url = html_file_url(path)?;
    let mut command = chrome_command();
    #[cfg(not(target_os = "macos"))]
    command.arg("--new-tab");
    command.arg(url);
    crate::harness::apply_gui_env(&mut command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: no console helper.
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!("Could not open Google Chrome. Check that Chrome is installed: {error}")
        })?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[tauri::command(async)]
pub async fn open_html_in_chrome(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || launch_html(&PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_create(path: String, content: String) -> (Arc<WindowIssuer>, String) {
        let owner = Arc::new(WindowIssuer::default());
        let token = uuid::Uuid::new_v4().to_string();
        let mut entries = previews().lock().unwrap();
        entries.begin(&owner, &token).unwrap();
        entries
            .finish(&owner, &token, make_preview(path, content))
            .unwrap();
        (owner, token)
    }

    #[test]
    fn retired_pages_reclaim_lost_replies_and_preserve_live_other_pages() {
        let mut registry = PreviewRegistry::default();
        let live = Arc::new(WindowIssuer::default());
        let active = uuid::Uuid::new_v4().to_string();
        registry.begin(&live, &active).unwrap();
        registry
            .finish(
                &live,
                &active,
                make_preview("remote://host/x".into(), "live".into()),
            )
            .unwrap();
        for _ in 0..100 {
            let old = Arc::new(WindowIssuer::default());
            let id = uuid::Uuid::new_v4().to_string();
            registry.begin(&old, &id).unwrap();
            registry
                .finish(
                    &old,
                    &id,
                    make_preview("remote://host/x".into(), "lost".into()),
                )
                .unwrap();
            tauri::Resource::close(old);
        }
        registry.reap();
        assert_eq!(registry.entries.len(), 1);
        assert!(matches!(
            registry.entries.get(&active).unwrap().state,
            PreviewState::Ready(_)
        ));
    }

    #[test]
    fn early_close_fences_late_creation_and_other_pages_cannot_close() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let foreign = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        registry.close(&owner, &id).unwrap();
        assert!(registry.close(&foreign, &id).is_err());
        assert!(registry.begin(&owner, &id).is_err());
        registry.close(&owner, &id).unwrap();
        assert!(registry.begin(&owner, &id).is_err());
    }

    #[test]
    fn close_during_creation_rejects_late_result_without_reopening() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let foreign = Arc::new(WindowIssuer::default());
        let token = uuid::Uuid::new_v4().to_string();
        registry.begin(&owner, &token).unwrap();
        registry.close(&owner, &token).unwrap();
        registry.close(&owner, &token).unwrap();
        assert!(matches!(
            registry.entries[&token].state,
            PreviewState::Cancelled
        ));
        assert!(registry
            .finish(
                &foreign,
                &token,
                make_preview("remote://host/x".into(), "late".into())
            )
            .is_err());
        assert!(registry
            .finish(
                &owner,
                &token,
                make_preview("remote://host/x".into(), "late".into())
            )
            .is_err());
        assert!(!registry.entries.contains_key(&token));
        assert!(registry.expired.contains(&token));
        assert!(registry.begin(&owner, &token).is_err());
    }

    #[test]
    fn pending_unknown_capacity_refuses_without_eviction() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let ids: Vec<_> = (0..64).map(|_| uuid::Uuid::new_v4().to_string()).collect();
        for id in &ids {
            registry.begin(&owner, id).unwrap();
        }
        assert!(registry
            .begin(&owner, &uuid::Uuid::new_v4().to_string())
            .is_err());
        assert!(ids.iter().all(|id| registry.entries.contains_key(id)));
        let delayed = uuid::Uuid::new_v4().to_string();
        registry.close(&owner, &delayed).unwrap();
        assert!(registry.begin(&owner, &delayed).is_err());
    }

    #[test]
    fn saturated_fence_refuses_admission_without_dropping_pending() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let pending = uuid::Uuid::new_v4().to_string();
        registry.begin(&owner, &pending).unwrap();
        registry.expired.set_bits = FENCE_BYTES * 8 / 4;
        assert!(registry
            .begin(&owner, &uuid::Uuid::new_v4().to_string())
            .is_err());
        assert!(registry.entries.contains_key(&pending));
    }

    #[test]
    fn exact_live_owner_precedes_fence_false_positive() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let foreign = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        registry.begin(&owner, &id).unwrap();
        registry
            .finish(
                &owner,
                &id,
                make_preview("remote://host/x".into(), "live".into()),
            )
            .unwrap();
        registry.expired.insert(&id);
        assert!(registry.close(&foreign, &id).is_err());
        registry.close(&owner, &id).unwrap();
        assert!(!registry.entries.contains_key(&id));
        assert!(registry.begin(&owner, &id).is_err());
    }

    #[test]
    fn completed_previews_release_live_capacity_for_same_owner() {
        let mut registry = PreviewRegistry::default();
        let owner = Arc::new(WindowIssuer::default());
        let mut first = String::new();
        for i in 0..5000 {
            let id = uuid::Uuid::new_v4().to_string();
            if i == 0 {
                first = id.clone();
            }
            registry.begin(&owner, &id).unwrap();
            registry
                .finish(
                    &owner,
                    &id,
                    make_preview("remote://host/x".into(), "content".into()),
                )
                .unwrap();
            registry.close(&owner, &id).unwrap();
            registry.close(&owner, &id).unwrap();
        }
        assert!(registry.entries.is_empty());
        assert!(registry.begin(&owner, &first).is_err());
    }

    #[test]
    fn preview_serves_scripts_and_assets_only_inside_its_folder() {
        let root = std::env::temp_dir().join(format!("bycoda-preview-{}", uuid::Uuid::new_v4()));
        let folder = root.join("preview");
        std::fs::create_dir_all(&folder).unwrap();
        let html = folder.join("page.html");
        std::fs::write(&html, "disk content").unwrap();
        std::fs::write(folder.join("mağaza #1.css"), "body { color: red }").unwrap();
        std::fs::write(root.join("secret.txt"), "secret").unwrap();
        let (owner, token) = test_create(
            html.to_string_lossy().into(),
            "<script>document.body.textContent='live'</script>".into(),
        );
        let response = respond(
            tauri::http::Request::builder()
                .uri(format!("html-preview://localhost/{token}/index.html"))
                .body(vec![])
                .unwrap(),
        );
        assert_eq!(response.status(), 200);
        assert!(String::from_utf8(response.into_body())
            .unwrap()
            .contains("<script>"));
        let (_, mime) = preview_content(&format!("/{token}/ma%C4%9Faza%20%231.css")).unwrap();
        assert_eq!(mime, "text/css; charset=utf-8");
        assert!(preview_content(&format!("/{token}/../secret.txt")).is_err());
        assert!(preview_content(&format!("/{token}/%2e%2e/secret.txt")).is_err());
        assert!(preview_content(&format!("/{token}/file:///secret.txt")).is_err());
        previews().lock().unwrap().close(&owner, &token).unwrap();
        assert!(preview_content(&format!("/{token}/index.html")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_rejects_hidden_files_and_folders() {
        let root = std::env::temp_dir().join(format!("bycoda-hidden-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join(".env"), "TOKEN=1").unwrap();
        std::fs::write(root.join(".git/config"), "[core]").unwrap();
        std::fs::write(root.join("assets/.secret"), "x").unwrap();
        std::fs::write(root.join("assets/app.js"), "1").unwrap();
        let root = root.canonicalize().unwrap();
        assert!(preview_asset(&root, ".env").is_err());
        assert!(preview_asset(&root, ".git/config").is_err());
        assert!(preview_asset(&root, "assets/.secret").is_err());
        assert!(preview_asset(&root, "assets/../.env").is_err());
        assert!(preview_asset(&root, "assets/app.js").is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remote_preview_uses_supplied_content_without_local_assets() {
        let (owner, token) = test_create(
            "remote://mac/repo/page.html".into(),
            "<h1>Remote</h1>".into(),
        );
        assert_eq!(
            preview_content(&format!("/{token}/index.html")).unwrap().0,
            b"<h1>Remote</h1>"
        );
        assert!(preview_content(&format!("/{token}/style.css")).is_err());
        previews().lock().unwrap().close(&owner, &token).unwrap();
    }

    #[test]
    fn html_urls_preserve_special_characters_and_reject_other_files() {
        let root = std::env::temp_dir().join(format!("bycoda-html-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let html = root.join("mağaza #1 %.HTML");
        std::fs::write(&html, "<html></html>").unwrap();
        let url = html_file_url(&html).unwrap();
        assert!(url.starts_with("file:///"));
        assert!(url.contains("%23"));
        assert!(url.contains("%25"));
        assert_eq!(
            url::Url::parse(&url)
                .unwrap()
                .to_file_path()
                .unwrap()
                .canonicalize()
                .unwrap(),
            html.canonicalize().unwrap()
        );
        let htm = root.join("page.htm");
        std::fs::write(&htm, "hello").unwrap();
        assert!(html_file_url(&htm).is_ok());
        let other = root.join("script.js");
        std::fs::write(&other, "hello").unwrap();
        assert!(html_file_url(&other).is_err());
        assert!(html_file_url(&root).is_err());
        assert!(html_file_url(&root.join("missing.html")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
