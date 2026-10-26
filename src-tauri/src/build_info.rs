//! Immutable source stamp compiled with the native resources.
pub const BUILD_IDENTITY_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/build-info.json"));

#[tauri::command]
pub fn build_identity() -> Option<serde_json::Value> {
    serde_json::from_str(BUILD_IDENTITY_JSON)
        .ok()
        .filter(|value: &serde_json::Value| value.is_object())
}
