//! Handle-relative, byte-preserving snapshots for move revalidation.
use crate::guarded_metadata::child_metadata;
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    io::{self, Read},
    path::{Path, PathBuf},
};

#[derive(Debug, PartialEq, Eq)]
pub struct SnapshotEntry {
    pub path: PathBuf,
    pub kind: u8,
    pub device: u64,
    pub inode: u64,
    pub size: u64,
    pub modified: Option<cap_std::time::SystemTime>,
    pub permissions: cap_std::fs::Permissions,
    #[cfg(windows)]
    pub security: Vec<u8>,
    pub data: Vec<u8>,
}

pub fn snapshot_child(parent: &Dir, name: &OsStr) -> io::Result<Vec<SnapshotEntry>> {
    fn visit(
        parent: &Dir,
        name: &OsStr,
        path: &Path,
        entries: &mut Vec<SnapshotEntry>,
    ) -> io::Result<()> {
        let before = child_metadata(parent, name)?;
        let kind = before.file_type();
        #[cfg(windows)]
        let security: Vec<u8>;
        let (tag, data) = if kind.is_symlink() {
            #[cfg(windows)]
            {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "Windows symbolic-link ACLs cannot yet be preserved",
                ));
            }
            #[cfg(not(windows))]
            {
                let target = parent.read_link_contents(name)?;
                #[cfg(unix)]
                let data = {
                    use std::os::unix::ffi::OsStrExt;
                    target.as_os_str().as_bytes().to_vec()
                };
                #[cfg(not(unix))]
                let data = return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "Unsupported platform",
                ));
                (2, data)
            }
        } else if kind.is_dir() {
            let dir = parent.open_dir_nofollow(name)?;
            let opened = dir.dir_metadata()?;
            #[cfg(windows)]
            {
                let handle = dir.try_clone()?.into_std_file();
                crate::windows_copy_preflight::reject_unpreserved_attributes(&handle)?;
                security = crate::windows_copy_preflight::security(&handle)?;
            }
            if before.dev() != opened.dev() || before.ino() != opened.ino() {
                return Err(io::Error::other("Source directory replaced"));
            }
            let mut children = dir
                .entries()?
                .map(|e| e.map(|v| v.file_name()))
                .collect::<io::Result<Vec<_>>>()?;
            children.sort();
            for child in children {
                visit(&dir, &child, &path.join(&child), entries)?;
            }
            (0, Vec::new())
        } else if kind.is_file() {
            let mut options = OpenOptions::new();
            options.read(true).follow(FollowSymlinks::No);
            #[cfg(windows)]
            {
                use cap_primitives::fs::OpenOptionsExt;
                options.share_mode(0x0000_0001 | 0x0000_0002);
            }
            let mut file = parent.open_with(name, &options)?;
            let opened = file.metadata()?;
            #[cfg(windows)]
            {
                let handle = file.try_clone()?.into_std();
                crate::windows_copy_preflight::reject_unpreserved_attributes(&handle)?;
                security = crate::windows_copy_preflight::security(&handle)?;
            }
            if before.dev() != opened.dev() || before.ino() != opened.ino() {
                return Err(io::Error::other("Source file replaced"));
            }
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            let after = file.metadata()?;
            if opened.len() != after.len() || opened.modified().ok() != after.modified().ok() {
                return Err(io::Error::other("Source file changed"));
            }
            (1, hash.finalize().to_vec())
        } else {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Special files are not supported",
            ));
        };
        let after = child_metadata(parent, name)?;
        if before.dev() != after.dev()
            || before.ino() != after.ino()
            || before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
        {
            return Err(io::Error::other("Source entry changed"));
        }
        entries.push(SnapshotEntry {
            path: path.to_path_buf(),
            kind: tag,
            device: before.dev(),
            inode: before.ino(),
            size: before.len(),
            modified: before.modified().ok(),
            permissions: before.permissions(),
            #[cfg(windows)]
            security,
            data,
        });
        Ok(())
    }
    let mut entries = Vec::new();
    visit(parent, name, Path::new(""), &mut entries)?;
    Ok(entries)
}
