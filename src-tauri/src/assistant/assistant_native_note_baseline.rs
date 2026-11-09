//! Native-owned personal Notes baseline, captured under the live Room issuer.
use crate::remote::{NativeServiceChannel, NativeServiceReply};
use crate::session_store::SessionStore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn field<'a>(v: &'a Value, name: &str, max: usize) -> Result<&'a str, String> {
    v.get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid Native Notes baseline {name}"))
}

pub(crate) fn capture(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    if channel.environment_id() != environment {
        return Err("Invalid Native Notes baseline source".into());
    }
    let input = request
        .get("input")
        .and_then(Value::as_object)
        .ok_or("Invalid Native Notes baseline input")?;
    if input.keys().any(|key| {
        ![
            "requestId",
            "operationHash",
            "source",
            "offset",
            "fingerprint",
        ]
        .contains(&key.as_str())
    }) || !matches!(
        input.get("source").and_then(Value::as_str),
        Some("note" | "server" | "native-session")
    ) {
        return Err("Invalid Native Notes baseline input".into());
    }
    let source = input["source"]
        .as_str()
        .ok_or("Invalid Native baseline source")?;
    let project = if source == "native-session" {
        Some((
            field(request, "projectId", 200)?,
            field(request, "targetProjectCwd", 4096)?,
        ))
    } else {
        if request.get("projectId").is_some() || request.get("targetProjectCwd").is_some() {
            return Err("Unexpected Native baseline project".into());
        }
        None
    };
    let request_id = field(&request["input"], "requestId", 200)?;
    let operation_hash = field(&request["input"], "operationHash", 64)?;
    if operation_hash.len() != 64
        || !operation_hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("Invalid Native Notes baseline hash".into());
    }
    let offset = input
        .get("offset")
        .and_then(Value::as_u64)
        .filter(|n| *n <= 2048)
        .ok_or("Invalid Native Notes baseline offset")? as usize;
    let expected = match input.get("fingerprint") {
        None | Some(Value::Null) => None,
        Some(Value::String(s))
            if s.len() == 64
                && s.bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) =>
        {
            Some(s.as_str())
        }
        _ => return Err("Invalid Native Notes baseline fingerprint".into()),
    };
    if offset > 0 && expected.is_none() {
        return Err("Native Notes baseline fingerprint required".into());
    }
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Native Notes baseline deadline required")?;
    let (label, issuer) = crate::control::validate_assistant_source(app, thread, environment)?;
    let window = app
        .get_webview_window(&label)
        .ok_or("Room window unavailable")?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current()
            || deadline
                <= std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Clock unavailable")?
                    .as_millis() as u64
        {
            return Err("Native Notes baseline authority expired".into());
        }
        let allowed = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":if project.is_some() { "observations.native.projectBaseline" } else { "observations.native.baseline" }}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        let (current, current_issuer) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if !allowed || current != label || !Arc::ptr_eq(&issuer, &current_issuer) {
            return Err("Native Notes baseline source changed".into());
        }
        taken.check()
    };
    check()?;
    let _permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let scope = crate::control::privacy_scope_admission_pinned(app, &window, &issuer)?;
    if let Some((_, cwd)) = project {
        if !scope["visibleProjects"]
            .as_array()
            .is_some_and(|projects| projects.iter().any(|p| p["cwd"].as_str() == Some(cwd)))
        {
            return Err("Native session project is unavailable or private".into());
        }
    }
    let (revision, digest) =
        crate::privacy_projection::scope_projection_metadata(app, &issuer, &scope)?;
    let page = if source == "note" {
        let store = app.state::<SessionStore>();
        serde_json::to_value(store.with_read_conn(|conn| {
            crate::assistant_observation_outbox::personal_note_baseline(
                conn,
                environment,
                offset,
                expected,
            )
        })?)
        .map_err(|_| "Invalid Native Notes baseline")?
    } else if source == "server" {
        let state = app.state::<crate::remote::RemoteConnections>();
        let _lock = state
            .store
            .lock()
            .map_err(|_| "Server inventory unavailable")?;
        let path = crate::remote::store_path(app)?;
        let records = crate::remote::read_store_values(&path)?;
        serde_json::to_value(crate::assistant_server_observation::baseline(
            &path,
            &records,
            environment,
            offset,
            expected,
        )?)
        .map_err(|_| "Invalid Server baseline")?
    } else {
        let store = app.state::<SessionStore>();
        let conn = store.lock_conn().map_err(|e| e.to_string())?;
        serde_json::to_value(crate::assistant_session_observation::baseline_page(
            &conn,
            environment,
            project.unwrap().1,
            offset,
            expected,
        )?)
        .map_err(|_| "Invalid Native session baseline")?
    };
    let mut operation_value = json!({"environmentId":environment,"threadId":thread,"issuer":issuer.identity(),"relayId":relay,"requestId":request_id,"operationHash":operation_hash,"projectionRevision":revision,"policyDigest":digest,"privacyRevision":scope["privacyRevision"],"source":source,"page":page});
    if let Some((id, cwd)) = project {
        operation_value["projectId"] = json!(id);
        operation_value["targetCwd"] = json!(cwd);
    }
    let operation =
        serde_json::to_string(&operation_value).map_err(|_| "Invalid Native Notes baseline")?;
    let hash = format!("{:x}", Sha256::digest(operation.as_bytes()));
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = field(&signer.identity(), "installationId", 200)?.to_owned();
    check()?;
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.observations.baseline","requestDigest":hash}}))?;
    let value = challenge.project(|v| Ok(v.clone()))?;
    check()?;
    challenge.check()?;
    if crate::control::privacy_scope_admission_pinned(app, &window, &issuer)? != scope
        || crate::privacy_projection::scope_projection_metadata(app, &issuer, &scope)?
            != (revision, digest)
    {
        return Err("Native Notes baseline privacy changed".into());
    }
    let proof = signer.sign_challenge(
        &value,
        environment,
        "assistant.observations.baseline",
        &hash,
    )?;
    check()?;
    Ok(json!({"operationJson":operation,"proof":proof}))
}

pub(crate) fn complete_server(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    if channel.environment_id() != environment {
        return Err("Invalid Server baseline completion source".into());
    }
    let input = request
        .get("input")
        .and_then(Value::as_object)
        .filter(|m| m.len() == 5)
        .ok_or("Invalid Server baseline completion input")?;
    let request_id = field(&request["input"], "requestId", 200)?;
    let source = field(&request["input"], "source", 10)?;
    if !matches!(source, "note" | "server" | "native-session") {
        return Err("Invalid Native baseline completion source".into());
    }
    let project = if source == "native-session" {
        Some((
            field(request, "projectId", 200)?,
            field(request, "targetProjectCwd", 4096)?,
        ))
    } else {
        if request.get("projectId").is_some() || request.get("targetProjectCwd").is_some() {
            return Err("Unexpected Native baseline project".into());
        }
        None
    };
    let operation_hash = field(&request["input"], "operationHash", 64)?;
    let fingerprint = field(&request["input"], "fingerprint", 64)?;
    let is_hash = |s: &str| {
        s.len() == 64
            && s.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    if !is_hash(operation_hash) || !is_hash(fingerprint) {
        return Err("Invalid Server baseline completion identity".into());
    }
    let watermark = input
        .get("watermark")
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0 && *n <= 9_007_199_254_740_991)
        .ok_or("Invalid Server baseline watermark")?;
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Server baseline completion deadline required")?;
    let (label, issuer) = crate::control::validate_assistant_source(app, thread, environment)?;
    let window = app
        .get_webview_window(&label)
        .ok_or("Room window unavailable")?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current()
            || deadline
                <= std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Clock unavailable")?
                    .as_millis() as u64
        {
            return Err("Server baseline completion authority expired".into());
        }
        let allowed = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":if project.is_some() { "observations.native.projectComplete" } else { "observations.native.complete" }}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        let (current, current_issuer) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if !allowed || current != label || !Arc::ptr_eq(&issuer, &current_issuer) {
            return Err("Server baseline completion source changed".into());
        }
        taken.check()
    };
    check()?;
    let _permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let scope = crate::control::privacy_scope_admission_pinned(app, &window, &issuer)?;
    if let Some((_, cwd)) = project {
        if !scope["visibleProjects"]
            .as_array()
            .is_some_and(|projects| projects.iter().any(|p| p["cwd"].as_str() == Some(cwd)))
        {
            return Err("Native session project is unavailable or private".into());
        }
    }
    let (revision, digest) =
        crate::privacy_projection::scope_projection_metadata(app, &issuer, &scope)?;
    check()?;
    let _publication = super::assistant_observation_publisher::pause_publication()?;
    if source == "server" {
        let state = app.state::<crate::remote::RemoteConnections>();
        let _lock = state
            .store
            .lock()
            .map_err(|_| "Server inventory unavailable")?;
        let path = crate::remote::store_path(app)?;
        let actual = crate::remote::read_store_values(&path)?;
        crate::assistant_server_observation::complete_baseline_once(
            &path,
            &actual,
            environment,
            fingerprint,
            watermark,
            request_id,
            operation_hash,
        )?;
    } else if source == "note" {
        let store = app.state::<SessionStore>();
        let conn = store.lock_conn().map_err(|e| e.to_string())?;
        crate::assistant_observation_outbox::complete_personal_notes_once(
            &conn,
            environment,
            fingerprint,
            watermark,
            request_id,
            operation_hash,
        )?;
    } else {
        let store = app.state::<SessionStore>();
        let conn = store.lock_conn().map_err(|e| e.to_string())?;
        crate::assistant_session_observation::complete_baseline_once(
            &conn,
            environment,
            project.unwrap().1,
            fingerprint,
            watermark,
            request_id,
            operation_hash,
        )?;
    }
    check()?;
    if crate::control::privacy_scope_admission_pinned(app, &window, &issuer)? != scope
        || crate::privacy_projection::scope_projection_metadata(app, &issuer, &scope)?
            != (revision, digest.clone())
    {
        return Err("Server baseline completion privacy changed".into());
    }
    let mut operation_value = json!({"environmentId":environment,"threadId":thread,"issuer":issuer.identity(),"relayId":relay,"requestId":request_id,"operationHash":operation_hash,"projectionRevision":revision,"policyDigest":digest,"privacyRevision":scope["privacyRevision"],"source":source,"fingerprint":fingerprint,"watermark":watermark,"completed":true});
    if let Some((id, cwd)) = project {
        operation_value["projectId"] = json!(id);
        operation_value["targetCwd"] = json!(cwd);
    }
    let operation = serde_json::to_string(&operation_value)
        .map_err(|_| "Invalid Server baseline completion")?;
    let hash = format!("{:x}", Sha256::digest(operation.as_bytes()));
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = field(&signer.identity(), "installationId", 200)?.to_owned();
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.observations.complete","requestDigest":hash}}))?;
    let value = challenge.project(|v| Ok(v.clone()))?;
    check()?;
    challenge.check()?;
    let proof = signer.sign_challenge(
        &value,
        environment,
        "assistant.observations.complete",
        &hash,
    )?;
    check()?;
    Ok(json!({"operationJson":operation,"proof":proof}))
}
