//! Explicit isolated packaged-byte acceptance. Normal launches do not enter this mode.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{Manager, WebviewWindow};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u32,
    nonce: String,
    root: PathBuf,
    home: PathBuf,
    desktop_data_dir: PathBuf,
    seed_db: PathBuf,
    seed_sha256: String,
    proof_path: PathBuf,
    source_sha: String,
    source_fingerprint: String,
    build_id: String,
    artifact_digest: String,
    version: String,
    session_id: String,
    title: String,
    history: String,
}
static MODE: OnceLock<Option<Request>> = OnceLock::new();
fn hex(value: &str, size: usize) -> bool {
    value.len() == size && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn identifier(request: &Request) -> String {
    format!("com.bycoda.desktop.smoke.{}", &request.nonce[..20])
}
fn canonical(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path).map_err(|e| e.to_string())
}
fn same_path(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .to_lowercase()
            == right
                .to_string_lossy()
                .trim_start_matches("\\\\?\\")
                .to_lowercase()
    } else {
        left == right
    }
}
fn beneath(root: &Path, path: &Path) -> Result<(), String> {
    if path != root && path.starts_with(root) {
        Ok(())
    } else {
        Err("Smoke path escaped its owned root".into())
    }
}
fn fresh_profile(root: &Path, profile: &Path, nonce: &str) -> Result<(), String> {
    if !hex(nonce, 64)
        || profile.file_name().and_then(|s| s.to_str())
            != Some(format!("com.bycoda.desktop.smoke.{}", &nonce[..20]).as_str())
        || profile.exists()
        || !same_path(
            &canonical(profile.parent().ok_or("Invalid desktop path")?)?,
            root,
        )
    {
        return Err(
            "Smoke desktop profile must be fresh and directly inside its owned root".into(),
        );
    }
    Ok(())
}
fn verify_owner(root: &Path, nonce: &str) -> Result<(), String> {
    let marker = std::fs::read_to_string(root.join("owner.json")).map_err(|e| e.to_string())?;
    let owner: Value = serde_json::from_str(&marker).map_err(|e| e.to_string())?;
    if owner != json!({"kind":"bycoda-package-smoke-owned-v1", "nonce":nonce}) {
        return Err("Smoke ownership marker mismatch".into());
    }
    Ok(())
}
fn verified_request() -> Result<Request, String> {
    let filename =
        std::env::var_os("BYCODA_PACKAGE_SMOKE_REQUEST").ok_or("Smoke request missing")?;
    let filename = canonical(Path::new(&filename))?;
    let bytes = std::fs::read(&filename).map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("Smoke request is too large".into());
    }
    let request: Request = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if request.schema_version != 1
        || !hex(&request.nonce, 64)
        || !hex(&request.source_sha, 40)
        || !hex(&request.source_fingerprint, 64)
        || !hex(&request.artifact_digest, 64)
        || !hex(&request.seed_sha256, 64)
    {
        return Err("Invalid smoke identity".into());
    }
    if std::env::var("BYCODA_PACKAGE_SMOKE_NONCE").ok().as_deref() != Some(request.nonce.as_str()) {
        return Err("Smoke nonce mismatch".into());
    }
    let root = canonical(&request.root)?;
    if !same_path(&root, &request.root)
        || root.file_name().and_then(|s| s.to_str())
            != Some(format!("package-smoke-{}", &request.nonce[..20]).as_str())
    {
        return Err("Smoke root must be a fresh named owned directory".into());
    }
    beneath(&root, &filename)?;
    for path in [&request.home, &request.seed_db] {
        beneath(&root, &canonical(path)?)?;
    }
    let proof_parent = canonical(request.proof_path.parent().ok_or("Invalid proof path")?)?;
    beneath(
        &root,
        &proof_parent.join(request.proof_path.file_name().ok_or("Invalid proof path")?),
    )?;
    if request.proof_path.exists() {
        return Err("Smoke proof already exists".into());
    }
    verify_owner(&root, &request.nonce)?;
    for variable in ["HOME", "USERPROFILE"] {
        let value = std::env::var_os(variable).ok_or("Smoke home is not isolated")?;
        if !same_path(&canonical(Path::new(&value))?, &canonical(&request.home)?) {
            return Err("Smoke home is not isolated".into());
        }
    }
    fresh_profile(&root, &request.desktop_data_dir, &request.nonce)?;
    let seed = std::fs::read(&request.seed_db).map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(seed)) != request.seed_sha256 {
        return Err("Smoke seed hash mismatch".into());
    }
    let identity =
        crate::build_info::build_identity().ok_or("Packaged native source stamp is unavailable")?;
    if identity["head"] != request.source_sha
        || identity["sourceFingerprint"] != request.source_fingerprint
        || identity["buildId"] != request.build_id
        || identity["version"] != request.version
    {
        return Err("Packaged native source stamp mismatch".into());
    }
    Ok(request)
}
pub fn active() -> bool {
    MODE.get().is_some_and(|request| request.is_some())
}

/// Call before Tauri creates any windows or stores. Explicit invalid mode fails closed.
pub fn context(
    mut context: tauri::Context<tauri::Wry>,
) -> Result<tauri::Context<tauri::Wry>, String> {
    if !std::env::args_os().any(|argument| argument == "--package-smoke") {
        if std::env::var_os("BYCODA_PACKAGE_SMOKE_REQUEST").is_some() {
            return Err("Smoke request requires explicit --package-smoke".into());
        }
        let _ = MODE.set(None);
        return Ok(context);
    }
    let request = verified_request()?;
    std::fs::create_dir(&request.desktop_data_dir).map_err(|e| e.to_string())?;
    std::fs::write(
        request.desktop_data_dir.join("package-smoke-owner"),
        &request.nonce,
    )
    .map_err(|e| e.to_string())?;
    let config = context.config_mut();
    config.identifier = identifier(&request);
    config.app.app_directories_override = Some(tauri::utils::config::AppDirectoriesOverride::Root(
        request.desktop_data_dir.clone(),
    ));
    for window in &mut config.app.windows {
        window.data_directory = Some(request.root.join("webview"));
        window.title = "bycoda · isolated package smoke".into();
    }
    MODE.set(Some(request))
        .map_err(|_| "Smoke mode was initialized twice")?;
    Ok(context)
}

/// Runs before the normal production SessionStore initialization/migrations.
pub fn prepare(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(Some(request)) = MODE.get() else {
        return Ok(());
    };
    let actual = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !same_path(&canonical(&actual)?, &canonical(&request.desktop_data_dir)?) {
        return Err("Native data directory differs from the owned smoke profile".into());
    }
    let marker =
        std::fs::read_to_string(actual.join("package-smoke-owner")).map_err(|e| e.to_string())?;
    if marker != request.nonce || actual.join("bycoda.db").exists() {
        return Err("Smoke profile ownership changed or DB already exists".into());
    }
    std::fs::copy(&request.seed_db, actual.join("bycoda.db")).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    if active()
        && app
            .try_state::<crate::session_store::SessionStore>()
            .is_none()
    {
        return Err("Smoke requires the normal migrated native session store".into());
    }
    Ok(())
}

/// Installed Tauri 2.12 Builder::on_page_load callback: injection is event-driven.
pub fn on_page_load(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    let Some(Some(request)) = MODE.get() else {
        return;
    };
    if webview.label() != "main"
        || !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
    {
        return;
    }
    let values = json!({"nonce":request.nonce,"sessionId":request.session_id,"title":request.title,"history":request.history});
    let script = format!(
        "window.__BYCODA_PACKAGE_SMOKE_REQUEST__ = {values};\n{}",
        include_str!("package_smoke_dom.js")
    );
    let _ = webview.eval(&script);
}

/// This callback has no authority outside an explicit valid isolated smoke run.
#[tauri::command]
pub fn package_smoke_dom_proof(
    app: tauri::AppHandle,
    window: WebviewWindow,
    nonce: String,
    session_read: bool,
    title_visible: bool,
    history_visible: bool,
) -> Result<(), String> {
    let Some(Some(request)) = MODE.get() else {
        return Err("Packaged smoke mode is inactive".into());
    };
    if window.label() != "main"
        || nonce != request.nonce
        || !session_read
        || !title_visible
        || !history_visible
    {
        return Err("Native smoke DOM proof failed".into());
    }
    let store = app.state::<crate::session_store::SessionStore>();
    let connection = store.lock_conn()?;
    let (title, blocks): (String, String) = connection
        .query_row(
            "SELECT title, blocks_json FROM sessions WHERE id=?1",
            [&request.session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let version: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&blocks).map_err(|e| e.to_string())?;
    if version <= 1
        || title != request.title
        || !parsed
            .as_array()
            .is_some_and(|blocks| blocks.iter().any(|block| block["text"] == request.history))
    {
        return Err("Migrated native session differs from the old DB seed".into());
    }
    let proof = json!({"schemaVersion":1,"evidence":"native-webview-proof","nonce":nonce,"pid":std::process::id(),"sourceSha":request.source_sha,"artifactDigest":request.artifact_digest,"buildIdentity":crate::build_info::build_identity(),"desktopDataDir":request.desktop_data_dir,"migrationVersion":version,"sessionId":request.session_id,"sessionRead":session_read,"titleVisible":title_visible,"historyVisible":history_visible});
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&request.proof_path)
        .map_err(|e| e.to_string())?;
    file.write_all(
        serde_json::to_string(&proof)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_and_marker_guards_reject_other_parent_existing_data_and_foreign_nonce() {
        let base = std::env::temp_dir().join(format!(
            "bycoda-package-smoke-guards-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&base).unwrap();
        let root = canonical(&base).unwrap();
        let nonce = "a".repeat(64);
        let profile = root.join(format!("com.bycoda.desktop.smoke.{}", &nonce[..20]));
        assert!(fresh_profile(&root, &profile, &nonce).is_ok());
        assert!(fresh_profile(&root, &profile, "bad").is_err());
        let other = root.join("other");
        std::fs::create_dir(&other).unwrap();
        assert!(fresh_profile(&root, &other.join(profile.file_name().unwrap()), &nonce).is_err());
        assert!(fresh_profile(&root, &root.join("../escape"), &nonce).is_err());
        std::fs::create_dir(&profile).unwrap();
        assert!(fresh_profile(&root, &profile, &nonce).is_err());
        assert!(verify_owner(&root, &nonce).is_err());
        std::fs::write(
            root.join("owner.json"),
            json!({"kind":"bycoda-package-smoke-owned-v1", "nonce":nonce}).to_string(),
        )
        .unwrap();
        assert!(verify_owner(&root, &nonce).is_ok());
        assert!(verify_owner(&root, &"b".repeat(64)).is_err());
        assert!(root.starts_with(canonical(&std::env::temp_dir()).unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn profile_cannot_escape_through_a_symlink_parent() {
        let base = std::env::temp_dir().join(format!(
            "bycoda-package-smoke-link-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&base).unwrap();
        let root = canonical(&base).unwrap();
        let outside = root.join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("alias")).unwrap();
        let nonce = "a".repeat(64);
        assert!(fresh_profile(
            &root,
            &root
                .join("alias")
                .join(format!("com.bycoda.desktop.smoke.{}", &nonce[..20])),
            &nonce
        )
        .is_err());
        assert!(root.starts_with(canonical(&std::env::temp_dir()).unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
