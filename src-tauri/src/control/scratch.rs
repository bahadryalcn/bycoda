use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

const RETIRED_PREFIX: &str = "bycoda-retired-";
// Newer quarantines may still belong to a retirement running in another instance.
const RETIRED_MIN_AGE: Duration = Duration::from_secs(60 * 60);

#[cfg(unix)]
fn identity(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("scratch directory changed".into());
    }
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}
#[cfg(windows)]
fn identity(path: &Path) -> Result<String, String> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("scratch directory changed".into());
    }
    Ok(format!(
        "{}:{}:{}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    ))
}
#[cfg(not(any(unix, windows)))]
fn identity(_: &Path) -> Result<String, String> {
    Err("scratch identity unavailable".into())
}

pub(super) struct Scratch {
    path: PathBuf,
    root: PathBuf,
    identity: String,
}
impl Scratch {
    pub(super) fn capture(path: PathBuf) -> Result<Arc<Self>, String> {
        let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
        if !path.starts_with(&root)
            || path == root
            || !path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("bycoda-worker-"))
        {
            return Err("scratch root changed".into());
        }
        let identity = identity(&path)?;
        Ok(Arc::new(Self {
            path,
            root,
            identity,
        }))
    }
    pub(super) fn path(&self) -> &Path {
        &self.path
    }
    fn cleanup(&self) -> Result<(), String> {
        self.cleanup_with(|path| std::fs::remove_dir_all(path))
    }
    fn cleanup_with(
        &self,
        remove: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), String> {
        if std::fs::canonicalize(&self.root).map_err(|e| e.to_string())? != self.root
            || std::fs::canonicalize(&self.path).map_err(|e| e.to_string())? != self.path
            || identity(&self.path)? != self.identity
        {
            return Err("scratch identity changed".into());
        }
        let quarantine = self
            .root
            .join(format!("bycoda-retired-{}", uuid::Uuid::new_v4()));
        bycoda_physical_store_admission::rename_no_replace(&self.path, &quarantine)
            .map_err(|e| e.to_string())?;
        if identity(&quarantine).ok().as_ref() != Some(&self.identity) {
            return Err(format!(
                "scratch identity changed during retirement; directory retained at {}",
                quarantine.display()
            ));
        }
        remove(&quarantine)
            .map_err(|e| format!("scratch retained at {}: {e}", quarantine.display()))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let path = self.path.clone();
        let root = self.root.clone();
        let identity = self.identity.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("scratch-retirement".into())
            .spawn(move || {
                let record = Self {
                    path,
                    root,
                    identity,
                };
                if let Err(error) = record.cleanup() {
                    log::warn!("scratch retirement: {error}");
                }
                std::mem::forget(record);
            })
        {
            log::warn!("scratch retirement worker unavailable: {error}");
        }
    }
}

pub(crate) struct ProcessScratch {
    scratch: Option<Arc<Scratch>>,
    settled: bool,
}
impl ProcessScratch {
    pub(super) fn new(scratch: Arc<Scratch>) -> Self {
        Self {
            scratch: Some(scratch),
            settled: true,
        }
    }
    pub(crate) fn started(&mut self) {
        self.settled = false;
    }
    pub(crate) fn settled(&mut self) {
        self.settled = true;
    }
}
impl Drop for ProcessScratch {
    fn drop(&mut self) {
        if !self.settled {
            if let Some(scratch) = self.scratch.take() {
                std::mem::forget(scratch);
            }
        }
    }
}

pub(super) fn start_retired_sweep() {
    let spawned = std::thread::Builder::new()
        .name("scratch-sweep".into())
        .spawn(|| {
            let removed = sweep_retired(&std::env::temp_dir(), SystemTime::now());
            if removed > 0 {
                log::info!("removed {removed} retired scratch directories");
            }
        });
    if let Err(error) = spawned {
        log::warn!("scratch sweep unavailable: {error}");
    }
}

// Only exact `bycoda-retired-<uuid>` plain directories are candidates. Worker
// scratch is never swept: nothing records which live process owns it.
fn sweep_retired(root: &Path, now: SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_prefix(RETIRED_PREFIX)) else {
            continue;
        };
        if uuid::Uuid::parse_str(id).is_err() {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        let old_enough = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= RETIRED_MIN_AGE);
        if !old_enough || !is_plain_dir(&metadata) {
            continue;
        }
        // A failed removal stays on disk and is retried by the next startup sweep.
        match std::fs::remove_dir_all(&path) {
            Ok(()) => removed += 1,
            Err(error) => log::warn!("retired scratch retained at {}: {error}", path.display()),
        }
    }
    removed
}

fn is_plain_dir(metadata: &std::fs::Metadata) -> bool {
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, Arc<Scratch>) {
        let path = std::env::temp_dir().join(format!("bycoda-worker-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let scratch = Scratch::capture(path.clone()).unwrap();
        (path, scratch)
    }
    #[test]
    fn live_warm_and_copied_claims_hold_retired_scratch() {
        let (path, scratch) = fixture();
        let mut process = ProcessScratch::new(scratch.clone());
        process.started();
        let other = scratch.clone();
        drop(scratch);
        assert!(path.exists());
        process.settled();
        drop(process);
        assert!(path.exists());
        assert!(other.cleanup().is_ok());
        assert!(!path.exists());
        std::mem::forget(other);
    }
    #[test]
    fn replacement_and_failed_removal_preserve_data() {
        let (path, scratch) = fixture();
        let moved = path.with_extension("original");
        // ast-grep-ignore: rust-rename-without-fsync -- fixture moves a directory to simulate identity replacement, not state-file persistence
        std::fs::rename(&path, &moved).unwrap();
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("user-data"), b"keep").unwrap();
        assert!(scratch.cleanup().is_err());
        assert_eq!(std::fs::read(path.join("user-data")).unwrap(), b"keep");
        std::mem::forget(scratch);
        std::fs::remove_dir_all(path).unwrap();
        std::fs::remove_dir_all(moved).unwrap();
    }

    #[test]
    fn failed_unlink_retains_quarantined_original() {
        let (path, scratch) = fixture();
        std::fs::write(path.join("recovery"), b"keep").unwrap();
        let mut retained = PathBuf::new();
        assert!(scratch
            .cleanup_with(|target| {
                retained = target.to_owned();
                Err(std::io::Error::other("injected failure"))
            })
            .is_err());
        assert_eq!(std::fs::read(retained.join("recovery")).unwrap(), b"keep");
        std::mem::forget(scratch);
        std::fs::remove_dir_all(retained).unwrap();
    }
    #[test]
    fn sweep_reclaims_only_old_plain_retired_directories() {
        let root = std::env::temp_dir().join(format!("bycoda-sweep-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let retired = root.join(format!("bycoda-retired-{}", uuid::Uuid::new_v4()));
        let worker = root.join(format!("bycoda-worker-{}", uuid::Uuid::new_v4()));
        let not_uuid = root.join("bycoda-retired-not-a-uuid");
        let file = root.join(format!("bycoda-retired-{}", uuid::Uuid::new_v4()));
        for dir in [&retired, &worker, &not_uuid] {
            std::fs::create_dir(dir).unwrap();
        }
        std::fs::write(&file, b"keep").unwrap();
        let later = SystemTime::now() + RETIRED_MIN_AGE * 2;
        assert_eq!(sweep_retired(&root, later), 1);
        assert!(!retired.exists());
        assert!(worker.exists());
        assert!(not_uuid.exists());
        assert!(file.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sweep_preserves_recent_retired_directories() {
        let root = std::env::temp_dir().join(format!("bycoda-sweep-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let retired = root.join(format!("bycoda-retired-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&retired).unwrap();
        assert_eq!(sweep_retired(&root, SystemTime::now()), 0);
        assert!(retired.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unconfirmed_exit_retains_original_claim() {
        let (path, scratch) = fixture();
        let mut process = ProcessScratch::new(scratch.clone());
        process.started();
        drop(process);
        drop(scratch);
        assert!(path.exists());
        std::fs::remove_dir_all(path).unwrap();
    }
}
