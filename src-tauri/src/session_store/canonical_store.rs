use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
const MAX_SAFE_COUNTER: i64 = 9_007_199_254_740_991;

use super::SessionStore;

pub(super) fn ensure_schema(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS canonical_values (scope TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL, value TEXT, PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS canonical_operations (scope TEXT NOT NULL, operation_id TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL, window TEXT NOT NULL, page TEXT NOT NULL, PRIMARY KEY(scope,operation_id));
      CREATE TABLE IF NOT EXISTS canonical_claims (scope TEXT NOT NULL, key TEXT NOT NULL, operation_id TEXT NOT NULL, window TEXT NOT NULL, page TEXT NOT NULL, PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS canonical_claim_phases (scope TEXT NOT NULL, key TEXT NOT NULL, operation_id TEXT NOT NULL, phase TEXT NOT NULL, PRIMARY KEY(scope,key,operation_id));
      CREATE TABLE IF NOT EXISTS canonical_claim_settlements (scope TEXT NOT NULL, key TEXT NOT NULL, operation_id TEXT NOT NULL, window TEXT NOT NULL, page TEXT NOT NULL, PRIMARY KEY(scope,key,operation_id));
      CREATE TABLE IF NOT EXISTS canonical_claim_recoveries (scope TEXT NOT NULL, key TEXT NOT NULL, operation_id TEXT NOT NULL, owner_page TEXT NOT NULL, recovered_by TEXT NOT NULL, PRIMARY KEY(scope,key,operation_id));
      CREATE TABLE IF NOT EXISTS canonical_revisions (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS canonical_legacy_raw (scope TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, raw TEXT NOT NULL, PRIMARY KEY(scope,key,hash));
      CREATE TABLE IF NOT EXISTS canonical_legacy_revisions (scope TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS assistant_native_preparations (key TEXT NOT NULL, operation_id TEXT NOT NULL, request_key TEXT NOT NULL, intent_version INTEGER NOT NULL, intent_hash TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(key,operation_id));
      CREATE TABLE IF NOT EXISTS assistant_native_send_routes (key TEXT NOT NULL, operation_id TEXT NOT NULL, request_key TEXT NOT NULL, machine_id TEXT NOT NULL, environment_id TEXT NOT NULL, route_fingerprint TEXT NOT NULL, route_generation TEXT NOT NULL, host_instance TEXT NOT NULL, intent TEXT NOT NULL, intent_version INTEGER NOT NULL, proof TEXT, PRIMARY KEY(key,operation_id));")
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Entry { key: String, version: i64, value: Option<Value> }
#[derive(Serialize, Deserialize)]
pub struct Check { key: String, version: Option<i64> }
#[derive(Serialize, Deserialize)]
pub struct Write { key: String, value: Option<Value> }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Legacy { key: String, raw: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] conflict_only: bool }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRequest { key: String, operation_id: String, mode: String }
#[derive(Deserialize)]
pub struct Outcome { applied: bool, entries: Vec<Entry>, #[serde(default)] revision: i64, #[serde(default)] compacted: bool }
impl Serialize for Outcome {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut out = serializer.serialize_struct("Outcome", 4)?;
        out.serialize_field("applied", &self.applied)?;
        out.serialize_field("revision", &self.revision)?;
        out.serialize_field("compacted", &self.compacted)?;
        if self.compacted {
            #[derive(Serialize)]
            struct Proof<'a> { key: &'a str, version: i64 }
            let entries: Vec<Proof<'_>> = self.entries.iter().map(|entry| Proof { key: &entry.key, version: entry.version }).collect();
            out.serialize_field("entries", &entries)?;
        } else {
            out.serialize_field("entries", &self.entries)?;
        }
        out.end()
    }
}
#[derive(Serialize)]
pub struct Page { entries: Vec<Entry>, revision: i64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedPage { entries: Vec<Entry>, revision: i64, has_more: bool, oversized: Option<OversizedRecord> }
#[derive(Serialize)]
pub struct OversizedRecord { key: String, version: i64, bytes: i64 }
#[derive(Serialize)]
pub struct LegacySource { hash: String, raw: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim { owned: bool, operation_id: String, window: String, page: String }

fn validate(s: &str) -> Result<(), String> {
    if s.trim().is_empty() || s.len() > 4096 { Err("Invalid canonical storage identifier".into()) } else { Ok(()) }
}
// Hold the store mutex throughout this scope. Restore and verify the connection's
// previous setting even when admission or commit fails. A restore failure is an
// unknown result; callers reconcile through their exact operation receipt.
fn durable<T>(db: &Connection, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let prior: i64 = db.query_row("PRAGMA synchronous", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if !(0..=3).contains(&prior) { return Err("Invalid SQLite synchronous setting".into()); }
    db.execute_batch("PRAGMA synchronous = FULL").map_err(|e| e.to_string())?;
    let result = work();
    db.execute_batch(&format!("PRAGMA synchronous = {prior}")).map_err(|e| format!("Canonical durability restore failed: {e}"))?;
    let restored: i64 = db.query_row("PRAGMA synchronous", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if restored != prior { return Err("Canonical durability restore mismatch".into()); }
    result
}
fn read(db: &Connection, scope: &str, key: &str) -> Result<Option<Entry>, String> {
    let row: Option<(i64, Option<String>)> = db.query_row("SELECT version,value FROM canonical_values WHERE scope=?1 AND key=?2", params![scope,key], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
    row.map(|(version,value)| {
        if version < 1 || version > MAX_SAFE_COUNTER { return Err("Canonical version is invalid".into()); }
        Ok(Entry { key: key.to_owned(), version, value: value.map(|v| serde_json::from_str(&v).map_err(|e| e.to_string())).transpose()? })
    }).transpose()
}
fn preserve_legacy(db: &Connection, scope: &str, key: &str, raw: &str) -> Result<(), String> {
    let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
    let inserted = db.execute("INSERT OR IGNORE INTO canonical_legacy_raw(scope,key,hash,raw) VALUES(?1,?2,?3,?4)", params![scope,key,hash,raw]).map_err(|e| e.to_string())?;
    if inserted == 1 && db.execute("INSERT INTO canonical_legacy_revisions(scope,key,revision) VALUES(?1,?2,1) ON CONFLICT(scope,key) DO UPDATE SET revision=revision+1 WHERE revision<9007199254740991", params![scope,key]).map_err(|e| e.to_string())? != 1 {
        return Err("Draft backup revision exhausted".into());
    }
    Ok(())
}
pub(crate) fn page(window: &tauri::Window) -> Result<String, String> {
    if !crate::window::is_workspace_window(window.label()) { return Err("Only workspace windows can access canonical storage".into()); }
    crate::harness::page_incarnation(window)
}
const BINDING_SCOPE: &str = "host-session-bindings.v2";
// Conversation effects require original claims; bounded management and fresh
// utility effects use native-issued command grants and physical retirement.
pub(crate) const SESSION_EFFECT_GUARD_ENABLED: bool = true;

#[tauri::command]
pub fn canonical_store_session_guard_ready() -> bool {
    SESSION_EFFECT_GUARD_ENABLED
}
fn binding_quiescent<T>(app: &tauri::AppHandle, scope: &str, key: &str, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    if scope == BINDING_SCOPE {
        crate::harness::with_quiescent_sessions(app, &[key.to_owned()], work)
    } else {
        work()
    }
}

// Entries are created only by native bootstrap, never inferred from an empty
// process registry. Each accepted command owns its admission until its worker
// actually completes, independently of the IPC waiter.
fn admissions() -> &'static Mutex<HashMap<String, usize>> {
    static ADMISSIONS: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    ADMISSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub(crate) struct PageAdmission { page: String }
impl Drop for PageAdmission {
    fn drop(&mut self) {
        if let Ok(mut entries) = admissions().lock() {
            if let Some(count) = entries.get_mut(&self.page) { *count = count.saturating_sub(1); }
        }
    }
}
pub(crate) fn admit(window: &tauri::Window, expected: &str) -> Result<PageAdmission, String> {
    validate(expected)?;
    let mut entries = admissions().lock().map_err(|_| "CANONICAL_ADMISSION_UNAVAILABLE")?;
    if page(window)? != expected { return Err("CANONICAL_PAGE_STALE".into()); }
    let count = entries.get_mut(expected).ok_or("CANONICAL_PAGE_NOT_REGISTERED")?;
    *count = count.checked_add(1).ok_or("CANONICAL_ADMISSION_EXHAUSTED")?;
    Ok(PageAdmission { page: expected.to_owned() })
}

const ASSISTANT_SEND_SCOPE: &str = "assistant-thread-sends.v2";
const ASSISTANT_DRAFT_SCOPE: &str = "assistant-thread-drafts.v2";

#[derive(Serialize)]
pub struct AssistantDraftBackupMeta { hash: String, bytes: i64 }
#[derive(Serialize)]
pub struct AssistantDraftBackupPage { items: Vec<AssistantDraftBackupMeta>, revision: i64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantDraftBackupContent { text: String, saved_at: Option<i64> }

fn assistant_draft_backup_key(key: &str, environment_id: &str, thread_id: &str) -> Result<(), String> {
    validate(key)?; validate(environment_id)?; validate(thread_id)?;
    let parts: Vec<String> = serde_json::from_str(key).map_err(|_| "Invalid draft identity")?;
    if parts.len() != 2 || parts[0] != environment_id || parts[1] != thread_id { return Err("Invalid draft identity".into()); }
    Ok(())
}

#[tauri::command]
pub async fn assistant_draft_backup_list(window: tauri::Window, key: String, environment_id: String, thread_id: String, after_hash: Option<String>, limit: usize, expected_revision: Option<i64>) -> Result<AssistantDraftBackupPage, String> {
    assistant_draft_backup_key(&key, &environment_id, &thread_id)?;
    if limit == 0 || limit > 64 || after_hash.as_ref().is_some_and(|hash| hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit())) { return Err("Invalid draft backup cursor".into()); }
    let captured = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("assistant_draft_backup_list", move || {
        let store = app.state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Deferred).map_err(|e| e.to_string())?;
        let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_legacy_revisions WHERE scope=?1 AND key=?2),0)", params![ASSISTANT_DRAFT_SCOPE,key], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !(0..=MAX_SAFE_COUNTER).contains(&revision) { return Err("Draft backup revision is invalid".into()); }
        if expected_revision.is_some_and(|expected| expected != revision) { return Err("Draft backups changed. Refresh the list.".into()); }
        let mut statement = tx.prepare("SELECT hash,octet_length(raw) FROM canonical_legacy_raw WHERE scope=?1 AND key=?2 AND (?3 IS NULL OR hash>?3) ORDER BY hash LIMIT ?4").map_err(|e| e.to_string())?;
        let rows = statement.query_map(params![ASSISTANT_DRAFT_SCOPE,key,after_hash,limit as i64], |row| Ok(AssistantDraftBackupMeta { hash: row.get(0)?, bytes: row.get(1)? })).map_err(|e| e.to_string())?;
        let items = rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        Ok(AssistantDraftBackupPage { items, revision })
    }).await
}

#[tauri::command]
pub async fn assistant_draft_backup_read(window: tauri::Window, key: String, environment_id: String, thread_id: String, hash: String) -> Result<AssistantDraftBackupContent, String> {
    assistant_draft_backup_key(&key, &environment_id, &thread_id)?;
    if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("Invalid draft backup identity".into()); }
    let captured = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("assistant_draft_backup_read", move || {
        let store = app.state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        let bytes: i64 = db.query_row("SELECT octet_length(raw) FROM canonical_legacy_raw WHERE scope=?1 AND key=?2 AND hash=?3", params![ASSISTANT_DRAFT_SCOPE,key,hash], |row| row.get(0)).map_err(|_| "Draft backup is unavailable")?;
        if bytes > 16 * 1024 * 1024 { return Err("Draft backup is too large to open; its original bytes remain preserved".into()); }
        let raw: String = db.query_row("SELECT raw FROM canonical_legacy_raw WHERE scope=?1 AND key=?2 AND hash=?3", params![ASSISTANT_DRAFT_SCOPE,key,hash], |row| row.get(0)).map_err(|_| "Draft backup is unavailable")?;
        if format!("{:x}", Sha256::digest(raw.as_bytes())) != hash { return Err("Draft backup integrity failed".into()); }
        let value: Value = serde_json::from_str(&raw).map_err(|_| "This source cannot be read as a draft; original bytes remain preserved")?;
        let object = value.as_object().ok_or("This source cannot be read as a draft; original bytes remain preserved")?;
        let text = if object.get("kind").and_then(Value::as_str) == Some("assistant-thread-draft") { object.get("text") } else { object.get(&thread_id) };
        let text = text.and_then(Value::as_str).ok_or("This source does not contain this draft")?;
        if text.len() > 256 * 1024 { return Err("Draft is too large to open; its original bytes remain preserved".into()); }
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        Ok(AssistantDraftBackupContent { text: text.to_owned(), saved_at: object.get("savedAt").and_then(Value::as_i64) })
    }).await
}

#[derive(Clone)]
pub(crate) struct AssistantNativeRoute {
    pub key: String,
    pub operation_id: String,
    pub machine_id: String,
    pub environment_id: String,
    pub fingerprint: String,
    pub generation: String,
    pub host_instance: String,
    pub intent: Value,
    pub version: i64,
    pub proof: Option<Value>,
}

pub(crate) fn register_assistant_preparation(window: &tauri::Window, expected_page: &str, key: &str, operation_id: &str, version: i64) -> Result<(), String> {
    validate(key)?; validate(operation_id)?;
    crate::native_window_lifecycle::persistence_write(window, || {
        if page(window)? != expected_page { return Err("CANONICAL_PAGE_STALE".into()); }
        let store = window.app_handle().state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        durable(&db, || {
            let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
            let owned: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claims c JOIN canonical_claim_phases p ON p.scope=c.scope AND p.key=c.key AND p.operation_id=c.operation_id WHERE c.scope=?1 AND c.key=?2 AND c.operation_id=?3 AND c.window=?4 AND c.page=?5 AND p.phase='prepared')", params![ASSISTANT_SEND_SCOPE,key,operation_id,window.label(),expected_page], |r| r.get(0)).map_err(|e| e.to_string())?;
            let entry = read(&tx, ASSISTANT_SEND_SCOPE, key)?.ok_or("Assistant send intent is unavailable")?;
            if !owned || entry.version != version { return Err("Assistant send claim changed".into()); }
            let intent = entry.value.ok_or("Assistant send intent is unavailable")?;
            let request_key = intent.get("key").and_then(Value::as_str).ok_or("Assistant request identity is unavailable")?;
            let raw = serde_json::to_string(&intent).map_err(|e| e.to_string())?;
            let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
            tx.execute("INSERT OR IGNORE INTO assistant_native_preparations(key,operation_id,request_key,intent_version,intent_hash) VALUES(?1,?2,?3,?4,?5)", params![key,operation_id,request_key,version,hash]).map_err(|e| e.to_string())?;
            let valid: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM assistant_native_preparations WHERE key=?1 AND operation_id=?2 AND request_key=?3 AND intent_version=?4 AND intent_hash=?5 AND cancelled=0)", params![key,operation_id,request_key,version,hash], |r| r.get(0)).map_err(|e| e.to_string())?;
            if !valid { return Err("Assistant send preparation changed".into()); }
            tx.commit().map_err(|e| e.to_string())?; Ok(())
        })
    })
}

/// Binds the already persisted intent to the native-selected route before I/O.
pub(crate) fn prepare_assistant_send(
    window: &tauri::Window, expected_page: &str, key: &str, operation_id: &str,
    expected_version: i64, machine_id: &str, environment_id: &str, fingerprint: &str, generation: &str, host_instance: &str,
) -> Result<AssistantNativeRoute, String> {
    validate(key)?; validate(operation_id)?; validate(machine_id)?; validate(environment_id)?; validate(host_instance)?;
    if page(window)? != expected_page { return Err("CANONICAL_PAGE_STALE".into()); }
    crate::native_window_lifecycle::persistence_write(window, || {
    if page(window)? != expected_page { return Err("CANONICAL_PAGE_STALE".into()); }
    let store = window.app_handle().state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    durable(&db, || {
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let owner: Option<(String,String,String)> = tx.query_row(
            "SELECT operation_id,window,page FROM canonical_claims WHERE scope=?1 AND key=?2",
            params![ASSISTANT_SEND_SCOPE,key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
        ).optional().map_err(|e| e.to_string())?;
        if owner != Some((operation_id.to_owned(),window.label().to_owned(),expected_page.to_owned())) { return Err("CANONICAL_CLAIM_HELD".into()); }
        let entry = read(&tx, ASSISTANT_SEND_SCOPE, key)?.ok_or("Assistant send intent is unavailable")?;
        if entry.version != expected_version { return Err("Assistant send intent changed".into()); }
        let intent = entry.value.ok_or("Assistant send intent is unavailable")?;
        let parts: Vec<String> = serde_json::from_str(key).map_err(|_| "Invalid assistant send identity")?;
        if parts.len() != 2 || parts[0] != environment_id || intent.get("environmentId").and_then(Value::as_str) != Some(environment_id) ||
            intent.get("text").and_then(Value::as_str).is_none_or(str::is_empty) ||
            intent.get("key").and_then(Value::as_str).is_none_or(str::is_empty) { return Err("Invalid assistant send identity".into()); }
        let draft_version = intent.get("draftVersion").and_then(Value::as_i64).ok_or("Assistant draft version is unavailable")?;
        let draft = read(&tx, ASSISTANT_DRAFT_SCOPE, key)?.ok_or("Assistant draft is unavailable")?;
        if draft.version != draft_version || draft.value.as_ref().and_then(Value::as_str).map(str::trim) != intent.get("text").and_then(Value::as_str) {
            return Err("Assistant draft changed before dispatch".into());
        }
        let raw = serde_json::to_string(&intent).map_err(|e| e.to_string())?;
        let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
        let prepared: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM assistant_native_preparations WHERE key=?1 AND operation_id=?2 AND intent_version=?3 AND intent_hash=?4 AND cancelled=0)", params![key,operation_id,expected_version,hash], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !prepared { return Err("Assistant send preparation is unavailable".into()); }
        let request_key = intent.get("key").and_then(Value::as_str).ok_or("Assistant request identity is unavailable")?;
        let inserted = tx.execute("INSERT OR IGNORE INTO assistant_native_send_routes(key,operation_id,request_key,machine_id,environment_id,route_fingerprint,route_generation,host_instance,intent,intent_version) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![key,operation_id,request_key,machine_id,environment_id,fingerprint,generation,host_instance,raw,expected_version]).map_err(|e| e.to_string())?;
        if inserted != 1 { return Err("Assistant send was already admitted; check its original Host".into()); }
        let updated = tx.execute("UPDATE canonical_claim_phases SET phase='submitted' WHERE scope=?1 AND key=?2 AND operation_id=?3 AND phase='prepared'",
            params![ASSISTANT_SEND_SCOPE,key,operation_id]).map_err(|e| e.to_string())?;
        if updated != 1 { return Err("Assistant send claim is unavailable".into()); }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(AssistantNativeRoute { key:key.to_owned(), operation_id:operation_id.to_owned(), machine_id:machine_id.to_owned(), environment_id:environment_id.to_owned(), fingerprint:fingerprint.to_owned(), generation:generation.to_owned(), host_instance:host_instance.to_owned(), intent, version:expected_version, proof:None })
    })
    })
}

pub(crate) fn assistant_send_route(window: &tauri::Window, key: &str) -> Result<AssistantNativeRoute, String> {
    validate(key)?;
    let store = window.app_handle().state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    let row: Option<(String,String,String,String,String,String,String,i64,Option<String>)> = db.query_row(
        "SELECT r.operation_id,r.machine_id,r.environment_id,r.route_fingerprint,r.route_generation,r.host_instance,r.intent,r.intent_version,r.proof FROM assistant_native_send_routes r JOIN canonical_claims c ON c.scope=?1 AND c.key=r.key AND c.operation_id=r.operation_id WHERE r.key=?2",
        params![ASSISTANT_SEND_SCOPE,key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)),
    ).optional().map_err(|e| e.to_string())?;
    let (operation_id,machine_id,environment_id,fingerprint,generation,host_instance,raw,version,proof) = row.ok_or("The original Host route is unavailable; the send remains held")?;
    let entry = read(&db, ASSISTANT_SEND_SCOPE, key)?.ok_or("Assistant send intent is unavailable")?;
    let intent: Value = serde_json::from_str(&raw).map_err(|_| "Invalid assistant send evidence")?;
    if entry.version != version || entry.value.as_ref() != Some(&intent) { return Err("Assistant send evidence changed".into()); }
    Ok(AssistantNativeRoute { key:key.to_owned(),operation_id,machine_id,environment_id,fingerprint,generation,host_instance,intent,version,
        proof:proof.map(|raw| serde_json::from_str(&raw).map_err(|_| "Invalid assistant receipt")).transpose()? })
}

pub(crate) fn assistant_send_settled(window: &tauri::Window, key: &str, operation_id: &str, request_key: Option<&str>) -> Result<bool, String> {
    validate(key)?; validate(operation_id)?;
    let store = window.app_handle().state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    db.query_row("SELECT EXISTS(SELECT 1 FROM assistant_native_send_routes r JOIN canonical_claim_settlements s ON s.scope=?1 AND s.key=r.key AND s.operation_id=r.operation_id WHERE r.key=?2 AND r.operation_id=?3 AND (?4 IS NULL OR r.request_key=?4) AND r.proof IS NOT NULL)",
        params![ASSISTANT_SEND_SCOPE,key,operation_id,request_key], |row| row.get(0)).map_err(|e| e.to_string())
}

pub(crate) fn assistant_send_not_sent(window: &tauri::Window, key: &str, operation_id: &str, request_key: &str) -> Result<bool, String> {
    validate(key)?; validate(operation_id)?; validate(request_key)?;
    let store = window.app_handle().state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    db.query_row("SELECT EXISTS(SELECT 1 FROM assistant_native_preparations a JOIN canonical_claim_settlements s ON s.scope=?1 AND s.key=a.key AND s.operation_id=a.operation_id WHERE a.key=?2 AND a.operation_id=?3 AND a.request_key=?4 AND a.cancelled=1)", params![ASSISTANT_SEND_SCOPE,key,operation_id,request_key], |row| row.get(0)).map_err(|e| e.to_string())
}

/// Cancels only a native-registered preparation that cannot have reached Host I/O.
pub(crate) fn release_prepared_assistant(window: &tauri::Window, expected_page: &str, key: &str, request_key: &str, operation_id: Option<&str>) -> Result<bool, String> {
    validate(key)?; validate(request_key)?;
    crate::native_window_lifecycle::persistence_write(window, || {
        if page(window)? != expected_page { return Err("CANONICAL_PAGE_STALE".into()); }
        let store = window.app_handle().state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        durable(&db, || {
            let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
            let owner: Option<(String,String,String)> = tx.query_row("SELECT c.operation_id,c.window,c.page FROM canonical_claims c JOIN canonical_claim_phases p ON p.scope=c.scope AND p.key=c.key AND p.operation_id=c.operation_id JOIN assistant_native_preparations a ON a.key=c.key AND a.operation_id=c.operation_id WHERE c.scope=?1 AND c.key=?2 AND p.phase='prepared' AND a.cancelled=0 AND NOT EXISTS(SELECT 1 FROM assistant_native_send_routes r WHERE r.key=c.key AND r.operation_id=c.operation_id)", params![ASSISTANT_SEND_SCOPE,key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e| e.to_string())?;
            let Some((op,owner_window,owner_page)) = owner else { return Ok(false); };
            if operation_id.is_some_and(|expected| expected != op.as_str()) { return Err("The original send identity changed".into()); }
            let entry = read(&tx, ASSISTANT_SEND_SCOPE, key)?.ok_or("Assistant send intent is unavailable")?;
            let intent = entry.value.as_ref().ok_or("Assistant send intent is unavailable")?;
            if intent.get("key").and_then(Value::as_str) != Some(request_key) { return Err("The original send identity changed".into()); }
            let raw = serde_json::to_string(intent).map_err(|e| e.to_string())?;
            let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
            let exact: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM assistant_native_preparations WHERE key=?1 AND operation_id=?2 AND intent_version=?3 AND intent_hash=?4 AND cancelled=0)", params![key,op,entry.version,hash], |r| r.get(0)).map_err(|e| e.to_string())?;
            if !exact { return Err("Assistant send preparation changed".into()); }
            let next = entry.version.checked_add(1).filter(|value| *value <= MAX_SAFE_COUNTER).ok_or("Canonical version exhausted")?;
            tx.execute("UPDATE canonical_values SET version=?3,value=NULL WHERE scope=?1 AND key=?2", params![ASSISTANT_SEND_SCOPE,key,next]).map_err(|e| e.to_string())?;
            if tx.execute("INSERT INTO canonical_revisions(scope,revision) VALUES(?1,1) ON CONFLICT(scope) DO UPDATE SET revision=revision+1 WHERE revision<9007199254740991", params![ASSISTANT_SEND_SCOPE]).map_err(|e| e.to_string())? != 1 { return Err("Canonical revision exhausted".into()); }
            tx.execute("UPDATE assistant_native_preparations SET cancelled=1 WHERE key=?1 AND operation_id=?2", params![key,op]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3", params![ASSISTANT_SEND_SCOPE,key,op]).map_err(|e| e.to_string())?;
            tx.execute("INSERT OR IGNORE INTO canonical_claim_settlements(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)", params![ASSISTANT_SEND_SCOPE,key,op,owner_window,owner_page]).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?; Ok(true)
        })
    })
}

pub(crate) fn record_assistant_proof(window: &tauri::Window, expected_page: &str, route: &AssistantNativeRoute, proof: &Value) -> Result<(), String> {
    crate::native_window_lifecycle::persistence_write(window, || {
    if page(window)? != expected_page { return Err("CANONICAL_PAGE_STALE".into()); }
    let store = window.app_handle().state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    durable(&db, || {
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let entry = read(&tx, ASSISTANT_SEND_SCOPE, &route.key)?.ok_or("Assistant send intent is unavailable")?;
        if entry.version != route.version || entry.value.as_ref() != Some(&route.intent) { return Err("Assistant send evidence changed".into()); }
        let raw = serde_json::to_string(proof).map_err(|e| e.to_string())?;
        let changed = tx.execute("UPDATE assistant_native_send_routes SET proof=?3 WHERE key=?1 AND operation_id=?2 AND (proof IS NULL OR proof=?3)",
            params![route.key,route.operation_id,raw]).map_err(|e| e.to_string())?;
        if changed != 1 { return Err("Assistant receipt changed".into()); }
        tx.commit().map_err(|e| e.to_string())?; Ok(())
    })
    })
}

/// Commit verified Host completion, exact draft policy, and claim settlement together.
pub(crate) fn complete_assistant_send(window: &tauri::Window, expected_page: &str, route: &AssistantNativeRoute) -> Result<(), String> {
    crate::native_window_lifecycle::persistence_write(window, || {
    if page(window)? != expected_page { return Err("CANONICAL_PAGE_STALE".into()); }
    let store = window.app_handle().state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    let result = durable(&db, || {
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let proof: Option<String> = tx.query_row("SELECT proof FROM assistant_native_send_routes WHERE key=?1 AND operation_id=?2", params![route.key,route.operation_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?.flatten();
        if proof.is_none() { return Err("The original Host receipt is unavailable".into()); }
        let entry = read(&tx, ASSISTANT_SEND_SCOPE, &route.key)?.ok_or("Assistant send intent is unavailable")?;
        if entry.version != route.version || entry.value.as_ref() != Some(&route.intent) { return Err("Assistant send evidence changed".into()); }
        let owner: Option<(String,String,String)> = tx.query_row("SELECT operation_id,window,page FROM canonical_claims WHERE scope=?1 AND key=?2", params![ASSISTANT_SEND_SCOPE,route.key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e| e.to_string())?;
        let (operation_id, owner_window, owner_page) = owner.ok_or("Assistant send claim is unavailable")?;
        if operation_id != route.operation_id { return Err("Assistant send claim changed".into()); }
        let draft = read(&tx, ASSISTANT_DRAFT_SCOPE, &route.key)?.ok_or("Assistant draft is unavailable")?;
        let draft_text = draft.value.as_ref().and_then(Value::as_str).ok_or("Assistant draft requires recovery")?;
        let original_version = route.intent.get("draftVersion").and_then(Value::as_i64).ok_or("Assistant draft identity is unavailable")?;
        let sent_text = route.intent.get("text").and_then(Value::as_str).ok_or("Assistant send text is unavailable")?;
        if draft.version == original_version && draft_text.trim() == sent_text {
            let backup = serde_json::json!({"kind":"assistant-thread-draft","text":draft_text});
            let raw = serde_json::to_string(&backup).map_err(|e| e.to_string())?;
            preserve_legacy(&tx, ASSISTANT_DRAFT_SCOPE, &route.key, &raw)?;
            let next = draft.version.checked_add(1).filter(|value| *value <= MAX_SAFE_COUNTER).ok_or("Canonical version exhausted")?;
            tx.execute("UPDATE canonical_values SET version=?3,value='\"\"' WHERE scope=?1 AND key=?2", params![ASSISTANT_DRAFT_SCOPE,route.key,next]).map_err(|e| e.to_string())?;
            if tx.execute("INSERT INTO canonical_revisions(scope,revision) VALUES(?1,1) ON CONFLICT(scope) DO UPDATE SET revision=revision+1 WHERE revision < 9007199254740991", params![ASSISTANT_DRAFT_SCOPE]).map_err(|e| e.to_string())? != 1 { return Err("Canonical revision exhausted".into()); }
        }
        let next = entry.version.checked_add(1).filter(|value| *value <= MAX_SAFE_COUNTER).ok_or("Canonical version exhausted")?;
        tx.execute("UPDATE canonical_values SET version=?3,value=NULL WHERE scope=?1 AND key=?2", params![ASSISTANT_SEND_SCOPE,route.key,next]).map_err(|e| e.to_string())?;
        if tx.execute("INSERT INTO canonical_revisions(scope,revision) VALUES(?1,1) ON CONFLICT(scope) DO UPDATE SET revision=revision+1 WHERE revision < 9007199254740991", params![ASSISTANT_SEND_SCOPE]).map_err(|e| e.to_string())? != 1 { return Err("Canonical revision exhausted".into()); }
        tx.execute("DELETE FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3", params![ASSISTANT_SEND_SCOPE,route.key,route.operation_id]).map_err(|e| e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO canonical_claim_settlements(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)", params![ASSISTANT_SEND_SCOPE,route.key,route.operation_id,owner_window,owner_page]).map_err(|e| e.to_string())?;
        let raw_intent = serde_json::to_string(&route.intent).map_err(|e| e.to_string())?;
        let intent_hash = format!("sha256:{:x}", Sha256::digest(raw_intent.as_bytes()));
        tx.execute("UPDATE assistant_native_send_routes SET intent=?3 WHERE key=?1 AND operation_id=?2", params![route.key,route.operation_id,intent_hash]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?; Ok(())
    });
    if result.is_ok() {
        let revisions: Vec<(&str, i64)> = [ASSISTANT_SEND_SCOPE, ASSISTANT_DRAFT_SCOPE].into_iter().filter_map(|scope|
            db.query_row("SELECT revision FROM canonical_revisions WHERE scope=?1", params![scope], |r| r.get(0)).ok().map(|revision| (scope, revision))
        ).collect();
        drop(db);
        let app = window.app_handle();
        for (scope, revision) in revisions {
            for label in app.webview_windows().keys().filter(|label| crate::window::is_workspace_window(label)) {
                let _ = app.emit_to(label.as_str(), "canonical-store-changed", serde_json::json!({"scope":scope,"revision":revision}));
            }
        }
    }
    result
    })
}
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionCapability { shell_id: String, operation_id: String, page_token: String }
impl NativeSessionCapability { pub(crate) fn shell_id(&self) -> &str { &self.shell_id } }
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeProcessPurpose { kind: String, page_token: String }
pub(crate) fn admit_process_purpose(window: &tauri::Window, purpose: &NativeProcessPurpose) -> Result<PageAdmission, String> {
    if !matches!(purpose.kind.as_str(), "management" | "utility") { return Err("NATIVE_PROCESS_PURPOSE_INVALID".into()); }
    admit(window, &purpose.page_token)
}

/// Called at the native effect boundary, retaining admission through the
/// physical operation. The caller supplies the actual logical target from its
/// existing retained construction, never a parsed route suffix.
pub(crate) fn admit_session_effect(app: &tauri::AppHandle, window: &tauri::Window, target: &str, capability: &NativeSessionCapability) -> Result<PageAdmission, String> {
    if capability.shell_id != target { return Err("CANONICAL_SESSION_SCOPE_MISMATCH".into()); }
    let admission = admit(window, &capability.page_token)?;
    let store = app.state::<SessionStore>();
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    if page(window)? != capability.page_token { return Err("CANONICAL_PAGE_STALE".into()); }
    let valid: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claims c JOIN canonical_claim_phases p ON p.scope=c.scope AND p.key=c.key AND p.operation_id=c.operation_id WHERE c.scope=?1 AND c.key=?2 AND c.operation_id=?3 AND c.window=?4 AND c.page=?5 AND p.phase='submitted')", params![BINDING_SCOPE,target,capability.operation_id,window.label(),capability.page_token], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !valid { return Err("CANONICAL_SESSION_CLAIM_REQUIRED".into()); }
    Ok(admission)
}
#[tauri::command]
pub async fn canonical_store_page_token(window: tauri::Window) -> Result<String, String> {
    let captured = page(&window)?;
    crate::harness::run_blocking("canonical_store_page_token", move || {
        let mut entries = admissions().lock().map_err(|_| "CANONICAL_ADMISSION_UNAVAILABLE")?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        entries.entry(captured.clone()).or_insert(0);
        Ok(captured)
    }).await
}
#[tauri::command]
pub async fn canonical_store_get(window: tauri::Window, scope: String, key: String) -> Result<Option<Entry>, String>  {
    let captured_page = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_get", move || {
        let store = app.state::<SessionStore>();
        if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }

    validate(&scope)?; validate(&key)?;
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }
    read(&db, &scope, &key)

    }).await
}
#[tauri::command]
pub async fn canonical_store_receipt(window: tauri::Window, scope: String, operation_id: String) -> Result<Option<Outcome>, String> {
    validate(&scope)?; validate(&operation_id)?;
    let captured = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_receipt", move || {
        let store = app.state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        let result: Option<String> = db.query_row("SELECT result FROM canonical_operations WHERE scope=?1 AND operation_id=?2",params![scope,operation_id],|r| r.get(0)).optional().map_err(|e| e.to_string())?;
        result.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()
    }).await
}
#[tauri::command]
pub async fn canonical_store_legacy_list(window: tauri::Window, scope: String, key: String, after_hash: Option<String>, limit: usize) -> Result<Vec<LegacySource>, String> {
    validate(&scope)?; validate(&key)?;
    if let Some(ref hash) = after_hash { validate(hash)?; }
    if limit == 0 || limit > 128 { return Err("Legacy source list limit must be between 1 and 128".into()); }
    let captured = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_legacy_list", move || {
        let store = app.state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        let mut statement = db.prepare("SELECT hash,raw FROM canonical_legacy_raw WHERE scope=?1 AND key=?2 AND (?3 IS NULL OR hash>?3) ORDER BY hash LIMIT ?4").map_err(|e| e.to_string())?;
        let rows = statement.query_map(params![scope,key,after_hash,limit as i64], |row| Ok(LegacySource { hash: row.get(0)?, raw: row.get(1)? })).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
    }).await
}
#[tauri::command]
pub async fn canonical_store_read(window: tauri::Window, scope: String, keys: Vec<String>) -> Result<Page, String> {
    validate(&scope)?;
    if keys.len() > 1024 { return Err("Canonical read too large".into()); }
    for key in &keys { validate(key)?; }
    let captured = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_read", move || {
        let store = app.state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("Canonical owner page has changed".into()); }
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Deferred).map_err(|e| e.to_string())?;
        let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_revisions WHERE scope=?1),0)",params![scope],|r| r.get(0)).map_err(|e| e.to_string())?;
        if !(0..=MAX_SAFE_COUNTER).contains(&revision) { return Err("Canonical revision is invalid".into()); }
        let mut entries = Vec::new();
        for key in &keys { if let Some(entry) = read(&tx,&scope,key)? { entries.push(entry); } }
        Ok(Page { entries,revision })
    }).await
}
#[tauri::command]
pub async fn canonical_store_list(window: tauri::Window, scope: String, after: Option<String>, limit: usize, expected_revision: Option<i64>) -> Result<Page, String>  {
    let captured_page = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_list", move || {
        let store = app.state::<SessionStore>();
        if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }

    validate(&scope)?;
    if let Some(ref key) = after { validate(key)?; }
    if limit == 0 || limit > 512 { return Err("Canonical list limit must be between 1 and 512".into()); }
    let db = store.conn.lock().map_err(|_| "Session store is locked")?;
    if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }
    let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Deferred).map_err(|e| e.to_string())?;
    let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_revisions WHERE scope=?1),0)",params![scope],|r| r.get(0)).map_err(|e| e.to_string())?;
    if !(0..=MAX_SAFE_COUNTER).contains(&revision) { return Err("Canonical revision is invalid".into()); }
    if expected_revision.is_some_and(|expected| expected != revision) { return Err("CANONICAL_LIST_STALE".into()); }
    let mut statement = tx.prepare("SELECT key,version,value FROM canonical_values WHERE scope=?1 AND (?2 IS NULL OR key > ?2) ORDER BY key LIMIT ?3").map_err(|e| e.to_string())?;
    let rows = statement.query_map(params![scope,after,limit as i64], |row| Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,Option<String>>(2)?))).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for row in rows {
        let (key,version,raw) = row.map_err(|e| e.to_string())?;
        if version < 1 || version > MAX_SAFE_COUNTER { return Err("Canonical version is invalid".into()); }
        entries.push(Entry { key,version,value: raw.map(|v| serde_json::from_str(&v).map_err(|e| e.to_string())).transpose()? });
    }
    Ok(Page { entries, revision })

    }).await
}

/// Inspect sizes before allocating any value; oversize evidence stays untouched.
#[tauri::command]
pub async fn canonical_store_list_bounded(window: tauri::Window, scope: String, prefix: String, after: Option<String>, limit: usize, max_bytes: usize, expected_revision: Option<i64>) -> Result<BoundedPage, String> {
    validate(&scope)?; validate(&prefix)?;
    if limit == 0 || limit > 128 || !(1024..=2 * 1024 * 1024).contains(&max_bytes) || after.as_ref().is_some_and(|key| !key.starts_with(&prefix)) { return Err("Invalid canonical bounded cursor".into()); }
    let captured = page(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_list_bounded", move || {
        let store = app.state::<SessionStore>();
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Deferred).map_err(|e| e.to_string())?;
        let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_revisions WHERE scope=?1),0)", params![scope], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !(0..=MAX_SAFE_COUNTER).contains(&revision) { return Err("Canonical revision is invalid".into()); }
        if expected_revision.is_some_and(|expected| expected != revision) { return Err("CANONICAL_LIST_STALE".into()); }
        let mut statement = tx.prepare("SELECT key,version,octet_length(value) FROM canonical_values WHERE scope=?1 AND key>=?2 AND (?3 IS NULL OR key>?3) ORDER BY key LIMIT ?4").map_err(|e| e.to_string())?;
        let mut rows = statement.query(params![scope,prefix,after,(limit + 1) as i64]).map_err(|e| e.to_string())?;
        let mut entries = Vec::new();
        let mut used = 256usize;
        let mut has_more = false;
        let mut oversized = None;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let key: String = row.get(0).map_err(|e| e.to_string())?;
            if !key.starts_with(&prefix) { break; }
            let version: i64 = row.get(1).map_err(|e| e.to_string())?;
            if version < 1 || version > MAX_SAFE_COUNTER { return Err("Canonical version is invalid".into()); }
            let bytes: Option<i64> = row.get(2).map_err(|e| e.to_string())?;
            let size = key.len().checked_add(bytes.unwrap_or(0).try_into().map_err(|_| "Invalid canonical record size")?).and_then(|value| value.checked_add(128)).ok_or("Invalid canonical record size")?;
            if size > max_bytes && entries.is_empty() {
                oversized = Some(OversizedRecord { key, version, bytes: bytes.unwrap_or(0) });
                break;
            }
            if entries.len() == limit || used.checked_add(size).is_none_or(|total| total > max_bytes) { has_more = true; break; }
            let raw: Option<String> = tx.query_row("SELECT value FROM canonical_values WHERE scope=?1 AND key=?2", params![scope,key], |r| r.get(0)).map_err(|e| e.to_string())?;
            let entry = Entry { key, version, value: raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string())).transpose()? };
            let encoded = serde_json::to_vec(&entry).map_err(|e| e.to_string())?.len().checked_add(1).ok_or("Invalid canonical record size")?;
            if used.checked_add(encoded).is_none_or(|total| total > max_bytes) {
                if entries.is_empty() {
                    oversized = Some(OversizedRecord { key: entry.key, version: entry.version, bytes: bytes.unwrap_or(0) });
                    break;
                }
                has_more = true;
                break;
            }
            entries.push(entry);
            used += encoded;
        }
        if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
        Ok(BoundedPage { entries, revision, has_more, oversized })
    }).await
}

/// Export the exact stored JSON record without copying its body into the renderer.
#[tauri::command]
pub async fn outbox_export_oversize(window: tauri::Window, page_token: String, key: String, version: i64, expected_revision: i64) -> Result<serde_json::Value, String> {
    use std::io::{Read, Write};
    use tauri_plugin_dialog::DialogExt;
    validate(&key)?;
    if !(key.starts_with("entries:bycoda.remote-command.v1:") || key.starts_with("legacy:bycoda.remote-command.v1:")) || version < 1 || version > MAX_SAFE_COUNTER || expected_revision < 0 || expected_revision > MAX_SAFE_COUNTER {
        return Err("Invalid saved request identity".into());
    }
    let admission = admit(&window, &page_token)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("outbox_export_oversize", move || {
        let _admission = admission;
        if page(&window)? != page_token { return Err("CANONICAL_PAGE_STALE".into()); }
        let selected = app.dialog().file().set_title("Export saved request record").set_file_name("bycoda-saved-request.json").add_filter("JSON", &["json"]).set_parent(&window).blocking_save_file();
        let Some(selected) = selected else { return Ok(serde_json::json!({"cancelled":true})); };
        let destination = selected.into_path().map_err(|_| "The selected destination is unavailable")?;
        let parent = destination.parent().ok_or("The selected destination has no parent")?;
        if destination.exists() { return Err("Choose an unused file name; no existing file was changed".into()); }
        let db_path = {
            let store = app.state::<SessionStore>();
            let db = store.conn.lock().map_err(|_| "Session store is locked")?;
            db.path().filter(|path| !path.is_empty()).ok_or("Saved request export is unavailable for this store")?.to_owned()
        };
        let db = Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|_| "Cannot open saved request evidence")?;
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Deferred).map_err(|e| e.to_string())?;
        let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_revisions WHERE scope='remote-outbox.v2'),0)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if revision != expected_revision { return Err("Saved requests changed. Review the request again before exporting".into()); }
        let (row_id, bytes): (i64,i64) = tx.query_row("SELECT rowid,octet_length(value) FROM canonical_values WHERE scope='remote-outbox.v2' AND key=?1 AND version=?2 AND value IS NOT NULL", params![key,version], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|_| "The saved request changed or is unavailable")?;
        if bytes < 0 || bytes > 512 * 1024 * 1024 { return Err("The saved request exceeds the export limit; its original bytes remain preserved".into()); }
        let temporary = parent.join(format!(".bycoda-request-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<serde_json::Value, String> {
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Cannot create the selected export")?;
            let mut blob = tx.blob_open(rusqlite::MAIN_DB, "canonical_values", "value", row_id, true).map_err(|_| "Cannot read the saved request")?;
            let mut buffer = [0u8; 64 * 1024];
            let mut digest = Sha256::new();
            let started = std::time::Instant::now();
            let mut written = 0u64;
            loop {
                if started.elapsed() > std::time::Duration::from_secs(120) { return Err("Export timed out; the original request remains preserved".into()); }
                let count = blob.read(&mut buffer).map_err(|_| "Cannot read the saved request")?;
                if count == 0 { break; }
                file.write_all(&buffer[..count]).map_err(|_| "Cannot write the selected export")?;
                digest.update(&buffer[..count]);
                written += count as u64;
            }
            if written != bytes as u64 { return Err("The saved request changed during export".into()); }
            file.sync_all().map_err(|_| "Cannot complete the selected export")?;
            drop(file);
            if page(&window)? != page_token { return Err("CANONICAL_PAGE_STALE".into()); }
            std::fs::hard_link(&temporary, &destination).map_err(|_| "Cannot publish the export; choose an unused file on a supported local drive")?;
            std::fs::remove_file(&temporary).map_err(|_| "The export was saved, but its temporary copy could not be removed")?;
            if let Ok(directory) = std::fs::File::open(parent) { let _ = directory.sync_all(); }
            Ok(serde_json::json!({"cancelled":false,"bytes":written,"sha256":format!("{:x}",digest.finalize())}))
        })();
        if result.is_err() { let _ = std::fs::remove_file(&temporary); }
        result
    }).await
}
#[tauri::command]
pub async fn canonical_store_transaction(window: tauri::Window, page_token: String, scope: String, operation_id: String, checks: Vec<Check>, writes: Vec<Write>, legacy: Vec<Legacy>, claim: Option<ClaimRequest>, expected_revision: Option<i64>) -> Result<Outcome, String>  {
    let admission = admit(&window, &page_token)?;
    let captured_page = admission.page.clone();
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_transaction", move || {
        let _admission = admission;
        let store = app.state::<SessionStore>();
        if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }

    validate(&scope)?; validate(&operation_id)?;
    let captured = captured_page.clone();
    if checks.len() > 1024 || writes.len() > 1024 || legacy.len() > 1024 { return Err("Canonical transaction too large".into()); }
    let mut keys = std::collections::HashSet::new();
    for check in &checks { validate(&check.key)?; if !keys.insert(&check.key) { return Err("Duplicate canonical check".into()); } }
    let mut write_keys = std::collections::HashSet::new();
    for write in &writes { validate(&write.key)?; if !write_keys.insert(&write.key) || !keys.contains(&write.key) { return Err("Every canonical write requires one unique check".into()); } }
    for item in &legacy { validate(&item.key)?; if !keys.contains(&item.key) { return Err("Legacy import requires a version check".into()); } }
    if let Some(ref claim) = claim { validate(&claim.key)?; validate(&claim.operation_id)?; if claim.mode != "acquire" && claim.mode != "require" { return Err("Invalid canonical claim mode".into()); } }
    let request_raw = serde_json::to_string(&(&checks,&writes,&legacy,&claim,expected_revision)).map_err(|e| e.to_string())?;
    let request = format!("sha256:{:x}", Sha256::digest(request_raw.as_bytes()));
    let result = crate::native_window_lifecycle::persistence_write(&window, || {
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("Canonical owner page has changed".into()); }
        durable(&db, || {
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let existing: Option<(String,String)> = tx.query_row("SELECT request,result FROM canonical_operations WHERE scope=?1 AND operation_id=?2",params![scope,operation_id],|r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
        if let Some((prior,result)) = existing {
            if prior != request && prior != request_raw { return Err("Canonical operation ID reused with different request".into()); }
            return serde_json::from_str(&result).map_err(|e| e.to_string());
        }
        let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_revisions WHERE scope=?1),0)",params![scope],|r| r.get(0)).map_err(|e| e.to_string())?;
        if !(0..=MAX_SAFE_COUNTER).contains(&revision) { return Err("Canonical revision is invalid".into()); }
        let mut current = Vec::new(); let mut applied = expected_revision.is_none_or(|expected| expected == revision);
        for check in &checks {
            let entry = read(&tx,&scope,&check.key)?;
            if entry.as_ref().map(|e| e.version) != check.version { applied = false; }
            if let Some(entry) = entry { current.push(entry); }
        }
        for item in &legacy {
                if item.conflict_only && applied { continue; }
                preserve_legacy(&tx, &scope, &item.key, &item.raw)?;
        }
        if applied {
            if let Some(ref claim) = claim {
                if claim.mode == "acquire" {
                    let settled: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claim_settlements WHERE scope=?1 AND key=?2 AND operation_id=?3)",params![scope,claim.key,claim.operation_id],|r| r.get(0)).map_err(|e| e.to_string())?;
                    if settled { return Err("Canonical claim operation is already settled".into()); }
                    tx.execute("INSERT OR IGNORE INTO canonical_claims(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)",params![scope,claim.key,claim.operation_id,window.label(),captured]).map_err(|e| e.to_string())?;
                    tx.execute("INSERT OR IGNORE INTO canonical_claim_phases(scope,key,operation_id,phase) SELECT ?1,?2,?3,'prepared' WHERE EXISTS(SELECT 1 FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5)",params![scope,claim.key,claim.operation_id,window.label(),captured]).map_err(|e| e.to_string())?;
                }
                let owned: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5)",params![scope,claim.key,claim.operation_id,window.label(),captured],|r| r.get(0)).map_err(|e| e.to_string())?;
                if !owned { return Err("CANONICAL_CLAIM_HELD".into()); }
            }
            for write in &writes {
                let owner: Option<(String,String,String)> = tx.query_row("SELECT operation_id,window,page FROM canonical_claims WHERE scope=?1 AND key=?2",params![scope,write.key],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e| e.to_string())?;
                if let Some((op,owner_window,owner_page)) = owner {
                    if scope == ASSISTANT_SEND_SCOPE {
                        let phase: Option<String> = tx.query_row("SELECT phase FROM canonical_claim_phases WHERE scope=?1 AND key=?2 AND operation_id=?3", params![scope,write.key,op], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
                        if phase.as_deref() != Some("prepared") { return Err("ASSISTANT_NATIVE_RECEIPT_REQUIRED".into()); }
                    }
                    if claim.as_ref().is_none_or(|c| c.key != write.key || c.operation_id != op) || owner_window != window.label() || owner_page != captured { return Err("CANONICAL_CLAIM_HELD".into()); }
                }
            }
            if !writes.is_empty() {
                tx.execute("INSERT INTO canonical_revisions(scope,revision) VALUES(?1,1) ON CONFLICT(scope) DO UPDATE SET revision=revision+1 WHERE revision < 9007199254740991",params![scope]).map_err(|e| e.to_string()).and_then(|n| if n == 1 { Ok(()) } else { Err("Canonical revision exhausted".into()) })?;
            }
            current.clear();
            for write in &writes {
                let previous = read(&tx,&scope,&write.key)?;
                let version = previous.map_or(1, |e| e.version.checked_add(1).unwrap_or(i64::MAX));
                if version > MAX_SAFE_COUNTER { return Err("Canonical version exhausted".into()); }
                let raw = write.value.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?;
                tx.execute("INSERT INTO canonical_values(scope,key,version,value) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,key) DO UPDATE SET version=excluded.version,value=excluded.value",params![scope,write.key,version,raw]).map_err(|e| e.to_string())?;
                current.push(Entry { key: write.key.clone(),version,value: write.value.clone() });
            }
        }
        let revision: i64 = tx.query_row("SELECT COALESCE((SELECT revision FROM canonical_revisions WHERE scope=?1),0)",params![scope],|r| r.get(0)).map_err(|e| e.to_string())?;
        let outcome = Outcome { applied, entries: current, revision, compacted: false };
        let compact = Outcome { applied, revision, compacted: true, entries: outcome.entries.iter().map(|entry| Entry {
            key: entry.key.clone(), version: entry.version, value: None,
        }).collect() };
        let result = serde_json::to_string(&compact).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO canonical_operations(scope,operation_id,request,result,window,page) VALUES(?1,?2,?3,?4,?5,?6)",params![scope,operation_id,request,result,window.label(),captured]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?; Ok(outcome)
        })
    });
    if let Ok(outcome) = &result {
        if outcome.applied && !writes.is_empty() {
            for label in app.webview_windows().keys().filter(|label| crate::window::is_workspace_window(label)) {
                let _ = app.emit_to(label.as_str(), "canonical-store-changed", serde_json::json!({"scope":scope.clone(),"revision":outcome.revision}));
            }
        }
    }
    result

    }).await
}
#[tauri::command]
pub async fn canonical_store_claim(window: tauri::Window, page_token: String, scope: String, key: String, operation_id: String) -> Result<Claim, String>  {
    let admission = admit(&window, &page_token)?;
    let captured_page = admission.page.clone();
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_claim", move || {
        let _admission = admission;
        let store = app.state::<SessionStore>();
        if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }

    validate(&scope)?; validate(&key)?; validate(&operation_id)?; let captured = captured_page.clone();
    crate::native_window_lifecycle::persistence_write(&window, || {
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("Canonical owner page has changed".into()); }
        durable(&db, || {
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let settled: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claim_settlements WHERE scope=?1 AND key=?2 AND operation_id=?3)",params![scope,key,operation_id],|r| r.get(0)).map_err(|e| e.to_string())?;
        if settled { return Err("Canonical claim operation is already settled".into()); }
        tx.execute("INSERT OR IGNORE INTO canonical_claims(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)",params![scope,key,operation_id,window.label(),captured]).map_err(|e| e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO canonical_claim_phases(scope,key,operation_id,phase) SELECT ?1,?2,?3,'prepared' WHERE EXISTS(SELECT 1 FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5)",params![scope,key,operation_id,window.label(),captured]).map_err(|e| e.to_string())?;
        let (op,owner_window,owner_page): (String,String,String) = tx.query_row("SELECT operation_id,window,page FROM canonical_claims WHERE scope=?1 AND key=?2",params![scope,key],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e| e.to_string())?;
        let owned = op == operation_id && owner_window == window.label() && owner_page == captured;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Claim { owned,operation_id:op,window:owner_window,page:owner_page })
        })
    })

    }).await
}
#[tauri::command]
pub async fn canonical_store_settle(window: tauri::Window, page_token: String, scope: String, key: String, operation_id: String) -> Result<bool, String>  {
    let admission = admit(&window, &page_token)?;
    let captured_page = admission.page.clone();
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_settle", move || {
        let _admission = admission;
        let store = app.state::<SessionStore>();
        if page(&window)? != captured_page { return Err("Canonical owner page has changed".into()); }

    validate(&scope)?; validate(&key)?; validate(&operation_id)?; let captured = captured_page.clone();
    binding_quiescent(&app, &scope, &key, || crate::native_window_lifecycle::persistence_write(&window, || {
        let db = store.conn.lock().map_err(|_| "Session store is locked")?;
        if page(&window)? != captured { return Err("Canonical owner page has changed".into()); }
        durable(&db, || {
        let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let prior: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claim_settlements WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5)",params![scope,key,operation_id,window.label(),captured],|r| r.get(0)).map_err(|e| e.to_string())?;
        if prior { return Ok(true); }
        if scope == ASSISTANT_SEND_SCOPE {
            let phase: Option<String> = tx.query_row("SELECT phase FROM canonical_claim_phases WHERE scope=?1 AND key=?2 AND operation_id=?3", params![scope,key,operation_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
            if phase.as_deref() != Some("prepared") { return Err("ASSISTANT_NATIVE_RECEIPT_REQUIRED".into()); }
        }
        let count = tx.execute("DELETE FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5",params![scope,key,operation_id,window.label(),captured]).map_err(|e| e.to_string())?;
        if count == 1 { tx.execute("INSERT INTO canonical_claim_settlements(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)",params![scope,key,operation_id,window.label(),captured]).map_err(|e| e.to_string())?; }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count == 1)
        })
    }))

    }).await
}

/// Persist before an external side effect. Submitted claims never expire or
/// transfer automatically; their outcome must be reconciled by the domain.
#[tauri::command]
pub async fn canonical_store_mark_submitted(window: tauri::Window, page_token: String, scope: String, key: String, operation_id: String) -> Result<(), String> {
    validate(&scope)?; validate(&key)?; validate(&operation_id)?;
    let admission = admit(&window, &page_token)?;
    let captured = admission.page.clone();
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_mark_submitted", move || {
        let _admission = admission;
        crate::native_window_lifecycle::persistence_write(&window, || {
            let store = app.state::<SessionStore>();
            let db = store.conn.lock().map_err(|_| "Session store is locked")?;
            if page(&window)? != captured { return Err("Canonical owner page has changed".into()); }
            durable(&db, || {
                let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
                let changed = tx.execute("UPDATE canonical_claim_phases SET phase='submitted' WHERE scope=?1 AND key=?2 AND operation_id=?3 AND phase IN ('prepared','submitted') AND EXISTS(SELECT 1 FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5)",params![scope,key,operation_id,window.label(),captured]).map_err(|e| e.to_string())?;
                if changed != 1 { return Err("CANONICAL_CLAIM_HELD".into()); }
                tx.commit().map_err(|e| e.to_string())?;
                Ok(())
            })
        })
    }).await
}

/// Recover only a prepared claim when this process has positively observed its
/// issuer retire and every admitted canonical operation for that page finish.
/// Unknown pages (including pages from a previous process) are never inferred
/// retired from absence in this registry.
#[tauri::command]
pub async fn canonical_store_recover(window: tauri::Window, page_token: String, scope: String, key: String, operation_id: String) -> Result<bool, String> {
    validate(&scope)?; validate(&key)?; validate(&operation_id)?;
    let admission = admit(&window, &page_token)?;
    let captured = admission.page.clone();
    let app = window.app_handle().clone();
    crate::harness::run_blocking("canonical_store_recover", move || {
        let _admission = admission;
        binding_quiescent(&app, &scope, &key, || crate::native_window_lifecycle::persistence_write(&window, || {
            // Lock ordering: admissions before store. Other commands release the
            // store before dropping their admission guard.
            let entries = admissions().lock().map_err(|_| "CANONICAL_ADMISSION_UNAVAILABLE")?;
            if page(&window)? != captured { return Err("CANONICAL_PAGE_STALE".into()); }
            let store = app.state::<SessionStore>();
            let db = store.conn.lock().map_err(|_| "Session store is locked")?;
            durable(&db, || {
                let tx = rusqlite::Transaction::new_unchecked(&db, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
                let prior: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM canonical_claim_recoveries WHERE scope=?1 AND key=?2 AND operation_id=?3)",params![scope,key,operation_id],|r| r.get(0)).map_err(|e| e.to_string())?;
                if prior { return Ok(true); }
                let owner: Option<(String,String,String)> = tx.query_row("SELECT c.window,c.page,p.phase FROM canonical_claims c JOIN canonical_claim_phases p ON p.scope=c.scope AND p.key=c.key AND p.operation_id=c.operation_id WHERE c.scope=?1 AND c.key=?2 AND c.operation_id=?3",params![scope,key,operation_id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e| e.to_string())?;
                let Some((owner_window, owner_page, phase)) = owner else { return Ok(false); };
                if phase != "prepared" || entries.get(&owner_page) != Some(&0) || !matches!(crate::harness::page_retirement_status(&owner_page), crate::harness::PageRetirement::Confirmed) { return Ok(false); }
                let removed = tx.execute("DELETE FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5",params![scope,key,operation_id,owner_window,owner_page]).map_err(|e| e.to_string())?;
                if removed != 1 { return Ok(false); }
                tx.execute("INSERT INTO canonical_claim_settlements(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)",params![scope,key,operation_id,owner_window,owner_page]).map_err(|e| e.to_string())?;
                tx.execute("INSERT INTO canonical_claim_recoveries(scope,key,operation_id,owner_page,recovered_by) VALUES(?1,?2,?3,?4,?5)",params![scope,key,operation_id,owner_page,captured]).map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
                Ok(true)
            })
        }))
    }).await
}
