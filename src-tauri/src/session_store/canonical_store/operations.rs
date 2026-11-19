//! Reclaims `canonical_operations` rows that nothing can ever replay or look up.
//!
//! A row exists so a repeated operation ID returns the stored result and so
//! `canonical_store_receipt` can settle an uncertain outcome. Neither is safe to
//! drop for scopes whose callers persist an operation ID and reconcile it later
//! (`session-organization.v1`, `session-pin-saga.v1`, the assistant send scope and
//! the migration scope), so those rows are never reclaimed. The scopes below mint a
//! fresh ID per awaited call, never repeat it and never ask for its receipt (they
//! settle through version checks), so only a bounded recent window is kept.

use rusqlite::{params, Connection};

/// Scopes whose callers use each operation ID once and never read its receipt.
const RECEIPTLESS_SCOPES: [&str; 3] = [
    "remote-outbox.v2",
    "assistant-thread-drafts.v2",
    "host-session-bindings.v2",
];

/// Newest rows kept per scope. Larger than any number of calls that can be in
/// flight, so a same-call replay always still finds its row.
pub(super) const RETAINED_PER_SCOPE: i64 = 1024;

/// Deletes all but the newest `retain` rows of a receipt-less scope. Runs in the
/// caller's transaction so the insert and the reclaim commit together.
pub(super) fn reclaim(tx: &Connection, scope: &str, retain: i64) -> Result<(), String> {
    if !RECEIPTLESS_SCOPES.contains(&scope) {
        return Ok(());
    }
    tx.execute(
        "DELETE FROM canonical_operations WHERE scope=?1 AND rowid < COALESCE((SELECT MIN(rowid) FROM (SELECT rowid FROM canonical_operations WHERE scope=?1 ORDER BY rowid DESC LIMIT ?2)),0)",
        params![scope, retain],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
#[path = "operations_tests.rs"]
mod tests;
