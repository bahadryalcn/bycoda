//! Native compare-and-swap storage for the renderer privacy projection.
//! Host effects require a separate live issuer proof. Explicit closed-scope
//! recovery preserves an older record before committing its replacement.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, WebviewWindow};

static LOCK: Mutex<()> = Mutex::new(());
static TRANSITION_LOCK: Mutex<()> = Mutex::new(());
struct PendingTransition {
    actor: String,
    operation_id: String,
    baseline: Option<Option<Projection>>,
}
static PENDING_TRANSITION: Mutex<Option<PendingTransition>> = Mutex::new(None);
const MAX_BYTES: usize = 1024 * 1024;

fn contains_ephemeral_unlock(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, child)| {
            let key = key.to_ascii_lowercase();
            matches!(
                key.as_str(),
                "unlocked"
                    | "unlockedgroups"
                    | "unlockedgroupids"
                    | "temporarilyvisible"
                    | "visiblehiddenids"
            ) || key.ends_with(".unlocked")
                || contains_ephemeral_unlock(child)
        }),
        Value::Array(items) => items.iter().any(contains_ephemeral_unlock),
        _ => false,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Projection {
    version: u64,
    revision: u64,
    operation_id: String,
    actor: String,
    snapshot: Value,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("privacy-projection-v1.json"))
}

fn read(path: &Path) -> Result<Option<Projection>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => match std::fs::symlink_metadata(path)
        {
            Err(missing) if missing.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            _ => return Err("Privacy projection is unavailable".into()),
        },
        Err(_) => return Err("Privacy projection is unavailable".into()),
    };
    if bytes.len() > MAX_BYTES {
        return Err("Privacy projection is invalid".into());
    }
    let result: Projection =
        serde_json::from_slice(&bytes).map_err(|_| "Privacy projection is invalid")?;
    if result.version != 1
        || result.revision == 0
        || result.actor.is_empty()
        || result.operation_id.is_empty()
        || !result.snapshot.is_object()
        || contains_ephemeral_unlock(&result.snapshot)
    {
        return Err("Privacy projection is invalid".into());
    }
    Ok(Some(result))
}

/// Read only the committed projection metadata after checking the live window snapshot.
pub(crate) fn scope_projection_metadata(
    app: &AppHandle,
    expected: &Arc<crate::control::receipts::WindowIssuer>,
    scope: &Value,
) -> Result<(u64, String), String> {
    expected.with_live(|| {
        if PENDING_TRANSITION
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?
            .is_some()
        {
            return Err("Privacy protection is pending".into());
        }
        let _guard = LOCK
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        let projection = read(&path(app)?)?.ok_or("Committed privacy projection is unavailable")?;
        require_acknowledged_projection(&projection, expected.identity(), scope)?;
        let bytes =
            serde_json::to_vec(&projection.snapshot).map_err(|_| "Invalid privacy projection")?;
        Ok((projection.revision, format!("{:x}", Sha256::digest(bytes))))
    })
}

fn require_lease_baseline(
    baseline: &Option<Projection>,
    current: &Option<Projection>,
    actor: &str,
    operation_id: &str,
    expected: Option<u64>,
    snapshot: &Value,
) -> Result<(), String> {
    if baseline == current {
        return Ok(());
    }
    // A durable write can succeed before its acknowledgement is lost. Only the
    // exact original operation may reconcile that committed result.
    let original_revision = baseline.as_ref().map(|value| value.revision);
    let next_revision = original_revision.unwrap_or(0).checked_add(1);
    if expected == original_revision
        && current.as_ref().is_some_and(|value| {
            value.actor == actor
                && value.operation_id == operation_id
                && value.snapshot == *snapshot
                && Some(value.revision) == next_revision
        })
    {
        return Ok(());
    }
    Err("Privacy transition baseline changed".into())
}

fn require_rebase_not_applied(
    current: Option<&Projection>,
    old_id: &str,
    expected: Option<u64>,
) -> Result<(), String> {
    if old_id.is_empty()
        || current.map(|item| item.revision) != expected
        || current.is_some_and(|item| item.operation_id == old_id)
    {
        return Err("Privacy recovery outcome requires reconciliation".into());
    }
    Ok(())
}

fn require_rebase_applied(
    current: Option<&Projection>,
    actor: &str,
    old_id: &str,
    old_expected: Option<u64>,
    old_snapshot: &Value,
    expected: Option<u64>,
) -> Result<(), String> {
    let old_revision = old_expected.unwrap_or(0).checked_add(1);
    if !current.is_some_and(|item| {
        item.actor == actor
            && item.operation_id == old_id
            && item.snapshot == *old_snapshot
            && Some(item.revision) == old_revision
            && Some(item.revision) == expected
    }) {
        return Err("Privacy recovery outcome requires reconciliation".into());
    }
    Ok(())
}

fn require_acknowledged_projection(
    projection: &Projection,
    issuer: &str,
    scope: &Value,
) -> Result<(), String> {
    if projection.actor != issuer
        || scope["committedProjectionSeen"].as_u64() != Some(projection.revision)
        || projection.snapshot != scope["stableStorageKeys"]
    {
        return Err("Privacy scope does not match the acknowledged window projection".into());
    }
    Ok(())
}

// Admission remains closed while the owner reviews this exact live scope.
fn require_closed_recovery(previous: &Projection, scope: &Value) -> Result<(), String> {
    if previous.snapshot.get("lockedGroupIds").is_some() {
        return Err("Privacy projection is not eligible for closed recovery".into());
    }
    require_recovery_scope(scope)
}

fn require_recovery_scope(scope: &Value) -> Result<(), String> {
    let snapshot = &scope["stableStorageKeys"];
    snapshot
        .get("groups")
        .and_then(Value::as_array)
        .ok_or("Privacy groups are unavailable")?;
    let locked = snapshot
        .get("lockedGroupIds")
        .and_then(Value::as_array)
        .ok_or("Privacy locks are unavailable")?;
    if locked
        .iter()
        .any(|id| id.as_str().is_none_or(str::is_empty))
        || scope
            .get("visibleProjects")
            .and_then(Value::as_array)
            .is_none_or(|items| {
                items.iter().any(|item| {
                    item.get("cwd")
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
                })
            })
    {
        return Err("Privacy recovery scope is invalid".into());
    }
    Ok(())
}

fn preserve_recovery_record(path: &Path, previous: &Projection) -> Result<(), String> {
    let backup = path.with_extension(format!("v1-recovery-{}.json", previous.revision));
    let bytes = std::fs::read(path).map_err(|_| "Privacy projection is unavailable")?;
    if backup.exists() {
        if std::fs::read(&backup).map_err(|_| "Privacy recovery backup is unavailable")? != bytes {
            return Err("Privacy recovery backup differs".into());
        }
    } else {
        crate::file_access::durable_write(&backup, &bytes)
            .map_err(|_| "Privacy recovery backup is unavailable")?;
    }
    Ok(())
}

/// A second window cannot supersede a lock it has not observed. This fences
/// BroadcastChannel/storage delivery lag without changing the local UI state.
fn ensure_cross_window_locks(
    previous: Option<&Projection>,
    actor: &str,
    next: &Value,
) -> Result<(), String> {
    let Some(previous) = previous else {
        return Ok(());
    };
    let locked = |value: &Value| -> Result<std::collections::BTreeSet<String>, String> {
        value
            .get("lockedGroupIds")
            .and_then(Value::as_array)
            .ok_or("Privacy lock state is unavailable")?
            .iter()
            .map(|entry| {
                entry
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned)
                    .ok_or_else(|| "Privacy lock state is invalid".to_string())
            })
            .collect()
    };
    let previous_locked = locked(&previous.snapshot)?;
    let next_locked = locked(next)?;
    if previous.actor == actor {
        return Ok(());
    }
    if !previous_locked.is_subset(&next_locked) {
        return Err("Privacy lock state has not reached this window".into());
    }
    let mut previous_policy = previous
        .snapshot
        .as_object()
        .cloned()
        .ok_or("Privacy policy is invalid")?;
    let mut next_policy = next
        .as_object()
        .cloned()
        .ok_or("Privacy policy is invalid")?;
    previous_policy.remove("lockedGroupIds");
    next_policy.remove("lockedGroupIds");
    if previous_policy != next_policy {
        return Err("Privacy policy has not been acknowledged by this window".into());
    }
    Ok(())
}

fn compare_and_swap(
    path: &Path,
    expected: Option<u64>,
    operation_id: &str,
    actor: &str,
    snapshot: Value,
) -> Result<Projection, String> {
    compare_and_swap_with(
        path,
        expected,
        operation_id,
        actor,
        snapshot,
        crate::file_access::durable_write,
    )
}

fn compare_and_swap_with(
    path: &Path,
    expected: Option<u64>,
    operation_id: &str,
    actor: &str,
    snapshot: Value,
    write: impl FnOnce(&Path, &[u8]) -> Result<(), String>,
) -> Result<Projection, String> {
    if operation_id.is_empty()
        || operation_id.len() > 200
        || actor.is_empty()
        || !snapshot.is_object()
        || contains_ephemeral_unlock(&snapshot)
    {
        return Err("Invalid privacy projection update".into());
    }
    let previous = read(path)?;
    if let Some(current) = &previous {
        if current.operation_id == operation_id {
            let original = if current.revision == 1 {
                None
            } else {
                Some(current.revision - 1)
            };
            return if current.actor == actor && current.snapshot == snapshot && original == expected
            {
                Ok(current.clone())
            } else {
                Err("Privacy projection operation identity changed".into())
            };
        }
    }
    if previous.as_ref().map(|item| item.revision) != expected {
        return Err("Privacy projection revision changed".into());
    }
    let revision = expected
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("Privacy projection revision exhausted")?;
    let result = Projection {
        version: 1,
        revision,
        operation_id: operation_id.into(),
        actor: actor.into(),
        snapshot,
    };
    let bytes = serde_json::to_vec(&result).map_err(|_| "Invalid privacy projection update")?;
    if bytes.len() > MAX_BYTES {
        return Err("Privacy projection is too large".into());
    }
    std::fs::create_dir_all(path.parent().ok_or("Invalid privacy projection path")?)
        .map_err(|_| "Privacy projection is unavailable")?;
    // A failed durable write may have replaced the file; callers reconcile by
    // reading the original operation ID, never by inventing a new one.
    write(path, &bytes).map_err(|_| "Privacy projection write outcome unknown")?;
    Ok(result)
}

#[tauri::command(async)]
pub fn control_privacy_projection_read(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<Projection>, String> {
    let issuer = crate::control::receipts::capture(&window)?;
    issuer.with_live(|| {
        let _guard = LOCK
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        read(&path(&app)?)
    })
}

/// Reserve the native transition and drain Host admission before a renderer may
/// write privacy state. A failed or uncertain begin remains held, never reopened.
#[tauri::command(async)]
pub fn control_privacy_projection_begin(
    app: AppHandle,
    window: WebviewWindow,
    operation_id: String,
    workspace_request_id: Option<String>,
) -> Result<(), String> {
    let issuer = crate::control::receipts::capture(&window)?;
    if operation_id.is_empty() || operation_id.len() > 200 {
        return Err("Invalid privacy operation".into());
    }
    if let Some(id) = workspace_request_id.as_deref() {
        issuer.with_live(|| {
            crate::control::validate_workspace_privacy_upgrade(&app, &window, &issuer, id)
        })?;
    }
    let _transition = TRANSITION_LOCK
        .lock()
        .map_err(|_| "Privacy projection is unavailable")?;
    let created = issuer.with_live(|| {
        let mut pending = PENDING_TRANSITION
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        if let Some(existing) = pending.as_ref() {
            if existing.actor != issuer.identity() || existing.operation_id != operation_id {
                return Err("Another privacy transition is pending".into());
            }
            Ok(false)
        } else {
            *pending = Some(PendingTransition {
                actor: issuer.identity().into(),
                operation_id: operation_id.clone(),
                baseline: None,
            });
            Ok(true)
        }
    })?;
    if created {
        if let Some(id) = workspace_request_id.as_deref() {
            issuer.with_live(|| {
                crate::control::validate_workspace_privacy_upgrade(&app, &window, &issuer, id)
            })?;
            crate::conversation_tools_bridge::privacy_scope_capture::begin_write_for_effect(id)?;
            issuer.with_live(|| {
                crate::control::validate_workspace_privacy_upgrade(&app, &window, &issuer, id)
            })?;
        } else {
            crate::conversation_tools_bridge::privacy_scope_capture::begin_write()?;
        }
    }
    let channel = crate::remote::NativeServiceChannel::connect(&app)?;
    channel.project(
        "assistant.visibility.revoke",
        serde_json::json!({}),
        |value| {
            value
                .get("epoch")
                .and_then(Value::as_u64)
                .map(|_| ())
                .ok_or_else(|| "Invalid Room visibility response".into())
        },
    )?;
    let needs_baseline = {
        let pending = PENDING_TRANSITION
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        pending.as_ref().is_some_and(|item| item.baseline.is_none())
    };
    if needs_baseline {
        let scope = crate::control::privacy_scope_snapshot_pinned(&app, &window, &issuer)?;
        let previous = issuer.with_live(|| {
            let _guard = LOCK
                .lock()
                .map_err(|_| "Privacy projection is unavailable")?;
            let previous = read(&path(&app)?)?;
            // Every pre-write snapshot must match the committed policy.
            ensure_cross_window_locks(previous.as_ref(), "", &scope["stableStorageKeys"])?;
            Ok(previous)
        })?;
        let mut pending = PENDING_TRANSITION
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        let lease = pending
            .as_mut()
            .filter(|item| item.actor == issuer.identity() && item.operation_id == operation_id)
            .ok_or("Privacy transition ownership changed")?;
        lease.baseline = Some(previous);
    }
    issuer.with_live(|| Ok(()))
}

/// Serialize a durable projection transition across all windows in this native
/// process. Host admission stays closed on a failed/unknown write or reopen.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Tauri command arguments are the frontend IPC contract.
pub fn control_privacy_projection_transition(
    app: AppHandle,
    window: WebviewWindow,
    expected: Option<u64>,
    operation_id: String,
    snapshot: Value,
    lease_id: Option<String>,
    recover_closed: Option<bool>,
    rebase_from: Option<String>,
    rebase_applied: Option<bool>,
    rebase_snapshot: Option<Value>,
    rebase_expected: Option<u64>,
) -> Result<Projection, String> {
    let issuer = crate::control::receipts::capture(&window)?;
    issuer.with_live(|| Ok(()))?;
    let _transition = TRANSITION_LOCK
        .lock()
        .map_err(|_| "Privacy projection is unavailable")?;
    let new_gate = {
        let mut pending = PENDING_TRANSITION
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        match (pending.as_ref(), lease_id.as_deref()) {
            (None, None) => {
                *pending = Some(PendingTransition {
                    actor: issuer.identity().into(),
                    operation_id: operation_id.clone(),
                    baseline: None,
                });
                true
            }
            (Some(lease), id)
                if lease.actor == issuer.identity()
                    && lease.operation_id == operation_id
                    && id.is_none_or(|id| id == operation_id) =>
            {
                false
            }
            (Some(lease), None)
                if recover_closed == Some(true)
                    && lease.actor == issuer.identity()
                    && rebase_from.as_deref() == Some(lease.operation_id.as_str())
                    && lease.operation_id != operation_id =>
            {
                let _guard = LOCK
                    .lock()
                    .map_err(|_| "Privacy projection is unavailable")?;
                let current = read(&path(&app)?)?;
                if rebase_applied == Some(true) {
                    require_rebase_applied(
                        current.as_ref(),
                        issuer.identity(),
                        &lease.operation_id,
                        rebase_expected,
                        rebase_snapshot
                            .as_ref()
                            .ok_or("Privacy recovery receipt is unavailable")?,
                        expected,
                    )?;
                } else {
                    require_rebase_not_applied(current.as_ref(), &lease.operation_id, expected)?;
                }
                *pending = Some(PendingTransition {
                    actor: issuer.identity().into(),
                    operation_id: operation_id.clone(),
                    baseline: None,
                });
                false
            }
            _ => return Err("Privacy transition ownership changed".into()),
        }
    };
    if new_gate {
        crate::conversation_tools_bridge::privacy_scope_capture::begin_write()?;
    }
    let channel = crate::remote::NativeServiceChannel::connect(&app)?;
    let epoch = channel.project(
        "assistant.visibility.revoke",
        serde_json::json!({}),
        |value| {
            value
                .get("epoch")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Invalid Room visibility response".into())
        },
    )?;
    let scope = crate::control::privacy_scope_snapshot_pinned(&app, &window, &issuer)?;
    if scope["stableStorageKeys"] != snapshot {
        return Err("Privacy policy changed before commit".into());
    }
    let recovering = recover_closed == Some(true);
    let recovery_receipt = if recovering {
        let _guard = LOCK
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        read(&path(&app)?)?.is_some_and(|current| {
            current.actor == issuer.identity()
                && current.operation_id == operation_id
                && current.snapshot == snapshot
                && expected.and_then(|revision| revision.checked_add(1)) == Some(current.revision)
        })
    } else {
        false
    };
    let mut approved_recovery: Option<Projection> = None;
    if recovering && !recovery_receipt {
        let previous = {
            let _guard = LOCK
                .lock()
                .map_err(|_| "Privacy projection is unavailable")?;
            read(&path(&app)?)?.ok_or("Privacy projection is unavailable")?
        };
        if rebase_applied == Some(true) {
            require_rebase_applied(
                Some(&previous),
                issuer.identity(),
                rebase_from
                    .as_deref()
                    .ok_or("Privacy recovery receipt is unavailable")?,
                rebase_expected,
                rebase_snapshot
                    .as_ref()
                    .ok_or("Privacy recovery receipt is unavailable")?,
                expected,
            )?;
            require_recovery_scope(&scope)?;
        } else {
            require_closed_recovery(&previous, &scope)?;
        }
        let visible_count = scope["visibleProjects"]
            .as_array()
            .ok_or("Privacy recovery scope is invalid")?
            .len();
        let reason = if rebase_applied == Some(true) {
            "The previous Room privacy update was saved, but its current scope needs review."
        } else {
            "The saved Room privacy protection cannot prove its previous locks."
        };
        let message = format!("{reason} This window currently exposes {visible_count} project(s) to Room. Rebuild protection using this window's current visibility? Projects visible here may become available to Room. Group settings will not be changed.");
        if !crate::control::owner_approval::ask_window(
            &app,
            &window,
            crate::control::owner_approval::Prompt {
                title: "bycoda — Rebuild Room privacy",
                message: &(message),
                confirm: "Rebuild protection",
                cancel: "Cancel",
            },
        ) {
            return Err("Privacy recovery cancelled".into());
        }
        if crate::control::privacy_scope_snapshot_pinned(&app, &window, &issuer)? != scope {
            return Err("Privacy scope changed during recovery".into());
        }
        approved_recovery = Some(previous);
    }
    let projection = issuer.with_live(|| {
        let _guard = LOCK
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        let storage_path = path(&app)?;
        let previous = read(&storage_path)?;
        if lease_id.is_some() {
            let pending = PENDING_TRANSITION
                .lock()
                .map_err(|_| "Privacy projection is unavailable")?;
            let baseline = pending
                .as_ref()
                .and_then(|item| item.baseline.as_ref())
                .ok_or("Privacy transition baseline is unavailable")?;
            require_lease_baseline(
                baseline,
                &previous,
                issuer.identity(),
                &operation_id,
                expected,
                &snapshot,
            )?;
        } else if recovering && !recovery_receipt {
            let old = previous
                .as_ref()
                .ok_or("Privacy projection is unavailable")?;
            if Some(old) != approved_recovery.as_ref() {
                return Err("Privacy projection changed during recovery".into());
            }
            if rebase_applied == Some(true) {
                require_rebase_applied(
                    Some(old),
                    issuer.identity(),
                    rebase_from
                        .as_deref()
                        .ok_or("Privacy recovery receipt is unavailable")?,
                    rebase_expected,
                    rebase_snapshot
                        .as_ref()
                        .ok_or("Privacy recovery receipt is unavailable")?,
                    expected,
                )?;
                require_recovery_scope(&scope)?;
            } else {
                require_closed_recovery(old, &scope)?;
            }
            if Some(old.revision) != expected {
                return Err("Privacy projection revision changed".into());
            }
            preserve_recovery_record(&storage_path, old)?;
        } else {
            ensure_cross_window_locks(previous.as_ref(), issuer.identity(), &snapshot)?;
        }
        compare_and_swap(
            &storage_path,
            expected,
            &operation_id,
            issuer.identity(),
            snapshot,
        )
    })?;
    issuer.with_live(|| Ok(()))?;
    let signer = crate::remote::assistant_room_delegation::native_signer(&app)?;
    let installation = signer
        .identity()
        .get("installationId")
        .and_then(Value::as_str)
        .ok_or("Native installation identity unavailable")?
        .to_owned();
    let verified_scope = crate::control::privacy_scope_snapshot_pinned(&app, &window, &issuer)?;
    if verified_scope != scope {
        return Err("Privacy scope changed after commit".into());
    }
    let policy_json =
        serde_json::to_vec(&projection.snapshot).map_err(|_| "Invalid privacy projection")?;
    let policy_digest = format!("{:x}", Sha256::digest(&policy_json));
    let redacted = serde_json::json!({
        "version": projection.version,
        "revision": projection.revision,
        "operationId": projection.operation_id,
        "actor": projection.actor,
        "snapshot": {
            "schemaVersion": 1,
            "policyDigest": policy_digest,
            "issuer": issuer.identity(),
            "privacyRevision": scope["privacyRevision"],
            "visibleProjects": scope["visibleProjects"],
        }
    });
    let operation = serde_json::json!({ "epoch": epoch, "projection": redacted });
    let operation_json =
        serde_json::to_string(&operation).map_err(|_| "Invalid privacy projection")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let host = channel.environment_id();
    let challenge = match channel.request(
        "assistant.delegation.nativeChallenge",
        serde_json::json!({ "input": {
            "installationId": installation, "hostId": host,
            "action": "assistant.visibility.reopen", "requestDigest": digest
        }}),
    ) {
        Ok(challenge) => challenge,
        // Trust is empty until the owner enrolls this installation. The projection is
        // committed and the Host fence stays closed, so Room keeps disclosing nothing.
        Err(error) if room_admission_unenrolled(&error) => {
            settle_transition()?;
            return Ok(projection);
        }
        Err(error) => return Err(error),
    };
    let challenge_value = challenge.project(|value| Ok(value.clone()))?;
    issuer.with_live(|| {
        let _guard = LOCK
            .lock()
            .map_err(|_| "Privacy projection is unavailable")?;
        if read(&path(&app)?)?.as_ref() != Some(&projection) {
            return Err("Privacy projection changed".into());
        }
        Ok(())
    })?;
    challenge.check()?;
    let proof = signer.sign_challenge(
        &challenge_value,
        host,
        "assistant.visibility.reopen",
        &digest,
    )?;
    if crate::control::privacy_scope_snapshot_pinned(&app, &window, &issuer)? != scope {
        return Err("Privacy scope changed before reopening".into());
    }
    issuer.with_live(|| Ok(()))?;
    channel.project(
        "assistant.visibility.reopen",
        serde_json::json!({ "input": { "operationJson": operation_json, "proof": proof } }),
        |value| {
            issuer.with_live(|| {
                let _guard = LOCK
                    .lock()
                    .map_err(|_| "Privacy projection is unavailable")?;
                if read(&path(&app)?)?.as_ref() != Some(&projection) {
                    return Err("Privacy projection changed".into());
                }
                Ok(())
            })?;
            if value.get("epoch").and_then(Value::as_u64) == Some(epoch) {
                Ok(())
            } else {
                Err("Invalid Room visibility response".into())
            }
        },
    )?;
    settle_transition()?;
    Ok(projection)
}

fn settle_transition() -> Result<(), String> {
    *PENDING_TRANSITION
        .lock()
        .map_err(|_| "Privacy projection is unavailable")? = None;
    crate::conversation_tools_bridge::privacy_scope_capture::end_write();
    Ok(())
}

/// Only the Host's not-sent refusal for a missing enrollment; any other failure,
/// including an unknown outcome, keeps the transition held.
fn room_admission_unenrolled(error: &str) -> bool {
    error.starts_with("Host rejected request: NATIVE_ADMISSION_UNENROLLED:")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_unenrolled_refusal_skips_room_reopen() {
        assert!(room_admission_unenrolled(
            "Host rejected request: NATIVE_ADMISSION_UNENROLLED: this desktop installation is not enrolled on this Host."
        ));
        for held in [
            "RPC_WS_REMOTE: The Host operation could not be confirmed. The operation outcome is unknown; reconcile its command receipt before retrying.",
            "Host rejected request: Native admission unavailable.",
            "RPC_WS_REMOTE: NATIVE_ADMISSION_UNENROLLED: forged by an uncertain path",
        ] {
            assert!(!room_admission_unenrolled(held), "{held}");
        }
    }

    #[test]
    fn recovery_requires_valid_live_scope_and_explicit_legacy_record() {
        let old = Projection {
            version: 1,
            revision: 3,
            operation_id: "old".into(),
            actor: "old-window".into(),
            snapshot: json!({"groups":[]}),
        };
        let scope = json!({"stableStorageKeys":{"groups":[{"id":"private","lockable":true}],"lockedGroupIds":["private"]},"visibleProjects":[]});
        assert!(require_closed_recovery(&old, &scope).is_ok());
        let mut visible = scope.clone();
        visible["visibleProjects"] = json!([{"cwd":"/private"}]);
        assert!(require_closed_recovery(&old, &visible).is_ok());
        let mut unlocked = scope.clone();
        unlocked["stableStorageKeys"]["lockedGroupIds"] = json!([]);
        assert!(require_closed_recovery(&old, &unlocked).is_ok());
        unlocked["visibleProjects"] = json!([{"cwd":""}]);
        assert!(require_closed_recovery(&old, &unlocked).is_err());
        let modern = Projection {
            snapshot: json!({"lockedGroupIds":[]}),
            ..old
        };
        assert!(require_closed_recovery(&modern, &scope).is_err());
        let missing = Projection {
            snapshot: json!({"groups":[]}),
            ..modern
        };
        assert!(ensure_cross_window_locks(
            Some(&missing),
            &missing.actor,
            &scope["stableStorageKeys"]
        )
        .is_err());
    }

    #[test]
    fn recovery_preserves_record_and_cas_never_rolls_back_newer_state() {
        let root =
            std::env::temp_dir().join(format!("bycoda-privacy-recovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("projection.json");
        let old = Projection {
            version: 1,
            revision: 3,
            operation_id: "old".into(),
            actor: "old-window".into(),
            snapshot: json!({"groups":[]}),
        };
        let bytes = serde_json::to_vec(&old).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        preserve_recovery_record(&path, &old).unwrap();
        preserve_recovery_record(&path, &old).unwrap();
        let replacement = json!({"groups":[],"lockedGroupIds":[]});
        let committed =
            compare_and_swap(&path, Some(3), "rebuild", "owner", replacement.clone()).unwrap();
        assert_eq!(
            compare_and_swap(&path, Some(3), "rebuild", "owner", replacement).unwrap(),
            committed
        );
        assert!(compare_and_swap(&path, Some(3), "later", "owner", json!({})).is_err());
        assert!(preserve_recovery_record(&path, &old).is_err());
        assert_eq!(
            std::fs::read(path.with_extension("v1-recovery-3.json")).unwrap(),
            bytes
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_rebase_requires_exact_durable_proof_old_attempt_not_applied() {
        let baseline = Projection {
            version: 1,
            revision: 3,
            operation_id: "previous".into(),
            actor: "owner".into(),
            snapshot: json!({"groups":[]}),
        };
        assert!(require_rebase_not_applied(Some(&baseline), "attempt", Some(3)).is_ok());
        assert!(require_rebase_not_applied(Some(&baseline), "attempt", Some(2)).is_err());
        let applied = Projection {
            revision: 4,
            operation_id: "attempt".into(),
            ..baseline
        };
        assert!(require_rebase_not_applied(Some(&applied), "attempt", Some(4)).is_err());
        assert!(require_rebase_not_applied(Some(&applied), "", Some(4)).is_err());
        assert!(require_rebase_applied(
            Some(&applied),
            "owner",
            "attempt",
            Some(3),
            &applied.snapshot,
            Some(4)
        )
        .is_ok());
        assert!(require_rebase_applied(
            Some(&applied),
            "other",
            "attempt",
            Some(3),
            &applied.snapshot,
            Some(4)
        )
        .is_err());
        assert!(require_rebase_applied(
            Some(&applied),
            "owner",
            "attempt",
            Some(3),
            &json!({"changed":true}),
            Some(4)
        )
        .is_err());
        assert!(require_rebase_applied(
            Some(&applied),
            "owner",
            "attempt",
            Some(2),
            &applied.snapshot,
            Some(4)
        )
        .is_err());
    }

    #[test]
    fn admission_requires_current_acknowledgement_by_exact_issuer() {
        let projection = Projection {
            version: 1,
            revision: 7,
            operation_id: "old".into(),
            actor: "first".into(),
            snapshot: json!({"lockedGroupIds":["private"]}),
        };
        let matching =
            json!({"committedProjectionSeen":7,"stableStorageKeys":{"lockedGroupIds":["private"]}});
        assert!(require_acknowledged_projection(&projection, "first", &matching).is_ok());
        assert!(require_acknowledged_projection(&projection, "replacement", &matching).is_err());
        let reenrolled = Projection {
            revision: 8,
            actor: "replacement".into(),
            ..projection.clone()
        };
        let new_scope =
            json!({"committedProjectionSeen":8,"stableStorageKeys":{"lockedGroupIds":["private"]}});
        assert!(require_acknowledged_projection(&reenrolled, "replacement", &new_scope).is_ok());
        assert!(require_acknowledged_projection(&reenrolled, "first", &new_scope).is_err());
        assert!(require_acknowledged_projection(
            &projection,
            "first",
            &json!({"committedProjectionSeen":6,"stableStorageKeys":projection.snapshot})
        )
        .is_err());
        assert!(require_acknowledged_projection(
            &projection,
            "first",
            &json!({"stableStorageKeys":projection.snapshot})
        )
        .is_err());
    }

    #[test]
    fn verified_cross_window_baseline_allows_intended_change_only_after_drain() {
        let first = Projection {
            version: 1,
            revision: 3,
            operation_id: "one".into(),
            actor: "first".into(),
            snapshot: json!({"lockedGroupIds":["private"],"assignments":{"a":"private"}}),
        };
        let baseline = Some(first.clone());
        assert!(ensure_cross_window_locks(Some(&first), "", &first.snapshot).is_ok());
        assert!(ensure_cross_window_locks(
            Some(&first),
            "",
            &json!({"lockedGroupIds":[],"assignments":{"a":"private"}})
        )
        .is_err());
        assert!(ensure_cross_window_locks(
            Some(&first),
            "",
            &json!({"lockedGroupIds":["private"],"assignments":{}})
        )
        .is_err());
        let proposed = json!({"lockedGroupIds":["private"],"assignments":{"b":"private"}});
        assert!(require_lease_baseline(
            &baseline,
            &Some(first.clone()),
            "second",
            "two",
            Some(3),
            &proposed
        )
        .is_ok());
        let root =
            std::env::temp_dir().join(format!("bycoda-privacy-baseline-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("projection.json");
        std::fs::write(&file, serde_json::to_vec(&first).unwrap()).unwrap();
        let changed = compare_and_swap(
            &file,
            Some(3),
            "two",
            "second",
            json!({"lockedGroupIds":["private"],"assignments":{"b":"private"}}),
        )
        .unwrap();
        assert_eq!(changed.actor, "second");
        assert!(require_lease_baseline(
            &baseline,
            &Some(changed.clone()),
            "second",
            "two",
            Some(3),
            &proposed
        )
        .is_ok());
        assert!(require_lease_baseline(
            &baseline,
            &Some(changed.clone()),
            "second",
            "different",
            Some(3),
            &proposed
        )
        .is_err());
        assert!(require_lease_baseline(
            &baseline,
            &Some(changed),
            "other",
            "two",
            Some(3),
            &proposed
        )
        .is_err());
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn stale_window_cannot_relax_another_issuers_lock() {
        let previous = Projection {
            version: 1,
            revision: 7,
            operation_id: "old".into(),
            actor: "first".into(),
            snapshot: json!({"lockedGroupIds":["private"]}),
        };
        assert!(ensure_cross_window_locks(
            Some(&previous),
            "second",
            &json!({"lockedGroupIds":[]})
        )
        .is_err());
        assert!(ensure_cross_window_locks(
            Some(&previous),
            "second",
            &json!({"lockedGroupIds":["private"]})
        )
        .is_ok());
        assert!(ensure_cross_window_locks(
            Some(&previous),
            "second",
            &json!({"lockedGroupIds":["private"],"assignments":{"project":"private"}})
        )
        .is_err());
        assert!(
            ensure_cross_window_locks(Some(&previous), "first", &json!({"lockedGroupIds":[]}))
                .is_ok()
        );
        assert!(ensure_cross_window_locks(Some(&previous), "second", &json!({})).is_err());
    }

    #[test]
    fn migration_cas_retry_conflict_and_corruption_fail_closed() {
        let root =
            std::env::temp_dir().join(format!("bycoda-privacy-test-{}", uuid::Uuid::new_v4()));
        let file = root.join("projection.json");
        assert!(read(&file).unwrap().is_none());
        let first =
            compare_and_swap(&file, None, "one", "window", json!({"locked":["a"]})).unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(
            first,
            compare_and_swap(&file, None, "one", "window", json!({"locked":["a"]})).unwrap()
        );
        assert!(compare_and_swap(&file, None, "one", "window", json!({"locked":[]})).is_err());
        assert!(compare_and_swap(&file, None, "two", "window", json!({})).is_err());
        assert!(compare_and_swap(
            &file,
            Some(1),
            "unsafe",
            "window",
            json!({"unlockedGroups":["a"]})
        )
        .is_err());
        assert!(compare_and_swap(&file, Some(1), "two", "other", json!({"locked":[]})).is_ok());
        let uncertain = compare_and_swap_with(
            &file,
            Some(2),
            "three",
            "window",
            json!({"locked":["b"]}),
            |path, bytes| {
                crate::file_access::durable_write(path, bytes)?;
                Err("synthetic lost acknowledgement".into())
            },
        );
        assert_eq!(
            uncertain.unwrap_err(),
            "Privacy projection write outcome unknown"
        );
        assert_eq!(read(&file).unwrap().unwrap().operation_id, "three");
        assert_eq!(
            compare_and_swap(&file, Some(2), "three", "window", json!({"locked":["b"]}))
                .unwrap()
                .revision,
            3
        );
        std::fs::write(&file, b"{").unwrap();
        assert!(read(&file).is_err());
        assert!(compare_and_swap(&file, None, "four", "window", json!({})).is_err());
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
