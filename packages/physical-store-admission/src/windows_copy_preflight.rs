//! Windows preflight for data and security that the guarded copier cannot recreate.
use std::{
    fs::File,
    io,
    mem::{offset_of, size_of},
    os::windows::io::AsRawHandle,
};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_HANDLE_EOF, ERROR_INSUFFICIENT_BUFFER},
    Security::{
        GetKernelObjectSecurity, DACL_SECURITY_INFORMATION, GROUP_SECURITY_INFORMATION,
        OWNER_SECURITY_INFORMATION,
    },
    Storage::FileSystem::{FileStreamInfo, GetFileInformationByHandleEx, FILE_STREAM_INFO},
};

#[repr(C)]
struct IoStatus {
    status_or_pointer: usize,
    information: usize,
}
#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryInformationFile(
        handle: *mut core::ffi::c_void,
        status: *mut IoStatus,
        information: *mut core::ffi::c_void,
        length: u32,
        class: u32,
    ) -> i32;
}

pub(crate) fn security(file: &File) -> io::Result<Vec<u8>> {
    let flags = OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    let mut size = 0;
    unsafe {
        GetKernelObjectSecurity(
            file.as_raw_handle(),
            flags,
            std::ptr::null_mut(),
            0,
            &mut size,
        );
    }
    if size == 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err(io::Error::last_os_error());
    }
    let mut data = vec![0; size as usize];
    if unsafe {
        GetKernelObjectSecurity(
            file.as_raw_handle(),
            flags,
            data.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(data)
}

pub(crate) fn reject_unpreserved_attributes(file: &File) -> io::Result<()> {
    let mut status = IoStatus {
        status_or_pointer: 0,
        information: 0,
    };
    let mut ea_size = 0u32;
    // FileEaInformation reports the complete extended-attribute byte count.
    let result = unsafe {
        NtQueryInformationFile(
            file.as_raw_handle(),
            &mut status,
            (&mut ea_size as *mut u32).cast(),
            size_of::<u32>() as u32,
            7,
        )
    };
    if result < 0 || ea_size != 0 {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Windows extended attributes cannot be preserved",
        ));
    }
    let mut storage = vec![0u64; 8192];
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStreamInfo,
            storage.as_mut_ptr().cast(),
            (storage.len() * size_of::<u64>()) as u32,
        )
    } == 0
    {
        if unsafe { GetLastError() } == ERROR_HANDLE_EOF {
            return Ok(());
        }
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Windows stream metadata cannot be inspected",
        ));
    }
    let length = storage.len() * size_of::<u64>();
    let mut offset = 0usize;
    loop {
        if offset + size_of::<FILE_STREAM_INFO>() > length {
            return Err(io::Error::other("Invalid Windows stream metadata"));
        }
        let info = unsafe {
            &*(storage
                .as_ptr()
                .cast::<u8>()
                .add(offset)
                .cast::<FILE_STREAM_INFO>())
        };
        let bytes = info.StreamNameLength as usize;
        let start = offset + offset_of!(FILE_STREAM_INFO, StreamName);
        if bytes % 2 != 0 || start.checked_add(bytes).is_none_or(|end| end > length) {
            return Err(io::Error::other("Invalid Windows stream name"));
        }
        let name = unsafe {
            std::slice::from_raw_parts(
                storage.as_ptr().cast::<u8>().add(start).cast::<u16>(),
                bytes / 2,
            )
        };
        if String::from_utf16(name).ok().as_deref() != Some("::$DATA") {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Windows alternate streams cannot be preserved",
            ));
        }
        if info.NextEntryOffset == 0 {
            break;
        }
        let next = info.NextEntryOffset as usize;
        if next < size_of::<FILE_STREAM_INFO>() || next % 8 != 0 {
            return Err(io::Error::other("Invalid Windows stream offset"));
        }
        offset = offset
            .checked_add(next)
            .ok_or_else(|| io::Error::other("Invalid Windows stream offset"))?;
    }
    Ok(())
}

/// Refuse publication if staging would change owner/group/DACL or lose streams/EAs.
pub fn verify(source: &File, staged: &File) -> io::Result<()> {
    reject_unpreserved_attributes(source)?;
    if security(source)? != security(staged)? {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Windows ownership or ACL cannot be preserved",
        ));
    }
    Ok(())
}
