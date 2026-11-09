//! An unchanged buffer report is kept alive with `native.buffers.heartbeat` instead of a new
//! report, so the 25 s keepalive adds no local history, delivery original or Host version.
//! Freshness extended here is in memory only; every durable record keeps its first timestamp.
use crate::remote::NativeWorkspaceTransport;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// A full report is sent at least this often, whatever the heartbeat answers.
const FULL_REPORT_EVERY: Duration = Duration::from_secs(10 * 60);

static BEATS: Mutex<Vec<(String, i64)>> = Mutex::new(Vec::new());
static LAST: Mutex<Option<Last>> = Mutex::new(None);

struct Last {
    owner_id: String,
    content_key: String,
    identity: String,
    sent_at: Instant,
}

/// Newest proof of life for an owner row: its stored `updated_at` or its last acknowledged heartbeat.
pub(super) fn fresh_at(owner_id: &str, updated: i64) -> i64 {
    BEATS
        .lock()
        .ok()
        .and_then(|beats| {
            beats
                .iter()
                .find(|(id, _)| id == owner_id)
                .map(|(_, at)| *at)
        })
        .map_or(updated, |at| at.max(updated))
}

fn record_beat(owner_id: &str, at: i64) {
    if let Ok(mut beats) = BEATS.lock() {
        match beats.iter_mut().find(|(id, _)| id == owner_id) {
            Some(entry) => entry.1 = at,
            None => beats.push((owner_id.into(), at)),
        }
    }
}

/// Identity of the exact report the Host holds: owner id, update stamp and report nonce, sorted.
/// The Host derives the same string from the request it stored (native-buffer-heartbeat.ts).
pub(super) fn report_identity(owners: &[Value]) -> String {
    let mut lines: Vec<String> = owners
        .iter()
        .map(|owner| {
            format!(
                "{}|{}|{}",
                owner["ownerId"].as_str().unwrap_or(""),
                owner["updatedAt"].as_i64().unwrap_or(0),
                owner["source"]["reportNonce"].as_str().unwrap_or("")
            )
        })
        .collect();
    lines.sort();
    format!("{:x}", Sha256::digest(lines.join("\n").as_bytes()))
}

/// What a report says, without its stamps: every window's buffers and whether it counts as unknown.
/// `own_raw` stands in for this window's row, which is only written when a full report is sent.
pub(super) fn content_key(
    conn: &rusqlite::Connection,
    own_id: &str,
    own_raw: &str,
    now: i64,
) -> Result<String, String> {
    let mut statement = conn
        .prepare(
            "SELECT b.owner_id,b.snapshot_json,b.updated_at,b.confirmed,i.kind
             FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut windows = vec![(own_id.to_string(), own_raw.to_string(), false)];
    for row in rows {
        let (owner, snapshot, updated, confirmed, kind) = row.map_err(|error| error.to_string())?;
        if owner == own_id {
            continue;
        }
        let unknown = kind == "unattributed"
            || kind == "retained"
            || !confirmed
            || now.saturating_sub(fresh_at(&owner, updated)) > 45_000;
        windows.push((owner, snapshot, unknown));
    }
    windows.sort();
    let body = serde_json::to_string(&windows).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(body.as_bytes())))
}

/// Call after the Host acknowledged a full physical report and it was confirmed locally.
pub(super) fn remember(owner_id: &str, content_key: String, identity: String) {
    if let Ok(mut last) = LAST.lock() {
        *last = Some(Last {
            owner_id: owner_id.into(),
            content_key,
            identity,
            sent_at: Instant::now(),
        });
    }
}

pub(super) fn forget() {
    if let Ok(mut last) = LAST.lock() {
        *last = None;
    }
}

/// The identity to heartbeat when this window's content is exactly what was last delivered.
fn due(owner_id: &str, content_key: &str) -> Option<String> {
    let last = LAST.lock().ok()?;
    let last = last.as_ref()?;
    (last.owner_id == owner_id
        && last.content_key == content_key
        && last.sent_at.elapsed() < FULL_REPORT_EVERY)
        .then(|| last.identity.clone())
}

/// True when the Host kept the previous report alive; any other outcome means send a full report.
pub(super) fn try_send(
    app: &AppHandle,
    store: &crate::session_store::SessionStore,
    owner_id: &str,
    raw: &str,
) -> bool {
    let now = super::now_millis();
    let Some(identity) = store
        .lock_conn()
        .and_then(|conn| content_key(&conn, owner_id, raw, now))
        .ok()
        .and_then(|key| due(owner_id, &key))
    else {
        return false;
    };
    let acknowledged = super::buffer_client(app)
        .and_then(|(client_id, instance_id)| {
            let host = NativeWorkspaceTransport::connect(app, "workspaces.native-activity.v1")?;
            host.project(
                "native.buffers.heartbeat",
                json!({"clientId":client_id,"instanceId":instance_id,"processId":std::process::id(),"reportIdentity":identity}),
                |response, _| Ok(response["acknowledged"] == true),
            )
        })
        .unwrap_or(false);
    if acknowledged {
        record_beat(owner_id, now);
    } else {
        forget();
    }
    acknowledged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with(rows: &[(&str, &str, i64, bool)]) -> crate::session_store::SessionStore {
        let store = crate::session_store::SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            for (owner, raw, updated, confirmed) in rows {
                let receipt = super::super::BufferReportReceipt::record(
                    &conn,
                    owner,
                    (*raw).into(),
                    *updated,
                )
                .unwrap();
                if *confirmed {
                    receipt.confirm(&conn).unwrap();
                }
            }
        }
        store
    }

    #[test]
    fn content_key_ignores_stamps_and_follows_content_and_staleness() {
        let dirty = r#"[{"path":"/a","dirty":true}]"#;
        let clean = r#"[{"path":"/a","dirty":false}]"#;
        let key = |store: &crate::session_store::SessionStore, raw: &str, now: i64| {
            content_key(&store.lock_conn().unwrap(), "hb-own", raw, now).unwrap()
        };
        let first = store_with(&[
            ("hb-own", clean, 1_000, true),
            ("hb-other", clean, 1_000, true),
        ]);
        // Same content with a newer stamp, nonce and version is the same report.
        let second = store_with(&[
            ("hb-own", clean, 9_000, true),
            ("hb-other", clean, 5_000, true),
        ]);
        assert_eq!(key(&first, clean, 2_000), key(&second, clean, 2_000));
        assert_ne!(key(&first, clean, 2_000), key(&first, dirty, 2_000));
        // The other window going stale (or unconfirmed) is a change.
        assert_ne!(key(&first, clean, 2_000), key(&first, clean, 60_000));
        let unconfirmed = store_with(&[
            ("hb-own", clean, 1_000, true),
            ("hb-other", clean, 1_000, false),
        ]);
        assert_ne!(key(&first, clean, 2_000), key(&unconfirmed, clean, 2_000));
        // A heartbeat keeps the other window alive without touching its stored row.
        record_beat("hb-other", 59_000);
        assert_eq!(key(&first, clean, 2_000), key(&first, clean, 60_000));
    }

    #[test]
    fn identity_matches_the_host_derivation_and_ignores_order() {
        let owners = [
            json!({"ownerId":"b","updatedAt":2,"source":{"reportNonce":"n2"}}),
            json!({"ownerId":"a","updatedAt":1}),
        ];
        let reversed = [owners[1].clone(), owners[0].clone()];
        assert_eq!(report_identity(&owners), report_identity(&reversed));
        // sha256("a|1|\nb|2|n2"), the string native-buffer-heartbeat.ts hashes.
        assert_eq!(
            report_identity(&owners),
            format!("{:x}", Sha256::digest(b"a|1|\nb|2|n2"))
        );
        assert_ne!(
            report_identity(&owners),
            report_identity(&[json!({"ownerId":"a","updatedAt":1})])
        );
    }

    #[test]
    fn heartbeat_is_due_only_for_the_last_delivered_content_and_forgets_on_failure() {
        remember("hb-owner", "key-1".into(), "identity-1".into());
        assert_eq!(due("hb-owner", "key-1").as_deref(), Some("identity-1"));
        assert_eq!(due("hb-owner", "key-2"), None);
        assert_eq!(due("someone-else", "key-1"), None);
        forget();
        assert_eq!(due("hb-owner", "key-1"), None);
    }

    #[test]
    fn a_heartbeat_records_no_report_version_nonce_or_delivery_original() {
        let store = store_with(&[("hb-journal", "[]", 1_000, true)]);
        // One earlier report original, so the journal table exists and can be counted.
        crate::session_store::native_delivery::prepare(
            &store,
            "hb-earlier",
            &"a".repeat(64),
            "native.buffers.update",
            r#"{"owners":[]}"#,
        )
        .unwrap();
        let counts = || {
            [
                "SELECT COUNT(*) FROM native_workspace_buffer_history",
                "SELECT COUNT(*) FROM native_delivery_originals",
                "SELECT current_version FROM native_workspace_buffer_identity WHERE owner_id='hb-journal'",
                "SELECT COUNT(*) FROM native_workspace_buffers WHERE report_nonce IS NOT NULL",
            ]
            .map(|sql| -> i64 {
                store
                    .lock_conn()
                    .unwrap()
                    .query_row(sql, [], |row| row.get(0))
                    .unwrap()
            })
        };
        let before = counts();
        // Everything a heartbeat touches in this process: key, identity and freshness only.
        let key = content_key(&store.lock_conn().unwrap(), "hb-journal", "[]", 2_000).unwrap();
        remember("hb-journal", key, "identity".into());
        record_beat("hb-journal", 30_000);
        assert_eq!(fresh_at("hb-journal", 1_000), 30_000);
        assert_eq!(counts(), before);
        forget();
    }
}
