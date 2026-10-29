use std::{fs::File, path::Path};

pub(super) fn registry_directory(path: &Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("Native writer registry directory is unavailable".into()),
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "Native writer registry metadata is unavailable")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Native writer registry cannot be a link or non-directory".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Native writer registry cannot be a reparse point".into());
        }
    }
    Ok(())
}

pub(super) fn process_start() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::FILETIME,
            System::Threading::{GetCurrentProcess, GetProcessTimes},
        };
        let mut created: FILETIME = unsafe { std::mem::zeroed() };
        let mut exited = created;
        let mut kernel = created;
        let mut user = created;
        if unsafe {
            GetProcessTimes(
                GetCurrentProcess(),
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        } == 0
        {
            return Err("Native writer process creation identity is unavailable".into());
        }
        let ticks = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
        Ok(Some(format!("windows-filetime:{ticks}")))
    }
    #[cfg(target_os = "linux")]
    {
        // /proc is native kernel metadata. Missing namespaces/proc support is
        // explicitly unknown; wall clock/renderer values are never substitutes.
        let identity = (|| {
            let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
            let fields = stat.get(stat.rfind(')')? + 2..)?;
            let ticks = fields.split_whitespace().nth(19)?.parse::<u64>().ok()?;
            let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
            let boot = boot.trim();
            uuid::Uuid::parse_str(boot).ok()?;
            Some(format!("linux-start:{boot}:{ticks}"))
        })();
        Ok(identity)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Ok(None)
    }
}

pub(super) fn file_identity(file: &File) -> Result<(String, u64), String> {
    let (identity, links) = bycoda_physical_store_admission::PhysicalFileId::inspect(file)
        .map_err(|_| "Native writer physical file identity is unavailable".to_owned())?;
    Ok((identity.native_format().to_owned(), links))
}

#[cfg(windows)]
pub(super) fn connection_identity(
    connection: &rusqlite::Connection,
) -> Result<(String, u64), String> {
    use std::os::windows::io::BorrowedHandle;
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;

    let mut handle = std::ptr::null_mut::<std::ffi::c_void>();
    // SAFETY: the connection is borrowed for this synchronous call. SQLite writes
    // its main database's own HANDLE to an initialized pointer-sized output.
    // The standard Windows VFS file-control operation performs no SQL mutation.
    let status = unsafe {
        rusqlite::ffi::sqlite3_file_control(
            connection.handle(),
            c"main".as_ptr(),
            rusqlite::ffi::SQLITE_FCNTL_WIN32_GET_HANDLE,
            (&mut handle as *mut *mut std::ffi::c_void).cast(),
        )
    };
    if status != rusqlite::ffi::SQLITE_OK || handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err("Native writer SQLite connection handle identity is unavailable".into());
    }
    // SAFETY: the successful VFS result is SQLite-owned and remains valid while
    // this borrowed connection is alive. Duplicate it; never take ownership of
    // or close the original SQLite handle, nor carry that borrow across an await.
    let borrowed = unsafe { BorrowedHandle::borrow_raw(handle) };
    let file = File::from(
        borrowed
            .try_clone_to_owned()
            .map_err(|_| "Native writer SQLite connection identity cannot be inspected")?,
    );
    file_identity(&file)
}

pub(super) fn safe_file(path: &Path, create: bool, fresh: bool) -> Result<File, String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Native writer sidecar must be a regular file".into());
        }
    }
    let mut options = std::fs::OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(create)
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
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|_| "Native writer sidecar cannot be opened safely")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Native writer sidecar metadata is unavailable")?;
    if !metadata.is_file() || file_identity(&file)?.1 != 1 {
        return Err("Native writer sidecar must have one regular-file link".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Native writer sidecar cannot be a reparse point".into());
        }
    }
    Ok(file)
}
