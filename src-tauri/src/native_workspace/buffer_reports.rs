//! Compatible retained path/dirty reports. There is no editor plaintext here.
//! Retained guards stay in the original table so older binaries still see them.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE: i64 = 9_007_199_254_740_991;
const MAX_DISCLOSURE: i64 = 1024 * 1024;

type MetadataRow = (
    Option<String>,
    String,
    Option<String>,
    i64,
    i64,
    Option<String>,
    bool,
    bool,
    bool,
);

pub(super) fn install_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_workspace_buffer_clock(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 9007199254740991));
         INSERT OR IGNORE INTO native_workspace_buffer_clock VALUES(1,0);
         CREATE TABLE IF NOT EXISTS native_workspace_buffer_identity(
           owner_id TEXT PRIMARY KEY,kind TEXT NOT NULL,label TEXT,store_instance TEXT,incarnation TEXT,current_version INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS native_workspace_buffer_bodies(id INTEGER PRIMARY KEY,snapshot_json TEXT NOT NULL UNIQUE COLLATE BINARY);
         CREATE TABLE IF NOT EXISTS native_workspace_buffer_history(
           version INTEGER PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,label TEXT,store_instance TEXT,incarnation TEXT,
           body_id INTEGER NOT NULL REFERENCES native_workspace_buffer_bodies(id),updated_at INTEGER NOT NULL,confirmed INTEGER NOT NULL,report_nonce TEXT);
         CREATE TABLE IF NOT EXISTS native_workspace_buffer_guard_groups(owner_id TEXT PRIMARY KEY,original_owner_id TEXT NOT NULL,body_id INTEGER NOT NULL,UNIQUE(original_owner_id,body_id));
         CREATE TABLE IF NOT EXISTS native_workspace_buffer_holds(version INTEGER PRIMARY KEY,owner_id TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS native_workspace_buffer_write_permits(owner_id TEXT PRIMARY KEY,nonce TEXT NOT NULL);",
    )?;
    // Add provenance for existing rows without changing any retained bytes.
    let base: i64 = conn.query_row(
        "SELECT value FROM native_workspace_buffer_clock WHERE id=1",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO native_workspace_buffer_identity(owner_id,kind,current_version)
         SELECT b.owner_id,'legacy',?1+ROW_NUMBER() OVER(ORDER BY b.owner_id)
         FROM native_workspace_buffers b LEFT JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id WHERE i.owner_id IS NULL",
        [base],
    )?;
    conn.execute_batch(
        "UPDATE native_workspace_buffer_clock SET value=MAX(value,COALESCE((SELECT MAX(current_version) FROM native_workspace_buffer_identity),0)) WHERE id=1;
         INSERT OR IGNORE INTO native_workspace_buffer_bodies(snapshot_json) SELECT snapshot_json FROM native_workspace_buffers;
         INSERT OR IGNORE INTO native_workspace_buffer_history
         SELECT i.current_version,b.owner_id,i.kind,i.label,i.store_instance,i.incarnation,p.id,b.updated_at,b.confirmed,b.report_nonce
         FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id JOIN native_workspace_buffer_bodies p ON p.snapshot_json=b.snapshot_json WHERE i.kind!='retained';",
    )?;

    let changed = "OLD.owner_id IS NOT NEW.owner_id OR OLD.snapshot_json IS NOT NEW.snapshot_json OR OLD.updated_at IS NOT NEW.updated_at OR OLD.report_nonce IS NOT NEW.report_nonce";
    let trusted = "EXISTS(SELECT 1 FROM native_workspace_buffer_write_permits p JOIN native_workspace_buffer_identity i ON i.owner_id=p.owner_id WHERE p.owner_id=NEW.owner_id AND p.nonce=NEW.report_nonce AND i.kind='physical')";
    let hold_old = |owner: &str, snapshot: &str, timestamp: &str, nonce: &str| {
        format!(
        "INSERT INTO native_workspace_buffer_guard_groups(owner_id,original_owner_id,body_id)
           SELECT 'retained:v2:'||lower(hex(randomblob(16))),i.owner_id,h.body_id FROM native_workspace_buffer_identity i JOIN native_workspace_buffer_history h ON h.version=i.current_version WHERE i.owner_id={owner}
           AND NOT EXISTS(SELECT 1 FROM native_workspace_buffer_guard_groups g WHERE g.original_owner_id=i.owner_id AND g.body_id=h.body_id);
         INSERT INTO native_workspace_buffer_holds(version,owner_id)
           SELECT i.current_version,g.owner_id FROM native_workspace_buffer_identity i JOIN native_workspace_buffer_history h ON h.version=i.current_version JOIN native_workspace_buffer_guard_groups g ON g.original_owner_id=i.owner_id AND g.body_id=h.body_id WHERE i.owner_id={owner}
           AND NOT EXISTS(SELECT 1 FROM native_workspace_buffer_holds x WHERE x.version=i.current_version);
         INSERT INTO native_workspace_buffer_identity(owner_id,kind,label,store_instance,incarnation,current_version)
           SELECT h.owner_id,'retained',i.label,i.store_instance,i.incarnation,i.current_version FROM native_workspace_buffer_identity i JOIN native_workspace_buffer_holds h ON h.version=i.current_version WHERE i.owner_id={owner}
           AND NOT EXISTS(SELECT 1 FROM native_workspace_buffer_identity x WHERE x.owner_id=h.owner_id);
         INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce)
           SELECT h.owner_id,{snapshot},{timestamp},0,{nonce} FROM native_workspace_buffer_identity i JOIN native_workspace_buffer_holds h ON h.version=i.current_version
           WHERE i.owner_id={owner} AND NOT EXISTS(SELECT 1 FROM native_workspace_buffers b WHERE b.owner_id=h.owner_id);"
    )
    };
    // BEFORE INSERT sees an existing row even for legacy INSERT OR REPLACE;
    // its implicit DELETE triggers are not guaranteed by SQLite configuration.
    let hold_before_insert = hold_old("NEW.owner_id", "b.snapshot_json", "b.updated_at", "b.report_nonce")
        .replace("SELECT h.owner_id,b.snapshot_json,b.updated_at,0,b.report_nonce FROM native_workspace_buffer_identity i", "SELECT h.owner_id,b.snapshot_json,b.updated_at,0,b.report_nonce FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id");
    let hold_before_update = hold_old(
        "OLD.owner_id",
        "OLD.snapshot_json",
        "OLD.updated_at",
        "OLD.report_nonce",
    );
    let regular = "COALESCE((SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=NEW.owner_id),'legacy')!='retained'";
    let next_version = "UPDATE native_workspace_buffer_clock SET value=value+1 WHERE id=1;
         INSERT INTO native_workspace_buffer_bodies(snapshot_json) SELECT NEW.snapshot_json WHERE NOT EXISTS(SELECT 1 FROM native_workspace_buffer_bodies WHERE snapshot_json=NEW.snapshot_json);
         UPDATE native_workspace_buffer_identity SET current_version=(SELECT value FROM native_workspace_buffer_clock WHERE id=1) WHERE owner_id=NEW.owner_id;
         INSERT INTO native_workspace_buffer_identity(owner_id,kind,current_version) SELECT NEW.owner_id,'legacy',(SELECT value FROM native_workspace_buffer_clock WHERE id=1)
           WHERE NOT EXISTS(SELECT 1 FROM native_workspace_buffer_identity WHERE owner_id=NEW.owner_id);
         INSERT INTO native_workspace_buffer_history
           SELECT i.current_version,NEW.owner_id,i.kind,i.label,i.store_instance,i.incarnation,p.id,NEW.updated_at,NEW.confirmed,NEW.report_nonce
           FROM native_workspace_buffer_identity i JOIN native_workspace_buffer_bodies p ON p.snapshot_json=NEW.snapshot_json WHERE i.owner_id=NEW.owner_id;";
    // The caller owns one IMMEDIATE schema transaction. Replace our exact
    // trigger names atomically, including definitions from an earlier source
    // checkpoint; IF NOT EXISTS alone would preserve obsolete protection rules.
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS native_buffers_v2_before_insert;
         DROP TRIGGER IF EXISTS native_buffers_v2_before_update;
         DROP TRIGGER IF EXISTS native_buffers_v2_before_delete;
         DROP TRIGGER IF EXISTS native_buffers_v2_after_insert;
         DROP TRIGGER IF EXISTS native_buffers_v2_after_update;
         DROP TRIGGER IF EXISTS native_buffers_v2_retained_insert;
         DROP TRIGGER IF EXISTS native_buffers_v2_retained_update;
         DROP TRIGGER IF EXISTS native_buffers_v2_retained_delete;
         DROP TRIGGER IF EXISTS native_buffers_v2_history_update;
         DROP TRIGGER IF EXISTS native_buffers_v2_history_delete;
         DROP TRIGGER IF EXISTS native_buffers_v2_body_update;
         DROP TRIGGER IF EXISTS native_buffers_v2_body_delete;",
    )?;
    conn.execute_batch(&format!(
        "CREATE TRIGGER IF NOT EXISTS native_buffers_v2_before_insert BEFORE INSERT ON native_workspace_buffers
         WHEN {regular} AND EXISTS(SELECT 1 FROM native_workspace_buffers WHERE owner_id=NEW.owner_id) AND NOT({trusted}) BEGIN {hold_before_insert} END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_before_update BEFORE UPDATE ON native_workspace_buffers
         WHEN COALESCE((SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=OLD.owner_id),'legacy')!='retained' AND ({changed}) AND NOT({trusted}) BEGIN {hold_before_update} END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_before_delete BEFORE DELETE ON native_workspace_buffers
         WHEN COALESCE((SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=OLD.owner_id),'legacy')!='retained' BEGIN {hold_before_update} END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_after_insert AFTER INSERT ON native_workspace_buffers WHEN {regular} BEGIN {next_version} END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_after_update AFTER UPDATE ON native_workspace_buffers WHEN {regular} AND ({changed}) BEGIN {next_version} END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_retained_insert BEFORE INSERT ON native_workspace_buffers
         WHEN (SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=NEW.owner_id)='retained' AND EXISTS(SELECT 1 FROM native_workspace_buffers WHERE owner_id=NEW.owner_id)
         BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_RETAINED_IMMUTABLE'); END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_retained_update BEFORE UPDATE ON native_workspace_buffers
         WHEN (SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=OLD.owner_id)='retained' AND (({changed}) OR OLD.confirmed IS NOT NEW.confirmed OR OLD.owner_id IS NOT NEW.owner_id)
         BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_RETAINED_IMMUTABLE'); END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_retained_delete BEFORE DELETE ON native_workspace_buffers
         WHEN (SELECT kind FROM native_workspace_buffer_identity WHERE owner_id=OLD.owner_id)='retained'
         BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_RETAINED_IMMUTABLE'); END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_history_update BEFORE UPDATE ON native_workspace_buffer_history BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_HISTORY_IMMUTABLE'); END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_history_delete BEFORE DELETE ON native_workspace_buffer_history BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_HISTORY_IMMUTABLE'); END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_body_update BEFORE UPDATE ON native_workspace_buffer_bodies BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_BODY_IMMUTABLE'); END;
         CREATE TRIGGER IF NOT EXISTS native_buffers_v2_body_delete BEFORE DELETE ON native_workspace_buffer_bodies BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_BODY_IMMUTABLE'); END;"
    ))?;
    Ok(())
}

pub(super) struct OwnerStamp {
    pub id: String,
    pub kind: &'static str,
    pub label: String,
    pub store_instance: String,
    pub incarnation: Option<String>,
}
pub(super) fn record_owned(
    conn: &Connection,
    stamp: &OwnerStamp,
    raw: &str,
    now: i64,
    nonce: &str,
) -> Result<i64, String> {
    let canonical_uuid = |value: &str| {
        uuid::Uuid::parse_str(value)
            .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
    };
    if !canonical_uuid(&stamp.store_instance)
        || stamp.label.is_empty()
        || stamp.label.len() > 512
        || stamp.label.contains('\0')
        || !matches!(stamp.kind, "physical" | "unattributed")
        || (stamp.kind == "physical"
            && stamp.incarnation.as_deref().is_none_or(|inc| {
                !canonical_uuid(inc)
                    || stamp.id
                        != format!(
                            "physical:v2:{}",
                            sha(&format!("{}:{inc}", stamp.store_instance))
                        )
            }))
        || (stamp.kind == "unattributed" && stamp.incarnation.is_some())
    {
        return Err("Native buffer owner identity is invalid".into());
    }
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let previous: Option<(String, Option<String>, Option<String>)> = tx.query_row(
        "SELECT kind,store_instance,incarnation FROM native_workspace_buffer_identity WHERE owner_id=?1", [&stamp.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).optional().map_err(|e|e.to_string())?;
    if previous.as_ref().is_some_and(|(kind, store, incarnation)| {
        kind != stamp.kind
            || store.as_deref() != Some(stamp.store_instance.as_str())
            || incarnation != &stamp.incarnation
    }) {
        return Err("Native buffer owner identity collision".into());
    }
    tx.execute("INSERT OR IGNORE INTO native_workspace_buffer_identity(owner_id,kind,label,store_instance,incarnation,current_version) VALUES(?1,?2,?3,?4,?5,0)",
        params![stamp.id,stamp.kind,stamp.label,stamp.store_instance,stamp.incarnation]).map_err(|e|e.to_string())?;
    if stamp.kind == "physical" {
        tx.execute(
            "INSERT INTO native_workspace_buffer_write_permits(owner_id,nonce) VALUES(?1,?2)",
            params![stamp.id, nonce],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce) VALUES(?1,?2,?3,0,?4)
      ON CONFLICT(owner_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,confirmed=0,report_nonce=excluded.report_nonce",
      params![stamp.id,raw,now,nonce]).map_err(|e|e.to_string())?;
    tx.execute(
        "DELETE FROM native_workspace_buffer_write_permits WHERE owner_id=?1",
        [&stamp.id],
    )
    .map_err(|e| e.to_string())?;
    let version = current_version(&tx, &stamp.id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(version)
}
pub(super) fn current_version(conn: &Connection, owner: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT current_version FROM native_workspace_buffer_identity WHERE owner_id=?1",
        [owner],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReportSource {
    pub source_store_id: String,
    pub source_profile_id: String,
    pub owner_id: String,
    pub report_version: u64,
    pub snapshot_digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRequest {
    pub after: Option<u64>,
    pub limit: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMetadata {
    pub source: Option<ReportSource>,
    pub report_version: u64,
    pub owner_id: Option<String>,
    pub kind: String,
    pub window_label: Option<String>,
    pub updated_at: Option<u64>,
    pub legacy_timestamp: Option<String>,
    pub retained_bytes: u64,
    pub current: bool,
    pub held: bool,
    pub confirmed: bool,
    pub content_available: bool,
    pub inspectable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPage {
    pub version: u8,
    pub qualified: bool,
    pub records: Vec<ReportMetadata>,
    pub next: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainedReport {
    pub version: u8,
    pub qualified: bool,
    pub record: ReportMetadata,
    pub raw_snapshot: String,
    pub buffers: Vec<super::BufferState>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportStatus {
    pub version: u8,
    pub qualified: bool,
    pub record: ReportMetadata,
}

fn sha(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}
fn failure() -> String {
    "NATIVE_BUFFER_RECOVERY_UNAVAILABLE".into()
}
pub(super) fn identity(conn: &Connection) -> Result<(String, String), String> {
    let ids: (String, String) = conn
        .query_row(
            "SELECT source_store_id,source_profile_id FROM native_authority_identity WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| failure())?;
    if [&ids.0, &ids.1]
        .iter()
        .any(|id| id.is_empty() || id.len() > 512 || id.contains('\0'))
    {
        return Err(failure());
    }
    Ok(ids)
}
fn parsed(raw: &str) -> Option<Vec<super::BufferState>> {
    let value: Vec<super::BufferState> = serde_json::from_str(raw).ok()?;
    (value.len() <= 10_000
        && value.iter().all(|v| {
            v.path.len() <= 4096
                && !v.path.contains('\0')
                && std::path::Path::new(&v.path).is_absolute()
        }))
    .then_some(value)
}
fn metadata(
    conn: &Connection,
    ids: &(String, String),
    version: i64,
) -> Result<(ReportMetadata, Option<String>), String> {
    let (owner,kind,label,updated,bytes,raw,current,held,confirmed): MetadataRow = conn.query_row(
        "SELECT CASE WHEN typeof(h.owner_id)='text' AND length(CAST(h.owner_id AS BLOB)) BETWEEN 1 AND 512 THEN h.owner_id END,h.kind,
           CASE WHEN length(CAST(h.label AS BLOB))<=512 THEN h.label END,h.updated_at,length(CAST(p.snapshot_json AS BLOB)),
           CASE WHEN typeof(p.snapshot_json)='text' AND length(CAST(p.snapshot_json AS BLOB))<=?2 THEN p.snapshot_json END,
           EXISTS(SELECT 1 FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id WHERE b.owner_id=h.owner_id AND i.current_version=h.version),
           EXISTS(SELECT 1 FROM native_workspace_buffer_holds x JOIN native_workspace_buffers b ON b.owner_id=x.owner_id WHERE x.version=h.version),
           COALESCE((SELECT b.confirmed FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id WHERE b.owner_id=h.owner_id AND i.current_version=h.version),h.confirmed)
         FROM native_workspace_buffer_history h JOIN native_workspace_buffer_bodies p ON p.id=h.body_id WHERE h.version=?1",
        params![version,MAX_DISCLOSURE],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)),
    ).map_err(|_|failure())?;
    if !(1..=MAX_SAFE).contains(&version) || bytes < 0 {
        return Err(failure());
    }
    let buffers = raw.as_deref().and_then(parsed);
    let valid_timestamp = (0..=MAX_SAFE).contains(&updated);
    let inspectable =
        valid_timestamp && owner.as_ref().is_some_and(|v| !v.contains('\0')) && buffers.is_some();
    let source = if inspectable {
        Some(ReportSource {
            source_store_id: ids.0.clone(),
            source_profile_id: ids.1.clone(),
            owner_id: owner.clone().unwrap(),
            report_version: version as u64,
            snapshot_digest: sha(raw.as_deref().unwrap()),
        })
    } else {
        None
    };
    let dirty = buffers.as_ref().is_some_and(|b| b.iter().any(|v| v.dirty));
    let stale =
        super::now_millis().saturating_sub(updated) > 45_000 || updated > super::now_millis();
    let held = held
        || (current && (!confirmed || dirty || stale || !inspectable || kind == "unattributed"));
    Ok((
        ReportMetadata {
            source,
            report_version: version as u64,
            owner_id: owner,
            kind,
            window_label: label,
            updated_at: valid_timestamp.then_some(updated as u64),
            legacy_timestamp: (!valid_timestamp).then(|| updated.to_string()),
            retained_bytes: bytes as u64,
            current,
            held,
            confirmed,
            content_available: false,
            inspectable,
        },
        raw,
    ))
}
pub(super) fn list(conn: &Connection, request: ListRequest) -> Result<ReportPage, String> {
    if !(1..=100).contains(&request.limit) || request.after.is_some_and(|v| v > MAX_SAFE as u64) {
        return Err("NATIVE_BUFFER_RECOVERY_INVALID_REQUEST".into());
    }
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Deferred)
        .map_err(|_| failure())?;
    let ids = identity(&tx)?;
    let versions = {
        let mut s=tx.prepare("SELECT version FROM native_workspace_buffer_history WHERE version>?1 ORDER BY version LIMIT ?2").map_err(|_|failure())?;
        let r = s
            .query_map(
                params![request.after.unwrap_or(0) as i64, request.limit + 1],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|_| failure())?;
        r.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| failure())?
    };
    let records = versions
        .iter()
        .take(request.limit as usize)
        .map(|v| metadata(&tx, &ids, *v).map(|v| v.0))
        .collect::<Result<Vec<_>, _>>()?;
    let next =
        (versions.len() > request.limit as usize).then(|| records.last().unwrap().report_version);
    tx.commit().map_err(|_| failure())?;
    Ok(ReportPage {
        version: 1,
        qualified: false,
        records,
        next,
    })
}
pub(super) fn read(conn: &Connection, source: ReportSource) -> Result<RetainedReport, String> {
    if source.owner_id.is_empty()
        || source.owner_id.len() > 512
        || source.owner_id.contains('\0')
        || source.snapshot_digest.len() != 64
        || !source
            .snapshot_digest
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("NATIVE_BUFFER_RECOVERY_INVALID_REQUEST".into());
    }
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Deferred)
        .map_err(|_| failure())?;
    let ids = identity(&tx)?;
    if source.report_version == 0
        || source.report_version > MAX_SAFE as u64
        || source.source_store_id != ids.0
        || source.source_profile_id != ids.1
    {
        return Err("NATIVE_BUFFER_RECOVERY_CONFLICT".into());
    }
    let (record, raw) = metadata(&tx, &ids, source.report_version as i64)?;
    if record.source.as_ref().is_none_or(|v| {
        v.owner_id != source.owner_id || v.snapshot_digest != source.snapshot_digest
    }) {
        return Err("NATIVE_BUFFER_RECOVERY_CONFLICT".into());
    }
    let raw_snapshot = raw.ok_or_else(failure)?;
    let buffers = parsed(&raw_snapshot).ok_or_else(failure)?;
    tx.commit().map_err(|_| failure())?;
    Ok(RetainedReport {
        version: 1,
        qualified: false,
        record,
        raw_snapshot,
        buffers,
    })
}
pub(super) fn status(conn: &Connection, source: ReportSource) -> Result<ReportStatus, String> {
    let read = read(conn, source)?;
    Ok(ReportStatus {
        version: 1,
        qualified: false,
        record: read.record,
    })
}

#[cfg(test)]
#[path = "buffer_reports_tests.rs"]
mod tests;
