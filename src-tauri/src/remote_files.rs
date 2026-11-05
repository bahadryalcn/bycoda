//! Owner-requested remote file copies. Transfers never accept a local destination path.
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 4 * MAX_FILE_BYTES;
const STORAGE: &str = "remote-file-copies";
const MANIFEST: &str = ".bycoda-copy.json";
const IDLE_TRANSFER_TTL: std::time::Duration = std::time::Duration::from_secs(600);

#[derive(Serialize, Deserialize)]
struct CopyManifest {
    source: String,
    name: String,
    size: u64,
    modified: String,
}

struct CopyTransfer {
    file: Option<File>,
    base: PathBuf,
    directory: PathBuf,
    path: PathBuf,
    expected: u64,
    received: u64,
    complete: bool,
    source: String,
    touched: Instant,
}

impl Drop for CopyTransfer {
    fn drop(&mut self) {
        self.file.take();
        if !self.complete {
            // Both paths were created here under a fresh opaque ID; never recurse.
            if crate::file_access::produced_target(&self.path, &self.base, STORAGE).is_ok() {
                let _ = std::fs::remove_file(&self.path);
                let _ = std::fs::remove_file(self.directory.join(MANIFEST));
                let _ = std::fs::remove_dir(&self.directory);
            }
        }
    }
}

fn transfers() -> &'static Mutex<HashMap<String, Arc<Mutex<CopyTransfer>>>> {
    static TRANSFERS: OnceLock<Mutex<HashMap<String, Arc<Mutex<CopyTransfer>>>>> = OnceLock::new();
    TRANSFERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn safe_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("file");
    let cleaned: String = leaf
        .chars()
        .map(|value| {
            if value.is_control() || "<>:\"/\\|?*".contains(value) {
                '_'
            } else {
                value
            }
        })
        .take(180)
        .collect();
    let cleaned = cleaned.trim_matches([' ', '.']);
    if cleaned.is_empty() {
        return "file".into();
    }
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        format!("_{cleaned}")
    } else {
        cleaned.to_owned()
    }
}

fn source_hash(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 8192 {
        return Err("Invalid remote file identity".into());
    }
    Ok(format!("{:x}", Sha256::digest(key.as_bytes())))
}

fn modified(path: &Path) -> Option<String> {
    std::fs::symlink_metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_nanos().to_string())
}

fn cached(base: &Path, key: &str) -> Result<Option<PathBuf>, String> {
    let source = source_hash(key)?;
    let root = base.join(STORAGE);
    if !root.exists() {
        return Ok(None);
    }
    crate::file_access::produced_target(&root, base, STORAGE)?;
    for entry in std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .take(4096)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let directory = entry.path();
        let manifest = directory.join(MANIFEST);
        if !std::fs::symlink_metadata(&manifest)
            .is_ok_and(|meta| meta.is_file() && meta.len() < 4096)
        {
            continue;
        }
        let Some(info) = std::fs::read(manifest)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CopyManifest>(&bytes).ok())
        else {
            continue;
        };
        if info.source != source || info.name != safe_name(&info.name) {
            continue;
        }
        let path = directory.join(&info.name);
        let unchanged = std::fs::symlink_metadata(&path)
            .is_ok_and(|meta| meta.is_file() && meta.len() == info.size)
            && modified(&path).as_deref() == Some(info.modified.as_str());
        if unchanged {
            crate::file_access::produced_target(&path, base, STORAGE)?;
            return Ok(Some(path));
        }
    }
    Ok(None)
}

/// Abandoned transfers (renderer reload or window closed mid-copy) never reach
/// finish or cancel. Expire them so they stop holding capacity and partial files.
fn expire_idle(now: Instant) -> Result<(), String> {
    let entries: Vec<(String, Arc<Mutex<CopyTransfer>>)> = transfers()
        .lock()
        .map_err(|_| "File transfers are unavailable")?
        .iter()
        .map(|(id, transfer)| (id.clone(), transfer.clone()))
        .collect();
    for (id, transfer) in entries {
        // A locked transfer is serving a request right now, so it is not idle.
        let Ok(guard) = transfer.try_lock() else {
            continue;
        };
        if now.saturating_duration_since(guard.touched) < IDLE_TRANSFER_TTL {
            continue;
        }
        // Map lock is taken while holding the transfer lock; no path takes them in reverse order.
        let removed = {
            let mut map = transfers()
                .lock()
                .map_err(|_| "File transfers are unavailable")?;
            if map
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &transfer))
            {
                map.remove(&id)
            } else {
                None
            }
        };
        drop(guard);
        // Dropping the last handle deletes the partial file outside the map lock.
        drop(removed);
        drop(transfer);
    }
    Ok(())
}

fn begin(base: &Path, name: &str, size: u64, key: &str) -> Result<String, String> {
    if size > MAX_FILE_BYTES {
        return Err("File is too large to open on this computer (maximum 1 GB).".into());
    }
    let source = source_hash(key)?;
    // Serialize admissions and capacity accounting without blocking append,
    // finish, or cancel on filesystem scans.
    static ADMISSION: Mutex<()> = Mutex::new(());
    let _admission = ADMISSION
        .lock()
        .map_err(|_| "File transfers are unavailable")?;
    expire_idle(Instant::now())?;
    let active: Vec<_> = transfers()
        .lock()
        .map_err(|_| "File transfers are unavailable")?
        .values()
        .cloned()
        .collect();
    if active.len() >= 4 {
        return Err("Too many file downloads are active. Wait for one to finish.".into());
    }
    std::fs::create_dir_all(base).map_err(|error| error.to_string())?;
    let root = base.join(STORAGE);
    crate::file_access::produced_target(&root, base, STORAGE)?;
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut used = 0u64;
    for transfer in active {
        let transfer = transfer
            .lock()
            .map_err(|_| "File transfers are unavailable")?;
        used = used.saturating_add(transfer.expected - transfer.received);
    }
    for (index, directory) in std::fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .enumerate()
    {
        if index >= 4096 {
            return Err(format!(
                "The local file cache is full. Remove older copies from {} and try again.",
                root.display()
            ));
        }
        let directory = directory.map_err(|error| error.to_string())?;
        if !directory
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        for file in std::fs::read_dir(directory.path()).map_err(|error| error.to_string())? {
            let file = file.map_err(|error| error.to_string())?;
            if file
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                used =
                    used.saturating_add(file.metadata().map_err(|error| error.to_string())?.len());
            }
        }
    }
    if used.saturating_add(size) > MAX_CACHE_BYTES {
        return Err(format!("The local file cache is full (maximum 4 GB). Remove older copies from {} and try again.", root.display()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let directory = root.join(&id);
    crate::file_access::produced_target(&directory, base, STORAGE)?;
    #[cfg(unix)]
    let mut directory_options = std::fs::DirBuilder::new();
    #[cfg(not(unix))]
    let directory_options = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory_options.mode(0o700);
    }
    directory_options
        .create(&directory)
        .map_err(|error| error.to_string())?;
    let path = directory.join(safe_name(name));
    let mut transfer = CopyTransfer {
        file: None,
        base: base.to_path_buf(),
        directory,
        path,
        expected: size,
        received: 0,
        complete: false,
        source,
        touched: Instant::now(),
    };
    crate::file_access::produced_target(&transfer.path, base, STORAGE)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    transfer.file = Some(
        options
            .open(&transfer.path)
            .map_err(|error| error.to_string())?,
    );
    transfers()
        .lock()
        .map_err(|_| "File transfers are unavailable")?
        .insert(id.clone(), Arc::new(Mutex::new(transfer)));
    Ok(id)
}

fn append(id: &str, offset: u64, data: &str) -> Result<(), String> {
    if data.len() > MAX_CHUNK_BYTES.div_ceil(3) * 4 {
        return Err("File chunk is too large".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Invalid file chunk")?;
    if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES {
        return Err("Invalid file chunk size".into());
    }
    let transfer = transfers()
        .lock()
        .map_err(|_| "File transfers are unavailable")?
        .get(id)
        .cloned()
        .ok_or("File download is no longer active")?;
    let mut transfer = transfer
        .lock()
        .map_err(|_| "File transfers are unavailable")?;
    if offset < transfer.received {
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or("Invalid file chunk offset")?;
        if end > transfer.received {
            return Err("File chunk is out of order or exceeds the expected size".into());
        }
        let file = transfer.file.as_mut().ok_or("File download is closed")?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let mut accepted = vec![0; bytes.len()];
        file.read_exact(&mut accepted)
            .map_err(|error| error.to_string())?;
        if accepted != bytes {
            return Err("File chunk does not match the accepted data".into());
        }
        transfer.touched = Instant::now();
        return Ok(());
    }
    if offset != transfer.received || bytes.len() as u64 > transfer.expected - transfer.received {
        return Err("File chunk is out of order or exceeds the expected size".into());
    }
    let file = transfer.file.as_mut().ok_or("File download is closed")?;
    // A failed write_all may have advanced the cursor after writing a prefix.
    // Retry from the accepted offset, replacing any partial bytes.
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    if let Err(error) = file.write_all(&bytes) {
        if file.set_len(offset).is_err() {
            transfer.file.take();
        }
        return Err(error.to_string());
    }
    transfer.received += bytes.len() as u64;
    transfer.touched = Instant::now();
    Ok(())
}

#[tauri::command]
pub async fn begin_remote_file_copy(
    app: AppHandle,
    name: String,
    size: u64,
    key: String,
) -> Result<String, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || begin(&base, &name, size, &key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cached_remote_file_copy(
    app: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?;
        let Some(path) = cached(&base, &key)? else {
            return Ok(None);
        };
        crate::file_access::grant_produced_file(&app, &path, &base, STORAGE)?;
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn append_remote_file_copy(id: String, offset: u64, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || append(&id, offset, &data))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn finish_remote_file_copy(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let transfer = transfers()
            .lock()
            .map_err(|_| "File transfers are unavailable")?
            .remove(&id)
            .ok_or("File download is no longer active")?;
        let mut transfer = transfer
            .lock()
            .map_err(|_| "File transfers are unavailable")?;
        if transfer.received != transfer.expected {
            return Err("File download is incomplete".into());
        }
        transfer
            .file
            .take()
            .ok_or("File download is closed")?
            .sync_all()
            .map_err(|error| error.to_string())?;
        crate::file_access::grant_produced_file(&app, &transfer.path, &transfer.base, STORAGE)?;
        app.asset_protocol_scope()
            .allow_file(&transfer.path)
            .map_err(|error| error.to_string())?;
        let manifest = CopyManifest {
            source: transfer.source.clone(),
            name: transfer
                .path
                .file_name()
                .ok_or("Missing file name")?
                .to_string_lossy()
                .into_owned(),
            size: transfer.expected,
            modified: modified(&transfer.path)
                .ok_or("Could not read the file modification time")?,
        };
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let bytes = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
        options
            .open(transfer.directory.join(MANIFEST))
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|error| error.to_string())?;
        transfer.complete = true;
        Ok(transfer.path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cancel_remote_file_copy(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let removed = transfers()
            .lock()
            .map_err(|_| "File transfers are unavailable")?
            .remove(&id);
        drop(removed);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Grant the asset protocol only after the existing native file-access decision.
#[tauri::command]
pub async fn prepare_local_file(
    app: AppHandle,
    path: String,
    max_bytes: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::file_access::require(&app, &crate::fs::expand_home(&path), false)?;
        if !path.is_file() {
            return Err("Not a file".into());
        }
        if let Some(limit) = max_bytes {
            if path.metadata().map_err(|error| error.to_string())?.len() > limit {
                return Err(format!(
                    "File is too large to preview (maximum {} MB).",
                    limit / 1024 / 1024
                ));
            }
        }
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|error| error.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_are_portable_and_cannot_escape_the_copy_directory() {
        assert_eq!(safe_name("/tmp/../résumé.mp4"), "résumé.mp4");
        assert_eq!(safe_name("C:\\work\\CON.pdf"), "_CON.pdf");
        assert_eq!(safe_name("../"), "file");
        assert_eq!(safe_name("report:2026?.csv"), "report_2026_.csv");
    }

    #[test]
    fn transfer_rejects_out_of_order_and_oversized_chunks_and_cleans_partial_files() {
        let base = std::env::temp_dir().join(format!("bycoda-copy-test-{}", uuid::Uuid::new_v4()));
        let id = begin(&base, "video.mp4", 3, "remote://mac/video.mp4:version").unwrap();
        let path = transfers().lock().unwrap()[&id]
            .lock()
            .unwrap()
            .path
            .clone();
        assert!(append(&id, 1, "YQ==").is_err());
        assert!(append(&id, 0, "YWJjZA==").is_err());
        append(&id, 0, "YWJj").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"abc");
        transfers().lock().unwrap().remove(&id);
        assert!(!path.exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn cached_copies_match_the_source_version_and_preserve_user_edits() {
        let base = std::env::temp_dir().join(format!("bycoda-copy-test-{}", uuid::Uuid::new_v4()));
        let key = "remote://mac/report.pdf:version-one";
        let id = begin(&base, "report.pdf", 3, key).unwrap();
        append(&id, 0, "YWJj").unwrap();
        let transfer = transfers().lock().unwrap().remove(&id).unwrap();
        let mut transfer = transfer.lock().unwrap();
        transfer.file.take();
        let info = CopyManifest {
            source: source_hash(key).unwrap(),
            name: "report.pdf".into(),
            size: 3,
            modified: modified(&transfer.path).unwrap(),
        };
        std::fs::write(
            transfer.directory.join(MANIFEST),
            serde_json::to_vec(&info).unwrap(),
        )
        .unwrap();
        transfer.complete = true;
        assert_eq!(cached(&base, key).unwrap(), Some(transfer.path.clone()));
        assert!(cached(&base, "remote://mac/report.pdf:version-two")
            .unwrap()
            .is_none());
        std::fs::write(&transfer.path, b"user edited this copy").unwrap();
        assert!(cached(&base, key).unwrap().is_none());
        assert_eq!(
            std::fs::read(&transfer.path).unwrap(),
            b"user edited this copy"
        );
        drop(transfer);
        std::fs::remove_dir_all(base).unwrap();
    }
}
