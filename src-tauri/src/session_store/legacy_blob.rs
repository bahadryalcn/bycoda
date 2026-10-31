//! Retires the legacy `sessions.blocks_json` copy of transcripts that the
//! normalized rows (`session_blocks` + `session_block_state`) already cover.
//!
//! The blob duplicated every transcript (about 300 MB on a large store) and,
//! because it sits in the middle of the `sessions` record, made every read of
//! a later column and every row update walk the transcript's overflow pages.
//! Readers already resolve transcripts through the `session_transcripts` view
//! (or `session_blocks` directly), which ignores the blob while
//! `session_block_state.length >= 0`.
//!
//! Two writers empty it:
//! * the full upsert, which checkpoints the same transcript into
//!   `session_blocks` in the same transaction (`upsert_session_in_transaction`);
//! * [`compact`], a background pass for existing rows: one session per
//!   transaction, only after the normalized copy was verified to reproduce the
//!   blob byte for byte. Rows that fail verification keep their blob.
//!
//! Safety rests on the `session_blocks_checkpoint_changed` trigger: any later
//! write of a real blob (a rewind, an older client) invalidates the normalized
//! rows again (`length = -1`), so the blob becomes authoritative as before.
use super::*;
use std::time::Duration;

/// Stored instead of the transcript once the normalized rows hold it. Not
/// valid JSON on purpose: a reader that bypasses `session_transcripts` fails
/// loudly instead of seeing an empty conversation.
pub(super) const NORMALIZED_BLOB: &str = "";

const START_DELAY: Duration = Duration::from_secs(90);
const PAUSE: Duration = Duration::from_millis(200);
const BATCH: i64 = 32;
const MAX_ERRORS: usize = 8;

fn sql_error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(message.into())))
}

/// Fails unless `id` has exactly `length` contiguous normalized rows that the
/// compatibility view serves. Called inside the writing transaction.
pub(super) fn assert_normalized_complete(
    conn: &Connection,
    id: &str,
    length: usize,
) -> rusqlite::Result<()> {
    let complete: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_block_state st WHERE st.session_id=?1 AND st.length=?2
           AND (SELECT count(*) FROM session_blocks b WHERE b.session_id=?1)=?2
           AND COALESCE((SELECT min(ordinal) FROM session_blocks b WHERE b.session_id=?1),0)=0
           AND COALESCE((SELECT max(ordinal) FROM session_blocks b WHERE b.session_id=?1),-1)=?2-1)",
        params![id, length as i64],
        |row| row.get(0),
    )?;
    if complete {
        Ok(())
    } else {
        Err(sql_error(
            "Normalized transcript is incomplete; legacy copy kept",
        ))
    }
}

/// `(revision, length, blob bytes)` as verified on one read snapshot.
type Verified = (i64, i64, i64);

/// Rows that still carry a non-trivial blob next to authoritative normalized
/// rows. `octet_length` reads the record header only, never the blob.
fn candidates(conn: &Connection, after: &str) -> rusqlite::Result<Vec<String>> {
    conn.prepare(
        "SELECT st.session_id FROM session_block_state st JOIN sessions s ON s.id=st.session_id
         WHERE st.length>0 AND st.session_id>?1 AND octet_length(s.blocks_json)>2
         ORDER BY st.session_id LIMIT ?2",
    )?
    .query_map(params![after, BATCH], |row| row.get(0))?
    .collect()
}

/// One statement, so one snapshot: the normalized rows are complete, every row
/// is a JSON object, and the view's reconstruction equals the stored blob.
fn verify(conn: &Connection, id: &str) -> rusqlite::Result<Option<Verified>> {
    let row: Option<(i64, i64, i64, i64, Option<i64>, Option<i64>, i64, bool)> = conn
        .query_row(
            "SELECT st.revision, st.length, octet_length(s.blocks_json),
               (SELECT count(*) FROM session_blocks b WHERE b.session_id=s.id),
               (SELECT min(ordinal) FROM session_blocks b WHERE b.session_id=s.id),
               (SELECT max(ordinal) FROM session_blocks b WHERE b.session_id=s.id),
               (SELECT count(*) FROM session_blocks b WHERE b.session_id=s.id
                  AND (json_valid(b.block_json)=0 OR json_type(b.block_json)!='object')),
               s.blocks_json = (SELECT '[' || group_concat(block_json, ',') || ']'
                  FROM (SELECT block_json FROM session_blocks b WHERE b.session_id=s.id ORDER BY ordinal))
             FROM sessions s JOIN session_block_state st ON st.session_id=s.id WHERE s.id=?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                ))
            },
        )
        .optional()?;
    Ok(row.and_then(
        |(revision, length, bytes, count, min, max, invalid, same)| {
            (length > 0
                && bytes > 2
                && count == length
                && min == Some(0)
                && max == Some(length - 1)
                && invalid == 0
                && same)
                .then_some((revision, length, bytes))
        },
    ))
}

/// Empties one verified blob under the write lock. The recheck is the
/// normalized revision: every write of `session_blocks` or of the blob bumps
/// it (the blob through the checkpoint trigger), so an equal revision means
/// neither copy changed since [`verify`]. Returns whether it wrote.
fn retire(conn: &Connection, id: &str, verified: Verified) -> Result<bool, String> {
    let (revision, length, _) = verified;
    if authority::assert_checkpoint(conn, id).is_err() {
        return Ok(false);
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let current: Option<Verified> = tx
        .query_row(
            "SELECT st.revision, st.length, octet_length(s.blocks_json)
             FROM sessions s JOIN session_block_state st ON st.session_id=s.id WHERE s.id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if current != Some(verified) {
        return Ok(false);
    }
    tx.execute(
        "UPDATE sessions SET blocks_json=?2 WHERE id=?1",
        params![id, NORMALIZED_BLOB],
    )
    .map_err(|e| e.to_string())?;
    // The checkpoint trigger reads any blob change as a new legacy transcript
    // and invalidates the normalized rows. Nothing changed here: put the exact
    // state back, so open windows keep their delta baselines.
    let restored = tx
        .execute(
            "UPDATE session_block_state SET revision=?2,length=?3 WHERE session_id=?1",
            params![id, revision, length],
        )
        .map_err(|e| e.to_string())?;
    assert_normalized_complete(&tx, id, length as usize).map_err(|e| e.to_string())?;
    let after: Verified = tx
        .query_row(
            "SELECT st.revision, st.length, octet_length(s.blocks_json)
             FROM sessions s JOIN session_block_state st ON st.session_id=s.id WHERE s.id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    if restored != 1 || after != (revision, length, NORMALIZED_BLOB.len() as i64) {
        // Dropping `tx` rolls back; the blob stays.
        return Err(format!(
            "Legacy transcript copy of {id} kept: state did not restore"
        ));
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Background pass over existing rows in id order. Holds the write lock for one
/// row at a time and pauses between rows. Returns `(retired, errors)`.
pub(super) fn compact(store: &SessionStore, pause: Duration) -> (usize, usize) {
    let mut after = String::new();
    let mut retired = 0usize;
    let mut errors = 0usize;
    'batches: loop {
        let batch = match store
            .with_background_conn(|conn| candidates(conn, &after).map_err(|e| e.to_string()))
        {
            Ok(batch) => batch,
            Err(error) => {
                eprintln!("legacy transcript compaction: {error}");
                break;
            }
        };
        if batch.is_empty() {
            break;
        }
        for id in batch {
            after.clone_from(&id);
            let verified = match store
                .with_background_conn(|conn| verify(conn, &id).map_err(|e| e.to_string()))
            {
                Ok(Some(verified)) => verified,
                // Incomplete or different normalized copy: keep the blob.
                Ok(None) => continue,
                Err(error) => {
                    eprintln!("legacy transcript compaction: {id}: {error}");
                    errors += 1;
                    if errors >= MAX_ERRORS {
                        break 'batches;
                    }
                    continue;
                }
            };
            let admission = match store.process_write_admission() {
                Ok(admission) => admission,
                Err(_) => break 'batches,
            };
            let written = admission.finish((|| {
                let conn = store.lock_conn()?;
                retire(&conn, &id, verified)
            })());
            match written {
                Ok(true) => retired += 1,
                Ok(false) => {}
                Err(error) => {
                    eprintln!("legacy transcript compaction: {error}");
                    errors += 1;
                    if errors >= MAX_ERRORS {
                        break 'batches;
                    }
                }
            }
            std::thread::sleep(pause);
        }
    }
    (retired, errors)
}

/// Starts [`compact`] off the startup path. Failure only leaves blobs in place.
pub(super) fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("session-legacy-blob".into())
        .spawn(move || {
            std::thread::sleep(START_DELAY);
            if let Some(store) = app.try_state::<SessionStore>() {
                let (retired, errors) = compact(&store, PAUSE);
                if retired > 0 || errors > 0 {
                    eprintln!("legacy transcript compaction: {retired} retired, {errors} errors");
                }
            }
        });
    if let Err(error) = spawned {
        eprintln!("legacy transcript compaction thread: {error}");
    }
}
