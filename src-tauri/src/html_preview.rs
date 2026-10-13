use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

struct Preview {
    content: String,
    root: Option<PathBuf>,
}

fn previews() -> &'static Mutex<HashMap<String, Preview>> {
    static PREVIEWS: OnceLock<Mutex<HashMap<String, Preview>>> = OnceLock::new();
    PREVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn create_html_preview(path: String, content: String) -> Result<String, String> {
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
    let token = uuid::Uuid::new_v4().to_string();
    let mut entries = previews().lock().map_err(|e| e.to_string())?;
    if entries.len() >= 64 {
        return Err("Too many open HTML previews.".into());
    }
    entries.insert(token.clone(), Preview { content, root });
    Ok(token)
}

#[tauri::command]
pub fn close_html_preview(token: String) {
    if let Ok(mut entries) = previews().lock() {
        entries.remove(&token);
    }
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
    let entry = entries.get(token).ok_or("Preview has closed")?;
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
        .header("Access-Control-Allow-Origin", "*")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
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

    #[test]
    fn preview_serves_scripts_and_assets_only_inside_its_folder() {
        let root = std::env::temp_dir().join(format!("bycoda-preview-{}", uuid::Uuid::new_v4()));
        let folder = root.join("preview");
        std::fs::create_dir_all(&folder).unwrap();
        let html = folder.join("page.html");
        std::fs::write(&html, "disk content").unwrap();
        std::fs::write(folder.join("mağaza #1.css"), "body { color: red }").unwrap();
        std::fs::write(root.join("secret.txt"), "secret").unwrap();
        let token = create_html_preview(
            html.to_string_lossy().into(),
            "<script>document.body.textContent='live'</script>".into(),
        )
        .unwrap();
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
        close_html_preview(token.clone());
        assert!(preview_content(&format!("/{token}/index.html")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remote_preview_uses_supplied_content_without_local_assets() {
        let token = create_html_preview(
            "remote://mac/repo/page.html".into(),
            "<h1>Remote</h1>".into(),
        )
        .unwrap();
        assert_eq!(
            preview_content(&format!("/{token}/index.html")).unwrap().0,
            b"<h1>Remote</h1>"
        );
        assert!(preview_content(&format!("/{token}/style.css")).is_err());
        close_html_preview(token);
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
