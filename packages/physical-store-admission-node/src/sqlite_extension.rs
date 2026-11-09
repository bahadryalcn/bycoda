use crate::{checked_path, failure, image_pin};
use napi_derive::napi;
use std::ffi::{c_char, c_int, c_void};

unsafe extern "C" {
    fn bycoda_sqlite_extension_init(
        database: *mut c_void,
        error: *mut *mut c_char,
        api: *const c_void,
    ) -> c_int;
}

#[napi]
pub fn registry_root_for_database(canonical_abs_database_path: String) -> napi::Result<String> {
    let root = bycoda_physical_store_admission::database_registry_root(checked_path(
        &canonical_abs_database_path,
    )?)
    .map_err(failure)?;
    root.to_str()
        .map(str::to_owned)
        .ok_or_else(|| failure("physical registry location is not representable as UTF8"))
}

#[napi]
pub fn sqlite_extension_entry_point() -> String {
    "sqlite3_bycodaphysical_init".to_owned()
}

#[napi]
pub fn connection_attestation_supported() -> bool {
    cfg!(windows)
}

/// SQLite's public extension entry, exported from the SAME trusted Node image.
///
/// # Safety
/// SQLite must supply a live sqlite3 connection, its writable error-output slot
/// and the matching public sqlite3_api_routines table for that SQLite library.
#[no_mangle]
pub unsafe extern "C" fn sqlite3_bycodaphysical_init(
    database: *mut c_void,
    error: *mut *mut c_char,
    api: *const c_void,
) -> c_int {
    if image_pin::retain().is_err() {
        return 1; // SQLITE_ERROR; no SQL function or physical grant was created.
    }
    unsafe { bycoda_sqlite_extension_init(database, error, api) }
}
