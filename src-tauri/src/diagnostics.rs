//! Native diagnostic log reports: a panic hook that leaves a crash marker and commands that
//! collect bounded log tails for the in-app "report a problem" flow.
mod crash;
mod environment;
mod file_log;
mod gzip;
mod logs;

pub(crate) use crash::{clear_recovered_on_exit, install_panic_hook};
pub(crate) use file_log::flush as flush_logs;

/// Starts the `bycoda.log` logger and the uptime clock (once, during setup).
pub(crate) fn install_file_logger(log_dir: &std::path::Path) {
    environment::mark_start();
    file_log::install(log_dir);
}

#[cfg(test)]
mod crash_tests;
#[cfg(test)]
mod file_log_tests;
#[cfg(test)]
mod gzip_tests;
#[cfg(test)]
mod logs_tests;

use logs::NativeDiagnosticLogs;

#[tauri::command]
pub(crate) async fn diagnostics_collect_logs() -> Result<NativeDiagnosticLogs, String> {
    tauri::async_runtime::spawn_blocking(logs::collect)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn diagnostics_clear_crash() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(crash::clear)
        .await
        .map_err(|error| error.to_string())?
}

/// Fallback for webviews that lack `CompressionStream`: gzip, then base64.
#[tauri::command]
pub(crate) async fn diagnostics_gzip_base64(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || gzip::gzip_base64(&text))
        .await
        .map_err(|error| error.to_string())?
}
