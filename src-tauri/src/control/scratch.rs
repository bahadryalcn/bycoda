use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(unix)]
fn identity(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() { return Err("scratch directory changed".into()); }
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}
#[cfg(windows)]
fn identity(path: &Path) -> Result<String, String> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ATTRIBUTE_REPARSE_POINT};
    let file = std::fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(path).map_err(|e| e.to_string())?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 { return Err("scratch directory changed".into()); }
    Ok(format!("{}:{}:{}", info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow))
}
#[cfg(not(any(unix, windows)))]
fn identity(_: &Path) -> Result<String, String> { Err("scratch identity unavailable".into()) }

pub(super) struct Scratch {
    path: PathBuf,
    root: PathBuf,
    identity: String,
}
impl Scratch {
    pub(super) fn capture(path: PathBuf) -> Result<Arc<Self>, String> {
        let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
        if !path.starts_with(&root) || path == root || !path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("bycoda-worker-")) { return Err("scratch root changed".into()); }
        let identity = identity(&path)?;
        Ok(Arc::new(Self { path, root, identity }))
    }
    pub(super) fn path(&self) -> &Path { &self.path }
    fn cleanup(&self) -> Result<(), String> {
        self.cleanup_with(|path| std::fs::remove_dir_all(path))
    }
    fn cleanup_with(&self, remove: impl FnOnce(&Path) -> std::io::Result<()>) -> Result<(), String> {
        if std::fs::canonicalize(&self.root).map_err(|e| e.to_string())? != self.root || std::fs::canonicalize(&self.path).map_err(|e| e.to_string())? != self.path || identity(&self.path)? != self.identity { return Err("scratch identity changed".into()); }
        let quarantine = self.root.join(format!("bycoda-retired-{}", uuid::Uuid::new_v4()));
        std::fs::rename(&self.path, &quarantine).map_err(|e| e.to_string())?;
        if identity(&quarantine).ok().as_ref() != Some(&self.identity) {
            let _ = std::fs::rename(&quarantine, &self.path);
            return Err("scratch identity changed during retirement".into());
        }
        remove(&quarantine).map_err(|e| format!("scratch retained at {}: {e}", quarantine.display()))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let path = self.path.clone();
        let root = self.root.clone();
        let identity = self.identity.clone();
        if let Err(error) = std::thread::Builder::new().name("scratch-retirement".into()).spawn(move || {
            let record = Self { path, root, identity };
            if let Err(error) = record.cleanup() { eprintln!("[control] scratch retirement: {error}"); }
            std::mem::forget(record);
        }) {
            eprintln!("[control] scratch retirement worker unavailable: {error}");
        }
    }
}

pub(crate) struct ProcessScratch { scratch: Option<Arc<Scratch>>, settled: bool }
impl ProcessScratch {
    pub(super) fn new(scratch: Arc<Scratch>) -> Self { Self { scratch: Some(scratch), settled: true } }
    pub(crate) fn started(&mut self) { self.settled = false; }
    pub(crate) fn settled(&mut self) { self.settled = true; }
}
impl Drop for ProcessScratch {
    fn drop(&mut self) {
        if !self.settled { if let Some(scratch) = self.scratch.take() { std::mem::forget(scratch); } }
    }
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
        assert!(scratch.cleanup_with(|target| {
            retained = target.to_owned();
            Err(std::io::Error::other("injected failure"))
        }).is_err());
        assert_eq!(std::fs::read(retained.join("recovery")).unwrap(), b"keep");
        std::mem::forget(scratch);
        std::fs::remove_dir_all(retained).unwrap();
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
