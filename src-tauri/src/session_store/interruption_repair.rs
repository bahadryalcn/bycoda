//! One-time projection repair; original transcript bytes stay untouched.
use super::*;

const REPAIR: &str = "owner-stop-before-quit-v1";

pub(super) fn repair_owner_stop_summaries(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_list_summary_repairs (
        name TEXT PRIMARY KEY, after_id TEXT NOT NULL, complete INTEGER NOT NULL
    );",
    )?;
    loop {
        let tx =
            rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("INSERT OR IGNORE INTO session_list_summary_repairs(name,after_id,complete) VALUES(?1,'',0)",[REPAIR])?;
        let (after, complete): (String, bool) = tx.query_row(
            "SELECT after_id,complete FROM session_list_summary_repairs WHERE name=?1",
            [REPAIR],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if complete {
            return Ok(());
        }
        let ids = {
            let mut statement = tx.prepare("SELECT session_id FROM session_list_summaries WHERE interrupted=1 AND session_id>?1 ORDER BY session_id LIMIT 128")?;
            let rows = statement.query_map([&after], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in &ids {
            if owner_stop_before_quit(&stored_turn_tail(&tx, id)?) {
                tx.execute(
                    "UPDATE session_list_summaries SET interrupted=0 WHERE session_id=?1",
                    [id],
                )?;
            }
        }
        tx.execute(
            "UPDATE session_list_summary_repairs SET after_id=?2,complete=?3 WHERE name=?1",
            params![REPAIR, ids.last().unwrap_or(&after), ids.len() < 128],
        )?;
        tx.commit()?;
    }
}

#[cfg(test)]
mod tests;
