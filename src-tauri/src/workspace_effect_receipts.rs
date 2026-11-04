//! Native original-request receipts for desktop Room workspace effects.
//! A pending record survives restart and is never replayed automatically.
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
struct Pending { path: PathBuf, key: String, fingerprint: String }
fn entries() -> &'static Mutex<HashMap<String, Pending>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}
fn open(path: &Path) -> Result<rusqlite::Connection, String> {
    let db = rusqlite::Connection::open(path).map_err(|_| "Workspace receipt storage unavailable")?;
    db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT)").map_err(|_| "Workspace receipt storage unavailable")?;
    Ok(db)
}
fn digest(value: &Value) -> Result<String, String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value).map_err(|_| "Invalid workspace receipt input")?)))
}
fn key(environment: &str, thread: &str, project: &str, request_id: &str) -> Result<String, String> {
    if [environment,thread,project,request_id].iter().any(|v| v.is_empty() || v.len() > 300 || v.contains('\0')) { return Err("Invalid workspace receipt identity".into()); }
    digest(&json!([environment,thread,project,request_id]))
}
fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| "Workspace receipt storage unavailable")?;
    std::fs::create_dir_all(&dir).map_err(|_| "Workspace receipt storage unavailable")?;
    Ok(dir.join("assistant-workspace-receipts-v1.db"))
}
fn begin_at(path: &Path, key: &str, fingerprint: &str) -> Result<(), String> {
    let db = open(path)?;
    let previous: Option<(String, String)> = db.query_row("SELECT fingerprint,state FROM receipts WHERE id=?1", [key], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_| "Workspace receipt storage unavailable")?;
    if let Some((old, state)) = previous {
        if old != fingerprint { return Err("Workspace request identity was reused with changed input".into()); }
        return Err(if state == "accepted" { "Workspace operation already settled; inspect its original receipt" } else { "Workspace operation outcome is unknown; inspect its original receipt" }.into());
    }
    db.execute("INSERT INTO receipts(id,fingerprint,state) VALUES(?1,?2,'pending')", params![key,fingerprint]).map_err(|_| "Workspace receipt storage unavailable")?;
    Ok(())
}
pub(crate) fn begin(app: &AppHandle, pending_id: &str, environment: &str, thread: &str, project: &str, cwd: &str, action: &str, input: &Value) -> Result<(), String> {
    let request_id = input["requestId"].as_str().ok_or("Workspace request identity required")?;
    let key = key(environment,thread,project,request_id)?;
    let fingerprint = digest(&json!([action,cwd,input]))?;
    let path = file(app)?;
    let mut pending = entries().lock().map_err(|_| "Workspace receipt owner unavailable")?;
    if pending.len() >= 64 || pending.contains_key(pending_id) { return Err("Workspace receipt capacity unavailable".into()); }
    begin_at(&path, &key, &fingerprint)?;
    pending.insert(pending_id.into(), Pending { path, key, fingerprint });
    Ok(())
}
pub(crate) fn complete(pending_id: &str, response: &Value) -> Result<(), String> {
    if response["ok"] != true { return Err("Workspace effect remains uncertain".into()); }
    let result = serde_json::to_string(&response["result"]).map_err(|_| "Invalid workspace result")?;
    if result.len() > 16384 { return Err("Workspace result is too large".into()); }
    let mut pending = entries().lock().map_err(|_| "Workspace receipt owner unavailable")?;
    let item = pending.get(pending_id).ok_or("Workspace receipt is unavailable")?;
    let db = open(&item.path)?;
    let changed = db.execute("UPDATE receipts SET state='accepted',result=?1 WHERE id=?2 AND fingerprint=?3 AND state IN ('pending','ownerAccepted')", params![result,item.key,item.fingerprint]).map_err(|_| "Workspace receipt outcome is uncertain")?;
    if changed != 1 { return Err("Workspace receipt outcome is uncertain".into()); }
    pending.remove(pending_id);
    Ok(())
}
// This state means the current native process owns the exact operation. The
// caller must retain its physical permit and start its worker before reporting
// it. A restart has no live owner and therefore reads this state as unknown.
pub(super) fn accept_owner(pending_id: &str) -> Result<(), String> {
    let pending = entries().lock().map_err(|_| "Workspace receipt owner unavailable")?;
    let item = pending.get(pending_id).ok_or("Workspace receipt is unavailable")?;
    let db = open(&item.path)?;
    let changed = db.execute("UPDATE receipts SET state='ownerAccepted' WHERE id=?1 AND fingerprint=?2 AND state='pending'", params![item.key,item.fingerprint]).map_err(|_| "Workspace receipt outcome is uncertain")?;
    if changed != 1 { return Err("Workspace receipt outcome is uncertain".into()); }
    Ok(())
}
pub(crate) fn mark_unknown(pending_id: &str) {
    if let Ok(mut pending) = entries().lock() { pending.remove(pending_id); }
}
pub(crate) fn status(app: &AppHandle, environment: &str, thread: &str, project: &str, cwd: &str, request_id: &str, action: &str, original_input: &Value) -> Result<Value, String> {
    let path = file(app)?;
    status_at(&path, environment, thread, project, cwd, request_id, action, original_input)
}
fn status_at(path: &Path, environment: &str, thread: &str, project: &str, cwd: &str, request_id: &str, action: &str, original_input: &Value) -> Result<Value, String> {
    let db = open(path)?;
    let expected = digest(&json!([action,cwd,original_input]))?;
    let receipt_key = key(environment,thread,project,request_id)?;
    let found: Option<(String, String, Option<String>)> = db.query_row("SELECT fingerprint,state,result FROM receipts WHERE id=?1", [&receipt_key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_| "Workspace receipt storage unavailable")?;
    match found {
        Some((fingerprint, _, _)) if fingerprint != expected => Err("Workspace request identity was reused with changed input".into()),
        Some((_, state, _)) if state == "ownerAccepted" && entries().lock().map_err(|_| "Workspace receipt owner unavailable")?.values().any(|item| item.path == path && item.key == receipt_key && item.fingerprint == expected) => Ok(json!({"state":"ownerAccepted"})),
        Some((_, state, Some(result))) if state == "accepted" => Ok(json!({"state":"accepted","result":serde_json::from_str::<Value>(&result).map_err(|_| "Workspace receipt is invalid")?})),
        _ => Ok(json!({"state":"unknown"})),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_original_survives_reopen_and_changed_input_never_replays() {
        let dir = std::env::temp_dir().join(format!("workspace-receipt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.db");
        begin_at(&path,"original","input-a").unwrap();
        assert!(begin_at(&path,"original","input-a").unwrap_err().contains("unknown"));
        assert!(begin_at(&path,"original","input-b").unwrap_err().contains("changed input"));
        let db = open(&path).unwrap();
        let state: String = db.query_row("SELECT state FROM receipts WHERE id='original'", [], |r| r.get(0)).unwrap();
        assert_eq!(state,"pending");
        drop(db);
        entries().lock().unwrap().insert("control-fixture".into(), Pending { path: path.clone(), key: "original".into(), fingerprint: "input-a".into() });
        assert!(complete("control-fixture", &json!({"ok":false})).is_err());
        assert!(begin_at(&path,"original","input-a").unwrap_err().contains("unknown"));
        complete("control-fixture", &json!({"ok":true,"result":{"sessionId":"created"}})).unwrap();
        assert!(begin_at(&path,"original","input-a").unwrap_err().contains("already settled"));
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn status_never_confuses_another_project_or_changed_original_input() {
        let dir = std::env::temp_dir().join(format!("workspace-status-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.db");
        let input = json!({"requestId":"original","title":"New"});
        let id = key("host", "room", "project", "original").unwrap();
        let fingerprint = digest(&json!(["workspace.sessions.create", "C:/project", input])).unwrap();
        begin_at(&path, &id, &fingerprint).unwrap();
        assert_eq!(status_at(&path,"host","room","project","C:/project","original","workspace.sessions.create",&input).unwrap(), json!({"state":"unknown"}));
        assert_eq!(status_at(&path,"host","room","other","C:/project","original","workspace.sessions.create",&input).unwrap(), json!({"state":"unknown"}));
        assert!(status_at(&path,"host","room","project","C:/project","original","workspace.sessions.create",&json!({"requestId":"original","title":"Changed"})).is_err());
        entries().lock().unwrap().insert("owner-status-fixture".into(), Pending { path:path.clone(), key:id, fingerprint });
        accept_owner("owner-status-fixture").unwrap();
        assert_eq!(status_at(&path,"host","room","project","C:/project","original","workspace.sessions.create",&input).unwrap(), json!({"state":"ownerAccepted"}));
        entries().lock().unwrap().remove("owner-status-fixture");
        assert_eq!(status_at(&path,"host","room","project","C:/project","original","workspace.sessions.create",&input).unwrap(), json!({"state":"unknown"}));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
