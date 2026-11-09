use crate::{Error, PhysicalFileId};
use std::{
    fs::{File, OpenOptions},
    path::Path,
};

pub(super) fn file_identity(file: &File) -> Result<(PhysicalFileId, u64), Error> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
            BY_HANDLE_FILE_INFORMATION, FILE_ID_INFO,
        };
        let mut links: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        let mut identity: FILE_ID_INFO = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut links) } == 0
            || unsafe {
                GetFileInformationByHandleEx(
                    file.as_raw_handle() as _,
                    FileIdInfo,
                    &mut identity as *mut _ as _,
                    std::mem::size_of::<FILE_ID_INFO>() as u32,
                )
            } == 0
        {
            return Err(Error::io(
                "read physical Windows file identity",
                std::io::Error::last_os_error(),
            ));
        }
        let id = identity
            .FileId
            .Identifier
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        Ok((
            PhysicalFileId {
                native: format!("windows-file:{:016x}:{id}", identity.VolumeSerialNumber),
                namespace: format!("w-{:016x}-{id}", identity.VolumeSerialNumber),
            },
            links.nNumberOfLinks as u64,
        ))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file
            .metadata()
            .map_err(|error| Error::io("read physical Unix file identity", error))?;
        Ok((
            PhysicalFileId {
                native: format!("unix-file:{}:{}", metadata.dev(), metadata.ino()),
                namespace: format!("u-{:016x}-{:016x}", metadata.dev(), metadata.ino()),
            },
            metadata.nlink(),
        ))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = file;
        Err(Error::Unsupported("physical file identity"))
    }
}

fn reject_link(metadata: &std::fs::Metadata) -> Result<(), Error> {
    if metadata.file_type().is_symlink() {
        return Err(Error::Unsafe("symbolic link"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(Error::Unsafe("reparse point"));
        }
    }
    Ok(())
}

fn check_private(metadata: &std::fs::Metadata) -> Result<(), Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
            return Err(Error::Unsafe(
                "registry files must be owned privately by the effective user",
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = metadata;
    Ok(())
}

pub(super) fn create_directory(path: &Path) -> Result<bool, Error> {
    #[cfg(not(any(windows, unix)))]
    return Err(Error::Unsupported("protected coordination directories"));
    let builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    match builder.create(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(Error::io("create registry directory", error)),
    }
}

pub(super) fn open_directory(path: &Path) -> Result<File, Error> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| Error::io("read registry directory metadata", error))?;
    reject_link(&metadata)?;
    if !metadata.is_dir() {
        return Err(Error::Unsafe("registry path is not a directory"));
    }
    check_private(&metadata)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
            FILE_SHARE_WRITE,
        };
        options
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options
        .open(path)
        .map_err(|error| Error::io("open protected registry directory", error))?;
    let held = file
        .metadata()
        .map_err(|error| Error::io("read held registry directory", error))?;
    reject_link(&held)?;
    check_private(&held)?;
    if !held.is_dir() {
        return Err(Error::Unsafe("held registry path is not a directory"));
    }
    Ok(file)
}

pub(super) fn check_sidecar(file: &File) -> Result<(), Error> {
    let metadata = file
        .metadata()
        .map_err(|error| Error::io("read held lock sidecar", error))?;
    reject_link(&metadata)?;
    check_private(&metadata)?;
    if !metadata.is_file() || file_identity(file)?.1 != 1 {
        return Err(Error::Unsafe(
            "lock sidecar must have one regular-file link",
        ));
    }
    if metadata.len() != 0 {
        return Err(Error::Unsafe("lock sidecar contains data"));
    }
    Ok(())
}

/// Same non-truncating/no-follow/reparse/single-link rules as Native safe_file.
pub(super) fn safe_file(path: &Path, fresh: bool) -> Result<File, Error> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            reject_link(&metadata)?;
            if !metadata.is_file() {
                return Err(Error::Unsafe("lock sidecar is not a regular file"));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && fresh => {}
        Err(error) => {
            return Err(Error::io(
                "read lock sidecar metadata (existing namespaces are not repaired)",
                error,
            ))
        }
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create_new(fresh)
        .truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        options
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let file = options
        .open(path)
        .map_err(|error| Error::io("open protected lock sidecar", error))?;
    check_sidecar(&file)?;
    Ok(file)
}
