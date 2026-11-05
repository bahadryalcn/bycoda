//! Move protocol over already-authorized, held directory handles. The caller
//! creates private, exclusive recovery/staging directories and supplies their
//! held handles; this module never deletes the quarantined source.
use std::{ffi::OsStr, fmt, io::{self, Write}};
use cap_std::fs::{Dir, OpenOptions};
use cap_fs_ext::MetadataExt;
use crate::{guarded_metadata::child_metadata, guarded_copy::copy_child_no_follow, guarded_snapshot::{snapshot_child, SnapshotEntry}, rename_no_replace_at::rename_no_replace_at};

#[derive(Debug)]
pub struct MoveFailure {
    pub message: String,
    pub quarantined: bool,
    pub source_restored: bool,
    pub published: bool,
}
impl fmt::Display for MoveFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}", self.message) }
}
impl std::error::Error for MoveFailure {}

/// Flush a directory's entries to disk. Directories opened for capability
/// lookup are O_PATH on Linux and cannot be fsynced, so reopen `.` for reading.
#[cfg(unix)]
pub(crate) fn sync_dir(dir: &Dir) -> io::Result<()> {
    dir.open(".")?.sync_all()
}

fn same_copy(source: &[SnapshotEntry], copy: &[SnapshotEntry]) -> bool {
    source.len() == copy.len() && source.iter().zip(copy).all(|(a, b)| {
        let same = a.path == b.path && a.kind == b.kind && a.data == b.data && a.modified == b.modified && (a.kind == 2 || a.permissions == b.permissions) && (a.kind != 1 || a.size == b.size);
        #[cfg(windows)] { same && a.security == b.security }
        #[cfg(not(windows))] { same }
    })
}

/// On success the original source remains in recovery under `source`. On error,
/// inspect the returned phase and retain both private directories and receipt.
/// Receipt bytes must identify original, stage, recovery and destination paths.
// Each argument is a distinct held handle, name or proof; grouping them would
// only rename the same eight inputs at both call sites.
#[allow(clippy::too_many_arguments)]
pub fn move_with_recovery(
    source: &Dir, source_name: &OsStr,
    destination: &Dir, destination_name: &OsStr,
    recovery: &Dir, stage: &Dir, receipt: &[u8],
    check_admission: &impl Fn() -> io::Result<()>,
) -> Result<(), MoveFailure> {
    let mut quarantined = false;
    let mut published = false;
    let mut restored = false;
    let mut recovery_identity: Option<(u64, u64)> = None;
    let mut journal: Option<std::fs::File> = None;
    let operation = (|| -> io::Result<()> {
        let original = snapshot_child(source, source_name)?;
        let root = original.last().ok_or_else(|| io::Error::other("Missing source snapshot"))?;
        if root.device == 0 && root.inode == 0 { return Err(io::Error::new(io::ErrorKind::Unsupported, "Source identity unavailable")); }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut record = recovery.open_with("receipt.json", &options)?.into_std();
        record.write_all(receipt)?;
        record.sync_all()?;
        let mut log_options = OpenOptions::new();
        log_options.write(true).create_new(true);
        let mut log = recovery.open_with("phases.jsonl", &log_options)?.into_std();
        log.write_all(b"{\"phase\":\"quarantine-intent\"}\n")?;
        log.sync_all()?;
        journal = Some(log);
        #[cfg(unix)] sync_dir(recovery)?;
        check_admission()?;
        // Build and validate the private copy before moving the source. Unsupported
        // ACLs, streams or attributes therefore fail without retiring it.
        copy_child_no_follow(source, source_name, stage, OsStr::new("entry"))?;
        if original != snapshot_child(source, source_name)? {
            return Err(io::Error::other("Source changed during copy"));
        }
        #[cfg(unix)] sync_dir(stage)?;
        let staged = snapshot_child(stage, OsStr::new("entry"))?;
        if !same_copy(&original, &staged) { return Err(io::Error::other("Staged copy differs from source")); }
        check_admission()?;
        rename_no_replace_at(source, source_name, recovery, OsStr::new("source"))?;
        quarantined = true;
        if let Some(log) = journal.as_mut() { log.write_all(b"{\"phase\":\"quarantined\"}\n")?; log.sync_all()?; }
        #[cfg(unix)] {
            sync_dir(recovery)?;
            sync_dir(source)?;
        }
        let captured = child_metadata(recovery, OsStr::new("source"))?;
        recovery_identity = Some((captured.dev(), captured.ino()));
        if root.device != captured.dev() || root.inode != captured.ino() {
            return Err(io::Error::other("Source identity changed before quarantine"));
        }
        if original != snapshot_child(recovery, OsStr::new("source"))? {
            return Err(io::Error::other("Source changed before quarantine"));
        }
        let staged_root = staged.last().ok_or_else(|| io::Error::other("Missing staged snapshot"))?;
        if let Some(log) = journal.as_mut() { log.write_all(b"{\"phase\":\"publish-intent\"}\n")?; log.sync_all()?; }
        check_admission()?;
        rename_no_replace_at(stage, OsStr::new("entry"), destination, destination_name)?;
        published = true;
        if let Some(log) = journal.as_mut() { log.write_all(b"{\"phase\":\"published\"}\n")?; log.sync_all()?; }
        let target = child_metadata(destination, destination_name)?;
        if staged_root.device != target.dev() || staged_root.inode != target.ino() {
            return Err(io::Error::other("Published destination identity changed"));
        }
        check_admission()?;
        #[cfg(unix)] sync_dir(destination)?;
        Ok(())
    })();
    if let Err(error) = operation {
        // Only rename the entry we quarantined, and never replace a new source.
        // A failed restore leaves recovery untouched and its receipt authoritative.
        if quarantined && !published {
            let same_entry = child_metadata(recovery, OsStr::new("source")).ok().is_some_and(|entry| recovery_identity == Some((entry.dev(), entry.ino())));
            if same_entry && check_admission().is_ok() { restored = rename_no_replace_at(recovery, OsStr::new("source"), source, source_name).is_ok(); }
            if restored { if let Some(log) = journal.as_mut() { let _ = log.write_all(b"{\"phase\":\"restored\"}\n").and_then(|_| log.sync_all()); } }
        }
        return Err(MoveFailure { message: error.to_string(), quarantined, source_restored: restored, published });
    }
    Ok(())
}
