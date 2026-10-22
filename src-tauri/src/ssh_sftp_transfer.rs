//! Transfer-only metadata, acknowledged-byte accounting and explicit recovery.
//! Shares the parent's canonical endpoint, operation ownership and SFTP process.
use super::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{io::BufRead, path::PathBuf};
use tauri::{Emitter, Manager};

struct TransferContext {
    app: Option<tauri::AppHandle>,
    root: PathBuf,
    #[cfg(test)]
    observer: Option<Arc<dyn Fn(ProgressEvent) + Send + Sync>>,
}
impl TransferContext {
    fn for_app(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            app: Some(app.clone()),
            root: app
                .path()
                .app_data_dir()
                .map_err(|_| "Transfer recovery directory unavailable")?
                .join("sftp-recovery-v1"),
            #[cfg(test)]
            observer: None,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProgressEvent {
    pub operation_id: String,
    pub phase: String,
    pub transferred_bytes: u64,
    pub total_bytes: Option<u64>,
    pub state: String,
}

#[derive(Default)]
struct Ranges(Vec<(u64, u64)>);
impl Ranges {
    fn insert(&mut self, start: u64, end: u64) -> u64 {
        if start >= end {
            return self.bytes();
        }
        self.0.push((start, end));
        self.0.sort_unstable();
        let mut merged: Vec<(u64, u64)> = vec![];
        for &(start, end) in &self.0 {
            if let Some(last) = merged.last_mut() {
                if start <= last.1 {
                    last.1 = last.1.max(end);
                    continue;
                }
            }
            merged.push((start, end));
        }
        // Real OpenSSH has a bounded window of outstanding blocks. Arbitrary
        // unmergeable diagnostics cannot grow application memory unboundedly.
        if merged.len() <= 4096 {
            self.0 = merged;
        } else {
            self.0.clear();
        }
        self.bytes()
    }
    fn bytes(&self) -> u64 {
        self.0.iter().map(|(a, b)| b - a).sum()
    }
}

pub(super) struct Progress {
    app: Option<tauri::AppHandle>,
    owner: String,
    event: Mutex<ProgressEvent>,
    ranges: Mutex<Ranges>,
    last: Mutex<Instant>,
    upload: bool,
    base: u64,
    #[cfg(test)]
    observer: Option<Arc<dyn Fn(ProgressEvent) + Send + Sync>>,
}
impl Progress {
    fn new(
        app: &TransferContext,
        operation: &Operation,
        phase: &str,
        total: Option<u64>,
        upload: bool,
        base: u64,
    ) -> Arc<Self> {
        let value = Arc::new(Self {
            app: app.app.clone(),
            owner: operation.owner.clone(),
            event: Mutex::new(ProgressEvent {
                operation_id: operation.id.clone(),
                phase: phase.into(),
                transferred_bytes: base,
                total_bytes: total,
                state: "running".into(),
            }),
            ranges: Mutex::new(Ranges::default()),
            last: Mutex::new(Instant::now()),
            upload,
            base,
            #[cfg(test)]
            observer: app.observer.clone(),
        });
        value.emit();
        value
    }
    fn emit(&self) {
        if let Ok(event) = self.event.lock() {
            #[cfg(test)]
            if let Some(observer) = &self.observer {
                observer(event.clone());
            }
            if let Some(app) = &self.app {
                let _ = app.emit_to(&self.owner, "ssh-sftp-progress", event.clone());
            }
        }
    }
    fn observe(&self, line: &str) {
        let Some((start, end)) = diagnostic_range(line, self.upload) else {
            return;
        };
        let total = self.event.lock().ok().and_then(|event| event.total_bytes);
        if start < self.base || total.is_some_and(|total| end > total) {
            return;
        }
        let bytes = self
            .ranges
            .lock()
            .map(|mut ranges| ranges.insert(start, end))
            .unwrap_or(0)
            .saturating_add(self.base);
        if let Ok(mut event) = self.event.lock() {
            event.transferred_bytes = bytes;
        }
        let should_emit = self
            .last
            .lock()
            .map(|mut last| {
                if last.elapsed() >= Duration::from_millis(200) {
                    *last = Instant::now();
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);
        if should_emit {
            self.emit();
        }
    }
    pub(super) fn finish(&self, state: &str) {
        if let Ok(mut event) = self.event.lock() {
            event.state = state.into();
            if state == "completed" {
                if let Some(total) = event.total_bytes {
                    event.transferred_bytes = total;
                }
            }
        }
        self.emit();
    }
    #[cfg(test)]
    fn testing(operation: &Operation, total: u64, upload: bool, base: u64) -> Arc<Self> {
        Arc::new(Self {
            app: None,
            owner: operation.owner.clone(),
            event: Mutex::new(ProgressEvent {
                operation_id: operation.id.clone(),
                phase: "test".into(),
                transferred_bytes: base,
                total_bytes: Some(total),
                state: "running".into(),
            }),
            ranges: Mutex::new(Ranges::default()),
            last: Mutex::new(Instant::now()),
            upload,
            base,
            observer: None,
        })
    }
}

fn diagnostic_range(line: &str, upload: bool) -> Option<(u64, u64)> {
    if upload {
        let text = line.strip_prefix("debug3: In write loop, ack for ")?;
        let fields: Vec<_> = text.split_whitespace().collect();
        if fields.len() != 5 || fields[2] != "bytes" || fields[3] != "at" {
            return None;
        }
        fields[0].parse::<u64>().ok()?;
        let length = fields[1].parse::<u64>().ok()?;
        let start = fields[4].parse::<u64>().ok()?;
        Some((start, start.checked_add(length)?))
    } else {
        let (start, end) = line
            .strip_prefix("debug3: Received data ")?
            .split_once(" -> ")?;
        Some((
            start.trim().parse().ok()?,
            end.trim().parse::<u64>().ok()?.checked_add(1)?,
        ))
    }
}

/// Verbose OpenSSH diagnostics stay transient. Only verified block counters are
/// emitted; raw debug/key/agent metadata is neither retained nor logged.
pub(super) fn read_diagnostics(reader: impl Read, progress: Option<Arc<Progress>>) -> Vec<u8> {
    let mut reader = std::io::BufReader::new(reader);
    let mut errors = vec![];
    let mut line = Vec::new();
    loop {
        line.clear();
        // read_until is capped per line through take; oversized lines are
        // drained rather than allocated or exposed as error messages.
        let size = reader
            .by_ref()
            .take(16385)
            .read_until(b'\n', &mut line)
            .unwrap_or(0);
        if size == 0 {
            break;
        }
        if line.len() > 16384 && !line.ends_with(b"\n") {
            loop {
                let buffer = reader.fill_buf().unwrap_or_default();
                if buffer.is_empty() {
                    break;
                }
                let end = buffer.iter().position(|b| *b == b'\n');
                let consumed = end.map_or(buffer.len(), |index| index + 1);
                reader.consume(consumed);
                if end.is_some() {
                    break;
                }
            }
            continue;
        }
        let text = String::from_utf8_lossy(&line);
        if let Some(progress) = &progress {
            progress.observe(text.trim());
        }
        if !text.starts_with("debug") && !text.starts_with("OpenSSH_") && errors.len() < 65536 {
            let keep = (65536 - errors.len()).min(line.len());
            errors.extend_from_slice(&line[..keep]);
        }
    }
    errors
}

pub(super) fn hash_file(path: &Path, limit: Option<u64>) -> Result<String, String> {
    hash_checked(path, limit, None)
}

fn hash_checked(
    path: &Path,
    limit: Option<u64>,
    operation: Option<&Operation>,
) -> Result<String, String> {
    if let Some(operation) = operation {
        operation.check()?;
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "Cannot inspect transfer file")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Transfer files must be regular files; symlinks are not followed".into());
    }
    let mut file = fs::File::open(path).map_err(|_| "Cannot read transfer file")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut remaining = limit.unwrap_or(u64::MAX);
    while remaining > 0 {
        if let Some(operation) = operation {
            operation.check()?;
        }
        let capacity = (remaining.min(buffer.len() as u64)) as usize;
        let n = file
            .read(&mut buffer[..capacity])
            .map_err(|_| "Cannot verify transfer file")?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        remaining -= n as u64;
    }
    if limit.is_some() && remaining != 0 {
        return Err("Transfer file is shorter than its saved identity".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Recovery {
    pub id: String,
    pub owner: String,
    pub connection_id: String,
    pub endpoint_hash: String,
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub staging_path: String,
    pub partial_bytes: u64,
    pub partial_hash: Option<String>,
    pub source_hash: Option<String>,
    pub total_bytes: Option<u64>,
    #[serde(default)]
    pub publication: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryView {
    pub id: String,
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub partial_bytes: u64,
    pub total_bytes: Option<u64>,
    pub publication: Option<String>,
}
fn directory(app: &TransferContext) -> Result<PathBuf, String> {
    let path = app.root.clone();
    fs::create_dir_all(&path).map_err(|_| "Cannot create transfer recovery directory")?;
    if fs::symlink_metadata(&path)
        .map_err(|_| "Cannot inspect transfer recovery directory")?
        .file_type()
        .is_symlink()
    {
        return Err("Recovery directory cannot be a symlink".into());
    }
    Ok(path)
}

pub(super) fn endpoint_hash(endpoint: &SshEndpoint) -> Result<String, String> {
    let bytes = serde_json::to_vec(endpoint).map_err(|_| "Cannot identify transfer endpoint")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
pub(super) fn staging_path(
    direction: &str,
    id: &str,
    local: &str,
    remote: &str,
) -> Result<String, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid recovery identifier")?;
    if direction == "download" {
        let parent = Path::new(local)
            .parent()
            .ok_or("Invalid download destination")?;
        Ok(parent
            .join(format!(".bycoda-sftp-{id}.partial"))
            .to_string_lossy()
            .into_owned())
    } else if direction == "upload" {
        let (directory, name) = remote.rsplit_once('/').unwrap_or((".", remote));
        if name.is_empty() || name == "." || name == ".." {
            return Err("Choose a remote filename".into());
        }
        Ok(format!("{directory}/.bycoda-upload-{id}.partial"))
    } else {
        Err("Unknown recovery direction".into())
    }
}
fn validate_record(record: &Recovery) -> Result<(), String> {
    let expected = staging_path(
        &record.direction,
        &record.id,
        &record.local_path,
        &record.remote_path,
    )?;
    if record.staging_path != expected {
        return Err("Recovery staging path does not belong to this transfer".into());
    }
    quote_path(&record.remote_path)?;
    quote_path(&record.staging_path)?;
    Ok(())
}
fn record_path(app: &TransferContext, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid transfer recovery identifier")?;
    Ok(directory(app)?.join(format!("{id}.json")))
}
fn save(app: &TransferContext, record: &Recovery) -> Result<(), String> {
    validate_record(record)?;
    let path = record_path(app, &record.id)?;
    let data = serde_json::to_vec(record).map_err(|_| "Cannot encode transfer recovery")?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Cannot save transfer recovery")?;
    let result = (|| {
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot save transfer recovery")?;
        drop(file);
        // Replace in one filesystem operation. Removing the previous checkpoint
        // first loses recovery if publication fails or the process stops here.
        fs::rename(&temporary, path).map_err(|_| "Cannot publish transfer recovery")
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(String::from)
}
fn remove(app: &TransferContext, id: &str) -> Result<(), String> {
    fs::remove_file(record_path(app, id)?).map_err(|_| "Cannot remove transfer recovery".into())
}
fn load(
    app: &TransferContext,
    id: &str,
    owner: &str,
    connection_id: &str,
    endpoint: &SshEndpoint,
) -> Result<Recovery, String> {
    let path = record_path(app, id)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| "Transfer recovery not found")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 65536 {
        return Err("Invalid transfer recovery file".into());
    }
    let record: Recovery =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Cannot read transfer recovery")?)
            .map_err(|_| "Invalid transfer recovery record")?;
    validate_binding(&record, id, owner, connection_id, endpoint)?;
    Ok(record)
}
fn validate_binding(
    record: &Recovery,
    id: &str,
    owner: &str,
    connection_id: &str,
    endpoint: &SshEndpoint,
) -> Result<(), String> {
    if record.id != id
        || record.owner != owner
        || record.connection_id != connection_id
        || record.endpoint_hash != endpoint_hash(endpoint)?
    {
        return Err("Transfer target or native window changed; recovery refused".into());
    }
    validate_record(record)
}
pub(super) fn list(
    app: &tauri::AppHandle,
    owner: &str,
    connection_id: &str,
) -> Result<Vec<RecoveryView>, String> {
    list_core(&TransferContext::for_app(app)?, owner, connection_id)
}
fn list_core(
    app: &TransferContext,
    owner: &str,
    connection_id: &str,
) -> Result<Vec<RecoveryView>, String> {
    let mut records = vec![];
    for entry in fs::read_dir(directory(app)?)
        .map_err(|_| "Cannot list transfer recovery")?
        .take(1000)
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.len() > 65536 || !meta.is_file() || meta.file_type().is_symlink() {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(record) = serde_json::from_slice::<Recovery>(&bytes) else {
            continue;
        };
        if record.owner == owner && record.connection_id == connection_id {
            records.push(RecoveryView {
                id: record.id,
                direction: record.direction,
                local_path: record.local_path,
                remote_path: record.remote_path,
                partial_bytes: record.partial_bytes,
                total_bytes: record.total_bytes,
                publication: record.publication,
            });
        }
    }
    Ok(records)
}

struct Temporary(PathBuf);
impl Temporary {
    fn create(parent: &Path) -> Result<Self, String> {
        let path = parent.join(format!(".bycoda-verify-{}.partial", uuid::Uuid::new_v4()));
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Cannot create transfer verification file")?;
        Ok(Self(path))
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn regular_remote(
    endpoint: &SshEndpoint,
    path: &str,
    operation: &Operation,
) -> Result<u64, String> {
    let output = run_batch(
        endpoint,
        format!("ls -ln {}\nbye\n", quote_path(path)?),
        operation,
    )?;
    let mut sizes = vec![];
    for line in output.lines() {
        if line.starts_with('-') && line.as_bytes().get(1).is_some_and(|b| b"rwx-*".contains(b)) {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 9 {
                return Err("Unsupported remote file metadata".into());
            }
            sizes.push(
                fields[4]
                    .parse::<u64>()
                    .map_err(|_| "Unsupported remote file size")?,
            );
        } else if line.starts_with('l') || line.starts_with('d') {
            return Err(
                "Select a regular remote file; symlinks and directories are not followed".into(),
            );
        }
    }
    if sizes.len() != 1 {
        return Err("Could not establish a single regular remote file".into());
    }
    Ok(sizes[0])
}
fn wire_path(path: &Path) -> Result<String, String> {
    quote_path(&path.to_string_lossy().replace('\\', "/"))
}
#[allow(clippy::too_many_arguments)] // Carries the transfer's phase and progress offset together.
fn run_file(
    app: &TransferContext,
    endpoint: &SshEndpoint,
    operation: &Operation,
    batch: String,
    phase: &str,
    total: Option<u64>,
    upload: bool,
    base: u64,
) -> Result<(), String> {
    let progress = Progress::new(app, operation, phase, total, upload, base);
    let result = run_batch_progress(endpoint, batch, operation, Some(progress.clone()));
    progress.finish(if result.is_ok() {
        "transferred"
    } else if operation.check().is_err() {
        "cancelled"
    } else {
        "failed"
    });
    result.map(|_| ())
}
fn checkpoint(app: &TransferContext, record: &mut Recovery) -> Result<(), String> {
    if record.direction == "download" {
        let meta = fs::symlink_metadata(&record.staging_path)
            .map_err(|_| "Partial download is unavailable")?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Partial download changed to a nonregular file".into());
        }
        record.partial_bytes = meta.len();
        record.partial_hash = Some(hash_file(Path::new(&record.staging_path), None)?);
    }
    save(app, record)
}
fn completed(app: &TransferContext, operation: &Operation, total: u64) {
    let progress = Progress::new(app, operation, "complete", Some(total), false, total);
    progress.finish("completed");
}

// Publication is the commit boundary. Never report a published destination as
// failed merely because deleting its owned staging/metadata failed afterwards.
fn finish_publication(
    app: &TransferContext,
    record: &mut Recovery,
    operation: &Operation,
    total: u64,
) {
    record.publication = Some("completed".into());
    let _ = save(app, record);
    let cleaned = if record.direction == "download" {
        fs::remove_file(&record.staging_path).is_ok()
    } else {
        true
    };
    if cleaned {
        let _ = remove(app, &record.id);
    }
    completed(app, operation, total);
}

fn resumable(record: &Recovery) -> Result<(), String> {
    if record.publication.is_some() {
        return Err("Publication may already have changed the destination. Check the destination before dismissing this recovery; it cannot be resumed.".into());
    }
    Ok(())
}
fn publish_local(operation: &Operation, staging: &Path, destination: &Path) -> Result<(), String> {
    operation.check()?;
    publish_download(staging, destination)
}

fn publish_upload(
    app: &TransferContext,
    endpoint: &SshEndpoint,
    operation: &Operation,
    record: &mut Recovery,
    total: u64,
) -> Result<(), String> {
    operation.check()?;
    // Persist BEFORE the remote rename: a lost reply/cancellation cannot prove
    // the server did not commit it. Do not automatically retry that decision.
    record.publication = Some("unknown".into());
    save(app, record)?;
    operation.check()?;
    run_batch(endpoint, format!("rename {} {}\nbye\n", quote_path(&record.staging_path)?, quote_path(&record.remote_path)?), operation)
        .map_err(|_| "Upload publication outcome is unknown; check the remote destination before dismissing recovery. Cancellation cannot undo a rename already received by the server.".to_string())?;
    finish_publication(app, record, operation, total);
    Ok(())
}

pub(super) fn download(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    remote_path: String,
    local_path: String,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let proxy_operation = crate::ssh_http_proxy_credentials::ProxyOperation::SftpDownload {
        operation_id: operation_id.clone(),
        remote_path: remote_path.clone(),
        local_path: local_path.clone(),
    };
    let mut operation = Operation::begin_for_window_with_lease(
        operation_id,
        window.label(),
        &endpoint,
        owner_lease,
    )?;
    operation.authorize_http_proxy(
        &app,
        window.label(),
        &connection_id,
        &endpoint,
        &proxy_operation,
        http_proxy_ticket_id.as_deref(),
    )?;
    download_core(
        &TransferContext::for_app(&app)?,
        &endpoint,
        &operation,
        connection_id,
        remote_path,
        local_path,
    )
}
fn download_core(
    app: &TransferContext,
    endpoint: &SshEndpoint,
    operation: &Operation,
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let destination = Path::new(&local_path);
    destination
        .parent()
        .filter(|p| p.is_dir())
        .ok_or("Choose an existing destination directory")?;
    if fs::symlink_metadata(destination).is_ok() {
        return Err("Destination exists; choose a new filename".into());
    }
    let total = regular_remote(endpoint, &remote_path, operation)?;
    let id = uuid::Uuid::new_v4().to_string();
    let staging = staging_path("download", &id, &local_path, &remote_path)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(|_| "Cannot create download staging file")?;
    let mut record = Recovery {
        id,
        owner: operation.owner.clone(),
        connection_id,
        endpoint_hash: endpoint_hash(endpoint)?,
        direction: "download".into(),
        local_path,
        remote_path,
        staging_path: staging,
        partial_bytes: 0,
        partial_hash: Some(format!("{:x}", Sha256::digest([]))),
        source_hash: None,
        total_bytes: Some(total),
        publication: None,
    };
    save(app, &record)?;
    let result = (|| {
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "get {} {}\nbye\n",
                quote_path(&record.remote_path)?,
                wire_path(Path::new(&record.staging_path))?
            ),
            "download",
            Some(total),
            false,
            0,
        )?;
        operation.check()?;
        if fs::metadata(&record.staging_path)
            .map_err(|_| "Download staging disappeared")?
            .len()
            != total
        {
            return Err("Remote file size changed during transfer; verify before recovery".into());
        }
        publish_local(
            operation,
            Path::new(&record.staging_path),
            Path::new(&record.local_path),
        )?;
        finish_publication(app, &mut record, operation, total);
        Ok(())
    })();
    if result.is_err() && Path::new(&record.staging_path).exists() {
        checkpoint(app, &mut record)
            .map_err(|error| format!("Transfer failed; recovery checkpoint failed: {error}"))?;
    }
    result
}

#[allow(clippy::too_many_arguments)] // Mirrors the IPC transfer arguments without changing their wire shape.
pub(super) fn upload(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    local_path: String,
    remote_path: String,
    overwrite_confirmed: bool,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<u64, String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let proxy_operation = crate::ssh_http_proxy_credentials::ProxyOperation::SftpUpload {
        operation_id: operation_id.clone(),
        local_path: local_path.clone(),
        remote_path: remote_path.clone(),
        overwrite_confirmed,
    };
    let mut operation = Operation::begin_for_window_with_lease(
        operation_id,
        window.label(),
        &endpoint,
        owner_lease,
    )?;
    operation.authorize_http_proxy(
        &app,
        window.label(),
        &connection_id,
        &endpoint,
        &proxy_operation,
        http_proxy_ticket_id.as_deref(),
    )?;
    upload_core(
        &TransferContext::for_app(&app)?,
        &endpoint,
        &operation,
        connection_id,
        local_path,
        remote_path,
        overwrite_confirmed,
    )
}
fn upload_core(
    app: &TransferContext,
    endpoint: &SshEndpoint,
    operation: &Operation,
    connection_id: String,
    local_path: String,
    remote_path: String,
    overwrite_confirmed: bool,
) -> Result<u64, String> {
    if !overwrite_confirmed {
        return Err("Explicit replacement consent is required for every upload".into());
    }
    let source_hash = hash_checked(Path::new(&local_path), None, Some(operation))?;
    let total = fs::metadata(&local_path)
        .map_err(|_| "Upload source is unavailable")?
        .len();
    let id = uuid::Uuid::new_v4().to_string();
    let staging = staging_path("upload", &id, &local_path, &remote_path)?;
    let mut record = Recovery {
        id,
        owner: operation.owner.clone(),
        connection_id,
        endpoint_hash: endpoint_hash(endpoint)?,
        direction: "upload".into(),
        local_path,
        remote_path,
        staging_path: staging,
        partial_bytes: 0,
        partial_hash: None,
        source_hash: Some(source_hash),
        total_bytes: Some(total),
        publication: None,
    };
    save(app, &record)?;
    let result = (|| {
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "put {} {}\nbye\n",
                wire_path(Path::new(&record.local_path))?,
                quote_path(&record.staging_path)?
            ),
            "upload",
            Some(total),
            true,
            0,
        )?;
        // Source pre/post hashes alone cannot detect mutate-then-restore while
        // OpenSSH reads it. Verify the actual remote staged bytes as well.
        let verify = Temporary::create(&std::env::temp_dir())?;
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "get {} {}\nbye\n",
                quote_path(&record.staging_path)?,
                wire_path(&verify.0)?
            ),
            "verify completed upload",
            Some(total),
            false,
            0,
        )?;
        if hash_checked(&verify.0, None, Some(operation))? != *record.source_hash.as_ref().unwrap()
        {
            return Err("Completed upload failed content verification; publication refused".into());
        }
        if hash_checked(Path::new(&record.local_path), None, Some(operation))?
            != *record.source_hash.as_ref().unwrap()
        {
            return Err("Upload source changed during transfer; publication refused".into());
        }
        publish_upload(app, endpoint, operation, &mut record, total)?;
        Ok(total)
    })();
    result
}

pub(super) fn resume(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    recovery_id: String,
    overwrite_confirmed: bool,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let proxy_operation = crate::ssh_http_proxy_credentials::ProxyOperation::SftpResume {
        operation_id: operation_id.clone(),
        recovery_id: recovery_id.clone(),
        overwrite_confirmed,
    };
    let mut operation = Operation::begin_for_window_with_lease(
        operation_id,
        window.label(),
        &endpoint,
        owner_lease,
    )?;
    operation.authorize_http_proxy(
        &app,
        window.label(),
        &connection_id,
        &endpoint,
        &proxy_operation,
        http_proxy_ticket_id.as_deref(),
    )?;
    resume_core(
        &TransferContext::for_app(&app)?,
        &endpoint,
        &operation,
        connection_id,
        recovery_id,
        overwrite_confirmed,
    )
}
fn resume_core(
    app: &TransferContext,
    endpoint: &SshEndpoint,
    operation: &Operation,
    connection_id: String,
    recovery_id: String,
    overwrite_confirmed: bool,
) -> Result<(), String> {
    let mut record = load(
        app,
        &recovery_id,
        &operation.owner,
        &connection_id,
        endpoint,
    )?;
    resumable(&record)?;
    if record.direction == "download" {
        let partial_path = record.staging_path.clone();
        let partial = Path::new(&partial_path);
        if fs::symlink_metadata(&record.local_path).is_ok() {
            return Err("Download destination exists; recovery cannot overwrite it".into());
        }
        if fs::symlink_metadata(partial)
            .map_err(|_| "Partial download is missing")?
            .len()
            != record.partial_bytes
            || Some(hash_checked(partial, None, Some(operation))?) != record.partial_hash
        {
            return Err("Partial download content changed; recovery refused".into());
        }
        let total = regular_remote(endpoint, &record.remote_path, operation)?;
        if total < record.partial_bytes {
            return Err("Remote file is shorter than the saved partial".into());
        }
        let parent = Path::new(&record.local_path)
            .parent()
            .ok_or("Invalid destination")?;
        let verified = Temporary::create(parent)?;
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "get {} {}\nbye\n",
                quote_path(&record.remote_path)?,
                wire_path(&verified.0)?
            ),
            "verify remote content",
            Some(total),
            false,
            0,
        )?;
        if Some(hash_checked(
            &verified.0,
            Some(record.partial_bytes),
            Some(operation),
        )?) != record.partial_hash
        {
            return Err(
                "Remote content no longer matches the saved partial prefix; recovery refused"
                    .into(),
            );
        }
        let expected = hash_checked(&verified.0, None, Some(operation))?;
        let result = (|| {
            run_file(
                app,
                endpoint,
                operation,
                format!(
                    "reget {} {}\nbye\n",
                    quote_path(&record.remote_path)?,
                    wire_path(partial)?
                ),
                "resume download",
                Some(total),
                false,
                record.partial_bytes,
            )?;
            if hash_checked(partial, None, Some(operation))? != expected {
                return Err(
                    "Remote content changed during resumed transfer; publication refused".into(),
                );
            }
            operation.check()?;
            publish_local(operation, partial, Path::new(&record.local_path))?;
            finish_publication(app, &mut record, operation, total);
            Ok(())
        })();
        if result.is_err() {
            checkpoint(app, &mut record)?;
        }
        result
    } else {
        if !overwrite_confirmed {
            return Err("Resume upload requires fresh replacement consent".into());
        }
        let expected = record
            .source_hash
            .as_ref()
            .ok_or("Upload source identity is missing")?;
        if &hash_checked(Path::new(&record.local_path), None, Some(operation))? != expected {
            return Err("Local upload source content changed; recovery refused".into());
        }
        let total = record.total_bytes.ok_or("Upload size is missing")?;
        let remote_size = regular_remote(endpoint, &record.staging_path, operation)?;
        if remote_size > total {
            return Err("Remote partial is larger than its source".into());
        }
        let verify = Temporary::create(&std::env::temp_dir())?;
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "get {} {}\nbye\n",
                quote_path(&record.staging_path)?,
                wire_path(&verify.0)?
            ),
            "verify upload prefix",
            Some(remote_size),
            false,
            0,
        )?;
        if hash_checked(&verify.0, None, Some(operation))?
            != hash_checked(
                Path::new(&record.local_path),
                Some(remote_size),
                Some(operation),
            )?
        {
            return Err(
                "Remote partial content does not match the local source prefix; recovery refused"
                    .into(),
            );
        }
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "reput {} {}\nbye\n",
                wire_path(Path::new(&record.local_path))?,
                quote_path(&record.staging_path)?
            ),
            "resume upload",
            Some(total),
            true,
            remote_size,
        )?;
        run_file(
            app,
            endpoint,
            operation,
            format!(
                "get {} {}\nbye\n",
                quote_path(&record.staging_path)?,
                wire_path(&verify.0)?
            ),
            "verify completed upload",
            Some(total),
            false,
            0,
        )?;
        if &hash_checked(&verify.0, None, Some(operation))? != expected
            || &hash_checked(Path::new(&record.local_path), None, Some(operation))? != expected
        {
            return Err("Completed upload failed content verification; publication refused".into());
        }
        publish_upload(app, endpoint, operation, &mut record, total)?;
        Ok(())
    }
}

pub(super) fn discard(
    app: tauri::AppHandle,
    window: tauri::Window,
    connection_id: String,
    recovery_id: String,
    operation_id: String,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let proxy_operation = crate::ssh_http_proxy_credentials::ProxyOperation::SftpDiscard {
        operation_id: operation_id.clone(),
        recovery_id: recovery_id.clone(),
    };
    let mut operation = Operation::begin_for_window_with_lease(
        operation_id,
        window.label(),
        &endpoint,
        owner_lease,
    )?;
    operation.authorize_http_proxy(
        &app,
        window.label(),
        &connection_id,
        &endpoint,
        &proxy_operation,
        http_proxy_ticket_id.as_deref(),
    )?;
    discard_core(
        &TransferContext::for_app(&app)?,
        &endpoint,
        &operation,
        connection_id,
        recovery_id,
    )
}
fn discard_core(
    app: &TransferContext,
    endpoint: &SshEndpoint,
    operation: &Operation,
    connection_id: String,
    recovery_id: String,
) -> Result<(), String> {
    let record = load(
        app,
        &recovery_id,
        &operation.owner,
        &connection_id,
        endpoint,
    )?;
    operation.check()?;
    if record.publication.is_some() {
        // Explicit dismissal only removes metadata. Never guess whether a
        // remote commit happened, or delete a destination/possibly stale stage.
        return remove(app, &record.id);
    }
    if record.direction == "download" {
        if Some(hash_checked(
            Path::new(&record.staging_path),
            None,
            Some(operation),
        )?) != record.partial_hash
        {
            return Err("Partial content changed; automatic cleanup refused".into());
        }
        fs::remove_file(&record.staging_path)
            .map_err(|_| "Cannot remove owned partial download")?;
    } else {
        regular_remote(endpoint, &record.staging_path, operation)?;
        run_batch(
            endpoint,
            format!("rm {}\nbye\n", quote_path(&record.staging_path)?),
            operation,
        )?;
    }
    remove(app, &record.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_unique_out_of_order_blocks_not_highest_offset() {
        let mut ranges = Ranges::default();
        assert_eq!(ranges.insert(100, 200), 100);
        assert_eq!(ranges.insert(0, 100), 200);
        assert_eq!(ranges.insert(50, 150), 200);
        assert_eq!(ranges.insert(250, 300), 250);
    }
    #[test]
    fn parses_only_actual_sftp_byte_diagnostics() {
        assert_eq!(
            diagnostic_range("debug3: Received data 10 -> 19", false),
            Some((10, 20))
        );
        assert_eq!(
            diagnostic_range(
                "debug3: In write loop, ack for 7 102400 bytes at 102400",
                true
            ),
            Some((102400, 204800))
        );
        assert_eq!(
            diagnostic_range("Transferred: sent 9999, received 1 bytes", true),
            None
        );
    }
    #[test]
    fn discards_debug_metadata_but_preserves_bounded_actionable_errors() {
        let errors = read_diagnostics(
            std::io::Cursor::new(b"debug1: private identity path\nPermission denied\n"),
            None,
        );
        assert_eq!(String::from_utf8(errors).unwrap(), "Permission denied\n");
    }

    #[test]
    fn progress_arguments_cannot_be_silenced_or_drop_an_identity_value() {
        let endpoint = SshEndpoint {
            host: "host.test".into(),
            port: 22,
            identity_file: Some("-q".into()),
            ..Default::default()
        };
        let args = transfer_args(&endpoint, true).unwrap();
        assert_eq!(args[0], "-vvv");
        assert!(args.windows(2).any(|pair| pair == ["-i", "-q"]));
        assert_eq!(
            args.iter().filter(|value| value.as_str() == "-q").count(),
            1
        );
    }

    fn scratch() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("bycoda-sftp-adversarial-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn content_identity_rejects_same_size_tampering_and_short_prefix() {
        let root = scratch();
        let first = root.join("first");
        let second = root.join("second");
        fs::write(&first, b"identical-size-A").unwrap();
        fs::write(&second, b"identical-size-B").unwrap();
        assert_eq!(
            fs::metadata(&first).unwrap().len(),
            fs::metadata(&second).unwrap().len()
        );
        assert_ne!(
            hash_file(&first, None).unwrap(),
            hash_file(&second, None).unwrap()
        );
        assert_eq!(
            hash_file(&first, Some(5)).unwrap(),
            hash_file(&second, Some(5)).unwrap()
        );
        assert!(hash_file(&first, Some(1000)).is_err());
        assert!(hash_file(&root, None).is_err());
        for path in [first, second] {
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn cancelled_hash_never_reads_or_publishes() {
        let operation = Operation::begin("hash-cancel-test".into()).unwrap();
        cancel_for_window("internal-test", "hash-cancel-test").unwrap();
        assert_eq!(
            hash_checked(Path::new("does-not-exist"), None, Some(&operation)).unwrap_err(),
            "SFTP operation cancelled"
        );
    }
    #[test]
    #[cfg(windows)]
    fn failed_checkpoint_replacement_preserves_previous_recovery() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch();
        let context = TransferContext {
            app: None,
            root: root.clone(),
            observer: None,
        };
        let id = uuid::Uuid::new_v4().to_string();
        let mut record = Recovery {
            id: id.clone(),
            owner: "owner".into(),
            connection_id: "server".into(),
            endpoint_hash: "hash".into(),
            direction: "download".into(),
            local_path: "/downloads/result.txt".into(),
            remote_path: "/remote/source.txt".into(),
            staging_path: staging_path(
                "download",
                &id,
                "/downloads/result.txt",
                "/remote/source.txt",
            )
            .unwrap(),
            partial_bytes: 0,
            partial_hash: None,
            source_hash: None,
            total_bytes: None,
            publication: None,
        };
        save(&context, &record).unwrap();
        let path = record_path(&context, &id).unwrap();
        let previous = fs::read(&path).unwrap();
        // An antivirus/indexer or another reader may temporarily deny rename.
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        record.partial_bytes = 42;
        assert!(save(&context, &record).is_err());
        assert_eq!(fs::read(&path).unwrap(), previous);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        drop(lock);
        save(&context, &record).unwrap();
        let updated: Recovery = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(updated.partial_bytes, 42);
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn recovery_staging_cannot_delete_a_user_path_or_escape_target() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut record = Recovery {
            id: id.clone(),
            owner: "owner".into(),
            connection_id: "server".into(),
            endpoint_hash: "hash".into(),
            direction: "download".into(),
            local_path: "/downloads/result.txt".into(),
            remote_path: "/remote/source.txt".into(),
            staging_path: staging_path(
                "download",
                &id,
                "/downloads/result.txt",
                "/remote/source.txt",
            )
            .unwrap(),
            partial_bytes: 0,
            partial_hash: None,
            source_hash: None,
            total_bytes: None,
            publication: None,
        };
        assert!(validate_record(&record).is_ok());
        let endpoint = SshEndpoint {
            host: "host.test".into(),
            port: 22,
            ..Default::default()
        };
        record.endpoint_hash = endpoint_hash(&endpoint).unwrap();
        assert!(validate_binding(&record, &id, "owner", "server", &endpoint).is_ok());
        assert!(validate_binding(&record, &id, "other-window", "server", &endpoint).is_err());
        assert!(validate_binding(&record, &id, "owner", "other-record", &endpoint).is_err());
        let mut changed_endpoint = endpoint.clone();
        changed_endpoint.host = "changed.test".into();
        assert!(validate_binding(&record, &id, "owner", "server", &changed_endpoint).is_err());
        assert!(resumable(&record).is_ok());
        record.publication = Some("unknown".into());
        assert!(resumable(&record).is_err());
        record.publication = Some("completed".into());
        assert!(resumable(&record).is_err());
        record.staging_path = "/owner/important.txt".into();
        assert!(validate_record(&record).is_err());
        record.id = "../../other".into();
        assert!(validate_record(&record).is_err());
        assert!(staging_path("upload", &id, "local", "/remote/..").is_err());
    }
    #[test]
    fn cancellation_before_publication_preserves_destination_and_partial() {
        let root = scratch();
        let staging = root.join("partial");
        let destination = root.join("destination");
        fs::write(&staging, b"verified bytes").unwrap();
        let operation = Operation::begin("cancel-before-publication".into()).unwrap();
        cancel_for_window("internal-test", "cancel-before-publication").unwrap();
        assert!(publish_local(&operation, &staging, &destination).is_err());
        assert!(!destination.exists());
        assert_eq!(fs::read(&staging).unwrap(), b"verified bytes");
        fs::remove_file(staging).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn diagnostic_size_and_overflow_are_bounded() {
        assert_eq!(
            diagnostic_range("debug3: Received data 0 -> 18446744073709551615", false),
            None
        );
        assert_eq!(
            diagnostic_range(
                "debug3: In write loop, ack for 1 2 bytes at 18446744073709551615",
                true
            ),
            None
        );
        let input = format!("{}\nDisk full\n", "X".repeat(50000));
        let output = read_diagnostics(std::io::Cursor::new(input), None);
        assert_eq!(String::from_utf8(output).unwrap(), "Disk full\n");
    }
    #[cfg(unix)]
    #[test]
    fn local_symlink_partial_is_never_hashed_or_followed() {
        let root = scratch();
        let source = root.join("source");
        let link = root.join("link");
        fs::write(&source, "owner data").unwrap();
        std::os::unix::fs::symlink(&source, &link).unwrap();
        assert!(hash_file(&link, None).is_err());
        fs::remove_file(link).unwrap();
        fs::remove_file(source).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    #[ignore = "Requires the disposable running SFTP fixture and test environment"]
    fn real_acknowledged_bytes_and_content_verified_reget_reput() {
        let root = PathBuf::from(std::env::var("BYCODA_TEST_SFTP_ROOT").expect("fixture root"));
        let endpoint = SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(std::env::var("USERNAME").unwrap()),
            port: fs::read_to_string(root.join("port.txt"))
                .unwrap()
                .trim()
                .parse()
                .unwrap(),
            identity_file: Some(std::env::var("BYCODA_TEST_SFTP_IDENTITY").unwrap()),
            ..Default::default()
        };
        let operation = Operation::begin("actual-progress-resume".into()).unwrap();
        let payload: Vec<u8> = (0..1048576).map(|n| (n % 251) as u8).collect();
        let source = root.join("advanced-source.bin");
        let stage = root.join("advanced-stage.bin");
        let downloaded = root.join("advanced-downloaded.bin");
        let snapshot = root.join("advanced-snapshot.bin");
        fs::write(&source, &payload).unwrap();
        let path = |path: &Path| wire_path(path).unwrap();
        let uploaded = Progress::testing(&operation, payload.len() as u64, true, 0);
        run_batch_progress(
            &endpoint,
            format!("put {} {}\nbye\n", path(&source), path(&stage)),
            &operation,
            Some(uploaded.clone()),
        )
        .unwrap();
        assert_eq!(
            uploaded.event.lock().unwrap().transferred_bytes,
            payload.len() as u64,
            "must observe real acknowledged writes, not SSH overhead or an estimated counter"
        );
        let received = Progress::testing(&operation, payload.len() as u64, false, 0);
        run_batch_progress(
            &endpoint,
            format!("get {} {}\nbye\n", path(&stage), path(&snapshot)),
            &operation,
            Some(received.clone()),
        )
        .unwrap();
        assert_eq!(
            received.event.lock().unwrap().transferred_bytes,
            payload.len() as u64
        );
        assert_eq!(
            hash_file(&source, None).unwrap(),
            hash_file(&snapshot, None).unwrap()
        );
        fs::write(&downloaded, &payload[..123456]).unwrap();
        assert_eq!(
            hash_file(&snapshot, Some(123456)).unwrap(),
            hash_file(&downloaded, None).unwrap()
        );
        let resumed = Progress::testing(&operation, payload.len() as u64, false, 123456);
        run_batch_progress(
            &endpoint,
            format!("reget {} {}\nbye\n", path(&stage), path(&downloaded)),
            &operation,
            Some(resumed.clone()),
        )
        .unwrap();
        assert_eq!(
            resumed.event.lock().unwrap().transferred_bytes,
            payload.len() as u64
        );
        assert_eq!(
            hash_file(&downloaded, None).unwrap(),
            hash_file(&snapshot, None).unwrap()
        );
        fs::write(&stage, &payload[..654321]).unwrap();
        run_batch(
            &endpoint,
            format!("get {} {}\nbye\n", path(&stage), path(&snapshot)),
            &operation,
        )
        .unwrap();
        assert_eq!(
            hash_file(&snapshot, None).unwrap(),
            hash_file(&source, Some(654321)).unwrap()
        );
        let resumed = Progress::testing(&operation, payload.len() as u64, true, 654321);
        run_batch_progress(
            &endpoint,
            format!("reput {} {}\nbye\n", path(&source), path(&stage)),
            &operation,
            Some(resumed.clone()),
        )
        .unwrap();
        run_batch(
            &endpoint,
            format!("get {} {}\nbye\n", path(&stage), path(&snapshot)),
            &operation,
        )
        .unwrap();
        assert_eq!(
            hash_file(&snapshot, None).unwrap(),
            hash_file(&source, None).unwrap()
        );
        assert_eq!(
            resumed.event.lock().unwrap().transferred_bytes,
            payload.len() as u64
        );
    }
}

#[cfg(test)]
#[path = "ssh_sftp_domain_tests.rs"]
mod domain_tests;
