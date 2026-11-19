//! Owner-requested remote file copies. Transfers never accept a local destination path.
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 4 * MAX_FILE_BYTES;
const MAX_CACHE_ENTRIES: usize = 4096;
const STORAGE: &str = "remote-file-copies";
const MANIFEST: &str = ".bycoda-copy.json";
const IDLE_TRANSFER_TTL: Duration = Duration::from_secs(600);
/// A copy handed out (or finished) within this window may still be open in a viewer
/// or another app, so capacity eviction never takes it. Longer than the idle
/// transfer TTL, so a copy whose transfer is still live is always inside it.
const RECENT_USE_GRACE: Duration = Duration::from_secs(60 * 60);
/// Copies untouched for this long are removed by the startup sweep and on admission.
const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Serializes admissions, the startup sweep and capacity accounting.
static ADMISSION: Mutex<()> = Mutex::new(());
/// Serializes every read or removal of completed copies, so a copy being handed out
/// and a copy being evicted never overlap. Always taken after `ADMISSION`.
static CACHE: Mutex<()> = Mutex::new(());

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

fn stamp(meta: &std::fs::Metadata) -> Option<String> {
    meta.modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_nanos().to_string())
}

fn modified(path: &Path) -> Option<String> {
    stamp(&std::fs::symlink_metadata(path).ok()?)
}

/// Records that a copy is being used now. The manifest's modified time is the
/// copy's last use; the copy itself is never rewritten.
fn touch(manifest: &Path) -> std::io::Result<()> {
    OpenOptions::new()
        .write(true)
        .open(manifest)?
        .set_modified(SystemTime::now())
}

fn cached(base: &Path, key: &str) -> Result<Option<PathBuf>, String> {
    let source = source_hash(key)?;
    let root = base.join(STORAGE);
    if !root.exists() {
        return Ok(None);
    }
    crate::file_access::produced_target(&root, base, STORAGE)?;
    // Hand-out and eviction of a copy are mutually exclusive.
    let _cache = CACHE.lock().map_err(|_| "File transfers are unavailable")?;
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
        let Some(info) = std::fs::read(&manifest)
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
            // Without a recorded use the copy could be evicted while it is shown,
            // so a copy whose use cannot be recorded is a miss.
            if touch(&manifest).is_err() {
                continue;
            }
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

/// One directory of the copy storage, as found on disk.
struct StoredCopy {
    directory: PathBuf,
    /// Regular files in the directory, as counted against the capacity.
    bytes: u64,
    /// Manifest modified time of a completed copy; newest write of an interrupted one.
    last_used: SystemTime,
    /// Provably created here, untouched since, and not part of a live transfer.
    owned: bool,
    /// Names of the regular files to remove with the directory, manifest last.
    files: Vec<std::ffi::OsString>,
}

fn idle(now: SystemTime, since: SystemTime) -> Duration {
    // A modified time in the future counts as just used.
    now.duration_since(since).unwrap_or_default()
}

/// Reads one storage directory without following links or changing anything.
/// `active` holds the directory names of transfers that are still running.
fn inspect(directory: &Path, active: &[String], now: SystemTime) -> Result<StoredCopy, String> {
    let mut bytes = 0u64;
    let mut foreign = false;
    let mut files: Vec<(std::ffi::OsString, std::fs::Metadata)> = Vec::new();
    for child in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let child = child.map_err(|error| error.to_string())?;
        // DirEntry metadata does not follow links.
        let meta = child.metadata().map_err(|error| error.to_string())?;
        if meta.is_file() {
            bytes = bytes.saturating_add(meta.len());
            files.push((child.file_name(), meta));
        } else {
            foreign = true;
        }
    }
    let name = directory
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    // Directories are only ever created under a fresh UUID.
    let ours = !foreign && uuid::Uuid::parse_str(name).is_ok() && !active.iter().any(|id| id == name);
    let manifest = files.iter().find(|(file, _)| file == MANIFEST);
    let info = manifest
        .filter(|(_, meta)| meta.len() < 4096)
        .and_then(|_| std::fs::read(directory.join(MANIFEST)).ok())
        .and_then(|raw| serde_json::from_slice::<CopyManifest>(&raw).ok())
        .filter(|info| info.name == safe_name(&info.name));
    let (owned, last_used) = match (manifest, info) {
        (Some((_, manifest)), Some(info)) => {
            let data = files.iter().find(|(file, _)| *file == info.name.as_str());
            // A copy the user edited or replaced is theirs: keep it.
            let untouched = match data {
                Some((_, meta)) => {
                    files.len() == 2
                        && meta.len() == info.size
                        && stamp(meta).as_deref() == Some(info.modified.as_str())
                }
                // Only the manifest is left of a copy that was already removed.
                None => files.len() == 1,
            };
            (
                ours && untouched,
                manifest.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            )
        }
        // No usable manifest: a copy interrupted before it finished.
        _ => {
            let newest = files
                .iter()
                .filter_map(|(_, meta)| meta.modified().ok())
                .max()
                .or_else(|| std::fs::symlink_metadata(directory).ok()?.modified().ok());
            (
                ours && files.len() <= 2,
                // An unreadable time keeps the directory inside the grace window.
                newest.unwrap_or(now),
            )
        }
    };
    let mut names: Vec<_> = files.into_iter().map(|(file, _)| file).collect();
    names.sort_by_key(|file| file == MANIFEST);
    Ok(StoredCopy {
        directory: directory.to_path_buf(),
        bytes,
        last_used,
        owned,
        files: names,
    })
}

/// Removes an evictable copy. Everything is checked again first, so a copy used
/// or edited since the scan is left alone. The data goes before the manifest: a
/// copy that cannot be deleted (open on Windows) stays complete and cached.
fn remove_copy(
    base: &Path,
    seen: &StoredCopy,
    active: &[String],
    now: SystemTime,
) -> Result<bool, String> {
    crate::file_access::produced_target(&seen.directory, base, STORAGE)?;
    let current = inspect(&seen.directory, active, now)?;
    if !current.owned || current.last_used != seen.last_used {
        return Ok(false);
    }
    for file in &current.files {
        let path = seen.directory.join(file);
        crate::file_access::produced_target(&path, base, STORAGE)?;
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Ok(false),
        }
    }
    // Never recursive: anything unexpected that appeared keeps the directory.
    let _ = std::fs::remove_dir(&seen.directory);
    Ok(true)
}

/// Frees storage owned by this module. Copies idle for `RETENTION` always go;
/// when `room` is `(bytes of running transfers, bytes wanted)` the least recently
/// used copies idle for `RECENT_USE_GRACE` go until the request fits `max_bytes`
/// and `max_entries`. Fails when it still does not fit.
fn reclaim(
    base: &Path,
    root: &Path,
    active: &[String],
    room: Option<(u64, u64)>,
    max_bytes: u64,
    max_entries: usize,
) -> Result<(), String> {
    let _cache = CACHE.lock().map_err(|_| "File transfers are unavailable")?;
    let now = SystemTime::now();
    let mut copies = Vec::new();
    let mut entries = 0usize;
    // shortcut: only the first max_entries + 1 entries are read, as `cached` reads at most
    // max_entries; a storage folder with more foreign entries is refused below, not trimmed.
    for entry in std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .take(max_entries + 1)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        entries += 1;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        copies.push(inspect(&entry.path(), active, now)?);
    }
    let (in_flight, wanted) = room.unwrap_or((0, 0));
    let mut used = copies
        .iter()
        .fold(in_flight, |sum, copy| sum.saturating_add(copy.bytes));
    copies.retain(|copy| copy.owned);
    copies.sort_by_key(|copy| copy.last_used);
    for copy in &copies {
        let age = idle(now, copy.last_used);
        let full = room.is_some()
            && (used.saturating_add(wanted) > max_bytes || entries > max_entries - 1);
        if age < RECENT_USE_GRACE || (age < RETENTION && !full) {
            // Oldest first: nothing after this one is more eligible.
            break;
        }
        if remove_copy(base, copy, active, now)? {
            used = used.saturating_sub(copy.bytes);
            entries -= 1;
        }
    }
    if room.is_some() && (used.saturating_add(wanted) > max_bytes || entries > max_entries - 1) {
        return Err(format!(
            "The local file cache is full. Close copies that are open or remove ones you no longer need from {} and try again.",
            root.display()
        ));
    }
    Ok(())
}

/// Running transfers: bytes still to arrive and the names of their directories.
fn running(transfers: Vec<Arc<Mutex<CopyTransfer>>>) -> Result<(u64, Vec<String>), String> {
    let mut remaining = 0u64;
    let mut directories = Vec::new();
    for transfer in transfers {
        let transfer = transfer
            .lock()
            .map_err(|_| "File transfers are unavailable")?;
        remaining = remaining.saturating_add(transfer.expected - transfer.received);
        if let Some(name) = transfer.directory.file_name() {
            directories.push(name.to_string_lossy().into_owned());
        }
    }
    Ok((remaining, directories))
}

/// Removes copies idle for `RETENTION` and interrupted copies from earlier runs.
fn sweep(base: &Path) -> Result<(), String> {
    let root = base.join(STORAGE);
    if !root.exists() {
        return Ok(());
    }
    crate::file_access::produced_target(&root, base, STORAGE)?;
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
    let (_, directories) = running(active)?;
    reclaim(
        base,
        &root,
        &directories,
        None,
        MAX_CACHE_BYTES,
        MAX_CACHE_ENTRIES,
    )
}

/// Run once when the app starts; the copies are only a cache, so a failure is logged.
pub(crate) fn sweep_in_background(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let result = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())
            .and_then(|base| sweep(&base));
        if let Err(error) = result {
            log::warn!("Could not sweep remote file copies: {error}");
        }
    });
}

fn begin(base: &Path, name: &str, size: u64, key: &str) -> Result<String, String> {
    if size > MAX_FILE_BYTES {
        return Err("File is too large to open on this computer (maximum 1 GB).".into());
    }
    let source = source_hash(key)?;
    // Serialize admissions and capacity accounting without blocking append,
    // finish, or cancel on filesystem scans.
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
    let (in_flight, directories) = running(active)?;
    // Makes room by evicting the least recently used completed copies; running
    // transfers, copies used within the grace window and copies edited by the user stay.
    reclaim(
        base,
        &root,
        &directories,
        Some((in_flight, size)),
        MAX_CACHE_BYTES,
        MAX_CACHE_ENTRIES,
    )?;
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

    fn scratch() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("bycoda-copy-test-{}", uuid::Uuid::new_v4()));
        let root = base.join(STORAGE);
        std::fs::create_dir_all(&root).unwrap();
        (base, root)
    }

    fn set_modified(path: &Path, idle_for: Duration) {
        OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(SystemTime::now() - idle_for)
            .unwrap();
    }

    /// A completed copy of `bytes` bytes whose last use was `idle_for` ago.
    fn stored(root: &Path, key: &str, bytes: usize, idle_for: Duration) -> PathBuf {
        let directory = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&directory).unwrap();
        let data = directory.join("copy.bin");
        std::fs::write(&data, vec![b'x'; bytes]).unwrap();
        let info = CopyManifest {
            source: source_hash(key).unwrap(),
            name: "copy.bin".into(),
            size: bytes as u64,
            modified: modified(&data).unwrap(),
        };
        let manifest = directory.join(MANIFEST);
        std::fs::write(&manifest, serde_json::to_vec(&info).unwrap()).unwrap();
        set_modified(&manifest, idle_for);
        directory
    }

    const HOURS: u64 = 60 * 60;

    #[test]
    fn full_cache_evicts_the_least_recently_used_completed_copies() {
        let (base, root) = scratch();
        let oldest = stored(&root, "a", 10, Duration::from_secs(5 * HOURS));
        let older = stored(&root, "b", 10, Duration::from_secs(3 * HOURS));
        let newer = stored(&root, "c", 10, Duration::from_secs(2 * HOURS));
        let retained_bytes = 10 + std::fs::metadata(newer.join(MANIFEST)).unwrap().len();
        reclaim(&base, &root, &[], Some((0, 10)), retained_bytes + 10, 100).unwrap();
        assert!(!oldest.exists());
        assert!(!older.exists());
        assert!(newer.join("copy.bin").exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn entry_cap_evicts_instead_of_refusing() {
        let (base, root) = scratch();
        let oldest = stored(&root, "a", 1, Duration::from_secs(4 * HOURS));
        let newer = stored(&root, "b", 1, Duration::from_secs(2 * HOURS));
        reclaim(&base, &root, &[], Some((0, 1)), 1000, 2).unwrap();
        assert!(!oldest.exists());
        assert!(newer.exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn eviction_keeps_recent_edited_running_and_foreign_copies() {
        let (base, root) = scratch();
        let recent = stored(&root, "recent", 10, Duration::from_secs(60));
        let edited = stored(&root, "edited", 10, Duration::from_secs(9 * HOURS));
        std::fs::write(edited.join("copy.bin"), b"edited by the user").unwrap();
        let running = stored(&root, "running", 10, Duration::from_secs(9 * HOURS));
        let running_name = running.file_name().unwrap().to_string_lossy().into_owned();
        let foreign = root.join("not-created-here");
        std::fs::create_dir(&foreign).unwrap();
        std::fs::write(foreign.join("notes.txt"), b"keep").unwrap();
        let sibling = stored(&root, "sibling", 10, Duration::from_secs(9 * HOURS));
        std::fs::write(sibling.join("extra.txt"), b"keep").unwrap();
        assert!(reclaim(&base, &root, &[running_name], Some((0, 10)), 40, 100).is_err());
        for kept in [&recent, &edited, &running, &foreign, &sibling] {
            assert!(kept.exists());
        }
        assert_eq!(
            std::fs::read(edited.join("copy.bin")).unwrap(),
            b"edited by the user"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn handing_out_a_cached_copy_protects_it_from_eviction() {
        let (base, root) = scratch();
        let directory = stored(&root, "shown", 10, Duration::from_secs(9 * HOURS));
        assert!(cached(&base, "shown").unwrap().is_some());
        assert!(reclaim(&base, &root, &[], Some((0, 10)), 10, 100).is_err());
        assert!(directory.join("copy.bin").exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn sweep_removes_expired_copies_and_old_interrupted_transfers_only() {
        let (base, root) = scratch();
        let expired = stored(&root, "old", 10, Duration::from_secs(31 * 24 * HOURS));
        let kept = stored(&root, "kept", 10, Duration::from_secs(2 * HOURS));
        let stale = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&stale).unwrap();
        std::fs::write(stale.join("partial.bin"), b"ab").unwrap();
        set_modified(&stale.join("partial.bin"), Duration::from_secs(31 * 24 * HOURS));
        let fresh = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&fresh).unwrap();
        std::fs::write(fresh.join("partial.bin"), b"ab").unwrap();
        sweep(&base).unwrap();
        assert!(!expired.exists());
        assert!(!stale.exists());
        assert!(kept.exists());
        assert!(fresh.exists());
        std::fs::remove_dir_all(base).unwrap();
    }
}
