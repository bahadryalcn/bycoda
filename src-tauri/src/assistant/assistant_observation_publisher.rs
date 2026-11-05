//! Publishes only locally-owned Notes outbox rows to the selected local Host.
//! The relay supplies a live window/privacy guard; failure retains all rows.
use crate::remote::NativeServiceChannel;
use crate::session_store::SessionStore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

// Only scheduling position, never an acknowledgement or delivery cursor.
static SCAN_AFTER: AtomicI64 = AtomicI64::new(0);
static PUBLISHING: AtomicBool = AtomicBool::new(false);
static SESSION_PROJECT: AtomicUsize = AtomicUsize::new(0);
pub(crate) struct PublicationFence;
impl Drop for PublicationFence {
    fn drop(&mut self) {
        PUBLISHING.store(false, Ordering::SeqCst);
    }
}
pub(crate) fn pause_publication() -> Result<PublicationFence, String> {
    PUBLISHING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Native observation publication is still in flight")?;
    Ok(PublicationFence)
}

pub(crate) fn publish_from_primary_window(
    app: &AppHandle,
    channel: &Arc<NativeServiceChannel>,
) -> Result<usize, String> {
    if PUBLISHING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(0);
    }
    struct Release;
    impl Drop for Release {
        fn drop(&mut self) {
            PUBLISHING.store(false, Ordering::SeqCst);
        }
    }
    let _publishing = Release;
    let window = app
        .get_webview_window("main")
        .ok_or("Native observation window unavailable")?;
    let owner = crate::control::receipts::capture(&window)?;
    let _permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let guard = |paths: &[String]| {
        if !owner.is_live() || !channel.is_current() {
            return Err("Native observation source changed".into());
        }
        let snapshot = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
        crate::privacy_projection::scope_projection_metadata(app, &owner, &snapshot)?;
        if paths.iter().any(|path| {
            !snapshot["visibleProjects"]
                .as_array()
                .is_some_and(|projects| {
                    projects
                        .iter()
                        .any(|project| project["cwd"].as_str() == Some(path.as_str()))
                })
        }) {
            return Err("Native observation project is unavailable or private".into());
        }
        Ok(())
    };
    let notes = publish_notes(app, channel, &guard)?;
    let servers = publish_servers(app, channel, &guard)?;
    let snapshot = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
    crate::privacy_projection::scope_projection_metadata(app, &owner, &snapshot)?;
    let cwds: Vec<String> = snapshot["visibleProjects"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| p["cwd"].as_str())
        .map(str::to_owned)
        .collect();
    let sessions = if cwds.is_empty() {
        0
    } else {
        let index = SESSION_PROJECT.fetch_add(1, Ordering::Relaxed) % cwds.len();
        publish_sessions(app, channel, &cwds[index], &guard)?
    };
    Ok(notes + servers + sessions)
}

fn publish_sessions(
    app: &AppHandle,
    channel: &Arc<NativeServiceChannel>,
    cwd: &str,
    guard: impl Fn(&[String]) -> Result<(), String>,
) -> Result<usize, String> {
    let paths = vec![cwd.to_owned()];
    guard(&paths)?;
    let store = app.state::<SessionStore>();
    let host = channel.environment_id();
    let pending = store.with_read_conn(|conn| {
        if crate::assistant_session_observation::source_gap(conn, host, cwd)
            .map_err(|e| e.to_string())?
        {
            return Ok(None);
        }
        let before = crate::assistant_session_observation::publisher_cursor(conn, host, cwd)
            .map_err(|e| e.to_string())?;
        let page = crate::assistant_session_observation::page(conn, cwd, before, 4)
            .map_err(|e| e.to_string())?;
        Ok(Some((before, page)))
    })?;
    let Some((before, page)) = pending else {
        return Ok(0);
    };
    if page.gap {
        return Ok(0);
    }
    if page.entries.is_empty() {
        guard(&paths)?;
        if !channel.is_current() {
            return Err("Native observation Host changed".into());
        }
        let conn = store.lock_conn().map_err(|e| e.to_string())?;
        crate::assistant_session_observation::commit_publisher_cursor(
            &conn,
            host,
            cwd,
            before,
            page.next_cursor,
        )
        .map_err(|e| e.to_string())?;
        return Ok(0);
    }
    let entries: Vec<Value> = page.entries.iter().map(|item| json!({"sequence":item.sequence,"sourceId":item.session_id,"revision":item.revision,"change":if item.change == "upsert" { "updated" } else { "deleted" },"sourceCwd":item.source_cwd,"occurredAt":item.timestamp})).collect();
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = signer.identity()["installationId"]
        .as_str()
        .ok_or("Native observation identity unavailable")?
        .to_owned();
    let operation = json!({"hostId":host,"installationId":installation,"source":"native-session","entries":entries});
    let operation_json =
        serde_json::to_string(&operation).map_err(|_| "Invalid Native session observation")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":host,"action":"assistant.observations.ingest","requestDigest":digest}}))?;
    let challenge_value = challenge.project(|v| Ok(v.clone()))?;
    guard(&paths)?;
    challenge.check()?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let proof = signer.sign_challenge(
        &challenge_value,
        host,
        "assistant.observations.ingest",
        &digest,
    )?;
    let reply = channel.request(
        "assistant.observations.ingest",
        json!({"input":{"operationJson":operation_json,"proof":proof}}),
    )?;
    let result = reply.project(|v| Ok(v.clone()))?;
    reply.check()?;
    guard(&paths)?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let receipts = result["receipts"]
        .as_array()
        .ok_or("Invalid Native session receipts")?;
    let sent = operation["entries"]
        .as_array()
        .ok_or("Invalid Native session batch")?;
    if receipts.len() != sent.len()
        || sent.iter().any(|item| {
            receipts
                .iter()
                .filter(|receipt| {
                    receipt["sequence"] == item["sequence"]
                        && receipt["sourceId"] == item["sourceId"]
                        && receipt["revision"] == item["revision"]
                        && receipt["journalSequence"].as_i64().is_some_and(|n| n > 0)
                })
                .count()
                != 1
        })
    {
        return Err("Native session receipt is incomplete".into());
    }
    let conn = store.lock_conn().map_err(|e| e.to_string())?;
    crate::assistant_session_observation::commit_publisher_cursor(
        &conn,
        host,
        cwd,
        before,
        page.next_cursor,
    )
    .map_err(|e| e.to_string())?;
    Ok(receipts.len())
}

fn publish_servers(
    app: &AppHandle,
    channel: &Arc<NativeServiceChannel>,
    guard: impl Fn(&[String]) -> Result<(), String>,
) -> Result<usize, String> {
    guard(&[])?;
    let state = app.state::<crate::remote::RemoteConnections>();
    let path = crate::remote::store_path(app)?;
    let page = {
        let _lock = state
            .store
            .lock()
            .map_err(|_| "Server inventory unavailable")?;
        let records = crate::remote::read_store_values(&path)?;
        crate::assistant_server_observation::page(&path, &records, channel.environment_id(), 0, 4)?
    };
    if page.gap || page.events.is_empty() {
        return Ok(0);
    }
    let entries: Vec<Value> = page.events.iter().map(|entry| json!({"sequence":entry.sequence,"sourceId":entry.source_id,"revision":entry.revision,"change":entry.change,"sourceCwd":null,"occurredAt":entry.occurred_at})).collect();
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = signer.identity()["installationId"]
        .as_str()
        .ok_or("Native observation identity unavailable")?
        .to_owned();
    let host = channel.environment_id();
    let operation =
        json!({"hostId":host,"installationId":installation,"source":"server","entries":entries});
    let operation_json =
        serde_json::to_string(&operation).map_err(|_| "Invalid Server observation")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    guard(&[])?;
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":host,"action":"assistant.observations.ingest","requestDigest":digest}}))?;
    let challenge_value = challenge.project(|v| Ok(v.clone()))?;
    guard(&[])?;
    challenge.check()?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let proof = signer.sign_challenge(
        &challenge_value,
        host,
        "assistant.observations.ingest",
        &digest,
    )?;
    let reply = channel.request(
        "assistant.observations.ingest",
        json!({"input":{"operationJson":operation_json,"proof":proof}}),
    )?;
    let value = reply.project(|v| Ok(v.clone()))?;
    reply.check()?;
    guard(&[])?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let receipts = value["receipts"]
        .as_array()
        .ok_or("Invalid Server observation receipt")?;
    let sent = operation["entries"]
        .as_array()
        .ok_or("Invalid Server observation batch")?;
    let _lock = state
        .store
        .lock()
        .map_err(|_| "Server inventory unavailable")?;
    let actual = crate::remote::read_store_values(&path)?;
    if crate::assistant_server_observation::page(&path, &actual, channel.environment_id(), 0, 1)?
        .gap
    {
        return Err("Server observation source requires a baseline".into());
    }
    let mut count = 0;
    for receipt in receipts {
        let sequence = receipt["sequence"]
            .as_i64()
            .ok_or("Invalid Server observation receipt")?;
        let id = receipt["sourceId"]
            .as_str()
            .ok_or("Invalid Server observation receipt")?;
        let revision = receipt["revision"]
            .as_i64()
            .ok_or("Invalid Server observation receipt")?;
        if !sent.iter().any(|row| {
            row["sequence"].as_i64() == Some(sequence)
                && row["sourceId"].as_str() == Some(id)
                && row["revision"].as_i64() == Some(revision)
        }) || receipt["journalSequence"]
            .as_i64()
            .filter(|n| *n > 0)
            .is_none()
        {
            return Err("Server observation receipt does not match batch".into());
        }
        if crate::assistant_server_observation::acknowledge(&path, sequence, id, revision)? {
            count += 1;
        }
    }
    Ok(count)
}

pub(crate) fn publish_notes(
    app: &AppHandle,
    channel: &Arc<NativeServiceChannel>,
    guard: impl Fn(&[String]) -> Result<(), String>,
) -> Result<usize, String> {
    let store = app.state::<SessionStore>();
    let after = SCAN_AFTER.load(Ordering::Relaxed);
    let scanned = store.with_read_conn(|conn| {
        crate::assistant_observation_outbox::page_after(conn, after, 100).map_err(|e| e.to_string())
    })?;
    let personal_gap = store.with_read_conn(|conn| {
        crate::assistant_observation_outbox::notes_gap(conn, channel.environment_id())
            .map_err(|e| e.to_string())
    })?;
    if scanned.is_empty() {
        SCAN_AFTER.store(0, Ordering::Relaxed);
        return Ok(0);
    }
    let mut rows = Vec::new();
    let mut last = after;
    for row in scanned {
        last = row.sequence;
        let allowed = match &row.source_cwd {
            Some(cwd) => guard(std::slice::from_ref(cwd)),
            None if !personal_gap => guard(&[]),
            None => Err("Native Notes source requires a baseline".into()),
        };
        if allowed.is_ok() {
            rows.push(row);
        }
        if rows.len() == 4 {
            break;
        }
    }
    SCAN_AFTER.store(last, Ordering::Relaxed);
    if rows.is_empty() {
        return Ok(0);
    }
    let paths: Vec<String> = rows
        .iter()
        .filter_map(|row| row.source_cwd.clone())
        .collect();
    guard(&paths)?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = signer.identity()["installationId"]
        .as_str()
        .ok_or("Native observation identity unavailable")?
        .to_owned();
    let host = channel.environment_id();
    let operation =
        json!({"hostId":host,"installationId":installation,"source":"note","entries":rows});
    let operation_json =
        serde_json::to_string(&operation).map_err(|_| "Invalid Native observation")?;
    if operation_json.len() > 32768 {
        return Err("Native observation batch exceeds limit".into());
    }
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{
        "installationId":installation,"hostId":host,"action":"assistant.observations.ingest","requestDigest":digest
    }}))?;
    let value = challenge.project(|v| Ok(v.clone()))?;
    guard(&paths)?;
    challenge.check()?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let proof = signer.sign_challenge(&value, host, "assistant.observations.ingest", &digest)?;
    guard(&paths)?;
    let reply = channel.request(
        "assistant.observations.ingest",
        json!({"input":{"operationJson":operation_json,"proof":proof}}),
    )?;
    let value = reply.project(|v| Ok(v.clone()))?;
    reply.check()?;
    guard(&paths)?;
    if !channel.is_current() {
        return Err("Native observation Host changed".into());
    }
    let receipts = value
        .get("receipts")
        .and_then(Value::as_array)
        .ok_or("Invalid Native observation receipt")?;
    let sent = operation["entries"]
        .as_array()
        .ok_or("Invalid Native observation batch")?;
    let mut acknowledged = 0;
    let conn = store.lock_conn().map_err(|e| e.to_string())?;
    for receipt in receipts {
        let sequence = receipt["sequence"]
            .as_i64()
            .ok_or("Invalid Native observation receipt")?;
        let source = receipt["sourceId"]
            .as_str()
            .ok_or("Invalid Native observation receipt")?;
        let revision = receipt["revision"]
            .as_i64()
            .ok_or("Invalid Native observation receipt")?;
        if !sent.iter().any(|row| {
            row["sequence"].as_i64() == Some(sequence)
                && row["sourceId"].as_str() == Some(source)
                && row["revision"].as_i64() == Some(revision)
        }) || receipt["journalSequence"]
            .as_i64()
            .filter(|n| *n > 0)
            .is_none()
        {
            return Err("Native observation receipt does not match batch".into());
        }
        if crate::assistant_observation_outbox::acknowledge(&conn, sequence, source, revision)
            .map_err(|e| e.to_string())?
        {
            acknowledged += 1;
        }
    }
    Ok(acknowledged)
}
