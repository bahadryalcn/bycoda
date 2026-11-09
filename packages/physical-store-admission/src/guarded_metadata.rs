use cap_std::fs::{Dir, Metadata};
use std::{ffi::OsStr, io};

#[cfg(not(windows))]
pub(crate) fn child_metadata(parent: &Dir, name: &OsStr) -> io::Result<Metadata> {
    parent.symlink_metadata(name)
}

#[cfg(windows)]
pub(crate) fn child_metadata(parent: &Dir, name: &OsStr) -> io::Result<Metadata> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsMaybeDirExt};
    use cap_primitives::fs::OpenOptionsExt;
    use cap_std::fs::OpenOptions;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
    if parent.symlink_metadata(name)?.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Windows symbolic-link ACLs cannot yet be preserved",
        ));
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .maybe_dir(true)
        .follow(FollowSymlinks::No);
    options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
    parent.open_with(name, &options)?.metadata()
}
