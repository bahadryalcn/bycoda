//! A claim outlives the app process that issued it: page identities are
//! process-local, so a quit or crash would otherwise hold a conversation forever
//! (`CANONICAL_CLAIM_HELD`). Release a claim only when its issuing process is
//! proven gone through its unheld recovery lease. Its managed job object then
//! killed every provider writer it started, so a submitted session-writer claim
//! has no live effect left. Submitted claims of other scopes stay held; their
//! domain reconciles the outcome through receipts.
use rusqlite::{params, Connection, OptionalExtension};

use super::super::cohort::{LeaseState, RegisteredConnection};
use super::BINDING_SCOPE;

pub(super) fn ensure_schema(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS canonical_claim_processes (scope TEXT NOT NULL, key TEXT NOT NULL, operation_id TEXT NOT NULL, process TEXT NOT NULL, PRIMARY KEY(scope,key,operation_id));")
}

/// Record the issuing process of a claim this window and page now own.
pub(super) fn record_process(
    tx: &Connection,
    scope: &str,
    key: &str,
    operation_id: &str,
    window: &str,
    page: &str,
    process: &str,
) -> Result<(), String> {
    tx.execute("INSERT OR IGNORE INTO canonical_claim_processes(scope,key,operation_id,process) SELECT ?1,?2,?3,?6 WHERE EXISTS(SELECT 1 FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3 AND window=?4 AND page=?5)",
        params![scope, key, operation_id, window, page, process]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Claims written before process tracking have no process row; they can only
/// come from an earlier process and are gone once no other lease is live.
fn issuer_gone(db: &RegisteredConnection, own: &str, process: Option<&str>) -> bool {
    match process {
        Some(process) if process == own => false,
        Some(process) => matches!(db.recovery_lease_state(process), Ok(LeaseState::Unleased)),
        None => matches!(db.other_recovery_lease_live(own), Ok(false)),
    }
}

/// Settle the current claim on `key` when its issuing process is gone, so the
/// caller's acquisition can proceed. Returns whether a claim was released.
pub(super) fn release_if_orphaned(
    db: &RegisteredConnection,
    tx: &Connection,
    own_process: &str,
    recovered_by: &str,
    scope: &str,
    key: &str,
) -> Result<bool, String> {
    #[allow(clippy::type_complexity)] // shortcut: one-off row tuple, name it when a second query reads these columns
    let row: Option<(String, String, String, Option<String>, Option<String>)> = tx.query_row(
        "SELECT c.operation_id,c.window,c.page,p.phase,o.process FROM canonical_claims c LEFT JOIN canonical_claim_phases p ON p.scope=c.scope AND p.key=c.key AND p.operation_id=c.operation_id LEFT JOIN canonical_claim_processes o ON o.scope=c.scope AND o.key=c.key AND o.operation_id=c.operation_id WHERE c.scope=?1 AND c.key=?2",
        params![scope, key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).optional().map_err(|e| e.to_string())?;
    let Some((operation_id, window, page, phase, process)) = row else {
        return Ok(false);
    };
    let releasable = match phase.as_deref() {
        Some("prepared") => true,
        Some("submitted") => scope == BINDING_SCOPE,
        _ => false,
    };
    if !releasable || !issuer_gone(db, own_process, process.as_deref()) {
        return Ok(false);
    }
    tx.execute(
        "DELETE FROM canonical_claims WHERE scope=?1 AND key=?2 AND operation_id=?3",
        params![scope, key, operation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT OR IGNORE INTO canonical_claim_settlements(scope,key,operation_id,window,page) VALUES(?1,?2,?3,?4,?5)", params![scope, key, operation_id, window, page]).map_err(|e| e.to_string())?;
    tx.execute("INSERT OR IGNORE INTO canonical_claim_recoveries(scope,key,operation_id,owner_page,recovered_by) VALUES(?1,?2,?3,?4,?5)", params![scope, key, operation_id, page, recovered_by]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
#[path = "orphans_tests.rs"]
mod tests;
