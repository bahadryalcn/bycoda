//! File-backed Server inventory observation. SQLite intent and file replace are
//! separate commits: ambiguous recovery records a gap, never a fabricated event.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
struct Delta {
    id: String,
    change: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerObservation {
    pub sequence: i64,
    pub source_id: String,
    pub revision: i64,
    pub change: String,
    pub occurred_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerPage {
    pub gap: bool,
    pub events: Vec<ServerObservation>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerBaseline {
    pub fingerprint: String,
    pub offset: usize,
    pub next_offset: usize,
    pub total: usize,
    pub watermark: i64,
    pub source_gap: bool,
    pub entries: Vec<ServerBaselineEntry>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerBaselineEntry {
    pub source_id: String,
    pub revision: i64,
}

fn fingerprint(value: &impl Serialize) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|_| "Invalid Server inventory")?)
    ))
}
fn identities(values: &[Value]) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for value in values {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() <= 200 && !v.contains('\0'))
            .ok_or("Invalid Server identity")?;
        if result.insert(id.to_owned(), fingerprint(value)?).is_some() {
            return Err("Duplicate Server identity".into());
        }
    }
    Ok(result)
}
fn sidecar(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".observation.sqlite3");
    PathBuf::from(name)
}
fn gap_marker(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".observation-gap");
    PathBuf::from(name)
}
/// Durable conservative fallback when the journal cannot accept an intent.
pub(crate) fn mark_gap(path: &Path) -> Result<(), String> {
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(gap_marker(path))
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(path.parent().ok_or("Missing connection directory")?)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn open(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(sidecar(path)).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), gap INTEGER NOT NULL, last_digest TEXT);
      INSERT OR IGNORE INTO state VALUES(1,1,NULL);
      CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY CHECK(id=1), old_digest TEXT NOT NULL, new_digest TEXT NOT NULL, delta TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(source_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, revision INTEGER NOT NULL, change_kind TEXT NOT NULL, occurred_at INTEGER NOT NULL, UNIQUE(source_id,revision));").map_err(|e| e.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS baseline_completions_v2(request_id TEXT PRIMARY KEY, operation_hash TEXT NOT NULL, host_id TEXT NOT NULL, fingerprint TEXT NOT NULL, watermark INTEGER NOT NULL, status TEXT NOT NULL);").map_err(|e| e.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),host_id TEXT NOT NULL);").map_err(|e|e.to_string())?;
    let marker = gap_marker(path);
    if marker.exists() {
        db.execute("UPDATE state SET gap=1 WHERE id=1", [])
            .map_err(|e| e.to_string())?;
        std::fs::remove_file(marker).map_err(|e| e.to_string())?;
    }
    Ok(db)
}
fn digest(values: &[Value]) -> Result<String, String> {
    fingerprint(&identities(values)?)
}

/// Called under the existing file owner lock before each canonical file write.
pub(crate) fn prepare(path: &Path, old: &[Value], new: &[Value]) -> Result<(), String> {
    let mut db = open(path)?;
    reconcile_db(&mut db, old)?;
    let before = identities(old)?;
    let after = identities(new)?;
    let ids: BTreeSet<_> = before.keys().chain(after.keys()).cloned().collect();
    let delta: Vec<Delta> = ids
        .into_iter()
        .filter_map(|id| {
            let change = match (before.get(&id), after.get(&id)) {
                (None, Some(_)) => "created",
                (Some(_), None) => "deleted",
                (Some(a), Some(b)) if a != b => "updated",
                _ => return None,
            };
            Some(Delta {
                id,
                change: change.into(),
            })
        })
        .collect();
    db.execute(
        "INSERT INTO pending VALUES(1,?,?,?)",
        params![
            fingerprint(&before)?,
            fingerprint(&after)?,
            serde_json::to_string(&delta).map_err(|_| "Invalid Server delta")?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
/// Recheck actual file under the same owner lock after write or restart.
pub(crate) fn reconcile(path: &Path, actual: &[Value]) -> Result<(), String> {
    reconcile_db(&mut open(path)?, actual)
}
/// Caller must hold inventory lock and reconcile against the canonical file.
pub(crate) fn page(
    path: &Path,
    actual: &[Value],
    host: &str,
    after: i64,
    limit: usize,
) -> Result<ServerPage, String> {
    let mut db = open(path)?;
    reconcile_db(&mut db, actual)?;
    let gap: i64 = db
        .query_row("SELECT gap FROM state WHERE id=1", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let owner: Option<String> = db
        .query_row("SELECT host_id FROM owner WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if gap != 0 || owner.as_deref() != Some(host) {
        return Ok(ServerPage {
            gap: true,
            events: Vec::new(),
        });
    }
    let mut query = db.prepare("SELECT sequence,source_id,revision,change_kind,occurred_at FROM events WHERE sequence>? ORDER BY sequence LIMIT ?").map_err(|e| e.to_string())?;
    let events = query
        .query_map(params![after, limit.clamp(1, 100) as i64], |r| {
            Ok(ServerObservation {
                sequence: r.get(0)?,
                source_id: r.get(1)?,
                revision: r.get(2)?,
                change: r.get(3)?,
                occurred_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(ServerPage { gap: false, events })
}
pub(crate) fn acknowledge(
    path: &Path,
    sequence: i64,
    source_id: &str,
    revision: i64,
) -> Result<bool, String> {
    Ok(open(path)?
        .execute(
            "DELETE FROM events WHERE sequence=? AND source_id=? AND revision=?",
            params![sequence, source_id, revision],
        )
        .map_err(|e| e.to_string())?
        == 1)
}
/// Source page only. A trusted owner must separately record actual delivery.
pub(crate) fn baseline(
    path: &Path,
    actual: &[Value],
    host: &str,
    offset: usize,
    expected: Option<&str>,
) -> Result<ServerBaseline, String> {
    let mut db = open(path)?;
    reconcile_db(&mut db, actual)?;
    let identities = identities(actual)?;
    if identities.len() > 2048 {
        return Err("Server baseline exceeds 2048 rows".into());
    }
    let mut entries = Vec::with_capacity(identities.len());
    for id in identities.keys() {
        let revision = db
            .query_row(
                "SELECT revision FROM revisions WHERE source_id=?",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(0);
        entries.push(ServerBaselineEntry {
            source_id: id.clone(),
            revision,
        });
    }
    let watermark: i64 = db
        .query_row("SELECT COALESCE(MAX(sequence),0) FROM events", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let gap: i64 = db
        .query_row("SELECT gap FROM state WHERE id=1", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let encoded = serde_json::to_vec(&entries).map_err(|_| "Invalid Server baseline")?;
    if encoded.len() > 524288 {
        return Err("Server baseline exceeds 512 KiB".into());
    }
    let owner: Option<String> = db
        .query_row("SELECT host_id FROM owner WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let source_gap = gap != 0 || owner.as_deref() != Some(host);
    let fingerprint = fingerprint(&(host, identities, &entries, watermark, source_gap))?;
    if expected.is_some_and(|value| value != fingerprint) || offset > entries.len() {
        return Err("Server baseline changed or offset is invalid".into());
    }
    let total = entries.len();
    let next_offset = (offset + 8).min(total);
    let entries = entries
        .into_iter()
        .skip(offset)
        .take(next_offset - offset)
        .collect();
    Ok(ServerBaseline {
        fingerprint,
        offset,
        next_offset,
        total,
        watermark,
        source_gap,
        entries,
    })
}
/// Invoke only after exact Native baseline pages were actually disclosed and verified.
pub(crate) fn complete_baseline(
    path: &Path,
    actual: &[Value],
    host: &str,
    expected: &str,
    watermark: i64,
) -> Result<(), String> {
    let current = baseline(path, actual, host, 0, Some(expected))?;
    if current.watermark != watermark {
        return Err("Server baseline changed".into());
    }
    let mut db = open(path)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM events WHERE sequence<=?", [watermark])
        .map_err(|e| e.to_string())?;
    tx.execute("UPDATE state SET gap=0 WHERE id=1", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id",
        [host],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
/// The first call records intent before mutation. Pending after interruption is
/// unknown and never automatically repeated under this or another identity.
pub(crate) fn complete_baseline_once(
    path: &Path,
    actual: &[Value],
    host: &str,
    expected: &str,
    watermark: i64,
    request_id: &str,
    operation_hash: &str,
) -> Result<(), String> {
    let db = open(path)?;
    let old = db.query_row("SELECT operation_hash,host_id,fingerprint,watermark,status FROM baseline_completions_v2 WHERE request_id=?", [request_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?))).optional().map_err(|e| e.to_string())?;
    if let Some((hash, old_host, fingerprint, old_watermark, status)) = old {
        if hash != operation_hash || fingerprint != expected || old_watermark != watermark {
            return Err("Server baseline request identity changed".into());
        }
        if old_host != host {
            return Err("Server baseline Host changed".into());
        }
        return if status == "completed" {
            Ok(())
        } else {
            Err("Server baseline completion outcome is unknown".into())
        };
    }
    db.execute(
        "INSERT INTO baseline_completions_v2 VALUES(?,?,?,?,?, 'pending')",
        params![request_id, operation_hash, host, expected, watermark],
    )
    .map_err(|e| e.to_string())?;
    complete_baseline(path, actual, host, expected, watermark)?;
    db.execute("UPDATE baseline_completions_v2 SET status='completed' WHERE request_id=? AND status='pending'", [request_id]).map_err(|e| e.to_string())?;
    Ok(())
}
fn reconcile_db(db: &mut Connection, actual: &[Value]) -> Result<(), String> {
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let current = digest(actual)?;
    let pending = tx
        .query_row(
            "SELECT old_digest,new_digest,delta FROM pending WHERE id=1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((old, new, raw)) = pending {
        if current == new && old != new {
            let delta: Vec<Delta> =
                serde_json::from_str(&raw).map_err(|_| "Invalid Server observation intent")?;
            let count: i64 = tx
                .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if count.saturating_add(delta.len() as i64) > 10000 {
                tx.execute("UPDATE state SET gap=1 WHERE id=1", [])
                    .map_err(|e| e.to_string())?;
            } else {
                for entry in delta {
                    tx.execute("INSERT INTO revisions VALUES(?,1) ON CONFLICT(source_id) DO UPDATE SET revision=revision+1", [&entry.id]).map_err(|e| e.to_string())?;
                    tx.execute("INSERT INTO events(source_id,revision,change_kind,occurred_at) SELECT source_id,revision,?,CAST(strftime('%s','now') AS INTEGER)*1000 FROM revisions WHERE source_id=?", params![entry.change, entry.id]).map_err(|e| e.to_string())?;
                }
            }
        } else if current != old {
            tx.execute("UPDATE state SET gap=1 WHERE id=1", [])
                .map_err(|e| e.to_string())?;
        }
        tx.execute("DELETE FROM pending WHERE id=1", [])
            .map_err(|e| e.to_string())?;
    } else {
        let previous: Option<String> = tx
            .query_row("SELECT last_digest FROM state WHERE id=1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if previous.is_some_and(|value| value != current) {
            tx.execute("UPDATE state SET gap=1 WHERE id=1", [])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.execute("UPDATE state SET last_digest=? WHERE id=1", [&current])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn server_file_intent_recovers_only_exact_commit_and_retains_gap() {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-server-observation-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("servers.json");
        let empty = vec![];
        let first = vec![json!({"id":"a","name":"private","token":"secret"})];
        prepare(&path, &empty, &first).unwrap();
        reconcile(&path, &empty).unwrap(); // failed file replace
        assert!(page(&path, &empty, "host", 0, 10).unwrap().gap);
        prepare(&path, &empty, &first).unwrap();
        reconcile(&path, &first).unwrap(); // committed file, including restart recovery
        let snap = baseline(&path, &first, "host", 0, None).unwrap();
        assert_eq!(snap.entries[0].revision, 1);
        assert!(!serde_json::to_string(&snap).unwrap().contains("secret"));
        complete_baseline_once(
            &path,
            &first,
            "host",
            &snap.fingerprint,
            snap.watermark,
            "request",
            "operation",
        )
        .unwrap();
        assert!(page(&path, &first, "other-host", 0, 10).unwrap().gap);
        assert!(complete_baseline_once(
            &path,
            &first,
            "other-host",
            &snap.fingerprint,
            snap.watermark,
            "request",
            "operation"
        )
        .is_err());
        complete_baseline_once(
            &path,
            &first,
            "host",
            &snap.fingerprint,
            snap.watermark,
            "request",
            "operation",
        )
        .unwrap();
        assert!(complete_baseline_once(
            &path,
            &first,
            "host",
            &snap.fingerprint,
            snap.watermark,
            "request",
            "other"
        )
        .is_err());
        prepare(&path, &first, &empty).unwrap();
        reconcile(&path, &empty).unwrap();
        prepare(&path, &empty, &first).unwrap();
        reconcile(&path, &first).unwrap();
        let events = page(&path, &first, "host", 0, 10).unwrap();
        assert_eq!(
            events.events.iter().map(|e| e.revision).collect::<Vec<_>>(),
            vec![2, 3]
        );
        prepare(&path, &first, &empty).unwrap();
        reconcile(&path, &[json!({"id":"other"})]).unwrap();
        assert!(
            page(&path, &[json!({"id":"other"})], "host", 0, 10)
                .unwrap()
                .gap
        );
        let third = vec![json!({"id":"other"})];
        let replacement = baseline(&path, &third, "host", 0, None).unwrap();
        complete_baseline(
            &path,
            &third,
            "host",
            &replacement.fingerprint,
            replacement.watermark,
        )
        .unwrap();
        mark_gap(&path).unwrap();
        assert!(page(&path, &third, "host", 0, 10).unwrap().gap);
        drop(events);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
