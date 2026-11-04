//! Exact pin mutations. A receipt and the session update commit together.
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativePinAuthority {
    pub environment_id: String,
    pub generation: i64,
    pub phase: String,
    pub min_writer_protocol: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinOutcome {
    pub state: String,
    pub version: i64,
    pub pinned: Option<bool>,
    pub authority: Option<NativePinAuthority>,
}

/// Called by the parent migration after the sessions table exists.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS session_pin_versions (session_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_pin_receipts (operation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, cwd_key TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS session_pin_insert AFTER INSERT ON sessions BEGIN
        INSERT INTO session_pin_versions(session_id,version) VALUES(NEW.id,1) ON CONFLICT(session_id) DO UPDATE SET version=CASE WHEN version<9007199254740991 THEN version+1 ELSE RAISE(ABORT,'Pin version exhausted') END;
      END;
      CREATE TRIGGER IF NOT EXISTS session_pin_delete AFTER DELETE ON sessions BEGIN
        INSERT INTO session_pin_versions(session_id,version) VALUES(OLD.id,1) ON CONFLICT(session_id) DO UPDATE SET version=CASE WHEN version<9007199254740991 THEN version+1 ELSE RAISE(ABORT,'Pin version exhausted') END;
      END;
      CREATE TRIGGER IF NOT EXISTS session_pin_update AFTER UPDATE OF pinned ON sessions WHEN OLD.pinned IS NOT NEW.pinned BEGIN
        INSERT INTO session_pin_versions(session_id,version) VALUES(NEW.id,1) ON CONFLICT(session_id) DO UPDATE SET version=CASE WHEN version<9007199254740991 THEN version+1 ELSE RAISE(ABORT,'Pin version exhausted') END;
      END;")
}

fn validate(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 4096 { Err("Invalid pin operation identity".into()) } else { Ok(()) }
}

fn path_key(path: &str) -> String {
    let slash = path.replace('\\', "/");
    let trimmed = slash.trim_end_matches('/');
    let value = if trimmed.is_empty() { "/" } else { trimmed };
    if cfg!(windows) { value.to_lowercase() } else { value.to_owned() }
}

fn current(conn: &Connection, id: &str, cwd: &str) -> Result<PinOutcome, String> {
    let row: Option<(String, i64, i64, Option<String>, Option<i64>, Option<String>, Option<i64>)> = conn.query_row(
        "SELECT s.cwd,s.pinned,COALESCE((SELECT version FROM session_pin_versions WHERE session_id=s.id),0),f.environment_id,f.generation,f.phase,f.min_writer_protocol FROM sessions s LEFT JOIN native_authority_floor f ON f.session_id=s.id WHERE s.id=?1",
        [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)),
    ).optional().map_err(|e| e.to_string())?;
    Ok(match row {
        Some((stored_cwd, pinned, version, environment, generation, phase, protocol)) if path_key(&stored_cwd) == path_key(cwd) => {
            if !(0..=9_007_199_254_740_991).contains(&version) { return Err("Invalid pin version".into()); }
            let authority = match (environment, generation, phase, protocol) {
                (None, None, None, None) => None,
                (Some(environment_id), Some(generation), Some(phase), Some(min_writer_protocol))
                    if (0..=9_007_199_254_740_991).contains(&generation) => Some(NativePinAuthority { environment_id, generation, phase, min_writer_protocol }),
                _ => return Err("Invalid native pin authority".into()),
            };
            let allowed = authority.as_ref().is_none_or(|a| a.phase == "NATIVE" && a.min_writer_protocol == super::authority::WRITER_PROTOCOL as i64);
            PinOutcome { state: if allowed { "current" } else { "refused" }.into(), version, pinned: Some(pinned != 0), authority }
        },
        _ => PinOutcome { state: "refused".into(), version: 0, pinned: None, authority: None },
    })
}

fn durable<T>(conn: &Connection, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let prior: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !(0..=3).contains(&prior) { return Err("Invalid SQLite synchronous setting".into()); }
    conn.execute_batch("PRAGMA synchronous=FULL").map_err(|e| e.to_string())?;
    let result = work();
    conn.execute_batch(&format!("PRAGMA synchronous={prior}")).map_err(|e| format!("Pin durability restore failed: {e}"))?;
    let restored: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if restored != prior { return Err("Pin durability restore mismatch".into()); }
    result
}

#[tauri::command]
pub async fn session_pin_state(app: tauri::AppHandle, window: tauri::Window, session_id: String, cwd: String) -> Result<PinOutcome, String> {
    validate(&session_id)?; validate(&cwd)?;
    let captured_page = crate::harness::page_incarnation(&window)?;
    crate::harness::run_blocking("session_pin_state", move || {
        let store = app.state::<super::SessionStore>();
        let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
        if crate::harness::page_incarnation(&window)? != captured_page { return Err("PIN_PAGE_STALE".into()); }
        current(&conn, &session_id, &cwd)
    }).await
}

#[tauri::command]
pub async fn session_pin_receipt(app: tauri::AppHandle, window: tauri::Window, operation_id: String, session_id: String, cwd: String) -> Result<Option<PinOutcome>, String> {
    validate(&operation_id)?; validate(&session_id)?; validate(&cwd)?;
    let captured_page = crate::harness::page_incarnation(&window)?;
    crate::harness::run_blocking("session_pin_receipt", move || {
        let store = app.state::<super::SessionStore>();
        let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
        if crate::harness::page_incarnation(&window)? != captured_page { return Err("PIN_PAGE_STALE".into()); }
        let raw: Option<String> = conn.query_row("SELECT result FROM session_pin_receipts WHERE operation_id=?1 AND session_id=?2 AND cwd_key=?3", params![operation_id,session_id,path_key(&cwd)], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string())).transpose()
    }).await
}

#[tauri::command]
pub async fn session_pin_apply(app: tauri::AppHandle, window: tauri::Window, operation_id: String,
    session_id: String, cwd: String, desired_pinned: bool, expected_version: i64, expected_authority: Option<NativePinAuthority>) -> Result<PinOutcome, String> {
    validate(&operation_id)?; validate(&session_id)?; validate(&cwd)?;
    if !(0..=9_007_199_254_740_991).contains(&expected_version) { return Err("Invalid pin version".into()); }
    let captured_page = crate::harness::page_incarnation(&window)?;
    let view = app.get_webview_window(window.label()).ok_or("PIN_PAGE_STALE")?;
    let captured_issuer = crate::control::receipts::capture(&view)?;
    if crate::harness::page_incarnation(&window)? != captured_page { return Err("PIN_PAGE_STALE".into()); }
    crate::harness::run_blocking("session_pin_apply", move || {
        let store = app.state::<super::SessionStore>();
        crate::native_window_lifecycle::session_persistence_write(&window, &session_id, || {
            let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
            if !captured_issuer.is_live() { return Err("PIN_PAGE_STALE".into()); }
            let cwd_key = path_key(&cwd);
            let request = serde_json::to_vec(&(&session_id, &cwd_key, desired_pinned, expected_version, &expected_authority)).map_err(|e| e.to_string())?;
            let hash = format!("{:x}", Sha256::digest(request));
            durable(&conn, || {
                let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
                let prior: Option<(String, String)> = tx.query_row("SELECT request_hash,result FROM session_pin_receipts WHERE operation_id=?1", [&operation_id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
                if let Some((previous_hash, result)) = prior {
                    if previous_hash != hash { return Err("Pin operation ID reused with different request".into()); }
                    return serde_json::from_str(&result).map_err(|e| e.to_string());
                }
                let before = current(&tx, &session_id, &cwd)?;
                let outcome = if before.pinned.is_none() || before.state == "refused" { before }
                  else if before.authority != expected_authority { PinOutcome { state: "superseded".into(), ..before } }
                  else if before.version != expected_version { PinOutcome { state: "superseded".into(), ..before } }
                  else {
                    let nonce = uuid::Uuid::new_v4().to_string();
                    if let Some(authority) = &before.authority {
                        tx.execute("INSERT INTO native_authority_permits(nonce,environment_id,session_id,generation,writer_protocol,purpose) VALUES(?1,?2,?3,?4,?5,'native')", params![nonce,authority.environment_id,session_id,authority.generation,super::authority::WRITER_PROTOCOL as i64]).map_err(|e| e.to_string())?;
                    }
                    let update = tx.execute("UPDATE sessions SET pinned=?1 WHERE id=?2", params![desired_pinned as i64, session_id]);
                    if before.authority.is_some() { tx.execute("DELETE FROM native_authority_permits WHERE nonce=?1", [&nonce]).map_err(|e| e.to_string())?; }
                    match update {
                        Ok(_) => PinOutcome { state: "applied".into(), ..current(&tx, &session_id, &cwd)? },
                        Err(error) if error.to_string().contains("NATIVE_AUTHORITY_FENCED") => PinOutcome { state: "refused".into(), ..before },
                        Err(error) => return Err(error.to_string()),
                    }
                  };
                let result = serde_json::to_string(&outcome).map_err(|e| e.to_string())?;
                tx.execute("INSERT INTO session_pin_receipts(operation_id,session_id,cwd_key,request_hash,result) VALUES(?1,?2,?3,?4,?5)", params![operation_id,session_id,cwd_key,hash,result]).map_err(|e| e.to_string())?;
                captured_issuer.try_with_live(|| tx.commit().map_err(|e| e.to_string()))?;
                Ok(outcome)
            })
        })
    }).await
}
