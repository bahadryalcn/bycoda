//! Private Room notification owner; no renderer-supplied text or permission prompt.
use crate::remote::{NativeServiceChannel, NativeServiceReply};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn field<'a>(v: &'a Value, name: &str, max: usize) -> Result<&'a str, String> {
    v.get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid notification {name}"))
}
pub(super) fn call(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let relay = field(request, "id", 200)?;
    let action = field(request, "action", 100)?;
    if !matches!(
        action,
        "assistant.notification.deliver" | "assistant.notification.status"
    ) || channel.environment_id() != environment
    {
        return Err("Invalid notification owner".into());
    }
    let input = request
        .get("input")
        .filter(|v| v.as_object().is_some_and(|v| v.len() == 5))
        .ok_or("Invalid notification input")?;
    let notification = field(input, "notificationId", 200)?;
    let kind = field(input, "kind", 50)?;
    if !matches!(kind, "task.done" | "task.needsInput") {
        return Err("Invalid notification kind".into());
    }
    let request_id = field(input, "requestId", 200)?;
    let operation_hash = field(input, "operationHash", 64)?;
    if operation_hash.len() != 64
        || !operation_hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("Invalid notification hash".into());
    }
    let paths = input["projectCwds"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 1000)
        .ok_or("Invalid notification projects")?;
    let paths = paths
        .iter()
        .map(|v| {
            v.as_str()
                .filter(|s| !s.is_empty() && s.len() <= 4096 && !s.contains('\0'))
                .ok_or("Invalid notification project")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Notification deadline required")?;
    let (window, issuer) = crate::control::validate_assistant_source(app, thread, environment)?;
    let webview = app
        .get_webview_window(&window)
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
            return Err("Notification authority expired".into());
        }
        let allowed = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":action}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        if !allowed {
            return Err("Notification authority revoked".into());
        }
        let (current, current_issuer) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if current != window || !Arc::ptr_eq(&issuer, &current_issuer) {
            return Err("Notification Room source changed".into());
        }
        taken.check()
    };
    check()?;
    let permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let scope = crate::control::privacy_scope_admission_pinned(app, &webview, &issuer)?;
    crate::privacy_projection::scope_projection_metadata(app, &issuer, &scope)?;
    let visible = scope["visibleProjects"]
        .as_array()
        .ok_or("Invalid notification project scope")?;
    if paths
        .iter()
        .any(|path| !visible.iter().any(|v| v["cwd"].as_str() == Some(*path)))
    {
        return Err("Notification project is unavailable or private".into());
    }
    check()?;
    if action == "assistant.notification.deliver" {
        let allowed = channel.project("assistant.notification.authorize", json!({"input":{"threadId":thread,"notificationId":notification,"operationHash":operation_hash}}), |v| Ok(v.as_object().is_some_and(|o| o.len()==1 && o.get("authorized")==Some(&Value::Bool(true)))))?;
        if !allowed {
            return Err("Notification policy is unavailable or changed".into());
        }
        check()?;
    }
    let permission =
        tauri::async_runtime::block_on(crate::notifications::notification_permission(app.clone()));
    if action == "assistant.notification.deliver"
        && permission != crate::notifications::Permission::Granted
    {
        return Err("Notification permission is unavailable; it was not requested".into());
    }
    let key = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([environment, thread, notification]))
                .map_err(|_| "Invalid notification identity")?
        )
    );
    let state = if action == "assistant.notification.status" {
        crate::notifications::assistant_notification_status(app, &key, operation_hash)?
    } else {
        let worker_app = app.clone();
        let worker_window = window.clone();
        let worker_view = webview.clone();
        let worker_issuer = issuer.clone();
        let worker_channel = channel.clone();
        let worker_environment = environment.to_owned();
        let worker_thread = thread.to_owned();
        let worker_notification = notification.to_owned();
        let worker_hash = operation_hash.to_owned();
        let worker_kind = kind.to_owned();
        let worker_scope = scope.clone();
        crate::notifications::assistant_notification_once(app, &key, operation_hash, move || {
            let _permit = permit;
            if !worker_channel.is_current() {
                return Err("Notification Host changed".into());
            }
            let (current_window, current_issuer) = crate::control::validate_assistant_source(
                &worker_app,
                &worker_thread,
                &worker_environment,
            )?;
            if current_window != worker_window || !Arc::ptr_eq(&current_issuer, &worker_issuer) {
                return Err("Notification Room source changed".into());
            }
            let current = crate::control::privacy_scope_admission_pinned(
                &worker_app,
                &worker_view,
                &worker_issuer,
            )?;
            if current != worker_scope {
                return Err("Notification privacy changed".into());
            }
            crate::privacy_projection::scope_projection_metadata(
                &worker_app,
                &worker_issuer,
                &current,
            )?;
            let allowed = worker_channel.project("assistant.notification.authorize", json!({"input":{"threadId":worker_thread,"notificationId":worker_notification,"operationHash":worker_hash}}), |v| Ok(v.as_object().is_some_and(|o| o.len()==1 && o.get("authorized")==Some(&Value::Bool(true)))))?;
            if !allowed {
                return Ok(false);
            }
            if tauri::async_runtime::block_on(crate::notifications::notification_permission(
                worker_app.clone(),
            )) != crate::notifications::Permission::Granted
            {
                return Ok(false);
            }
            tauri::async_runtime::block_on(crate::notifications::show_notification(
                worker_app,
                String::new(),
                "bycoda".into(),
                String::new(),
                if worker_kind == "task.done" {
                    "A task completed".into()
                } else {
                    "A task needs your attention".into()
                },
                false,
            ))
        })?
    };
    check()?;
    let operation_json = serde_json::to_string(&json!({"environmentId":environment,"threadId":thread,"issuer":issuer.identity(),"relayId":relay,"notificationId":notification,"kind":kind,"requestId":request_id,"operationHash":operation_hash,"state":state,"permission":permission})).map_err(|_| "Invalid notification receipt")?;
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let signer = crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation = field(&signer.identity(), "installationId", 200)?.to_owned();
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.notification.receipt","requestDigest":digest}}))?;
    let challenge_value = challenge.project(|v| Ok(v.clone()))?;
    check()?;
    challenge.check()?;
    let proof = signer.sign_challenge(
        &challenge_value,
        environment,
        "assistant.notification.receipt",
        &digest,
    )?;
    check()?;
    Ok(json!({"operationJson":operation_json,"proof":proof}))
}
