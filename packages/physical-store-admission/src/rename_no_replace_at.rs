//! Atomic no-replace rename relative to already-authorized directory handles.
use std::{ffi::OsStr, io, path::{Component, Path}};
use cap_std::fs::Dir;

fn validate_name(name: &OsStr) -> io::Result<()> {
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(value)), None) if value == name => Ok(()),
        _ => Err(io::Error::new(io::ErrorKind::InvalidInput, "Expected a single entry name")),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn rename_no_replace_at(source: &Dir, from: &OsStr, destination: &Dir, to: &OsStr) -> io::Result<()> {
    use std::{ffi::CString, os::{fd::AsRawFd, unix::ffi::OsStrExt}};
    validate_name(from)?;
    validate_name(to)?;
    let from = CString::new(from.as_bytes()).map_err(|_| io::ErrorKind::InvalidInput)?;
    let to = CString::new(to.as_bytes()).map_err(|_| io::ErrorKind::InvalidInput)?;
    #[cfg(target_os = "linux")]
    let status = unsafe { libc::renameat2(source.as_raw_fd(), from.as_ptr(), destination.as_raw_fd(), to.as_ptr(), libc::RENAME_NOREPLACE) };
    #[cfg(target_os = "macos")]
    let status = unsafe { libc::renameatx_np(source.as_raw_fd(), from.as_ptr(), destination.as_raw_fd(), to.as_ptr(), libc::RENAME_EXCL) };
    if status == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

#[cfg(windows)]
pub fn rename_no_replace_at(source: &Dir, from: &OsStr, destination: &Dir, to: &OsStr) -> io::Result<()> {
    use std::{mem::size_of, os::windows::{ffi::OsStrExt, io::AsRawHandle}, ptr};
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsMaybeDirExt};
    use cap_primitives::fs::OpenOptionsExt;
    use cap_std::fs::OpenOptions;
    use windows_sys::Win32::Storage::FileSystem::{FILE_RENAME_INFO, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE};
    #[repr(C)]
    struct IoStatus { status_or_pointer: usize, information: usize }
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtSetInformationFile(handle: *mut core::ffi::c_void, status: *mut IoStatus, information: *const core::ffi::c_void, length: u32, class: u32) -> i32;
        fn RtlNtStatusToDosError(status: i32) -> u32;
    }
    validate_name(from)?;
    validate_name(to)?;
    let wide: Vec<u16> = to.encode_wide().collect();
    if wide.contains(&0) || wide.len() > (u32::MAX as usize / 2) { return Err(io::ErrorKind::InvalidInput.into()); }
    let mut options = OpenOptions::new();
    options.read(true).maybe_dir(true).follow(FollowSymlinks::No);
    options.access_mode(0x0001_0000 | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    let child = source.open_with(from, &options)?;
    let size = size_of::<FILE_RENAME_INFO>().checked_add(wide.len() * 2).ok_or(io::ErrorKind::InvalidInput)?;
    let size32 = u32::try_from(size).map_err(|_| io::ErrorKind::InvalidInput)?;
    let mut storage = vec![0u64; size.div_ceil(size_of::<u64>())];
    let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    unsafe {
        (*info).Anonymous.ReplaceIfExists = false;
        (*info).RootDirectory = destination.as_raw_handle();
        (*info).FileNameLength = (wide.len() * 2) as u32;
        ptr::copy_nonoverlapping(wide.as_ptr(), ptr::addr_of_mut!((*info).FileName).cast::<u16>(), wide.len());
        // Native FileRenameInformation accepts an opened target directory as
        // RootDirectory. The cap-std source handle is synchronous.
        let mut status_block = IoStatus { status_or_pointer: 0, information: 0 };
        let status = NtSetInformationFile(child.as_raw_handle(), &mut status_block, info.cast(), size32, 10);
        if status < 0 {
            return Err(io::Error::from_raw_os_error(RtlNtStatusToDosError(status) as i32));
        }
        if status == 0x103 { return Err(io::Error::other("Windows rename completion is uncertain")); }
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub fn rename_no_replace_at(_: &Dir, _: &OsStr, _: &Dir, _: &OsStr) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "Handle-relative no-replace rename is unsupported"))
}
