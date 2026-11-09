//! Best-effort, process-local comparisons for actual committed Native writes.
//! IDs and hashes are locators, not FULL receipts, durable watermarks or grants.
//! The caller retains owner -> barrier -> SQL -> ledger lock order. Never lock
//! physical Window resources while holding SQL; compare uses an existing guard.

use super::*;
use crate::native_window_lifecycle::{CheckedCheckpointWindow, NativeCheckpointWindow};
use rusqlite::types::ValueRef;
use sha2::{Digest, Sha256};
use std::io::{self, Write};
use std::marker::PhantomData;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_SESSIONS: usize = 512;
const MAX_COLUMNS: usize = 128;
const MAX_ITEMS: i64 = 1_000_000;
const MAX_PROJECTION_ORIGINS: usize = 4096;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

/// Closed, bounded renderer comparison input. Neither Deserialize nor a public
/// constructor can turn these claims into a Native write/commitment handle.
pub(crate) struct NativeProjectionWriteClaim {
    session_id: String,
    model_version: u64,
    input: ProjectionInput,
    acknowledgement: ProjectionAck,
    items: Vec<Value>,
}

enum ProjectionInput {
    Replace {
        session: SessionUpsert,
        expected_updated_at: Option<i64>,
        expected_revision: Option<i64>,
        expect_missing: Option<bool>,
    },
    Delta(incremental::SessionDelta),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectionWire {
    version: u8,
    kind: String,
    qualified: bool,
    full_checkpoint: bool,
    application_through: Value,
    native_commitment_required: bool,
    session_id: String,
    model_version: u64,
    command: String,
    admitted_payload: Value,
    acknowledgement: ProjectionAck,
    items: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectionAck {
    kind: ProjectionKind,
    revision: i64,
    updated_at: i64,
    native_write_id: String,
}
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ProjectionKind {
    Replace,
    Delta,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplaceProjectionPayload {
    session: SessionUpsert,
    expected_updated_at: Option<i64>,
    expected_revision: Option<i64>,
    expect_missing: Option<bool>,
    capture_output_receipt: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeltaProjectionPayload {
    delta: incremental::SessionDelta,
    capture_output_receipt: bool,
}

fn projection_failure() -> String {
    "NATIVE_PROJECTION_WRITE_COMPARISON_UNAVAILABLE".into()
}
fn safe_integer(value: i64) -> bool {
    value >= 0 && value as u64 <= MAX_SAFE
}
fn canonical_write_id(value: &str) -> bool {
    value.len() == 36
        && uuid::Uuid::parse_str(value)
            .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
}
fn closed_fields(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or_else(projection_failure)?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(projection_failure());
    }
    Ok(())
}
fn closed_session(value: &Value) -> Result<(), String> {
    // Current actual SessionUpsert fields. Unknown future input is unavailable
    // here until deliberately supported; ordinary writer deserialization stays
    // unchanged. Opaque model settings/blocks retain their original JSON values.
    closed_fields(
        value,
        &[
            "id",
            "cwd",
            "harness",
            "model",
            "modelSettings",
            "runtimeMode",
            "title",
            "providerSessionId",
            "providerAccountId",
            "blocks",
            "contextUsed",
            "contextWindow",
            "branch",
            "worktreeCwd",
            "workspaceMode",
            "workspaceId",
            "workspaceRevision",
            "worktreeRemoved",
            "linkedWorkItem",
            "automationId",
            "rewindHistory",
            "pendingContextReplay",
            "adoptedDivergence",
            "adoptedBase",
            "createdAt",
            "updatedAt",
        ],
    )
}

impl NativeProjectionWriteClaim {
    /// Bound serialized comparison bytes before JSON allocates its contents.
    /// Individual input locators are validated by the separate Native resolver;
    /// items() never claims eligibility or applied-output conservation.
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        if raw.len() > MAX_BYTES {
            return Err(projection_failure());
        }
        let wire: ProjectionWire = serde_json::from_str(raw).map_err(|_| projection_failure())?;
        if wire.version != 1
            || wire.kind != "session-output-full-candidate-comparison"
            || wire.qualified
            || wire.full_checkpoint
            || !wire.application_through.is_null()
            || !wire.native_commitment_required
            || wire.model_version == 0
            || wire.model_version > MAX_SAFE
            || wire.items.is_empty()
            || wire.items.len() > MAX_PROJECTION_ORIGINS
            || !safe_integer(wire.acknowledgement.updated_at)
            || wire.acknowledgement.revision <= 0
            || !safe_integer(wire.acknowledgement.revision)
            || !canonical_write_id(&wire.acknowledgement.native_write_id)
        {
            return Err(projection_failure());
        }
        validate_id(&wire.session_id, "session").map_err(|_| projection_failure())?;
        let input = match wire.command.as_str() {
            "session_upsert" => {
                closed_session(&wire.admitted_payload["session"])?;
                let payload: ReplaceProjectionPayload =
                    serde_json::from_value(wire.admitted_payload)
                        .map_err(|_| projection_failure())?;
                if !payload.capture_output_receipt
                    || wire.acknowledgement.kind != ProjectionKind::Replace
                    || payload
                        .expected_updated_at
                        .is_some_and(|v| !safe_integer(v))
                    || payload.expected_revision.is_some_and(|v| !safe_integer(v))
                {
                    return Err(projection_failure());
                }
                validate_upsert(&payload.session).map_err(|_| projection_failure())?;
                ProjectionInput::Replace {
                    session: payload.session,
                    expected_updated_at: payload.expected_updated_at,
                    expected_revision: payload.expected_revision,
                    expect_missing: payload.expect_missing,
                }
            }
            "session_apply_delta" => {
                let delta = &wire.admitted_payload["delta"];
                closed_fields(
                    delta,
                    &[
                        "session",
                        "expectedUpdatedAt",
                        "expectedRevision",
                        "length",
                        "changes",
                    ],
                )?;
                closed_session(&delta["session"])?;
                let changes = delta["changes"].as_array().ok_or_else(projection_failure)?;
                for change in changes {
                    closed_fields(change, &["index", "block"])?;
                }
                let payload: DeltaProjectionPayload = serde_json::from_value(wire.admitted_payload)
                    .map_err(|_| projection_failure())?;
                let delta = payload.delta;
                if !payload.capture_output_receipt
                    || wire.acknowledgement.kind != ProjectionKind::Delta
                    || !safe_integer(delta.expected_updated_at)
                    || !safe_integer(delta.expected_revision)
                    || delta.length > MAX_ITEMS as usize
                    || delta.changes.iter().any(|change| {
                        change.index >= delta.length
                            || !change.block.is_object()
                            || change.block.get("id").and_then(Value::as_str).is_none()
                    })
                {
                    return Err(projection_failure());
                }
                validate_upsert(&delta.session).map_err(|_| projection_failure())?;
                ProjectionInput::Delta(delta)
            }
            _ => return Err(projection_failure()),
        };
        let claim = Self {
            session_id: wire.session_id,
            model_version: wire.model_version,
            input,
            acknowledgement: wire.acknowledgement,
            items: wire.items,
        };
        if claim.input().session_id() != claim.session_id || input_digest(&claim.input()).is_none()
        {
            return Err(projection_failure());
        }
        Ok(claim)
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }
    pub(crate) fn model_version(&self) -> u64 {
        self.model_version
    }
    pub(crate) fn items(&self) -> &[Value] {
        &self.items
    }
    fn input(&self) -> WriteInput<'_> {
        match &self.input {
            ProjectionInput::Replace {
                session,
                expected_updated_at,
                expected_revision,
                expect_missing,
            } => WriteInput::Replace {
                session,
                expected_updated_at: *expected_updated_at,
                expected_revision: *expected_revision,
                expect_missing: *expect_missing,
            },
            ProjectionInput::Delta(delta) => WriteInput::Delta { delta },
        }
    }
    fn ack(&self) -> AckStamp {
        AckStamp {
            updated_at: self.acknowledgement.updated_at,
            revision: self.acknowledgement.revision,
        }
    }
}

/// Original typed command input. The transport-only opt-in is deliberately absent.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WriteInput<'a> {
    Replace {
        session: &'a SessionUpsert,
        #[serde(rename = "expectedUpdatedAt")]
        expected_updated_at: Option<i64>,
        #[serde(rename = "expectedRevision")]
        expected_revision: Option<i64>,
        #[serde(rename = "expectMissing")]
        expect_missing: Option<bool>,
    },
    Delta {
        delta: &'a incremental::SessionDelta,
    },
}

impl WriteInput<'_> {
    fn session_id(&self) -> &str {
        match self {
            Self::Replace { session, .. } => &session.id,
            Self::Delta { delta } => &delta.session.id,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AckStamp {
    pub updated_at: i64,
    pub revision: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWriteAck<T> {
    #[serde(flatten)]
    pub ack: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_write_id: Option<String>,
}

#[derive(Default)]
pub(super) struct Ledger {
    entries: HashMap<String, Arc<Receipt>>,
}

pub(super) struct ObservedWrite<T> {
    pub ack: Option<T>,
    pub pending: Option<Pending>,
}
impl<T> ObservedWrite<T> {
    pub(super) fn absent() -> Self {
        Self {
            ack: None,
            pending: None,
        }
    }
}

pub(super) struct Pending(Receipt);

struct Receipt {
    id: String,
    instance: uuid::Uuid,
    connection: usize,
    source_store_id: String,
    source_profile_id: String,
    session: String,
    row: row_identity::SessionRowIdentity,
    owner: Arc<NativeCheckpointWindow>,
    input_digest: [u8; 32],
    ack: AckStamp,
    sql: SqlCommitment,
}

#[derive(PartialEq, Eq)]
struct SqlCommitment {
    digest: [u8; 32],
    transcript_digest: [u8; 32],
    transcript_bytes: usize,
    items: i64,
}

pub(super) fn capture_owner(
    window: &tauri::Window,
    store: &SessionStore,
    enabled: Option<bool>,
) -> Option<Arc<NativeCheckpointWindow>> {
    if enabled != Some(true) {
        return None;
    }
    crate::native_window_lifecycle::capture_checkpoint_resources(
        &window.resources_table(),
        store.native_instance_id(),
    )
    .ok()
    .map(Arc::new)
}

// The optional owner is captured before admission. It is never rediscovered by
// label, nor refreshed after an await/SQL effect. Later comparison rechecks it.
pub(super) fn upsert(
    store: &SessionStore,
    conn: &Connection,
    session: &SessionUpsert,
    git: crate::fs::GitInfo,
    expected_updated_at: Option<i64>,
    expected_revision: Option<i64>,
    expect_missing: Option<bool>,
    owner: Option<Arc<NativeCheckpointWindow>>,
) -> Result<Option<NativeWriteAck<SessionSummary>>, String> {
    let input = WriteInput::Replace {
        session,
        expected_updated_at,
        expected_revision,
        expect_missing,
    };
    let expected = if expect_missing == Some(true) {
        Some(None)
    } else {
        expected_updated_at.map(Some)
    };
    let write = super::upsert_session_with_git_observed(
        conn,
        session,
        git,
        expected,
        expected_revision,
        |tx, ack| {
            prepare_at(
                store,
                tx,
                owner,
                &input,
                AckStamp {
                    updated_at: ack.updated_at,
                    revision: ack.transcript_revision?,
                },
            )
        },
    )
    .map_err(|error| error.to_string());
    finish(store, &session.id, write)
}

pub(super) fn apply_delta(
    store: &SessionStore,
    conn: &Connection,
    delta: &incremental::SessionDelta,
    owner: Option<Arc<NativeCheckpointWindow>>,
) -> Result<Option<NativeWriteAck<incremental::DeltaAck>>, String> {
    let input = WriteInput::Delta { delta };
    let write = incremental::apply_observed(conn, delta, |tx, ack| {
        prepare_at(
            store,
            tx,
            owner,
            &input,
            AckStamp {
                updated_at: ack.updated_at,
                revision: ack.revision,
            },
        )
    });
    finish(store, &delta.session.id, write)
}

fn finish<T>(
    store: &SessionStore,
    session: &str,
    write: Result<ObservedWrite<T>, String>,
) -> Result<Option<NativeWriteAck<T>>, String> {
    match write {
        Ok(ObservedWrite { ack: None, .. }) => Ok(None), // CAS rejected, no write.
        Ok(ObservedWrite {
            ack: Some(ack),
            pending,
        }) => {
            // Caller still owns SQL, so no later write can be overtaken here.
            let id = store
                .output_write_receipts
                .lock()
                .ok()
                .and_then(|mut ledger| {
                    ledger.entries.remove(session);
                    let Pending(receipt) = pending?;
                    if ledger.entries.len() >= MAX_SESSIONS {
                        return None;
                    }
                    let id = receipt.id.clone();
                    ledger.entries.insert(session.to_owned(), Arc::new(receipt));
                    Some(id)
                });
            Ok(Some(NativeWriteAck {
                ack,
                native_write_id: id,
            }))
        }
        Err(error) => {
            // Commit/IO failures are never registered or reconciled as no effect.
            if let Ok(mut ledger) = store.output_write_receipts.lock() {
                ledger.entries.remove(session);
            }
            Err(error)
        }
    }
}

fn prepare_at(
    store: &SessionStore,
    conn: &Connection,
    owner: Option<Arc<NativeCheckpointWindow>>,
    input: &WriteInput<'_>,
    ack: AckStamp,
) -> Option<Pending> {
    let owner = owner?;
    let session = input.session_id();
    if session.is_empty() || session.len() > 512 {
        return None;
    }
    let input_digest = input_digest(input)?;
    let (source_store_id, source_profile_id) = source_identity(conn)?;
    // Check byte length before the existing row identity helper allocates it,
    // including profiles externally corrupted with CHECK constraints disabled.
    let valid_row: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM native_session_row_identity WHERE session_id=?1
         AND typeof(incarnation)='blob' AND length(incarnation)=16)",
            [session],
            |r| r.get(0),
        )
        .ok()?;
    if !valid_row {
        return None;
    }
    let row = store
        .capture_session_row_identity_at(conn, session)
        .ok()??;
    let sql = sql_commitment(conn, session, ack)?;
    Some(Pending(Receipt {
        id: uuid::Uuid::new_v4().to_string(),
        instance: store.native_instance_id(),
        connection: conn as *const Connection as usize,
        source_store_id,
        source_profile_id,
        session: session.to_owned(),
        row,
        owner,
        input_digest,
        ack,
        sql,
    }))
}

/// Incremental bounded serialization of Rust-normalized input; never allocate a
/// second unbounded JSON copy or use renderer key ordering as a commitment.
fn input_digest(input: &WriteInput<'_>) -> Option<[u8; 32]> {
    struct BoundedHash {
        hash: Sha256,
        bytes: usize,
    }
    impl Write for BoundedHash {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.bytes = self
                .bytes
                .checked_add(bytes.len())
                .filter(|n| *n <= MAX_BYTES)
                .ok_or_else(|| io::Error::other("Native comparison input limit"))?;
            self.hash.update(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut sink = BoundedHash {
        hash: Sha256::new(),
        bytes: 0,
    };
    sink.hash.update(b"bycoda-native-write-input-v1\0");
    serde_json::to_writer(&mut sink, input).ok()?;
    Some(sink.hash.finalize().into())
}

fn source_identity(conn: &Connection) -> Option<(String, String)> {
    conn.query_row(
        "SELECT source_store_id,source_profile_id FROM native_authority_identity
        WHERE id=1 AND typeof(source_store_id)='text' AND typeof(source_profile_id)='text'
        AND length(CAST(source_store_id AS BLOB)) BETWEEN 1 AND 512
        AND length(CAST(source_profile_id AS BLOB)) BETWEEN 1 AND 512",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .ok()
}

fn frame(hash: &mut Sha256, tag: u8, bytes: &[u8]) {
    hash.update([tag]);
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
}

/// Same SQL snapshot as the write/compare. Preflight bounds happen before any
/// TEXT materialization. The legacy blocks_json is intentionally excluded: the
/// normalized rows are authoritative. No full compatibility view allocation.
fn sql_commitment(conn: &Connection, session: &str, ack: AckStamp) -> Option<SqlCommitment> {
    let (stamp, revision, items): (i64, i64, i64) = conn
        .query_row(
            "SELECT s.updated_at,b.revision,b.length FROM sessions s JOIN session_block_state b
         ON b.session_id=s.id WHERE s.id=?1",
            [session],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()?;
    if ack
        != (AckStamp {
            updated_at: stamp,
            revision,
        })
        || revision <= 0
        || !(0..=MAX_ITEMS).contains(&items)
    {
        return None;
    }
    let (count, raw_bytes, id_bytes, invalid): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT count(*),COALESCE(sum(length(CAST(block_json AS BLOB))),0),
         COALESCE(sum(length(CAST(block_id AS BLOB))),0),COALESCE(sum(
         typeof(block_json)!='text' OR typeof(block_id)!='text' OR typeof(ordinal)!='integer'
         OR typeof(revision)!='integer' OR revision<1 OR revision>?2),0)
         FROM session_blocks WHERE session_id=?1",
            params![session, revision],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok()?;
    if count != items || invalid != 0 {
        return None;
    }
    let transcript_bytes = usize::try_from(raw_bytes)
        .ok()?
        .checked_add(2)?
        .checked_add(items.saturating_sub(1).max(0) as usize)?;
    let mut budget = transcript_bytes.checked_add(usize::try_from(id_bytes).ok()?)?;
    if budget > MAX_BYTES {
        return None;
    }

    // Include every current metadata column, with type/length framing. Bound
    // schema/name discovery too; corrupt ancillary TEXT cannot escape the cap.
    let mut schema = conn
        .prepare("SELECT name FROM pragma_table_info('sessions') ORDER BY cid LIMIT 129")
        .ok()?;
    let mut rows = schema.query([]).ok()?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next().ok()? {
        let ValueRef::Text(name) = row.get_ref(0).ok()? else {
            return None;
        };
        if name.is_empty()
            || name.len() > 128
            || !name.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'_')
        {
            return None;
        }
        if name != b"blocks_json" {
            columns.push(std::str::from_utf8(name).ok()?.to_owned());
        }
        if columns.len() > MAX_COLUMNS {
            return None;
        }
    }
    drop(rows);
    drop(schema);
    if columns.is_empty() || columns.len() >= MAX_COLUMNS {
        return None;
    }
    budget = budget.checked_add(columns.iter().map(|name| name.len() + 18).sum::<usize>())?;
    let names = columns
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>();
    let size_expr = names.iter().map(|c| format!("CASE typeof({c}) WHEN 'null' THEN 0 WHEN 'integer' THEN 8 WHEN 'real' THEN 8 ELSE length(CAST({c} AS BLOB)) END")).collect::<Vec<_>>().join("+");
    let bytes: i64 = conn
        .query_row(
            &format!("SELECT {size_expr} FROM sessions WHERE id=?1"),
            [session],
            |r| r.get(0),
        )
        .ok()?;
    budget = budget.checked_add(usize::try_from(bytes).ok()?)?;
    if budget > MAX_BYTES {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(b"bycoda-native-write-sql-v1\0");
    let mut select = conn
        .prepare(&format!(
            "SELECT {} FROM sessions WHERE id=?1",
            names.join(",")
        ))
        .ok()?;
    let mut rows = select.query([session]).ok()?;
    let row = rows.next().ok()??;
    for (index, name) in columns.iter().enumerate() {
        frame(&mut hash, b'n', name.as_bytes());
        match row.get_ref(index).ok()? {
            ValueRef::Null => frame(&mut hash, b'0', &[]),
            ValueRef::Integer(value) => frame(&mut hash, b'i', &value.to_le_bytes()),
            ValueRef::Real(value) => frame(&mut hash, b'r', &value.to_bits().to_le_bytes()),
            ValueRef::Text(value) => {
                std::str::from_utf8(value).ok()?;
                frame(&mut hash, b't', value);
            }
            ValueRef::Blob(_) => return None,
        }
    }
    drop(rows);
    drop(select);
    let mut transcript = Sha256::new();
    transcript.update(b"[");
    let mut statement = conn.prepare("SELECT ordinal,block_id,block_json,revision FROM session_blocks WHERE session_id=?1 ORDER BY ordinal").ok()?;
    let mut rows = statement.query([session]).ok()?;
    let mut ordinal = 0_i64;
    while let Some(row) = rows.next().ok()? {
        if row.get::<_, i64>(0).ok()? != ordinal {
            return None;
        }
        let ValueRef::Text(id) = row.get_ref(1).ok()? else {
            return None;
        };
        let ValueRef::Text(raw) = row.get_ref(2).ok()? else {
            return None;
        };
        let block: Value = serde_json::from_slice(raw).ok()?;
        if !block.is_object()
            || block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .as_bytes()
                != id
        {
            return None;
        }
        // Transcript content and exact normalized-row metadata are separate
        // commitments: an unchanged block can legitimately retain an older
        // revision, but later mutation of that revision cannot inherit its ID.
        frame(&mut hash, b'o', &ordinal.to_le_bytes());
        frame(&mut hash, b'd', id);
        frame(&mut hash, b'r', &row.get::<_, i64>(3).ok()?.to_le_bytes());
        if ordinal > 0 {
            transcript.update(b",");
        }
        transcript.update(raw);
        ordinal += 1;
    }
    if ordinal != items {
        return None;
    }
    transcript.update(b"]");
    let transcript_digest: [u8; 32] = transcript.finalize().into();
    frame(&mut hash, b'b', &transcript_digest);
    frame(&mut hash, b'l', &items.to_le_bytes());
    frame(&mut hash, b'v', &revision.to_le_bytes());
    Some(SqlCommitment {
        digest: hash.finalize().into(),
        transcript_digest,
        transcript_bytes,
        items,
    })
}

/// Borrowed comparison only. Cannot escape the actual checked-owner/SQL scope;
/// Root's future FULL join must additionally retain its target checkpoint scope.
#[allow(
    dead_code,
    reason = "Private FULL join integration is a separate source slice"
)]
pub(crate) struct NativeWriteComparison<'scope> {
    receipt: Arc<Receipt>,
    _scope: PhantomData<(
        &'scope SessionStore,
        &'scope Connection,
        &'scope CheckedCheckpointWindow<'scope>,
    )>,
}

#[allow(
    dead_code,
    reason = "Private FULL join integration is a separate source slice"
)]
impl NativeWriteComparison<'_> {
    pub(crate) fn native_write_id(&self) -> &str {
        &self.receipt.id
    }
    pub(crate) fn input_digest(&self) -> [u8; 32] {
        self.receipt.input_digest
    }
    pub(crate) fn sql_digest(&self) -> [u8; 32] {
        self.receipt.sql.digest
    }
    pub(crate) fn transcript_digest(&self) -> [u8; 32] {
        self.receipt.sql.transcript_digest
    }
    pub(crate) fn ack(&self) -> AckStamp {
        self.receipt.ack
    }
}

/// Owned only after the actual Store-owned FULL transaction commits and its
/// durability setting is restored. This matches a write, not Native input
/// application/conservation, actor qualification or a public authority grant.
pub(crate) struct NativeProjectionWriteComparison {
    receipt: Arc<Receipt>,
    model_version: u64,
}

impl NativeProjectionWriteComparison {
    pub(crate) fn native_write_id(&self) -> &str {
        &self.receipt.id
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.receipt.session
    }
    /// Renderer comparison label only; it is not a Native model incarnation.
    pub(crate) fn model_version(&self) -> u64 {
        self.model_version
    }
    pub(crate) fn input_digest(&self) -> [u8; 32] {
        self.receipt.input_digest
    }
    pub(crate) fn sql_digest(&self) -> [u8; 32] {
        self.receipt.sql.digest
    }
    pub(crate) fn transcript_digest(&self) -> [u8; 32] {
        self.receipt.sql.transcript_digest
    }
    pub(crate) fn ack(&self) -> AckStamp {
        self.receipt.ack
    }
    pub(crate) fn source_store_id(&self) -> &str {
        &self.receipt.source_store_id
    }
    pub(crate) fn source_profile_id(&self) -> &str {
        &self.receipt.source_profile_id
    }
    pub(crate) fn native_instance_id(&self) -> uuid::Uuid {
        self.receipt.instance
    }
}

impl SessionStore {
    /// No arbitrary connection or caller-declared commit callback: only the
    /// authority module's actual Store-owned FULL transaction can produce the
    /// checked SQL scope. The supplied consumer may store the nonce receipt and
    /// resolve every Native input in that same transaction; its failure rolls
    /// back the whole operation. No owned comparison escapes before commit.
    pub(crate) fn commit_projection_write_comparison<T>(
        &self,
        owner: &CheckedCheckpointWindow<'_>,
        claim: &NativeProjectionWriteClaim,
        consume: impl FnOnce(
            &authority::CheckedStoreTransaction<'_>,
            &NativeWriteComparison<'_>,
        ) -> Result<T, String>,
    ) -> Result<(T, NativeProjectionWriteComparison), String> {
        let (value, receipt) = authority::with_full_projection_transaction(self, |tx| {
            if !tx.is_for(self)
                || tx.native_instance_id() != self.native_instance_id()
                || !owner.matches_store_instance(tx.native_instance_id())
            {
                return Err(projection_failure());
            }
            let input = claim.input();
            let comparison = self
                .compare_output_write_at(
                    tx.connection(),
                    owner,
                    &input,
                    &claim.acknowledgement.native_write_id,
                    claim.ack(),
                )
                .ok_or_else(projection_failure)?;
            let value = consume(&tx, &comparison)?;
            // The nonce/input consumer shares this transaction, not permission
            // to change the compared target before commit. Revalidate after
            // every callback effect and keep the exact original ledger entry.
            let confirmed = self
                .compare_output_write_at(
                    tx.connection(),
                    owner,
                    &input,
                    &claim.acknowledgement.native_write_id,
                    claim.ack(),
                )
                .ok_or_else(projection_failure)?;
            if !Arc::ptr_eq(&confirmed.receipt, &comparison.receipt) {
                return Err(projection_failure());
            }
            Ok((value, confirmed.receipt.clone()))
        })?;
        Ok((
            value,
            NativeProjectionWriteComparison {
                receipt,
                model_version: claim.model_version,
            },
        ))
    }

    #[allow(
        dead_code,
        reason = "Private FULL join integration is a separate source slice"
    )]
    pub(crate) fn compare_output_write_at<'scope>(
        &'scope self,
        conn: &'scope Connection,
        owner: &'scope CheckedCheckpointWindow<'scope>,
        input: &WriteInput<'_>,
        native_write_id: &str,
        ack: AckStamp,
    ) -> Option<NativeWriteComparison<'scope>> {
        // A sequence of autocommit SELECTs is not a single SQL snapshot. The
        // actual FULL caller owns this transaction and target checkpoint lane.
        if conn.is_autocommit() {
            return None;
        }
        let id = uuid::Uuid::parse_str(native_write_id).ok()?;
        if id.get_version_num() != 4 || id.to_string() != native_write_id {
            return None;
        }
        let receipt = self
            .output_write_receipts
            .lock()
            .ok()?
            .entries
            .get(input.session_id())?
            .clone();
        if receipt.id != native_write_id
            || receipt.instance != self.native_instance_id()
            || receipt.connection != conn as *const Connection as usize
            || receipt.session != input.session_id()
            || receipt.ack != ack
            || !owner.matches_store_instance(self.native_instance_id())
            || !owner.matches(&receipt.owner)
            || receipt.input_digest != input_digest(input)?
            || !self
                .session_row_identity_current_at(conn, &receipt.row, &receipt.session)
                .ok()?
            || source_identity(conn)?
                != (
                    receipt.source_store_id.clone(),
                    receipt.source_profile_id.clone(),
                )
            || sql_commitment(conn, &receipt.session, ack)? != receipt.sql
        {
            return None;
        }
        Some(NativeWriteComparison {
            receipt,
            _scope: PhantomData,
        })
    }
}

#[cfg(test)]
#[path = "write_receipts_tests.rs"]
mod tests;
