//! Durable native-side authority transfer. No transfer method is an IPC command.
//! The coordinator must supply qualified native inventory and authenticated Host
//! decisions; opening a database never migrates a session or changes its owner.
#![allow(dead_code)] // Transfer APIs stay unexposed until coordinator/cohort qualification.

use super::window_barrier::{BarrierError, NativeOperation, WindowBarrier};
use super::*;
use rusqlite::{Transaction, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::HashSet;

pub(crate) const WRITER_PROTOCOL: u64 = 2;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
const MAX_SNAPSHOT: usize = 32 * 1024 * 1024;
const FENCED: &str = "phase IN ('FENCED','HOST','CACHE','RECOVERY_BLOCKED')";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreIdentity {
    pub source_store_id: String,
    pub source_profile_id: String,
}

/// Permanent native-only cancellation; never a Host decision or migration ACK.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuiesceCancellation {
    pub receipt_id: String,
    pub environment_id: String,
    pub session_id: String,
    pub migration_id: String,
    pub identity: StoreIdentity,
    pub source_generation: u64,
    pub authority_generation: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeFence {
    pub protocol: u64,
    pub migration_id: String,
    pub environment_id: String,
    pub session_id: String,
    pub source_store_id: String,
    pub source_profile_id: String,
    pub generation: u64,
    pub source_revision: u64,
    pub source_digest: String,
    pub snapshot_encoding: String,
    pub min_writer_protocol: u64,
    pub quiescent: bool,
    pub unknown_reservations: bool,
    pub writer_inventory_verified: bool,
    pub unsupported_writers: bool,
    pub evidence_digest: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceSnapshot {
    pub fence: NativeFence,
    /// Hash and transport these exact UTF-8 bytes, never JSON.parse/stringify them.
    pub snapshot_json: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorityState {
    pub environment_id: String,
    pub session_id: String,
    pub generation: u64,
    pub min_writer_protocol: u64,
    pub phase: String,
    pub migration_id: String,
    pub source_digest: Option<String>,
    pub host_receipt_id: Option<String>,
}

/// Observations originate in a trusted native launcher/window barrier. They have
/// no Deserialize implementation and cannot be supplied as renderer booleans.
pub(crate) enum WriterInventory {
    Unknown,
    Complete {
        identity: StoreIdentity,
        protocols: Vec<u64>,
        observation_digest: String,
        buffers_digest: String,
    },
}

pub(crate) struct IdleProof {
    identity: StoreIdentity,
    environment_id: String,
    session_id: String,
    migration_id: String,
    generation: u64,
    inventory_digest: String,
    buffers_digest: String,
}

pub(crate) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    // Replacing persisted guards is atomic with the versioned permit shape:
    // another connection must never observe a dropped fence trigger.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    ensure_schema_in_transaction(&tx)?;
    tx.commit()
}

fn ensure_schema_in_transaction(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS native_authority_identity (
      id INTEGER PRIMARY KEY CHECK(id=1), source_store_id TEXT NOT NULL, source_profile_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_authority_floor (
        environment_id TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
        generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991),
        phase TEXT NOT NULL CHECK(phase IN ('NATIVE','QUIESCING','FENCED','HOST','CACHE','RECOVERY_BLOCKED')),
        migration_id TEXT NOT NULL, min_writer_protocol INTEGER NOT NULL,
        source_digest TEXT, host_receipt_id TEXT,
        PRIMARY KEY(environment_id,session_id));
      CREATE TABLE IF NOT EXISTS native_authority_journal (
        migration_id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, session_id TEXT NOT NULL,
        source_store_id TEXT NOT NULL, source_profile_id TEXT NOT NULL,
        phase TEXT NOT NULL, generation INTEGER NOT NULL, source_revision INTEGER,
        source_digest TEXT, snapshot_json TEXT, fence_json TEXT, host_decision_json TEXT,
        inventory_digest TEXT, buffers_digest TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS native_authority_cancellations (
        migration_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_authority_permits (
        nonce TEXT PRIMARY KEY, environment_id TEXT NOT NULL, session_id TEXT NOT NULL,
        generation INTEGER NOT NULL, writer_protocol INTEGER NOT NULL DEFAULT 0,
        purpose TEXT NOT NULL CHECK(purpose IN ('projection','native')));
      CREATE TABLE IF NOT EXISTS native_authority_reservations (
        reservation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, generation INTEGER NOT NULL,
        kind TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('RESERVED','FORKING','RUNNING','UNKNOWN')),
        owner_pid INTEGER NOT NULL, child_pid INTEGER, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS native_authority_reservation_session
        ON native_authority_reservations(session_id);
      CREATE TABLE IF NOT EXISTS native_renderer_checkpoint_receipts (
        nonce TEXT PRIMARY KEY, payload_digest TEXT NOT NULL, receipt_json TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS native_renderer_checkpoint_no_replace
        BEFORE INSERT ON native_renderer_checkpoint_receipts
        WHEN EXISTS(SELECT 1 FROM native_renderer_checkpoint_receipts WHERE nonce=NEW.nonce)
        BEGIN SELECT RAISE(ABORT,'NATIVE_CHECKPOINT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS native_renderer_checkpoint_no_update
        BEFORE UPDATE ON native_renderer_checkpoint_receipts BEGIN
        SELECT RAISE(ABORT,'NATIVE_CHECKPOINT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS native_renderer_checkpoint_no_delete
        BEFORE DELETE ON native_renderer_checkpoint_receipts BEGIN
        SELECT RAISE(ABORT,'NATIVE_CHECKPOINT_IMMUTABLE'); END;
      CREATE TABLE IF NOT EXISTS native_authority_unknown_ingress (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL);")?;
    conn.execute("INSERT OR IGNORE INTO native_authority_identity(id,source_store_id,source_profile_id) VALUES(1,?1,?2)",
        params![uuid::Uuid::new_v4().to_string(), uuid::Uuid::new_v4().to_string()])?;
    for column in ["inventory_digest", "buffers_digest"] {
        let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('native_authority_journal') WHERE name=?1)",[column],|row|row.get(0))?;
        if !exists {
            conn.execute_batch(&format!(
                "ALTER TABLE native_authority_journal ADD COLUMN {column} TEXT"
            ))?;
        }
    }
    let versioned_permits:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('native_authority_permits') WHERE name='writer_protocol')",[],|row|row.get(0))?;
    if !versioned_permits {
        conn.execute_batch("ALTER TABLE native_authority_permits ADD COLUMN writer_protocol INTEGER NOT NULL DEFAULT 0")?;
    }
    // Pure SQL intentionally works in pre-bridge binaries too. A missing custom
    // SQL function would also break writes to unrelated, unfenced legacy IDs.
    for (table, column) in [
        ("sessions", "id"),
        ("session_blocks", "session_id"),
        ("session_block_state", "session_id"),
        ("orchestration_runs", "lead_id"),
        ("orchestration_sidebar", "lead_id"),
        ("orchestration_workers", "session_id"),
        ("orchestration_workers", "lead_id"),
        ("session_rewind_operations", "session_id"),
        ("native_managed_turns", "session_id"),
        ("native_rewind_requests", "session_id"),
        ("native_rewind_intents", "session_id"),
    ] {
        for (event, references) in [
            ("INSERT", format!("NEW.{column}")),
            ("DELETE", format!("OLD.{column}")),
            ("UPDATE", format!("OLD.{column},NEW.{column}")),
        ] {
            conn.execute_batch(&format!("DROP TRIGGER IF EXISTS authority_{table}_{column}_{event};
              CREATE TRIGGER authority_{table}_{column}_{event}
              BEFORE {event} ON {table}
              WHEN EXISTS(SELECT 1 FROM native_authority_floor f
                WHERE f.session_id IN ({references}) AND (f.{FENCED} OR (f.phase IN ('NATIVE','QUIESCING')
                  AND (f.generation>0 OR f.min_writer_protocol>2 OR f.min_writer_protocol<2)))
                AND NOT EXISTS(SELECT 1 FROM native_authority_permits p
                  WHERE p.environment_id=f.environment_id AND p.session_id=f.session_id
                    AND p.generation=f.generation AND p.writer_protocol>=f.min_writer_protocol
                    AND ((p.purpose='projection' AND f.phase IN ('HOST','CACHE'))
                      OR (p.purpose='native' AND f.phase IN ('NATIVE','QUIESCING')))))
              BEGIN SELECT RAISE(ABORT,'NATIVE_AUTHORITY_FENCED: use the owning Host'); END;"))?;
        }
    }
    // Drafts, client-owned unsent queues, workspace layout and search indexes
    // remain local client state. A projection permit never drains or edits them.
    Ok(())
}

fn identity(conn: &Connection) -> Result<StoreIdentity, String> {
    conn.query_row(
        "SELECT source_store_id,source_profile_id FROM native_authority_identity WHERE id=1",
        [],
        |row| {
            Ok(StoreIdentity {
                source_store_id: row.get(0)?,
                source_profile_id: row.get(1)?,
            })
        },
    )
    .map_err(|error| error.to_string())
}

fn read_state(conn: &Connection, session_id: &str) -> Result<Option<AuthorityState>, String> {
    conn.query_row("SELECT environment_id,session_id,generation,phase,migration_id,source_digest,host_receipt_id,min_writer_protocol
      FROM native_authority_floor WHERE session_id=?1", [session_id], |row| Ok(AuthorityState {
        environment_id:row.get(0)?, session_id:row.get(1)?, generation:u64::try_from(row.get::<_,i64>(2)?).map_err(|_|rusqlite::Error::InvalidQuery)?, phase:row.get(3)?,
        migration_id:row.get(4)?, source_digest:row.get(5)?, host_receipt_id:row.get(6)?,
        min_writer_protocol:u64::try_from(row.get::<_,i64>(7)?).map_err(|_|rusqlite::Error::InvalidQuery)?,
    })).optional().map_err(|error| error.to_string())
}

fn identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 200
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || b"._:@/-".contains(&value))
    {
        Err("NATIVE_AUTHORITY_INVALID_ID".into())
    } else {
        Ok(())
    }
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Deterministic source encoding, not JCS: explicit Unicode scalar key order,
/// no string normalization, exact retained UTF-8 bytes are the interoperability boundary.
fn encode(value: &Value) -> Result<String, String> {
    fn ordered(value: &Value) -> Result<Value, String> {
        Ok(match value {
            Value::Object(object) => {
                let mut names: Vec<_> = object.keys().collect();
                names.sort();
                let mut output = serde_json::Map::new();
                for name in names {
                    output.insert(name.clone(), ordered(&object[name])?);
                }
                Value::Object(output)
            }
            Value::Array(values) => {
                Value::Array(values.iter().map(ordered).collect::<Result<_, _>>()?)
            }
            Value::Number(number) => {
                if number.as_u64().is_some_and(|value| value > MAX_SAFE)
                    || number
                        .as_i64()
                        .is_some_and(|value| value.unsigned_abs() > MAX_SAFE)
                    || number.as_f64().is_none_or(|value| {
                        !value.is_finite()
                            || (value.fract() == 0.0 && value.abs() > MAX_SAFE as f64)
                    })
                {
                    return Err("NATIVE_AUTHORITY_RESCUE_REQUIRED: unsafe snapshot number".into());
                }
                value.clone()
            }
            _ => value.clone(),
        })
    }
    let text = serde_json::to_string(&ordered(value)?).map_err(|error| error.to_string())?;
    if text.len() > MAX_SNAPSHOT {
        return Err("NATIVE_AUTHORITY_RESCUE_REQUIRED: snapshot exceeds transfer budget".into());
    }
    Ok(text)
}

/// A capability for this Store's actual connection inside its FULL transaction.
/// It cannot be deserialized, built from a caller connection or escape consume.
pub(crate) struct CheckedStoreTransaction<'scope> {
    store: &'scope SessionStore,
    connection: &'scope Connection,
    new_renderer_checkpoint_parents: RefCell<HashSet<String>>,
    _scope: &'scope (),
}
impl CheckedStoreTransaction<'_> {
    pub(crate) fn connection(&self) -> &Connection {
        self.connection
    }
    pub(crate) fn is_for(&self, store: &SessionStore) -> bool {
        std::ptr::eq(self.store, store)
    }
    pub(crate) fn native_instance_id(&self) -> uuid::Uuid {
        self.store.native_instance_id()
    }
    pub(crate) fn has_new_renderer_checkpoint_parent(&self, nonce: &str) -> bool {
        self.new_renderer_checkpoint_parents
            .borrow()
            .contains(nonce)
    }
    fn mark_new_renderer_checkpoint_parent(&self, nonce: &str) {
        self.new_renderer_checkpoint_parents
            .borrow_mut()
            .insert(nonce.to_owned());
    }
}
pub(crate) fn with_full_projection_transaction<T>(
    store: &SessionStore,
    consume: impl for<'scope> FnOnce(CheckedStoreTransaction<'scope>) -> Result<T, String>,
) -> Result<T, String> {
    let conn = store.lock_conn()?;
    critical(&conn, |tx| {
        let scope = ();
        consume(CheckedStoreTransaction {
            store,
            connection: tx,
            new_renderer_checkpoint_parents: RefCell::new(HashSet::new()),
            _scope: &scope,
        })
    })
}

fn critical<T>(
    conn: &Connection,
    write: impl FnOnce(&Transaction<'_>) -> Result<T, String>,
) -> Result<T, String> {
    if !conn.is_autocommit() {
        return Err(
            "NATIVE_AUTHORITY_STORAGE_BUSY: critical barrier requires an idle writer".into(),
        );
    }
    let previous: i64 = conn
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|error| error.to_string())?;
    let result = (|| {
        let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let value = write(&tx)?;
        tx.commit()
            .map_err(|error| format!("NATIVE_AUTHORITY_COMMIT_UNCERTAIN: {error}"))?;
        Ok(value)
    })();
    let restored = conn
        .pragma_update(None, "synchronous", previous)
        .map_err(|error| error.to_string());
    match (result, restored) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(format!("NATIVE_AUTHORITY_RECOVERY_REQUIRED: {error}")),
    }
}

fn require_native(
    conn: &Connection,
    session_id: &str,
    allow_quiescing: bool,
) -> Result<u64, String> {
    match read_state(conn, session_id)? {
        None => Ok(0),
        Some(state)
            if state.min_writer_protocol >= 2
                && state.min_writer_protocol <= WRITER_PROTOCOL
                && (state.phase == "NATIVE" || (allow_quiescing && state.phase == "QUIESCING")) =>
        {
            Ok(state.generation)
        }
        _ => Err("NATIVE_AUTHORITY_FENCED: native execution/mutation is unavailable".into()),
    }
}

fn require_supported_writer(state: &AuthorityState) -> Result<(), String> {
    if state.min_writer_protocol < 2 || state.min_writer_protocol > WRITER_PROTOCOL {
        Err("NATIVE_AUTHORITY_UNSUPPORTED_WRITER".into())
    } else {
        Ok(())
    }
}

fn no_pending(conn: &Connection, session_id: &str) -> Result<(), String> {
    execution_idle_at(conn, session_id)?;
    for table in [
        "native_managed_turns",
        "native_rewind_requests",
        "native_rewind_intents",
        "session_rewind_operations",
    ] {
        let pending: bool = conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE session_id=?1 AND phase!='complete')"),
            [session_id], |row| row.get(0),
        ).map_err(|error|error.to_string())?;
        if pending {
            return Err(format!(
                "NATIVE_AUTHORITY_NOT_QUIESCENT: retained {table} evidence"
            ));
        }
    }
    Ok(())
}

fn execution_idle_at(conn: &Connection, session_id: &str) -> Result<(), String> {
    let unknown: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM native_authority_unknown_ingress)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if unknown {
        return Err(
            "NATIVE_AUTHORITY_UNQUALIFIED_WRITERS: retained sessionless provider admission".into(),
        );
    }
    let pending: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM native_authority_reservations WHERE session_id=?1)",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if pending {
        return Err(
            "NATIVE_AUTHORITY_NOT_QUIESCENT: retained native_authority_reservations evidence"
                .into(),
        );
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub(crate) struct NativeScope {
    pub environment_id: String,
    pub generation: u64,
}

#[derive(Clone)]
pub(crate) struct ExecutionGate {
    conn: Arc<Mutex<super::cohort::RegisteredConnection>>,
    barrier: Option<WindowBarrier>,
}
pub(crate) struct NativeLease {
    gate: ExecutionGate,
    reservation_id: String,
    session_id: String,
    generation: u64,
    /// Only a reservation known never to have crossed an external side-effect
    /// boundary may be removed automatically by Drop.
    unstarted: bool,
    finished: bool,
    operation: Option<NativeOperation>,
}

impl ExecutionGate {
    pub(crate) fn reserve(
        &self,
        session_id: &str,
        kind: &str,
        scope: Option<&NativeScope>,
    ) -> Result<NativeLease, String> {
        self.reserve_existing(session_id, kind, scope, false)
    }

    pub(crate) fn reserve_existing(
        &self,
        session_id: &str,
        kind: &str,
        scope: Option<&NativeScope>,
        existing_control: bool,
    ) -> Result<NativeLease, String> {
        // Keep pre-bridge native IDs usable even when they are not eligible for
        // the new wire identifier grammar (for example a leading underscore).
        validate_id(session_id, "session")?;
        let operation = match &self.barrier {
            Some(barrier) => Some(match barrier.begin_process_session_write(session_id) {
                Ok(operation) => operation,
                Err(BarrierError::InvalidSessionScope) => {
                    // Preserve legacy Native grammar/lengths. A scope that cannot
                    // be represented is global unknown work, never truncated or
                    // invented session attribution and never qualified coverage.
                    barrier
                        .admit_unqualified_write()
                        .map_err(|e| e.to_string())?;
                    barrier.begin_process_write().map_err(|e| e.to_string())?
                }
                Err(error) => return Err(error.to_string()),
            }),
            None => None,
        };
        let reservation_id = uuid::Uuid::new_v4().to_string();
        let result = (|| {
            let conn = self
                .conn
                .lock()
                .map_err(|_| "Native authority store is locked")?;
            critical(&conn, |tx| {
                let generation = require_native(tx, session_id, existing_control)?;
                match read_state(tx, session_id)? {
                    Some(state) if generation > 0 => {
                        if !scope.is_some_and(|scope| {
                            scope.environment_id == state.environment_id
                                && scope.generation == generation
                        }) {
                            return Err("NATIVE_AUTHORITY_STALE_GENERATION".into());
                        }
                    }
                    _ if scope.is_some_and(|scope| scope.generation != 0) => {
                        return Err("NATIVE_AUTHORITY_STALE_GENERATION".into())
                    }
                    _ => {}
                }
                tx.execute("INSERT INTO native_authority_reservations(reservation_id,session_id,generation,kind,phase,owner_pid,created_at)
                VALUES(?1,?2,?3,?4,'RESERVED',?5,?6)",params![reservation_id,session_id,generation as i64,kind,std::process::id(),now_millis()]).map_err(|error|error.to_string())?;
                Ok(generation)
            })
        })(); // SQL mutex is released BEFORE operation settlement/Drop.
        let generation = match result {
            Ok(generation) => generation,
            Err(error) => {
                if let Some(operation) = operation {
                    let _ = operation.finish(Err::<(), ()>(()));
                }
                return Err(error);
            }
        };
        Ok(NativeLease {
            gate: self.clone(),
            reservation_id,
            session_id: session_id.into(),
            generation,
            unstarted: true,
            finished: false,
            operation,
        })
    }

    pub(crate) fn guarded<T>(
        &self,
        session_id: &str,
        kind: &str,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.guarded_existing(session_id, kind, false, write)
    }

    pub(crate) fn guarded_existing<T>(
        &self,
        session_id: &str,
        kind: &str,
        finishing: bool,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut lease = self.reserve_existing(session_id, kind, None, finishing)?;
        lease.begin_external()?;
        let value = write()?;
        lease.finish()?;
        Ok(value)
    }

    pub(crate) fn assert_checkpoint(&self, session_id: &str) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Native authority store is locked")?;
        assert_checkpoint(&conn, session_id)
    }

    pub(crate) fn has_floor(&self) -> Result<bool, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Native authority store is locked")?;
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM native_authority_floor)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
    }

    pub(crate) fn note_unknown_ingress(&self, kind: &str) -> Result<(), String> {
        if let Some(barrier) = &self.barrier {
            // Permanent SQL unknown-ingress evidence cannot race target close.
            // Qualification stays tainted even after this SQL callback returns.
            barrier
                .admit_unqualified_write()
                .map_err(|e| e.to_string())?;
        }
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Native authority store is locked")?;
        critical(&conn, |tx| {
            let floor: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM native_authority_floor)",
                    [],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if floor {
                return Err("NATIVE_AUTHORITY_SESSION_REQUIRED: provider mutation requires session provenance".into());
            }
            tx.execute(
                "INSERT INTO native_authority_unknown_ingress(id,kind,created_at) VALUES(?1,?2,?3)",
                params![uuid::Uuid::new_v4().to_string(), kind, now_millis()],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub(crate) fn assert_provider_target(
        &self,
        session_id: &str,
        target: &str,
    ) -> Result<(), String> {
        let url =
            url::Url::parse(target).map_err(|_| "NATIVE_AUTHORITY_INVALID_PROVIDER_TARGET")?;
        let parts: Vec<_> = url
            .path_segments()
            .map(|parts| parts.collect())
            .unwrap_or_default();
        let Some(index) = parts.iter().position(|part| *part == "session") else {
            return Ok(());
        };
        let Some(raw) = parts.get(index + 1).filter(|value| !value.is_empty()) else {
            return Ok(());
        };
        // Decode an ID, not a destination URL. Preserve '+' in path segments.
        let encoded = format!("id={}", raw.replace('+', "%2B"));
        let provider_id = url::form_urlencoded::parse(encoded.as_bytes())
            .next()
            .map(|(_, value)| value.into_owned())
            .ok_or("NATIVE_AUTHORITY_INVALID_PROVIDER_TARGET")?;
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Native authority store is locked")?;
        let conflict: bool = conn
            .query_row(
                "SELECT EXISTS(
          SELECT 1 FROM native_authority_floor f LEFT JOIN sessions s ON s.id=f.session_id
          WHERE f.session_id!=?1 AND (s.provider_session_id=?2 OR EXISTS(
            SELECT 1 FROM native_authority_journal j WHERE j.session_id=f.session_id
              AND json_extract(j.snapshot_json,'$.session.providerSessionId')=?2)))",
                params![session_id, provider_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if conflict {
            Err("NATIVE_AUTHORITY_PROVIDER_SCOPE: provider identity belongs to another fenced session".into())
        } else {
            Ok(())
        }
    }
}

pub(crate) fn assert_checkpoint(conn: &Connection, session_id: &str) -> Result<(), String> {
    match read_state(conn, session_id)? {
        None => Ok(()),
        Some(state)
            if state.min_writer_protocol < 2 || state.min_writer_protocol > WRITER_PROTOCOL =>
        {
            Err("NATIVE_AUTHORITY_UNSUPPORTED_WRITER".into())
        }
        Some(state) if state.phase == "QUIESCING" && state.generation == 0 => Ok(()),
        Some(state) if state.phase == "NATIVE" && state.generation == 0 => Ok(()),
        Some(state) => {
            let permitted:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_authority_permits WHERE environment_id=?1 AND session_id=?2 AND generation=?3
              AND writer_protocol>=?5 AND ((purpose='native' AND ?4 IN ('NATIVE','QUIESCING')) OR (purpose='projection' AND ?4 IN ('HOST','CACHE'))))",
                params![state.environment_id,session_id,state.generation as i64,state.phase,state.min_writer_protocol as i64],|row|row.get(0)).map_err(|error|error.to_string())?;
            if permitted {
                Ok(())
            } else {
                Err("NATIVE_AUTHORITY_FENCED: generation-aware writer is required".into())
            }
        }
    }
}

pub(super) fn assert_checkpoint_sql(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    assert_checkpoint(conn, session_id).map_err(|message| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            message,
        )))
    })
}

pub(super) fn assert_mutation_sql(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    require_native(conn, session_id, false)
        .and_then(|_| assert_checkpoint(conn, session_id))
        .map_err(|message| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                message,
            )))
        })
}

impl NativeLease {
    pub(crate) fn begin_external(&mut self) -> Result<(), String> {
        let conn = self
            .gate
            .conn
            .lock()
            .map_err(|_| "Native authority store is locked")?;
        critical(&conn, |tx| {
            if require_native(tx, &self.session_id, true)? != self.generation {
                return Err("NATIVE_AUTHORITY_STALE_GENERATION".into());
            }
            let changed=tx.execute("UPDATE native_authority_reservations SET phase='FORKING' WHERE reservation_id=?1 AND phase='RESERVED' AND generation=?2",params![self.reservation_id,self.generation as i64]).map_err(|error|error.to_string())?;
            if changed != 1 {
                return Err("NATIVE_AUTHORITY_RESERVATION_CHANGED".into());
            }
            Ok(())
        })?;
        self.unstarted = false;
        Ok(())
    }
    pub(crate) fn spawned(&mut self, pid: u32) -> Result<(), String> {
        if self.unstarted {
            return Err("NATIVE_AUTHORITY_RESERVATION_NOT_ADMITTED".into());
        }
        let conn = self
            .gate
            .conn
            .lock()
            .map_err(|_| "Native authority store is locked")?;
        critical(&conn, |tx| {
            let changed=tx.execute("UPDATE native_authority_reservations SET phase='RUNNING',child_pid=?2 WHERE reservation_id=?1 AND phase='FORKING'",params![self.reservation_id,pid]).map_err(|error|error.to_string())?;
            if changed != 1 {
                return Err("NATIVE_AUTHORITY_RESERVATION_CHANGED".into());
            }
            Ok(())
        })
    }
    pub(crate) fn finish(mut self) -> Result<(), String> {
        self.release()?;
        self.finished = true;
        Ok(())
    }
    /// OS spawn returning Err is proof that this admission created no child.
    pub(crate) fn spawn_failed(&mut self) -> Result<(), String> {
        self.release()?;
        self.finished = true;
        Ok(())
    }
    fn release(&mut self) -> Result<(), String> {
        let result = (|| {
            let conn = self
                .gate
                .conn
                .lock()
                .map_err(|_| "Native authority store is locked")?;
            critical(&conn, |tx| {
                tx.execute(
                    "DELETE FROM native_authority_reservations WHERE reservation_id=?1",
                    [&self.reservation_id],
                )
                .map_err(|error| error.to_string())?;
                Ok(())
            })
        })();
        // Never settle under SQL: checkpoint consumers lock barrier then Store.
        // On error retain the lease for a real retry/unknown Drop; a successful
        // delete plus FULL commit/restore is the actual known settlement.
        if result.is_ok() {
            self.finished = true;
            if let Some(operation) = self.operation.take() {
                let _ = operation.finish(Ok::<(), ()>(()));
            }
        }
        result
    }
}
impl Drop for NativeLease {
    fn drop(&mut self) {
        if self.unstarted && !self.finished {
            let _ = self.release();
        }
    }
}

impl SessionStore {
    pub(crate) fn authority_execution_gate(&self) -> ExecutionGate {
        ExecutionGate {
            conn: self.conn.clone(),
            barrier: self.native_writer_barrier.clone(),
        }
    }

    pub(crate) fn assert_native_execution_idle(&self, session_id: &str) -> Result<(), String> {
        validate_id(session_id, "session")?;
        let conn = self.lock_conn()?;
        execution_idle_at(&conn, session_id)
    }

    /// Same check for an actual joined FULL consumer, without relocking Store.
    pub(crate) fn assert_native_execution_idle_at(
        &self,
        checked: &CheckedStoreTransaction<'_>,
        session_id: &str,
    ) -> Result<(), String> {
        if !checked.is_for(self) {
            return Err("NATIVE_CHECKPOINT_WRONG_STORE_TRANSACTION".into());
        }
        validate_id(session_id, "session")?;
        execution_idle_at(checked.connection(), session_id)
    }

    pub(crate) fn renderer_checkpoint_capture_scope(
        &self,
        scope: &crate::native_authority_checkpoint::NativeCheckpointScope,
    ) -> Result<super::row_identity::SessionRowIdentity, String> {
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
            .map_err(|error| error.to_string())?;
        renderer_checkpoint_scope(&tx, scope)?;
        let row = self
            .capture_session_row_identity_at(&tx, &scope.session_id)?
            .ok_or("NATIVE_CHECKPOINT_SESSION_MISSING")?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(row)
    }

    pub(crate) fn renderer_checkpoint_validate_row(
        &self,
        scope: &crate::native_authority_checkpoint::NativeCheckpointScope,
        row: &super::row_identity::SessionRowIdentity,
    ) -> Result<(), String> {
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
            .map_err(|error| error.to_string())?;
        renderer_checkpoint_scope(&tx, scope)?;
        if !self.session_row_identity_current_at(&tx, row, &scope.session_id)? {
            return Err("NATIVE_CHECKPOINT_ROW_CHANGED".into());
        }
        tx.commit().map_err(|error| error.to_string())
    }

    /// Receipts attest exact, already committed SQL rows only. No source permit,
    /// quiesce/fence transition, draft rewrite or provider effect is introduced.
    pub(crate) fn renderer_checkpoint_commit(
        &self,
        commit: crate::native_authority_checkpoint::NativeCheckpointCommit<'_>,
    ) -> Result<crate::native_authority_checkpoint::NativeSqlCheckpointReceipt, String> {
        with_full_projection_transaction(self, |checked| {
            self.renderer_checkpoint_commit_at(&checked, commit)
        })
    }

    pub(crate) fn renderer_checkpoint_commit_at(
        &self,
        checked: &CheckedStoreTransaction<'_>,
        commit: crate::native_authority_checkpoint::NativeCheckpointCommit<'_>,
    ) -> Result<crate::native_authority_checkpoint::NativeSqlCheckpointReceipt, String> {
        self.renderer_checkpoint_commit_at_with_raw(checked, commit, None)
    }

    pub(crate) fn renderer_checkpoint_commit_at_with_raw(
        &self,
        checked: &CheckedStoreTransaction<'_>,
        commit: crate::native_authority_checkpoint::NativeCheckpointCommit<'_>,
        raw_capture: Option<super::native_raw_capture::RawCaptureDescriptor>,
    ) -> Result<crate::native_authority_checkpoint::NativeSqlCheckpointReceipt, String> {
        if !checked.is_for(self) || checked.connection().is_autocommit() {
            return Err("NATIVE_CHECKPOINT_WRONG_STORE_TRANSACTION".into());
        }
        if let Some(raw) = &raw_capture {
            raw.validate()?;
        }
        use crate::native_authority_checkpoint::{
            CheckpointUnqualified, NativeSqlCheckpointReceipt, ProviderOutputCheckpoint,
        };
        if commit.expected.fingerprint()? != commit.fingerprint {
            return Err("NATIVE_CHECKPOINT_CONFLICT".into());
        }
        for value in [
            commit.nonce,
            commit.service_epoch,
            commit.round_id,
            commit.window_epoch,
        ] {
            if uuid::Uuid::parse_str(value).is_err() || value.len() != 36 {
                return Err("NATIVE_CHECKPOINT_INVALID_IDENTITY".into());
            }
        }
        let tx = checked.connection();
        renderer_checkpoint_scope(tx, commit.scope)?;
        if !self.session_row_identity_current_at(
            tx,
            commit.row_identity,
            &commit.scope.session_id,
        )? {
            return Err("NATIVE_CHECKPOINT_ROW_CHANGED".into());
        }
        if tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM native_renderer_checkpoint_receipts WHERE nonce=?1)",
                [commit.nonce],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?
        {
            return Err("NATIVE_CHECKPOINT_ALREADY_COMMITTED".into());
        }
        let count: i64 = tx
            .query_row(
                "SELECT count(*) FROM native_renderer_checkpoint_receipts",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if count >= 4096 {
            return Err("NATIVE_CHECKPOINT_RECEIPT_CAPACITY".into());
        }
        let (revision, updated_at): (i64,i64) = tx.query_row(
                "SELECT COALESCE((SELECT revision FROM session_block_state WHERE session_id=s.id),0),s.updated_at FROM sessions s WHERE s.id=?1",
                [&commit.scope.session_id], |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|error| error.to_string())?;
        if revision != commit.expected.revision || updated_at != commit.expected.updated_at {
            return Err("NATIVE_CHECKPOINT_CONFLICT".into());
        }
        let mut remaining = 32 * 1024 * 1024;
        let transcript = checkpoint_blob(
            tx,
            "session_transcripts",
            "id",
            "blocks_json",
            &commit.scope.session_id,
            &mut remaining,
        )?
        .ok_or("NATIVE_CHECKPOINT_SESSION_MISSING")?;
        let draft = checkpoint_blob(
            tx,
            "composer_drafts",
            "session_id",
            "draft_json",
            &commit.scope.session_id,
            &mut remaining,
        )?;
        let queue = checkpoint_blob(
            tx,
            "session_queues",
            "session_id",
            "queue_json",
            &commit.scope.session_id,
            &mut remaining,
        )?;
        let transcript_json: Value =
            serde_json::from_str(&transcript).map_err(|_| "NATIVE_CHECKPOINT_CORRUPT")?;
        if !transcript_json.is_array() {
            return Err("NATIVE_CHECKPOINT_CORRUPT".into());
        }
        for (raw, object) in [(&draft, true), (&queue, false)] {
            if let Some(raw) = raw {
                let value: Value =
                    serde_json::from_str(raw).map_err(|_| "NATIVE_CHECKPOINT_CORRUPT")?;
                if (object && !value.is_object()) || (!object && !value.is_array()) {
                    return Err("NATIVE_CHECKPOINT_CORRUPT".into());
                }
            }
        }
        let transcript_sha256 = sha(transcript.as_bytes());
        let draft_sha256 = draft.as_ref().map(|value| sha(value.as_bytes()));
        let queue_sha256 = queue.as_ref().map(|value| sha(value.as_bytes()));
        if transcript_sha256 != commit.expected.transcript_sha256
            || !commit.expected.draft.matches(&draft_sha256)
            || !commit.expected.queue.matches(&queue_sha256)
        {
            return Err("NATIVE_CHECKPOINT_CONFLICT".into());
        }
        let ids = identity(tx)?;
        let receipt = NativeSqlCheckpointReceipt {
            version: 1,
            qualified: CheckpointUnqualified,
            provider_output: ProviderOutputCheckpoint::Unsealed,
            nonce: commit.nonce.into(),
            service_epoch: commit.service_epoch.into(),
            round_id: commit.round_id.into(),
            window_epoch: commit.window_epoch.into(),
            native_store_instance: self.native_instance_id().to_string(),
            environment_id: commit.scope.environment_id.clone(),
            source_store_id: ids.source_store_id,
            source_profile_id: ids.source_profile_id,
            session_id: commit.scope.session_id.clone(),
            migration_id: commit.scope.migration_id.clone(),
            generation: commit.scope.generation,
            revision,
            updated_at,
            transcript_sha256,
            draft_sha256,
            queue_sha256,
            raw_capture,
        };
        let raw = serde_json::to_string(&receipt).map_err(|error| error.to_string())?;
        if raw.len() > 8192 {
            return Err("NATIVE_CHECKPOINT_RECEIPT_CAPACITY".into());
        }
        tx.execute("INSERT INTO native_renderer_checkpoint_receipts(nonce,payload_digest,receipt_json) VALUES(?1,?2,?3)", params![commit.nonce, commit.fingerprint, raw]).map_err(|error| error.to_string())?;
        checked.mark_new_renderer_checkpoint_parent(commit.nonce);
        Ok(receipt)
    }

    pub(crate) fn renderer_checkpoint_read(
        &self,
        nonce: &str,
        fingerprint: &str,
        expected: &crate::native_authority_checkpoint::NativeSqlCheckpointReceipt,
    ) -> Result<crate::native_authority_checkpoint::NativeSqlCheckpointReceipt, String> {
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
            .map_err(|error| error.to_string())?;
        let ids = identity(&tx)?;
        if self.native_instance_id().to_string() != expected.native_store_instance
            || ids.source_store_id != expected.source_store_id
            || ids.source_profile_id != expected.source_profile_id
        {
            return Err("NATIVE_CHECKPOINT_SOURCE_CHANGED".into());
        }
        let row: Option<(String,String)> = tx.query_row("SELECT CASE WHEN typeof(payload_digest)='text' AND length(CAST(payload_digest AS BLOB))=64 THEN payload_digest ELSE NULL END,CASE WHEN typeof(receipt_json)='text' AND length(CAST(receipt_json AS BLOB))<=8192 THEN receipt_json ELSE NULL END FROM native_renderer_checkpoint_receipts WHERE nonce=?1", [nonce], |row| Ok((row.get(0)?,row.get(1)?))).optional().map_err(|error| error.to_string())?;
        let (actual, raw) = row.ok_or("NATIVE_CHECKPOINT_RECEIPT_MISSING")?;
        let receipt: crate::native_authority_checkpoint::NativeSqlCheckpointReceipt =
            serde_json::from_str(&raw).map_err(|_| "NATIVE_CHECKPOINT_RECEIPT_CORRUPT")?;
        if actual != fingerprint || &receipt != expected {
            return Err("NATIVE_CHECKPOINT_RECEIPT_CHANGED".into());
        }
        if receipt.raw_capture.is_some() {
            let raw = super::native_raw_capture::RawCaptureReceipt::from_sql(&receipt)?;
            super::native_raw_capture::read_at(&tx, self, &raw)?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        Ok(receipt)
    }

    pub(crate) fn authority_native_checkpoint(
        &self,
        scope: &NativeScope,
        session: &SessionUpsert,
    ) -> Result<SessionSummary, String> {
        validate_upsert(session)?;
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current = read_state(&tx, &session.id)?.ok_or("NATIVE_AUTHORITY_CAS")?;
        require_supported_writer(&current)?;
        if !matches!(current.phase.as_str(), "NATIVE" | "QUIESCING")
            || current.environment_id != scope.environment_id
            || current.generation != scope.generation
        {
            return Err("NATIVE_AUTHORITY_STALE_GENERATION".into());
        }
        let nonce = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO native_authority_permits(nonce,environment_id,session_id,generation,writer_protocol,purpose) VALUES(?1,?2,?3,?4,?5,'native')",params![nonce,scope.environment_id,session.id,scope.generation as i64,WRITER_PROTOCOL as i64]).map_err(|error|error.to_string())?;
        let summary = upsert_session_in_transaction(
            &tx,
            session,
            crate::fs::GitInfo {
                branch: session.branch.clone(),
                repo: None,
            },
            None,
        )
        .map_err(|error| error.to_string())?
        .ok_or("NATIVE_AUTHORITY_CAS")?;
        tx.execute(
            "DELETE FROM native_authority_permits WHERE nonce=?1",
            [nonce],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(summary)
    }
}

fn renderer_checkpoint_scope(
    conn: &Connection,
    scope: &crate::native_authority_checkpoint::NativeCheckpointScope,
) -> Result<(), String> {
    for value in [
        &scope.environment_id,
        &scope.session_id,
        &scope.migration_id,
    ] {
        identifier(value)?;
    }
    if scope.generation > 9_007_199_254_740_991 {
        return Err("NATIVE_CHECKPOINT_WRONG_SCOPE".into());
    }
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
            [&scope.session_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("NATIVE_CHECKPOINT_SESSION_MISSING".into());
    }
    if let Some(state) = read_state(conn, &scope.session_id)? {
        require_supported_writer(&state)?;
        if !matches!(state.phase.as_str(), "NATIVE" | "QUIESCING")
            || state.environment_id != scope.environment_id
            || state.generation != scope.generation
            || (state.phase == "QUIESCING" && state.migration_id != scope.migration_id)
        {
            return Err("NATIVE_CHECKPOINT_WRONG_SCOPE".into());
        }
    } else if scope.generation != 0 {
        return Err("NATIVE_CHECKPOINT_WRONG_SCOPE".into());
    }
    Ok(())
}

/// SQL size/type checks precede native String allocation. Table/column names are
/// private constants above, never renderer routing fields.
fn checkpoint_blob(
    conn: &Connection,
    table: &str,
    id: &str,
    column: &str,
    session: &str,
    remaining: &mut usize,
) -> Result<Option<String>, String> {
    let length: Option<(String, i64)> = conn
        .query_row(
            &format!(
                "SELECT typeof({column}),length(CAST({column} AS BLOB)) FROM {table} WHERE {id}=?1"
            ),
            [session],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((kind, length)) = length else {
        return Ok(None);
    };
    let bytes = usize::try_from(length).map_err(|_| "NATIVE_CHECKPOINT_CORRUPT")?;
    if kind != "text" || bytes > *remaining {
        return Err("NATIVE_CHECKPOINT_ROW_CAPACITY".into());
    }
    let raw: String = conn
        .query_row(
            &format!("SELECT {column} FROM {table} WHERE {id}=?1"),
            [session],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if raw.len() != bytes {
        return Err("NATIVE_CHECKPOINT_CORRUPT".into());
    }
    *remaining -= bytes;
    Ok(Some(raw))
}

fn buffers_digest(conn: &Connection, session_id: &str) -> Result<String, String> {
    let rows = conn.prepare("SELECT owner_id,snapshot_json,confirmed FROM native_workspace_buffers ORDER BY owner_id")
        .map_err(|error|error.to_string())?.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,i64>(2)?)))
        .map_err(|error|error.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|error|error.to_string())?;
    if rows.iter().any(|(_, _, confirmed)| *confirmed != 1) {
        return Err("NATIVE_AUTHORITY_NOT_QUIESCENT: unknown editor buffers".into());
    }
    let cwd: Option<String> = conn
        .query_row(
            "SELECT COALESCE(NULLIF(worktree_cwd,''),cwd) FROM sessions WHERE id=?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let cwd = crate::fs::expand_home(&cwd.ok_or("NATIVE_AUTHORITY_SESSION_MISSING")?);
    for (_, raw, _) in &rows {
        let buffers: Value = serde_json::from_str(raw)
            .map_err(|_| "NATIVE_AUTHORITY_NOT_QUIESCENT: invalid editor buffers")?;
        let buffers = buffers
            .as_array()
            .ok_or("NATIVE_AUTHORITY_NOT_QUIESCENT: invalid editor buffers")?;
        for buffer in buffers {
            let path = buffer["path"]
                .as_str()
                .ok_or("NATIVE_AUTHORITY_NOT_QUIESCENT: invalid editor path")?;
            let dirty = buffer["dirty"]
                .as_bool()
                .ok_or("NATIVE_AUTHORITY_NOT_QUIESCENT: unknown editor state")?;
            if dirty && crate::worktrees::contains_working_dir(&cwd, &crate::fs::expand_home(path))
            {
                return Err(
                    "NATIVE_AUTHORITY_NOT_QUIESCENT: unsaved affected editor buffers".into(),
                );
            }
        }
    }
    Ok(sha(encode(
        &serde_json::to_value(rows).map_err(|error| error.to_string())?,
    )?
    .as_bytes()))
}

fn retained_rows(conn: &Connection, session_id: &str) -> Result<Value, String> {
    let mut output = serde_json::Map::new();
    let mut retained_bytes = 0usize;
    for (table, filter) in [
        ("sessions", "id=?1"),
        ("session_blocks", "session_id=?1"),
        ("session_block_state", "session_id=?1"),
        ("composer_drafts", "session_id=?1"),
        ("session_queues", "session_id=?1"),
        ("in_flight_sessions", "session_id=?1"),
        ("orchestration_runs", "lead_id=?1"),
        ("orchestration_sidebar", "lead_id=?1"),
        ("orchestration_workers", "session_id=?1 OR lead_id=?1"),
        ("session_rewind_operations", "session_id=?1"),
        ("native_managed_turns", "session_id=?1"),
        ("native_rewind_requests", "session_id=?1"),
        ("native_rewind_intents", "session_id=?1"),
    ] {
        let mut statement = conn
            .prepare(&format!(
                "SELECT * FROM {table} WHERE {filter} ORDER BY rowid"
            ))
            .map_err(|error| error.to_string())?;
        let names: Vec<String> = statement
            .column_names()
            .iter()
            .map(|name| (*name).into())
            .collect();
        let rows=statement.query_map([session_id],|row| {
            let mut object=serde_json::Map::new();
            for (index,name) in names.iter().enumerate() {
                use rusqlite::types::ValueRef;
                let raw=row.get_ref(index)?;
                let size=match raw {ValueRef::Text(value)|ValueRef::Blob(value)=>value.len(),_=>32};
                retained_bytes=retained_bytes.saturating_add(size).saturating_add(name.len()+16);
                if retained_bytes>MAX_SNAPSHOT {return Err(rusqlite::Error::InvalidQuery);}
                let value=match raw {
                    ValueRef::Null=>Value::Null,
                    ValueRef::Integer(value)=>json!(value),
                    ValueRef::Real(value)=>serde_json::Number::from_f64(value).map(Value::Number).ok_or_else(||rusqlite::Error::InvalidQuery)?,
                    ValueRef::Text(value)=>Value::String(std::str::from_utf8(value).map_err(|error|rusqlite::Error::FromSqlConversionFailure(index,rusqlite::types::Type::Text,Box::new(error)))?.into()),
                    ValueRef::Blob(value)=>{
                        use base64::Engine;
                        json!({"encoding":"base64","bytes":base64::engine::general_purpose::STANDARD.encode(value)})
                    },
                };
                object.insert(name.clone(),value);
            }
            Ok(Value::Object(object))
        }).map_err(|error|error.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|error|error.to_string())?;
        output.insert(table.into(), Value::Array(rows));
    }
    Ok(Value::Object(output))
}

impl SessionStore {
    pub(crate) fn authority_identity(&self) -> Result<StoreIdentity, String> {
        identity(&*(self.lock_conn()?))
    }
    pub(crate) fn authority_status(
        &self,
        session_id: &str,
    ) -> Result<Option<AuthorityState>, String> {
        read_state(&*(self.lock_conn()?), session_id)
    }

    pub(crate) fn authority_begin_quiesce(
        &self,
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        expected_generation: u64,
    ) -> Result<AuthorityState, String> {
        for id in [environment_id, session_id, migration_id] {
            identifier(id)?;
        }
        if expected_generation > MAX_SAFE {
            return Err("NATIVE_AUTHORITY_INVALID_GENERATION".into());
        }
        let conn = self.lock_conn()?;
        critical(&conn, |tx| {
            let current = read_state(tx, session_id)?;
            if let Some(state) = &current {
                require_supported_writer(state)?;
                if state.environment_id != environment_id || state.generation != expected_generation
                {
                    return Err("NATIVE_AUTHORITY_CAS".into());
                }
                if state.phase == "QUIESCING" && state.migration_id == migration_id {
                    return Ok(state.clone());
                }
                if state.phase != "NATIVE" {
                    return Err("NATIVE_AUTHORITY_CAS".into());
                }
            } else if expected_generation != 0 {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
                    [session_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if !exists {
                return Err("NATIVE_AUTHORITY_SESSION_MISSING".into());
            }
            let ids = identity(tx)?;
            tx.execute("INSERT INTO native_authority_journal(migration_id,environment_id,session_id,source_store_id,source_profile_id,phase,generation,created_at,updated_at)
              VALUES(?1,?2,?3,?4,?5,'QUIESCING',?6,?7,?7)",params![migration_id,environment_id,session_id,ids.source_store_id,ids.source_profile_id,expected_generation as i64,now_millis()]).map_err(|error|error.to_string())?;
            tx.execute("INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol) VALUES(?1,?2,?3,'QUIESCING',?4,?5)
              ON CONFLICT(environment_id,session_id) DO UPDATE SET phase='QUIESCING',migration_id=excluded.migration_id,min_writer_protocol=MAX(native_authority_floor.min_writer_protocol,excluded.min_writer_protocol)",
              params![environment_id,session_id,expected_generation as i64,migration_id,WRITER_PROTOCOL as i64]).map_err(|error|error.to_string())?;
            read_state(tx, session_id)?.ok_or_else(|| "NATIVE_AUTHORITY_CAS".into())
        })
    }

    /// Cancel only before any source fence exists. No renderer endpoint is installed.
    /// Native callers must pass their own store identity, not a renderer assertion.
    pub(crate) fn authority_cancel_quiesce(
        &self,
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        expected_generation: u64,
        expected_identity: &StoreIdentity,
        host: &crate::harness::HarnessHost,
    ) -> Result<QuiesceCancellation, String> {
        for id in [environment_id, session_id, migration_id] {
            identifier(id)?;
        }
        let generation = expected_generation
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE)
            .ok_or("NATIVE_AUTHORITY_INVALID_GENERATION")?;
        host.authority_idle(session_id)?;
        let conn = self.lock_conn()?;
        critical(&conn, |tx| {
            if identity(tx)? != *expected_identity {
                return Err("NATIVE_AUTHORITY_SCOPE".into());
            }
            let state = read_state(tx, session_id)?.ok_or("NATIVE_AUTHORITY_CAS")?;
            require_supported_writer(&state)?;
            if state.environment_id != environment_id || state.migration_id != migration_id {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            let retained: Option<String> = tx
                .query_row(
                    "SELECT receipt_json FROM native_authority_cancellations WHERE migration_id=?1",
                    [migration_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some(raw) = retained {
                let receipt: QuiesceCancellation =
                    serde_json::from_str(&raw).map_err(|error| error.to_string())?;
                if receipt.environment_id != environment_id
                    || receipt.session_id != session_id
                    || receipt.migration_id != migration_id
                    || receipt.identity != *expected_identity
                    || receipt.source_generation != expected_generation
                    || receipt.authority_generation != generation
                    || state.phase != "NATIVE"
                    || state.generation != generation
                {
                    return Err("NATIVE_AUTHORITY_CAS".into());
                }
                return Ok(receipt);
            }
            if state.phase != "QUIESCING" || state.generation != expected_generation {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            no_pending(tx, session_id)?;
            let receipt = QuiesceCancellation {
                receipt_id: uuid::Uuid::new_v4().to_string(),
                environment_id: environment_id.into(),
                session_id: session_id.into(),
                migration_id: migration_id.into(),
                identity: expected_identity.clone(),
                source_generation: expected_generation,
                authority_generation: generation,
            };
            let changed = tx.execute("UPDATE native_authority_journal SET phase='QUIESCE_CANCELLED',generation=?1,updated_at=?2
                WHERE migration_id=?3 AND environment_id=?4 AND session_id=?5 AND source_store_id=?6 AND source_profile_id=?7
                AND phase='QUIESCING' AND generation=?8 AND source_digest IS NULL AND snapshot_json IS NULL
                AND fence_json IS NULL AND host_decision_json IS NULL",
                params![generation as i64,now_millis(),migration_id,environment_id,session_id,
                expected_identity.source_store_id,expected_identity.source_profile_id,expected_generation as i64])
                .map_err(|error|error.to_string())?;
            if changed != 1 {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            let changed = tx.execute("UPDATE native_authority_floor SET phase='NATIVE',generation=?1
                WHERE environment_id=?2 AND session_id=?3 AND migration_id=?4 AND phase='QUIESCING' AND generation=?5
                AND source_digest IS NULL AND host_receipt_id IS NULL",
                params![generation as i64,environment_id,session_id,migration_id,expected_generation as i64])
                .map_err(|error|error.to_string())?;
            if changed != 1 {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            tx.execute(
                "INSERT INTO native_authority_cancellations VALUES(?1,?2)",
                params![
                    migration_id,
                    serde_json::to_string(&receipt).map_err(|error| error.to_string())?
                ],
            )
            .map_err(|error| error.to_string())?;
            Ok(receipt)
        })
    }

    pub(crate) fn authority_verify_idle(
        &self,
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        host: &crate::harness::HarnessHost,
        inventory: WriterInventory,
    ) -> Result<IdleProof, String> {
        host.authority_idle(session_id)?;
        let conn = self.lock_conn()?;
        let ids = identity(&conn)?;
        let WriterInventory::Complete {
            identity: observed,
            protocols,
            observation_digest,
            buffers_digest: observed_buffers,
        } = inventory
        else {
            return Err("NATIVE_AUTHORITY_UNQUALIFIED_WRITERS".into());
        };
        if observed != ids
            || protocols.is_empty()
            || protocols.iter().any(|protocol| *protocol < WRITER_PROTOCOL)
            || !digest(&observation_digest)
            || !digest(&observed_buffers)
        {
            return Err("NATIVE_AUTHORITY_UNQUALIFIED_WRITERS".into());
        }
        let state = read_state(&conn, session_id)?.ok_or("NATIVE_AUTHORITY_CAS")?;
        require_supported_writer(&state)?;
        if state.phase != "QUIESCING"
            || state.environment_id != environment_id
            || state.migration_id != migration_id
        {
            return Err("NATIVE_AUTHORITY_CAS".into());
        }
        no_pending(&conn, session_id)?;
        let current_buffers = buffers_digest(&conn, session_id)?;
        if current_buffers != observed_buffers {
            return Err("NATIVE_AUTHORITY_NOT_QUIESCENT: editor barrier changed".into());
        }
        Ok(IdleProof {
            identity: ids,
            environment_id: environment_id.into(),
            session_id: session_id.into(),
            migration_id: migration_id.into(),
            generation: state.generation,
            inventory_digest: observation_digest,
            buffers_digest: current_buffers,
        })
    }

    pub(crate) fn authority_fence_source(
        &self,
        proof: IdleProof,
    ) -> Result<SourceSnapshot, String> {
        let conn = self.lock_conn()?;
        critical(&conn, |tx| {
            let state = read_state(tx, &proof.session_id)?.ok_or("NATIVE_AUTHORITY_CAS")?;
            require_supported_writer(&state)?;
            if state.environment_id != proof.environment_id
                || state.migration_id != proof.migration_id
            {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            if matches!(state.phase.as_str(), "FENCED" | "HOST" | "CACHE") {
                return source_snapshot(tx, &proof.migration_id);
            }
            if state.phase != "QUIESCING"
                || state.generation != proof.generation
                || identity(tx)? != proof.identity
            {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            no_pending(tx, &proof.session_id)?;
            if buffers_digest(tx, &proof.session_id)? != proof.buffers_digest {
                return Err("NATIVE_AUTHORITY_NOT_QUIESCENT: editor barrier changed".into());
            }
            let generation = state
                .generation
                .checked_add(1)
                .filter(|generation| *generation <= MAX_SAFE)
                .ok_or("NATIVE_AUTHORITY_INVALID_GENERATION")?;
            let retained = retained_rows(tx, &proof.session_id)?;
            let record = get_session(tx, &proof.session_id)
                .map_err(|error| error.to_string())?
                .ok_or("NATIVE_AUTHORITY_SESSION_MISSING")?;
            let revision = record.transcript_revision.unwrap_or(0);
            if revision < 0 || revision as u64 > MAX_SAFE {
                return Err("NATIVE_AUTHORITY_RESCUE_REQUIRED: invalid revision".into());
            }
            let queue =
                get_session_queue(tx, &proof.session_id).map_err(|error| error.to_string())?;
            let draft: Option<String> = tx
                .query_row(
                    "SELECT draft_json FROM composer_drafts WHERE session_id=?1",
                    [&proof.session_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let snapshot = encode(
                &json!({"session":record,"clientOwnedQueue":queue,"clientOwnedDraftJson":draft,
                "retainedNativeRows":retained}),
            )?;
            let mut fence = NativeFence {
                protocol: WRITER_PROTOCOL,
                migration_id: proof.migration_id.clone(),
                environment_id: proof.environment_id.clone(),
                session_id: proof.session_id.clone(),
                source_store_id: proof.identity.source_store_id,
                source_profile_id: proof.identity.source_profile_id,
                generation,
                source_revision: revision as u64,
                source_digest: sha(snapshot.as_bytes()),
                snapshot_encoding: "source-json-utf8/v1".into(),
                min_writer_protocol: WRITER_PROTOCOL,
                quiescent: true,
                unknown_reservations: false,
                writer_inventory_verified: true,
                unsupported_writers: false,
                evidence_digest: String::new(),
            };
            fence.evidence_digest=sha(encode(&json!({"fence":fence,"writerInventoryDigest":proof.inventory_digest,"buffersDigest":proof.buffers_digest}))?.as_bytes());
            let raw = serde_json::to_string(&fence).map_err(|error| error.to_string())?;
            tx.execute("UPDATE native_authority_floor SET generation=?1,phase='FENCED',source_digest=?2 WHERE environment_id=?3 AND session_id=?4 AND generation=?5 AND phase='QUIESCING'",
                params![generation as i64,fence.source_digest,proof.environment_id,proof.session_id,proof.generation as i64]).map_err(|error|error.to_string())?;
            tx.execute("UPDATE native_authority_journal SET phase='FENCED',generation=?1,source_revision=?2,source_digest=?3,snapshot_json=?4,fence_json=?5,updated_at=?6,inventory_digest=?8,buffers_digest=?9 WHERE migration_id=?7",
                params![generation as i64,revision,fence.source_digest,snapshot,raw,now_millis(),proof.migration_id,proof.inventory_digest,proof.buffers_digest]).map_err(|error|error.to_string())?;
            Ok(SourceSnapshot {
                fence,
                snapshot_json: snapshot,
            })
        })
    }
}

fn source_snapshot(conn: &Connection, migration_id: &str) -> Result<SourceSnapshot, String> {
    let (raw,snapshot,inventory,buffers,environment,session,store,profile,source_digest):(String,String,String,String,String,String,String,String,String)=conn.query_row(
        "SELECT fence_json,snapshot_json,inventory_digest,buffers_digest,environment_id,session_id,source_store_id,source_profile_id,source_digest
         FROM native_authority_journal WHERE migration_id=?1 AND fence_json IS NOT NULL AND snapshot_json IS NOT NULL",[migration_id],
        |row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?))).map_err(|error|error.to_string())?;
    let fence: NativeFence = serde_json::from_str(&raw)
        .map_err(|_| "NATIVE_AUTHORITY_RECOVERY_REQUIRED: corrupt source fence")?;
    if sha(snapshot.as_bytes()) != fence.source_digest
        || source_digest != fence.source_digest
        || environment != fence.environment_id
        || session != fence.session_id
        || store != fence.source_store_id
        || profile != fence.source_profile_id
        || migration_id != fence.migration_id
        || fence.protocol != 2
        || fence.min_writer_protocol < 2
        || fence.generation == 0
        || fence.generation > MAX_SAFE
        || fence.source_revision > MAX_SAFE
        || !fence.quiescent
        || fence.unknown_reservations
        || !fence.writer_inventory_verified
        || fence.unsupported_writers
        || fence.snapshot_encoding != "source-json-utf8/v1"
    {
        return Err(
            "NATIVE_AUTHORITY_RECOVERY_REQUIRED: source journal identity/digest mismatch".into(),
        );
    }
    let mut unsigned = fence.clone();
    unsigned.evidence_digest.clear();
    if !digest(&inventory)
        || !digest(&buffers)
        || sha(encode(
            &json!({"fence":unsigned,"writerInventoryDigest":inventory,"buffersDigest":buffers}),
        )?
        .as_bytes())
            != fence.evidence_digest
    {
        return Err("NATIVE_AUTHORITY_RECOVERY_REQUIRED: source fence proof mismatch".into());
    }
    Ok(SourceSnapshot {
        fence,
        snapshot_json: snapshot,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostDecision {
    protocol: u64,
    environment_id: String,
    session_id: String,
    migration_id: String,
    source_profile_id: String,
    source_store_id: String,
    receipt_id: String,
    source_generation: u64,
    authority_generation: u64,
    source_revision: u64,
    source_digest: String,
    evidence_digest: String,
    min_writer_protocol: u64,
    committed_at: u64,
    decision_digest: String,
    phase: String,
    #[serde(
        default,
        deserialize_with = "present_target_digest",
        skip_serializing_if = "Option::is_none"
    )]
    target_digest: Option<String>,
}

fn present_target_digest<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    // The closed Host schema permits absence, never an explicit JSON null.
    <String as serde::Deserialize>::deserialize(deserializer).map(Some)
}

pub(crate) trait AuthenticatedHostDecisionPort {
    /// The native bridge verifies its actor and fresh migration challenge. An
    /// ordinary renderer assertion or a self-hashed JSON object is insufficient.
    fn verify_actor_and_challenge(
        &self,
        fence: &NativeFence,
        raw_decision: &str,
    ) -> Result<(), String>;
}
pub(crate) struct VerifiedHostDecision {
    decision: HostDecision,
    raw: String,
    fence: NativeFence,
}

fn decision_digest(decision: &HostDecision) -> Result<String, String> {
    let tuple = json!([
        decision.protocol,
        decision.environment_id,
        decision.session_id,
        decision.migration_id,
        decision.source_profile_id,
        decision.source_store_id,
        decision.receipt_id,
        decision.source_generation,
        decision.authority_generation,
        decision.source_revision,
        decision.source_digest,
        decision.evidence_digest,
        decision.min_writer_protocol,
        decision.committed_at,
        decision.phase,
        decision.target_digest
    ]);
    Ok(sha(serde_json::to_string(&tuple)
        .map_err(|error| error.to_string())?
        .as_bytes()))
}

fn parse_host_decision(raw: &str) -> Result<HostDecision, String> {
    if raw.len() > 16_384 {
        return Err("NATIVE_AUTHORITY_INVALID_HOST_RECEIPT".into());
    }
    serde_json::from_str(raw).map_err(|_| "NATIVE_AUTHORITY_INVALID_HOST_RECEIPT".into())
}

fn validate_host_decision(decision: &HostDecision, fence: &NativeFence) -> Result<(), String> {
    for value in [
        &decision.environment_id,
        &decision.session_id,
        &decision.migration_id,
        &decision.source_profile_id,
        &decision.source_store_id,
        &decision.receipt_id,
    ] {
        identifier(value)?;
    }
    if decision.protocol != 2
        || decision.min_writer_protocol < fence.min_writer_protocol
        || decision.min_writer_protocol > WRITER_PROTOCOL
        || decision.committed_at > MAX_SAFE
        || decision.authority_generation > MAX_SAFE
        || decision.environment_id != fence.environment_id
        || decision.session_id != fence.session_id
        || decision.migration_id != fence.migration_id
        || decision.source_profile_id != fence.source_profile_id
        || decision.source_store_id != fence.source_store_id
        || decision.source_generation != fence.generation
        || decision.source_revision != fence.source_revision
        || decision.source_digest != fence.source_digest
        || decision.evidence_digest != fence.evidence_digest
        || !digest(&decision.decision_digest)
        || decision
            .target_digest
            .as_ref()
            .is_some_and(|value| !digest(value))
        || !((decision.phase == "host-active"
            && decision.target_digest.is_some()
            && decision.authority_generation == fence.generation)
            || (decision.phase == "aborted" && decision.authority_generation > fence.generation))
        || decision_digest(decision)? != decision.decision_digest
    {
        return Err("NATIVE_AUTHORITY_INVALID_HOST_RECEIPT".into());
    }
    Ok(())
}

/// Caller holds one SQL snapshot (or the applying transaction). A checksum alone
/// is not application evidence: the actual journal, floor and store must agree.
fn applied_host_decision(
    conn: &Connection,
    migration_id: &str,
    expected_decision_digest: &str,
    fence: &NativeFence,
) -> Result<String, String> {
    let invalid = "NATIVE_AUTHORITY_DECISION_NOT_APPLIED";
    if !digest(expected_decision_digest) || migration_id != fence.migration_id {
        return Err(invalid.into());
    }
    let (phase, generation, raw): (String, i64, Option<String>) = conn
        .query_row(
            "SELECT phase,generation,host_decision_json FROM native_authority_journal WHERE migration_id=?1",
            [migration_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    let raw = raw.ok_or(invalid)?;
    let decision = parse_host_decision(&raw)?;
    validate_host_decision(&decision, fence)?;
    let ids = identity(conn)?;
    let current = read_state(conn, &fence.session_id)?.ok_or(invalid)?;
    require_supported_writer(&current)?;
    let active = decision.phase == "host-active";
    if decision.decision_digest != expected_decision_digest
        || ids.source_store_id != decision.source_store_id
        || ids.source_profile_id != decision.source_profile_id
        || phase != if active { "HOST" } else { "ABORTED" }
        || u64::try_from(generation).ok() != Some(decision.authority_generation)
        || current.environment_id != decision.environment_id
        || current.session_id != decision.session_id
        || current.migration_id != decision.migration_id
        || current.generation != decision.authority_generation
        || current.min_writer_protocol != decision.min_writer_protocol
        || current.source_digest.as_ref() != Some(&decision.source_digest)
        || current.host_receipt_id.as_ref() != Some(&decision.receipt_id)
        || if active {
            !matches!(current.phase.as_str(), "HOST" | "CACHE")
        } else {
            current.phase != "NATIVE"
        }
    {
        return Err(invalid.into());
    }
    Ok(raw)
}

impl SessionStore {
    /// Read an existing retained transfer in one SQL snapshot. This is disclosure
    /// only: no idle proof, writer qualification, floor change or decision apply.
    pub(crate) fn authority_retained_snapshot(
        &self,
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        expected: &StoreIdentity,
    ) -> Result<Option<SourceSnapshot>, String> {
        for value in [
            environment_id,
            session_id,
            migration_id,
            &expected.source_store_id,
            &expected.source_profile_id,
        ] {
            identifier(value)?;
        }
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
            .map_err(|error| error.to_string())?;
        if identity(&tx)? != *expected {
            return Err("NATIVE_AUTHORITY_SOURCE_CHANGED".into());
        }
        // Evaluate byte limits and scope in SQL before any snapshot/fence String
        // is materialized. A present partial/corrupt row is never an absent row.
        let bounded: Option<i64> = tx.query_row(
            "SELECT COALESCE(typeof(fence_json)='text' AND typeof(snapshot_json)='text'
              AND length(CAST(fence_json AS BLOB)) BETWEEN 1 AND 16384
              AND length(CAST(snapshot_json AS BLOB)) BETWEEN 1 AND 33554432
              AND environment_id=?2 AND session_id=?3 AND source_store_id=?4 AND source_profile_id=?5
              AND typeof(inventory_digest)='text' AND length(CAST(inventory_digest AS BLOB))=64
              AND typeof(buffers_digest)='text' AND length(CAST(buffers_digest AS BLOB))=64
              AND typeof(source_digest)='text' AND length(CAST(source_digest AS BLOB))=64,0)
             FROM native_authority_journal WHERE migration_id=?1",
            params![migration_id, environment_id, session_id, expected.source_store_id, expected.source_profile_id],
            |row| row.get(0),
        ).optional().map_err(|error| error.to_string())?;
        let retained = match bounded {
            None => None,
            Some(1) => {
                let snapshot = source_snapshot(&tx, migration_id)?;
                if snapshot.fence.environment_id != environment_id
                    || snapshot.fence.session_id != session_id
                    || snapshot.fence.migration_id != migration_id
                    || snapshot.fence.source_store_id != expected.source_store_id
                    || snapshot.fence.source_profile_id != expected.source_profile_id
                {
                    return Err("NATIVE_AUTHORITY_RETAINED_SCOPE_CHANGED".into());
                }
                Some(snapshot)
            }
            _ => return Err("NATIVE_AUTHORITY_RETAINED_UNAVAILABLE".into()),
        };
        tx.commit().map_err(|error| error.to_string())?;
        Ok(retained)
    }

    /// Isolated fixture only; never a production cohort/actor qualification.
    #[cfg(test)]
    pub(crate) fn authority_test_retained_snapshot(
        &self,
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        text: &str,
    ) -> Result<SourceSnapshot, String> {
        self.authority_test_retained_snapshot_at(
            environment_id,
            session_id,
            migration_id,
            text,
            ".",
            false,
        )
    }

    #[cfg(test)]
    pub(crate) fn authority_test_retained_snapshot_at(
        &self,
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        text: &str,
        cwd: &str,
        include_client_state: bool,
    ) -> Result<SourceSnapshot, String> {
        let session: SessionUpsert = serde_json::from_value(json!({
            "id":session_id,"cwd":cwd,"harness":"codex","model":"fixture","modelSettings":{},
            "runtimeMode":"supervised","title":"retained fixture",
            "blocks":[{"id":"user.retained","role":"user","text":text}],
        }))
        .map_err(|error| error.to_string())?;
        {
            let conn = self.lock_conn()?;
            upsert_session_with_git(&conn, &session, crate::fs::GitInfo::default(), None)
                .map_err(|error| error.to_string())?;
            if include_client_state {
                set_session_queue(
                    &conn,
                    session_id,
                    Some(&json!([{
                        "id":"native-client-only", "text":"Native private queued prompt", "attachments":[]
                    }])),
                )?;
                set_composer_draft(
                    &conn,
                    session_id,
                    Some(&json!({
                        "text":"Native private unsent draft", "mcpTags":[], "attachments":[]
                    })),
                )?;
            }
        }
        self.authority_begin_quiesce(environment_id, session_id, migration_id, 0)?;
        let inventory = {
            let conn = self.lock_conn()?;
            WriterInventory::Complete {
                identity: identity(&conn)?,
                protocols: vec![WRITER_PROTOCOL],
                observation_digest: sha(b"isolated retained source fixture qualification only"),
                buffers_digest: buffers_digest(&conn, session_id)?,
            }
        };
        let proof = self.authority_verify_idle(
            environment_id,
            session_id,
            migration_id,
            &crate::harness::HarnessHost::new(),
            inventory,
        )?;
        self.authority_fence_source(proof)
    }

    pub(crate) fn authority_snapshot(&self, migration_id: &str) -> Result<SourceSnapshot, String> {
        source_snapshot(&*(self.lock_conn()?), migration_id)
    }

    pub(crate) fn authority_verify_host_decision(
        &self,
        migration_id: &str,
        raw: &str,
        port: &impl AuthenticatedHostDecisionPort,
    ) -> Result<VerifiedHostDecision, String> {
        let decision = parse_host_decision(raw)?;
        let fence = self.authority_snapshot(migration_id)?.fence;
        validate_host_decision(&decision, &fence)?;
        port.verify_actor_and_challenge(&fence, raw)?;
        Ok(VerifiedHostDecision {
            decision,
            raw: raw.into(),
            fence,
        })
    }

    pub(crate) fn authority_apply_host_decision(
        &self,
        proof: &VerifiedHostDecision,
    ) -> Result<AuthorityState, String> {
        let conn = self.lock_conn()?;
        critical(&conn, |tx| {
            let decision = &proof.decision;
            let retained = source_snapshot(tx, &decision.migration_id)?;
            if retained.fence != proof.fence
                || identity(tx)?.source_store_id != decision.source_store_id
            {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            let current = read_state(tx, &decision.session_id)?.ok_or("NATIVE_AUTHORITY_CAS")?;
            require_supported_writer(&current)?;
            if current.environment_id != decision.environment_id
                || current.migration_id != decision.migration_id
                || current.source_digest.as_ref() != Some(&decision.source_digest)
            {
                return Err("NATIVE_AUTHORITY_CAS".into());
            }
            let phase = if decision.phase == "host-active" {
                "HOST"
            } else {
                "NATIVE"
            };
            if current.generation == decision.authority_generation
                && current.host_receipt_id.as_ref() == Some(&decision.receipt_id)
                && (current.phase == phase || (phase == "HOST" && current.phase == "CACHE"))
            {
                applied_host_decision(
                    tx,
                    &decision.migration_id,
                    &decision.decision_digest,
                    &retained.fence,
                )?;
                return Ok(current);
            }
            if current.phase != "FENCED" || current.generation != decision.source_generation {
                return Err(
                    "NATIVE_AUTHORITY_CAS: authority is already committed or changed".into(),
                );
            }
            tx.execute("UPDATE native_authority_floor SET phase=?1,generation=?2,host_receipt_id=?3,min_writer_protocol=MAX(min_writer_protocol,?6) WHERE environment_id=?4 AND session_id=?5",
                params![phase,decision.authority_generation as i64,decision.receipt_id,decision.environment_id,decision.session_id,decision.min_writer_protocol as i64]).map_err(|error|error.to_string())?;
            tx.execute("UPDATE native_authority_journal SET phase=?1,generation=?2,host_decision_json=?3,updated_at=?4 WHERE migration_id=?5",
                params![if phase=="HOST" {"HOST"} else {"ABORTED"},decision.authority_generation as i64,proof.raw,now_millis(),decision.migration_id]).map_err(|error|error.to_string())?;
            read_state(tx, &decision.session_id)?.ok_or_else(|| "NATIVE_AUTHORITY_CAS".into())
        })
    }

    /// Read durable application evidence only. No IPC endpoint or actor grant is
    /// installed here; the authenticated native channel must own disclosure.
    /// Returning the persisted bytes never applies a submitted decision again.
    pub(crate) fn authority_applied_host_decision(
        &self,
        migration_id: &str,
        expected_decision_digest: &str,
    ) -> Result<String, String> {
        identifier(migration_id)?;
        if !digest(expected_decision_digest) {
            return Err("NATIVE_AUTHORITY_INVALID_HOST_RECEIPT".into());
        }
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
            .map_err(|error| error.to_string())?;
        let retained = source_snapshot(&tx, migration_id)?;
        let raw =
            applied_host_decision(&tx, migration_id, expected_decision_digest, &retained.fence)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(raw)
    }

    pub(crate) fn authority_apply_projection(
        &self,
        proof: &VerifiedHostDecision,
        session: &SessionUpsert,
    ) -> Result<SessionSummary, String> {
        validate_upsert(session)?;
        let decision = &proof.decision;
        if decision.phase != "host-active" || session.id != decision.session_id {
            return Err("NATIVE_AUTHORITY_PROJECTION_SCOPE".into());
        }
        let conn = self.lock_conn()?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current = read_state(&tx, &session.id)?.ok_or("NATIVE_AUTHORITY_CAS")?;
        require_supported_writer(&current)?;
        if !matches!(current.phase.as_str(), "HOST" | "CACHE")
            || current.environment_id != decision.environment_id
            || current.generation != decision.authority_generation
            || current.host_receipt_id.as_ref() != Some(&decision.receipt_id)
            || current.migration_id != decision.migration_id
            || identity(&tx)?.source_store_id != decision.source_store_id
        {
            return Err("NATIVE_AUTHORITY_PROJECTION_SCOPE".into());
        }
        let nonce = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO native_authority_permits(nonce,environment_id,session_id,generation,writer_protocol,purpose) VALUES(?1,?2,?3,?4,?5,'projection')",
            params![nonce,decision.environment_id,session.id,current.generation as i64,WRITER_PROTOCOL as i64]).map_err(|error|error.to_string())?;
        let summary = upsert_session_in_transaction(
            &tx,
            session,
            crate::fs::GitInfo {
                branch: session.branch.clone(),
                repo: None,
            },
            None,
        )
        .map_err(|error| error.to_string())?
        .ok_or("NATIVE_AUTHORITY_PROJECTION_CONFLICT")?;
        tx.execute(
            "DELETE FROM native_authority_permits WHERE nonce=?1",
            [nonce],
        )
        .map_err(|error| error.to_string())?;
        // Cache acknowledgement is not another authority activation point.
        tx.execute("UPDATE native_authority_floor SET phase='CACHE' WHERE environment_id=?1 AND session_id=?2",params![decision.environment_id,session.id]).map_err(|error|error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(summary)
    }
}

#[cfg(test)]
#[path = "authority_tests.rs"]
mod tests;
