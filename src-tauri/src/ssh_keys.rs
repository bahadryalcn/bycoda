//! Explicit local key generation in a private PTY. Passphrases never enter arguments or stores.
#[tauri::command(async)]
pub fn ssh_key_generate(
    app: tauri::AppHandle,
    window: tauri::Window,
    host: tauri::State<'_, crate::pty::PtyHost>,
    id: String,
    path: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    crate::pty::spawn_keygen(app, window, host, id, path, cols, rows)
}
