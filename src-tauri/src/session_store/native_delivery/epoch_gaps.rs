//! Durable local proof that the Host fenced one allocated epoch original as
//! never admitted. The proof is not success, a result or a remote ACK: it only
//! lets the ordered prefix pass a slot whose original came from an older,
//! physically retired runtime (same Store lease), and it permanently fences the
//! semantic key so no other identity is minted for that request.
use super::*;

pub(super) const TABLE: &str = "native_delivery_epoch_gaps";
const ANCHORS: [&str; 2] = [
    "native_delivery_epoch_gap_valid",
    "native_delivery_epoch_gap_phase_fence",
];
/// Permanent rows; bounded like the Host's global fence catalog.
const MAX_GAPS: i64 = 65_536;
const COLUMNS: &str = "original_id,owner_id,generation,sequence,source_store_id,source_profile_id,semantic_key,route_fingerprint,method,payload_sha256,payload_bytes,created_instance,resolved_instance";

fn gap_invalid() -> String {
    "NATIVE_DELIVERY_EPOCH_GAP_INVALID: only an older runtime's unadmitted prepared/possible original can be fenced".into()
}

pub(super) fn installed(conn: &Connection) -> Result<(bool, bool), String> {
    let mut anchored = true;
    for name in ANCHORS {
        let present: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?1)",
                [name],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        anchored &= present;
    }
    Ok((table(conn, TABLE)?, anchored))
}

/// Upgrade an initialized epoch Store in the caller's FULL transaction. The
/// replaced retention guards keep every earlier branch and add the gap branch.
pub(super) fn migrate(conn: &Connection) -> Result<(), String> {
    require_full(conn)?;
    match installed(conn)? {
        (true, true) => return Ok(()),
        (false, _) => {}
        _ => return Err(invalid()),
    }
    // An existing Store may predate the unavailable-result sidecar the replaced
    // guard names. Fresh initialization already ran `schema` before its guards.
    if anchor(conn)? {
        schema(conn)?;
    }
    conn.execute_batch(&guards()).map_err(|e| e.to_string())
}

const WITNESSED: &str = "JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation AND w.digest=e.digest AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed";

fn same(a: &str, b: &str) -> String {
    [
        "source_store_id",
        "source_profile_id",
        "semantic_key",
        "route_fingerprint",
        "method",
        "payload_sha256",
        "payload_bytes",
    ]
    .iter()
    .map(|c| format!("{a}.{c}={b}.{c}"))
    .collect::<Vec<_>>()
    .join(" AND ")
}

fn guards() -> String {
    let og = same("o", "g");
    let og_new = same("o", "NEW");
    let a_new = same("a", "NEW");
    let g_old = same("g", "OLD");
    format!(
        r#"
CREATE TABLE {TABLE}(original_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,generation INTEGER NOT NULL,sequence INTEGER NOT NULL,source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,semantic_key TEXT NOT NULL,route_fingerprint TEXT NOT NULL,method TEXT NOT NULL,payload_sha256 TEXT NOT NULL,payload_bytes INTEGER NOT NULL,created_instance TEXT NOT NULL,resolved_instance TEXT NOT NULL,UNIQUE(owner_id,generation,sequence),UNIQUE(source_store_id,source_profile_id,semantic_key));
CREATE TRIGGER {TABLE}_no_replace BEFORE INSERT ON {TABLE} WHEN EXISTS(SELECT 1 FROM {TABLE} g WHERE g.original_id=NEW.original_id OR (g.owner_id=NEW.owner_id AND g.generation=NEW.generation AND g.sequence=NEW.sequence) OR (g.source_store_id=NEW.source_store_id AND g.source_profile_id=NEW.source_profile_id AND g.semantic_key=NEW.semantic_key))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
CREATE TRIGGER {TABLE}_immutable BEFORE UPDATE ON {TABLE} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
CREATE TRIGGER {TABLE}_retained BEFORE DELETE ON {TABLE} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
CREATE TRIGGER native_delivery_epoch_gap_valid BEFORE INSERT ON {TABLE} WHEN NOT EXISTS(
 SELECT 1 FROM native_delivery_originals o JOIN native_delivery_epoch_allocations a ON a.original_id=o.original_id
 JOIN native_delivery_epochs e ON e.owner_id=a.owner_id AND e.generation=a.generation {WITNESSED}
 WHERE o.original_id=NEW.original_id AND NEW.original_id='nd2:'||NEW.owner_id||':'||NEW.generation||':'||NEW.sequence
 AND a.owner_id=NEW.owner_id AND a.generation=NEW.generation AND a.sequence=NEW.sequence AND {og_new} AND {a_new}
 AND o.phase IN('prepared','possible') AND o.result_sha256 IS NULL AND o.created_instance=NEW.created_instance
 AND length(CAST(NEW.resolved_instance AS BLOB))=36 AND NEW.resolved_instance!=NEW.created_instance
 AND e.source_store_id=NEW.source_store_id AND e.source_profile_id=NEW.source_profile_id AND e.route_fingerprint=NEW.route_fingerprint
 AND NEW.sequence>e.local_through AND NEW.sequence<=e.high_water)
 OR EXISTS(SELECT 1 FROM native_delivery_remote_acks r WHERE r.original_id=NEW.original_id)
 OR EXISTS(SELECT 1 FROM native_delivery_semantic_retirements m WHERE m.original_id=NEW.original_id OR (m.owner_id=NEW.owner_id AND m.generation=NEW.generation AND m.sequence=NEW.sequence))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_GAP_INVALID'); END;
CREATE TRIGGER native_delivery_epoch_gap_phase_fence BEFORE UPDATE OF phase,revision,result_json,result_sha256,result_bytes ON native_delivery_originals
WHEN EXISTS(SELECT 1 FROM {TABLE} g WHERE g.original_id=OLD.original_id)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_GAP_FENCED'); END;
DROP TRIGGER IF EXISTS native_delivery_epoch_semantic_guard;
CREATE TRIGGER native_delivery_epoch_semantic_guard BEFORE INSERT ON native_delivery_originals
WHEN EXISTS(SELECT 1 FROM native_delivery_semantic_retirements m WHERE m.source_store_id=NEW.source_store_id AND m.source_profile_id=NEW.source_profile_id AND m.semantic_key=NEW.semantic_key)
 OR EXISTS(SELECT 1 FROM {TABLE} g WHERE g.source_store_id=NEW.source_store_id AND g.source_profile_id=NEW.source_profile_id AND g.semantic_key=NEW.semantic_key)
 OR EXISTS(SELECT 1 FROM native_delivery_epoch_allocations a WHERE a.source_store_id=NEW.source_store_id AND a.source_profile_id=NEW.source_profile_id AND a.semantic_key=NEW.semantic_key AND a.original_id!=NEW.original_id)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETIRED'); END;
DROP TRIGGER IF EXISTS native_delivery_no_delete;
CREATE TRIGGER native_delivery_no_delete BEFORE DELETE ON native_delivery_originals WHEN NOT((OLD.phase='acknowledged' AND EXISTS(
 SELECT 1 FROM native_delivery_semantic_retirements m JOIN native_delivery_epochs e ON e.owner_id=m.owner_id AND e.generation=m.generation {WITNESSED}
 WHERE OLD.original_id='nd2:'||m.owner_id||':'||m.generation||':'||m.sequence AND m.original_id=OLD.original_id AND m.source_store_id=OLD.source_store_id AND m.source_profile_id=OLD.source_profile_id AND m.semantic_key=OLD.semantic_key AND m.route_fingerprint=OLD.route_fingerprint AND m.method=OLD.method AND m.payload_sha256=OLD.payload_sha256 AND m.payload_bytes=OLD.payload_bytes AND m.result_sha256=OLD.result_sha256 AND m.result_bytes=OLD.result_bytes AND m.sequence<=e.local_through AND e.local_through<=e.host_through))
 OR (OLD.phase IN('prepared','possible') AND EXISTS(
 SELECT 1 FROM {TABLE} g JOIN native_delivery_epochs e ON e.owner_id=g.owner_id AND e.generation=g.generation {WITNESSED}
 WHERE g.original_id=OLD.original_id AND OLD.original_id='nd2:'||g.owner_id||':'||g.generation||':'||g.sequence AND {g_old} AND g.created_instance=OLD.created_instance
 AND e.source_store_id=g.source_store_id AND e.source_profile_id=g.source_profile_id AND e.route_fingerprint=g.route_fingerprint AND g.sequence<=e.local_through AND e.local_through<=e.host_through)))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
DROP TRIGGER IF EXISTS native_delivery_epoch_allocation_retained;
CREATE TRIGGER native_delivery_epoch_allocation_retained BEFORE DELETE ON native_delivery_epoch_allocations WHEN EXISTS(SELECT 1 FROM native_delivery_originals o WHERE o.original_id=OLD.original_id) OR (NOT EXISTS(
 SELECT 1 FROM native_delivery_semantic_retirements m JOIN native_delivery_epochs e ON e.owner_id=m.owner_id AND e.generation=m.generation {WITNESSED}
 WHERE m.original_id=OLD.original_id AND m.original_id='nd2:'||m.owner_id||':'||m.generation||':'||m.sequence
 AND m.source_store_id=OLD.source_store_id AND m.source_profile_id=OLD.source_profile_id AND m.route_fingerprint=OLD.route_fingerprint AND m.semantic_key=OLD.semantic_key AND m.method=OLD.method AND m.payload_sha256=OLD.payload_sha256 AND m.payload_bytes=OLD.payload_bytes
 AND m.owner_id=OLD.owner_id AND m.generation=OLD.generation AND m.sequence=OLD.sequence AND m.sequence<=e.local_through)
 AND NOT EXISTS(
 SELECT 1 FROM {TABLE} g JOIN native_delivery_epochs e ON e.owner_id=g.owner_id AND e.generation=g.generation {WITNESSED}
 WHERE g.original_id=OLD.original_id AND g.owner_id=OLD.owner_id AND g.generation=OLD.generation AND g.sequence=OLD.sequence AND {g_old} AND g.sequence<=e.local_through))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
DROP TRIGGER IF EXISTS native_delivery_unavailable_retained;
CREATE TRIGGER native_delivery_unavailable_retained BEFORE DELETE ON native_delivery_unavailable_results WHEN NOT EXISTS(
 SELECT 1 FROM {TABLE} g JOIN native_delivery_originals o ON o.original_id=g.original_id AND {og} AND o.created_instance=g.created_instance
 JOIN native_delivery_epochs e ON e.owner_id=g.owner_id AND e.generation=g.generation {WITNESSED}
 WHERE g.original_id=OLD.original_id AND g.sequence<=e.local_through AND e.local_through<=e.host_through)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
"#
    )
}

type Row = (
    String,
    String,
    i64,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    String,
);

/// Exact identity columns plus the resolving runtime.
fn row(conn: &Connection, original_id: &str) -> Result<Option<(Row, String)>, String> {
    if !table(conn, TABLE)? {
        return Ok(None);
    }
    conn.query_row(
        &format!(
            "SELECT {},{},generation,sequence,{},{},{},{},{},{},payload_bytes,{},{} FROM {TABLE} WHERE original_id=?1",
            bounded("original_id", 36, 80),
            bounded("owner_id", 36, 36),
            bounded("source_store_id", 1, 2048),
            bounded("source_profile_id", 1, 2048),
            bounded("semantic_key", 1, 2048),
            bounded("route_fingerprint", 64, 64),
            bounded("method", 1, 128),
            bounded("payload_sha256", 64, 64),
            bounded("created_instance", 36, 36),
            bounded("resolved_instance", 36, 36),
        ),
        [original_id],
        |r| {
            Ok((
                (
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ),
                r.get(12)?,
            ))
        },
    )
    .optional()
    .map_err(|_| invalid())
}

fn expected(original: &Original) -> Result<(V2Id, Row), String> {
    let id = parse_id(original.id()).ok_or_else(gap_invalid)?;
    let row = (
        original.id.clone(),
        id.owner.clone(),
        id.generation,
        id.sequence,
        original.source_store_id.clone(),
        original.source_profile_id.clone(),
        original.semantic_key.clone(),
        original.route_fingerprint.clone(),
        original.method.clone(),
        original.payload_sha256.clone(),
        original.payload_bytes as i64,
        original.created_instance.clone(),
    );
    Ok((id, row))
}

/// Exact durable proof for this still-retained original. A row that names the
/// original but disagrees with any immutable field is corruption, not absence.
pub(super) fn proven(conn: &Connection, original: &Original) -> Result<bool, String> {
    let Some((stored, resolved)) = row(conn, original.id())? else {
        return Ok(false);
    };
    let (_, wanted) = expected(original)?;
    if stored != wanted
        || !uuid(&resolved)
        || resolved == stored.11
        || !matches!(original.phase, Phase::Prepared | Phase::Possible)
    {
        return Err(invalid());
    }
    Ok(true)
}

/// Covered gap slots in `1..=through`; they never overlap a semantic marker.
pub(super) fn covered(conn: &Connection, value: &State) -> Result<i64, String> {
    if !table(conn, TABLE)? {
        return Ok(0);
    }
    let (count, overlap): (i64, i64) = conn
        .query_row(
            &format!("SELECT COUNT(*),COALESCE(SUM(EXISTS(SELECT 1 FROM native_delivery_semantic_retirements m WHERE m.original_id=g.original_id OR (m.owner_id=g.owner_id AND m.generation=g.generation AND m.sequence=g.sequence))),0) FROM {TABLE} g WHERE g.owner_id=?1 AND g.generation=?2 AND g.sequence BETWEEN 1 AND ?3 AND g.source_store_id=?4 AND g.source_profile_id=?5 AND g.route_fingerprint=?6 AND g.original_id='nd2:'||g.owner_id||':'||g.generation||':'||g.sequence"),
            params![value.owner_id, value.generation, value.local_through, value.source_store_id, value.source_profile_id, value.route],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| invalid())?;
    if overlap != 0 {
        return Err(invalid());
    }
    Ok(count)
}

/// Semantic fence after (or before) compaction: never a second identity.
pub(super) fn check_semantic(
    conn: &Connection,
    ids: &(String, String),
    semantic: &str,
    route: &str,
    method: &str,
    hash: &str,
    bytes: usize,
) -> Result<(), String> {
    if !table(conn, TABLE)? {
        return Ok(());
    }
    let old: Option<(String, String, String, i64)> = conn
        .query_row(
            &format!(
                "SELECT {},{},{},payload_bytes FROM {TABLE} WHERE source_store_id=?1 AND source_profile_id=?2 AND semantic_key=?3",
                bounded("route_fingerprint", 64, 64),
                bounded("method", 1, 128),
                bounded("payload_sha256", 64, 64)
            ),
            params![ids.0, ids.1, semantic],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(|_| invalid())?;
    if let Some(old) = old {
        if old != (route.into(), method.into(), hash.into(), bytes as i64) {
            return Err("NATIVE_DELIVERY_CONFLICT: this fenced original key belongs to a different route, method or exact request bytes".into());
        }
        return Err("NATIVE_DELIVERY_EPOCH_GAP_FENCED: the Host durably proved this semantic original was never admitted; do not create another identity".into());
    }
    Ok(())
}

pub(super) fn eligible(original: &Original) -> bool {
    matches!(original.phase, Phase::Prepared | Phase::Possible)
        && original.result_sha256.is_none()
        && original.created_instance != original.runtime.to_string()
}

/// Write the Host's exact never-admitted fence for `original` inside the
/// caller's FULL transaction, after the response binding was validated. It
/// changes no phase, result or remote ACK and keeps the original row intact.
pub(crate) fn record_gap_tx(conn: &Connection, original: &Original) -> Result<(), String> {
    require_full(conn)?;
    check_structure(conn)?;
    if !table(conn, TABLES[0])? {
        return Err(invalid());
    }
    let record = super::super::current(conn, original)?;
    if !eligible(&record) || record.revision != original.revision || record.phase != original.phase
    {
        return Err(gap_invalid());
    }
    if remote_acked(conn, &record)? {
        return Err(gap_invalid());
    }
    let (id, row) = expected(&record)?;
    let value = state(conn, &id.owner, id.generation)?;
    if id.sequence <= value.local_through
        || id.sequence > value.high_water
        || record.route_fingerprint != value.route
        || record.source_store_id != value.source_store_id
        || record.source_profile_id != value.source_profile_id
    {
        return Err(gap_invalid());
    }
    // Verify the full immutable request bytes behind the fenced identity.
    let _ = load_bytes(conn, &record, false)?;
    migrate(conn)?;
    if proven(conn, &record)? {
        return Ok(());
    }
    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {TABLE}"), [], |r| r.get(0))
        .map_err(|_| invalid())?;
    if total >= MAX_GAPS {
        return Err(capacity());
    }
    conn.execute(
        &format!(
            "INSERT INTO {TABLE}({COLUMNS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"
        ),
        params![
            row.0,
            row.1,
            row.2,
            row.3,
            row.4,
            row.5,
            row.6,
            row.7,
            row.8,
            row.9,
            row.10,
            row.11,
            record.runtime.to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    if !proven(conn, &record)? {
        return Err(invalid());
    }
    Ok(())
}

/// Delete a covered gap slot's original and allocation after the floor moved.
/// The permanent gap row stays as identity and semantic fence.
pub(super) fn compact_slot(conn: &Connection, original: &Original) -> Result<(), String> {
    if !proven(conn, original)? {
        return Err(invalid());
    }
    for sql in [
        "DELETE FROM native_delivery_unavailable_results WHERE original_id=?1",
        "DELETE FROM native_delivery_originals WHERE original_id=?1",
        "DELETE FROM native_delivery_epoch_allocations WHERE original_id=?1",
    ] {
        conn.execute(sql, [original.id()])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "epoch_gap_tests.rs"]
mod tests;
