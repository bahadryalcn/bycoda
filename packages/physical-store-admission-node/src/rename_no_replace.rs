use napi_derive::napi;
use std::path::Path;

#[napi]
pub fn rename_no_replace(from: String, to: String) -> napi::Result<()> {
    if from.is_empty() || to.is_empty() || from.contains('\0') || to.contains('\0') {
        return Err(napi::Error::from_reason("Invalid rename path"));
    }
    bycoda_physical_store_admission::rename_no_replace(Path::new(&from), Path::new(&to))
        .map_err(|error| napi::Error::from_reason(format!("Atomic no-replace rename failed: {error}")))
}
