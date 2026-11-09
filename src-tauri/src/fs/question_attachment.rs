use super::*;

// A crashed holder leaves its lock in place: an uncertain operation must be
// inspected, not silently replayed or collected by a new process.
struct QuestionAttachmentLock(PathBuf);
fn check_caller(window: &tauri::Window, webview: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != webview.label() {
        return Err("Question attachment page changed".into());
    }
    Ok(())
}
fn definitely_absent(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error.to_string()),
    }
}
impl QuestionAttachmentLock {
    fn acquire(dir: &Path) -> Result<Self, String> {
        let parent = dir
            .parent()
            .ok_or("Invalid question attachment directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let lock = dir.with_extension("lock");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&lock)
            .map_err(|_| "Question attachment operation is busy or needs recovery".to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        Ok(Self(lock))
    }
}
impl Drop for QuestionAttachmentLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod lock_tests {
    use super::{
        add_claim, directory_identity, release_confirmed, verify_claim, QuestionAttachmentLock,
    };

    #[test]
    fn operation_lock_is_exclusive_and_stale_lock_is_not_retired() {
        let base = std::env::temp_dir().join(format!("question-lock-{}", uuid::Uuid::new_v4()));
        let dir = base.join("operation");
        let lock = QuestionAttachmentLock::acquire(&dir).unwrap();
        assert!(QuestionAttachmentLock::acquire(&dir).is_err());
        drop(lock);
        let lock = QuestionAttachmentLock::acquire(&dir).unwrap();
        std::mem::forget(lock);
        assert!(QuestionAttachmentLock::acquire(&dir).is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn claims_are_exact_and_retryable() {
        let base = std::env::temp_dir().join(format!("question-claim-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let first = uuid::Uuid::new_v4().to_string();
        let second = uuid::Uuid::new_v4().to_string();
        add_claim(&base, &first, "page-a", "session-a").unwrap();
        assert!(add_claim(&base, &first, "page-b", "session-a").is_err());
        assert!(add_claim(&base, &first, "page-a", "session-b").is_err());
        add_claim(&base, &first, "page-a", "session-a").unwrap();
        add_claim(&base, &second, "page-a", "session-a").unwrap();
        assert!(verify_claim(&base, &first, "page-a", "session-a").is_ok());
        assert!(verify_claim(&base, &first, "page-b", "session-a").is_err());
        assert!(verify_claim(&base, &first, "page-a", "session-b").is_err());
        assert_eq!(std::fs::read_dir(base.join("claims")).unwrap().count(), 2);
        std::fs::write(base.join("claims").join(&first), b"corrupt").unwrap();
        assert!(add_claim(&base, &first, "page-a", "session-a").is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn release_receipts_are_bound_to_original_page_and_session() {
        let base = std::env::temp_dir().join(format!("question-release-{}", uuid::Uuid::new_v4()));
        let claim = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(base.join("released-claims")).unwrap();
        std::fs::write(
            base.join("released-claims").join(&claim),
            serde_json::to_vec(&("page-a", "session-a", claim.as_str())).unwrap(),
        )
        .unwrap();
        assert!(release_confirmed(&base, &claim, "page-a", "session-a").unwrap());
        assert!(release_confirmed(&base, &claim, "page-b", "session-a").is_err());
        assert!(release_confirmed(&base, &claim, "page-a", "session-b").is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn replacement_with_identical_bytes_has_distinct_physical_identity() {
        let base = std::env::temp_dir().join(format!("question-identity-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let path = base.join("content");
        std::fs::write(&path, b"same").unwrap();
        let original = directory_identity(&path).unwrap();
        // ast-grep-ignore: rust-rename-without-fsync -- fixture moves a file to test physical identity, not state-file persistence
        std::fs::rename(&path, base.join("original")).unwrap();
        std::fs::write(&path, b"same").unwrap();
        assert_ne!(directory_identity(&path).unwrap(), original);
        std::fs::remove_dir_all(base).unwrap();
    }
}

/// Persist a pasted blob so non-image attachments have a real path.
/// Receipt-backed question attachments are kept separately from generic pasted
/// files. An incomplete operation is never retried automatically or deleted.
fn question_attachment_dir(
    app: &AppHandle,
    scope: &str,
    question_id: &str,
    operation_id: &str,
) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    if scope.is_empty() || scope.len() > 65536 || question_id.is_empty() || question_id.len() > 4096
    {
        return Err("Invalid question attachment identity".into());
    }
    let id = Uuid::parse_str(operation_id).map_err(|_| "Invalid question attachment operation")?;
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(scope, question_id)).map_err(|e| e.to_string())?)
    );
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let dir = base
        .join("question-attachments")
        .join(digest)
        .join(id.to_string());
    crate::file_access::produced_target(&dir, &base, "question-attachments")?;
    Ok(dir)
}

fn add_claim(dir: &Path, claim_id: &str, issuer: &str, session_id: &str) -> Result<(), String> {
    let claim = Uuid::parse_str(claim_id)
        .map_err(|_| "Invalid question attachment claim")?
        .to_string();
    let claims = dir.join("claims");
    std::fs::create_dir_all(&claims).map_err(|e| e.to_string())?;
    if !std::fs::symlink_metadata(&claims)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Question attachment claims directory is unknown".into());
    }
    let expected = serde_json::to_vec(&(issuer, session_id)).map_err(|e| e.to_string())?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(claims.join(claim)) {
        Ok(mut file) => file
            .write_all(&expected)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let path = claims.join(
                Uuid::parse_str(claim_id)
                    .map_err(|_| "Invalid question attachment claim")?
                    .to_string(),
            );
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if !metadata.is_file() || std::fs::read(path).map_err(|e| e.to_string())? != expected {
                return Err("Question attachment claim is corrupt".into());
            }
            Ok(())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn verify_claim(dir: &Path, claim_id: &str, issuer: &str, session_id: &str) -> Result<(), String> {
    let id = Uuid::parse_str(claim_id)
        .map_err(|_| "Invalid question attachment claim")?
        .to_string();
    let claims = dir.join("claims");
    if !std::fs::symlink_metadata(&claims)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Question attachment claims directory is unknown".into());
    }
    let path = claims.join(id);
    if !std::fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("Question attachment claim is unknown".into());
    }
    let expected = serde_json::to_vec(&(issuer, session_id)).map_err(|e| e.to_string())?;
    if std::fs::read(path).map_err(|e| e.to_string())? != expected {
        return Err("Question attachment belongs to another page or session".into());
    }
    Ok(())
}

fn release_confirmed(
    dir: &Path,
    claim_id: &str,
    issuer: &str,
    session_id: &str,
) -> Result<bool, String> {
    let id = Uuid::parse_str(claim_id)
        .map_err(|_| "Invalid question attachment claim")?
        .to_string();
    let expected =
        serde_json::to_vec(&(issuer, session_id, claim_id)).map_err(|e| e.to_string())?;
    let shared = dir.join("released-claims").join(&id);
    if !definitely_absent(&shared)? {
        if !std::fs::symlink_metadata(dir.join("released-claims"))
            .map_err(|e| e.to_string())?
            .is_dir()
            || !std::fs::symlink_metadata(&shared)
                .map_err(|e| e.to_string())?
                .is_file()
            || std::fs::read(&shared).map_err(|e| e.to_string())? != expected
        {
            return Err("Question attachment release belongs to another owner".into());
        }
        return definitely_absent(&dir.join("claims").join(id));
    }
    let released = dir.join("released");
    if definitely_absent(&released)? {
        return Ok(false);
    }
    if !std::fs::symlink_metadata(&released)
        .map_err(|e| e.to_string())?
        .is_file()
        || std::fs::read(&released).map_err(|e| e.to_string())? != expected
    {
        return Err("Question attachment release belongs to another owner".into());
    }
    let record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join("created")).map_err(|e| e.to_string())?)
            .map_err(|_| "Question attachment receipt is corrupt")?;
    let name = record["name"]
        .as_str()
        .ok_or("Question attachment receipt is corrupt")?;
    if safe_attachment_name(name) != name {
        return Err("Question attachment receipt is corrupt".into());
    }
    Ok(definitely_absent(&dir.join("content").join(name))?
        && definitely_absent(&dir.join("releasing"))?)
}

fn validate_claimable(dir: &Path, record: &serde_json::Value) -> Result<(), String> {
    if record["claim_format"].as_u64() != Some(1) {
        return Err("Legacy question attachment ownership is unknown".into());
    }
    match std::fs::symlink_metadata(dir.join("released")) {
        Ok(_) => return Err("Question attachment was released".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let name = record["name"]
        .as_str()
        .ok_or("Question attachment receipt is corrupt")?;
    if safe_attachment_name(name) != name {
        return Err("Question attachment receipt is corrupt".into());
    }
    if !std::fs::symlink_metadata(dir.join("content"))
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Question attachment content directory is unknown".into());
    }
    let info =
        std::fs::symlink_metadata(dir.join("content").join(name)).map_err(|e| e.to_string())?;
    if !info.is_file() || info.len() > MAX_ATTACHMENT_EMBED_BYTES {
        return Err("Question attachment file identity is unknown".into());
    }
    if record["file_identity"].as_str()
        != Some(directory_identity(&dir.join("content").join(name))?.as_str())
    {
        return Err("Question attachment file identity changed".into());
    }
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(dir.join("content").join(name)).map_err(|e| e.to_string())?;
    if record["content_hash"].as_str() != Some(format!("{:x}", Sha256::digest(&bytes)).as_str()) {
        return Err("Question attachment file identity changed".into());
    }
    Ok(())
}

/// Persist the exact draft operation before accepting its file bytes.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command arguments are the frontend IPC contract.
pub async fn reserve_question_attachment(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    scope: String,
    question_id: String,
    operation_id: String,
    claim_id: String,
    file_id: String,
    name: String,
    mime_type: String,
    kind: String,
    size: u64,
) -> Result<(), String> {
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
            let _ = scope;
            if name.is_empty() || name.len() > 4096 || file_id.is_empty() || file_id.len() > 200 || mime_type.len() > 200 || !["image", "audio", "file"].contains(&kind.as_str()) || size > MAX_ATTACHMENT_EMBED_BYTES {
                return Err("Invalid question attachment draft".into());
            }
            let dir = question_attachment_dir(&app, &session_id, &question_id, &operation_id)?;
            let _lock = QuestionAttachmentLock::acquire(&dir)?;
            let record = serde_json::to_vec(&serde_json::json!({"sessionId":session_id,"questionId":question_id,"operationId":operation_id,"claimId":claim_id,"fileId":file_id,"name":name,"mimeType":mime_type,"kind":kind,"size":size,"issuer":issuer.identity()})).map_err(|e| e.to_string())?;
            match std::fs::create_dir(&dir) {
                Ok(()) => {
                    let mut marker = std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join("reserved")).map_err(|e| e.to_string())?;
                    marker.write_all(&record).and_then(|_| marker.sync_all()).map_err(|e| e.to_string())?;
                    add_claim(&dir, &claim_id, issuer.identity(), &session_id)?;
                    Ok(())
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if std::fs::read(dir.join("reserved")).map_err(|e| e.to_string())? != record {
                        return Err("Question attachment draft identity changed".into());
                    }
                    verify_claim(&dir, &claim_id, issuer.identity(), &session_id)
                }
                Err(error) => Err(error.to_string()),
            }
        })
    }).await
}

/// A lock older than this is left by a crashed holder. Listing never writes, so
/// it inspects such a dir without the lock; the lock itself is still not reaped.
const QUESTION_LOCK_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Read-only inspection of one operation dir for the recovery list. `Ok(None)`
/// means nothing to recover; `Err` skips only this dir.
fn list_draft_in_dir(
    dir: &Path,
    operation_name: &std::ffi::OsStr,
    session_id: &str,
    question_id: &str,
    issuer: &str,
) -> Result<Option<serde_json::Value>, String> {
    let _lock = match QuestionAttachmentLock::acquire(dir) {
        Ok(lock) => Some(lock),
        Err(reason) => {
            let stale = std::fs::symlink_metadata(dir.with_extension("lock"))
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > QUESTION_LOCK_STALE_AFTER);
            if !stale {
                return Err(reason);
            }
            None
        }
    };
    let marker = dir.join("reserved");
    let metadata = match std::fs::symlink_metadata(&marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.len() > 16 * 1024 {
        return Err("Question attachment draft is too large or unknown".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&marker)
        .map_err(|e| e.to_string())?
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 {
        return Err("Question attachment draft is too large".into());
    }
    let mut record: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Question attachment draft is corrupt")?;
    if record["sessionId"].as_str() != Some(session_id)
        || record["questionId"].as_str() != Some(question_id)
    {
        return Err("Question attachment draft identity changed".into());
    }
    let original_issuer = record["issuer"]
        .as_str()
        .ok_or("Question attachment draft is corrupt")?;
    let original_claim = record["claimId"]
        .as_str()
        .ok_or("Question attachment draft is corrupt")?;
    if release_confirmed(dir, original_claim, original_issuer, session_id)? {
        return Ok(None);
    }
    if record["issuer"].as_str() != Some(issuer) {
        return Err("Question attachment belongs to a previous page and requires recovery".into());
    }
    if record["operationId"].as_str() != operation_name.to_str() {
        return Err("Question attachment draft identity changed".into());
    }
    let claim = record["claimId"]
        .as_str()
        .ok_or("Question attachment draft is corrupt")?;
    verify_claim(dir, claim, issuer, session_id)?;
    record["retained"] = serde_json::Value::Bool(!definitely_absent(&dir.join("retained"))?);
    Ok(Some(record))
}

#[tauri::command]
pub async fn list_question_attachment_drafts(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    question_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
            let sample =
                question_attachment_dir(&app, &session_id, &question_id, &Uuid::nil().to_string())?;
            let parent = sample
                .parent()
                .ok_or("Invalid question attachment directory")?;
            let entries = match std::fs::read_dir(parent) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
                Err(error) => return Err(error.to_string()),
            };
            let mut result = Vec::new();
            let mut examined = 0usize;
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
                    || Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err()
                {
                    continue;
                }
                examined += 1;
                if examined > 100 {
                    return Err("Question attachment recovery capacity exceeded".into());
                }
                let dir = entry.path();
                // One busy, foreign or damaged operation must not hide the other drafts.
                match list_draft_in_dir(
                    &dir,
                    &entry.file_name(),
                    &session_id,
                    &question_id,
                    issuer.identity(),
                ) {
                    Ok(Some(record)) => result.push(record),
                    Ok(None) => {}
                    Err(reason) => {
                        log::warn!("Question attachment operation skipped during listing: {reason}")
                    }
                }
            }
            Ok(result)
        })
    })
    .await
}

#[tauri::command]
pub async fn create_question_attachment(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    scope: String,
    question_id: String,
    operation_id: String,
    claim_id: String,
    name: String,
    data: String,
) -> Result<serde_json::Value, String> {
    let _ = &scope;
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
        use sha2::{Digest, Sha256};
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &data).map_err(|_| "Attachment data is not valid base64.")?;
        if bytes.len() as u64 > MAX_ATTACHMENT_EMBED_BYTES { return Err("Attachment exceeds size limit".into()); }
        let dir = question_attachment_dir(&app, &session_id, &question_id, &operation_id)?;
        let _lock = QuestionAttachmentLock::acquire(&dir)?;
        let parent = dir.parent().ok_or("Invalid question attachment directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        hasher.update((name.len() as u64).to_be_bytes());
        hasher.update(name.as_bytes());
        hasher.update(&bytes);
        let signature = format!("{:x}", hasher.finalize());
        let reserved: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("reserved")).map_err(|e| e.to_string())?)
            .map_err(|_| "Question attachment draft is corrupt")?;
        if reserved["sessionId"].as_str() != Some(session_id.as_str()) || reserved["questionId"].as_str() != Some(question_id.as_str()) || reserved["operationId"].as_str() != Some(operation_id.as_str()) || reserved["claimId"].as_str() != Some(claim_id.as_str()) || reserved["name"].as_str() != Some(name.as_str()) || reserved["size"].as_u64() != Some(bytes.len() as u64) || reserved["issuer"].as_str() != Some(issuer.identity()) {
            return Err("Question attachment draft identity changed".into());
        }
        verify_claim(&dir, &claim_id, issuer.identity(), &session_id)?;
        let created_new = if !dir.join("created").exists() && !dir.join("pending").exists() {
                let mut manifest = std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join("pending")).map_err(|e| e.to_string())?;
                manifest.write_all(signature.as_bytes()).and_then(|_| manifest.sync_all()).map_err(|e| e.to_string())?;
                let content = dir.join("content");
                std::fs::create_dir(&content).map_err(|e| e.to_string())?;
                let path = content.join(safe_attachment_name(&name));
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
                let mut file = options.open(&path).map_err(|e| e.to_string())?;
                file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
                let record = serde_json::json!({"signature":signature,"name":safe_attachment_name(&name),"claim_format":1,"content_hash":format!("{:x}", Sha256::digest(&bytes)),"file_identity":directory_identity(&path)?}).to_string();
                let mut marker = std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join("created.tmp")).map_err(|e| e.to_string())?;
                marker.write_all(record.as_bytes()).and_then(|_| marker.sync_all()).map_err(|e| e.to_string())?;
                drop(marker);
                std::fs::rename(dir.join("created.tmp"), dir.join("created")).map_err(|e| e.to_string())?;
                true
        } else {
            false
        };
        let record: serde_json::Value = match std::fs::read(dir.join("created")) {
            Ok(data) => serde_json::from_slice(&data).map_err(|_| "Question attachment receipt is corrupt")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::json!({"state":"pending"})),
            Err(error) => return Err(error.to_string()),
        };
        if record["signature"].as_str() != Some(signature.as_str()) { return Err("Question attachment operation already used with different data".into()); }
        validate_claimable(&dir, &record)?;
        let _ = created_new;
        let path = dir.join("content").join(record["name"].as_str().ok_or("Question attachment receipt is corrupt")?);
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        crate::file_access::grant_produced_file(&app, &path, &base, "question-attachments")?;
        Ok(serde_json::json!({"state":"created","path":path.to_string_lossy(),"receipt":operation_id}))
        })
    }).await
}

#[tauri::command]
pub async fn claim_question_attachment(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    scope: String,
    question_id: String,
    receipt: String,
    claim_id: String,
    source_claim_id: String,
) -> Result<(), String> {
    let _ = &scope;
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
            let dir = question_attachment_dir(&app, &session_id, &question_id, &receipt)?;
            let _lock = QuestionAttachmentLock::acquire(&dir)?;
            let record: serde_json::Value = serde_json::from_slice(
                &std::fs::read(dir.join("created")).map_err(|e| e.to_string())?,
            )
            .map_err(|_| "Question attachment receipt is corrupt")?;
            validate_claimable(&dir, &record)?;
            verify_claim(&dir, &source_claim_id, issuer.identity(), &session_id)?;
            add_claim(&dir, &claim_id, issuer.identity(), &session_id)
        })
    })
    .await
}

#[tauri::command]
pub async fn read_question_attachment(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    scope: String,
    question_id: String,
    operation_id: String,
    claim_id: String,
) -> Result<serde_json::Value, String> {
    let _ = &scope;
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
        let dir = question_attachment_dir(&app, &session_id, &question_id, &operation_id)?;
        let _lock = QuestionAttachmentLock::acquire(&dir)?;
        match std::fs::metadata(&dir) {
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::json!({"state":"absent"})),
            Err(error) => return Err(error.to_string()),
        }
        if release_confirmed(&dir, &claim_id, issuer.identity(), &session_id)? { return Ok(serde_json::json!({"state":"released"})); }
        let record: serde_json::Value = match std::fs::read(dir.join("created")) {
            Ok(data) => serde_json::from_slice(&data).map_err(|_| "Question attachment receipt is corrupt")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::json!({"state":"pending"})),
            Err(error) => return Err(error.to_string()),
        };
        let path = dir.join("content").join(record["name"].as_str().ok_or("Question attachment receipt is corrupt")?);
        verify_claim(&dir, &claim_id, issuer.identity(), &session_id)?;
        validate_claimable(&dir, &record)?;
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        crate::file_access::grant_produced_file(&app, &path, &base, "question-attachments")?;
        Ok(serde_json::json!({"state":"created","path":path.to_string_lossy(),"receipt":operation_id}))
        })
    }).await
}

#[tauri::command]
pub async fn retain_question_attachment(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    scope: String,
    question_id: String,
    receipt: String,
    claim_id: String,
) -> Result<(), String> {
    let _ = &scope;
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
            let dir = question_attachment_dir(&app, &session_id, &question_id, &receipt)?;
            let _lock = QuestionAttachmentLock::acquire(&dir)?;
            verify_claim(&dir, &claim_id, issuer.identity(), &session_id)?;
            let record: serde_json::Value = serde_json::from_slice(
                &std::fs::read(dir.join("created")).map_err(|e| e.to_string())?,
            )
            .map_err(|_| "Question attachment receipt is corrupt")?;
            validate_claimable(&dir, &record)?;
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dir.join("retained"))
            {
                Ok(file) => file.sync_all().map_err(|e| e.to_string()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn release_question_attachment(
    app: AppHandle,
    window: tauri::Window,
    webview: tauri::WebviewWindow,
    session_id: String,
    scope: String,
    question_id: String,
    receipt: String,
    claim_id: String,
) -> Result<serde_json::Value, String> {
    let _ = &scope;
    check_caller(&window, &webview)?;
    let admission = admit_window_buffers(&window)?;
    let issuer = crate::control::receipts::capture(&webview)?;
    run_admitted_blocking(admission, move || {
        crate::session_window_ownership::with_session_window_owner(&issuer, &session_id, || {
        let dir = question_attachment_dir(&app, &session_id, &question_id, &receipt)?;
        let _lock = QuestionAttachmentLock::acquire(&dir)?;
        match std::fs::metadata(&dir) {
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err("Question attachment ownership is unavailable".into()),
            Err(error) => return Err(error.to_string()),
        }
        let released_record = serde_json::to_vec(&(issuer.identity(), session_id.as_str(), claim_id.as_str())).map_err(|e| e.to_string())?;
        if !definitely_absent(&dir.join("released"))? {
            if !std::fs::symlink_metadata(dir.join("released")).map_err(|e| e.to_string())?.is_file() { return Err("Question attachment release is unknown".into()); }
            let existing = std::fs::read(dir.join("released")).map_err(|e| e.to_string())?;
            if existing != released_record { return Err("Question attachment release belongs to another owner".into()); }
            let record: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("created")).map_err(|e| e.to_string())?).map_err(|_| "Question attachment receipt is corrupt")?;
            let name = record["name"].as_str().ok_or("Question attachment receipt is corrupt")?;
            if safe_attachment_name(name) != name { return Err("Question attachment receipt is corrupt".into()); }
            let path = dir.join("content").join(name);
            let quarantine = dir.join("releasing");
            if definitely_absent(&path)? && definitely_absent(&quarantine)? {
                return Ok(serde_json::json!({"state":"released"}));
            }
            if !definitely_absent(&quarantine)? {
                if !definitely_absent(&path)? { return Err("Question attachment recovery is ambiguous".into()); }
                let info = std::fs::symlink_metadata(&quarantine).map_err(|e| e.to_string())?;
                if !info.is_file() || info.len() > MAX_ATTACHMENT_EMBED_BYTES { return Err("Question attachment recovery is ambiguous".into()); }
                if record["file_identity"].as_str() != Some(directory_identity(&quarantine)?.as_str()) { return Err("Question attachment recovery is ambiguous".into()); }
                use sha2::{Digest, Sha256};
                let saved = std::fs::read(&quarantine).map_err(|e| e.to_string())?;
                if record["content_hash"].as_str() != Some(format!("{:x}", Sha256::digest(&saved)).as_str()) { return Err("Question attachment recovery is ambiguous".into()); }
                std::fs::rename(&quarantine, &path).map_err(|e| e.to_string())?;
            }
            std::fs::remove_file(dir.join("released")).map_err(|e| e.to_string())?;
        }
        let claim_name = Uuid::parse_str(&claim_id).map_err(|_| "Invalid question attachment claim")?.to_string();
        let previous_release = dir.join("released-claims").join(&claim_name);
        if !definitely_absent(&previous_release)? {
            if !std::fs::symlink_metadata(dir.join("released-claims")).map_err(|e| e.to_string())?.is_dir() || !std::fs::symlink_metadata(&previous_release).map_err(|e| e.to_string())?.is_file() || std::fs::read(&previous_release).map_err(|e| e.to_string())? != released_record {
                return Err("Question attachment release belongs to another owner".into());
            }
            if definitely_absent(&dir.join("claims").join(&claim_name))? { return Ok(serde_json::json!({"state":"released"})); }
        }
        verify_claim(&dir, &claim_id, issuer.identity(), &session_id)?;
        let claims = dir.join("claims");
        let mut count = 0usize;
        for entry in std::fs::read_dir(&claims).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() || Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
                return Err("Question attachment claims are unknown".into());
            }
            count += 1;
        }
        let retained = match std::fs::symlink_metadata(dir.join("retained")) {
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.to_string()),
        };
        let claim_path = claims.join(Uuid::parse_str(&claim_id).map_err(|_| "Invalid question attachment claim")?.to_string());
        let pristine = definitely_absent(&dir.join("created"))? && definitely_absent(&dir.join("pending"))? && definitely_absent(&dir.join("content"))?;
        if count > 1 || retained || pristine {
            let receipts = dir.join("released-claims");
            std::fs::create_dir_all(&receipts).map_err(|e| e.to_string())?;
            if !std::fs::symlink_metadata(&receipts).map_err(|e| e.to_string())?.is_dir() { return Err("Question attachment release history is unknown".into()); }
            let receipt_path = receipts.join(Uuid::parse_str(&claim_id).map_err(|_| "Invalid question attachment claim")?.to_string());
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&receipt_path) {
                Ok(mut receipt) => receipt.write_all(&released_record).and_then(|_| receipt.sync_all()).map_err(|e| e.to_string())?,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && std::fs::read(&receipt_path).map_err(|e| e.to_string())? == released_record => {},
                Err(error) => return Err(error.to_string()),
            }
            std::fs::remove_file(claim_path).map_err(|e| e.to_string())?;
            return Ok(serde_json::json!({"state":"released"}));
        }
        let record: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("created")).map_err(|e| e.to_string())?).map_err(|_| "Question attachment receipt is corrupt")?;
        validate_claimable(&dir, &record)?;
        let name = record["name"].as_str().ok_or("Question attachment receipt is corrupt")?;
        let path = dir.join("content").join(name);
        let quarantine = dir.join("releasing");
        if !definitely_absent(&quarantine)? { return Err("Question attachment release requires recovery".into()); }
        let mut tombstone = std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join("released")).map_err(|e| e.to_string())?;
        tombstone.write_all(&released_record).and_then(|_| tombstone.sync_all()).map_err(|e| e.to_string())?;
        drop(tombstone);
        std::fs::rename(&path, &quarantine).map_err(|e| e.to_string())?;
        use sha2::{Digest, Sha256};
        let check = std::fs::symlink_metadata(&quarantine).and_then(|info| {
            if !info.is_file() || info.len() > MAX_ATTACHMENT_EMBED_BYTES { return Err(std::io::Error::other("Unknown file")); }
            std::fs::read(&quarantine)
        });
        if record["file_identity"].as_str() != Some(directory_identity(&quarantine)?.as_str()) {
            let _ = std::fs::rename(&quarantine, &path);
            return Err("Question attachment file identity changed during release".into());
        }
        if !matches!(check, Ok(ref bytes) if record["content_hash"].as_str() == Some(format!("{:x}", Sha256::digest(bytes)).as_str())) {
            let _ = std::fs::rename(&quarantine, &path);
            return Err("Question attachment changed during release".into());
        }
        if let Err(error) = std::fs::remove_file(&quarantine) {
            let _ = std::fs::rename(&quarantine, &path);
            return Err(error.to_string());
        }
        let _ = std::fs::remove_file(claim_path);
        Ok(serde_json::json!({"state":"released"}))
        })
    }).await
}
