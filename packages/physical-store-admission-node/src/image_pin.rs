//! Keep the one native strong registry alive after a Node worker/env unloads.
//! No cleanup hook is allowed to drop its live file locks.
use std::sync::OnceLock;

pub(crate) fn retain() -> Result<(), String> {
    static PIN: OnceLock<Result<(), String>> = OnceLock::new();
    PIN.get_or_init(pin).clone()
}

#[inline(never)]
fn anchor() {}

#[cfg(windows)]
fn pin() -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleExW(flags: u32, address: *const u16, module: *mut *mut c_void) -> i32;
    }
    let mut module = std::ptr::null_mut();
    // FROM_ADDRESS | PIN: the pointer is code in this image, not a filename.
    let success = unsafe {
        GetModuleHandleExW(
            0x0000_0004 | 0x0000_0001,
            anchor as *const () as _,
            &mut module,
        )
    };
    if success == 0 || module.is_null() {
        Err("cannot pin physical admission addon through environment cleanup".into())
    } else {
        Ok(())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn pin() -> Result<(), String> {
    use std::ffi::{c_char, c_int, c_void};
    #[repr(C)]
    struct DlInfo {
        filename: *const c_char,
        base: *mut c_void,
        symbol: *const c_char,
        symbol_address: *mut c_void,
    }
    #[cfg_attr(target_os = "linux", link(name = "dl"))]
    unsafe extern "C" {
        fn dladdr(address: *const c_void, info: *mut DlInfo) -> c_int;
        fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
    }
    let mut info = DlInfo {
        filename: std::ptr::null(),
        base: std::ptr::null_mut(),
        symbol: std::ptr::null(),
        symbol_address: std::ptr::null_mut(),
    };
    let found = unsafe { dladdr(anchor as *const () as _, &mut info) };
    if found == 0 || info.filename.is_null() {
        return Err("cannot locate physical admission addon image".into());
    }
    // Keep an additional loader reference forever. No dlclose on env cleanup.
    let held = unsafe { dlopen(info.filename, 2) }; // RTLD_NOW, both supported OSes.
    if held.is_null() {
        Err("cannot retain physical admission addon image".into())
    } else {
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn pin() -> Result<(), String> {
    Err("physical admission addon image pin is unsupported on this platform".into())
}
