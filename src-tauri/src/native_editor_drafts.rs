//! Durable future editor captures, not a disk-save proof or buffer-fence recovery.
//! Physical owners come only from native Window resources. All receipts remain
//! unqualified; reported saves retain their only recovery copy and byte charge.
use crate::native_window_lifecycle::NativeBufferOwner;
use crate::session_store::SessionStore;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE: u64 = 9_007_199_254_740_991;
const MAX_TEXT: usize = 2 * 1024 * 1024;
const MAX_DOCUMENT: usize = 4 * 1024 * 1024;
const MAX_PROFILE: i64 = 64 * 1024 * 1024;
const MAX_RECORDS: i64 = 1024;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DraftEol {
    Lf,
    Crlf,
    Cr,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutDraft {
    pub owner_epoch: String,
    pub document_id: String,
    pub path: String,
    pub text: String,
    pub eol: DraftEol,
    pub disk_baseline: String,
    pub revision: u64,
    pub expected_revision: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftPayload {
    pub document_id: String,
    pub path: String,
    pub text: String,
    pub eol: DraftEol,
    pub disk_baseline: String,
    pub revision: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftDocument {
    pub owner_epoch: String,
    pub document_id: String,
}
/// A locator/CAS expectation from inventory, never an owner grant.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftRecoverySource {
    pub owner_id: String,
    pub document_id: String,
    pub revision: u64,
    pub payload_digest: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRecoveryDraft {
    pub owner_epoch: String,
    pub source: DraftRecoverySource,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCoveredDraft {
    pub owner_epoch: String,
    pub document_id: String,
    pub revision: u64,
    pub payload_digest: String,
    pub saved_text_digest: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftCursor {
    pub owner_id: String,
    pub document_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInventoryRequest {
    pub after: Option<DraftCursor>,
    pub limit: u32,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftMetadata {
    pub owner_id: String,
    pub store_instance: String,
    pub window_incarnation: String,
    pub window_label: String,
    pub document_id: String,
    pub path: String,
    pub revision: u64,
    pub payload_digest: String,
    pub text_digest: String,
    pub serialized_text_digest: String,
    pub baseline_digest: String,
    pub retained_bytes: i64,
    pub state: String,
    pub save_ack_id: Option<String>,
    pub updated_at: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftReceipt {
    pub version: u8,
    pub qualified: bool,
    pub record: DraftMetadata,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub metadata: DraftMetadata,
    pub payload: DraftPayload,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRead {
    pub version: u8,
    pub qualified: bool,
    pub record: Option<DraftRecord>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecoveryRead {
    pub version: u8,
    pub qualified: bool,
    pub record: DraftRecord,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftInventory {
    pub version: u8,
    pub qualified: bool,
    pub records: Vec<DraftMetadata>,
    pub next: Option<DraftCursor>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftOpen {
    pub version: u8,
    pub qualified: bool,
    pub owner_epoch: String,
}
fn failure(code: &str) -> String {
    format!("NATIVE_EDITOR_DRAFT_{code}")
}
fn sha(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn revision(value: u64) -> bool {
    value > 0 && value <= MAX_SAFE
}
fn path(value: &str) -> bool {
    value.len() <= 4096 && !value.contains('\0') && std::path::Path::new(value).is_absolute()
}
fn validate_payload(payload: &DraftPayload) -> Result<(), String> {
    if !id(&payload.document_id)
        || !path(&payload.path)
        || !revision(payload.revision)
        || payload.text.len() > MAX_TEXT
        || payload.disk_baseline.len() > MAX_TEXT
        || payload.text.contains('\r')
    {
        return Err(failure("INVALID_CAPTURE"));
    }
    Ok(())
}
fn serialized_text(payload: &DraftPayload) -> String {
    match payload.eol {
        DraftEol::Lf => payload.text.clone(),
        DraftEol::Crlf => payload.text.replace('\n', "\r\n"),
        DraftEol::Cr => payload.text.replace('\n', "\r"),
    }
}
fn receipt(record: DraftMetadata) -> DraftReceipt {
    DraftReceipt {
        version: 1,
        qualified: false,
        record,
    }
}
fn check_owner(store: &SessionStore, owner: &NativeBufferOwner) -> Result<(), String> {
    if owner.store_instance() != store.native_instance_id() {
        return Err(failure("OWNER_UNAVAILABLE"));
    }
    Ok(())
}
fn check_epoch(owner: &NativeBufferOwner, hint: &str) -> Result<(), String> {
    if !digest(hint) || hint != owner.key() {
        return Err(failure("OWNER_CHANGED"));
    }
    Ok(())
}

pub(crate) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_editor_drafts (
      owner_id TEXT NOT NULL, document_id TEXT NOT NULL, store_instance TEXT NOT NULL,
      window_incarnation TEXT NOT NULL, window_label TEXT NOT NULL, path TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, text_digest TEXT NOT NULL,
      serialized_text_digest TEXT NOT NULL, baseline_digest TEXT NOT NULL,
      retained_bytes INTEGER NOT NULL CHECK(retained_bytes BETWEEN 1 AND 4194304),
      state TEXT NOT NULL CHECK(state IN ('retained','save-reported')),
      save_ack_id TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_id,document_id));",
    )
}

const COLUMNS: &str = "owner_id,store_instance,window_incarnation,window_label,document_id,path,revision,payload_digest,text_digest,serialized_text_digest,baseline_digest,retained_bytes,state,save_ack_id,updated_at";
fn metadata(row: &rusqlite::Row<'_>) -> rusqlite::Result<DraftMetadata> {
    Ok(DraftMetadata {
        owner_id: row.get(0)?,
        store_instance: row.get(1)?,
        window_incarnation: row.get(2)?,
        window_label: row.get(3)?,
        document_id: row.get(4)?,
        path: row.get(5)?,
        revision: u64::try_from(row.get::<_, i64>(6)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        payload_digest: row.get(7)?,
        text_digest: row.get(8)?,
        serialized_text_digest: row.get(9)?,
        baseline_digest: row.get(10)?,
        retained_bytes: row.get(11)?,
        state: row.get(12)?,
        save_ack_id: row.get(13)?,
        updated_at: row.get(14)?,
    })
}
// SQL bounds every returned String, including corrupt metadata, before Rust allocation.
const BOUNDED: &str = "typeof(owner_id)='text' AND length(CAST(owner_id AS BLOB))=64
 AND typeof(document_id)='text' AND length(CAST(document_id AS BLOB)) BETWEEN 1 AND 512
 AND typeof(store_instance)='text' AND length(CAST(store_instance AS BLOB))=36
 AND typeof(window_incarnation)='text' AND length(CAST(window_incarnation AS BLOB))=36
 AND typeof(window_label)='text' AND length(CAST(window_label AS BLOB)) BETWEEN 1 AND 512
 AND typeof(path)='text' AND length(CAST(path AS BLOB)) BETWEEN 1 AND 4096
 AND typeof(payload_json)='text' AND length(CAST(payload_json AS BLOB)) BETWEEN 1 AND 4194304
 AND typeof(payload_digest)='text' AND length(CAST(payload_digest AS BLOB))=64
 AND typeof(text_digest)='text' AND length(CAST(text_digest AS BLOB))=64
 AND typeof(serialized_text_digest)='text' AND length(CAST(serialized_text_digest AS BLOB))=64
 AND typeof(baseline_digest)='text' AND length(CAST(baseline_digest AS BLOB))=64
 AND revision BETWEEN 1 AND 9007199254740991 AND retained_bytes BETWEEN 1 AND 4194304
 AND ((state='retained' AND save_ack_id IS NULL) OR (state='save-reported' AND typeof(save_ack_id)='text' AND length(CAST(save_ack_id AS BLOB))=36))";
fn validate_metadata(record: &DraftMetadata) -> Result<(), String> {
    let canonical_uuid = |value: &str| {
        uuid::Uuid::parse_str(value)
            .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
    };
    if !canonical_uuid(&record.store_instance)
        || !canonical_uuid(&record.window_incarnation)
        || record.owner_id
            != sha(format!("{}:{}", record.store_instance, record.window_incarnation).as_bytes())
        || !id(&record.document_id)
        || !path(&record.path)
        || !revision(record.revision)
        || record.window_label.is_empty()
        || record.window_label.len() > 512
        || record.window_label.contains('\0')
        || ![
            &record.payload_digest,
            &record.text_digest,
            &record.serialized_text_digest,
            &record.baseline_digest,
        ]
        .into_iter()
        .all(|value| digest(value))
        || record.retained_bytes < 1
        || record.retained_bytes > MAX_DOCUMENT as i64
        || !matches!(
            (record.state.as_str(), record.save_ack_id.as_deref()),
            ("retained", None)
        ) && !(record.state == "save-reported"
            && record.save_ack_id.as_deref().is_some_and(canonical_uuid))
    {
        return Err(failure("CORRUPT"));
    }
    Ok(())
}
fn read_record(
    conn: &Connection,
    owner: &str,
    document: &str,
) -> Result<Option<(DraftRecord, String)>, String> {
    let bounded: Option<bool> = conn.query_row(&format!("SELECT COALESCE({BOUNDED},0) FROM native_editor_drafts WHERE owner_id=?1 AND document_id=?2"), params![owner,document], |row| row.get(0)).optional().map_err(|_| failure("UNAVAILABLE"))?;
    match bounded {
        None => return Ok(None),
        Some(false) => return Err(failure("CORRUPT")),
        Some(true) => {}
    }
    let (metadata, raw) = conn.query_row(&format!("SELECT {COLUMNS},payload_json FROM native_editor_drafts WHERE owner_id=?1 AND document_id=?2"), params![owner,document], |row| Ok((metadata(row)?,row.get::<_,String>(15)?))).map_err(|_| failure("UNAVAILABLE"))?;
    let payload: DraftPayload = serde_json::from_str(&raw).map_err(|_| failure("CORRUPT"))?;
    validate_metadata(&metadata)?;
    validate_payload(&payload)?;
    if metadata.document_id != payload.document_id
        || metadata.path != payload.path
        || metadata.revision != payload.revision
        || sha(raw.as_bytes()) != metadata.payload_digest
        || sha(payload.text.as_bytes()) != metadata.text_digest
        || sha(payload.disk_baseline.as_bytes()) != metadata.baseline_digest
        || sha(serialized_text(&payload).as_bytes()) != metadata.serialized_text_digest
        || metadata.retained_bytes
            != (raw.len()
                + payload.document_id.len()
                + payload.path.len()
                + metadata.window_label.len()
                + 512) as i64
    {
        return Err(failure("CORRUPT"));
    }
    Ok(Some((DraftRecord { metadata, payload }, raw)))
}

fn put(
    store: &SessionStore,
    owner: &NativeBufferOwner,
    input: PutDraft,
) -> Result<DraftReceipt, String> {
    check_owner(store, owner)?;
    check_epoch(owner, &input.owner_epoch)?;
    if input
        .expected_revision
        .is_some_and(|value| !revision(value))
    {
        return Err(failure("INVALID_REVISION"));
    }
    let payload = DraftPayload {
        document_id: input.document_id,
        path: input.path,
        text: input.text,
        eol: input.eol,
        disk_baseline: input.disk_baseline,
        revision: input.revision,
    };
    validate_payload(&payload)?;
    let raw = serde_json::to_string(&payload).map_err(|_| failure("INVALID_CAPTURE"))?;
    // Includes all variable metadata and a conservative fixed metadata allowance.
    let bytes = raw
        .len()
        .checked_add(payload.document_id.len() + payload.path.len() + owner.label().len() + 512)
        .ok_or_else(|| failure("LIMIT"))?;
    if bytes > MAX_DOCUMENT {
        return Err(failure("DOCUMENT_LIMIT"));
    }
    let conn = store.lock_conn()?;
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
        .map_err(|_| failure("UNAVAILABLE"))?;
    let owner_id = owner.key();
    let previous = read_record(&tx, &owner_id, &payload.document_id)?;
    if let Some((previous, previous_raw)) = previous.as_ref() {
        if previous.metadata.revision == payload.revision {
            if previous_raw != &raw {
                return Err(failure("REVISION_CONFLICT"));
            }
            let saved = receipt(previous.metadata.clone());
            tx.commit().map_err(|_| failure("UNAVAILABLE"))?;
            return Ok(saved);
        }
        if payload.revision <= previous.metadata.revision
            || input.expected_revision != Some(previous.metadata.revision)
        {
            return Err(failure("REVISION_CONFLICT"));
        }
    } else if input.expected_revision.is_some() {
        return Err(failure("REVISION_CONFLICT"));
    }
    let (count,total,valid): (i64,i64,bool) = tx.query_row(&format!("SELECT COUNT(*),COALESCE(SUM(retained_bytes),0),COALESCE(MIN(CASE WHEN {BOUNDED} AND retained_bytes=length(CAST(payload_json AS BLOB))+length(CAST(document_id AS BLOB))+length(CAST(path AS BLOB))+length(CAST(window_label AS BLOB))+512 THEN 1 ELSE 0 END),1) FROM native_editor_drafts"), [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|_| failure("UNAVAILABLE"))?;
    if !valid || count > MAX_RECORDS || total > MAX_PROFILE {
        return Err(failure("CORRUPT"));
    }
    if previous.is_none() && count >= MAX_RECORDS {
        return Err(failure("PROFILE_LIMIT"));
    }
    let old_bytes = previous
        .as_ref()
        .map_or(0, |(record, _)| record.metadata.retained_bytes);
    if total < old_bytes
        || total
            .checked_sub(old_bytes)
            .and_then(|value| value.checked_add(bytes as i64))
            .is_none_or(|value| value > MAX_PROFILE)
    {
        return Err(failure("PROFILE_LIMIT"));
    }
    let record = DraftMetadata {
        owner_id,
        store_instance: owner.store_instance().to_string(),
        window_incarnation: owner.incarnation().to_string(),
        window_label: owner.label().into(),
        document_id: payload.document_id.clone(),
        path: payload.path.clone(),
        revision: payload.revision,
        payload_digest: sha(raw.as_bytes()),
        text_digest: sha(payload.text.as_bytes()),
        serialized_text_digest: sha(serialized_text(&payload).as_bytes()),
        baseline_digest: sha(payload.disk_baseline.as_bytes()),
        retained_bytes: bytes as i64,
        state: "retained".into(),
        save_ack_id: None,
        updated_at: now_millis(),
    };
    tx.execute("INSERT INTO native_editor_drafts(owner_id,document_id,store_instance,window_incarnation,window_label,path,revision,payload_json,payload_digest,text_digest,serialized_text_digest,baseline_digest,retained_bytes,state,save_ack_id,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'retained',NULL,?14)
      ON CONFLICT(owner_id,document_id) DO UPDATE SET path=excluded.path,revision=excluded.revision,payload_json=excluded.payload_json,payload_digest=excluded.payload_digest,text_digest=excluded.text_digest,serialized_text_digest=excluded.serialized_text_digest,baseline_digest=excluded.baseline_digest,retained_bytes=excluded.retained_bytes,state='retained',save_ack_id=NULL,updated_at=excluded.updated_at", params![record.owner_id,record.document_id,record.store_instance,record.window_incarnation,record.window_label,record.path,record.revision as i64,raw,record.payload_digest,record.text_digest,record.serialized_text_digest,record.baseline_digest,record.retained_bytes,record.updated_at]).map_err(|_| failure("UNAVAILABLE"))?;
    tx.commit().map_err(|_| failure("UNAVAILABLE"))?;
    Ok(receipt(record))
}
fn read_current(
    store: &SessionStore,
    owner: &NativeBufferOwner,
    input: DraftDocument,
) -> Result<DraftRead, String> {
    check_owner(store, owner)?;
    check_epoch(owner, &input.owner_epoch)?;
    if !id(&input.document_id) {
        return Err(failure("INVALID_DOCUMENT"));
    }
    let conn = store.lock_conn()?;
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
        .map_err(|_| failure("UNAVAILABLE"))?;
    let record = read_record(&tx, &owner.key(), &input.document_id)?.map(|(record, _)| record);
    tx.commit().map_err(|_| failure("UNAVAILABLE"))?;
    Ok(DraftRead {
        version: 1,
        qualified: false,
        record,
    })
}
/// Disclosure in the actual current native profile only. The source is kept
/// unchanged, including active old owners and reported-save recovery copies.
/// Restoring into the current owner requires a separate full `put` CAS.
fn read_recovery(
    store: &SessionStore,
    owner: &NativeBufferOwner,
    input: ReadRecoveryDraft,
) -> Result<DraftRecoveryRead, String> {
    check_owner(store, owner)?;
    check_epoch(owner, &input.owner_epoch)?;
    let source = input.source;
    if !digest(&source.owner_id)
        || !id(&source.document_id)
        || !revision(source.revision)
        || !digest(&source.payload_digest)
    {
        return Err(failure("INVALID_RECOVERY_SOURCE"));
    }
    let conn = store.lock_conn()?;
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
        .map_err(|_| failure("UNAVAILABLE"))?;
    // Establish one snapshot and reject changed/missing references before
    // allocating the bounded payload; never substitute an absent/clean proof.
    let matches: Option<bool> = tx.query_row(
        "SELECT revision=?3 AND payload_digest=?4 FROM native_editor_drafts WHERE owner_id=?1 AND document_id=?2",
        params![source.owner_id,source.document_id,source.revision as i64,source.payload_digest],
        |row|row.get(0),
    ).optional().map_err(|_| failure("UNAVAILABLE"))?;
    if matches != Some(true) {
        return Err(failure("REVISION_CONFLICT"));
    }
    let (record, _) = read_record(&tx, &source.owner_id, &source.document_id)?
        .ok_or_else(|| failure("REVISION_CONFLICT"))?;
    if record.metadata.revision != source.revision
        || record.metadata.payload_digest != source.payload_digest
    {
        return Err(failure("REVISION_CONFLICT"));
    }
    tx.commit().map_err(|_| failure("UNAVAILABLE"))?;
    Ok(DraftRecoveryRead {
        version: 1,
        qualified: false,
        record,
    })
}

fn clear_saved(
    store: &SessionStore,
    owner: &NativeBufferOwner,
    input: SaveCoveredDraft,
) -> Result<DraftReceipt, String> {
    check_owner(store, owner)?;
    check_epoch(owner, &input.owner_epoch)?;
    if !id(&input.document_id)
        || !revision(input.revision)
        || !digest(&input.payload_digest)
        || !digest(&input.saved_text_digest)
    {
        return Err(failure("INVALID_SAVE_REPORT"));
    }
    let conn = store.lock_conn()?;
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
        .map_err(|_| failure("UNAVAILABLE"))?;
    let (mut record, _) = read_record(&tx, &owner.key(), &input.document_id)?
        .ok_or_else(|| failure("REVISION_CONFLICT"))?;
    if record.metadata.revision != input.revision
        || record.metadata.payload_digest != input.payload_digest
        || record.metadata.serialized_text_digest != input.saved_text_digest
    {
        return Err(failure("REVISION_CONFLICT"));
    }
    if record.metadata.state == "retained" {
        let ack = uuid::Uuid::new_v4().to_string();
        let changed = tx.execute("UPDATE native_editor_drafts SET state='save-reported',save_ack_id=?1 WHERE owner_id=?2 AND document_id=?3 AND revision=?4 AND payload_digest=?5 AND state='retained'",params![ack,record.metadata.owner_id,input.document_id,input.revision as i64,input.payload_digest]).map_err(|_| failure("UNAVAILABLE"))?;
        if changed != 1 {
            return Err(failure("REVISION_CONFLICT"));
        }
        record.metadata.state = "save-reported".into();
        record.metadata.save_ack_id = Some(ack);
    }
    tx.commit().map_err(|_| failure("UNAVAILABLE"))?;
    Ok(receipt(record.metadata))
}
fn inventory(
    store: &SessionStore,
    request: DraftInventoryRequest,
) -> Result<DraftInventory, String> {
    if !(1..=100).contains(&request.limit)
        || request
            .after
            .as_ref()
            .is_some_and(|cursor| !digest(&cursor.owner_id) || !id(&cursor.document_id))
    {
        return Err(failure("INVALID_INVENTORY"));
    }
    let conn = store.lock_conn()?;
    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Deferred)
        .map_err(|_| failure("UNAVAILABLE"))?;
    let after = request.after.unwrap_or(DraftCursor {
        owner_id: String::new(),
        document_id: String::new(),
    });
    let keys = {
        let mut statement = tx.prepare("SELECT CASE WHEN typeof(owner_id)='text' AND length(CAST(owner_id AS BLOB))=64 THEN owner_id END,CASE WHEN typeof(document_id)='text' AND length(CAST(document_id AS BLOB)) BETWEEN 1 AND 512 THEN document_id END FROM native_editor_drafts WHERE (owner_id,document_id)>(?1,?2) ORDER BY owner_id,document_id LIMIT ?3").map_err(|_| failure("UNAVAILABLE"))?;
        let rows = statement
            .query_map(
                params![after.owner_id, after.document_id, request.limit + 1],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|_| failure("UNAVAILABLE"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| failure("UNAVAILABLE"))?
    };
    let mut records = Vec::new();
    for (owner, document) in keys.iter().take(request.limit as usize) {
        // Only metadata is returned; content for foreign owners is not exposed.
        let bounded: bool = tx.query_row(&format!("SELECT COALESCE({BOUNDED} AND retained_bytes=length(CAST(payload_json AS BLOB))+length(CAST(document_id AS BLOB))+length(CAST(path AS BLOB))+length(CAST(window_label AS BLOB))+512,0) FROM native_editor_drafts WHERE owner_id=?1 AND document_id=?2"),params![owner,document],|row|row.get(0)).map_err(|_| failure("UNAVAILABLE"))?;
        if !bounded {
            return Err(failure("CORRUPT"));
        }
        let record = tx.query_row(&format!("SELECT {COLUMNS} FROM native_editor_drafts WHERE owner_id=?1 AND document_id=?2"),params![owner,document],metadata).map_err(|_| failure("UNAVAILABLE"))?;
        validate_metadata(&record)?;
        records.push(record);
    }
    let next = if keys.len() > request.limit as usize {
        records.last().map(|record| DraftCursor {
            owner_id: record.owner_id.clone(),
            document_id: record.document_id.clone(),
        })
    } else {
        None
    };
    tx.commit().map_err(|_| failure("UNAVAILABLE"))?;
    Ok(DraftInventory {
        version: 1,
        qualified: false,
        records,
        next,
    })
}

fn open_current(store: &SessionStore, owner: &NativeBufferOwner) -> Result<DraftOpen, String> {
    check_owner(store, owner)?;
    Ok(DraftOpen {
        version: 1,
        qualified: false,
        owner_epoch: owner.key(),
    })
}

#[tauri::command(async)]
pub fn native_editor_draft_open(
    window: tauri::Window,
    store: tauri::State<'_, SessionStore>,
) -> Result<DraftOpen, String> {
    crate::native_window_lifecycle::editor_buffers(&window, &store, |owner| {
        open_current(&store, owner)
    })
}

#[tauri::command(async)]
pub fn native_editor_draft_put(
    window: tauri::Window,
    store: tauri::State<'_, SessionStore>,
    capture: PutDraft,
) -> Result<DraftReceipt, String> {
    crate::native_window_lifecycle::editor_buffers(&window, &store, |owner| {
        put(&store, owner, capture)
    })
}
#[tauri::command(async)]
pub fn native_editor_draft_read_current(
    window: tauri::Window,
    store: tauri::State<'_, SessionStore>,
    document: DraftDocument,
) -> Result<DraftRead, String> {
    crate::native_window_lifecycle::editor_buffers(&window, &store, |owner| {
        read_current(&store, owner, document)
    })
}
#[tauri::command(async)]
pub fn native_editor_draft_read_recovery(
    window: tauri::Window,
    store: tauri::State<'_, SessionStore>,
    request: ReadRecoveryDraft,
) -> Result<DraftRecoveryRead, String> {
    crate::native_window_lifecycle::editor_buffers(&window, &store, |owner| {
        read_recovery(&store, owner, request)
    })
}
#[tauri::command(async)]
pub fn native_editor_draft_clear_saved(
    window: tauri::Window,
    store: tauri::State<'_, SessionStore>,
    saved: SaveCoveredDraft,
) -> Result<DraftReceipt, String> {
    crate::native_window_lifecycle::editor_buffers(&window, &store, |owner| {
        clear_saved(&store, owner, saved)
    })
}
#[tauri::command(async)]
pub fn native_editor_draft_inventory(
    store: tauri::State<'_, SessionStore>,
    request: DraftInventoryRequest,
) -> Result<DraftInventory, String> {
    inventory(&store, request)
}

#[cfg(test)]
#[path = "native_editor_drafts_tests.rs"]
mod tests;
