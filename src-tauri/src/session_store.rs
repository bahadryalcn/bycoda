use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

mod content_search;
pub(crate) mod incremental;
pub mod usage;
pub use content_search::{ContentSearchOptions, ContentSearchResult};

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  harness TEXT NOT NULL,
  model TEXT NOT NULL,
  model_settings TEXT NOT NULL DEFAULT '{}',
  runtime_mode TEXT NOT NULL,
  title TEXT NOT NULL,
  provider_session_id TEXT,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_cwd_updated_idx
  ON sessions (cwd, updated_at DESC);
"#;

pub struct SessionStore {
    conn: Mutex<Connection>,
    read_conn: Mutex<Option<Connection>>,
    /// Query-only connection for the UI's list/get reads. Search holds
    /// `read_conn` for its whole scan, so sharing it would queue these behind
    /// a search. `None` for in-memory stores, which fall back to `conn`.
    list_conn: Mutex<Option<Connection>>,
    /// One search-index builder at a time: the startup pass and a search both
    /// run `content_search::sync_index`, and indexing a session twice is waste.
    search_index_lock: Mutex<()>,
    search_background_queued: AtomicBool,
    legacy_page_cache: Mutex<incremental::LegacyPageCache>,
}

impl SessionStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        // NORMAL in WAL mode survives an app crash; only an OS crash or power
        // loss can drop the last commits (never corrupts), and skips a WAL
        // fsync on every autocommit write. The size limit truncates the WAL
        // back down after each checkpoint reset; without it one write burst
        // (an index rebuild, a migration) left a 700 MB file behind for good.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
             PRAGMA journal_size_limit = 67108864;",
        )
        .map_err(|e| e.to_string())?;
        migrate(&conn).map_err(|e| e.to_string())?;
        crate::ssh_group_defaults::migrate(&conn)?;
        crate::worktrees::reconcile_removals(&conn)?;
        let open_reader = || -> Result<Connection, String> {
            let reader = Connection::open(&path).map_err(|e| e.to_string())?;
            reader
                .execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;")
                .map_err(|e| e.to_string())?;
            Ok(reader)
        };
        let read_conn = open_reader()?;
        let list_conn = open_reader()?;
        Ok(Self {
            conn: Mutex::new(conn),
            read_conn: Mutex::new(Some(read_conn)),
            list_conn: Mutex::new(Some(list_conn)),
            search_index_lock: Mutex::new(()),
            search_background_queued: AtomicBool::new(false),
            legacy_page_cache: Mutex::new(Default::default()),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        migrate(&conn).map_err(|e| e.to_string())?;
        crate::ssh_group_defaults::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            read_conn: Mutex::new(None),
            list_conn: Mutex::new(None),
            search_index_lock: Mutex::new(()),
            search_background_queued: AtomicBool::new(false),
            legacy_page_cache: Mutex::new(Default::default()),
        })
    }

    /// Runs a pure read on the dedicated read connection so it does not queue
    /// behind a long write on `conn` (WAL lets readers run alongside it). An
    /// in-memory store has no second connection, so it reads on `conn`.
    /// Only for commands that never write, even lazily.
    fn with_read_conn<T>(
        &self,
        read: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let list_conn = self
            .list_conn
            .lock()
            .map_err(|_| "Session read store is locked")?;
        if let Some(conn) = list_conn.as_ref() {
            read(conn)
        } else {
            let conn = self.conn.lock().map_err(|_| "Session store is locked")?;
            read(&conn)
        }
    }

    /// Every stored session id, archived ones included.
    pub(crate) fn session_ids(&self) -> Result<std::collections::HashSet<String>, String> {
        self.with_read_conn(|conn| {
            conn.prepare("SELECT id FROM sessions")
                .and_then(|mut statement| {
                    statement
                        .query_map([], |row| row.get::<_, String>(0))?
                        .collect::<rusqlite::Result<_>>()
                })
                .map_err(|e| e.to_string())
        })
    }

    pub(crate) fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "Session store is locked".into())
    }
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    init_with(
        || app.path().app_data_dir().map_err(|e| e.to_string()),
        SessionStore::open,
        |store| {
            app.manage(store);
        },
    )?;
    start_search_indexing(app);
    Ok(())
}

// Keep the complete startup path here so the transcript-read test covers it.
fn init_with(
    data_dir: impl FnOnce() -> Result<PathBuf, String>,
    open: impl FnOnce(PathBuf) -> Result<SessionStore, String>,
    manage: impl FnOnce(SessionStore),
) -> Result<(), String> {
    // Preserve the database filename used by existing installations.
    let store = open(data_dir()?.join("bycoda.db"))?;
    manage(store);
    Ok(())
}

/// Builds the message-content search index for sessions it does not cover yet
/// (a fresh migration, a bulk import) off the startup path.
fn start_search_indexing(app: &AppHandle) {
    queue_search_indexing(app, std::time::Duration::from_secs(5));
}

fn queue_search_indexing(app: &AppHandle, delay: std::time::Duration) {
    let Some(store) = app.try_state::<SessionStore>() else {
        return;
    };
    if store.search_background_queued.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    let recovery_app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("session-search-index".into())
        .spawn(move || {
            // Let startup finish first; this is catch-up work, not on the
            // critical path, and a search indexes what it needs by itself.
            std::thread::sleep(delay);
            if let Some(store) = app.try_state::<SessionStore>() {
                struct Reset<'a>(&'a AtomicBool);
                impl Drop for Reset<'_> {
                    fn drop(&mut self) {
                        self.0.store(false, Ordering::Release);
                    }
                }
                let _reset = Reset(&store.search_background_queued);
                content_search::index_in_background(&store);
            }
        });
    if let Err(error) = spawned {
        if let Some(store) = recovery_app.try_state::<SessionStore>() {
            store
                .search_background_queued
                .store(false, Ordering::Release);
        }
        eprintln!("session search index thread: {error}");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpsert {
    pub id: String,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub model_settings: Value,
    pub runtime_mode: String,
    pub title: String,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    #[serde(default)]
    pub provider_account_id: Option<String>,
    pub blocks: Value,
    /// Last context-window reading reported by the harness, if any.
    #[serde(default)]
    pub context_used: Option<i64>,
    #[serde(default)]
    pub context_window: Option<i64>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree_cwd: Option<String>,
    #[serde(default)]
    pub worktree_removed: bool,
    #[serde(default)]
    pub linked_work_item: Option<Value>,
    #[serde(default)]
    pub automation_id: Option<String>,
    /// Explicitly rewound transcript tails, kept outside the active transcript.
    #[serde(default)]
    pub rewind_history: Option<Value>,
    /// One-shot context replay derived from the retained transcript prefix.
    #[serde(default)]
    pub pending_context_replay: Option<String>,
    /// JSON of a flagged host divergence and its answer; opaque to the store.
    #[serde(default)]
    pub adopted_divergence: Option<String>,
    /// JSON of the transcript head this computer and its host last agreed on;
    /// opaque to the store.
    #[serde(default)]
    pub adopted_base: Option<String>,
    /// Original timestamps of an imported conversation. Used only when the row
    /// is first created, so imported history sorts where it happened rather
    /// than at the moment of the import; every later write moves `updated_at`
    /// as usual.
    #[serde(default)]
    pub created_at: Option<i64>,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_revision: Option<i64>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration_lead_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration: Option<Value>,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub runtime_mode: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_cwd: Option<String>,
    #[serde(default)]
    pub worktree_removed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_work_item: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_revision: Option<i64>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration_lead_id: Option<String>,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub model_settings: Value,
    pub runtime_mode: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_account_id: Option<String>,
    pub blocks: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_cwd: Option<String>,
    #[serde(default)]
    pub worktree_removed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_work_item: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewind_history: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_context_replay: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adopted_divergence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adopted_base: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command(async)]
pub fn session_upsert(
    store: State<'_, SessionStore>,
    session: SessionUpsert,
    expected_updated_at: Option<i64>,
    expected_revision: Option<i64>,
    expect_missing: Option<bool>,
) -> Result<Option<SessionSummary>, String> {
    validate_upsert(&session)?;
    // Git lookups can spawn processes; never do that while holding the
    // connection every other store command waits on.
    let git = upsert_git_info(&session);
    // `expectMissing` means "the row must not exist"; `expectedUpdatedAt` means
    // "the row must still carry this stamp". Neither is the unguarded write.
    let expected = if expect_missing == Some(true) {
        Some(None)
    } else {
        expected_updated_at.map(Some)
    };
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    if let Some(expected_revision) = expected_revision {
        let revision: Option<i64> = conn
            .query_row(
                "SELECT revision FROM session_block_state WHERE session_id=?1",
                [&session.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if revision != Some(expected_revision) {
            return Ok(None);
        }
    }
    // `None` back means the precondition failed and nothing was written.
    upsert_session_with_git(&conn, &session, git, expected).map_err(|e| e.to_string())
}

fn upsert_git_info(session: &SessionUpsert) -> crate::fs::GitInfo {
    crate::fs::git_info_for(&crate::fs::expand_home(
        session
            .worktree_cwd
            .as_deref()
            .filter(|cwd| !cwd.is_empty())
            .unwrap_or(&session.cwd),
    ))
}

fn validate_upsert(session: &SessionUpsert) -> Result<(), String> {
    validate_id(&session.id, "session")?;
    if session.cwd.trim().is_empty() {
        return Err("cwd is required".into());
    }
    if let Some(provider_session_id) = &session.provider_session_id {
        if !provider_session_id.is_empty() {
            validate_id(provider_session_id, "provider session")?;
        }
    }
    if let Some(provider_account_id) = &session.provider_account_id {
        if !provider_account_id.is_empty() {
            validate_id(provider_account_id, "provider account")?;
        }
    }
    if let Some(automation_id) = &session.automation_id {
        if !automation_id.is_empty() {
            validate_id(automation_id, "automation")?;
        }
    }
    if !session.model_settings.is_object() {
        return Err("modelSettings must be an object".into());
    }
    if !session.blocks.is_array() {
        return Err("blocks must be an array".into());
    }
    Ok(())
}

/// Adds a conversation brought in from a provider's own history. Never
/// replaces anything: when the id, or the provider conversation it carries, is
/// already stored, the call does nothing and returns `None`, so importing the
/// same transcript twice cannot overwrite a chat that was continued since.
#[tauri::command(async)]
pub fn session_import(
    store: State<'_, SessionStore>,
    session: SessionUpsert,
) -> Result<Option<SessionSummary>, String> {
    validate_upsert(&session)?;
    let git = upsert_git_info(&session);
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    if import_already_stored(&conn, &session).map_err(|e| e.to_string())? {
        return Ok(None);
    }
    upsert_session_with_git(&conn, &session, git, None).map_err(|e| e.to_string())
}

fn import_already_stored(conn: &Connection, session: &SessionUpsert) -> rusqlite::Result<bool> {
    let provider_session_id = session
        .provider_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sessions
           WHERE id = ?1
              OR (?3 IS NOT NULL AND harness = ?2 AND provider_session_id = ?3))",
        params![session.id, session.harness, provider_session_id],
        |row| row.get(0),
    )
}

/// What the import dialog needs to mark conversations as already imported:
/// `harness:providerSessionId` for every stored session bound to a provider
/// conversation, plus the id of every session an earlier import created (a
/// read-only import has no provider binding to match on).
#[tauri::command(async)]
pub fn session_import_keys(store: State<'_, SessionStore>) -> Result<Vec<String>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    import_keys(&conn).map_err(|e| e.to_string())
}

fn import_keys(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT harness || ':' || provider_session_id FROM sessions
           WHERE provider_session_id IS NOT NULL AND provider_session_id != ''
         UNION
         SELECT id FROM sessions WHERE id LIKE 'imp-%'",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

fn generated_image_paths(blocks: &Value) -> Vec<String> {
    blocks
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block.get("role").and_then(Value::as_str) == Some("image"))
        .filter_map(|block| {
            block
                .get("image")
                .and_then(|image| image.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

/// Keep a write reservation through the reference check and file cleanup. Other
/// windows must not save a new reference between those two operations. A failed
/// read skips cleanup entirely; leaking an asset is safer than deleting one in use.
fn cleanup_unreferenced_generated_images(
    conn: &Connection,
    paths: &[String],
    cleanup: impl FnOnce(&[String]) -> Result<(), String>,
) -> Result<(), String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut candidates: HashMap<PathBuf, String> = paths
        .iter()
        .map(|path| {
            let path_buf = PathBuf::from(path);
            (path_buf.canonicalize().unwrap_or(path_buf), path.clone())
        })
        .collect();
    {
        // The view includes authoritative incremental blocks. Retained rewind,
        // side conversations, queues and composer drafts also own their assets.
        let mut statement = tx.prepare(
            "SELECT j.value FROM (
               SELECT blocks_json AS payload FROM session_transcripts
               UNION ALL SELECT rewind_history_json FROM sessions WHERE rewind_history_json IS NOT NULL
               UNION ALL SELECT queue_json FROM session_queues
               UNION ALL SELECT draft_json FROM composer_drafts
             ) AS records, json_tree(records.payload) AS j
             WHERE j.type = 'text' AND j.key = 'path'",
        ).map_err(|error| error.to_string())?;
        let references = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for reference in references {
            let path = PathBuf::from(reference.map_err(|error| error.to_string())?);
            candidates.remove(&path.canonicalize().unwrap_or(path));
        }
    }
    let unreferenced: Vec<String> = candidates.into_values().collect();
    if !unreferenced.is_empty() {
        cleanup(&unreferenced)?;
    }
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn session_list_by_project(
    store: State<'_, SessionStore>,
    cwd: String,
) -> Result<Vec<SessionSummary>, String> {
    if cwd.trim().is_empty() {
        return Err("cwd is required".into());
    }
    // Git lookups can spawn processes; do them before taking any connection.
    let git = crate::fs::git_info_for(&crate::fs::expand_home(&cwd));
    store
        .with_read_conn(|conn| list_by_project_with_git(conn, &cwd, git).map_err(|e| e.to_string()))
}

#[tauri::command(async)]
pub fn session_rebase_project(
    store: State<'_, SessionStore>,
    from_cwd: String,
    to_cwd: String,
) -> Result<(), String> {
    if from_cwd.trim().is_empty() || to_cwd.trim().is_empty() {
        return Err("project paths are required".into());
    }
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    rebase_project(&conn, &from_cwd, &to_cwd).map_err(|error| error.to_string())
}

fn rebase_project(conn: &Connection, from_cwd: &str, to_cwd: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET cwd = ?2 WHERE cwd = ?1",
        params![from_cwd, to_cwd],
    )?;
    Ok(())
}

#[tauri::command(async)]
pub fn session_list_linked(store: State<'_, SessionStore>) -> Result<Vec<SessionSummary>, String> {
    store.with_read_conn(|conn| list_linked(conn).map_err(|e| e.to_string()))
}

#[tauri::command(async)]
pub fn session_list_recent(
    store: State<'_, SessionStore>,
    limit: i64,
) -> Result<Vec<SessionSummary>, String> {
    store.with_read_conn(|conn| list_recent(conn, limit).map_err(|e| e.to_string()))
}

#[tauri::command(async)]
pub fn session_get(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<tauri::ipc::Response, String> {
    validate_id(&session_id, "session")?;
    store
        .with_read_conn(|conn| get_session_json(conn, &session_id).map_err(|e| e.to_string()))
        .map(tauri::ipc::Response::new)
}

const MAX_SEARCH_SCAN: usize = 400;
const MAX_CONVERSATION_HITS: usize = 40;
const MAX_MESSAGE_HITS: usize = 40;
const SNIPPET_RADIUS: usize = 42;
const SEARCH_PROGRESS_INTERVAL: usize = 1_000;
const MAX_SEARCH_BUFFER_BYTES: usize = 8 * 1024 * 1024;
static SESSION_SEARCH_TOKENS: Mutex<Option<HashMap<String, Arc<AtomicU64>>>> = Mutex::new(None);

#[derive(Clone)]
struct SessionSearchToken {
    owner: String,
    counter: Arc<AtomicU64>,
    generation: u64,
}

impl SessionSearchToken {
    fn is_current(&self) -> bool {
        self.counter.load(Ordering::Acquire) == self.generation
    }
}

fn begin_session_search(owner: &str) -> Option<SessionSearchToken> {
    if owner.is_empty() {
        return None;
    }
    let mut tokens = SESSION_SEARCH_TOKENS.lock().ok()?;
    let tokens = tokens.get_or_insert_with(HashMap::new);
    let counter = tokens
        .entry(owner.to_string())
        .or_insert_with(|| Arc::new(AtomicU64::new(0)))
        .clone();
    let generation = counter.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
    Some(SessionSearchToken {
        owner: owner.to_string(),
        counter,
        generation,
    })
}

/// Release the entry a finished search was holding, on every exit path.
///
/// Every search runs under a fresh `searchOwner` (`SearchView` mints a UUID per
/// keystroke), so an entry left behind is never reused or overwritten — it just
/// accumulates for the life of the process. A plain call after the search would
/// not do: the search returns through `?` on any SQLite error, and `SearchView`
/// swallows the rejection, so the error path is the common case, not the rare
/// one. `Drop` covers the early return and the unwind both.
struct SessionSearchRelease(Option<SessionSearchToken>);

impl Drop for SessionSearchRelease {
    fn drop(&mut self) {
        end_session_search(self.0.as_ref());
    }
}

/// The generation check happens under the map lock, not before it.
///
/// `begin_session_search` bumps the counter while holding that same lock, so
/// checking `is_current` outside the critical section leaves a window: a newer
/// search can register in between, and since both tokens share one `Arc`, the
/// `ptr_eq` test cannot tell them apart. Removing the entry then would strip
/// the live search of its registration, leaving it running and impossible to
/// cancel. The superseded search must leave the newer counter alone, so the
/// whole decision has to be atomic with respect to registration.
fn end_session_search(token: Option<&SessionSearchToken>) {
    let Some(token) = token else {
        return;
    };
    let Ok(mut tokens) = SESSION_SEARCH_TOKENS.lock() else {
        return;
    };
    let ours = tokens
        .as_ref()
        .and_then(|tokens| tokens.get(&token.owner))
        .is_some_and(|registered| Arc::ptr_eq(registered, &token.counter) && token.is_current());
    if ours {
        if let Some(tokens) = tokens.as_mut() {
            tokens.remove(&token.owner);
        }
    }
}

#[cfg(test)]
fn session_search_token_registered(owner: &str) -> bool {
    SESSION_SEARCH_TOKENS
        .lock()
        .ok()
        .and_then(|tokens| tokens.as_ref().map(|tokens| tokens.contains_key(owner)))
        .unwrap_or(false)
}

fn cancel_owned_session_search(owner: &str) {
    if owner.is_empty() {
        return;
    }
    if let Ok(mut tokens) = SESSION_SEARCH_TOKENS.lock() {
        if let Some(counter) = tokens.as_mut().and_then(|tokens| tokens.remove(owner)) {
            counter.fetch_add(1, Ordering::AcqRel);
        }
    }
}

fn session_search_is_current(token: Option<&SessionSearchToken>) -> bool {
    token.is_none_or(SessionSearchToken::is_current)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchOptions {
    pub query: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub search_owner: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchHit {
    pub kind: String,
    pub session_id: String,
    pub cwd: String,
    pub harness: String,
    pub title: String,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub hits: Vec<SessionSearchHit>,
    pub truncated: bool,
}

#[tauri::command(async)]
pub fn session_search(
    store: State<'_, SessionStore>,
    options: SessionSearchOptions,
) -> Result<SessionSearchResult, String> {
    search_store(&store, &options)
}

fn search_store(
    store: &SessionStore,
    options: &SessionSearchOptions,
) -> Result<SessionSearchResult, String> {
    let token = begin_session_search(&options.search_owner);
    let release = SessionSearchRelease(token.clone());
    let result = {
        let read_conn = store
            .read_conn
            .lock()
            .map_err(|_| "Session read store is locked")?;
        if let Some(conn) = read_conn.as_ref() {
            search_sessions_with_connection(conn, options, token.as_ref())?
        } else {
            let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
            search_sessions_with_connection(&conn, options, token.as_ref())?
        }
    };
    drop(release);
    if session_search_is_current(token.as_ref()) {
        Ok(result)
    } else {
        Ok(SessionSearchResult {
            hits: Vec::new(),
            truncated: false,
        })
    }
}

/// Full-text search over message content, grouped by session. Cancel with
/// `cancel_session_search` under the same `searchOwner`.
#[tauri::command(async)]
pub fn session_search_content(
    app: AppHandle,
    store: State<'_, SessionStore>,
    options: ContentSearchOptions,
) -> Result<ContentSearchResult, String> {
    let result = content_search::search_content(&store, &options)?;
    if result.pending > 0 {
        queue_search_indexing(&app, std::time::Duration::ZERO);
    }
    Ok(result)
}

#[tauri::command(async)]
pub fn cancel_session_search(search_owner: String) {
    cancel_owned_session_search(&search_owner);
}

#[tauri::command(async)]
pub fn session_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    session_id: String,
    mut image_paths: Vec<String>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    let persisted_paths = get_session(&conn, &session_id)
        .ok()
        .flatten()
        .map(|record| generated_image_paths(&record.blocks))
        .unwrap_or_default();
    image_paths.extend(persisted_paths);
    delete_session(&conn, &session_id).map_err(|e| e.to_string())?;
    if !image_paths.is_empty() {
        if let Err(error) = cleanup_unreferenced_generated_images(&conn, &image_paths, |paths| {
            crate::fs::delete_generated_images_sync(&app, paths)
        }) {
            eprintln!("Generated image cleanup will need a retry: {error}");
        }
    }
    drop(conn);
    let _ = app.emit(crate::reminders::CHANGED, ());
    Ok(())
}

#[tauri::command(async)]
pub fn session_set_archived(
    store: State<'_, SessionStore>,
    session_id: String,
    archived: bool,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_archived(&conn, &session_id, archived).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn session_set_pinned(
    store: State<'_, SessionStore>,
    session_id: String,
    pinned: bool,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_pinned(&conn, &session_id, pinned).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn session_set_linked_work_item(
    store: State<'_, SessionStore>,
    session_id: String,
    linked_work_item: Option<Value>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_linked_work_item(&conn, &session_id, linked_work_item.as_ref()).map_err(|e| e.to_string())
}

const SESSION_QUEUE_MAX_BYTES: usize = 8_000_000;

/// Write-through for a session's queued follow-ups. Kept in its own table so a
/// queue edit never rewrites the transcript, and a transcript save never
/// touches the queue. An empty queue (`None`) deletes the row.
#[tauri::command(async)]
pub fn session_set_queue(
    store: State<'_, SessionStore>,
    session_id: String,
    queue: Option<Value>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_session_queue(&conn, &session_id, queue.as_ref())
}

#[tauri::command(async)]
pub fn session_get_queue(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<Option<Value>, String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    get_session_queue(&conn, &session_id).map_err(|e| e.to_string())
}

fn set_session_queue(
    conn: &Connection,
    session_id: &str,
    queue: Option<&Value>,
) -> Result<(), String> {
    let Some(queue) = queue else {
        conn.execute(
            "DELETE FROM session_queues WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    };
    if !queue.is_array() {
        return Err("queue must be an array".into());
    }
    let json = serde_json::to_string(queue).map_err(|e| e.to_string())?;
    if json.len() > SESSION_QUEUE_MAX_BYTES {
        return Err("queue is too large".into());
    }
    conn.execute(
        "INSERT INTO session_queues (session_id, queue_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET
           queue_json = excluded.queue_json,
           updated_at = excluded.updated_at",
        params![session_id, json, now_millis()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_session_queue(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<Value>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT queue_json FROM session_queues WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    // A row that no longer parses is dropped rather than failing the load.
    Ok(raw.and_then(|raw| serde_json::from_str(&raw).ok()))
}

const COMPOSER_DRAFT_MAX_BYTES: usize = 8_000_000;
/// A draft nobody touched for this long is not coming back; listing drops it.
const COMPOSER_DRAFT_MAX_AGE_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// Write-through for the unsent text in a session's composer. Keyed by the
/// session id even when that session has no transcript row yet (a blank new
/// chat), so it has its own table and no foreign key. `None` deletes the row.
#[tauri::command(async)]
pub fn session_set_draft(
    store: State<'_, SessionStore>,
    session_id: String,
    draft: Option<Value>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_composer_draft(&conn, &session_id, draft.as_ref())
}

/// Every saved draft, read once at launch so each composer can start from its own.
#[tauri::command(async)]
pub fn session_list_drafts(store: State<'_, SessionStore>) -> Result<Vec<Value>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_composer_drafts(&conn).map_err(|e| e.to_string())
}

/// Strict, read-only inventory for remote attachment ownership. Ordinary draft
/// hydration may discard expired/malformed rows; it cannot authorize a release.
#[tauri::command(async)]
pub fn session_attachment_references(
    store: State<'_, SessionStore>,
    session_id: String,
    queue_session_ids: Vec<String>,
    all_sessions: Option<bool>,
) -> Result<Value, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    read_attachment_references(
        &conn,
        &session_id,
        &queue_session_ids,
        all_sessions.unwrap_or(false),
    )
}

fn read_attachment_references(
    conn: &Connection,
    session_id: &str,
    queue_session_ids: &[String],
    all_sessions: bool,
) -> Result<Value, String> {
    validate_id(session_id, "session")?;
    if queue_session_ids.len() > 100 {
        return Err("Too many attachment reference queues".into());
    }
    for id in queue_session_ids {
        validate_id(id, "queue session")?;
    }
    // All windows see the same atomic inventory, including an external writer.
    let snapshot = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let read_ids = |sql: &str| -> Result<Vec<String>, String> {
        let mut statement = snapshot.prepare(sql).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            if ids.len() >= 10_000 {
                return Err("Too many attachment reference rows".into());
            }
            ids.push(row.map_err(|e| e.to_string())?);
        }
        Ok(ids)
    };
    let draft_sessions = if all_sessions {
        read_ids("SELECT session_id FROM composer_drafts")?
    } else {
        vec![session_id.to_string()]
    };
    let queue_sessions = if all_sessions {
        read_ids("SELECT session_id FROM session_queues")?
    } else {
        queue_session_ids.to_vec()
    };
    let mut bytes = 0usize;
    let mut count = 0usize;
    let mut read = |sql: &str, id: &str| -> Result<Option<Value>, String> {
        let raw: Option<String> = snapshot
            .query_row(sql, [id], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        raw.map(|raw| {
            bytes = bytes.saturating_add(raw.len());
            if bytes > 64 * 1024 * 1024 {
                return Err("Saved attachment reference inventory is too large".into());
            }
            serde_json::from_str(&raw)
                .map_err(|_| "Could not read saved attachment references".into())
        })
        .transpose()
    };
    let mut ids = |value: &Value| -> Result<Vec<String>, String> {
        let attachments = value
            .as_object()
            .and_then(|value| value.get("attachments"))
            .and_then(Value::as_array)
            .ok_or("Could not read saved attachment references")?;
        let mut result = Vec::new();
        for file in attachments {
            let id = file
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= 128)
                .ok_or("Could not read saved attachment references")?;
            count += 1;
            if count > 10_000 {
                return Err("Too many saved attachment references".into());
            }
            result.push(id.to_string());
        }
        Ok(result)
    };
    let mut draft_ids = Vec::new();
    for session in draft_sessions {
        if let Some(draft) = read(
            "SELECT draft_json FROM composer_drafts WHERE session_id=?1",
            &session,
        )? {
            draft_ids.extend(ids(&draft)?);
        }
    }
    let mut queues = serde_json::Map::new();
    for id in &queue_sessions {
        let mut references = Vec::new();
        if let Some(queue) = read(
            "SELECT queue_json FROM session_queues WHERE session_id=?1",
            id,
        )? {
            for row in queue
                .as_array()
                .ok_or("Could not read saved attachment references")?
            {
                references.extend(ids(row)?);
            }
        }
        queues.insert(id.clone(), json!(references));
    }
    Ok(json!({ "draftIds": draft_ids, "queues": queues }))
}

fn set_composer_draft(
    conn: &Connection,
    session_id: &str,
    draft: Option<&Value>,
) -> Result<(), String> {
    let Some(draft) = draft else {
        conn.execute(
            "DELETE FROM composer_drafts WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    };
    if !draft.is_object() {
        return Err("draft must be an object".into());
    }
    let json = serde_json::to_string(draft).map_err(|e| e.to_string())?;
    if json.len() > COMPOSER_DRAFT_MAX_BYTES {
        return Err("draft is too large".into());
    }
    conn.execute(
        "INSERT INTO composer_drafts (session_id, draft_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET
           draft_json = excluded.draft_json,
           updated_at = excluded.updated_at",
        params![session_id, json, now_millis()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Rows as `{ sessionId, draft }`, oldest-expired ones deleted first. A row
/// that no longer parses is skipped rather than failing the whole list.
fn list_composer_drafts(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    conn.execute(
        "DELETE FROM composer_drafts WHERE updated_at < ?1",
        [now_millis() - COMPOSER_DRAFT_MAX_AGE_MS],
    )?;
    let mut statement = conn
        .prepare("SELECT session_id, draft_json FROM composer_drafts ORDER BY updated_at DESC")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut drafts = Vec::new();
    for row in rows {
        let (session_id, raw) = row?;
        if let Ok(draft) = serde_json::from_str::<Value>(&raw) {
            drafts.push(json!({ "sessionId": session_id, "draft": draft }));
        }
    }
    Ok(drafts)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InFlightSession {
    pub session_id: String,
    pub cwd: String,
}

#[tauri::command(async)]
pub fn session_set_in_flight(
    store: State<'_, SessionStore>,
    sessions: Vec<InFlightSession>,
) -> Result<(), String> {
    for session in &sessions {
        validate_id(&session.session_id, "session")?;
        if session.cwd.trim().is_empty() {
            return Err("cwd is required".into());
        }
    }
    let mut conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    replace_in_flight(&mut conn, &sessions).map_err(|e| e.to_string())
}

/// Read the quit snapshot without clearing it. Vite/dev reloads must not
/// consume the only copy.
#[tauri::command(async)]
pub fn session_list_in_flight(
    store: State<'_, SessionStore>,
) -> Result<Vec<InFlightSession>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_in_flight(&conn).map_err(|e| e.to_string())
}

/// Read and clear the quit snapshot so a restored window cannot take it twice.
#[tauri::command(async)]
pub fn session_take_in_flight(
    store: State<'_, SessionStore>,
) -> Result<Vec<InFlightSession>, String> {
    let mut conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    take_in_flight(&mut conn).map_err(|e| e.to_string())
}

const WORKSPACE_SNAPSHOT_MAX_BYTES: usize = 2_000_000;

#[path = "server_terminal_restore.rs"]
mod server_terminal_restore;

#[tauri::command(async)]
pub fn workspace_set_snapshot(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    mut snapshot: Value,
) -> Result<(), String> {
    if !snapshot.is_object() {
        return Err("workspace snapshot must be an object".into());
    }
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    let owner = window.label() == "main";
    let previous = if owner && snapshot.get("serversRestore").is_some() {
        None
    } else {
        get_workspace_snapshot(&conn)
            .map_err(|e| e.to_string())?
            .map(|raw| {
                serde_json::from_str::<Value>(&raw)
                    .map_err(|_| "Invalid saved workspace snapshot".to_string())
            })
            .transpose()?
    };
    server_terminal_restore::merge(&mut snapshot, previous.as_ref(), owner)?;
    let json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    if json.len() > WORKSPACE_SNAPSHOT_MAX_BYTES {
        return Err("workspace snapshot is too large".into());
    }
    set_workspace_snapshot(&conn, &json).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn workspace_get_snapshot(store: State<'_, SessionStore>) -> Result<Option<Value>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    let json = get_workspace_snapshot(&conn).map_err(|e| e.to_string())?;
    match json {
        None => Ok(None),
        Some(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
    }
}

/// Add a `sessions` column when it is absent, so a half-applied history cannot
/// leave the schema short of what the queries select.
fn ensure_session_column(conn: &Connection, column: &str, decl: &str) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
        params![column],
        |row| row.get(0),
    )?;
    if present == 0 {
        conn.execute(
            &format!("ALTER TABLE sessions ADD COLUMN {column} {decl}"),
            [],
        )?;
    }
    Ok(())
}

/// Add a `sessions` column when it is missing, tolerating the case where a
/// recorded migration version has no matching column.
fn ensure_column(conn: &Connection, name: &str, decl: &str) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    if present > 0 {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE sessions ADD COLUMN {name} {decl}"),
        [],
    )?;
    Ok(())
}

fn migrate_versions(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         )",
        [],
    )?;
    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if current < 1 {
        conn.execute_batch(MIGRATION_V1)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 2 {
        ensure_session_column(conn, "branch", "TEXT")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 3 {
        ensure_session_column(conn, "context_used", "INTEGER")?;
        ensure_session_column(conn, "context_window", "INTEGER")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS in_flight_sessions (
               session_id TEXT PRIMARY KEY,
               cwd TEXT NOT NULL,
               sort_index INTEGER NOT NULL
             );",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 5 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_snapshot (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               snapshot_json TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 6 {
        ensure_session_column(conn, "archived", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 7 {
        ensure_session_column(conn, "worktree_cwd", "TEXT")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 8 {
        // `list_by_project` used to filter with
        // `blocks_json LIKE '%"role":"user"%'`, which reads and substring-scans
        // every transcript in the project on each switch. Materialize the
        // predicate so the covering index can answer it instead.
        ensure_column(conn, "has_user_message", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "UPDATE sessions SET has_user_message =
               CASE WHEN blocks_json != '[]' AND blocks_json LIKE '%\"role\":\"user\"%'
                    THEN 1 ELSE 0 END",
            [],
        )?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_updated_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_listed_idx
               ON sessions (cwd, has_user_message, updated_at DESC);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?1)",
            params![now_millis()],
        )?;
    }
    // A recorded version row can outlive the schema it describes when another
    // build reuses the same numbers, leaving columns that every listing query
    // (and the covering index below) depends on missing. Repair before use.
    for (column, decl) in [
        ("branch", "TEXT"),
        ("context_used", "INTEGER"),
        ("context_window", "INTEGER"),
        ("archived", "INTEGER NOT NULL DEFAULT 0"),
        ("worktree_cwd", "TEXT"),
        ("has_user_message", "INTEGER NOT NULL DEFAULT 0"),
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("linked_work_item_json", "TEXT"),
        ("provider_account_id", "TEXT"),
        ("worktree_removed", "INTEGER NOT NULL DEFAULT 0"),
        ("is_draft", "INTEGER NOT NULL DEFAULT 0"),
        ("automation_id", "TEXT"),
        ("rewind_history_json", "TEXT"),
        ("pending_context_replay", "TEXT"),
        ("adopted_divergence", "TEXT"),
        ("adopted_base", "TEXT"),
    ] {
        ensure_session_column(conn, column, decl)?;
    }
    if current < 9 {
        // v8 stopped the blob scan but still cost a table seek per row, and
        // every summary column (`created_at`, `updated_at`, `branch`,
        // `archived`) is stored *after* `blocks_json` in the record — so
        // reaching them meant walking past a ~180 KB transcript's overflow
        // pages, 120 times over, on each project switch. Widening the index to
        // cover the whole projection keeps the query inside the index and off
        // the table entirely: measured 7.3 ms -> 0.24 ms for 120 sessions.
        // Version rows are not proof the columns landed: a DB can carry a
        // recorded version from another build without the ALTER that went with
        // it, and indexing a missing column aborts the whole migration.
        ensure_column(conn, "branch", "TEXT")?;
        ensure_column(conn, "archived", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_column(conn, "has_user_message", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_listed_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 10 {
        crate::notes::ensure_notes_table(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 11 {
        // Pinning is a listing column, so it has to live in the covering
        // index with `archived`. Selecting it off the table would walk past
        // `blocks_json` on every project switch.
        ensure_column(conn, "pinned", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (11, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 12 {
        // The sidebar renders this metadata for every row, so keep it in the
        // same covering index as the rest of the session-card projection.
        ensure_column(conn, "linked_work_item_json", "TEXT")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (12, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 13 {
        crate::notes::ensure_notes_table(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (13, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 14 {
        ensure_session_column(conn, "provider_account_id", "TEXT")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (14, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 15 {
        ensure_session_column(conn, "worktree_removed", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (15, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 16 {
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (16, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 17 {
        // Draft is rendered on every session card. Materialize it alongside
        // `has_user_message` so listing never has to read transcript blobs.
        ensure_session_column(conn, "is_draft", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "UPDATE sessions SET is_draft =
               CASE WHEN blocks_json LIKE '%\"role\":\"user\"%'
                          AND blocks_json LIKE '%\"draft\":true%'
                    THEN 1 ELSE 0 END",
            [],
        )?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed,
                            is_draft);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (17, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 18 {
        // Sidebar cards show whether a session came from an automation.
        ensure_session_column(conn, "automation_id", "TEXT")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed,
                            is_draft, automation_id);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (18, ?1)",
            params![now_millis()],
        )?;
    }
    Ok(())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    // Acquire the writer lock before reading the version. DDL and its version
    // markers must commit together, including the fresh-database path. Existing
    // legacy prefixes are repaired by the column checks in migrate_versions.
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    migrate_versions(&tx)?;
    tx.commit()?;

    // Keep independent schema helpers outside this transaction: some own their
    // own transaction (notably ensure_orchestration_history).
    // Create even when a version row already exists (another build may have
    // used the same numbers, or a previous run recorded the version without
    // the table). Restore writes into these; missing tables look like a
    // blank homepage.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS in_flight_sessions (
           session_id TEXT PRIMARY KEY,
           cwd TEXT NOT NULL,
           sort_index INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS workspace_snapshot (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           snapshot_json TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS worktree_removals (
           path TEXT PRIMARY KEY,
           sessions_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS session_queues (
           session_id TEXT PRIMARY KEY,
           queue_json TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS composer_drafts (
           session_id TEXT PRIMARY KEY,
           draft_json TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )?;
    // Compatibility only: earlier Inbox Ask builds saved temporary chats here.
    // Keep those records off normal surfaces without deleting their transcripts.
    ensure_session_column(conn, "inbox_ask", "TEXT")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS sessions_legacy_inbox
         ON sessions (id) WHERE inbox_ask IS NOT NULL;",
    )?;
    // Unscoped session search pins this index with `INDEXED BY`, and SQLite
    // rejects that statement outright when the index is missing instead of
    // falling back to another plan. The versioned blocks above are the normal
    // path, but a recorded version can outlive the schema it describes, so
    // restore the index here for the same reason the tables above are
    // restored: a missing index would fail every search without a `cwd`.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
           ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                        model, runtime_mode, title, provider_session_id,
                        created_at, branch, archived, pinned,
                        linked_work_item_json, worktree_cwd, worktree_removed,
                        is_draft, automation_id);",
    )?;
    // `list_recent` and `list_linked` pin these; both are partial so they only
    // carry the rows those lists can return (live threads, linked threads).
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS sessions_recent_idx
           ON sessions (pinned, updated_at DESC, id)
           WHERE has_user_message = 1 AND archived = 0;
         CREATE INDEX IF NOT EXISTS sessions_linked_idx
           ON sessions (updated_at DESC, id)
           WHERE linked_work_item_json IS NOT NULL;",
    )?;
    crate::notes::ensure_notes_table(conn)?;
    crate::reminders::ensure_table(conn)?;
    crate::automations::ensure_tables(conn)?;
    ensure_orchestration_history(conn)?;
    incremental::ensure_schema(conn)?;
    // Source-revision/dirty metadata requires all current session columns.
    // Only metadata is reconciled here; transcripts remain lazily indexed.
    content_search::ensure_schema(conn)?;
    Ok(())
}

fn ensure_orchestration_history(conn: &Connection) -> rusqlite::Result<()> {
    let indexed: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'orchestration_sidebar')",
        [],
        |row| row.get(0),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS orchestration_runs (lead_id TEXT PRIMARY KEY, state TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS orchestration_sidebar (lead_id TEXT PRIMARY KEY, summary TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS orchestration_workers (session_id TEXT PRIMARY KEY, lead_id TEXT NOT NULL);",
    )?;
    if !indexed {
        // One-time compatibility pass for the preview that listed workers as
        // separate chats. Normal sidebar reads never scan transcripts/run blobs.
        let runs = tx
            .prepare("SELECT lead_id, state FROM orchestration_runs")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (lead, state) in runs {
            if let Ok(run) = serde_json::from_str::<Value>(&state) {
                index_orchestration(&tx, &lead, &run)?;
            }
        }
        let workers = tx.prepare("SELECT id, blocks_json FROM sessions WHERE blocks_json LIKE '%orchestrationLeadId%'")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, blocks) in workers {
            if let Ok(blocks) = serde_json::from_str::<Value>(&blocks) {
                remember_worker_from_blocks(&tx, &id, &blocks)?;
            }
        }
    }
    tx.commit()
}

fn remember_worker(conn: &Connection, id: &str, lead: &str) -> rusqlite::Result<()> {
    if id != lead && validate_id(id, "Worker").is_ok() && validate_id(lead, "Lead").is_ok() {
        // Keep earlier workers indexed when a lead starts a subsequent run.
        conn.execute(
            "INSERT OR IGNORE INTO orchestration_workers(session_id, lead_id) VALUES (?1, ?2)",
            params![id, lead],
        )?;
    }
    Ok(())
}

fn remember_worker_from_blocks(
    conn: &Connection,
    id: &str,
    blocks: &Value,
) -> rusqlite::Result<()> {
    if let Some(blocks) = blocks.as_array() {
        for block in blocks {
            if block["role"] == "user" {
                if let Some(lead) = block["orchestrationLeadId"].as_str() {
                    remember_worker(conn, id, lead)?;
                    break;
                }
            }
        }
    }
    Ok(())
}

fn index_orchestration(conn: &Connection, lead: &str, run: &Value) -> rusqlite::Result<()> {
    let Some(tasks) = run["tasks"].as_array() else {
        return Ok(());
    };
    let mut summaries = Vec::new();
    for task in tasks {
        let Some(id) = task["sessionId"].as_str() else {
            continue;
        };
        remember_worker(conn, id, lead)?;
        summaries.push(serde_json::json!({
            "sessionId": id, "title": task["title"], "harness": task["harness"],
            "model": task["model"], "status": task["status"],
        }));
    }
    let summary = serde_json::json!({ "status": run["status"], "tasks": summaries });
    conn.execute("INSERT INTO orchestration_sidebar(lead_id, summary) VALUES (?1, ?2) ON CONFLICT(lead_id) DO UPDATE SET summary = excluded.summary", params![lead, summary.to_string()])?;
    Ok(())
}

pub(crate) fn save_orchestration(
    conn: &Connection,
    lead: &str,
    run: &Value,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("INSERT INTO orchestration_runs(lead_id, state) VALUES (?1, ?2) ON CONFLICT(lead_id) DO UPDATE SET state = excluded.state", params![lead, run.to_string()])?;
    index_orchestration(&tx, lead, run)?;
    tx.commit()
}

fn worker_parent(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT lead_id FROM orchestration_workers WHERE session_id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()
}

fn orchestration_summary(conn: &Connection, id: &str) -> rusqlite::Result<Option<Value>> {
    Ok(optional_json(
        conn.query_row(
            "SELECT summary FROM orchestration_sidebar WHERE lead_id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?,
    ))
}

#[cfg(test)]
fn upsert_session(conn: &Connection, session: &SessionUpsert) -> rusqlite::Result<SessionSummary> {
    upsert_session_with_git(conn, session, upsert_git_info(session), None)
        .map(|summary| summary.expect("an unguarded upsert always writes"))
}

/// `expected` is an optional precondition on the stored row: `Some(Some(t))`
/// needs `updated_at == t`, `Some(None)` needs no row. It is checked against
/// the same read the write uses, under the caller's connection lock, and a
/// failed check writes nothing and returns `Ok(None)`.
fn upsert_session_with_git(
    conn: &Connection,
    session: &SessionUpsert,
    git: crate::fs::GitInfo,
    expected: Option<Option<i64>>,
) -> rusqlite::Result<Option<SessionSummary>> {
    let tx = conn.unchecked_transaction()?;
    // Serialise every block once: the pieces feed the per-block rows and,
    // joined, are byte-identical to the compact array text of `blocks_json`.
    let to_sql_err = |e| rusqlite::Error::ToSqlConversionFailure(Box::new(e));
    let (blocks_json, pieces) = match session.blocks.as_array() {
        Some(blocks) => {
            let pieces = blocks
                .iter()
                .map(serde_json::to_string)
                .collect::<Result<Vec<_>, _>>()
                .map_err(to_sql_err)?;
            (format!("[{}]", pieces.join(",")), Some(pieces))
        }
        None => (
            serde_json::to_string(&session.blocks).map_err(to_sql_err)?,
            None,
        ),
    };
    let mut result = upsert_session_core(&tx, session, git, expected, &blocks_json)?;
    if let Some(summary) = result.as_mut() {
        if let Some(pieces) = &pieces {
            incremental::checkpoint(&tx, &session.id, &session.blocks, pieces)?;
        }
        summary.transcript_revision = tx
            .query_row(
                "SELECT revision FROM session_block_state WHERE session_id=?1",
                [&session.id],
                |r| r.get(0),
            )
            .optional()?;
    }
    tx.commit()?;
    Ok(result)
}

/// Whether the row already stores every field that tells the host something
/// changed (everything but the transcript, `adopted_base`, the derived git
/// branch and context usage). Compared with SQL `IS`, so NULLs match NULLs.
pub(crate) fn session_metadata_unchanged(
    conn: &Connection,
    session: &SessionUpsert,
    model_settings: &str,
    linked_work_item_json: Option<&str>,
    rewind_history_json: Option<&str>,
) -> rusqlite::Result<bool> {
    let trimmed = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    conn.query_row(
        "SELECT cwd IS ?2 AND harness IS ?3 AND model IS ?4 AND model_settings IS ?5
            AND runtime_mode IS ?6 AND title IS ?7 AND provider_session_id IS ?8
            AND provider_account_id IS ?9 AND worktree_cwd IS ?10
            AND worktree_removed IS ?11 AND linked_work_item_json IS ?12
            AND automation_id IS ?13 AND rewind_history_json IS ?14
            AND pending_context_replay IS ?15
         FROM sessions WHERE id = ?1",
        params![
            session.id,
            session.cwd,
            session.harness,
            session.model,
            model_settings,
            session.runtime_mode,
            session.title,
            trimmed(&session.provider_session_id),
            trimmed(&session.provider_account_id),
            trimmed(&session.worktree_cwd),
            i64::from(session.worktree_removed),
            linked_work_item_json,
            trimmed(&session.automation_id),
            rewind_history_json,
            session.pending_context_replay,
        ],
        |row| row.get::<_, Option<bool>>(0),
    )
    .optional()
    .map(|value| value.flatten().unwrap_or(false))
}

fn upsert_session_core(
    conn: &Connection,
    session: &SessionUpsert,
    git: crate::fs::GitInfo,
    expected: Option<Option<i64>>,
    blocks_json: &str,
) -> rusqlite::Result<Option<SessionSummary>> {
    let now = now_millis();
    let model_settings = serde_json::to_string(&session.model_settings)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let linked_work_item_json = session
        .linked_work_item
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let rewind_history_json = session
        .rewind_history
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let automation_id = session
        .automation_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_session_id = session
        .provider_session_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let provider_account_id = session
        .provider_account_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let branch = if session.worktree_removed {
        None
    } else {
        git.branch
            .as_deref()
            .filter(|value| !value.is_empty())
            .or_else(|| {
                session
                    .branch
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
    };
    let worktree_cwd = session
        .worktree_cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let has_user_message =
        has_user_block(&session.blocks) || has_archived_user_block(session.rewind_history.as_ref());
    let is_draft = has_draft_block(&session.blocks);

    // The stored blob comes from this same serialiser (serde_json's `Value`
    // keeps keys sorted), so equal text means equal blocks. SQLite compares
    // the bytes itself, so the old blob is neither copied out nor parsed. Text
    // written another way only reads as "changed", which just moves
    // `updated_at` once.
    //
    // A changed `adopted_divergence` (a divergence flagged, or the user's answer
    // to it) moves `updated_at` even when the blocks are the same: the host
    // reads that to learn the answer, and `adopted_base` is only a record of
    // what was agreed, which must not reorder history on its own.
    let existing: Option<(i64, i64, bool, i64, i64, bool)> = conn
        .prepare(
            "SELECT created_at, updated_at, blocks_json = ?2, archived, pinned, adopted_divergence IS ?3 FROM session_transcripts WHERE id = ?1",
        )?
        .query_row(
            params![session.id, blocks_json, session.adopted_divergence],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .optional()?;
    if let Some(expected) = expected {
        if existing.as_ref().map(|(_, updated, _, _, _, _)| *updated) != expected {
            return Ok(None);
        }
    }
    let created_at = existing
        .as_ref()
        .map(|(value, _, _, _, _, _)| *value)
        .unwrap_or_else(|| session.created_at.unwrap_or(now));
    // A title, model, harness or provider-thread change with the same blocks is
    // still something the host has to learn: its only desktop stamp is this one.
    let metadata_unchanged = existing.is_none()
        || session_metadata_unchanged(
            conn,
            session,
            &model_settings,
            linked_work_item_json.as_deref(),
            rewind_history_json.as_deref(),
        )?;
    let updated_at = match &existing {
        Some((_, prev_updated, true, _, _, true)) if metadata_unchanged => *prev_updated,
        Some((_, previous, _, _, _, _)) => now.max(previous + 1),
        None => session.updated_at.unwrap_or(now),
    };
    let archived = existing
        .as_ref()
        .map(|(_, _, _, value, _, _)| *value != 0)
        .unwrap_or(false);
    let pinned = existing
        .as_ref()
        .map(|(_, _, _, _, value, _)| *value != 0)
        .unwrap_or(false);

    conn.prepare(
        "INSERT INTO sessions (
           id, cwd, harness, model, model_settings, runtime_mode, title,
           provider_session_id, blocks_json, created_at, updated_at, branch,
           context_used, context_window, worktree_cwd, has_user_message,
           linked_work_item_json, provider_account_id, worktree_removed, is_draft,
           automation_id, rewind_history_json, pending_context_replay, adopted_divergence, adopted_base
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
         ON CONFLICT(id) DO UPDATE SET
           cwd = excluded.cwd,
           harness = excluded.harness,
           model = excluded.model,
           model_settings = excluded.model_settings,
           runtime_mode = excluded.runtime_mode,
           title = excluded.title,
           provider_session_id = excluded.provider_session_id,
           blocks_json = excluded.blocks_json,
           updated_at = excluded.updated_at,
           branch = excluded.branch,
           context_used = excluded.context_used,
           context_window = excluded.context_window,
           worktree_cwd = excluded.worktree_cwd,
           has_user_message = excluded.has_user_message,
           linked_work_item_json = excluded.linked_work_item_json,
           provider_account_id = excluded.provider_account_id,
           worktree_removed = excluded.worktree_removed,
           is_draft = excluded.is_draft,
           automation_id = excluded.automation_id,
           rewind_history_json = excluded.rewind_history_json,
           pending_context_replay = excluded.pending_context_replay,
           adopted_divergence = excluded.adopted_divergence,
           adopted_base = excluded.adopted_base",
    )?
    .execute(
        params![
            session.id,
            session.cwd,
            session.harness,
            session.model,
            model_settings,
            session.runtime_mode,
            session.title,
            provider_session_id,
            blocks_json,
            created_at,
            updated_at,
            branch,
            session.context_used,
            session.context_window,
            worktree_cwd,
            i64::from(has_user_message),
            linked_work_item_json,
            provider_account_id,
            i64::from(session.worktree_removed),
            i64::from(is_draft),
            automation_id,
            rewind_history_json,
            session.pending_context_replay,
            session.adopted_divergence,
            session.adopted_base,
        ],
    )?;

    remember_worker_from_blocks(conn, &session.id, &session.blocks)?;
    Ok(Some(SessionSummary {
        transcript_revision: None,
        id: session.id.clone(),
        orchestration_lead_id: worker_parent(conn, &session.id)?,
        orchestration: orchestration_summary(conn, &session.id)?,
        cwd: session.cwd.clone(),
        harness: session.harness.clone(),
        model: session.model.clone(),
        runtime_mode: session.runtime_mode.clone(),
        title: session.title.clone(),
        provider_session_id: provider_session_id.map(str::to_owned),
        branch: branch.map(str::to_owned),
        worktree_cwd: worktree_cwd.map(str::to_owned),
        worktree_removed: session.worktree_removed,
        repo: git.repo,
        additions: 0,
        deletions: 0,
        created_at,
        updated_at,
        archived,
        pinned,
        draft: is_draft,
        linked_work_item: session.linked_work_item.clone(),
        automation_id: automation_id.map(str::to_owned),
    }))
}

struct SearchProgressGuard<'a>(&'a Connection);

impl Drop for SearchProgressGuard<'_> {
    fn drop(&mut self) {
        let _ = self.0.progress_handler(1, None::<fn() -> bool>);
    }
}

#[cfg(test)]
fn search_sessions(
    conn: &Connection,
    options: &SessionSearchOptions,
) -> Result<SessionSearchResult, String> {
    let token = begin_session_search(&options.search_owner);
    let _release = SessionSearchRelease(token.clone());
    search_sessions_with_connection(conn, options, token.as_ref())
}

fn search_sessions_sql(include_archived: bool, cwd_scoped: bool) -> String {
    let mut sql = String::from(
        "SELECT id, cwd, harness, title, updated_at, archived,
                CASE WHEN octet_length(blocks_json) <= ?2
                     THEN blocks_json ELSE NULL END
         FROM sessions",
    );
    if !cwd_scoped {
        // Without a `cwd` equality to anchor the leading index column, the
        // planner answers this from a table scan, and every column it reads
        // (`inbox_ask`, `archived`, `has_user_message`, `updated_at`) sits after
        // `blocks_json` in the record, so it walks each transcript's overflow
        // pages before the size guard can reject the row. The partial inbox
        // index answers the same filter without the table, and pinning the
        // covering index keeps the rest of the predicate and the projection
        // inside it: the table is then reached only for `blocks_json` rows that
        // are already known to fit the budget.
        sql.push_str(" INDEXED BY sessions_cwd_cover_idx");
    }
    sql.push_str(
        " WHERE id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
            AND has_user_message = 1
            AND (LOWER(title) LIKE LOWER(?1) ESCAPE '\\'
                 OR CASE WHEN octet_length(blocks_json) <= ?2
                         THEN LOWER(blocks_json) LIKE LOWER(?1) ESCAPE '\\'
                         ELSE 0 END)",
    );
    if !include_archived {
        sql.push_str(" AND archived = 0");
    }
    if cwd_scoped {
        sql.push_str(" AND cwd = ?3");
        sql.push_str(" ORDER BY updated_at DESC, id ASC LIMIT ?4");
    } else {
        sql.push_str(" ORDER BY updated_at DESC, id ASC LIMIT ?3");
    }
    // Preserve the covering-index source for metadata while reading the
    // authoritative normalized transcript for the bounded content predicate.
    sql.replace("blocks_json", "COALESCE((SELECT blocks_json FROM session_transcripts transcript WHERE transcript.id=sessions.id), '[]')")
}

fn search_sessions_with_connection(
    conn: &Connection,
    options: &SessionSearchOptions,
    token: Option<&SessionSearchToken>,
) -> Result<SessionSearchResult, String> {
    let query = options.query.trim();
    if query.is_empty() {
        return Ok(SessionSearchResult {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let needle = query.to_lowercase();
    let pattern = like_pattern(query);
    let cwd = options
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let budget = MAX_SEARCH_BUFFER_BYTES as i64;
    let sql = search_sessions_sql(options.include_archived, cwd.is_some());

    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let limit = (MAX_SEARCH_SCAN as i64) + 1;
    let mut rows = if let Some(cwd) = cwd {
        statement
            .query(params![pattern, budget, cwd, limit])
            .map_err(|e| e.to_string())?
    } else {
        statement
            .query(params![pattern, budget, limit])
            .map_err(|e| e.to_string())?
    };

    let progress_token = token.cloned();
    conn.progress_handler(
        SEARCH_PROGRESS_INTERVAL as i32,
        Some(move || !session_search_is_current(progress_token.as_ref())),
    )
    .map_err(|e| e.to_string())?;
    let _progress_guard = SearchProgressGuard(conn);
    let mut conversations = Vec::new();
    let mut messages = Vec::new();
    let mut scanned = 0usize;
    let mut truncated = false;
    loop {
        if !session_search_is_current(token) {
            return Ok(SessionSearchResult {
                hits: Vec::new(),
                truncated: false,
            });
        }
        let row = match rows.next() {
            Ok(None) => break,
            Ok(Some(row)) => row,
            Err(_) if !session_search_is_current(token) => {
                return Ok(SessionSearchResult {
                    hits: Vec::new(),
                    truncated: false,
                });
            }
            Err(error) => return Err(error.to_string()),
        };
        scanned += 1;
        if scanned > MAX_SEARCH_SCAN {
            truncated = true;
            break;
        }

        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let cwd: String = row.get(1).map_err(|e| e.to_string())?;
        let harness: String = row.get(2).map_err(|e| e.to_string())?;
        let title: String = row.get(3).map_err(|e| e.to_string())?;
        let updated_at: i64 = row.get(4).map_err(|e| e.to_string())?;
        let title_hit = title.to_lowercase().contains(&needle);
        if title_hit && conversations.len() < MAX_CONVERSATION_HITS {
            conversations.push(SessionSearchHit {
                kind: "conversation".into(),
                session_id: id.clone(),
                cwd: cwd.clone(),
                harness: harness.clone(),
                title: title.clone(),
                updated_at,
                block_id: None,
                role: None,
                preview: String::new(),
            });
        }

        if messages.len() >= MAX_MESSAGE_HITS {
            if title_hit {
                continue;
            }
            if conversations.len() >= MAX_CONVERSATION_HITS {
                truncated = true;
                break;
            }
            continue;
        }

        let blocks_raw = match row.get_ref(6).map_err(|e| e.to_string())? {
            rusqlite::types::ValueRef::Null => {
                truncated = true;
                continue;
            }
            value => {
                String::from_utf8_lossy(value.as_bytes().map_err(|e| e.to_string())?).into_owned()
            }
        };
        let Ok(blocks) = serde_json::from_str::<Value>(&blocks_raw) else {
            continue;
        };
        for hit in block_hits(&blocks, &needle) {
            messages.push(SessionSearchHit {
                kind: "message".into(),
                session_id: id.clone(),
                cwd: cwd.clone(),
                harness: harness.clone(),
                title: title.clone(),
                updated_at,
                block_id: Some(hit.0),
                role: Some(hit.1),
                preview: hit.2,
            });
            if messages.len() >= MAX_MESSAGE_HITS {
                truncated = true;
                break;
            }
        }
    }

    if conversations.len() >= MAX_CONVERSATION_HITS {
        truncated = true;
    }
    let mut hits = conversations;
    hits.extend(messages);
    Ok(SessionSearchResult { hits, truncated })
}

fn like_pattern(query: &str) -> String {
    let mut out = String::from("%");
    for ch in query.chars().take(200) {
        match ch {
            '%' | '_' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out.push('%');
    out
}

fn block_hits(blocks: &Value, needle: &str) -> Vec<(String, String, String)> {
    let Some(items) = blocks.as_array() else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    for block in items {
        let role = block
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(
            role,
            "user" | "assistant" | "tool" | "tasks" | "plan" | "image"
        ) {
            continue;
        }
        let id = block
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        for text in block_texts(block) {
            if !text.to_lowercase().contains(needle) {
                continue;
            }
            hits.push((id.clone(), role.to_string(), snippet_around(&text, needle)));
            break;
        }
    }
    hits
}

fn block_texts(block: &Value) -> Vec<String> {
    let mut texts = Vec::new();
    push_text(&mut texts, block.get("text"));
    if let Some(image) = block.get("image") {
        push_text(&mut texts, image.get("name"));
        push_text(&mut texts, image.get("alt"));
    }
    if let Some(tool) = block.get("tool") {
        push_text(&mut texts, tool.get("title"));
        push_text(&mut texts, tool.get("detail"));
        if let Some(preview) = tool.get("preview") {
            push_text(&mut texts, preview.get("query"));
            push_text(&mut texts, preview.get("path"));
            push_text(&mut texts, preview.get("output"));
            push_text(&mut texts, preview.get("title"));
        }
    }
    texts
}

fn push_text(texts: &mut Vec<String>, value: Option<&Value>) {
    if let Some(text) = value.and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            texts.push(trimmed.to_string());
        }
    }
}

fn snippet_around(text: &str, needle: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = compact.to_lowercase();
    let Some(index) = lower.find(needle) else {
        if compact.chars().count() <= SNIPPET_RADIUS * 2 {
            return compact;
        }
        return format!(
            "{}…",
            compact.chars().take(SNIPPET_RADIUS * 2).collect::<String>()
        );
    };
    let start = floor_char_boundary(&compact, index.saturating_sub(SNIPPET_RADIUS));
    let end = ceil_char_boundary(
        &compact,
        (index + needle.len() + SNIPPET_RADIUS).min(compact.len()),
    );
    let mut snippet = compact[start..end].trim().to_string();
    if start > 0 {
        snippet = format!("…{snippet}");
    }
    if end < compact.len() {
        snippet = format!("{snippet}…");
    }
    snippet
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    if index >= text.len() {
        return text.len();
    }
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    if index >= text.len() {
        return text.len();
    }
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

#[cfg(test)]
fn list_by_project(conn: &Connection, cwd: &str) -> rusqlite::Result<Vec<SessionSummary>> {
    list_by_project_with_git(
        conn,
        cwd,
        crate::fs::git_info_for(&crate::fs::expand_home(cwd)),
    )
}

fn list_by_project_with_git(
    conn: &Connection,
    cwd: &str,
    git: crate::fs::GitInfo,
) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                created_at, updated_at, branch, archived, pinned,
                linked_work_item_json,
                (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id), worktree_cwd,
                worktree_removed, is_draft, automation_id
         FROM sessions
         WHERE cwd = ?1
           AND has_user_message = 1
           AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
           AND id NOT IN (SELECT session_id FROM orchestration_workers)
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = statement.query_map(params![cwd], |row| {
        let stored_branch: Option<String> = row.get(9)?;
        let archived: i64 = row.get(10)?;
        let pinned: i64 = row.get(11)?;
        let linked_work_item = optional_json(row.get(12)?);
        Ok(SessionSummary {
            transcript_revision: None,
            id: row.get(0)?,
            orchestration_lead_id: None,
            orchestration: optional_json(row.get(13)?),
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: if row.get::<_, i64>(15)? != 0 {
                None
            } else {
                nonempty(stored_branch).or_else(|| git.branch.clone())
            },
            worktree_cwd: row.get(14)?,
            worktree_removed: row.get::<_, i64>(15)? != 0,
            repo: git.repo.clone(),
            additions: 0,
            deletions: 0,
            archived: archived != 0,
            pinned: pinned != 0,
            draft: row.get::<_, i64>(16)? != 0,
            linked_work_item,
            automation_id: nonempty(row.get(17)?),
        })
    })?;
    rows.collect()
}

// The partial index holds only linked threads, so this walks them already in
// order instead of scanning every session and sorting the hits. Pinned like
// `sessions_cwd_cover_idx`: `migrate` always restores it.
const LIST_LINKED_SQL: &str = "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                created_at, updated_at, branch, archived, pinned,
                linked_work_item_json,
                (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id), worktree_cwd,
                worktree_removed, is_draft, automation_id
         FROM sessions INDEXED BY sessions_linked_idx
         WHERE has_user_message = 1
           AND linked_work_item_json IS NOT NULL
           AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
           AND id NOT IN (SELECT session_id FROM orchestration_workers)
         ORDER BY updated_at DESC, id ASC";

fn list_linked(conn: &Connection) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(LIST_LINKED_SQL)?;
    let rows = statement.query_map([], |row| {
        let archived: i64 = row.get(10)?;
        let pinned: i64 = row.get(11)?;
        Ok(SessionSummary {
            transcript_revision: None,
            id: row.get(0)?,
            orchestration_lead_id: None,
            orchestration: optional_json(row.get(13)?),
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: nonempty(row.get(9)?),
            worktree_cwd: row.get(14)?,
            worktree_removed: row.get::<_, i64>(15)? != 0,
            repo: None,
            additions: 0,
            deletions: 0,
            archived: archived != 0,
            pinned: pinned != 0,
            draft: row.get::<_, i64>(16)? != 0,
            linked_work_item: optional_json(row.get(12)?),
            automation_id: nonempty(row.get(17)?),
        })
    })?;
    rows.collect()
}

/// Newest live sessions across every project, plus every pinned one however
/// old. Read-only and branch-light: it never shells out to git per project.
fn list_recent(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut rows = recent_rows(conn, true, -1)?;
    rows.extend(recent_rows(conn, false, limit.clamp(1, 200))?);
    rows.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(rows)
}

// `sessions_recent_idx` is ordered by (pinned, updated_at DESC, id), so the
// LIMIT stops after a few rows instead of sorting every session; the cover
// index leads with `cwd` and could not give that order. Pinned for the same
// reason the search pins its index: `migrate` always restores it.
const RECENT_ROWS_SQL: &str =
    "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                created_at, updated_at, branch, archived, pinned,
                linked_work_item_json, worktree_cwd, worktree_removed, is_draft,
                automation_id
         FROM sessions INDEXED BY sessions_recent_idx
         WHERE has_user_message = 1
           AND archived = 0
           AND pinned = ?1
           AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
           AND id NOT IN (SELECT session_id FROM orchestration_workers)
         ORDER BY updated_at DESC, id ASC
         LIMIT ?2";

fn recent_rows(
    conn: &Connection,
    pinned: bool,
    limit: i64,
) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(RECENT_ROWS_SQL)?;
    let rows = statement.query_map(params![pinned as i64, limit], |row| {
        let worktree_removed = row.get::<_, i64>(14)? != 0;
        let branch: Option<String> = row.get(9)?;
        Ok(SessionSummary {
            transcript_revision: None,
            id: row.get(0)?,
            orchestration_lead_id: None,
            orchestration: None,
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: if worktree_removed {
                None
            } else {
                nonempty(branch)
            },
            worktree_cwd: row.get(13)?,
            worktree_removed,
            repo: None,
            additions: 0,
            deletions: 0,
            archived: row.get::<_, i64>(10)? != 0,
            pinned: row.get::<_, i64>(11)? != 0,
            draft: row.get::<_, i64>(15)? != 0,
            linked_work_item: optional_json(row.get(12)?),
            automation_id: nonempty(row.get(16)?),
        })
    })?;
    rows.collect()
}

/// Mirrors the sidebar's notion of a listable session: a transcript that the
/// user has actually said something in.
fn has_user_block(blocks: &Value) -> bool {
    blocks.as_array().is_some_and(|blocks| {
        blocks
            .iter()
            .any(|block| block.get("role").and_then(Value::as_str) == Some("user"))
    })
}

fn has_archived_user_block(history: Option<&Value>) -> bool {
    history
        .and_then(Value::as_array)
        .is_some_and(|entries| entries.iter().any(|entry| has_user_block(&entry["blocks"])))
}

fn has_draft_block(blocks: &Value) -> bool {
    blocks.as_array().is_some_and(|blocks| {
        blocks.iter().any(|block| {
            block.get("role").and_then(Value::as_str) == Some("user")
                && block.get("draft").and_then(Value::as_bool) == Some(true)
        })
    })
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

fn optional_json(raw: Option<String>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

fn delete_session(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let parent = worker_parent(&tx, session_id)?;
    // Ownership is also carried in transcripts for older clients. Release
    // that metadata along with the index so reopening a worker stays detached.
    let workers = tx.prepare("SELECT id, blocks_json FROM session_transcripts WHERE id IN (SELECT session_id FROM orchestration_workers WHERE lead_id = ?1)")?
        .query_map([session_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, raw) in workers {
        let mut blocks: Value = serde_json::from_str(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?;
        if let Some(blocks) = blocks.as_array_mut() {
            for block in blocks {
                if block["orchestrationLeadId"] == session_id {
                    if let Some(block) = block.as_object_mut() {
                        block.remove("orchestrationLeadId");
                    }
                }
            }
        }
        tx.execute(
            "UPDATE sessions SET blocks_json = ?1 WHERE id = ?2",
            params![blocks.to_string(), id],
        )?;
    }
    tx.execute(
        "DELETE FROM orchestration_runs WHERE lead_id = ?1",
        [session_id],
    )?;
    tx.execute(
        "DELETE FROM orchestration_sidebar WHERE lead_id = ?1",
        [session_id],
    )?;
    if let Some(parent) = parent.filter(|id| id != session_id) {
        let raw: Option<String> = tx
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id = ?1",
                [&parent],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(raw) = raw {
            let mut run: Value = serde_json::from_str(&raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            let mut removed = false;
            if let Some(tasks) = run["tasks"].as_array_mut() {
                let ids: Vec<String> = tasks
                    .iter()
                    .filter(|task| task["sessionId"] == session_id)
                    .filter_map(|task| task["id"].as_str().map(str::to_string))
                    .collect();
                let before = tasks.len();
                tasks.retain(|task| task["sessionId"] != session_id);
                removed = before != tasks.len();
                if removed {
                    for task in tasks {
                        if let Some(deps) = task["dependsOn"].as_array_mut() {
                            deps.retain(|dep| !ids.iter().any(|id| dep == id));
                        }
                        // Removing a prerequisite must not release queued work.
                        // The app stops the run before deleting any current member.
                        if matches!(
                            task["status"].as_str(),
                            Some("queued" | "running" | "cancelling")
                        ) {
                            task["status"] = json!("cancelled");
                            task["accepted"] = json!(false);
                            task["delivered"] = json!(true);
                        }
                    }
                }
            }
            if removed {
                if matches!(run["status"].as_str(), Some("active" | "paused")) {
                    run["status"] = json!("stopped");
                    run["error"] =
                        json!("A worker conversation was deleted. Start a new run to continue.");
                }
                run["requests"] = json!({});
                tx.execute(
                    "UPDATE orchestration_runs SET state = ?1 WHERE lead_id = ?2",
                    params![run.to_string(), parent],
                )?;
                index_orchestration(&tx, &parent, &run)?;
            }
        }
        // Also handle summaries left by an older client without a run record.
        if let Some(mut summary) = orchestration_summary(&tx, &parent)? {
            if let Some(tasks) = summary["tasks"].as_array_mut() {
                tasks.retain(|task| task["sessionId"] != session_id);
            }
            tx.execute(
                "UPDATE orchestration_sidebar SET summary = ?1 WHERE lead_id = ?2",
                params![summary.to_string(), parent],
            )?;
        }
    }
    tx.execute(
        "DELETE FROM orchestration_workers WHERE session_id = ?1 OR lead_id = ?1",
        [session_id],
    )?;
    content_search::forget_session(&tx, session_id)?;
    tx.execute(
        "DELETE FROM session_queues WHERE session_id = ?1",
        [session_id],
    )?;
    tx.execute("DELETE FROM sessions WHERE id = ?1", [session_id])?;
    tx.commit()
}

fn set_archived(conn: &Connection, session_id: &str, archived: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET archived = ?1 WHERE id = ?2",
        params![if archived { 1 } else { 0 }, session_id],
    )?;
    Ok(())
}

fn set_pinned(conn: &Connection, session_id: &str, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET pinned = ?1 WHERE id = ?2",
        params![if pinned { 1 } else { 0 }, session_id],
    )?;
    Ok(())
}

fn set_linked_work_item(
    conn: &Connection,
    session_id: &str,
    linked_work_item: Option<&Value>,
) -> rusqlite::Result<()> {
    let linked_work_item_json = linked_work_item
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    conn.execute(
        "UPDATE sessions SET linked_work_item_json = ?1 WHERE id = ?2",
        params![linked_work_item_json, session_id],
    )?;
    Ok(())
}

/// Reads a session row with `blocks` and `model_settings` left as `Null`,
/// returning the stored JSON texts of those two fields next to it.
fn read_session_row(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<(SessionRecord, String, String)>> {
    read_session_row_from(conn, session_id, true)
}

fn read_session_row_from(
    conn: &Connection,
    session_id: &str,
    include_blocks: bool,
) -> rusqlite::Result<Option<(SessionRecord, String, String)>> {
    conn.query_row(
        "SELECT id, cwd, harness, model, model_settings, runtime_mode, title,
                provider_session_id, CASE WHEN ?2 THEN blocks_json ELSE '[]' END, created_at, updated_at,
                context_used, context_window, branch, worktree_cwd,
                linked_work_item_json, provider_account_id, worktree_removed,
                automation_id, rewind_history_json, pending_context_replay, adopted_divergence,
                adopted_base
         FROM session_transcripts
         WHERE id = ?1 AND inbox_ask IS NULL",
        params![session_id,include_blocks],
        |row| {
            let model_settings_raw: String = row.get(4)?;
            let blocks_raw: String = row.get(8)?;
            let record = SessionRecord {
                transcript_revision: conn.query_row("SELECT revision FROM session_block_state WHERE session_id=?1", [session_id], |r|r.get(0)).optional()?,
                id: row.get(0)?,
                orchestration_lead_id: worker_parent(conn, session_id)?,
                cwd: row.get(1)?,
                harness: row.get(2)?,
                model: row.get(3)?,
                model_settings: Value::Null,
                runtime_mode: row.get(5)?,
                title: row.get(6)?,
                provider_session_id: row.get(7)?,
                blocks: Value::Null,
                context_used: row.get(11)?,
                context_window: row.get(12)?,
                branch: row.get(13)?,
                worktree_cwd: row.get(14)?,
                worktree_removed: row.get::<_, i64>(17)? != 0,
                linked_work_item: optional_json(row.get(15)?),
                provider_account_id: row.get(16)?,
                automation_id: nonempty(row.get(18)?),
                rewind_history: optional_json(row.get(19)?),
                pending_context_replay: row.get(20)?,
                adopted_divergence: row.get(21)?,
                adopted_base: row.get(22)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            };
            Ok((record, model_settings_raw, blocks_raw))
        },
    )
    .optional()
}

fn json_conversion_error(index: usize, error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error))
}

fn get_session(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<SessionRecord>> {
    let Some((mut record, model_settings_raw, blocks_raw)) = read_session_row(conn, session_id)?
    else {
        return Ok(None);
    };
    record.model_settings =
        serde_json::from_str(&model_settings_raw).map_err(|e| json_conversion_error(4, e))?;
    record.blocks = serde_json::from_str(&blocks_raw).map_err(|e| json_conversion_error(8, e))?;
    Ok(Some(record))
}

/// Same JSON as serialising `get_session`'s record, but the two large stored
/// texts are spliced in verbatim after a validity check instead of being
/// parsed into a `Value` tree and serialised again.
fn get_session_json(conn: &Connection, session_id: &str) -> rusqlite::Result<String> {
    let Some((record, model_settings_raw, blocks_raw)) = read_session_row(conn, session_id)? else {
        return Ok("null".to_string());
    };
    serde_json::from_str::<serde::de::IgnoredAny>(&model_settings_raw)
        .map_err(|e| json_conversion_error(4, e))?;
    serde_json::from_str::<serde::de::IgnoredAny>(&blocks_raw)
        .map_err(|e| json_conversion_error(8, e))?;
    let mut head = match serde_json::to_value(&record) {
        Ok(Value::Object(mut map)) => {
            map.remove("blocks");
            map.remove("modelSettings");
            serde_json::to_string(&map)
        }
        Ok(_) => unreachable!("SessionRecord serialises as an object"),
        Err(e) => Err(e),
    }
    .map_err(|e| json_conversion_error(0, e))?;
    // `head` is a non-empty object ("id" is always present); reopen it.
    head.pop();
    head.push_str(",\"modelSettings\":");
    head.push_str(model_settings_raw.trim());
    head.push_str(",\"blocks\":");
    head.push_str(blocks_raw.trim());
    head.push('}');
    Ok(head)
}

fn list_in_flight(conn: &Connection) -> rusqlite::Result<Vec<InFlightSession>> {
    let mut statement = conn.prepare(
        "SELECT session_id, cwd FROM in_flight_sessions ORDER BY sort_index ASC, session_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(InFlightSession {
            session_id: row.get(0)?,
            cwd: row.get(1)?,
        })
    })?;
    rows.collect()
}

fn replace_in_flight(conn: &mut Connection, sessions: &[InFlightSession]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM in_flight_sessions", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO in_flight_sessions (session_id, cwd, sort_index)
             VALUES (?1, ?2, ?3)",
        )?;
        for (index, session) in sessions.iter().enumerate() {
            insert.execute(params![session.session_id, session.cwd, index as i64])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn take_in_flight(conn: &mut Connection) -> rusqlite::Result<Vec<InFlightSession>> {
    let tx = conn.transaction()?;
    let sessions = {
        let mut statement = tx.prepare(
            "SELECT session_id, cwd FROM in_flight_sessions ORDER BY sort_index ASC, session_id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(InFlightSession {
                session_id: row.get(0)?,
                cwd: row.get(1)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    tx.execute("DELETE FROM in_flight_sessions", [])?;
    tx.commit()?;
    Ok(sessions)
}

fn set_workspace_snapshot(conn: &Connection, json: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO workspace_snapshot (id, snapshot_json, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at",
        params![json, now_millis()],
    )?;
    Ok(())
}

fn get_workspace_snapshot(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT snapshot_json FROM workspace_snapshot WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("Invalid {label} id"));
    }
    Ok(())
}

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::hooks::{AuthAction, Authorization};
    use serde_json::json;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn session_get_json_equals_the_typed_record() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        conn.execute(
            "INSERT INTO sessions (
               id, cwd, harness, model, model_settings, runtime_mode, title,
               blocks_json, created_at, updated_at, branch, linked_work_item_json
             ) VALUES ('s1', '/w', 'codex', 'm', ' {\"effort\": \"high\"} ', 'supervised',
                       'T', ?1, 5, 7, 'main', '{\"id\":\"w\"}')",
            [r#" [{"id":"a","role":"user","text":"héllo \"q\""},{"id":"b","n":1.50}] "#],
        )
        .unwrap();
        let typed = serde_json::to_value(get_session(&conn, "s1").unwrap().unwrap()).unwrap();
        let raw: Value = serde_json::from_str(&get_session_json(&conn, "s1").unwrap()).unwrap();
        assert_eq!(raw, typed);
        assert_eq!(raw["modelSettings"]["effort"], "high");
        assert_eq!(raw["blocks"][0]["text"], "h\u{e9}llo \"q\"");
        assert_eq!(get_session_json(&conn, "missing").unwrap(), "null");
    }

    #[test]
    fn session_get_json_rejects_corrupt_stored_json() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        conn.execute(
            "INSERT INTO sessions (
               id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at
             ) VALUES ('bad', '/w', 'codex', 'm', 'supervised', 'T', '[{', 1, 1)",
            [],
        )
        .unwrap();
        assert!(get_session(&conn, "bad").is_err());
        assert!(get_session_json(&conn, "bad").is_err());
    }

    #[test]
    fn startup_does_not_read_saved_transcripts() {
        let data_dir = std::env::temp_dir().join(format!(
            "bycoda-startup-transcripts-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = data_dir.join("bycoda.db");
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            conn.execute(
                "INSERT INTO sessions (
                   id, cwd, harness, model, runtime_mode, title,
                   blocks_json, created_at, updated_at
                 ) VALUES ('large', '/tmp', 'codex', 'test', 'supervised', 'Large', ?1, 1, 1)",
                ["x".repeat(8_000_000)],
            )
            .unwrap();
        }

        let transcript_reads = Arc::new(AtomicUsize::new(0));
        let reads = Arc::clone(&transcript_reads);
        let mut managed = None;
        init_with(
            || Ok(data_dir.clone()),
            |requested_path| {
                assert_eq!(requested_path, path);
                let store = SessionStore::open(requested_path)?;
                store
                    .lock_conn()?
                    .authorizer(Some(move |context: rusqlite::hooks::AuthContext<'_>| {
                        if matches!(
                            context.action,
                            AuthAction::Read {
                                table_name: "sessions",
                                column_name: "blocks_json"
                            }
                        ) {
                            reads.fetch_add(1, Ordering::Relaxed);
                            Authorization::Deny
                        } else {
                            Authorization::Allow
                        }
                    }))
                    .map_err(|error| error.to_string())?;
                Ok(store)
            },
            |store| managed = Some(store),
        )
        .unwrap();
        assert_eq!(transcript_reads.load(Ordering::Relaxed), 0);
        drop(managed);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    fn sample(id: &str, cwd: &str, title: &str) -> SessionUpsert {
        SessionUpsert {
            id: id.into(),
            cwd: cwd.into(),
            harness: "cursor".into(),
            model: "gpt-5".into(),
            model_settings: json!({ "thinking": "high" }),
            runtime_mode: "supervised".into(),
            title: title.into(),
            provider_session_id: Some("acp-session-1".into()),
            provider_account_id: None,
            blocks: json!([{ "id": "b1", "role": "user", "text": "hello" }]),
            context_used: None,
            context_window: None,
            branch: None,
            worktree_cwd: None,
            worktree_removed: false,
            linked_work_item: None,
            automation_id: None,
            rewind_history: None,
            pending_context_replay: None,
            adopted_divergence: None,
            adopted_base: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn rewind_header_round_trips_separately_from_active_blocks() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut session = sample("rewind-roundtrip", "/tmp/project", "Rewind");
        session.blocks = json!([]);
        session.rewind_history = Some(json!([{
            "id": "archive-1",
            "createdAt": 123,
            "fromBlockId": "removed-user",
            "blocks": [{ "id": "removed-user", "role": "user", "text": "archived prompt",
                "attachments": [{ "id": "file-1", "name": "notes.txt", "kind": "file", "mimeType": "text/plain", "size": 7, "path": "/tmp/notes.txt" }] }]
        }]));
        session.pending_context_replay = Some("retained transcript context".into());
        upsert_session(&conn, &session).unwrap();

        let restored = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(restored.blocks, session.blocks);
        assert_eq!(restored.rewind_history, session.rewind_history);
        assert_eq!(
            restored.pending_context_replay.as_deref(),
            Some("retained transcript context")
        );
    }

    #[test]
    fn adopted_divergence_round_trips_and_clears() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut session = sample("divergence-roundtrip", "/tmp/project", "Divergence");
        session.adopted_divergence = Some(r#"{"key":"3:a:b","keep":true}"#.into());
        upsert_session(&conn, &session).unwrap();
        let restored = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(
            restored.adopted_divergence.as_deref(),
            Some(r#"{"key":"3:a:b","keep":true}"#)
        );

        session.adopted_divergence = None;
        upsert_session(&conn, &session).unwrap();
        let restored = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(restored.adopted_divergence, None);
    }

    #[test]
    fn adopted_base_round_trips_and_clears() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut session = sample("base-roundtrip", "/tmp/project", "Base");
        let base = r#"{"count":3,"chain":"0123456789abcdef0123456789abcdef"}"#;
        session.adopted_base = Some(base.into());
        upsert_session(&conn, &session).unwrap();
        let restored = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(restored.adopted_base.as_deref(), Some(base));
        // The divergence and the base are separate columns.
        assert_eq!(restored.adopted_divergence, None);

        session.adopted_base = None;
        upsert_session(&conn, &session).unwrap();
        let restored = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(restored.adopted_base, None);
    }

    #[test]
    fn an_answered_divergence_moves_updated_at_but_a_recorded_base_does_not() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut session = sample("answer-touch", "/tmp/project", "Answer");
        let first = upsert_session(&conn, &session).unwrap().updated_at;

        // Recording what was agreed is bookkeeping: history keeps its order.
        session.adopted_base =
            Some(r#"{"count":1,"chain":"0123456789abcdef0123456789abcdef"}"#.into());
        let recorded = upsert_session(&conn, &session).unwrap().updated_at;
        assert_eq!(recorded, first);

        // A flagged divergence, and the answer to it, are something to tell the host.
        session.adopted_divergence = Some(r#"{"key":"k"}"#.into());
        let flagged = upsert_session(&conn, &session).unwrap().updated_at;
        assert!(flagged > recorded);
        let same = upsert_session(&conn, &session).unwrap().updated_at;
        assert_eq!(same, flagged);
        session.adopted_divergence = Some(r#"{"key":"k","keep":true}"#.into());
        let answered = upsert_session(&conn, &session).unwrap().updated_at;
        assert!(answered > flagged);
    }

    #[test]
    fn a_metadata_only_save_moves_updated_at_but_a_repeat_or_base_does_not() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut session = sample("metadata-touch", "/tmp/project", "Metadata");
        let mut last = upsert_session(&conn, &session).unwrap().updated_at;
        let mut moved = |session: &SessionUpsert| {
            let at = upsert_session(&conn, session).unwrap().updated_at;
            let did = at > last;
            last = at;
            did
        };
        assert!(!moved(&session), "repeat of the same save");
        session.title = "Renamed".into();
        assert!(moved(&session), "title");
        session.model = "other-model".into();
        assert!(moved(&session), "model");
        session.harness = "claude".into();
        assert!(moved(&session), "harness");
        session.provider_session_id = Some("thread-1".into());
        assert!(moved(&session), "provider thread");
        assert!(!moved(&session), "same provider thread again");
        session.adopted_base =
            Some(r#"{"count":1,"chain":"0123456789abcdef0123456789abcdef"}"#.into());
        assert!(!moved(&session), "adopted_base alone");
        session.adopted_divergence = Some(r#"{"key":"k"}"#.into());
        assert!(moved(&session), "divergence");
    }

    #[test]
    fn imported_sessions_keep_their_timestamps_and_are_never_replaced() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut import = sample("imp-cursor-acp-session-1", "/tmp/project", "Imported");
        import.created_at = Some(1_000);
        import.updated_at = Some(2_000);
        assert!(!import_already_stored(&conn, &import).unwrap());
        let summary = upsert_session(&conn, &import).unwrap();
        assert_eq!((summary.created_at, summary.updated_at), (1_000, 2_000));

        // Same id, or a different id carrying the same provider conversation.
        assert!(import_already_stored(&conn, &import).unwrap());
        let mut renamed = sample("other-id", "/tmp/project", "Imported");
        assert!(import_already_stored(&conn, &renamed).unwrap());
        renamed.harness = "claude".into();
        assert!(!import_already_stored(&conn, &renamed).unwrap());
        renamed.provider_session_id = None;
        assert!(!import_already_stored(&conn, &renamed).unwrap());

        // Continuing the chat afterwards moves `updated_at` like any session.
        let mut continued = import.clone();
        continued.blocks = json!([{ "id": "b2", "role": "user", "text": "more" }]);
        let summary = upsert_session(&conn, &continued).unwrap();
        assert_eq!(summary.created_at, 1_000);
        assert!(summary.updated_at > 2_000);

        // A read-only import has no provider binding; its id is the key.
        let mut readonly = sample("imp-codex-abc", "/tmp/project", "Read only");
        readonly.provider_session_id = None;
        upsert_session(&conn, &readonly).unwrap();
        let mut keys = import_keys(&conn).unwrap();
        keys.sort();
        assert_eq!(
            keys,
            [
                "cursor:acp-session-1",
                "imp-codex-abc",
                "imp-cursor-acp-session-1"
            ]
        );
    }

    #[test]
    fn legacy_inbox_chats_are_not_normal_sessions() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert_session(&conn, &sample("project", "/tmp/project", "Login")).unwrap();
        upsert_session(&conn, &sample("ask", "/tmp/project", "Login")).unwrap();
        conn.execute("UPDATE sessions SET inbox_ask = '{}' WHERE id = 'ask'", [])
            .unwrap();
        migrate(&conn).unwrap();
        let rows = list_by_project(&conn, "/tmp/project").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "project");
        assert!(get_session(&conn, "ask").unwrap().is_none());
        let search = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Login".into(),
                cwd: None,
                include_archived: true,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(search.hits.iter().all(|hit| hit.session_id == "project"));
        // Hiding the old implementation's records does not delete their data.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn orchestration_history_groups_workers_and_keeps_their_transcripts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "worker-a", "worker-b", "unrelated"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        let run = json!({"status": "active", "tasks": [
            {"sessionId": "worker-a", "title": "UI", "harness": "codex", "model": "one", "status": "running", "prompt": "private instructions", "result": "large result"},
            {"sessionId": "worker-b", "title": "Tests", "harness": "claude", "model": "two", "status": "queued"}
        ]});
        save_orchestration(&conn, "lead", &run).unwrap();
        // Reopening/migration must not hydrate, pause or otherwise mutate runs.
        migrate(&conn).unwrap();
        let rows = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(rows.len(), 2);
        let lead = rows.iter().find(|row| row.id == "lead").unwrap();
        let summary = lead.orchestration.as_ref().unwrap();
        assert_eq!(summary["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(summary["status"], "active");
        assert!(summary["tasks"][0].get("prompt").is_none());
        assert!(summary["tasks"][0].get("result").is_none());
        let worker = get_session(&conn, "worker-a").unwrap().unwrap();
        assert_eq!(worker.orchestration_lead_id.as_deref(), Some("lead"));
        assert!(has_user_block(&worker.blocks));
        // A later run replaces the card's agents without resurfacing old chats.
        save_orchestration(&conn, "lead", &json!({"status": "active", "tasks": []})).unwrap();
        assert_eq!(list_by_project(&conn, "/tmp/a").unwrap().len(), 2);
    }

    #[test]
    fn worker_upserts_carry_ownership_before_the_run_is_saved() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut worker = sample("worker", "/tmp/a", "Worker");
        worker.blocks =
            json!([{"id": "u", "role": "user", "text": "Task", "orchestrationLeadId": "lead"}]);
        worker.linked_work_item = Some(json!({"kind": "pr", "number": 1}));
        let summary = upsert_session(&conn, &worker).unwrap();
        assert_eq!(summary.orchestration_lead_id.as_deref(), Some("lead"));
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());
        assert!(list_linked(&conn).unwrap().is_empty());
        // An older renderer's next write cannot accidentally detach a worker.
        worker.blocks = json!([{"id": "u", "role": "user", "text": "Task"}]);
        upsert_session(&conn, &worker).unwrap();
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());
    }

    #[test]
    fn migration_groups_workers_from_the_earlier_preview() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "old-worker", "current-worker"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        conn.execute(
            "UPDATE sessions SET blocks_json = ?1 WHERE id = 'old-worker'",
            [
                json!([{"role": "user", "orchestrationLeadId": "lead", "text": "Old task"}])
                    .to_string(),
            ],
        )
        .unwrap();
        conn.execute("INSERT INTO orchestration_runs(lead_id, state) VALUES ('lead', ?1)", [json!({"status": "paused", "tasks": [{"sessionId": "current-worker", "title": "Task", "harness": "codex", "model": "one", "status": "completed"}]}).to_string()]).unwrap();
        conn.execute_batch("DROP TABLE orchestration_sidebar; DROP TABLE orchestration_workers;")
            .unwrap();
        migrate(&conn).unwrap();
        let rows = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "lead");
        assert_eq!(
            rows[0].orchestration.as_ref().unwrap()["tasks"][0]["title"],
            "Task"
        );
        assert_eq!(
            worker_parent(&conn, "old-worker").unwrap().as_deref(),
            Some("lead")
        );
        assert_eq!(
            worker_parent(&conn, "current-worker").unwrap().as_deref(),
            Some("lead")
        );
    }

    /// The sidebar query must stay answerable from the index alone. Selecting a
    /// column the index does not carry silently reintroduces a table seek per
    /// row, and every summary column sits behind a ~180 KB `blocks_json` blob
    /// in the record, so that regression is worth ~30x on a real project.
    #[test]
    fn list_by_project_is_served_by_a_covering_index() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "A1")).unwrap();
        for upgraded in [false, true] {
            if upgraded {
                // Exercise an existing v15 database with the old projection.
                conn.execute_batch(
                    "DROP INDEX sessions_cwd_cover_idx;
                     CREATE INDEX sessions_cwd_cover_idx
                       ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                                    model, runtime_mode, title, provider_session_id,
                                    created_at, branch, archived, pinned, linked_work_item_json);
                     DELETE FROM schema_migrations WHERE version IN (16, 17, 18);",
                )
                .unwrap();
                migrate(&conn).unwrap();
            }
            let plan: String = conn
                .query_row(
                    "EXPLAIN QUERY PLAN
                 SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                        created_at, updated_at, branch, archived, pinned,
                        linked_work_item_json, worktree_cwd, worktree_removed, is_draft,
                        automation_id,
                        (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id)
                 FROM sessions
                 WHERE cwd = ?1
                   AND has_user_message = 1
                   AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
                   AND id NOT IN (SELECT session_id FROM orchestration_workers)
                 ORDER BY updated_at DESC, id ASC",
                    params!["/tmp/a"],
                    |row| row.get(3),
                )
                .unwrap();
            assert!(
                plan.contains("COVERING INDEX"),
                "sidebar listing fell back to table seeks: {plan}"
            );
        }
    }

    #[test]
    fn upsert_tracks_whether_a_user_has_spoken() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut quiet = sample("s1", "/tmp/a", "Quiet");
        quiet.blocks = json!([{ "id": "b1", "role": "assistant", "text": "hi" }]);
        upsert_session(&conn, &quiet).unwrap();
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());

        // The flag has to follow the transcript, not just the first write.
        quiet.blocks = json!([
            { "id": "b1", "role": "assistant", "text": "hi" },
            { "id": "b2", "role": "user", "text": "hello" }
        ]);
        upsert_session(&conn, &quiet).unwrap();
        assert_eq!(list_by_project(&conn, "/tmp/a").unwrap().len(), 1);
    }

    #[test]
    fn draft_marker_round_trips_through_session_summaries() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Draft");
        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "start" },
            { "id": "b2", "role": "assistant", "text": "done" },
            { "id": "b3", "role": "user", "text": "hello", "draft": true }
        ]);

        let saved = upsert_session(&conn, &session).unwrap();
        assert!(saved.draft);
        assert!(list_by_project(&conn, "/tmp/a").unwrap()[0].draft);

        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "start" },
            { "id": "b2", "role": "assistant", "text": "done" },
            { "id": "b3", "role": "user", "text": "hello" }
        ]);
        let sent = upsert_session(&conn, &session).unwrap();
        assert!(!sent.draft);
        assert!(!list_by_project(&conn, "/tmp/a").unwrap()[0].draft);
    }

    #[test]
    fn migrate_creates_sessions_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
        let branch: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'branch'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(branch, 1);
    }

    fn seed_legacy_migration(conn: &Connection, version: i64) {
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
               version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
             );
             INSERT INTO sessions (
               id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at
             ) VALUES ('legacy', '/legacy', 'codex', 'test', 'supervised',
                       'Keep me', '[{\"role\":\"user\",\"text\":\"saved transcript\"}]', 10, 20);",
        )
        .unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1, 1)", [version])
            .unwrap();
        for (introduced, sql) in [
            (2, "ALTER TABLE sessions ADD COLUMN branch TEXT"),
            (3, "ALTER TABLE sessions ADD COLUMN context_used INTEGER"),
            (3, "ALTER TABLE sessions ADD COLUMN context_window INTEGER"),
            (
                6,
                "ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
            ),
            (7, "ALTER TABLE sessions ADD COLUMN worktree_cwd TEXT"),
        ] {
            if version >= introduced {
                conn.execute(sql, []).unwrap();
            }
        }
    }

    #[test]
    fn migrate_recovers_every_durable_legacy_prefix_after_reopen() {
        // These autocommitted statements model each possible interruption point
        // of the old v2/v3/v6/v7 migrations, before their version marker landed.
        for (version, prefix, column, value) in [
            (
                2,
                "ALTER TABLE sessions ADD COLUMN branch TEXT",
                "branch",
                "saved-branch",
            ),
            (
                3,
                "ALTER TABLE sessions ADD COLUMN context_used INTEGER",
                "context_used",
                "123",
            ),
            (
                3,
                "ALTER TABLE sessions ADD COLUMN context_used INTEGER;
                 ALTER TABLE sessions ADD COLUMN context_window INTEGER",
                "context_window",
                "456",
            ),
            (
                6,
                "ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
                "archived",
                "1",
            ),
            (
                7,
                "ALTER TABLE sessions ADD COLUMN worktree_cwd TEXT",
                "worktree_cwd",
                "/saved-worktree",
            ),
        ] {
            let path = std::env::temp_dir().join(format!(
                "bycoda-legacy-migration-{}.db",
                uuid::Uuid::new_v4()
            ));
            {
                let conn = Connection::open(&path).unwrap();
                seed_legacy_migration(&conn, version - 1);
                conn.execute_batch(prefix).unwrap();
                conn.execute(&format!("UPDATE sessions SET {column} = ?1"), [value])
                    .unwrap();
            }
            // Use the production open path, including WAL and ancillary schemas.
            for _ in 0..2 {
                let store = SessionStore::open(path.clone()).unwrap();
                let conn = store.lock_conn().unwrap();
                let row: (String, String, i64, i64) = conn.query_row(
                    "SELECT title, blocks_json, created_at, updated_at FROM sessions WHERE id = 'legacy'",
                    [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                ).unwrap();
                assert_eq!(
                    row,
                    (
                        "Keep me".into(),
                        "[{\"role\":\"user\",\"text\":\"saved transcript\"}]".into(),
                        10,
                        20
                    )
                );
                let retained: String = conn
                    .query_row(
                        &format!("SELECT CAST({column} AS TEXT) FROM sessions WHERE id = 'legacy'"),
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(retained, value, "legacy v{version} prefix: {prefix}");
                let latest: i64 = conn
                    .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(latest, 18);
                let count: i64 = conn
                    .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(count, 1);
            }
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn migrate_rolls_back_legacy_schema_changes_when_marker_write_fails() {
        for (version, column) in [
            (2, "branch"),
            (3, "context_used"),
            (6, "archived"),
            (7, "worktree_cwd"),
        ] {
            let path = std::env::temp_dir().join(format!(
                "bycoda-migration-rollback-{}.db",
                uuid::Uuid::new_v4()
            ));
            {
                let conn = Connection::open(&path).unwrap();
                seed_legacy_migration(&conn, version - 1);
                conn.execute_batch(&format!(
                    "CREATE TRIGGER fail_migration_marker BEFORE INSERT ON schema_migrations
                     WHEN NEW.version = {version} BEGIN SELECT RAISE(ABORT, 'injected interruption'); END;"
                )).unwrap();
                assert!(migrate(&conn).is_err());
                assert!(conn.is_autocommit());
            }
            {
                let conn = Connection::open(&path).unwrap();
                let present: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
                        [column],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    present, 0,
                    "v{version} ALTER must roll back with its marker"
                );
                let latest: i64 = conn
                    .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(latest, version - 1);
                conn.execute_batch("DROP TRIGGER fail_migration_marker")
                    .unwrap();
            }
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            let retained: String = conn
                .query_row(
                    "SELECT title FROM sessions WHERE id = 'legacy'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(retained, "Keep me");
            drop(conn);
            drop(store);
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn migrate_rolls_back_fresh_schema_when_legacy_marker_write_fails() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
               version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
             );
             CREATE TRIGGER fail_migration_marker BEFORE INSERT ON schema_migrations
             WHEN NEW.version = 3 BEGIN SELECT RAISE(ABORT, 'injected interruption'); END;",
        )
        .unwrap();
        assert!(migrate(&conn).is_err());
        assert!(conn.is_autocommit());
        let sessions: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sessions, 0);
        let markers: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(markers, 0);
        conn.execute_batch("DROP TRIGGER fail_migration_marker")
            .unwrap();
        migrate(&conn).unwrap();
    }

    #[test]
    fn upsert_preserves_created_at_and_updates_fields() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let first = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut next = sample("s1", "/tmp/a", "Updated");
        next.provider_session_id = Some("acp-session-2".into());
        next.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "world" }
        ]);
        let second = upsert_session(&conn, &next).unwrap();
        assert_eq!(second.created_at, first.created_at);
        assert!(second.updated_at > first.updated_at);
        assert_eq!(second.title, "Updated");
        assert_eq!(second.provider_session_id.as_deref(), Some("acp-session-2"));
    }

    #[test]
    fn upsert_moves_updated_at_when_blocks_or_metadata_change() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let first = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        // Same blocks, different key order in the source JSON: still unchanged.
        let mut same = sample("s1", "/tmp/a", "Retitled");
        same.blocks =
            serde_json::from_str(r#"[{"text":"hello","role":"user","id":"b1"}]"#).unwrap();
        let retitled = upsert_session(&conn, &same).unwrap();
        assert!(retitled.updated_at > first.updated_at);
        assert_eq!(retitled.title, "Retitled");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let unchanged = upsert_session(&conn, &same).unwrap();
        assert_eq!(unchanged.updated_at, retitled.updated_at);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut changed = sample("s1", "/tmp/a", "Retitled");
        changed.blocks = json!([{ "id": "b1", "role": "user", "text": "hello!" }]);
        let bumped = upsert_session(&conn, &changed).unwrap();
        assert!(bumped.updated_at > retitled.updated_at);
    }

    #[test]
    fn upsert_treats_non_canonical_stored_blocks_as_changed() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let first = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        conn.execute(
            "UPDATE sessions SET blocks_json = '[ {\"id\":\"b1\",\"role\":\"user\",\"text\":\"hello\"} ]' WHERE id = 's1'",
            [],
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let again = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        assert!(again.updated_at > first.updated_at);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let settled = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        assert_eq!(settled.updated_at, again.updated_at);
    }

    #[test]
    fn context_usage_round_trips() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "First");
        row.context_used = Some(29_821);
        row.context_window = Some(1_000_000);
        upsert_session(&conn, &row).unwrap();
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.context_used, Some(29_821));
        assert_eq!(stored.context_window, Some(1_000_000));
    }

    #[test]
    fn linked_work_item_round_trips() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "Fix PR");
        row.linked_work_item = Some(json!({
            "kind": "pr",
            "repo": "openai/codex",
            "number": 42,
            "url": "https://github.com/openai/codex/pull/42"
        }));

        let summary = upsert_session(&conn, &row).unwrap();
        assert_eq!(summary.linked_work_item, row.linked_work_item);
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].linked_work_item, row.linked_work_item);
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.linked_work_item, row.linked_work_item);
    }

    #[test]
    fn linked_work_item_can_be_set_and_removed_without_rewriting_the_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Fix PR")).unwrap();
        let linked = json!({
            "kind": "pr",
            "repo": "openai/codex",
            "number": 42,
            "url": "https://github.com/openai/codex/pull/42"
        });

        set_linked_work_item(&conn, "s1", Some(&linked)).unwrap();
        assert_eq!(
            get_session(&conn, "s1").unwrap().unwrap().linked_work_item,
            Some(linked)
        );

        set_linked_work_item(&conn, "s1", None).unwrap();
        assert_eq!(
            get_session(&conn, "s1").unwrap().unwrap().linked_work_item,
            None
        );
    }

    #[test]
    fn automation_id_round_trips() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "Nightly review");
        row.automation_id = Some("automation-id".into());

        let summary = upsert_session(&conn, &row).unwrap();
        assert_eq!(summary.automation_id.as_deref(), Some("automation-id"));
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].automation_id.as_deref(), Some("automation-id"));
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.automation_id.as_deref(), Some("automation-id"));
    }

    #[test]
    fn list_linked_finds_threads_across_projects() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let linked = json!({
            "kind": "pr",
            "repo": "openai/codex",
            "number": 42,
            "url": "https://github.com/openai/codex/pull/42"
        });
        let mut first = sample("s1", "/tmp/a", "First");
        first.linked_work_item = Some(linked.clone());
        let mut second = sample("s2", "/tmp/b", "Second");
        second.linked_work_item = Some(linked);
        upsert_session(&conn, &first).unwrap();
        upsert_session(&conn, &second).unwrap();
        upsert_session(&conn, &sample("s3", "/tmp/a", "Unlinked")).unwrap();

        let rows = list_linked(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row.id == "s1"));
        assert!(rows.iter().any(|row| row.id == "s2"));
        assert!(rows.iter().all(|row| row.linked_work_item.is_some()));
    }

    #[test]
    fn list_recent_spans_projects_and_keeps_pinned_and_hides_the_rest() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for (id, cwd, updated) in [
            ("old-pinned", "/tmp/a", 1_000),
            ("oldest", "/tmp/a", 1_500),
            ("a-new", "/tmp/a", 5_000),
            ("b-mid", "/tmp/b", 4_000),
            ("archived", "/tmp/b", 6_000),
            ("worker", "/tmp/b", 6_500),
            ("empty", "/tmp/b", 7_000),
        ] {
            let mut session = sample(id, cwd, id);
            session.updated_at = Some(updated);
            if id == "empty" {
                session.blocks = json!([]);
            }
            upsert_session(&conn, &session).unwrap();
        }
        set_pinned(&conn, "old-pinned", true).unwrap();
        set_archived(&conn, "archived", true).unwrap();
        save_orchestration(
            &conn,
            "a-new",
            &json!({"status":"active","tasks":[{"id":"t","sessionId":"worker"}]}),
        )
        .unwrap();

        let ids = |limit| {
            list_recent(&conn, limit)
                .unwrap()
                .into_iter()
                .map(|row| row.id)
                .collect::<Vec<_>>()
        };
        // Newest first across projects; the pinned one is always present.
        assert_eq!(ids(2), ["a-new", "b-mid", "old-pinned"]);
        assert_eq!(ids(10), ["a-new", "b-mid", "oldest", "old-pinned"]);
        assert!(list_recent(&conn, 10).unwrap().iter().any(|row| row.pinned));
    }

    fn guarded_upsert(
        conn: &Connection,
        session: &SessionUpsert,
        expected: Option<Option<i64>>,
    ) -> Option<SessionSummary> {
        upsert_session_with_git(conn, session, upsert_git_info(session), expected).unwrap()
    }

    #[test]
    fn guarded_upsert_writes_only_when_the_stored_stamp_matches() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut first = sample("s1", "/tmp/a", "First");
        first.updated_at = Some(1_000);
        // "No row" expectation on an empty store writes.
        assert!(guarded_upsert(&conn, &first, Some(None)).is_some());

        let mut next = sample("s1", "/tmp/a", "Second");
        next.blocks = json!([{ "id": "b1", "role": "user", "text": "changed" }]);
        // Stale stamp: refused, row untouched.
        assert!(guarded_upsert(&conn, &next, Some(Some(999))).is_none());
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.title, "First");
        assert_eq!(stored.updated_at, 1_000);

        // Matching stamp writes.
        let written = guarded_upsert(&conn, &next, Some(Some(1_000))).unwrap();
        assert_eq!(written.title, "Second");
        assert_eq!(get_session(&conn, "s1").unwrap().unwrap().title, "Second");
    }

    #[test]
    fn guarded_upsert_expecting_no_row_refuses_when_one_exists() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();

        let replacement = sample("s1", "/tmp/a", "Replacement");
        assert!(guarded_upsert(&conn, &replacement, Some(None)).is_none());
        assert_eq!(get_session(&conn, "s1").unwrap().unwrap().title, "First");
        // A stamp for a row that does not exist is stale too.
        assert!(guarded_upsert(&conn, &sample("s2", "/tmp/a", "X"), Some(Some(5))).is_none());
        assert!(get_session(&conn, "s2").unwrap().is_none());
    }

    #[test]
    fn unguarded_upsert_always_writes() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        assert!(guarded_upsert(&conn, &sample("s1", "/tmp/a", "First"), None).is_some());
        let again = sample("s1", "/tmp/a", "Again");
        assert!(guarded_upsert(&conn, &again, None).is_some());
        assert_eq!(get_session(&conn, "s1").unwrap().unwrap().title, "Again");
    }

    /// The plan's detail lines for `sql` on a migrated, populated store.
    fn query_plan(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Vec<String> {
        let mut statement = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        statement
            .query_map(params, |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn assert_indexed_and_presorted(plan: &[String], index: &str) {
        let text = plan.join("\n");
        assert!(text.contains(index), "plan does not use {index}:\n{text}");
        assert!(
            !text.contains("USE TEMP B-TREE FOR ORDER BY"),
            "plan sorts:\n{text}"
        );
        for line in plan {
            if line.starts_with("SCAN sessions") {
                assert!(line.contains("USING"), "unindexed table scan:\n{text}");
            }
        }
    }

    #[test]
    fn recent_and_linked_lists_read_in_index_order() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut linked = sample("s1", "/tmp/a", "Linked");
        linked.linked_work_item = Some(json!({"kind": "pr", "number": 1}));
        upsert_session(&conn, &linked).unwrap();
        upsert_session(&conn, &sample("s2", "/tmp/b", "Plain")).unwrap();

        let recent = query_plan(&conn, RECENT_ROWS_SQL, &[&0_i64, &50_i64]);
        assert_indexed_and_presorted(&recent, "sessions_recent_idx");
        let pinned = query_plan(&conn, RECENT_ROWS_SQL, &[&1_i64, &-1_i64]);
        assert_indexed_and_presorted(&pinned, "sessions_recent_idx");
        let linked = query_plan(&conn, LIST_LINKED_SQL, &[]);
        assert_indexed_and_presorted(&linked, "sessions_linked_idx");
    }

    #[test]
    fn context_usage_is_absent_until_a_harness_reports() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.context_used, None);
        assert_eq!(stored.context_window, None);
    }

    #[test]
    fn migration_v3_adds_context_columns() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_same_blocks_and_metadata_keeps_updated_at() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let first = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let next = sample("s1", "/tmp/a", "First");
        let second = upsert_session(&conn, &next).unwrap();
        assert_eq!(second.updated_at, first.updated_at);
        let mut renamed = next.clone();
        renamed.model = "gpt-5.4".into();
        let third = upsert_session(&conn, &renamed).unwrap();
        assert!(third.updated_at > first.updated_at);
        assert_eq!(third.model, "gpt-5.4");
    }

    #[test]
    fn list_does_not_sum_write_preview_diffs() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Diffs");
        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "edit it" },
            {
                "id": "b2",
                "role": "tool",
                "text": "",
                "tool": {
                    "preview": {
                        "kind": "write",
                        "path": "src/a.ts",
                        "additions": 12,
                        "deletions": 3
                    }
                }
            }
        ]);
        let summary = upsert_session(&conn, &session).unwrap();
        assert_eq!(summary.additions, 0);
        assert_eq!(summary.deletions, 0);
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].additions, 0);
        assert_eq!(listed[0].deletions, 0);
    }

    #[test]
    fn list_by_project_filters_and_orders() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "A1")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_session(&conn, &sample("s2", "/tmp/a", "A2")).unwrap();
        upsert_session(&conn, &sample("s3", "/tmp/b", "B1")).unwrap();
        let mut empty = sample("s4", "/tmp/a", "Empty");
        empty.blocks = json!([]);
        upsert_session(&conn, &empty).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "s2");
        assert_eq!(listed[1].id, "s1");
    }

    #[test]
    fn delete_removes_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        delete_session(&conn, "s1").unwrap();
        assert!(get_session(&conn, "s1").unwrap().is_none());
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());
    }

    #[test]
    fn generated_image_cleanup_preserves_either_surviving_conflict_session() {
        for (deleted, survivor) in [("original", "local-copy"), ("local-copy", "original")] {
            let store = SessionStore::open_in_memory().unwrap();
            let conn = store.conn.lock().unwrap();
            let directory =
                std::env::temp_dir().join(format!("bycoda-shared-image-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&directory).unwrap();
            let image = directory.join("shared.png");
            std::fs::write(&image, b"synthetic generated image").unwrap();
            let path = image.to_string_lossy().to_string();
            for id in [deleted, survivor] {
                let mut session = sample(id, "/tmp/project", id);
                session.blocks = json!([
                    {"id":"u", "role":"user", "text":"Generate"},
                    {"id":"image", "role":"image", "image":{"path":path}}
                ]);
                upsert_session(&conn, &session).unwrap();
            }
            delete_session(&conn, deleted).unwrap();
            cleanup_unreferenced_generated_images(&conn, std::slice::from_ref(&path), |_| {
                panic!("the surviving session still owns the image")
            })
            .unwrap();
            let reopened = get_session(&conn, survivor).unwrap().unwrap();
            assert_eq!(reopened.blocks[1]["image"]["path"], path);
            assert_eq!(std::fs::read(&image).unwrap(), b"synthetic generated image");
            delete_session(&conn, survivor).unwrap();
            cleanup_unreferenced_generated_images(&conn, &[path.clone(), path], |paths| {
                assert_eq!(paths.len(), 1);
                std::fs::remove_file(&paths[0]).map_err(|error| error.to_string())
            })
            .unwrap();
            assert!(!image.exists());
            std::fs::remove_dir(&directory).unwrap();
        }
    }

    #[test]
    fn generated_image_cleanup_respects_nested_rewind_queue_and_draft_references() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut survivor = sample("survivor", "/tmp/project", "Survivor");
        survivor.blocks = json!([{"id":"u", "role":"user", "text":"Hi", "btwThreads":[{
            "messages":[{"blocks":[{"image":{"path":"/images/side.png"}}]}]
        }]}]);
        survivor.rewind_history =
            Some(json!([{"blocks":[{"image":{"path":"/images/rewind.png"}}]}]));
        upsert_session(&conn, &survivor).unwrap();
        set_session_queue(
            &conn,
            "survivor",
            Some(&json!([{"attachments":[{"path":"/images/queue.png"}]}])),
        )
        .unwrap();
        set_composer_draft(
            &conn,
            "blank",
            Some(&json!({"text":"Draft", "attachments":[{"path":"/images/draft.png"}]})),
        )
        .unwrap();
        let candidates = ["side", "rewind", "queue", "draft", "unused"]
            .map(|name| format!("/images/{name}.png"));
        cleanup_unreferenced_generated_images(&conn, &candidates, |paths| {
            assert_eq!(paths, &["/images/unused.png"]);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn generated_image_cleanup_skips_deletion_when_reference_data_is_unreadable() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        conn.execute("INSERT INTO composer_drafts (session_id,draft_json,updated_at) VALUES ('broken','invalid-json',0)", []).unwrap();
        assert!(cleanup_unreferenced_generated_images(
            &conn,
            &["/images/shared.png".into()],
            |_| { panic!("unreadable references must never allow cleanup") }
        )
        .is_err());
    }

    #[test]
    fn generated_image_cleanup_reserves_writes_until_files_are_checked() {
        let directory = std::env::temp_dir().join(format!(
            "bycoda-image-cleanup-lock-{}",
            uuid::Uuid::new_v4()
        ));
        let database = directory.join("sessions.sqlite");
        let store = SessionStore::open(database.clone()).unwrap();
        let other_window = Connection::open(&database).unwrap();
        other_window
            .busy_timeout(std::time::Duration::ZERO)
            .unwrap();
        {
            let conn = store.conn.lock().unwrap();
            cleanup_unreferenced_generated_images(&conn, &["/images/unused.png".into()], |_| {
                let error = other_window.execute(
                    "INSERT INTO composer_drafts (session_id,draft_json,updated_at) VALUES ('other-window','{}',0)", []
                ).unwrap_err();
                assert_eq!(error.sqlite_error_code(), Some(rusqlite::ErrorCode::DatabaseBusy));
                Ok(())
            }).unwrap();
        }
        other_window.execute(
            "INSERT INTO composer_drafts (session_id,draft_json,updated_at) VALUES ('other-window','{}',0)", []
        ).unwrap();
        drop(other_window);
        drop(store);
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn deleting_a_lead_releases_current_and_earlier_workers() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "earlier", "current", "other-lead", "other-worker"] {
            let mut session = sample(id, "/tmp/a", id);
            session.linked_work_item = Some(json!({"kind": "pr", "number": 1}));
            if ["earlier", "current"].contains(&id) {
                session.blocks = json!([{"id":"u","role":"user","text":"Keep this transcript","orchestrationLeadId":"lead"}]);
            }
            upsert_session(&conn, &session).unwrap();
        }
        save_orchestration(
            &conn,
            "lead",
            &json!({"status":"stopped","tasks":[{"id":"task","sessionId":"current"}]}),
        )
        .unwrap();
        let other =
            json!({"status":"active","tasks":[{"id":"other-task","sessionId":"other-worker"}]});
        save_orchestration(&conn, "other-lead", &other).unwrap();
        delete_session(&conn, "lead").unwrap();

        for id in ["earlier", "current"] {
            let worker = get_session(&conn, id).unwrap().unwrap();
            assert!(worker.orchestration_lead_id.is_none());
            assert!(worker.blocks[0].get("orchestrationLeadId").is_none());
            assert_eq!(worker.blocks[0]["text"], "Keep this transcript");
            assert!(list_by_project(&conn, "/tmp/a")
                .unwrap()
                .iter()
                .any(|row| row.id == id));
            assert!(list_linked(&conn).unwrap().iter().any(|row| row.id == id));
        }
        assert!(orchestration_summary(&conn, "lead").unwrap().is_none());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orchestration_runs WHERE lead_id = 'lead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            worker_parent(&conn, "other-worker").unwrap().as_deref(),
            Some("other-lead")
        );
        let raw: String = conn
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id = 'other-lead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(), other);
        migrate(&conn).unwrap();
        assert!(worker_parent(&conn, "current").unwrap().is_none());
    }

    #[test]
    fn deleting_a_worker_prunes_parent_state_and_does_not_release_dependencies() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "worker", "dependent", "earlier"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        remember_worker(&conn, "earlier", "lead").unwrap();
        save_orchestration(
            &conn,
            "lead",
            &json!({"status":"active", "requests":{"old":{"result":"worker"}}, "tasks":[
                {"id":"task", "sessionId":"worker", "status":"running", "dependsOn":[]},
                {"id":"next", "sessionId":"dependent", "status":"queued", "dependsOn":["task"]}
            ]}),
        )
        .unwrap();
        delete_session(&conn, "worker").unwrap();
        assert!(get_session(&conn, "worker").unwrap().is_none());
        assert!(worker_parent(&conn, "worker").unwrap().is_none());
        assert_eq!(
            worker_parent(&conn, "earlier").unwrap().as_deref(),
            Some("lead")
        );
        let raw: String = conn
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id = 'lead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let run: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(run["status"], "stopped");
        assert_eq!(run["requests"], json!({}));
        assert_eq!(run["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(run["tasks"][0]["sessionId"], "dependent");
        assert_eq!(run["tasks"][0]["status"], "cancelled");
        assert_eq!(run["tasks"][0]["dependsOn"], json!([]));
        let summary = orchestration_summary(&conn, "lead").unwrap().unwrap();
        assert_eq!(summary["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(summary["tasks"][0]["sessionId"], "dependent");
        assert_eq!(summary["tasks"][0]["status"], "cancelled");
    }

    #[test]
    fn failed_session_deletion_rolls_back_orchestration_cleanup() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "worker"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        save_orchestration(
            &conn,
            "lead",
            &json!({"status":"stopped", "tasks":[{"id":"task", "sessionId":"worker"}]}),
        )
        .unwrap();
        conn.execute_batch("CREATE TRIGGER reject_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        for id in ["lead", "worker"] {
            assert!(delete_session(&conn, id).is_err());
            assert!(get_session(&conn, id).unwrap().is_some());
            assert_eq!(
                worker_parent(&conn, "worker").unwrap().as_deref(),
                Some("lead")
            );
            assert_eq!(
                orchestration_summary(&conn, "lead").unwrap().unwrap()["tasks"][0]["sessionId"],
                "worker"
            );
        }
    }

    #[test]
    fn migration_v6_adds_archived_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let archived: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'archived'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(archived, 1);
    }

    #[test]
    fn migration_v7_adds_worktree_cwd_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'worktree_cwd'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(column, 1);
    }

    #[test]
    fn removed_worktree_state_round_trips_and_can_be_reselected() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "First");
        session.worktree_cwd = Some("/tmp/a-worktrees/feature".into());
        session.worktree_removed = true;
        session.branch = Some("stale-branch".into());
        let summary = upsert_session(&conn, &session).unwrap();
        assert!(summary.worktree_removed);
        assert!(summary.branch.is_none());
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(listed[0].worktree_removed);
        assert!(listed[0].branch.is_none());
        let restored = get_session(&conn, "s1").unwrap().unwrap();
        assert!(restored.worktree_removed);
        assert_eq!(restored.blocks, session.blocks);
        session.worktree_removed = false;
        session.worktree_cwd = None;
        session.branch = Some("main".into());
        upsert_session(&conn, &session).unwrap();
        let restored = get_session(&conn, "s1").unwrap().unwrap();
        assert!(!restored.worktree_removed);
        assert_eq!(restored.branch.as_deref(), Some("main"));
    }

    #[test]
    fn archive_round_trips_and_survives_upsert() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        set_archived(&conn, "s1", true).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(listed[0].archived);
        let mut next = sample("s1", "/tmp/a", "Updated");
        next.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "world" }
        ]);
        let summary = upsert_session(&conn, &next).unwrap();
        assert!(summary.archived);
        assert_eq!(summary.title, "Updated");
        set_archived(&conn, "s1", false).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(!listed[0].archived);
    }

    #[test]
    fn migration_v11_adds_pinned_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 11",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let pinned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'pinned'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pinned, 1);
    }

    #[test]
    fn pin_round_trips_and_survives_upsert() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        set_pinned(&conn, "s1", true).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(listed[0].pinned);
        let mut next = sample("s1", "/tmp/a", "Updated");
        next.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "world" }
        ]);
        let summary = upsert_session(&conn, &next).unwrap();
        assert!(summary.pinned);
        assert_eq!(summary.title, "Updated");
        set_pinned(&conn, "s1", false).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(!listed[0].pinned);
    }

    #[test]
    fn get_round_trips_blocks_provider_session_and_account() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "First");
        session.provider_account_id = Some("account-work".into());
        upsert_session(&conn, &session).unwrap();
        let record = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(record.id, "s1");
        assert_eq!(record.provider_session_id.as_deref(), Some("acp-session-1"));
        assert_eq!(record.provider_account_id.as_deref(), Some("account-work"));
        assert_eq!(record.model_settings["thinking"], "high");
        assert_eq!(record.blocks.as_array().unwrap().len(), 1);
        assert_eq!(record.blocks[0]["text"], "hello");
    }

    #[test]
    fn upsert_snapshots_git_branch() {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-session-git-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let init = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output();
        let Ok(init) = init else {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        };
        if !init.status.success() {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let head = std::process::Command::new("git")
            .args(["symbolic-ref", "HEAD", "refs/heads/fix-sidebar"])
            .current_dir(&dir)
            .status();
        if head.map(|status| !status.success()).unwrap_or(true) {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let origin = std::process::Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/acme/widget.git",
            ])
            .current_dir(&dir)
            .status();
        if origin.map(|status| !status.success()).unwrap_or(true) {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }

        let cwd = dir.to_string_lossy().into_owned();
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let summary = upsert_session(&conn, &sample("s1", &cwd, "First")).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(summary.branch.as_deref(), Some("fix-sidebar"));
        assert_eq!(summary.repo.as_deref(), Some("widget"));
    }

    #[test]
    fn upsert_keeps_session_branch_and_worktree() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "First");
        session.branch = Some("feat/picker".into());
        session.worktree_cwd = Some("/tmp/a-feat".into());
        let summary = upsert_session(&conn, &session).unwrap();
        assert_eq!(summary.branch.as_deref(), Some("feat/picker"));
        assert_eq!(summary.worktree_cwd.as_deref(), Some("/tmp/a-feat"));
        let record = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(record.branch.as_deref(), Some("feat/picker"));
        assert_eq!(record.worktree_cwd.as_deref(), Some("/tmp/a-feat"));
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].branch.as_deref(), Some("feat/picker"));
        assert_eq!(listed[0].worktree_cwd.as_deref(), Some("/tmp/a-feat"));
    }

    #[test]
    fn rebase_project_moves_saved_sessions_to_the_renamed_path() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("moved", "/tmp/old", "Moved")).unwrap();
        upsert_session(&conn, &sample("other", "/tmp/other", "Other")).unwrap();

        rebase_project(&conn, "/tmp/old", "/tmp/new").unwrap();

        assert!(list_by_project(&conn, "/tmp/old").unwrap().is_empty());
        assert_eq!(list_by_project(&conn, "/tmp/new").unwrap()[0].id, "moved");
        assert_eq!(list_by_project(&conn, "/tmp/other").unwrap()[0].id, "other");
    }

    #[test]
    fn migration_v4_creates_in_flight_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'in_flight_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
    }

    #[test]
    fn session_queue_round_trips_replaces_and_clears() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        assert_eq!(get_session_queue(&conn, "s1").unwrap(), None);

        let first = json!([{ "id": "q1", "text": "one", "attachments": [] }]);
        set_session_queue(&conn, "s1", Some(&first)).unwrap();
        assert_eq!(get_session_queue(&conn, "s1").unwrap(), Some(first));

        let second = json!([
            { "id": "q2", "text": "two", "attachments": [] },
            { "id": "q1", "text": "one", "attachments": [] }
        ]);
        set_session_queue(&conn, "s1", Some(&second)).unwrap();
        assert_eq!(get_session_queue(&conn, "s1").unwrap(), Some(second));
        assert_eq!(get_session_queue(&conn, "s2").unwrap(), None);

        set_session_queue(&conn, "s1", None).unwrap();
        assert_eq!(get_session_queue(&conn, "s1").unwrap(), None);
    }

    #[test]
    fn session_queue_rejects_non_arrays_and_survives_transcript_saves() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        assert!(set_session_queue(&conn, "s1", Some(&json!({"id": "q1"}))).is_err());

        upsert_session(&conn, &sample("s1", "/tmp/a", "Chat")).unwrap();
        let queue = json!([{ "id": "q1", "text": "later", "attachments": [] }]);
        set_session_queue(&conn, "s1", Some(&queue)).unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Chat renamed")).unwrap();
        assert_eq!(get_session_queue(&conn, "s1").unwrap(), Some(queue));
    }

    #[test]
    fn deleting_a_session_drops_its_queue() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Chat")).unwrap();
        set_session_queue(&conn, "s1", Some(&json!([{ "id": "q1" }]))).unwrap();
        delete_session(&conn, "s1").unwrap();
        assert_eq!(get_session_queue(&conn, "s1").unwrap(), None);
    }

    #[test]
    fn attachment_reference_inventory_is_read_only_and_preserves_expired_drafts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        set_composer_draft(
            &conn,
            "draft",
            Some(&json!({"attachments":[{"id":"draft-file"}]})),
        )
        .unwrap();
        conn.execute("UPDATE composer_drafts SET updated_at=1", [])
            .unwrap();
        set_session_queue(
            &conn,
            "queue",
            Some(&json!([{"attachments":[{"id":"queue-file"}]}])),
        )
        .unwrap();
        assert_eq!(
            read_attachment_references(&conn, "draft", &["queue".into(), "missing".into()], false)
                .unwrap(),
            json!({"draftIds":["draft-file"],"queues":{"queue":["queue-file"],"missing":[]}})
        );
        let left: i64 = conn
            .query_row("SELECT count(*) FROM composer_drafts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 1);
    }

    #[test]
    fn attachment_reference_inventory_rejects_corruption_instead_of_claiming_absence() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        set_session_queue(&conn, "queue", Some(&json!([]))).unwrap();
        conn.execute("UPDATE session_queues SET queue_json='not json'", [])
            .unwrap();
        assert!(read_attachment_references(&conn, "draft", &["queue".into()], false).is_err());
        conn.execute("UPDATE session_queues SET queue_json='[{}]'", [])
            .unwrap();
        assert!(read_attachment_references(&conn, "draft", &["queue".into()], false).is_err());
        set_session_queue(&conn, "queue", Some(&json!([]))).unwrap();
        for draft in [json!({"attachments":null}), json!({"attachments":[{}]})] {
            set_composer_draft(&conn, "draft", Some(&draft)).unwrap();
            assert!(read_attachment_references(&conn, "draft", &["queue".into()], false).is_err());
        }
        conn.execute("UPDATE composer_drafts SET draft_json='not json'", [])
            .unwrap();
        assert!(read_attachment_references(&conn, "draft", &[], false).is_err());
        assert!(read_attachment_references(&conn, "../draft", &[], false).is_err());
        assert!(
            read_attachment_references(&conn, "draft", &vec!["queue".into(); 101], false).is_err()
        );
    }

    #[test]
    fn attachment_reference_inventory_can_protect_exports_to_other_local_drafts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        set_composer_draft(
            &conn,
            "other-draft",
            Some(&json!({"attachments":[{"id":"shared"}]})),
        )
        .unwrap();
        set_session_queue(
            &conn,
            "other-queue",
            Some(&json!([{"attachments":[{"id":"queued"}]}])),
        )
        .unwrap();
        assert_eq!(
            read_attachment_references(&conn, "current", &[], false).unwrap(),
            json!({"draftIds":[],"queues":{}})
        );
        assert_eq!(
            read_attachment_references(&conn, "current", &[], true).unwrap(),
            json!({"draftIds":["shared"],"queues":{"other-queue":["queued"]}})
        );
        conn.execute("UPDATE composer_drafts SET draft_json='broken'", [])
            .unwrap();
        assert!(read_attachment_references(&conn, "current", &[], true).is_err());
    }

    #[test]
    fn composer_draft_round_trips_replaces_and_clears() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        assert!(list_composer_drafts(&conn).unwrap().is_empty());

        // No transcript row is needed: a blank new chat has a draft too.
        let first = json!({ "text": "half a thought", "attachments": [] });
        set_composer_draft(&conn, "blank-1", Some(&first)).unwrap();
        set_composer_draft(&conn, "s2", Some(&json!({ "text": "other" }))).unwrap();
        let second = json!({ "text": "half a thought, longer", "attachments": [] });
        set_composer_draft(&conn, "blank-1", Some(&second)).unwrap();

        let listed = list_composer_drafts(&conn).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&json!({ "sessionId": "blank-1", "draft": second })));

        set_composer_draft(&conn, "blank-1", None).unwrap();
        let listed = list_composer_drafts(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["sessionId"], "s2");
    }

    #[test]
    fn composer_draft_rejects_non_objects_and_survives_transcript_saves() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        assert!(set_composer_draft(&conn, "s1", Some(&json!("text"))).is_err());

        upsert_session(&conn, &sample("s1", "/tmp/a", "Chat")).unwrap();
        let draft = json!({ "text": "later" });
        set_composer_draft(&conn, "s1", Some(&draft)).unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Chat renamed")).unwrap();
        assert_eq!(
            list_composer_drafts(&conn).unwrap(),
            vec![json!({ "sessionId": "s1", "draft": draft })]
        );
    }

    #[test]
    fn composer_draft_listing_drops_expired_and_unparseable_rows() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        set_composer_draft(&conn, "fresh", Some(&json!({ "text": "keep" }))).unwrap();
        set_composer_draft(&conn, "old", Some(&json!({ "text": "stale" }))).unwrap();
        conn.execute(
            "UPDATE composer_drafts SET updated_at = ?1 WHERE session_id = 'old'",
            [now_millis() - COMPOSER_DRAFT_MAX_AGE_MS - 1],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO composer_drafts (session_id, draft_json, updated_at)
             VALUES ('broken', 'not json', ?1)",
            [now_millis()],
        )
        .unwrap();

        let listed = list_composer_drafts(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["sessionId"], "fresh");
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM composer_drafts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 2, "only the expired row is deleted");
    }

    #[test]
    fn in_flight_set_take_is_ordered_and_destructive() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.conn.lock().unwrap();
        replace_in_flight(
            &mut conn,
            &[
                InFlightSession {
                    session_id: "s2".into(),
                    cwd: "/tmp/b".into(),
                },
                InFlightSession {
                    session_id: "s1".into(),
                    cwd: "/tmp/a".into(),
                },
            ],
        )
        .unwrap();
        let first = take_in_flight(&mut conn).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].session_id, "s2");
        assert_eq!(first[0].cwd, "/tmp/b");
        assert_eq!(first[1].session_id, "s1");
        let second = take_in_flight(&mut conn).unwrap();
        assert!(second.is_empty());
    }

    #[test]
    fn in_flight_list_does_not_clear() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.conn.lock().unwrap();
        replace_in_flight(
            &mut conn,
            &[InFlightSession {
                session_id: "s1".into(),
                cwd: "/tmp/a".into(),
            }],
        )
        .unwrap();
        let listed = list_in_flight(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].session_id, "s1");
        let listed_again = list_in_flight(&conn).unwrap();
        assert_eq!(listed_again.len(), 1);
    }

    #[test]
    fn in_flight_replace_clears_previous() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.conn.lock().unwrap();
        replace_in_flight(
            &mut conn,
            &[InFlightSession {
                session_id: "old".into(),
                cwd: "/tmp/old".into(),
            }],
        )
        .unwrap();
        replace_in_flight(&mut conn, &[]).unwrap();
        assert!(take_in_flight(&mut conn).unwrap().is_empty());
    }

    #[test]
    fn migration_v5_creates_workspace_snapshot_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspace_snapshot'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
    }

    #[test]
    fn workspace_snapshot_round_trips_and_replaces() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        set_workspace_snapshot(&conn, r#"{"tabs":[{"id":"t1"}]}"#).unwrap();
        let first = get_workspace_snapshot(&conn).unwrap().unwrap();
        assert!(first.contains("t1"));
        set_workspace_snapshot(&conn, r#"{"tabs":[{"id":"t2"}]}"#).unwrap();
        let second = get_workspace_snapshot(&conn).unwrap().unwrap();
        assert!(second.contains("t2"));
        assert!(!second.contains("t1"));
    }

    #[test]
    fn migrate_creates_workspace_tables_when_versions_already_recorded() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-stale-migrations-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   cwd TEXT NOT NULL,
                   harness TEXT NOT NULL,
                   model TEXT NOT NULL,
                   model_settings TEXT NOT NULL DEFAULT '{}',
                   runtime_mode TEXT NOT NULL,
                   title TEXT NOT NULL,
                   provider_session_id TEXT,
                   blocks_json TEXT NOT NULL DEFAULT '[]',
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                   VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1);",
            )
            .unwrap();
        }
        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.conn.lock().unwrap();
        let inflight: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'in_flight_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let snapshot: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspace_snapshot'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
        assert_eq!(inflight, 1);
        assert_eq!(snapshot, 1);
    }

    #[test]
    fn migrate_restores_the_covering_index_when_versions_already_recorded() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-stale-index-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            // A database that claims every version but carries none of the
            // columns or indexes those versions describe.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   cwd TEXT NOT NULL,
                   harness TEXT NOT NULL,
                   model TEXT NOT NULL,
                   model_settings TEXT NOT NULL DEFAULT '{}',
                   runtime_mode TEXT NOT NULL,
                   title TEXT NOT NULL,
                   provider_session_id TEXT,
                   blocks_json TEXT NOT NULL DEFAULT '[]',
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                   VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1), (7, 1),
                          (8, 1), (9, 1), (10, 1), (11, 1), (12, 1), (13, 1),
                          (14, 1), (15, 1), (16, 1), (17, 1), (18, 1);",
            )
            .unwrap();
        }
        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.conn.lock().unwrap();
        let index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
                   AND name = 'sessions_cwd_cover_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(index, 1);
        upsert_session(&conn, &sample("s1", "/tmp/a", "Restored index")).unwrap();
        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Restored".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .expect("unscoped search must not fail when the index was restored");
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));
        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn session_search_uses_a_query_only_read_connection() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-session-read-conn-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = SessionStore::open(path.clone()).unwrap();
        upsert_session(
            &store.conn.lock().unwrap(),
            &sample("s1", "/tmp/a", "Searchable title"),
        )
        .unwrap();

        let read_conn = store.read_conn.lock().unwrap();
        let conn = read_conn.as_ref().unwrap();
        let result = search_sessions_with_connection(
            conn,
            &SessionSearchOptions {
                query: "Searchable".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
            None,
        )
        .unwrap();

        assert!(result.hits.iter().any(|hit| hit.session_id == "s1"));
        assert!(conn
            .execute("UPDATE sessions SET title = 'nope' WHERE id = 's1'", [])
            .is_err());
        drop(read_conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn list_and_get_read_their_own_writes_on_the_read_connection() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-session-list-conn-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = SessionStore::open(path.clone()).unwrap();
        assert!(store.list_conn.lock().unwrap().is_some());
        upsert_session(
            &store.conn.lock().unwrap(),
            &sample("s1", "/tmp/a", "First"),
        )
        .unwrap();

        let listed = store
            .with_read_conn(|conn| list_by_project(conn, "/tmp/a").map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(listed.len(), 1);
        let record = store
            .with_read_conn(|conn| get_session(conn, "s1").map_err(|e| e.to_string()))
            .unwrap()
            .unwrap();
        assert_eq!(record.title, "First");

        // A later commit is visible to the next read, and the connection is read-only.
        upsert_session(
            &store.conn.lock().unwrap(),
            &sample("s2", "/tmp/a", "Second"),
        )
        .unwrap();
        let listed = store
            .with_read_conn(|conn| list_by_project(conn, "/tmp/a").map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(listed.len(), 2);
        assert!(store
            .with_read_conn(|conn| conn
                .execute("UPDATE sessions SET title = 'nope'", [])
                .map_err(|e| e.to_string()))
            .is_err());
        let synchronous: i64 = store
            .conn
            .lock()
            .unwrap()
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .unwrap();
        assert_eq!(synchronous, 1, "NORMAL");
        let wal_limit: i64 = store
            .conn
            .lock()
            .unwrap()
            .query_row("PRAGMA journal_size_limit", [], |row| row.get(0))
            .unwrap();
        assert_eq!(wal_limit, 64 * 1024 * 1024);

        drop(store);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn in_memory_store_reads_through_the_write_connection() {
        let store = SessionStore::open_in_memory().unwrap();
        assert!(store.list_conn.lock().unwrap().is_none());
        upsert_session(&store.conn.lock().unwrap(), &sample("s1", "/tmp/a", "Mem")).unwrap();
        let listed = store
            .with_read_conn(|conn| list_by_project(conn, "/tmp/a").map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert!(store
            .with_read_conn(|conn| get_session(conn, "s1").map_err(|e| e.to_string()))
            .unwrap()
            .is_some());
    }

    #[test]
    fn oversized_transcript_keeps_title_hit_without_hiding_older_messages() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut small = sample("small", "/tmp/a", "Needle title");
        small.blocks = json!([{ "id": "small", "role": "user", "text": "needle" }]);
        upsert_session(&conn, &small).unwrap();
        let mut huge = sample("huge", "/tmp/a", "Needle title");
        huge.blocks = json!([{
            "id": "huge",
            "role": "user",
            "text": "needle ".repeat(1_500_000),
        }]);
        upsert_session(&conn, &huge).unwrap();
        conn.execute("UPDATE sessions SET updated_at = 1 WHERE id = 'small'", [])
            .unwrap();
        conn.execute("UPDATE sessions SET updated_at = 2 WHERE id = 'huge'", [])
            .unwrap();

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();

        assert!(result.truncated);
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "huge" && hit.kind == "conversation"));
        assert!(!result
            .hits
            .iter()
            .any(|hit| hit.session_id == "huge" && hit.kind == "message"));
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "small" && hit.kind == "message"));
    }

    #[test]
    fn session_search_without_a_cwd_avoids_the_sessions_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let sql = format!("EXPLAIN QUERY PLAN {}", search_sessions_sql(false, false));
        let mut statement = conn.prepare(&sql).unwrap();
        let plan: Vec<String> = statement
            .query_map(
                params!["%needle%", MAX_SEARCH_BUFFER_BYTES as i64, 401i64],
                |row| row.get::<_, String>(3),
            )
            .unwrap()
            .map(|row| row.unwrap())
            .collect();
        assert!(
            plan.iter()
                .any(|step| step.contains("USING COVERING INDEX sessions_cwd_cover_idx")),
            "metadata must stay in the covering index: {plan:?}"
        );
        for step in &plan {
            if step.contains("sessions") {
                assert!(
                    step.contains("USING INDEX") || step.contains("USING COVERING INDEX"),
                    "table access: {step}"
                );
            }
        }
    }

    #[test]
    fn a_new_session_search_supersedes_the_same_owner() {
        let owner = "session-search-owner-test";
        let first = begin_session_search(owner).unwrap();
        assert!(first.is_current());
        let second = begin_session_search(owner).unwrap();
        assert!(!first.is_current());
        assert!(second.is_current());
        cancel_owned_session_search(owner);
        assert!(!second.is_current());
    }

    #[test]
    fn a_completed_session_search_releases_its_token() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Needle title")).unwrap();
        drop(conn);
        let owner = "completed-session-search-owner";

        let result = search_store(
            &store,
            &SessionSearchOptions {
                query: "Needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: owner.into(),
            },
        )
        .unwrap();

        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));
        assert!(!session_search_token_registered(owner));
    }

    #[test]
    fn a_superseded_session_search_does_not_release_the_newer_token() {
        let owner = "superseded-release-owner";
        let first = begin_session_search(owner).unwrap();
        let second = begin_session_search(owner).unwrap();

        end_session_search(Some(&first));

        assert!(session_search_token_registered(owner));
        assert!(!first.is_current());
        assert!(second.is_current());
        cancel_owned_session_search(owner);
    }

    #[test]
    fn cancelling_one_session_search_does_not_cancel_another() {
        let first = begin_session_search("first-session-owner").unwrap();
        let second = begin_session_search("second-session-owner").unwrap();

        cancel_owned_session_search("first-session-owner");

        assert!(!first.is_current());
        assert!(second.is_current());
    }

    #[test]
    fn a_superseded_session_search_returns_no_hits() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Searchable title")).unwrap();
        let owner = "superseded-session-search-test";
        let stale = begin_session_search(owner).unwrap();
        begin_session_search(owner);
        let options = SessionSearchOptions {
            query: "Searchable".into(),
            cwd: None,
            include_archived: false,
            search_owner: owner.into(),
        };

        let result = search_sessions_with_connection(&conn, &options, Some(&stale)).unwrap();

        assert!(result.hits.is_empty());
        assert!(!result.truncated);
        // The progress handler belongs to the search, not the shared connection.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        cancel_owned_session_search(owner);
    }

    #[test]
    fn a_failed_session_search_releases_its_token() {
        let store = SessionStore::open_in_memory().unwrap();
        // Point the read connection at a database with no schema, so the search
        // fails inside SQLite. That error return is the path that used to skip
        // the release, and `SearchView` swallows the rejection.
        *store.read_conn.lock().unwrap() = Some(Connection::open_in_memory().unwrap());
        let owner = "failed-session-search-owner";

        let error = search_store(
            &store,
            &SessionSearchOptions {
                query: "Needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: owner.into(),
            },
        );

        assert!(error.is_err(), "a search with no schema must fail");
        assert!(!session_search_token_registered(owner));
    }

    #[test]
    fn a_test_helper_session_search_releases_its_token() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Needle title")).unwrap();
        let owner = "helper-session-search-owner";

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: owner.into(),
            },
        )
        .unwrap();

        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));
        assert!(!session_search_token_registered(owner));
    }

    #[test]
    fn search_uses_top_level_user_blocks_for_the_materialized_filter() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Unrelated title");
        session.blocks = json!([
            { "id": "t1", "role": "tool", "text": "wrapper", "tool": {
                "preview": { "output": "nested role: user needle" }
            } }
        ]);
        upsert_session(&conn, &session).unwrap();

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();

        assert!(result.hits.is_empty());
    }

    #[test]
    fn search_finds_title_and_message_hits() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Fix sidebar search");
        session.blocks = json!([
            { "id": "u1", "role": "user", "text": "Please search the sidebar filter chips" },
            { "id": "a1", "role": "assistant", "text": "I will look through the explorer next." }
        ]);
        upsert_session(&conn, &session).unwrap();
        upsert_session(&conn, &sample("s2", "/tmp/b", "Unrelated title")).unwrap();

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "sidebar".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        let kinds: Vec<_> = result
            .hits
            .iter()
            .map(|hit| {
                (
                    hit.kind.as_str(),
                    hit.session_id.as_str(),
                    hit.block_id.as_deref(),
                )
            })
            .collect();
        assert!(kinds.contains(&("conversation", "s1", None)));
        assert!(kinds.contains(&("message", "s1", Some("u1"))));
        assert!(!result.hits.iter().any(|hit| hit.session_id == "s2"));
    }

    #[test]
    fn search_skips_inbox_ask_sessions_when_scoped_and_unscoped() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("ask", "/tmp/a", "Needle ask")).unwrap();
        upsert_session(&conn, &sample("chat", "/tmp/a", "Needle chat")).unwrap();
        conn.execute("UPDATE sessions SET inbox_ask = '{}' WHERE id = 'ask'", [])
            .unwrap();

        for cwd in [None, Some("/tmp/a".to_string())] {
            let result = search_sessions(
                &conn,
                &SessionSearchOptions {
                    query: "Needle".into(),
                    cwd,
                    include_archived: false,
                    search_owner: String::new(),
                },
            )
            .unwrap();
            assert!(result.hits.iter().all(|hit| hit.session_id == "chat"));
        }
    }

    #[test]
    fn search_respects_cwd_and_skips_archived() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Search project a")).unwrap();
        upsert_session(&conn, &sample("s2", "/tmp/b", "Search project b")).unwrap();
        set_archived(&conn, "s1", true).unwrap();

        let scoped = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Search project".into(),
                cwd: Some("/tmp/a".into()),
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(scoped.hits.is_empty());

        let with_archived = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Search project".into(),
                cwd: Some("/tmp/a".into()),
                include_archived: true,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(with_archived
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));

        let other = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Search project".into(),
                cwd: Some("/tmp/b".into()),
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(other.hits.iter().any(|hit| hit.session_id == "s2"));
    }

    #[test]
    fn search_empty_query_is_empty() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Anything")).unwrap();
        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "   ".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(result.hits.is_empty());
        assert!(!result.truncated);
    }
}
