//! Incremental admission quota for retained originals. The contribution view
//! is scanned during migration and periodic integrity audits. Trigger reads
//! address one original by its ID.
use super::*;

fn installed(conn: &Connection) -> Result<bool, String> {
    let (table, guards): (bool, i64) = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_delivery_usage'),
         (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN(
           'native_delivery_usage_insert','native_delivery_usage_delete','native_delivery_usage_ack',
           'native_delivery_usage_unavailable','native_delivery_usage_available'))",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| invalid())?;
    match (table, guards) {
        (true, 5) => Ok(true),
        (false, 0) => Ok(false),
        _ => Err(invalid()),
    }
}

pub(super) fn initialize(conn: &Connection) -> Result<(), String> {
    require_full(conn)?;
    if !installed(conn)? {
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn verify(conn: &Connection) -> Result<(), String> {
    if !installed(conn)? {
        return Ok(());
    }
    let matches: bool = conn
        .query_row(
            "WITH lanes(lane) AS (VALUES(1),(2),(3),(4)),
                  charged AS (
                    SELECT lane, COUNT(*) AS retained, SUM(active) AS active, SUM(bytes) AS bytes
                    FROM native_delivery_usage_charge GROUP BY lane
                  )
             SELECT (SELECT COUNT(*) FROM native_delivery_usage)=4 AND NOT EXISTS(
               SELECT 1 FROM lanes
               LEFT JOIN native_delivery_usage u USING(lane)
               LEFT JOIN charged c USING(lane)
               WHERE u.retained IS NOT COALESCE(c.retained,0)
                  OR u.active IS NOT COALESCE(c.active,0)
                  OR u.bytes IS NOT COALESCE(c.bytes,0)
             )",
            [],
            |r| r.get(0),
        )
        .map_err(|_| invalid())?;
    if !matches {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn read(
    conn: &Connection,
    method: &str,
    budget: usize,
) -> Result<(i64, i64, i64), String> {
    // Keep relay finishes and formatter reservations independent.
    let lane = match (method, budget) {
        #[cfg(test)]
        (LEGACY_BUFFER, _) => 1,
        ("native.services.workspace.format", FORMAT_RESULT_BYTES) => 2,
        ("native.services.workspace.format", _) => 3,
        _ => 4,
    };
    // Obsolete buffer tombstones still account for their storage in lane 1.
    // They no longer take admission capacity from either service.
    conn.query_row(
        "SELECT (SELECT SUM(retained) FROM native_delivery_usage WHERE lane!=1), active, bytes
         FROM native_delivery_usage WHERE lane=?1
         AND EXISTS(SELECT 1 FROM native_delivery_usage WHERE lane=1)
         AND EXISTS(SELECT 1 FROM native_delivery_usage WHERE lane=2)
         AND EXISTS(SELECT 1 FROM native_delivery_usage WHERE lane=3)
         AND EXISTS(SELECT 1 FROM native_delivery_usage WHERE lane=4)",
        [lane],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .map_err(|_| invalid())
}

const SCHEMA: &str = r#"
CREATE INDEX native_delivery_recorded_method ON native_delivery_originals(method,created_instance)
 WHERE phase='recorded';
CREATE TABLE native_delivery_usage(
 lane INTEGER PRIMARY KEY CHECK(lane BETWEEN 1 AND 4),
 retained INTEGER NOT NULL CHECK(retained>=0),
 active INTEGER NOT NULL CHECK(active BETWEEN 0 AND retained),
 bytes INTEGER NOT NULL CHECK(bytes>=0));
-- Older format rows outside the small reservation use the large format lane.
CREATE VIEW native_delivery_usage_charge AS
 SELECT o.original_id,
   CASE WHEN o.method='native.buffers.update' THEN 1
        WHEN o.method='native.services.workspace.format' THEN
          CASE o.result_budget WHEN 4194304 THEN 2 ELSE 3 END
        ELSE 4 END AS lane,
   CASE WHEN o.phase!='acknowledged' AND u.original_id IS NULL THEN 1 ELSE 0 END AS active,
   CASE WHEN o.phase!='acknowledged' THEN o.payload_bytes
       + CASE WHEN u.original_id IS NULL THEN o.result_budget ELSE 0 END ELSE 0 END AS bytes
 FROM native_delivery_originals o
 LEFT JOIN native_delivery_unavailable_results u ON u.original_id=o.original_id;
INSERT INTO native_delivery_usage VALUES (1,0,0,0),(2,0,0,0),(3,0,0,0),(4,0,0,0);
INSERT INTO native_delivery_usage SELECT lane,COUNT(*),SUM(active),SUM(bytes)
 FROM native_delivery_usage_charge WHERE true GROUP BY lane
 ON CONFLICT(lane) DO UPDATE SET retained=excluded.retained,active=excluded.active,bytes=excluded.bytes;
CREATE TRIGGER native_delivery_usage_insert AFTER INSERT ON native_delivery_originals BEGIN
 UPDATE native_delivery_usage SET retained=retained+1,
 active=native_delivery_usage.active+c.active, bytes=native_delivery_usage.bytes+c.bytes
 FROM native_delivery_usage_charge c WHERE c.original_id=NEW.original_id AND native_delivery_usage.lane=c.lane;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'NATIVE_DELIVERY_INVALID') END;
END;
CREATE TRIGGER native_delivery_usage_delete BEFORE DELETE ON native_delivery_originals BEGIN
 UPDATE native_delivery_usage SET retained=retained-1,
 active=native_delivery_usage.active-c.active, bytes=native_delivery_usage.bytes-c.bytes
 FROM native_delivery_usage_charge c WHERE c.original_id=OLD.original_id AND native_delivery_usage.lane=c.lane;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'NATIVE_DELIVERY_INVALID') END;
END;
CREATE TRIGGER native_delivery_usage_ack BEFORE UPDATE OF phase ON native_delivery_originals
 WHEN OLD.phase!='acknowledged' AND NEW.phase='acknowledged' BEGIN
 UPDATE native_delivery_usage SET active=native_delivery_usage.active-c.active,
 bytes=native_delivery_usage.bytes-c.bytes
 FROM native_delivery_usage_charge c WHERE c.original_id=OLD.original_id AND native_delivery_usage.lane=c.lane;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'NATIVE_DELIVERY_INVALID') END;
END;
CREATE TRIGGER native_delivery_usage_unavailable BEFORE INSERT ON native_delivery_unavailable_results BEGIN
 UPDATE native_delivery_usage SET active=native_delivery_usage.active-c.active,
 bytes=native_delivery_usage.bytes-c.active*o.result_budget
 FROM native_delivery_usage_charge c JOIN native_delivery_originals o ON o.original_id=c.original_id
 WHERE c.original_id=NEW.original_id AND native_delivery_usage.lane=c.lane;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'NATIVE_DELIVERY_INVALID') END;
END;
CREATE TRIGGER native_delivery_usage_available BEFORE DELETE ON native_delivery_unavailable_results BEGIN
 UPDATE native_delivery_usage SET active=native_delivery_usage.active+(o.phase!='acknowledged'),
 bytes=native_delivery_usage.bytes+(o.phase!='acknowledged')*o.result_budget
 FROM native_delivery_usage_charge c JOIN native_delivery_originals o ON o.original_id=c.original_id
 WHERE c.original_id=OLD.original_id AND native_delivery_usage.lane=c.lane;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'NATIVE_DELIVERY_INVALID') END;
END;
"#;
