//! Exact immutable payload used for a native workspace owner handoff.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use crate::remote::NativeServiceChannel;
use crate::remote::NativeServiceReply;
use tauri::AppHandle;

pub(super) struct WorkspaceOperation {
    pub action: String,
    pub cwd: String,
    pub input: Value,
}

pub(crate) fn authorized(channel: &Arc<NativeServiceChannel>, thread: &str, request: &str, operation_hash: &str) -> Result<bool, String> {
    if !channel.is_current() { return Err("Workspace Host changed".into()); }
    channel.project("assistant.workspace.authorize", serde_json::json!({"input":{"threadId":thread,"requestId":request,"operationHash":operation_hash}}), |value| {
        let object = value.as_object().filter(|object| object.len() == 1).ok_or("Invalid workspace authority")?;
        object.get("authorized").and_then(Value::as_bool).ok_or("Invalid workspace authority".into())
    })
}

pub(crate) fn wait_for_authority(mut query: impl FnMut() -> bool, mut wait: impl FnMut(), attempts: usize) -> bool {
    for _ in 0..attempts {
        if query() { return true; }
        wait();
    }
    false
}

pub(super) fn parse(operation_json: &str, operation_hash: &str, target_cwd: &str, request_id: &str) -> Result<WorkspaceOperation, String> {
    if operation_json.len() > 64_000 || operation_hash.len() != 64
        || !operation_hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || format!("{:x}", Sha256::digest(operation_json.as_bytes())) != operation_hash {
        return Err("Workspace operation hash changed".into());
    }
    let value: Value = serde_json::from_str(operation_json).map_err(|_| "Invalid workspace operation")?;
    let fields = value.as_array().filter(|v| v.len() == 3).ok_or("Invalid workspace operation")?;
    let action = fields[0].as_str().ok_or("Invalid workspace action")?;
    if !matches!(action, "workspace.projects.select" | "workspace.sessions.create" | "workspace.sessions.open" | "workspace.sessions.submit" | "workspace.sessions.stop" | "organization.patch") {
        return Err("Invalid workspace action".into());
    }
    let cwd = fields[1].as_str().filter(|cwd| !cwd.is_empty() && cwd.len() <= 4096 && !cwd.contains('\0') && *cwd == target_cwd).ok_or("Workspace target changed")?;
    let input = fields[2].as_object().ok_or("Invalid workspace input")?;
    if request_id.is_empty() || request_id.len() > 300 || input.get("requestId").and_then(Value::as_str) != Some(request_id) {
        return Err("Workspace request identity changed".into());
    }
    if action == "organization.patch" { crate::room_organization_owner::validate(action, &fields[2], request_id)?; }
    Ok(WorkspaceOperation { action: action.into(), cwd: cwd.into(), input: fields[2].clone() })
}

pub(super) fn execute(app: &AppHandle, request: &Value, channel: &Arc<NativeServiceChannel>, taken: &NativeServiceReply) -> Result<Value, String> {
    let field = |name: &str| request[name].as_str().filter(|s| !s.is_empty() && s.len() <= 4096).ok_or_else(|| format!("Invalid workspace {name}"));
    let environment = field("environmentId")?; let thread = field("threadId")?;
    let project = field("projectId")?; let cwd = field("targetProjectCwd")?; let relay = field("id")?;
    let input = request["input"].as_object().filter(|input| input.len() == 3).ok_or("Invalid workspace owner input")?;
    let operation_json = input.get("operationJson").and_then(Value::as_str).ok_or("Invalid workspace operation")?;
    let hash = input.get("operationHash").and_then(Value::as_str).ok_or("Invalid workspace hash")?;
    let request_id = input.get("requestId").and_then(Value::as_str).ok_or("Invalid workspace request")?;
    let operation = parse(operation_json, hash, cwd, request_id)?;
    let deadline = request["deadline"].as_u64().ok_or("Workspace deadline required")?;
    let (window, issuer) = crate::control::validate_assistant_source(app, thread, environment)?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current() || channel.environment_id() != environment || deadline <= std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64 { return Err("Workspace authority expired".into()); }
        let allowed = channel.project("conversation.desktop.authorize", serde_json::json!({"id":relay,"action":"workspace.operation.execute"}), |value| Ok(value.as_object().is_some_and(|o| o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true)))))?;
        let (current, current_issuer) = crate::control::validate_assistant_source(app, thread, environment)?;
        if !allowed || current != window || !Arc::ptr_eq(&issuer, &current_issuer) { return Err("Workspace source changed".into()); }
        taken.check()
    };
    check()?;
    crate::control::start_workspace_owner(app, thread, environment, project, &operation.cwd, &operation.action, operation.input.clone(), hash, channel)?;
    check()?;
    let receipt = serde_json::to_string(&serde_json::json!({"environmentId":environment,"threadId":thread,"issuer":issuer.identity(),"relayId":relay,"projectId":project,"targetCwd":cwd,"operationId":request_id,"action":operation.action,"originalInput":operation.input,"result":{"state":"ownerAccepted"}})).map_err(|_| "Invalid workspace receipt")?;
    let digest = format!("{:x}", Sha256::digest(receipt.as_bytes()));
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = signer.identity()["installationId"].as_str().filter(|s| !s.is_empty()).ok_or("Native identity unavailable")?.to_owned();
    let challenge = channel.request("assistant.delegation.nativeChallenge", serde_json::json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.workspace.receipt","requestDigest":digest}}))?;
    let challenge_value = challenge.project(|value| Ok(value.clone()))?;
    check()?; challenge.check()?;
    let proof = signer.sign_challenge(&challenge_value, environment, "assistant.workspace.receipt", &digest)?;
    check()?;
    Ok(serde_json::json!({"operationJson":receipt,"proof":proof}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_payload_hashes_exact_utf8_and_rejects_changed_source() {
        let json = "[\"workspace.sessions.create\",\"C:/proje\",{\"requestId\":\"orijinal\",\"title\":\"İstanbul\"}]";
        let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
        let operation = parse(json, &hash, "C:/proje", "orijinal").unwrap();
        assert_eq!(operation.action, "workspace.sessions.create");
        assert_eq!(operation.cwd, "C:/proje");
        assert_eq!(operation.input["title"], "İstanbul");
        assert!(parse(json, &hash, "C:/other", "orijinal").is_err());
        assert!(parse(json, &hash, "C:/proje", "different").is_err());
        assert!(parse(&json.replace("İstanbul", "Istanbul"), &hash, "C:/proje", "orijinal").is_err());
    }
    #[test]
    fn worker_waits_for_owner_acceptance_and_never_emits_on_timeout() {
        let mut polls = 0;
        assert!(wait_for_authority(|| { polls += 1; polls == 3 }, || {}, 4));
        assert_eq!(polls, 3);
        let mut waits = 0;
        assert!(!wait_for_authority(|| false, || waits += 1, 4));
        assert_eq!(waits, 4);
    }
    #[test]
    fn organization_write_uses_the_same_immutable_owner_parser() {
        let value = serde_json::json!(["organization.patch", "C:/project", {"requestId":"original", "expectedRevision":"a".repeat(64), "change":{"kind":"projectName", "name":"Name"}}]);
        let json = serde_json::to_string(&value).unwrap();
        let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
        assert!(parse(&json, &hash, "C:/project", "original").is_ok());
        assert!(parse(&json, &hash, "C:/other", "original").is_err());
        assert!(parse(&json, &hash, "C:/project", "other").is_err());
    }
}
