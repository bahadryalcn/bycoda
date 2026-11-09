//! Native-only receipt for closing the exact live Room voice generation.
use crate::remote::{NativeServiceChannel, NativeServiceReply};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewWindow};

fn field<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid voice retirement {key}"))
}
fn receipt(
    environment: &str,
    thread: &str,
    issuer: &str,
    relay: &str,
    generation: &str,
    request_id: &str,
    hash: &str,
) -> Value {
    json!({"environmentId":environment,"threadId":thread,"issuer":issuer,"relayId":relay,"generationKey":generation,"requestId":request_id,"operationHash":hash})
}
fn confirmed_closure(value: &Value, generation: &str) -> bool {
    value.as_object().is_some_and(|v| {
        v.len() == 2
            && v.get("generationKey").and_then(Value::as_str) == Some(generation)
            && v.get("retired") == Some(&Value::Bool(true))
    })
}

// SQLite commits each acknowledged closure atomically. Missing, corrupt, or
// mismatched evidence is never interpreted as a closed provider connection.
fn evidence_db(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|_| "Voice closure evidence unavailable")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS completed_voice_closure (installation TEXT NOT NULL, environment TEXT NOT NULL, thread TEXT NOT NULL, generation TEXT NOT NULL, request TEXT NOT NULL, operation_hash TEXT NOT NULL, issuer TEXT NOT NULL, process_generation TEXT NOT NULL, PRIMARY KEY (installation, environment, thread, generation, operation_hash))").map_err(|_| "Voice closure evidence unavailable")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS voice_runtime_birth (birth TEXT PRIMARY KEY, installation TEXT NOT NULL, issuer TEXT NOT NULL, process_generation TEXT NOT NULL, provider TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS voice_runtime_generation (birth TEXT NOT NULL, environment TEXT NOT NULL, thread TEXT NOT NULL, generation TEXT NOT NULL, PRIMARY KEY(environment,thread,generation), FOREIGN KEY(birth) REFERENCES voice_runtime_birth(birth))").map_err(|_| "Voice closure evidence unavailable")?;
    Ok(db)
}
fn app_evidence_db(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Voice closure evidence unavailable")?;
    std::fs::create_dir_all(&directory).map_err(|_| "Voice closure evidence unavailable")?;
    evidence_db(&directory.join("voice-closure-evidence.sqlite3"))
}
fn process_generation() -> &'static str {
    static PROCESS: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PROCESS.get_or_init(|| uuid::Uuid::new_v4().to_string())
}
fn valid_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= 200 && !value.contains('\0')
}
fn same_room_source(
    window: &str,
    issuer: &Arc<crate::control::receipts::WindowIssuer>,
    source: &str,
    source_issuer: &Arc<crate::control::receipts::WindowIssuer>,
) -> bool {
    window == source && Arc::ptr_eq(issuer, source_issuer) && issuer.is_live()
}
fn insert_generation(
    db: &Connection,
    birth: &str,
    environment: &str,
    thread: &str,
    generation: &str,
    issuer: &str,
    process: &str,
) -> Result<usize, String> {
    db.execute("INSERT INTO voice_runtime_generation SELECT birth,?2,?3,?4 FROM voice_runtime_birth WHERE birth=?1 AND issuer=?5 AND process_generation=?6 AND closed=0", params![birth,environment,thread,generation,issuer,process]).map_err(|_| "Voice generation registration unavailable".into())
}
#[tauri::command]
pub(crate) fn voice_runtime_birth(
    window: WebviewWindow,
    provider: String,
) -> Result<String, String> {
    if !matches!(provider.as_str(), "openai" | "grok" | "local") {
        return Err("Invalid voice provider".into());
    }
    let app = window.app_handle();
    let owner = crate::control::receipts::capture(&window)?;
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let signer_identity = signer.identity();
    let installation = field(&signer_identity, "installationId", 200)?;
    let birth = uuid::Uuid::new_v4().to_string();
    let db = app_evidence_db(app)?;
    db.execute(
        "INSERT INTO voice_runtime_birth VALUES (?1,?2,?3,?4,?5,0)",
        params![
            birth,
            installation,
            owner.identity(),
            process_generation(),
            provider
        ],
    )
    .map_err(|_| "Voice runtime registration unavailable")?;
    Ok(birth)
}
#[tauri::command]
pub(crate) fn voice_generation_bind(
    window: WebviewWindow,
    birth: String,
    environment: String,
    thread: String,
    generation: String,
) -> Result<(), String> {
    if ![&birth, &environment, &thread, &generation]
        .iter()
        .all(|v| valid_identity(v))
    {
        return Err("Invalid voice generation identity".into());
    }
    let app = window.app_handle();
    let issuer = crate::control::receipts::capture(&window)?;
    let (source, expected) = crate::control::validate_assistant_source(app, &thread, &environment)?;
    if !same_room_source(window.label(), &issuer, &source, &expected) {
        return Err("Voice Room source changed".into());
    }
    let mut db = app_evidence_db(app)?;
    let tx = db
        .transaction()
        .map_err(|_| "Voice generation registration unavailable")?;
    let changed = insert_generation(
        &tx,
        &birth,
        &environment,
        &thread,
        &generation,
        issuer.identity(),
        process_generation(),
    )?;
    if changed != 1 {
        return Err("Voice runtime registration unavailable".into());
    }
    let (current, current_owner) =
        crate::control::validate_assistant_source(app, &thread, &environment)?;
    if !same_room_source(window.label(), &issuer, &current, &current_owner) {
        return Err("Voice Room source changed".into());
    }
    tx.commit()
        .map_err(|_| "Voice generation registration unavailable")?;
    Ok(())
}
#[tauri::command]
pub(crate) fn voice_runtime_closed(window: WebviewWindow, birth: String) -> Result<(), String> {
    if !valid_identity(&birth) {
        return Err("Invalid voice runtime identity".into());
    }
    let issuer = crate::control::receipts::capture(&window)?;
    let db = app_evidence_db(window.app_handle())?;
    let changed = db.execute("UPDATE voice_runtime_birth SET closed=1 WHERE birth=?1 AND issuer=?2 AND process_generation=?3", params![birth,issuer.identity(),process_generation()]).map_err(|_| "Voice closure evidence unavailable")?;
    if changed != 1 {
        return Err("Voice runtime registration unavailable".into());
    }
    Ok(())
}
fn find_evidence(db: &Connection, identity: &[&str; 6]) -> Result<Option<String>, String> {
    db.query_row("SELECT issuer FROM completed_voice_closure WHERE installation=?1 AND environment=?2 AND thread=?3 AND generation=?4 AND operation_hash=?5", params![identity[0],identity[1],identity[2],identity[3],identity[5]], |row| row.get(0)).optional().map_err(|_| "Voice closure evidence unavailable".into())
}
fn find_closed_birth(
    db: &Connection,
    installation: &str,
    environment: &str,
    thread: &str,
    generation: &str,
) -> Result<Option<String>, String> {
    db.query_row("SELECT b.issuer FROM voice_runtime_birth b JOIN voice_runtime_generation g ON g.birth=b.birth WHERE b.installation=?1 AND g.environment=?2 AND g.thread=?3 AND g.generation=?4 AND b.closed=1", params![installation,environment,thread,generation], |row| row.get(0)).optional().map_err(|_| "Voice closure evidence unavailable".into())
}
fn live_source_birth(
    db: &Connection,
    installation: &str,
    issuer: &str,
    process: &str,
    environment: &str,
    thread: &str,
    generation: &str,
) -> Result<bool, String> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM voice_runtime_birth b JOIN voice_runtime_generation g ON b.birth=g.birth WHERE b.installation=?1 AND b.issuer=?2 AND b.process_generation=?3 AND b.closed=0 AND g.environment=?4 AND g.thread=?5 AND g.generation=?6)", params![installation,issuer,process,environment,thread,generation], |row| row.get(0)).map_err(|_| "Voice source unavailable".into())
}
fn save_evidence(
    db: &Connection,
    identity: &[&str; 6],
    issuer: &str,
    process: &str,
) -> Result<(), String> {
    db.execute(
        "INSERT OR IGNORE INTO completed_voice_closure VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            identity[0],
            identity[1],
            identity[2],
            identity[3],
            identity[4],
            identity[5],
            issuer,
            process
        ],
    )
    .map_err(|_| "Voice closure evidence unavailable")?;
    if find_evidence(db, identity)?.as_deref() != Some(issuer) {
        return Err("Voice closure evidence identity changed".into());
    }
    Ok(())
}
pub(super) fn status(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    let input = request
        .get("input")
        .filter(|v| v.as_object().is_some_and(|o| o.len() == 3))
        .ok_or("Invalid voice status input")?;
    let generation = field(input, "generationKey", 200)?;
    let request_id = field(input, "requestId", 200)?;
    let hash = field(input, "operationHash", 64)?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || channel.environment_id() != environment
    {
        return Err("Invalid voice status target".into());
    }
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Voice status deadline required")?;
    let (window, owner) = crate::control::validate_assistant_source(app, thread, environment)?;
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let signer_identity = signer.identity();
    let installation = field(&signer_identity, "installationId", 200)?;
    let db = app_evidence_db(app)?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current()
            || deadline
                <= std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Clock unavailable")?
                    .as_millis() as u64
        {
            return Err("Voice status authority expired".into());
        }
        let (current, current_owner) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if current != window || !Arc::ptr_eq(&current_owner, &owner) {
            return Err("Voice Room window issuer changed".into());
        }
        let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM voice_runtime_birth b JOIN voice_runtime_generation g ON b.birth=g.birth WHERE b.installation=?1 AND b.issuer=?2 AND b.process_generation=?3 AND b.closed=0 AND g.environment=?4 AND g.thread=?5 AND g.generation=?6)", params![installation,owner.identity(),process_generation(),environment,thread,generation], |row| row.get(0)).map_err(|_| "Voice status unavailable")?;
        if !exists {
            return Err("Voice generation status unavailable".into());
        }
        let authorized = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":"voice.generation.status"}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        if !authorized {
            return Err("Voice status authority revoked".into());
        }
        taken.check()
    };
    check()?;
    let active = crate::control::assistant_ui_request_pinned(
        app,
        thread,
        environment,
        "voice.generation.status",
        input.clone(),
        None,
        None,
        relay,
        deadline,
        channel,
        taken,
    )?;
    if !active.as_object().is_some_and(|o| {
        o.len() == 2
            && o.get("generationKey").and_then(Value::as_str) == Some(generation)
            && o.get("active") == Some(&Value::Bool(true))
    }) {
        return Err("Voice output is unavailable".into());
    }
    check()?;
    let operation_json = serde_json::to_string(&receipt(
        environment,
        thread,
        owner.identity(),
        relay,
        generation,
        request_id,
        hash,
    ))
    .map_err(|_| "Invalid voice status receipt")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.voice.generation.status","requestDigest":digest}}))?;
    let value = challenge.project(|v| Ok(v.clone()))?;
    check()?;
    challenge.check()?;
    let rechecked = crate::control::assistant_ui_request_pinned(
        app,
        thread,
        environment,
        "voice.generation.status",
        input.clone(),
        None,
        None,
        relay,
        deadline,
        channel,
        taken,
    )?;
    if !rechecked.as_object().is_some_and(|o| {
        o.len() == 2
            && o.get("generationKey").and_then(Value::as_str) == Some(generation)
            && o.get("active") == Some(&Value::Bool(true))
    }) {
        return Err("Voice output is unavailable".into());
    }
    check()?;
    let proof = signer.sign_challenge(
        &value,
        environment,
        "assistant.voice.generation.status",
        &digest,
    )?;
    check()?;
    Ok(json!({"operationJson":operation_json,"proof":proof}))
}
pub(super) fn source(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    let input = request
        .get("input")
        .filter(|v| v.as_object().is_some_and(|o| o.len() == 3))
        .ok_or("Invalid voice source input")?;
    let generation = field(input, "generationKey", 200)?;
    let request_id = field(input, "requestId", 200)?;
    let hash = field(input, "operationHash", 64)?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || channel.environment_id() != environment
    {
        return Err("Invalid voice source target".into());
    }
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Voice source deadline required")?;
    let (window, owner) = crate::control::validate_assistant_source(app, thread, environment)?;
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let signer_identity = signer.identity();
    let installation = field(&signer_identity, "installationId", 200)?;
    let db = app_evidence_db(app)?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current()
            || deadline
                <= std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Clock unavailable")?
                    .as_millis() as u64
        {
            return Err("Voice source authority expired".into());
        }
        let (current, current_owner) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if current != window || !Arc::ptr_eq(&current_owner, &owner) || !owner.is_live() {
            return Err("Voice Room window issuer changed".into());
        }
        let exists = live_source_birth(
            &db,
            installation,
            owner.identity(),
            process_generation(),
            environment,
            thread,
            generation,
        )?;
        if !exists {
            return Err("Voice generation status unavailable".into());
        }
        let authorized = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":"voice.generation.source"}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        if !authorized {
            return Err("Voice source authority revoked".into());
        }
        taken.check()
    };
    check()?;
    let active = crate::control::assistant_ui_request_pinned(
        app,
        thread,
        environment,
        "voice.generation.source",
        input.clone(),
        None,
        None,
        relay,
        deadline,
        channel,
        taken,
    )?;
    if !active.as_object().is_some_and(|o| {
        o.len() == 2
            && o.get("generationKey").and_then(Value::as_str) == Some(generation)
            && o.get("active") == Some(&Value::Bool(true))
    }) {
        return Err("Voice source is unavailable".into());
    }
    check()?;
    let operation_json = serde_json::to_string(&receipt(
        environment,
        thread,
        owner.identity(),
        relay,
        generation,
        request_id,
        hash,
    ))
    .map_err(|_| "Invalid voice source receipt")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.voice.generation.source","requestDigest":digest}}))?;
    let value = challenge.project(|v| Ok(v.clone()))?;
    check()?;
    challenge.check()?;
    let rechecked = crate::control::assistant_ui_request_pinned(
        app,
        thread,
        environment,
        "voice.generation.source",
        input.clone(),
        None,
        None,
        relay,
        deadline,
        channel,
        taken,
    )?;
    if !rechecked.as_object().is_some_and(|o| {
        o.len() == 2
            && o.get("generationKey").and_then(Value::as_str) == Some(generation)
            && o.get("active") == Some(&Value::Bool(true))
    }) {
        return Err("Voice source is unavailable".into());
    }
    check()?;
    let proof = signer.sign_challenge(
        &value,
        environment,
        "assistant.voice.generation.source",
        &digest,
    )?;
    check()?;
    Ok(json!({"operationJson":operation_json,"proof":proof}))
}
pub(super) fn retire(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    let input = request
        .get("input")
        .filter(|v| v.as_object().is_some_and(|o| o.len() == 3))
        .ok_or("Invalid voice retirement input")?;
    let generation = field(input, "generationKey", 200)?;
    let request_id = field(input, "requestId", 200)?;
    let operation_hash = field(input, "operationHash", 64)?;
    if operation_hash.len() != 64
        || !operation_hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || channel.environment_id() != environment
    {
        return Err("Invalid voice retirement target".into());
    }
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Voice retirement deadline required")?;
    let (window, owner) = crate::control::validate_assistant_source(app, thread, environment)?;
    let check = |after_closure: bool| -> Result<(), String> {
        taken.check()?;
        if !channel.is_current()
            || deadline
                <= std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Clock unavailable")?
                    .as_millis() as u64
        {
            return Err("Voice retirement authority expired".into());
        }
        let allowed = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":"voice.generation.retire"}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        if !allowed {
            return Err("Voice retirement authority revoked".into());
        }
        if after_closure {
            crate::control::validate_retirement_source(app, &window, thread, environment, &owner)?;
        } else {
            let (current, current_owner) =
                crate::control::validate_assistant_source(app, thread, environment)?;
            if current != window || !Arc::ptr_eq(&owner, &current_owner) {
                return Err("Voice Room window issuer changed".into());
            }
        }
        taken.check()
    };
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = field(&signer.identity(), "installationId", 200)?.to_owned();
    let db = app_evidence_db(app)?;
    let identity = [
        installation.as_str(),
        environment,
        thread,
        generation,
        request_id,
        operation_hash,
    ];
    check(false)?;
    let original_issuer = if let Some(original) = find_evidence(&db, &identity)?.or(
        find_closed_birth(&db, &installation, environment, thread, generation)?,
    ) {
        original
    } else {
        let closed = crate::control::assistant_ui_request_pinned(
            app,
            thread,
            environment,
            "voice.generation.retire",
            input.clone(),
            None,
            None,
            relay,
            deadline,
            channel,
            taken,
        )?;
        if !confirmed_closure(&closed, generation) {
            return Err("Exact voice generation closure was not confirmed".into());
        }
        check(true)?;
        save_evidence(&db, &identity, owner.identity(), process_generation())?;
        owner.identity().to_owned()
    };
    check(true)?;
    let operation_json = serde_json::to_string(&receipt(
        environment,
        thread,
        &original_issuer,
        relay,
        generation,
        request_id,
        operation_hash,
    ))
    .map_err(|_| "Invalid voice retirement receipt")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.voice.generation.retired","requestDigest":digest}}))?;
    let challenge_value = challenge.project(|value| Ok(value.clone()))?;
    check(true)?;
    challenge.check()?;
    let proof = signer.sign_challenge(
        &challenge_value,
        environment,
        "assistant.voice.generation.retired",
        &digest,
    )?;
    check(true)?;
    Ok(json!({"operationJson":operation_json,"proof":proof}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binding_requires_exact_live_room_window_issuer() {
        let owner = Arc::new(crate::control::receipts::WindowIssuer::default());
        let replacement = Arc::new(crate::control::receipts::WindowIssuer::default());
        assert!(same_room_source("room", &owner, "room", &owner));
        assert!(!same_room_source("room", &owner, "other", &owner));
        assert!(!same_room_source("room", &owner, "room", &replacement));
    }
    #[test]
    fn runtime_birth_only_proves_closure_after_exact_runtime_ack() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE voice_runtime_birth (birth TEXT PRIMARY KEY, installation TEXT NOT NULL, issuer TEXT NOT NULL, process_generation TEXT NOT NULL, provider TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0); CREATE TABLE voice_runtime_generation (birth TEXT NOT NULL, environment TEXT NOT NULL, thread TEXT NOT NULL, generation TEXT NOT NULL, PRIMARY KEY(environment,thread,generation))").unwrap();
        db.execute("INSERT INTO voice_runtime_birth VALUES ('birth','install','window','process','openai',0)", []).unwrap();
        db.execute("INSERT INTO voice_runtime_birth VALUES ('other-birth','install','other-window','other-process','openai',0)", []).unwrap();
        assert_eq!(
            insert_generation(
                &db,
                "birth",
                "host",
                "room",
                "wrong-issuer",
                "other-window",
                "process"
            )
            .unwrap(),
            0
        );
        assert_eq!(
            insert_generation(
                &db,
                "birth",
                "host",
                "room",
                "wrong-process",
                "window",
                "other-process"
            )
            .unwrap(),
            0
        );
        assert_eq!(
            insert_generation(
                &db,
                "birth",
                "host",
                "room",
                "generation",
                "window",
                "process"
            )
            .unwrap(),
            1
        );
        assert!(live_source_birth(
            &db,
            "install",
            "window",
            "process",
            "host",
            "room",
            "generation"
        )
        .unwrap());
        assert!(!live_source_birth(
            &db,
            "install",
            "other-window",
            "process",
            "host",
            "room",
            "generation"
        )
        .unwrap());
        assert!(!live_source_birth(
            &db,
            "install",
            "window",
            "other-process",
            "host",
            "room",
            "generation"
        )
        .unwrap());
        assert!(!live_source_birth(
            &db,
            "install",
            "window",
            "process",
            "other-host",
            "room",
            "generation"
        )
        .unwrap());
        assert!(insert_generation(
            &db,
            "other-birth",
            "host",
            "room",
            "generation",
            "other-window",
            "other-process"
        )
        .is_err());
        assert!(
            find_closed_birth(&db, "install", "host", "room", "generation")
                .unwrap()
                .is_none()
        );
        db.execute(
            "UPDATE voice_runtime_birth SET closed=1 WHERE birth='birth'",
            [],
        )
        .unwrap();
        assert!(!live_source_birth(
            &db,
            "install",
            "window",
            "process",
            "host",
            "room",
            "generation"
        )
        .unwrap());
        assert_eq!(
            insert_generation(&db, "birth", "host", "room", "late", "window", "process").unwrap(),
            0
        );
        assert_eq!(
            find_closed_birth(&db, "install", "host", "room", "generation")
                .unwrap()
                .as_deref(),
            Some("window")
        );
        assert!(
            find_closed_birth(&db, "other", "host", "room", "generation")
                .unwrap()
                .is_none()
        );
        assert!(find_closed_birth(&db, "install", "host", "room", "other")
            .unwrap()
            .is_none());
        assert!(
            find_closed_birth(&db, "install", "other", "room", "generation")
                .unwrap()
                .is_none()
        );
        assert!(
            find_closed_birth(&db, "install", "host", "other", "generation")
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn completed_evidence_survives_reopen_and_requires_exact_identity() {
        let dir = std::env::temp_dir().join(format!("voice-closure-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("evidence.sqlite3");
        let identity = [
            "installation",
            "host",
            "room",
            "generation",
            "request",
            "hash",
        ];
        let db = evidence_db(&path).unwrap();
        assert!(find_evidence(&db, &identity).unwrap().is_none());
        save_evidence(&db, &identity, "original-window", "original-process").unwrap();
        drop(db);
        let reopened = evidence_db(&path).unwrap();
        assert_eq!(
            find_evidence(&reopened, &identity).unwrap().as_deref(),
            Some("original-window")
        );
        for index in [0, 1, 2, 3, 5] {
            let mut changed = identity;
            changed[index] = "other";
            assert!(find_evidence(&reopened, &changed).unwrap().is_none());
        }
        let mut retry = identity;
        retry[4] = "new-request";
        assert_eq!(
            find_evidence(&reopened, &retry).unwrap().as_deref(),
            Some("original-window")
        );
        assert!(save_evidence(
            &reopened,
            &identity,
            "replacement-window",
            "replacement-process"
        )
        .is_err());
        drop(reopened);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn receipt_binds_exact_room_generation_and_operation() {
        let value = receipt(
            "host",
            "thread",
            "window",
            "relay",
            "generation",
            "request",
            &"a".repeat(64),
        );
        assert_eq!(value["generationKey"], "generation");
        assert_eq!(value["relayId"], "relay");
        assert_ne!(
            value,
            receipt(
                "host",
                "thread",
                "window",
                "relay",
                "other",
                "request",
                &"a".repeat(64)
            )
        );
        assert!(crate::control::desktop_effect_action(
            "voice.generation.retire"
        ));
        assert!(!crate::control::desktop_effect_action(
            "voice.generation.other"
        ));
        assert!(confirmed_closure(
            &json!({"generationKey":"generation","retired":true}),
            "generation"
        ));
        assert!(!confirmed_closure(
            &json!({"generationKey":"other","retired":true}),
            "generation"
        ));
        assert!(!confirmed_closure(
            &json!({"generationKey":"generation","retired":false}),
            "generation"
        ));
        assert!(!confirmed_closure(
            &json!({"generationKey":"generation","retired":true,"extra":1}),
            "generation"
        ));
    }
}
