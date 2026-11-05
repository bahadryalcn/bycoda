//! Cross-volume moves retain their original-volume recovery copy because external
//! writers cannot be proven closed by the workspace process.
use std::{fs, io::{self, Read, Write}, path::{Path, PathBuf}};
use sha2::{Digest, Sha256};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRecovery {
    pub path: String,
    pub recovery_path: String,
    pub receipt_path: String,
    pub warning: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct Entry {
    path: PathBuf,
    kind: u8,
    size: u64,
    modified: Option<std::time::SystemTime>,
    identity: String,
    content: Vec<u8>,
}

fn identity(meta: &fs::Metadata) -> String {
    #[cfg(unix)]
    { use std::os::unix::fs::MetadataExt; format!("{}:{}:{}:{}:{}:{}", meta.dev(), meta.ino(), meta.mode(), meta.ctime(), meta.ctime_nsec(), meta.len()) }
    #[cfg(windows)]
    { use std::os::windows::fs::MetadataExt; format!("{}:{}:{}", meta.file_attributes(), meta.last_write_time(), meta.file_size()) }
    #[cfg(not(any(unix, windows)))]
    { format!("{:?}:{}", meta.modified(), meta.len()) }
}

fn scan(root: &Path) -> io::Result<Vec<Entry>> {
    fn visit(root: &Path, relative: &Path, entries: &mut Vec<Entry>) -> io::Result<()> {
        let path = root.join(relative);
        let before = fs::symlink_metadata(&path)?;
        let kind = before.file_type();
        let (tag, content) = if kind.is_symlink() {
            let target = fs::read_link(&path)?;
            #[cfg(unix)]
            let bytes = { use std::os::unix::ffi::OsStrExt; target.as_os_str().as_bytes().to_vec() };
            #[cfg(windows)]
            let bytes = { use std::os::windows::ffi::OsStrExt; target.as_os_str().encode_wide().flat_map(u16::to_le_bytes).collect() };
            #[cfg(not(any(unix, windows)))]
            let bytes = return Err(io::Error::new(io::ErrorKind::Unsupported, "Unsupported symlink platform"));
            (2, bytes)
        } else if kind.is_file() {
            let mut file = fs::File::open(&path)?;
            if identity(&file.metadata()?) != identity(&before) { return Err(io::Error::other("Source replaced while opening")); }
            let mut digest = Sha256::new();
            let mut buffer = [0; 65536];
            loop { let n = file.read(&mut buffer)?; if n == 0 { break; } digest.update(&buffer[..n]); }
            if identity(&file.metadata()?) != identity(&before) { return Err(io::Error::other("Source changed while reading")); }
            (1, digest.finalize().to_vec())
        } else if kind.is_dir() {
            let mut children = fs::read_dir(&path)?.map(|item| item.map(|entry| entry.file_name())).collect::<io::Result<Vec<_>>>()?;
            children.sort();
            for child in children { visit(root, &relative.join(child), entries)?; }
            (0, Vec::new())
        } else { return Err(io::Error::new(io::ErrorKind::Unsupported, "Special files cannot be moved across volumes")); };
        let after = fs::symlink_metadata(&path)?;
        if identity(&before) != identity(&after) || before.modified().ok() != after.modified().ok() {
            return Err(io::Error::other("Source changed during cross-volume move"));
        }
        entries.push(Entry { path: relative.to_path_buf(), kind: tag, size: before.len(), modified: before.modified().ok(), identity: identity(&before), content });
        Ok(())
    }
    let mut entries = Vec::new();
    visit(root, Path::new(""), &mut entries)?;
    Ok(entries)
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(from)?;
        #[cfg(unix)] std::os::unix::fs::symlink(target, to)?;
        #[cfg(windows)] {
            use std::os::windows::fs::{symlink_dir, symlink_file, FileTypeExt};
            if meta.file_type().is_symlink_dir() { symlink_dir(target, to)?; } else { symlink_file(target, to)?; }
        }
    } else if meta.is_dir() {
        fs::create_dir(to)?;
        for child in fs::read_dir(from)? { let child = child?; copy_tree(&child.path(), &to.join(child.file_name()))?; }
        #[cfg(unix)]
        if let Ok(modified) = meta.modified() { fs::File::open(to)?.set_times(fs::FileTimes::new().set_modified(modified))?; }
        fs::set_permissions(to, meta.permissions())?;
    } else if meta.is_file() {
        let mut src = fs::File::open(from)?;
        if identity(&src.metadata()?) != identity(&meta) { return Err(io::Error::other("Source replaced while opening")); }
        let mut dst = fs::OpenOptions::new().write(true).create_new(true).open(to)?;
        io::copy(&mut src, &mut dst)?;
        dst.set_permissions(meta.permissions())?;
        if let Ok(modified) = meta.modified() { dst.set_times(fs::FileTimes::new().set_modified(modified))?; }
        dst.sync_all()?;
    } else { return Err(io::Error::new(io::ErrorKind::Unsupported, "Special files cannot be moved across volumes")); }
    Ok(())
}

pub(super) fn move_across_volumes(source: &Path, destination: &Path) -> Result<MoveRecovery, String> {
    let original = scan(source).map_err(|e| e.to_string())?;
    let id = Uuid::new_v4();
    let recovery_dir = source.parent().ok_or("Source has no parent")?.join(format!(".bycoda-move-recovery-{id}"));
    let stage_dir = destination.parent().ok_or("Destination has no parent")?.join(format!(".bycoda-move-stage-{id}"));
    fs::create_dir(&recovery_dir).map_err(|e| e.to_string())?;
    let recovery = recovery_dir.join("source");
    let receipt = recovery_dir.join("receipt.json");
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&receipt).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &serde_json::json!({"version":1,"source":source,"destination":destination,"recovery":recovery,"stage":stage_dir})).map_err(|e| e.to_string())?;
    file.flush().and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    bycoda_physical_store_admission::rename_no_replace(source, &recovery).map_err(|e| e.to_string())?;
    let operation = (|| -> io::Result<()> {
        let quarantined = scan(&recovery)?;
        if quarantined.len() != original.len() || original.iter().zip(&quarantined).any(|(a,b)| {
            if a.path.as_os_str().is_empty() {
                a.kind != b.kind || a.size != b.size || a.modified != b.modified || a.content != b.content || a.identity.split(':').take(2).ne(b.identity.split(':').take(2))
            } else { a != b }
        }) { return Err(io::Error::other("Source changed before quarantine")); }
        fs::create_dir(&stage_dir)?;
        let staged = stage_dir.join("entry");
        copy_tree(&recovery, &staged)?;
        if scan(&recovery)? != quarantined { return Err(io::Error::other("Source changed during copy")); }
        let copied = scan(&staged)?;
        if copied.len() != original.len() || copied.iter().zip(&original).any(|(a,b)| a.path != b.path || a.kind != b.kind || a.content != b.content || (a.kind == 1 && a.size != b.size)) {
            return Err(io::Error::other("Staged copy does not match source"));
        }
        bycoda_physical_store_admission::rename_no_replace(&staged, destination)?;
        Ok(())
    })();
    if let Err(error) = operation {
        let restored = bycoda_physical_store_admission::rename_no_replace(&recovery, source).is_ok();
        return Err(format!("Cross-volume move failed: {error}. {} Receipt: {}", if restored { "Source restored.".to_string() } else { format!("Source retained at {}.", recovery.display()) }, receipt.display()));
    }
    Ok(MoveRecovery { path: destination.to_string_lossy().into_owned(), recovery_path: recovery.to_string_lossy().into_owned(), receipt_path: receipt.to_string_lossy().into_owned(), warning: None })
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum MoveOutcome {
    Path(String),
    Recovery(MoveRecovery),
}

pub(super) fn move_path_outcome(from: &str, dest_parent: &str) -> Result<MoveOutcome, String> {
    let from = super::expand_home(from);
    if !from.exists() { return Err(format!("{}: No such file or directory", from.display())); }
    let parent = super::expand_home(dest_parent);
    if !parent.is_dir() { return Err(format!("{} is not a folder", parent.display())); }
    if from.is_dir() && super::dir_contains(&from, &parent) { return Err("Cannot paste a folder into itself.".into()); }
    let name = super::file_label(&from, from.to_str().unwrap_or("item"));
    let destination = parent.join(&name);
    if super::same_entry(&from, &destination) { return Ok(MoveOutcome::Path(from.to_string_lossy().into_owned())); }
    if fs::symlink_metadata(&destination).is_ok() { return Err(super::already_exists(&name)); }
    // ast-grep-ignore: rust-rename-without-fsync -- this moves the existing source entry rather than publishing temporary-file contents
    match fs::rename(&from, &destination) {
        Ok(()) => Ok(MoveOutcome::Path(destination.to_string_lossy().into_owned())),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {
            bycoda_physical_store_admission::guarded_move_paths::move_paths(&from, &destination)
                .map(|result| MoveOutcome::Recovery(MoveRecovery {
                    path: result.path.to_string_lossy().into_owned(),
                    recovery_path: result.recovery_path.to_string_lossy().into_owned(),
                    receipt_path: result.receipt_path.to_string_lossy().into_owned(),
                    warning: result.warning,
                })).map_err(|error| error.to_string())
        },
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
pub(super) fn move_path_sync(from: &str, parent: &str) -> Result<String, String> {
    match move_path_outcome(from, parent)? {
        MoveOutcome::Path(path) => Ok(path),
        MoveOutcome::Recovery(result) => Ok(result.path),
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_recovery_and_receipt_for_a_copied_tree() {
        let root = std::env::temp_dir().join(format!("bycoda-cross-move-{}", Uuid::new_v4()));
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("item"), b"contents").unwrap();
        let result = move_across_volumes(&source, &destination).unwrap();
        assert_eq!(fs::read(destination.join("item")).unwrap(), b"contents");
        assert_eq!(fs::read(Path::new(&result.recovery_path).join("item")).unwrap(), b"contents");
        assert!(Path::new(&result.receipt_path).is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn occupied_destination_is_not_overwritten_and_source_is_restored() {
        let root = std::env::temp_dir().join(format!("bycoda-cross-move-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("source");
        let destination = root.join("destination");
        fs::write(&source, b"source").unwrap();
        fs::write(&destination, b"occupied").unwrap();
        assert!(move_across_volumes(&source, &destination).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"source");
        assert_eq!(fs::read(&destination).unwrap(), b"occupied");
        fs::remove_dir_all(root).unwrap();
    }
}
