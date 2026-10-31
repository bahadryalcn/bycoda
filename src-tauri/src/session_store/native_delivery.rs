//! Private original-request data on the actual Native Store. A journal row is
//! neither a source/write grant nor permission to replay an uncertain effect.
//! Prepared/possible transitions cross a FULL barrier before network admission.

use super::{authority, SessionStore};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) mod epochs;

pub(crate) const MAX_PARAMS_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_RESULT_BYTES: usize = 32 * 1024 * 1024;
const MAX_ACTIVE_BYTES: usize = 128 * 1024 * 1024;
const MAX_ACTIVE_ROWS: usize = 256;
const MAX_ROWS: usize = 65_536;
const MAX_PAGE: usize = 32;
const MAX_KEY_BYTES: usize = 2048;
const MAX_SAFE: i64 = 9_007_199_254_740_991;

const TABLE: &str = "native_delivery_originals";
const SELECT: &str = "SELECT
 CASE WHEN length(CAST(original_id AS BLOB)) BETWEEN 36 AND 80 THEN original_id END,
 CASE WHEN length(CAST(semantic_key AS BLOB)) BETWEEN 1 AND 2048 THEN semantic_key END,
 CASE WHEN length(CAST(route_fingerprint AS BLOB))=64 THEN route_fingerprint END,
 CASE WHEN length(CAST(method AS BLOB)) BETWEEN 1 AND 128 THEN method END,
 CASE WHEN length(CAST(source_store_id AS BLOB)) BETWEEN 1 AND 2048 THEN source_store_id END,
 CASE WHEN length(CAST(source_profile_id AS BLOB)) BETWEEN 1 AND 2048 THEN source_profile_id END,
 CASE WHEN length(CAST(payload_sha256 AS BLOB))=64 THEN payload_sha256 END,
 payload_bytes,
 CASE WHEN length(CAST(created_instance AS BLOB))=36 THEN created_instance END,
 CASE WHEN length(CAST(phase AS BLOB)) BETWEEN 1 AND 16 THEN phase END,
 revision,
 CASE WHEN result_sha256 IS NULL OR length(CAST(result_sha256 AS BLOB))=64 THEN result_sha256 END,
 result_bytes,created_at,length(CAST(params_json AS BLOB)),length(CAST(result_json AS BLOB)),rowid FROM native_delivery_originals";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Prepared,
    Possible,
    Recorded,
    Acknowledged,
}

impl Phase {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "prepared" => Ok(Self::Prepared),
            "possible" => Ok(Self::Possible),
            "recorded" => Ok(Self::Recorded),
            "acknowledged" => Ok(Self::Acknowledged),
            _ => Err(invalid()),
        }
    }
}

/// Cheap metadata. Full original/result bytes are loaded only by explicit
/// bounded reads. The runtime pin prevents using one Store's handle on another.
#[derive(Clone, Debug)]
pub(crate) struct Original {
    id: String,
    semantic_key: String,
    route_fingerprint: String,
    method: String,
    source_store_id: String,
    source_profile_id: String,
    payload_sha256: String,
    payload_bytes: usize,
    created_instance: String,
    phase: Phase,
    revision: i64,
    result_sha256: Option<String>,
    result_bytes: Option<usize>,
    created_at: i64,
    runtime: uuid::Uuid,
    connection: usize,
    rowid: i64,
}

impl Original {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
    pub(crate) fn semantic_key(&self) -> &str {
        &self.semantic_key
    }
    pub(crate) fn route_fingerprint(&self) -> &str {
        &self.route_fingerprint
    }
    pub(crate) fn method(&self) -> &str {
        &self.method
    }
    pub(crate) fn payload_sha256(&self) -> &str {
        &self.payload_sha256
    }
    pub(crate) fn payload_bytes(&self) -> usize {
        self.payload_bytes
    }
    pub(crate) fn phase(&self) -> Phase {
        self.phase
    }
    /// Opaque ACK-outbox continuation metadata. It conveys no operation grant;
    /// ordinary pending originals continue to use their UUID cursor instead.
    pub(crate) fn ack_cursor(&self) -> String {
        format!("ack-rowid:{}", self.rowid)
    }
    /// Digest of the exact locally recorded result, retained after consumption.
    /// It is metadata only, never authority to consume or resend an original.
    pub(crate) fn consumed_result(&self) -> Result<(String, usize), String> {
        if self.phase != Phase::Acknowledged {
            return Err(
                "NATIVE_DELIVERY_NOT_CONSUMED: local ACK is required before remote retirement"
                    .into(),
            );
        }
        match (&self.result_sha256, self.result_bytes) {
            (Some(hash), Some(bytes)) if hex(hash) && bytes > 0 => Ok((hash.clone(), bytes)),
            _ => Err(invalid()),
        }
    }
    /// Necessary journal state only, never a source/owner grant. The actual
    /// consumer must still hold its original native authority before dispatch.
    pub(crate) fn can_dispatch(&self) -> bool {
        self.phase == Phase::Prepared && self.created_instance == self.runtime.to_string()
    }
}

pub(crate) struct PendingPage {
    pub(crate) originals: Vec<Original>,
    pub(crate) next: Option<String>,
}

/// Acquire this before reply/SQL gates when completing inside another managed
/// FULL transaction. It retains process-owned accounting through actual commit.
pub(crate) struct CompletionAdmission {
    admission: crate::native_window_lifecycle::NativeWriteAdmission,
}
impl CompletionAdmission {
    pub(crate) fn finish<T>(self, result: Result<T, String>) -> Result<T, String> {
        self.admission.finish(result)
    }
}
pub(crate) fn completion_admission(store: &SessionStore) -> Result<CompletionAdmission, String> {
    Ok(CompletionAdmission {
        admission: store.process_write_admission().map_err(|e| e.to_string())?,
    })
}

fn invalid() -> String {
    "NATIVE_DELIVERY_INVALID: original request metadata or retained bytes failed verification"
        .into()
}
fn stale() -> String {
    "NATIVE_DELIVERY_STALE: original request changed or belongs to another managed Store".into()
}
fn capacity() -> String {
    "NATIVE_DELIVERY_CAPACITY: retained originals are full; no new request was dispatched".into()
}
fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn key(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_KEY_BYTES && !value.contains('\0')
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|v| {
        v.get_version_num() == 4
            && v.get_variant() == uuid::Variant::RFC4122
            && v.to_string() == value
    })
}
fn original_id(value: &str) -> bool {
    uuid(value) || epochs::parse_id(value).is_some()
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn result_budget(method: &str) -> Result<usize, String> {
    match method {
        "native.buffers.update" | "native.services.conversation.desktop.finish" => Ok(64 * 1024),
        "native.services.workspace.format" => Ok(MAX_RESULT_BYTES),
        _ => Err("NATIVE_DELIVERY_METHOD: unsupported original request method".into()),
    }
}
fn validate_json(value: &str, maximum: usize, object: bool) -> Result<(), String> {
    if value.is_empty() || value.len() > maximum {
        return Err(invalid());
    }
    let parsed: serde_json::Value = serde_json::from_str(value).map_err(|_| invalid())?;
    if object && !parsed.is_object() {
        return Err(invalid());
    }
    Ok(())
}

fn schema(conn: &Connection) -> Result<(), String> {
    epochs::check_structure(conn)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS native_delivery_originals (
      original_id TEXT PRIMARY KEY, semantic_key TEXT NOT NULL,
      route_fingerprint TEXT NOT NULL, method TEXT NOT NULL,
      source_store_id TEXT NOT NULL, source_profile_id TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL, payload_bytes INTEGER NOT NULL,
      params_json TEXT, created_instance TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('prepared','possible','recorded','acknowledged')),
      revision INTEGER NOT NULL, result_json TEXT, result_sha256 TEXT,
      result_bytes INTEGER, result_budget INTEGER NOT NULL CHECK(result_budget>0 AND result_budget<=33554432), created_at INTEGER NOT NULL,
      UNIQUE(source_store_id,source_profile_id,semantic_key),
      CHECK(payload_bytes>0 AND payload_bytes<=16777216),
      CHECK(revision>=0 AND revision<=9007199254740991),
      CHECK((phase='acknowledged' AND params_json IS NULL AND result_json IS NULL) OR
            (phase!='acknowledged' AND params_json IS NOT NULL)),
      CHECK(phase!='recorded' OR (result_json IS NOT NULL AND result_sha256 IS NOT NULL AND result_bytes IS NOT NULL)),
      CHECK(phase NOT IN ('recorded','acknowledged') OR (result_sha256 IS NOT NULL AND result_bytes IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS native_delivery_route_pending ON native_delivery_originals(route_fingerprint,original_id);
    CREATE TRIGGER IF NOT EXISTS native_delivery_identity_no_replace BEFORE INSERT ON native_delivery_originals
      WHEN EXISTS(SELECT 1 FROM native_delivery_originals o WHERE o.original_id=NEW.original_id OR
        (o.source_store_id=NEW.source_store_id AND o.source_profile_id=NEW.source_profile_id AND o.semantic_key=NEW.semantic_key))
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_identity_immutable
      BEFORE UPDATE OF original_id,semantic_key,route_fingerprint,method,source_store_id,source_profile_id,payload_sha256,payload_bytes,created_instance,created_at,result_budget
      ON native_delivery_originals BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_no_delete BEFORE DELETE ON native_delivery_originals
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_phase_guard BEFORE UPDATE OF phase,revision ON native_delivery_originals
      WHEN NEW.revision!=OLD.revision+1 OR NOT(
        (OLD.phase='prepared' AND NEW.phase='possible') OR
        (OLD.phase='possible' AND NEW.phase IN ('prepared','recorded')) OR
        (OLD.phase='recorded' AND NEW.phase='acknowledged'))
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_INVALID_TRANSITION'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_params_immutable BEFORE UPDATE OF params_json ON native_delivery_originals
      WHEN NOT(OLD.params_json IS NEW.params_json OR (NEW.phase='acknowledged' AND NEW.params_json IS NULL))
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_result_immutable BEFORE UPDATE OF result_json,result_sha256,result_bytes ON native_delivery_originals
      WHEN OLD.result_sha256 IS NOT NULL AND NOT(
        NEW.result_sha256 IS OLD.result_sha256 AND NEW.result_bytes IS OLD.result_bytes AND
        (NEW.result_json IS OLD.result_json OR (NEW.phase='acknowledged' AND NEW.result_json IS NULL)))
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;")
      .map_err(|e| e.to_string())
}

fn exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [TABLE],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn identity(conn: &Connection) -> Result<(String, String), String> {
    let ids: (String,String) = conn.query_row("SELECT CASE WHEN length(CAST(source_store_id AS BLOB)) BETWEEN 1 AND 2048 THEN source_store_id END,CASE WHEN length(CAST(source_profile_id AS BLOB)) BETWEEN 1 AND 2048 THEN source_profile_id END FROM native_authority_identity WHERE id=1", [], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|_| invalid())?;
    if !key(&ids.0) || !key(&ids.1) {
        return Err(invalid());
    }
    Ok(ids)
}
fn pin(store: &SessionStore) -> Result<usize, String> {
    let conn = store.lock_conn()?;
    Ok((&**conn as *const Connection) as usize)
}
fn checked_record(
    row: &rusqlite::Row<'_>,
    runtime: uuid::Uuid,
    connection: usize,
) -> Result<Original, rusqlite::Error> {
    let to_size = |value: i64| usize::try_from(value).map_err(|_| rusqlite::Error::InvalidQuery);
    let phase: String = row.get(9)?;
    let phase = Phase::parse(&phase).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let record = Original {
        id: row.get(0)?,
        semantic_key: row.get(1)?,
        route_fingerprint: row.get(2)?,
        method: row.get(3)?,
        source_store_id: row.get(4)?,
        source_profile_id: row.get(5)?,
        payload_sha256: row.get(6)?,
        payload_bytes: to_size(row.get(7)?)?,
        created_instance: row.get(8)?,
        phase,
        revision: row.get(10)?,
        result_sha256: row.get(11)?,
        result_bytes: row.get::<_, Option<i64>>(12)?.map(to_size).transpose()?,
        created_at: row.get(13)?,
        runtime,
        connection,
        rowid: row.get(16)?,
    };
    let params_length: Option<i64> = row.get(14)?;
    let result_length: Option<i64> = row.get(15)?;
    let budget = result_budget(&record.method).map_err(|_| rusqlite::Error::InvalidQuery)?;
    if record.rowid <= 0
        || !original_id(&record.id)
        || !uuid(&record.created_instance)
        || !key(&record.semantic_key)
        || !key(&record.source_store_id)
        || !key(&record.source_profile_id)
        || !hex(&record.route_fingerprint)
        || !hex(&record.payload_sha256)
        || record.payload_bytes == 0
        || record.payload_bytes > MAX_PARAMS_BYTES
        || record.revision < 0
        || record.revision > MAX_SAFE
        || record.created_at < 0
        || record.created_at > MAX_SAFE
        || (phase != Phase::Acknowledged && params_length != Some(record.payload_bytes as i64))
        || (phase == Phase::Acknowledged && (params_length.is_some() || result_length.is_some()))
        || record.result_bytes.is_some_and(|n| n == 0 || n > budget)
        || record.result_sha256.as_ref().is_some_and(|h| !hex(h))
        || (phase == Phase::Recorded
            && (record.result_sha256.is_none()
                || record.result_bytes.map(|n| n as i64) != result_length))
        || (phase == Phase::Acknowledged
            && (record.result_sha256.is_none() || record.result_bytes.is_none()))
        || (matches!(phase, Phase::Prepared | Phase::Possible)
            && (record.result_sha256.is_some()
                || record.result_bytes.is_some()
                || result_length.is_some()))
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(record)
}
fn read(
    conn: &Connection,
    id: &str,
    runtime: uuid::Uuid,
    connection: usize,
) -> Result<Option<Original>, String> {
    let record = conn
        .query_row(&format!("{SELECT} WHERE original_id=?1"), [id], |r| {
            checked_record(r, runtime, connection)
        })
        .optional()
        .map_err(|_| invalid())?;
    if let Some(record) = &record {
        epochs::validate_original(conn, record)?;
    }
    Ok(record)
}
fn same(a: &Original, b: &Original) -> bool {
    a.id == b.id
        && a.semantic_key == b.semantic_key
        && a.route_fingerprint == b.route_fingerprint
        && a.method == b.method
        && a.source_store_id == b.source_store_id
        && a.source_profile_id == b.source_profile_id
        && a.payload_sha256 == b.payload_sha256
        && a.payload_bytes == b.payload_bytes
        && a.created_instance == b.created_instance
}
fn current(conn: &Connection, expected: &Original) -> Result<Original, String> {
    if ((conn as *const Connection) as usize) != expected.connection {
        return Err(stale());
    }
    let ids = identity(conn)?;
    if ids.0 != expected.source_store_id || ids.1 != expected.source_profile_id {
        return Err(stale());
    }
    let record =
        read(conn, &expected.id, expected.runtime, expected.connection)?.ok_or_else(stale)?;
    if !same(expected, &record) {
        return Err(stale());
    }
    Ok(record)
}
fn write<T>(
    store: &SessionStore,
    consume: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let admission = completion_admission(store)?;
    let result = authority::with_full_projection_transaction(store, |tx| consume(tx.connection()));
    admission.finish(result)
}
fn check_runtime(store: &SessionStore, original: &Original) -> Result<(), String> {
    if store.native_instance_id() != original.runtime {
        return Err(stale());
    }
    Ok(())
}

pub(crate) fn prepare(
    store: &SessionStore,
    semantic_key: &str,
    route_fingerprint: &str,
    method: &str,
    params_json: &str,
) -> Result<Original, String> {
    prepare_inputs(semantic_key, route_fingerprint, method, params_json)?;
    write(store, |conn| {
        schema(conn)?;
        prepare_tx(
            conn,
            store,
            semantic_key,
            route_fingerprint,
            method,
            params_json,
            |conn| {
                epochs::legacy_allocation_allowed(conn, route_fingerprint)?;
                Ok(uuid::Uuid::new_v4().to_string())
            },
        )
    })
}

fn prepare_inputs(semantic_key: &str, route: &str, method: &str, raw: &str) -> Result<(), String> {
    if !key(semantic_key) || !hex(route) || raw.is_empty() || raw.len() > MAX_PARAMS_BYTES {
        return Err(invalid());
    }
    result_budget(method)?;
    Ok(())
}

fn prepare_tx(
    conn: &Connection,
    store: &SessionStore,
    semantic_key: &str,
    route_fingerprint: &str,
    method: &str,
    params_json: &str,
    allocate: impl FnOnce(&Connection) -> Result<String, String>,
) -> Result<Original, String> {
    require_full(conn)?;
    let budget = result_budget(method)?;
    let hash = digest(params_json);
    let ids = identity(conn)?;
    epochs::check_semantic(
        conn,
        &ids,
        semantic_key,
        route_fingerprint,
        method,
        &hash,
        params_json.len(),
    )?;
    // Retirement is checked before JSON parsing or allocation of a new identity.
    validate_json(params_json, MAX_PARAMS_BYTES, true)?;
    let connection = (conn as *const Connection) as usize;
    let old: Option<String> = conn.query_row("SELECT CASE WHEN length(CAST(original_id AS BLOB)) BETWEEN 36 AND 80 THEN original_id END FROM native_delivery_originals WHERE source_store_id=?1 AND source_profile_id=?2 AND semantic_key=?3", params![ids.0,ids.1,semantic_key], |r| r.get(0)).optional().map_err(|_|invalid())?;
    if let Some(id) = old {
        let record =
            read(conn, &id, store.native_instance_id(), connection)?.ok_or_else(invalid)?;
        if record.route_fingerprint != route_fingerprint
            || record.method != method
            || record.payload_sha256 != hash
            || record.payload_bytes != params_json.len()
        {
            return Err("NATIVE_DELIVERY_CONFLICT: this original key belongs to a different route, method or exact request bytes".into());
        }
        if record.phase != Phase::Acknowledged && load_bytes(conn, &record, false)? != params_json {
            return Err(invalid());
        }
        return Ok(record);
    }
    let counts = |conn: &Connection| -> Result<(i64, i64, i64), String> {
        conn.query_row("SELECT COUNT(*),COALESCE(SUM(phase!='acknowledged'),0),COALESCE(SUM(CASE WHEN phase!='acknowledged' THEN payload_bytes+result_budget ELSE 0 END),0) FROM native_delivery_originals",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|e.to_string())
    };
    let full = |(rows, active, bytes): (i64, i64, i64)| {
        rows < 0
            || active < 0
            || bytes < 0
            || rows as usize >= MAX_ROWS
            || active as usize >= MAX_ACTIVE_ROWS
            || (bytes as usize)
                .checked_add(params_json.len())
                .and_then(|n| n.checked_add(budget))
                .is_none_or(|n| n > MAX_ACTIVE_BYTES)
    };
    let mut usage = counts(conn)?;
    if full(usage) && method == BUFFER_UPDATE {
        // A buffer report is a complete idempotent snapshot and the new one
        // supersedes every earlier recorded outcome (the Host already holds
        // each result). Retire those locally rather than wedging the queue;
        // the same route first, then any route.
        for route in [Some(route_fingerprint), None] {
            retire_recorded_buffers_tx(conn, store, route, false);
            usage = counts(conn)?;
            if !full(usage) {
                break;
            }
        }
    }
    if full(usage) {
        return Err(capacity());
    }
    let id = allocate(conn)?;
    conn.execute("INSERT INTO native_delivery_originals(original_id,semantic_key,route_fingerprint,method,source_store_id,source_profile_id,payload_sha256,payload_bytes,params_json,created_instance,phase,revision,result_budget,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'prepared',0,?11,?12)",params![id,semantic_key,route_fingerprint,method,ids.0,ids.1,hash,params_json.len() as i64,params_json,store.native_instance_id().to_string(),budget as i64,super::now_millis()]).map_err(|e|e.to_string())?;
    read(conn, &id, store.native_instance_id(), connection)?.ok_or_else(invalid)
}

const BUFFER_UPDATE: &str = "native.buffers.update";

/// Best-effort local retirement of recorded `native.buffers.update` originals
/// (recorded to acknowledged, which releases their active reservation). Only
/// the superseded snapshot journal entry is retired, never a newer report's
/// freshness. Caller holds the FULL projection transaction. Returns the count.
fn retire_recorded_buffers_tx(
    conn: &Connection,
    store: &SessionStore,
    route: Option<&str>,
    previous_runs_only: bool,
) -> usize {
    let connection = (conn as *const Connection) as usize;
    let runtime = store.native_instance_id();
    let ids: Vec<String> = (|| -> rusqlite::Result<Vec<String>> {
        let mut statement = conn.prepare(
            "SELECT original_id FROM native_delivery_originals WHERE phase='recorded' AND method=?1
             AND (?2 IS NULL OR route_fingerprint=?2) AND (?3=0 OR created_instance!=?4) ORDER BY rowid LIMIT 512",
        )?;
        let rows = statement.query_map(
            params![BUFFER_UPDATE, route, previous_runs_only as i64, runtime.to_string()],
            |r| r.get::<_, String>(0),
        )?;
        rows.collect()
    })()
    .unwrap_or_default();
    let mut retired = 0;
    for id in ids {
        if let Ok(Some(record)) = read(conn, &id, runtime, connection) {
            if acknowledge_tx(conn, &record).is_ok() {
                retired += 1;
            }
        }
    }
    retired
}

/// Startup/first-report cleanup: recorded buffer snapshots left by previous
/// runs (or dead windows) can never be confirmed again and only consume the
/// active-row budget. Best effort; a failure never blocks reporting.
pub(crate) fn retire_stale_buffer_originals(store: &SessionStore) -> Result<usize, String> {
    {
        let conn = store.lock_conn()?;
        if !exists(&conn)? {
            return Ok(0);
        }
        let stale: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_delivery_originals WHERE phase='recorded' AND method=?1 AND created_instance!=?2",
                params![BUFFER_UPDATE, store.native_instance_id().to_string()],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if stale == 0 {
            return Ok(0);
        }
    }
    write(store, |conn| {
        Ok(retire_recorded_buffers_tx(conn, store, None, true))
    })
}

fn change_phase(
    store: &SessionStore,
    original: &Original,
    possible: bool,
) -> Result<Original, String> {
    check_runtime(store, original)?;
    write(store, |conn| {
        let record = current(conn, original)?;
        let expected = if possible {
            Phase::Prepared
        } else {
            Phase::Possible
        };
        if record.phase != expected
            || record.revision != original.revision
            || record.created_instance != store.native_instance_id().to_string()
        {
            return Err("NATIVE_DELIVERY_STATUS_ONLY: this original cannot acquire another dispatch from journal data".into());
        }
        // Verify full immutable bytes before a caller can cross the dispatch boundary.
        let _ = load_bytes(conn, &record, false)?;
        let next = if possible { "possible" } else { "prepared" };
        let changed = conn.execute("UPDATE native_delivery_originals SET phase=?1,revision=revision+1 WHERE original_id=?2 AND revision=?3 AND revision<9007199254740991",params![next,record.id,record.revision]).map_err(|e|e.to_string())?;
        if changed != 1 {
            return Err(stale());
        }
        read(
            conn,
            &record.id,
            store.native_instance_id(),
            record.connection,
        )?
        .ok_or_else(invalid)
    })
}

pub(crate) fn mark_possible(store: &SessionStore, original: &Original) -> Result<Original, String> {
    change_phase(store, original, true)
}
/// Only a trusted transport's authoritative never-dispatched failure may call
/// this. A missing/expired/absent remote receipt is NOT that evidence.
pub(crate) fn definitely_unsent(
    store: &SessionStore,
    original: &Original,
) -> Result<Original, String> {
    change_phase(store, original, false)
}

fn load_bytes(conn: &Connection, original: &Original, result: bool) -> Result<String, String> {
    let (column, maximum, hash, length) = if result {
        (
            "result_json",
            result_budget(&original.method)?,
            original.result_sha256.as_deref().ok_or_else(invalid)?,
            original.result_bytes.ok_or_else(invalid)?,
        )
    } else {
        (
            "params_json",
            MAX_PARAMS_BYTES,
            original.payload_sha256.as_str(),
            original.payload_bytes,
        )
    };
    let query = format!("SELECT CASE WHEN length(CAST({column} AS BLOB)) BETWEEN 1 AND ?2 THEN {column} ELSE NULL END FROM native_delivery_originals WHERE original_id=?1");
    let value: Option<String> = conn
        .query_row(&query, params![original.id, maximum as i64], |r| r.get(0))
        .map_err(|_| invalid())?;
    let value = value.ok_or_else(invalid)?;
    if value.len() != length || digest(&value) != hash {
        return Err(invalid());
    }
    validate_json(&value, maximum, !result)?;
    Ok(value)
}

pub(crate) fn params_json(store: &SessionStore, original: &Original) -> Result<String, String> {
    check_runtime(store, original)?;
    let conn = store.lock_conn()?;
    let record = current(&conn, original)?;
    load_bytes(&conn, &record, false)
}
#[cfg(test)]
pub(crate) fn result_json(
    store: &SessionStore,
    original: &Original,
) -> Result<Option<String>, String> {
    check_runtime(store, original)?;
    let conn = store.lock_conn()?;
    let record = current(&conn, original)?;
    if record.phase == Phase::Acknowledged {
        return Ok(None);
    }
    if record.phase != Phase::Recorded {
        return Ok(None);
    }
    load_bytes(&conn, &record, true).map(Some)
}

#[cfg(test)]
pub(crate) fn record_result(
    store: &SessionStore,
    original: &Original,
    result_json: &str,
) -> Result<Original, String> {
    check_runtime(store, original)?;
    validate_json(result_json, result_budget(original.method())?, false)?;
    write(store, |conn| record_result_tx(conn, original, result_json))
}

pub(crate) fn record_result_tx(
    conn: &Connection,
    original: &Original,
    result_json: &str,
) -> Result<Original, String> {
    require_full(conn)?;
    validate_json(result_json, result_budget(original.method())?, false)?;
    let hash = digest(result_json);
    let record = current(conn, original)?;
    if record.phase != Phase::Acknowledged {
        let _ = load_bytes(conn, &record, false)?;
    }
    if matches!(record.phase, Phase::Recorded | Phase::Acknowledged) {
        if record.result_sha256.as_deref() != Some(hash.as_str())
            || record.result_bytes != Some(result_json.len())
        {
            return Err(
                "NATIVE_DELIVERY_RESULT_CONFLICT: authoritative outcomes differ for one original"
                    .into(),
            );
        }
        if record.phase == Phase::Recorded && load_bytes(conn, &record, true)? != result_json {
            return Err(invalid());
        }
        return Ok(record);
    }
    if record.phase != Phase::Possible {
        return Err("NATIVE_DELIVERY_STATUS_ONLY: no possible dispatch was retained".into());
    }
    let changed=conn.execute("UPDATE native_delivery_originals SET phase='recorded',revision=revision+1,result_json=?1,result_sha256=?2,result_bytes=?3 WHERE original_id=?4 AND revision=?5 AND revision<9007199254740991",params![result_json,hash,result_json.len() as i64,record.id,record.revision]).map_err(|e|e.to_string())?;
    if changed != 1 {
        return Err(stale());
    }
    read(conn, &record.id, original.runtime, record.connection)?.ok_or_else(invalid)
}

fn require_full(conn: &Connection) -> Result<(), String> {
    if conn.is_autocommit()
        || conn
            .pragma_query_value::<i64, _>(None, "synchronous", |r| r.get(0))
            .map_err(|e| e.to_string())?
            != 2
    {
        return Err("NATIVE_DELIVERY_FULL_TRANSACTION_REQUIRED".into());
    }
    Ok(())
}

/// Must be called only in the actual managed Store's already admitted FULL
/// transaction, after the caller's exact source ACK/CAS succeeds. It never opens
/// a transaction, acquires a barrier after SQL or changes source freshness.
pub(crate) fn acknowledge_tx(conn: &Connection, original: &Original) -> Result<(), String> {
    require_full(conn)?;
    let record = current(conn, original)?;
    if record.phase == Phase::Acknowledged {
        return Ok(());
    }
    if record.phase != Phase::Recorded {
        return Err("NATIVE_DELIVERY_UNCONFIRMED: original outcome is not durably recorded".into());
    }
    let _ = load_bytes(conn, &record, false)?;
    let _ = load_bytes(conn, &record, true)?;
    let changed=conn.execute("UPDATE native_delivery_originals SET phase='acknowledged',revision=revision+1,params_json=NULL,result_json=NULL WHERE original_id=?1 AND revision=?2 AND revision<9007199254740991",params![record.id,record.revision]).map_err(|e|e.to_string())?;
    if changed != 1 {
        return Err(stale());
    }
    Ok(())
}
#[cfg(test)]
pub(crate) fn acknowledge(store: &SessionStore, original: &Original) -> Result<(), String> {
    check_runtime(store, original)?;
    write(store, |conn| acknowledge_tx(conn, original))
}

const REMOTE_ACKS: &str = "native_delivery_remote_acks";

fn remote_ack_schema(conn: &Connection) -> Result<(), String> {
    // A sidecar upgrades existing journals without rewriting immutable originals.
    // It is created only inside an admitted FULL mutation, never by a read.
    conn.execute_batch("CREATE TABLE IF NOT EXISTS native_delivery_remote_acks (
        original_id TEXT PRIMARY KEY REFERENCES native_delivery_originals(original_id),
        result_sha256 TEXT NOT NULL CHECK(length(result_sha256)=64),
        result_bytes INTEGER NOT NULL CHECK(result_bytes BETWEEN 1 AND 33554432)
      );
      CREATE TRIGGER IF NOT EXISTS native_delivery_remote_ack_valid BEFORE INSERT
        ON native_delivery_remote_acks WHEN NOT EXISTS(
          SELECT 1 FROM native_delivery_originals o WHERE o.original_id=NEW.original_id
            AND o.phase='acknowledged' AND o.result_sha256=NEW.result_sha256 AND o.result_bytes=NEW.result_bytes)
        BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_NOT_CONSUMED'); END;
      CREATE TRIGGER IF NOT EXISTS native_delivery_remote_ack_immutable BEFORE UPDATE ON native_delivery_remote_acks
        BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS native_delivery_remote_ack_no_replace BEFORE INSERT ON native_delivery_remote_acks
        WHEN EXISTS(SELECT 1 FROM native_delivery_remote_acks r WHERE r.original_id=NEW.original_id)
        BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS native_delivery_remote_ack_retained BEFORE DELETE ON native_delivery_remote_acks
        BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;")
        .map_err(|error| error.to_string())
}

fn remote_ack_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [REMOTE_ACKS],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn remote_acked(conn: &Connection, original: &Original) -> Result<bool, String> {
    if !remote_ack_table_exists(conn)? {
        return Ok(false);
    }
    let receipt: Option<(String, i64)> = conn
        .query_row(
            "SELECT CASE WHEN length(CAST(result_sha256 AS BLOB))=64 THEN result_sha256 END,result_bytes
             FROM native_delivery_remote_acks WHERE original_id=?1",
            [&original.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| invalid())?;
    match receipt {
        None => Ok(false),
        Some((hash, bytes)) => {
            let expected = original.consumed_result()?;
            if hash != expected.0 || usize::try_from(bytes).ok() != Some(expected.1) {
                return Err(invalid());
            }
            Ok(true)
        }
    }
}

/// Reload an exact original after its local ACK committed. A pre-ACK metadata
/// handle cannot itself authorize retirement; the actual current row must agree.
pub(crate) fn remote_ack_candidate(
    store: &SessionStore,
    original: &Original,
) -> Result<Option<Original>, String> {
    check_runtime(store, original)?;
    let conn = store.lock_conn()?;
    let record = current(&conn, original)?;
    record.consumed_result()?;
    if remote_acked(&conn, &record)? {
        Ok(None)
    } else {
        Ok(Some(record))
    }
}

/// Actual guarded remote retirement completion. Caller admits before taking
/// response/saved-route/SQL gates and passes the real Store's FULL connection.
pub(crate) fn mark_remote_acked_tx(conn: &Connection, original: &Original) -> Result<(), String> {
    require_full(conn)?;
    let record = current(conn, original)?;
    let consumed = record.consumed_result()?;
    if original.phase != Phase::Acknowledged || original.consumed_result()? != consumed {
        return Err(stale());
    }
    if remote_acked(conn, &record)? {
        return Ok(());
    }
    remote_ack_schema(conn)?;
    conn.execute(
        "INSERT INTO native_delivery_remote_acks(original_id,result_sha256,result_bytes) VALUES(?1,?2,?3)",
        params![record.id, consumed.0, consumed.1 as i64],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Bounded metadata-only outbox. Missing sidecar means an older valid journal;
/// these reads do not create/migrate tables, load old result bytes or revive work.
/// At most limit rows are decoded, plus one rowid of lookahead. Damaged original
/// metadata is held unchanged and omitted; the opaque rowid cursor still advances
/// past it, including pages with no healthy originals. UUIDs are never cursors here.
pub(crate) fn pending_remote_acks(
    store: &SessionStore,
    route_fingerprint: &str,
    after_cursor: Option<&str>,
    limit: usize,
) -> Result<PendingPage, String> {
    if !hex(route_fingerprint) || limit == 0 || limit > MAX_PAGE {
        return Err(invalid());
    }
    let after = match after_cursor {
        None => 0,
        Some(cursor) => {
            if cursor.len() > 29 {
                return Err(invalid());
            }
            let rowid = cursor
                .strip_prefix("ack-rowid:")
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|rowid| *rowid > 0)
                .ok_or_else(invalid)?;
            if cursor != format!("ack-rowid:{rowid}") {
                return Err(invalid());
            }
            rowid
        }
    };
    let connection = pin(store)?;
    let conn = store.lock_conn()?;
    if !exists(&conn)? {
        return Ok(PendingPage {
            originals: Vec::new(),
            next: None,
        });
    }
    let ids = identity(&conn)?;
    let filter = if remote_ack_table_exists(&conn)? {
        "AND NOT EXISTS(SELECT 1 FROM native_delivery_remote_acks a
          WHERE a.original_id=native_delivery_originals.original_id
            AND a.result_sha256=native_delivery_originals.result_sha256
            AND a.result_bytes=native_delivery_originals.result_bytes)"
    } else {
        ""
    };
    let mut rowids = conn
        .prepare(&format!(
            "SELECT rowid FROM native_delivery_originals WHERE source_store_id=?1 AND source_profile_id=?2
        AND route_fingerprint=?3 AND phase='acknowledged' AND rowid>?4 {filter}
        ORDER BY rowid LIMIT ?5"
        ))
        .map_err(|error| error.to_string())?
        .query_map(
            params![
                ids.0,
                ids.1,
                route_fingerprint,
                after,
                (limit + 1) as i64
            ],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let next = if rowids.len() > limit {
        rowids.truncate(limit);
        rowids.last().map(|rowid| format!("ack-rowid:{rowid}"))
    } else {
        None
    };
    let mut metadata = conn
        .prepare(&format!("{SELECT} WHERE rowid=?1"))
        .map_err(|error| error.to_string())?;
    let mut originals = Vec::with_capacity(rowids.len());
    for rowid in rowids {
        // Keep storage/SQL execution errors distinct from malformed metadata.
        // The actual Store writer remains held throughout both reads.
        let record = metadata
            .query_row([rowid], |row| {
                Ok(checked_record(row, store.native_instance_id(), connection))
            })
            .map_err(|error| error.to_string())?;
        if let Ok(record) = record {
            if epochs::validate_original(&conn, &record).is_err() {
                continue;
            }
            originals.push(record);
        }
    }
    Ok(PendingPage { originals, next })
}

pub(crate) fn pending(
    store: &SessionStore,
    route_fingerprint: &str,
    after_id: Option<&str>,
    limit: usize,
) -> Result<PendingPage, String> {
    if !hex(route_fingerprint)
        || limit == 0
        || limit > MAX_PAGE
        || after_id.is_some_and(|id| !original_id(id))
    {
        return Err(invalid());
    }
    let connection = pin(store)?;
    store.with_read_conn(|conn| {
        if !exists(conn)? { return Ok(PendingPage{originals:vec![],next:None}); }
        let ids=identity(conn)?;
        let mut statement=conn.prepare(&format!("{SELECT} WHERE source_store_id=?1 AND source_profile_id=?2 AND route_fingerprint=?3 AND phase!='acknowledged' AND original_id>?4 ORDER BY original_id LIMIT ?5")).map_err(|e|e.to_string())?;
        let mut records=statement.query_map(params![ids.0,ids.1,route_fingerprint,after_id.unwrap_or(""),(limit+1) as i64],|r|checked_record(r,store.native_instance_id(),connection)).map_err(|_|invalid())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|_|invalid())?;
        for record in &records { epochs::validate_original(conn, record)?; }
        let next=if records.len()>limit { records.truncate(limit); records.last().map(|r|r.id.clone()) } else { None };
        Ok(PendingPage{originals:records,next})
    })
}

#[cfg(test)]
#[path = "native_delivery_tests.rs"]
mod tests;
