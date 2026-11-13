//! Private callback for a standing-consent effect from the registered global Room.
use crate::remote::{NativeServiceChannel, NativeServiceReply};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

fn field<'a>(value: &'a Value, name: &str, max: usize) -> Result<&'a str, String> {
    value[name].as_str().filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid background effect {name}"))
}

pub(super) fn execute(app: &AppHandle, request: &Value, channel: &Arc<NativeServiceChannel>, taken: &NativeServiceReply) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    if environment != channel.environment_id() || request.get("projectId").is_some() || request.get("sessionId").is_some() {
        return Err("Invalid background Room source".into());
    }
    let input = &request["input"];
    let source_json = field(input, "sourceJson", 32768)?;
    let hash = field(input, "operationHash", 64)?;
    let challenge = field(input, "challenge", 64)?;
    if hash.len() != 64 || challenge.len() != 64 || !hash.bytes().chain(challenge.bytes()).all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        return Err("Invalid background effect challenge".into());
    }
    let source: Value = serde_json::from_str(source_json).map_err(|_| "Invalid background effect source")?;
    if source["environmentId"].as_str() != Some(environment) || source["threadId"].as_str() != Some(thread) {
        return Err("Background effect source changed".into());
    }
    let operation_id = field(&source, "operationId", 200)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64;
    let deadline = request["deadline"].as_u64().ok_or("Relay deadline required")?.min(input["expiresAt"].as_u64().ok_or("Effect deadline required")?);
    if deadline <= now { return Err("Background effect expired".into()); }
    let check = || -> Result<(), String> {
        taken.check()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64;
        if deadline <= now { return Err("Background effect expired".into()); }
        let allowed = channel.project("conversation.desktop.authorize", json!({"id": relay, "action": "assistant.background.effect"}), |v| Ok(v["authorized"] == true))?;
        if !allowed { return Err("Background effect relay revoked".into()); }
        taken.check()
    };
    check()?;
    let result = crate::assistant_standing_consent::with_background_effect(app, channel, source_json, hash, || {
        check()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64;
        if deadline <= now { return Err("Background effect expired".into()); }
        channel.project_until("assistant.background.execute", json!({"input": {
            "environmentId": environment, "threadId": thread, "operationId": operation_id,
            "operationHash": hash, "challenge": challenge, "relayId": relay
        }}), Instant::now() + Duration::from_millis(deadline - now), |value| Ok(value.clone()))
    });
    match result {
        Ok(value) => Ok(json!({"state":"completed", "result": value})),
        Err(error) if error == "Native consent does not allow this effect" => Ok(json!({"state":"denied"})),
        Err(error) => Err(error),
    }
}
