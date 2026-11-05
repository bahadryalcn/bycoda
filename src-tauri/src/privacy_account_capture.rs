//! Signed Global Room account-disclosure source; no synthetic project target.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
use tauri::{AppHandle, Manager};
use crate::remote::{NativeServiceChannel, NativeServiceReply};

static SEQUENCE: AtomicU64 = AtomicU64::new(1);
fn field<'a>(value: &'a Value, name: &str, max: usize) -> Result<&'a str, String> {
    value.get(name).and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0')).ok_or_else(|| format!("Invalid Room account proof {name}"))
}
#[allow(clippy::too_many_arguments)]
fn operation(environment: &str, thread: &str, issuer: &str, relay: &str, request_id: &str, hash: &str, revision: u64, digest: &str, privacy_revision: &Value, sequence: u64) -> Value {
    json!({"environmentId":environment,"threadId":thread,"issuer":issuer,"relayId":relay,"requestId":request_id,"operationHash":hash,"projectionRevision":revision,"policyDigest":digest,"privacyRevision":privacy_revision,"sequence":sequence})
}
pub(super) fn capture(app: &AppHandle, request: &Value, channel: &Arc<NativeServiceChannel>, taken: &NativeServiceReply) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    if request.get("projectId").is_some() || request.get("targetProjectCwd").is_some() || channel.environment_id() != environment { return Err("Invalid Global Room account source".into()); }
    let input = request.get("input").filter(|v| v.as_object().is_some_and(|o| o.len() == 2)).ok_or("Invalid Room account proof input")?;
    let request_id = field(input, "requestId", 200)?;
    let operation_hash = field(input, "operationHash", 64)?;
    if operation_hash.len() != 64 || !operation_hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) { return Err("Invalid Room account proof hash".into()); }
    let deadline = request["deadline"].as_u64().ok_or("Room account proof deadline required")?;
    let (label, owner) = crate::control::validate_assistant_source(app, thread, environment)?;
    let window = app.get_webview_window(&label).ok_or("Room window unavailable")?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current() || deadline <= std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64 { return Err("Room account authority expired".into()); }
        let allowed = channel.project("conversation.desktop.authorize", json!({"id":relay,"action":"privacy.account.capture"}), |v| Ok(v.as_object().is_some_and(|o| o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true)))))?;
        let (current, issuer) = crate::control::validate_assistant_source(app, thread, environment)?;
        if !allowed || current != label || !Arc::ptr_eq(&owner, &issuer) { return Err("Room account source changed".into()); }
        taken.check()
    };
    check()?;
    let snapshot = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
    let (revision, digest) = crate::privacy_projection::scope_projection_metadata(app, &owner, &snapshot)?;
    let sequence = SEQUENCE.try_update(Ordering::SeqCst, Ordering::SeqCst, |value| value.checked_add(1).filter(|next| *next <= 9_007_199_254_740_991)).map_err(|_| "Room account proof sequence exhausted")?;
    let operation = serde_json::to_string(&operation(environment, thread, owner.identity(), relay, request_id, operation_hash, revision, &digest, &snapshot["privacyRevision"], sequence)).map_err(|_| "Invalid Room account proof")?;
    let operation_digest = format!("{:x}", Sha256::digest(operation.as_bytes()));
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = field(&signer.identity(), "installationId", 200)?.to_owned();
    check()?;
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.account.capture","requestDigest":operation_digest}}))?;
    let value = challenge.project(|v| Ok(v.clone()))?;
    check()?; challenge.check()?;
    if crate::control::privacy_scope_admission_pinned(app, &window, &owner)? != snapshot || crate::privacy_projection::scope_projection_metadata(app, &owner, &snapshot)? != (revision, digest) { return Err("Room account privacy changed".into()); }
    let proof = signer.sign_challenge(&value, environment, "assistant.account.capture", &operation_digest)?;
    if crate::control::privacy_scope_admission_pinned(app, &window, &owner)? != snapshot { return Err("Room account privacy changed".into()); }
    check()?;
    Ok(json!({"operationJson":operation,"proof":proof}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_capture_has_exact_source_without_project_or_private_fields() {
        let proof = operation("host", "global-room", "window", "relay", "request", &"a".repeat(64), 2, &"b".repeat(64), &json!(3), 4);
        assert_eq!(proof["threadId"], "global-room");
        assert_eq!(proof["relayId"], "relay");
        assert!(proof.get("projectId").is_none());
        assert!(proof.get("targetCwd").is_none());
        assert_eq!(proof.as_object().unwrap().len(), 10);
    }
}
