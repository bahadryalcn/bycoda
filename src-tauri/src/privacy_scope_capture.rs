//! One-shot Room privacy proof for an exact pending Host relay.
use crate::remote::{NativeServiceChannel, NativeServiceReply};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager};

static SEQUENCE: AtomicU64 = AtomicU64::new(1);
// A privacy writer closes this gate before invalidating the Host epoch. An
// admitted effect owns its guard until the actual canonical operation settles.
struct EffectGate {
    closed: bool,
    active: usize,
    upgrading: Option<String>,
}
fn effect_gate() -> &'static (std::sync::Mutex<EffectGate>, std::sync::Condvar) {
    static GATE: std::sync::OnceLock<(std::sync::Mutex<EffectGate>, std::sync::Condvar)> =
        std::sync::OnceLock::new();
    GATE.get_or_init(|| {
        (
            std::sync::Mutex::new(EffectGate {
                closed: false,
                active: 0,
                upgrading: None,
            }),
            std::sync::Condvar::new(),
        )
    })
}
pub(crate) struct EffectPermit {
    active: bool,
}
impl Drop for EffectPermit {
    fn drop(&mut self) {
        let (lock, changed) = effect_gate();
        if self.active {
            if let Ok(mut gate) = lock.lock() {
                gate.active = gate.active.saturating_sub(1);
                changed.notify_all();
            }
        }
    }
}
pub(crate) fn begin_effect() -> Result<EffectPermit, String> {
    let (lock, _) = effect_gate();
    let mut gate = lock.lock().map_err(|_| "Privacy effect gate unavailable")?;
    if gate.closed {
        return Err("Privacy transition pending".into());
    }
    gate.active = gate
        .active
        .checked_add(1)
        .ok_or("Too many privacy effects")?;
    Ok(EffectPermit { active: true })
}
pub(crate) fn retain_effect(id: &str, permit: EffectPermit) -> Result<(), String> {
    let mut pending = retained_effects()
        .lock()
        .map_err(|_| "Privacy effect registry unavailable")?;
    if pending.len() >= 64 || pending.contains_key(id) {
        return Err("Privacy effect capacity unavailable".into());
    }
    pending.insert(id.to_owned(), permit);
    Ok(())
}
pub(crate) fn settle_effect(id: &str) {
    if let Ok(mut pending) = retained_effects().lock() {
        pending.remove(id);
    }
}
fn retained_effects() -> &'static std::sync::Mutex<std::collections::HashMap<String, EffectPermit>>
{
    static PENDING: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, EffectPermit>>,
    > = std::sync::OnceLock::new();
    PENDING.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}
pub(crate) fn begin_write() -> Result<(), String> {
    let (lock, changed) = effect_gate();
    let mut gate = lock.lock().map_err(|_| "Privacy effect gate unavailable")?;
    if gate.closed {
        return Err("Privacy transition pending".into());
    }
    gate.closed = true;
    while gate.active != 0 {
        gate = changed
            .wait(gate)
            .map_err(|_| "Privacy effect gate unavailable")?;
    }
    Ok(())
}
// Called only after native control has verified this exact pending request and
// WindowIssuer. Exclude its own permit while draining every other effect; the
// permit remains retained and is restored before admission reopens.
pub(crate) fn begin_write_for_effect(id: &str) -> Result<(), String> {
    let mut pending = retained_effects()
        .lock()
        .map_err(|_| "Privacy effect registry unavailable")?;
    let permit = pending.get_mut(id).ok_or("Privacy effect is unavailable")?;
    let (lock, changed) = effect_gate();
    let mut gate = lock.lock().map_err(|_| "Privacy effect gate unavailable")?;
    if gate.closed || !permit.active || gate.active == 0 {
        return Err("Privacy transition pending".into());
    }
    gate.closed = true;
    gate.upgrading = Some(id.to_owned());
    permit.active = false;
    gate.active -= 1;
    drop(pending);
    while gate.active != 0 {
        gate = changed
            .wait(gate)
            .map_err(|_| "Privacy effect gate unavailable")?;
    }
    Ok(())
}
pub(crate) fn end_write() {
    let (lock, changed) = effect_gate();
    if let Ok(mut pending) = retained_effects().lock() {
        if let Ok(mut gate) = lock.lock() {
            if let Some(id) = gate.upgrading.take() {
                if let Some(permit) = pending.get_mut(&id) {
                    permit.active = true;
                    gate.active += 1;
                }
            }
            gate.closed = false;
            changed.notify_all();
        }
    }
}

fn string<'a>(object: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid privacy proof {key}"))
}
/// Admits a target that is visible under the frontend's path identity (slashes, trailing
/// slash, Windows case). The Host checks its own spelling against the signed scope, so the
/// matching visible entry is recorded with the target's spelling.
fn admit_visible_target(visible: &mut [String], cwd: &str) -> Result<(), String> {
    let key = crate::session_store::project_path_key(cwd);
    let entry = visible
        .iter_mut()
        .find(|path| crate::session_store::project_path_key(path) == key)
        .ok_or("Target project is unavailable or private")?;
    cwd.clone_into(entry);
    Ok(())
}

/// Whether a privacy snapshot lists `cwd` as visible under the same path identity.
pub(crate) fn visible_projects_include(snapshot: &Value, cwd: &str) -> bool {
    let key = crate::session_store::project_path_key(cwd);
    snapshot["visibleProjects"].as_array().is_some_and(|items| {
        items.iter().any(|item| {
            item["cwd"]
                .as_str()
                .is_some_and(|path| crate::session_store::project_path_key(path) == key)
        })
    })
}

fn hash_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
#[allow(clippy::too_many_arguments)]
fn proof_operation(
    environment: &str,
    thread: &str,
    issuer: &str,
    relay: &str,
    project: &str,
    cwd: &str,
    action: &str,
    request_id: &str,
    operation_hash: &str,
    revision: u64,
    policy_digest: &str,
    snapshot: &Value,
    visible: &[String],
    sequence: u64,
) -> Value {
    json!({"environmentId":environment,"threadId":thread,"issuer":issuer,"relayId":relay,"projectId":project,"targetCwd":cwd,"action":action,"requestId":request_id,"operationHash":operation_hash,"projectionRevision":revision,"policyDigest":policy_digest,"privacyRevision":snapshot["privacyRevision"],"visibleCwds":visible,"sequence":sequence})
}

pub(super) fn capture(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = string(request, "environmentId", 200)?;
    let thread = string(request, "threadId", 200)?;
    let project = string(request, "projectId", 200)?;
    let cwd = string(request, "targetProjectCwd", 4096)?;
    let relay = string(request, "id", 200)?;
    let input = request
        .get("input")
        .and_then(Value::as_object)
        .ok_or("Invalid privacy proof input")?;
    if input.len() != 3
        || !input.contains_key("action")
        || !input.contains_key("requestId")
        || !input.contains_key("operationHash")
    {
        return Err("Invalid privacy proof input".into());
    }
    let input = Value::Object(input.clone());
    let operation_action = string(&input, "action", 200)?;
    let request_id = string(&input, "requestId", 200)?;
    let operation_hash = string(&input, "operationHash", 64)?;
    if !hash_valid(operation_hash) || channel.environment_id() != environment {
        return Err("Invalid privacy proof target".into());
    }
    let (window_label, owner) =
        crate::control::validate_assistant_source(app, thread, environment)?;
    let window = app
        .get_webview_window(&window_label)
        .ok_or("Room window unavailable")?;
    let check = || -> Result<(), String> {
        taken.check()?;
        if !channel.is_current() {
            return Err("Room Host changed".into());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64;
        if request["deadline"].as_u64().is_none_or(|v| v <= now) {
            return Err("Privacy proof request expired".into());
        }
        let allowed = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":"privacy.scope.capture"}),
            |v| Ok(v["authorized"] == true),
        )?;
        if !allowed {
            return Err("Room authority revoked".into());
        }
        let (current, current_owner) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if current != window_label || !Arc::ptr_eq(&owner, &current_owner) {
            return Err("Room window issuer changed".into());
        }
        taken.check()
    };
    check()?;
    let snapshot = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
    let (revision, policy_digest) =
        crate::privacy_projection::scope_projection_metadata(app, &owner, &snapshot)?;
    let mut visible = snapshot["visibleProjects"]
        .as_array()
        .ok_or("Invalid visible project scope")?
        .iter()
        .map(|item| {
            item.get("cwd")
                .and_then(Value::as_str)
                .filter(|path| !path.is_empty() && path.len() <= 4096)
                .map(str::to_owned)
                .ok_or("Invalid visible project scope")
        })
        .collect::<Result<Vec<_>, _>>()?;
    admit_visible_target(&mut visible, cwd)?;
    let sequence = SEQUENCE
        .try_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
            value
                .checked_add(1)
                .filter(|next| *next <= 9_007_199_254_740_991)
        })
        .map_err(|_| "Privacy proof sequence exhausted")?;
    let operation = proof_operation(
        environment,
        thread,
        owner.identity(),
        relay,
        project,
        cwd,
        operation_action,
        request_id,
        operation_hash,
        revision,
        &policy_digest,
        &snapshot,
        &visible,
        sequence,
    );
    let operation_json = serde_json::to_string(&operation).map_err(|_| "Invalid privacy proof")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = string(&signer.identity(), "installationId", 200)?.to_owned();
    check()?;
    let challenge=channel.request("assistant.delegation.nativeChallenge",json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.visibility.capture","requestDigest":digest}}))?;
    let challenge_value = challenge.project(|value| Ok(value.clone()))?;
    check()?;
    challenge.check()?;
    let current = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
    if current != snapshot
        || crate::privacy_projection::scope_projection_metadata(app, &owner, &current)?
            != (revision, policy_digest.clone())
    {
        return Err("Privacy scope changed before capture".into());
    }
    check()?;
    let proof = signer.sign_challenge(
        &challenge_value,
        environment,
        "assistant.visibility.capture",
        &digest,
    )?;
    if crate::control::privacy_scope_admission_pinned(app, &window, &owner)? != snapshot {
        return Err("Privacy scope changed before capture".into());
    }
    check()?;
    Ok(json!({"operationJson":operation_json,"proof":proof}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privacy_writer_waits_for_physical_effect_and_closes_new_admissions() {
        let permit = begin_effect().expect("effect admitted");
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (drained_tx, drained_rx) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            begin_write().unwrap();
            drained_tx.send(()).unwrap();
        });
        started_rx.recv().unwrap();
        for _ in 0..1000 {
            if begin_effect().is_err() {
                break;
            }
            std::thread::yield_now();
        }
        assert!(begin_effect().is_err());
        assert!(drained_rx.try_recv().is_err());
        drop(permit);
        drained_rx.recv().unwrap();
        writer.join().unwrap();
        assert!(begin_effect().is_err());
        end_write();
        assert!(begin_effect().is_ok());

        retain_effect("workspace-upgrade-test", begin_effect().unwrap()).unwrap();
        assert!(begin_write_for_effect("different-request").is_err());
        let other = begin_effect().unwrap();
        let (drained_tx, drained_rx) = std::sync::mpsc::channel();
        let upgrade = std::thread::spawn(move || {
            begin_write_for_effect("workspace-upgrade-test").unwrap();
            drained_tx.send(()).unwrap();
        });
        while begin_effect().is_ok() {
            std::thread::yield_now();
        }
        assert!(drained_rx.try_recv().is_err());
        drop(other);
        drained_rx.recv().unwrap();
        upgrade.join().unwrap();
        assert!(begin_effect().is_err());
        end_write();
        let (completed_tx, completed_rx) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            begin_write().unwrap();
            completed_tx.send(()).unwrap();
        });
        while begin_effect().is_ok() {
            std::thread::yield_now();
        }
        assert!(completed_rx.try_recv().is_err());
        settle_effect("workspace-upgrade-test");
        completed_rx.recv().unwrap();
        writer.join().unwrap();
        end_write();
    }
    #[test]
    fn privacy_proof_contains_only_exact_target_and_redacted_scope() {
        let snapshot = json!({"privacyRevision":4,"stableStorageKeys":{"password":"never-disclose","groupName":"private-name"},"visibleProjects":[{"cwd":"C:/fixture"}]});
        let operation = proof_operation(
            "host",
            "thread",
            "issuer",
            "relay",
            "project",
            "C:/fixture",
            "tasks.get",
            "request",
            &"a".repeat(64),
            2,
            &"b".repeat(64),
            &snapshot,
            &["C:/fixture".into()],
            8,
        );
        let serialized = operation.to_string();
        assert!(!serialized.contains("never-disclose"));
        assert!(!serialized.contains("private-name"));
        assert_eq!(operation["relayId"], "relay");
        assert_eq!(operation["requestId"], "request");
        assert_eq!(operation["visibleCwds"], json!(["C:/fixture"]));
    }
    #[test]
    fn visible_target_matches_path_identity_and_keeps_host_spelling() {
        let mut visible = vec!["C:/Fixture/".to_owned(), "D:/other".to_owned()];
        let target = r"c:\fixture";
        admit_visible_target(&mut visible, target).unwrap();
        assert_eq!(visible, vec![target.to_owned(), "D:/other".to_owned()]);
        assert!(admit_visible_target(&mut visible, "C:/fixture-private").is_err());
        let mut unix = vec!["/home/Owner/repo".to_owned()];
        assert!(admit_visible_target(&mut unix, "/home/owner/repo").is_err());
    }
}
