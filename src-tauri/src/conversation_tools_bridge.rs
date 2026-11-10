//! Conversation grants remain in native memory and provider children.
//! The renderer receives executable metadata, never host or session credentials.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;

#[path = "assistant/assistant_native_note_baseline.rs"]
mod assistant_native_note_baseline;
#[path = "assistant/assistant_notification_owner.rs"]
mod assistant_notification_owner;
#[path = "assistant/assistant_observation_publisher.rs"]
mod assistant_observation_publisher;
mod owner_approval;
mod management_actions;
#[path = "privacy_account_capture.rs"]
mod privacy_account_capture;
#[path = "privacy_scope_capture.rs"]
pub(crate) mod privacy_scope_capture;
#[path = "assistant/room/room_inbox.rs"]
mod room_inbox;
#[path = "conversation_servers.rs"]
mod servers;
#[path = "conversation_ssh_execution.rs"]
mod ssh_execution;
#[path = "voice_generation_retirement.rs"]
pub(crate) mod voice_generation_retirement;
#[path = "workspace_operation_owner.rs"]
pub(crate) mod workspace_operation_owner;
#[path = "workspace_receipt_status.rs"]
mod workspace_receipt_status;

pub(crate) fn shutdown_ssh_executions() {
    ssh_execution::shutdown();
}

struct DesktopOutcome {
    value: Value,
    device: Option<crate::remote::NativeDeviceReply>,
}

impl DesktopOutcome {
    fn project<T>(
        &self,
        source: &crate::remote::NativeServiceReply,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        match &self.device {
            Some(device) => device.project(source, |_| consume(&self.value)),
            None => source.project(|_| consume(&self.value)),
        }
    }

    fn finish_payload(
        &self,
        id: &Value,
        source: &crate::remote::NativeServiceReply,
    ) -> Result<Value, String> {
        match &self.device {
            Some(device) => device_finish_payload(id, &self.value, source, device),
            None => self.project(source, |value| Ok(json!({"id": id, "result": value}))),
        }
    }
}

/// A retired target cannot disclose its result, but its original live issuer
/// still needs the unknown outcome. Only that error crosses this fallback.
pub(crate) fn device_finish_payload(
    id: &Value,
    value: &Value,
    source: &crate::remote::NativeServiceReply,
    device: &crate::remote::NativeDeviceReply,
) -> Result<Value, String> {
    device
        .project(source, |_| Ok(json!({"id": id, "result": value})))
        .or_else(|error| source.project(|_| Ok(json!({"id": id, "error": error}))))
}

#[path = "conversation_tools_bridge/relay.rs"]
mod relay;
#[cfg(test)]
use relay::next_poll_delay;
pub(crate) use relay::start_desktop_relay;

fn execute_desktop_request(
    app: &AppHandle,
    request: &Value,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
    taken: &crate::remote::NativeServiceReply,
) -> Result<DesktopOutcome, String> {
    taken.check()?;
    if !issuer.is_current() || request["environmentId"].as_str() != Some(issuer.environment_id()) {
        return Err("Desktop request issuer changed or does not match this request".into());
    }
    let mut device = None;
    let value = execute_desktop_request_inner(app, request, issuer, taken, &mut device)?;
    let result = DesktopOutcome { value, device };
    result.project(taken, |_| Ok(()))?;
    if !issuer.is_current() {
        return Err("Desktop request issuer changed during execution".into());
    }
    Ok(result)
}

fn execute_desktop_request_inner(
    app: &AppHandle,
    request: &Value,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
    taken: &crate::remote::NativeServiceReply,
    device: &mut Option<crate::remote::NativeDeviceReply>,
) -> Result<Value, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_millis() as u64;
    if request["deadline"]
        .as_u64()
        .is_none_or(|deadline| deadline <= now)
    {
        return Err("Desktop request expired".into());
    }
    let action = request["action"].as_str().ok_or("Invalid desktop action")?;
    // Assistant threads may request this exact native approval only. They are
    // never a substitute session for the other desktop/native UI routes.
    if let Some(thread) = request.get("threadId") {
        if action == "privacy.scope.capture" {
            return privacy_scope_capture::capture(app, request, issuer, taken);
        }
        if action == "privacy.account.capture" {
            return privacy_account_capture::capture(app, request, issuer, taken);
        }
        if action == "voice.generation.retire" {
            return voice_generation_retirement::retire(app, request, issuer, taken);
        }
        if action == "voice.generation.status" {
            return voice_generation_retirement::status(app, request, issuer, taken);
        }
        if action == "voice.generation.source" {
            return voice_generation_retirement::source(app, request, issuer, taken);
        }
        if action == "inbox.room.execute" {
            return room_inbox::execute(app, request, issuer, taken);
        }
        if action == "observations.native.baseline"
            || action == "observations.native.projectBaseline"
        {
            return assistant_native_note_baseline::capture(app, request, issuer, taken);
        }
        if action == "observations.native.complete"
            || action == "observations.native.projectComplete"
        {
            return assistant_native_note_baseline::complete_server(app, request, issuer, taken);
        }
        if matches!(action, "delegation.grants" | "delegation.call") {
            return crate::remote::assistant_room_delegation::room_tool(
                app, request, issuer, taken,
            );
        }
        if matches!(
            action,
            "assistant.notification.deliver" | "assistant.notification.status"
        ) {
            return assistant_notification_owner::call(app, request, issuer, taken);
        }
        if action == "workspace.operation.status" {
            return workspace_receipt_status::status(app, request, issuer, taken);
        }
        if action == "workspace.operation.execute" {
            return workspace_operation_owner::execute(app, request, issuer, taken);
        }
        if matches!(
            action,
            "servers.ssh.execute" | "servers.ssh.status" | "servers.ssh.cancel"
        ) {
            let thread = thread
                .as_str()
                .ok_or("Assistant thread identity required")?;
            let environment = request["environmentId"]
                .as_str()
                .ok_or("Host identity required")?;
            let (window, owner) =
                crate::control::validate_assistant_source(app, thread, environment)?;
            let result = ssh_execution::call(app, request, issuer, taken)?;
            let allowed = issuer.project(
                "conversation.desktop.authorize",
                json!({"id":request["id"], "action":action}),
                |value| {
                    Ok(value.as_object().is_some_and(|v| {
                        v.len() == 1 && v.get("authorized") == Some(&Value::Bool(true))
                    }))
                },
            )?;
            if !allowed {
                return Err("Assistant Room authority revoked".into());
            }
            let (current, current_owner) =
                crate::control::validate_assistant_source(app, thread, environment)?;
            if window != current || !Arc::ptr_eq(&owner, &current_owner) {
                return Err("Assistant Room source changed".into());
            }
            return Ok(result);
        }
        if matches!(
            action,
            "servers.list" | "servers.get" | "servers.ssh.save" | "servers.ssh.remove"
        ) {
            let thread = thread
                .as_str()
                .ok_or("Assistant thread identity required")?;
            let environment = request["environmentId"]
                .as_str()
                .ok_or("Host identity required")?;
            let input = request["input"]
                .as_object()
                .ok_or("Invalid server inventory input")?;
            if (action == "servers.list"
                && (input.keys().any(|key| {
                    !["offset", "limit", "search", "kind", "favorite"].contains(&key.as_str())
                }) || input
                    .get("search")
                    .is_some_and(|v| v.as_str().is_none_or(|s| s.len() > 300))
                    || input
                        .get("kind")
                        .is_some_and(|v| !matches!(v.as_str(), Some("host" | "ssh")))
                    || input.get("favorite").is_some_and(|v| !v.is_boolean())))
                || (action == "servers.get"
                    && (input.len() != 1
                        || input
                            .get("id")
                            .and_then(Value::as_str)
                            .is_none_or(|id| id.is_empty() || id.len() > 300)))
            {
                return Err("Invalid server inventory input".into());
            }
            if action == "servers.ssh.save"
                && input.keys().any(|key| {
                    ![
                        "id",
                        "name",
                        "endpoint",
                        "importOnly",
                        "expectedInventoryRevision",
                    ]
                    .contains(&key.as_str())
                })
                || action == "servers.ssh.remove"
                    && input
                        .keys()
                        .any(|key| !["id", "expectedInventoryRevision"].contains(&key.as_str()))
            {
                return Err("Invalid reviewed server input".into());
            }
            let check = || -> Result<_, String> {
                taken.check()?;
                if !issuer.is_current()
                    || request["deadline"].as_u64().is_none_or(|deadline| {
                        deadline
                            <= std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|v| v.as_millis() as u64)
                                .unwrap_or(u64::MAX)
                    })
                {
                    return Err("Assistant Room request expired".into());
                }
                let allowed = issuer.project(
                    "conversation.desktop.authorize",
                    json!({"id":request["id"], "action":action}),
                    |value| {
                        Ok(value.as_object().is_some_and(|v| {
                            v.len() == 1 && v.get("authorized") == Some(&Value::Bool(true))
                        }))
                    },
                )?;
                if !allowed {
                    return Err("Assistant Room authority revoked".into());
                }
                crate::control::validate_assistant_source(app, thread, environment)
            };
            let (window, window_issuer) = check()?;
            let result = if matches!(action, "servers.list" | "servers.get") {
                servers::read_reviewed(app, action, &request["input"])?
            } else {
                servers::apply_reviewed(app, action, &request["input"])?
            };
            let (current, current_issuer) = check()?;
            if current != window || !Arc::ptr_eq(&current_issuer, &window_issuer) {
                return Err("Assistant Room source changed".into());
            }
            return Ok(result);
        }
        if matches!(
            action,
            "preferences.read"
                | "preferences.templateRead"
                | "preferences.patch"
                | "preferences.status"
                | "providerManagement.read"
                | "providerManagement.patch"
                | "providerManagement.status"
                | "providerManagement.quotaRefresh"
                | "organization.read"
                | "organization.patch"
                | "organization.status"
                | "workspace.projects.select"
                | "workspace.sessions.create"
                | "workspace.sessions.open"
                | "workspace.sessions.submit"
                | "workspace.sessions.submit.status"
                | "workspace.sessions.stop"
                | "ui.tools.open"
                | "ui.tools.status"
        ) {
            return crate::control::assistant_ui_request_pinned(
                app,
                thread
                    .as_str()
                    .ok_or("Assistant thread identity required")?,
                request["environmentId"]
                    .as_str()
                    .ok_or("Host identity required")?,
                action,
                request["input"].clone(),
                request["projectId"].as_str(),
                request["targetProjectCwd"].as_str(),
                request["id"].as_str().ok_or("Request identity required")?,
                request["deadline"].as_u64().ok_or("Deadline required")?,
                issuer,
                taken,
            );
        }
        if action != "management.write.authorize" || request.get("projectId").is_some() {
            DesktopApprovalSubject::parse(request)?;
        } else if request.get("sessionId").is_some() {
            return Err("Exactly one original source is required".into());
        }
    }
    let input = &request["input"];
    if matches!(
        action,
        "servers.ssh.execute" | "servers.ssh.status" | "servers.ssh.cancel"
    ) {
        return ssh_execution::call(app, request, issuer, taken);
    }
    if action.starts_with("servers.") {
        return servers::call(app, action, input);
    }
    if matches!(action, "checkpoints.status" | "checkpoints.diff") {
        return crate::checkpoint::conversation_checkpoint_read(
            app,
            action,
            input["sessionId"]
                .as_str()
                .ok_or("Checkpoint session required")?,
            request["cwd"]
                .as_str()
                .ok_or("Project directory required")?,
            input["relative"].as_str(),
        );
    }
    if action.starts_with("ui.")
        || matches!(
            action,
            "sessions.list"
                | "sessions.read"
                | "historyImport.discover"
                | "historyImport.commit"
                | "historyImport.status"
                | "historyImport.cancel"
                | "organization.read"
                | "providerManagement.read"
                | "providerManagement.patch"
                | "providerManagement.status"
                | "providerManagement.quotaRefresh"
                | "organization.patch"
                | "organization.status"
                | "preferences.read"
                | "preferences.templateRead"
                | "preferences.patch"
                | "preferences.status"
                | "ptyMobile.list"
                | "ptyMobile.create"
                | "ptyMobile.attach"
                | "ptyMobile.read"
                | "ptyMobile.write"
                | "ptyMobile.status"
                | "ptyMobile.resize"
                | "ptyMobile.detach"
                | "ptyMobile.close"
                | "ssh.workspace.catalog.read"
                | "ssh.workspace.review"
                | "ssh.workspace.approve"
                | "ssh.workspace.status"
                | "ssh.workspace.close.review"
                | "ssh.workspace.close.approve"
                | "worktrees.removal.review"
                | "worktrees.removal.approve"
                | "worktrees.removal.status"
                | "terminals.create"
                | "terminals.close"
                | "terminals.interrupt"
        )
    {
        let authority = if crate::control::desktop_effect_action(action) {
            Some(crate::control::DesktopAuthority {
                relay_id: request["id"]
                    .as_str()
                    .ok_or("Original desktop request identity required")?
                    .to_string(),
                action: action.to_string(),
                deadline: request["deadline"]
                    .as_u64()
                    .ok_or("Desktop request deadline required")?,
                issuer: issuer.clone(),
                workspace_owner: None,
                workspace_admitted: false,
            })
        } else {
            None
        };
        return crate::control::conversation_ui_request_pinned(
            app,
            request["sessionId"]
                .as_str()
                .ok_or("Session identity required")?,
            request["cwd"].as_str().ok_or("Project identity required")?,
            request["environmentId"]
                .as_str()
                .ok_or("Host identity required")?,
            action,
            input.clone(),
            authority,
            taken,
        );
    }
    if matches!(
        action,
        "desktop.act.authorize"
            | "management.write.authorize"
            | "tasks.write.authorize"
            | "inbox.write.authorize"
            | "secrets.input.authorize"
    ) {
        return owner_approval::call(app, request, issuer, taken, now);
    }
    if action == "machines.list" {
        // This list contains saved display metadata only. Reading the store is
        // outside the projection, whose short callback admits the returned copy.
        let machines =
            crate::remote::conversation_machine_call(app, action, input, "", &request["deadline"])?;
        return taken.project(|_| Ok(machines));
    }
    if action.starts_with("devices.") {
        let owner = format!(
            "{}:{}",
            request["environmentId"]
                .as_str()
                .ok_or("Host identity required")?,
            request["sessionId"]
                .as_str()
                .ok_or("Session identity required")?
        );
        let reply = crate::remote::conversation_machine_call_pinned(
            app,
            action,
            input,
            &owner,
            &request["deadline"],
            issuer,
            taken,
        )?;
        let panel = if action == "devices.preview" {
            // UI acknowledgement is independent from the asynchronous device job.
            let panel = crate::control::conversation_ui_request_device_pinned(
                app,
                request["sessionId"]
                    .as_str()
                    .ok_or("Session identity required")?,
                request["cwd"].as_str().ok_or("Project identity required")?,
                request["environmentId"]
                    .as_str()
                    .ok_or("Host identity required")?,
                "ui.tools.open",
                json!({ "tab": "devices", "placement": "right", "machineId": input["machineId"] }),
                None,
                taken,
                &reply,
            );
            Some(match panel {
                Ok(panel) => panel,
                Err(error) => json!({ "open": false, "error": error }),
            })
        } else {
            None
        };
        let value = reply.project(taken, |value| {
            let mut value = value.clone();
            if let Some(panel) = panel {
                value["panel"] = panel;
            }
            Ok(value)
        })?;
        *device = Some(reply);
        return Ok(value);
    }
    let cwd = std::fs::canonicalize(
        request["cwd"]
            .as_str()
            .ok_or("Project directory required")?,
    )
    .map_err(|_| "Project directory unavailable")?;
    let ptys = app.state::<crate::pty::PtyHost>();
    match action {
        "terminals.list" => Ok(ptys.conversation_list(&cwd)),
        "terminals.write" => ptys.conversation_write_checked(
            app,
            &cwd,
            input["terminalId"].as_str().ok_or("Terminal ID required")?,
            input["data"].as_str().ok_or("Terminal data required")?,
        ),
        _ => Err("Unsupported desktop tool".into()),
    }
}

/// Field order is the internal relay's canonical JSON.stringify(operation) order.
/// Never hash a Value map: its serialization order need not match JavaScript.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopRefApprovalOperation {
    request_id: String,
    snapshot_id: String,
    app: String,
    window_id: String,
    #[serde(rename = "ref")]
    target_ref: String,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    headed: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopLaunchApprovalOperation {
    kind: String,
    request_id: String,
    app: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopClipboardApprovalOperation {
    kind: String,
    request_id: String,
    target: String,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

/// Untagged retains the original ref-action byte order/hash without adding a
/// discriminator. New targets have explicit kinds and no fabricated refs.
#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum DesktopApprovalOperation {
    Ref(DesktopRefApprovalOperation),
    Launch(DesktopLaunchApprovalOperation),
    Clipboard(DesktopClipboardApprovalOperation),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopApprovalInput {
    operation: DesktopApprovalOperation,
    operation_hash: String,
}

struct DesktopActionApproval {
    relay_id: String,
    deadline: u64,
    operation_hash: String,
    message: String,
}

enum DesktopApprovalSubject {
    Session(String),
    AssistantThread {
        thread_id: String,
        project_id: String,
    },
}

fn desktop_approval_field(request: &Value, key: &str, max: usize) -> Result<String, String> {
    let value = request[key]
        .as_str()
        .ok_or("Original desktop approval identity required")?;
    if value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
    {
        return Err("Invalid original desktop approval identity".into());
    }
    Ok(value.to_string())
}

impl DesktopApprovalSubject {
    fn parse(request: &Value) -> Result<Self, String> {
        if !matches!(
            request["action"].as_str(),
            Some("desktop.act.authorize" | "management.write.authorize")
        ) {
            return Err("Assistant threads may request only exact desktop approval".into());
        }
        match (request.get("sessionId"), request.get("threadId")) {
            (Some(_), None) => Ok(Self::Session(desktop_approval_field(
                request,
                "sessionId",
                200,
            )?)),
            (None, Some(_)) => Ok(Self::AssistantThread {
                thread_id: desktop_approval_field(request, "threadId", 200)?,
                project_id: desktop_approval_field(request, "projectId", 200)?,
            }),
            _ => Err("Exactly one original session or assistant thread is required".into()),
        }
    }
}

fn escape_approval_direction(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\u{061c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}' => format!("\\u{:04x}", ch as u32),
            _ => ch.to_string(),
        })
        .collect()
}

fn management_approval_message(request: &Value) -> Result<(String, String), String> {
    if request.get("threadId").is_some() && request.get("projectId").is_none() {
        if request.get("sessionId").is_some() {
            return Err("Exactly one original source is required".into());
        }
        desktop_approval_field(request, "threadId", 200)?;
    } else {
        DesktopApprovalSubject::parse(request)?;
    }
    let operation = request["input"]["operation"]
        .as_object()
        .ok_or("Management operation required")?;
    if operation.len() != 3
        || !operation.contains_key("action")
        || !operation.contains_key("input")
        || !operation.contains_key("operationHash")
    {
        return Err("Invalid management approval fields".into());
    }
    let action = operation["action"]
        .as_str()
        .ok_or("Management action required")?;
    if !management_actions::MANAGEMENT_APPROVAL_ACTIONS.contains(&action) {
        return Err("Unsupported management approval action".into());
    }
    let operation_hash = operation["operationHash"]
        .as_str()
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("Invalid management operation hash")?;
    if !operation["input"].is_object() {
        return Err("Management input required".into());
    }
    let mut review_input = operation["input"].clone();
    if action == "files.write" {
        let content = review_input
            .get("content")
            .and_then(Value::as_str)
            .ok_or("File content required")?;
        let preview: String = content.chars().take(8000).collect();
        let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
        let size = content.len();
        let truncated = preview.len() < size;
        review_input["content"] =
            json!({ "preview": preview, "truncated": truncated, "bytes": size, "sha256": digest });
    }
    let details =
        serde_json::to_string_pretty(&review_input).map_err(|_| "Invalid management input")?;
    if details.len() > 32000 {
        return Err("Management approval is too large".into());
    }
    let cwd = if request.get("targetProjectCwd").is_some() {
        escape_approval_direction(
            &serde_json::to_string(&desktop_approval_field(request, "targetProjectCwd", 4096)?)
                .map_err(|_| "Invalid project")?,
        )
    } else if request.get("threadId").is_some() && request.get("cwd").is_none() {
        match request.get("projectId") {
            Some(_) => {
                escape_approval_direction(&desktop_approval_field(request, "projectId", 200)?)
            }
            None => "Application-wide".to_string(),
        }
    } else {
        escape_approval_direction(
            &serde_json::to_string(&desktop_approval_field(request, "cwd", 4096)?)
                .map_err(|_| "Invalid project")?,
        )
    };
    let environment = escape_approval_direction(
        &serde_json::to_string(&desktop_approval_field(request, "environmentId", 200)?)
            .map_err(|_| "Invalid host")?,
    );
    let details = escape_approval_direction(&details);
    let consequence = if action == "git.push" {
        "
This publishes the listed local commits to the listed remote branch. It never forces, deletes or rewrites remote history; an uncertain result is never retried."
    } else if action == "git.merge" {
        "
This merges the listed source branch into the current branch (fast-forward or merge commit only). A conflict aborts the merge and restores the checkout."
    } else if action == "social.send" {
        "\nThis sends the exact reviewed draft to an external recipient. Review the account, recipient, complete message and media above. Approval applies only to this operation; a queued job is not proof of delivery."
    } else if action.starts_with("terminals.") {
        "\nThis controls a Host pipe shell. Its launch directory is not a sandbox; accepted input may continue running after Room closes. Command completion is not observed."
    } else {
        ""
    };
    Ok((format!("Requested operation: {action}\nProject: {cwd}\nHost: {environment}\n\n{details}\n{consequence}\nOperation hash: {operation_hash}\nApprove only this exact operation. Existing permission and revision checks still apply."), operation_hash.to_string()))
}

impl DesktopActionApproval {
    fn result(&self, approved: bool) -> Value {
        // Only the actual native dialog result is passed here. No input boolean
        // or original tool arguments can select this value.
        json!({"approved": approved, "operationHash": self.operation_hash})
    }
}

fn desktop_approval_decision(
    approval: &DesktopActionApproval,
    check: impl Fn() -> Result<(), String>,
    decide: impl FnOnce() -> bool,
) -> Result<Value, String> {
    check()?;
    let approved = decide();
    check()?;
    Ok(approval.result(approved))
}

fn desktop_action_approval(request: &Value, now: u64) -> Result<DesktopActionApproval, String> {
    if request["action"].as_str() != Some("desktop.act.authorize") {
        return Err("Invalid desktop approval action".into());
    }
    let field = |key: &str, max: usize| desktop_approval_field(request, key, max);
    let relay_id = field("id", 200)?;
    uuid::Uuid::parse_str(&relay_id).map_err(|_| "Invalid original desktop request identity")?;
    let subject = DesktopApprovalSubject::parse(request)?;
    let cwd = field("cwd", 4096)?;
    let environment_id = field("environmentId", 200)?;
    let deadline = request["deadline"]
        .as_u64()
        .filter(|value| *value > now)
        .ok_or("Desktop approval expired; no action was authorized")?;
    if request["input"]["operation"]
        .get("text")
        .is_some_and(Value::is_null)
    {
        return Err("Desktop action text must be a string when present".into());
    }
    let input: DesktopApprovalInput = serde_json::from_value(request["input"].clone())
        .map_err(|_| "Invalid exact desktop approval input")?;
    if input.operation_hash.len() != 64
        || !input
            .operation_hash
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err("Invalid desktop operation hash".into());
    }
    let operation = &input.operation;
    let plain = |value: &str, max: usize| {
        !value.trim().is_empty()
            && value.chars().count() <= max
            && !value.chars().any(char::is_control)
    };
    match operation {
        DesktopApprovalOperation::Launch(operation) => {
            if operation.kind != "launch"
                || !plain(&operation.request_id, 200)
                || !plain(&operation.app, 200)
                || operation.app.starts_with('-')
            {
                return Err("Invalid exact desktop launch target".into());
            }
        }
        DesktopApprovalOperation::Clipboard(operation) => {
            if operation.kind != "clipboard"
                || operation.target != "global-clipboard"
                || !plain(&operation.request_id, 200)
                || !matches!(operation.action.as_str(), "get" | "set" | "clear")
                || (operation.action == "set") != operation.text.is_some()
                || operation
                    .text
                    .as_ref()
                    .is_some_and(|text| text.chars().count() > 10000 || text.contains('\0'))
            {
                return Err("Invalid exact global clipboard operation".into());
            }
        }
        DesktopApprovalOperation::Ref(operation) => {
            for (value, max) in [
                (&operation.request_id, 200),
                (&operation.snapshot_id, 100),
                (&operation.app, 200),
                (&operation.window_id, 200),
                (&operation.target_ref, 200),
            ] {
                if value.trim().is_empty()
                    || value.chars().count() > max
                    || value.chars().any(char::is_control)
                {
                    return Err("Invalid exact desktop action target".into());
                }
            }
            if !operation
                .target_ref
                .starts_with(&format!("@{}:", operation.snapshot_id))
            {
                return Err("Desktop action ref does not belong to its reviewed snapshot".into());
            }
            if !matches!(
                operation.action.as_str(),
                "click"
                    | "set-value"
                    | "clear"
                    | "type"
                    | "select"
                    | "check"
                    | "uncheck"
                    | "toggle"
                    | "expand"
                    | "collapse"
                    | "scroll-to"
                    | "focus"
                    | "double-click"
                    | "right-click"
                    | "press"
            ) {
                return Err("Unsupported desktop action approval".into());
            }
            let requires_text = matches!(
                operation.action.as_str(),
                "set-value" | "type" | "select" | "press"
            );
            if requires_text != operation.text.is_some()
                || operation
                    .text
                    .as_ref()
                    .is_some_and(|text| text.chars().count() > 10000)
            {
                return Err("Desktop action text does not match its reviewed operation".into());
            }
            if matches!(operation.action.as_str(), "press" | "double-click") && !operation.headed {
                return Err("This desktop action requires explicit physical input review".into());
            }
        }
    }
    let canonical =
        serde_json::to_string(operation).map_err(|_| "Desktop action cannot be reviewed")?;
    let actual_hash = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    if actual_hash != input.operation_hash.to_ascii_lowercase() {
        return Err("Desktop approval hash does not match the exact operation".into());
    }
    // Display escaped literal values so newlines/quotes cannot imitate dialog
    // labels. The complete text is preserved; nothing is silently truncated.
    let literal = |value: &str| {
        // Directional formatting is legal input data, but must not visually
        // reorder the native approval labels or conceal the reviewed payload.
        escape_approval_direction(&serde_json::to_string(value).unwrap_or_default())
    };
    let subject_context = match &subject {
        DesktopApprovalSubject::Session(session_id) => {
            format!("Agent session: {}", literal(session_id))
        }
        DesktopApprovalSubject::AssistantThread {
            thread_id,
            project_id,
        } => format!(
            "Assistant thread: {}\nProject ID: {}",
            literal(thread_id),
            literal(project_id)
        ),
    };
    let message = match operation {
      DesktopApprovalOperation::Ref(operation) => format!(
        "Review this exact desktop action. Approval applies once to this operation only.\n\nHost: {}\n{}\nProject: {}\nApplication: {}\nWindow: {}\nSnapshot: {}\nTarget ref: {}\nAction: {}\nInput mode: {}\nRequest: {}\nText (JSON literal): {}\n\nOperation SHA-256: {}",
        literal(&environment_id), subject_context, literal(&cwd), literal(&operation.app), literal(&operation.window_id), literal(&operation.snapshot_id), literal(&operation.target_ref), literal(&operation.action),
        if operation.headed { "PHYSICAL — may move the pointer or change focus" } else { "HEADLESS — no physical input grant" },
        literal(&operation.request_id), operation.text.as_ref().map(|text| literal(text)).unwrap_or_else(|| "(none)".into()), input.operation_hash,
    ),
      DesktopApprovalOperation::Launch(operation) => format!(
        "Review this exact application launch. Approval applies once to this operation only.\n\nHost: {}\n{}\nProject: {}\nApplication: {}\nAction: LAUNCH OR ATTACH — headless, no activation, arguments, environment or CDP access\nRequest: {}\n\nOperation SHA-256: {}",
        literal(&environment_id), subject_context, literal(&cwd), literal(&operation.app), literal(&operation.request_id), input.operation_hash,
      ),
      DesktopApprovalOperation::Clipboard(operation) => format!(
        "Review this exact GLOBAL clipboard operation. Approval applies once to this operation only.\n\nHost: {}\n{}\nProject: {}\nTarget: GLOBAL SYSTEM CLIPBOARD — shared by all applications\nAction: {}\nConsequence: {}\nRequest: {}\nText (JSON literal): {}\n\nOperation SHA-256: {}",
        literal(&environment_id), subject_context, literal(&cwd), literal(&operation.action),
        match operation.action.as_str() { "get" => "Read up to 10000 plain-text characters and disclose them to this agent conversation. The clipboard may contain sensitive information.", "set" => "Replace the global clipboard with exactly the reviewed plain text.", _ => "Clear the global clipboard, removing its current contents." },
        literal(&operation.request_id), operation.text.as_ref().map(|text| literal(text)).unwrap_or_else(|| "(none)".into()), input.operation_hash,
      ),
    };
    Ok(DesktopActionApproval {
        relay_id,
        deadline,
        operation_hash: input.operation_hash,
        message,
    })
}

fn task_approval_message(operation: &Value) -> Result<String, String> {
    let id = operation["taskId"]
        .as_str()
        .ok_or("Task identity required")?;
    let title = operation["title"].as_str().ok_or("Task title required")?;
    let revision = operation["expectedUpdatedAt"]
        .as_u64()
        .ok_or("Task revision required")?;
    let detail = match operation["action"].as_str() {
        Some("tasks.delete") => {
            "Delete this task entry. Unmerged branch work will not be discarded.".to_string()
        }
        Some("tasks.transfer") => format!(
            "Move this unstarted task to project: {} ({})",
            operation["targetProjectName"]
                .as_str()
                .ok_or("Target project name required")?,
            operation["targetProjectId"]
                .as_str()
                .ok_or("Target project required")?
        ),
        Some("tasks.notes.resolve") => format!(
            "Mark note {} as {}.\n\n{}",
            operation["noteId"]
                .as_str()
                .ok_or("Note identity required")?,
            if operation["resolved"]
                .as_bool()
                .ok_or("Note status required")?
            {
                "resolved"
            } else {
                "unresolved"
            },
            operation["note"].as_str().ok_or("Note preview required")?
        ),
        _ => return Err("Unsupported task approval".into()),
    };
    Ok(format!("{detail}\n\nTask: {title}\nID: {id}\nRevision: {revision}\n\nApprove only this exact operation."))
}

fn inbox_reply_approval_context(operation: &Value) -> Result<String, String> {
    if operation["action"] != "comment" || operation["item"]["provider"] != "github" {
        return Ok(String::new());
    }
    let Some(thread) = operation["inReplyTo"]
        .as_str()
        .filter(|thread| !thread.is_empty())
    else {
        return Ok(String::new());
    };
    if operation["item"]["kind"] != "pr" {
        return Err("Review replies require a pull request".into());
    }
    let cwd = operation["cwd"].as_str().ok_or("Project required")?;
    let context = crate::fs::github_review_reply_context(
        std::path::Path::new(cwd),
        operation["item"]["repo"]
            .as_str()
            .ok_or("Repository required")?,
        operation["item"]["number"]
            .as_i64()
            .ok_or("PR number required")?,
        thread,
    )?;
    Ok(format!("\n\nVerified review thread:\n{context}"))
}

pub(crate) fn inbox_approval_message(operation: &Value, cwd: &str) -> Result<String, String> {
    let action = operation["action"]
        .as_str()
        .ok_or("Invalid inbox approval")?;
    if !matches!(action, "comment" | "pr-action" | "review")
        || operation["cwd"].as_str() != Some(cwd)
    {
        return Err("Invalid inbox approval scope".into());
    }
    let item = &operation["item"];
    let provider = item["provider"].as_str().ok_or("Inbox provider required")?;
    let repo = item["repo"].as_str().unwrap_or("");
    let number = item["number"]
        .as_u64()
        .ok_or("Inbox item number required")?;
    let key = item["identifier"]
        .as_str()
        .or_else(|| item["id"].as_str())
        .unwrap_or("");
    let content = if action == "comment" {
        operation["body"]
            .as_str()
            .filter(|body| !body.is_empty() && body.len() <= 120000)
            .ok_or("Invalid inbox comment")?
            .to_owned()
    } else if action == "review" {
        if provider != "github" || item["kind"] != "pr" {
            return Err("Invalid PR review approval".into());
        }
        crate::github_review::ReviewInput::approval_content(operation)?
    } else {
        let change = operation["prAction"].as_str().ok_or("PR action required")?;
        if provider != "github"
            || item["kind"] != "pr"
            || !matches!(
                change,
                "merge" | "squash" | "rebase" | "draft" | "ready" | "close" | "reopen"
            )
        {
            return Err("Invalid PR approval".into());
        }
        if matches!(change, "merge" | "squash" | "rebase") {
            let head = operation["expectedHeadOid"]
                .as_str()
                .ok_or("Reviewed PR head required")?;
            crate::fs::validate_reviewed_head(head)?;
            format!("Change pull request state: {change}\nReviewed head SHA: {head}\nIf the head changes, refresh and review again.")
        } else {
            format!("Change pull request state: {change}")
        }
    };
    Ok(format!("An agent requests this external Inbox operation. Approve only if the exact target and content match your request.\n\nProject: {cwd}\nProvider: {provider}\nTarget: {repo} #{number} {key}\nReply to: {}\n\n{content}", operation["inReplyTo"].as_str().unwrap_or("(new comment)")))
}

fn grants() -> &'static Mutex<HashMap<String, Value>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn clear_grants(session: Option<&str>) {
    if let Ok(mut map) = grants().lock() {
        if let Some(session) = session {
            map.remove(session);
        } else {
            map.clear();
        }
    }
}

pub fn authorize_acp_frame(session_id: &str, line: String) -> String {
    let grant = grants()
        .lock()
        .ok()
        .and_then(|map| map.get(session_id).cloned());
    grant
        .map(|grant| decorate_frame(line.clone(), &grant))
        .unwrap_or(line)
}

fn decorate_frame(line: String, grant: &Value) -> String {
    let Ok(mut request) = serde_json::from_str::<Value>(&line) else {
        return line;
    };
    if !matches!(
        request.get("method").and_then(Value::as_str),
        Some("session/new" | "session/load" | "session/resume" | "session/fork")
    ) {
        return line;
    }
    let Some(servers) = request
        .get_mut("params")
        .and_then(|params| params.get_mut("mcpServers"))
        .and_then(Value::as_array_mut)
    else {
        return line;
    };
    for server in servers {
        if server.get("name").and_then(Value::as_str) != Some("bycoda-conversation")
            || server.get("command").and_then(Value::as_str).is_none()
        {
            continue;
        }
        let mut env = server
            .get("env")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        env.retain(|entry| {
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            !name.starts_with("BYCODA_CONVERSATION_")
                && !matches!(name, "BYCODA_APP_ENDPOINT" | "BYCODA_APP_TOKEN")
        });
        for (name, field) in [
            ("BYCODA_CONVERSATION_TOKEN", "token"),
            ("BYCODA_CONVERSATION_ENDPOINT", "endpoint"),
            ("BYCODA_CONVERSATION_ENVIRONMENT", "environmentId"),
            ("BYCODA_APP_ENDPOINT", "appEndpoint"),
            ("BYCODA_APP_TOKEN", "appToken"),
        ] {
            if let Some(value) = grant[field].as_str() {
                env.push(json!({"name": name, "value": value}));
            }
        }
        server["env"] = json!(env);
    }
    request.to_string()
}

#[tauri::command]
pub async fn harness_conversation_tools_bridge(
    app: AppHandle,
    session_id: String,
) -> Result<Option<Value>, String> {
    crate::harness::run_blocking("harness_conversation_tools_bridge", move || {
        if session_id.is_empty() {
            return Ok(None);
        }
        // Optional metadata: a slow Host must not hold the send for 30 s.
        let Some(deadline) = crate::session_tools_bridge::optional_host_deadline() else {
            return Ok(None);
        };
        let value = crate::remote::NativeServiceChannel::connect_until(&app, Some(deadline))
            .and_then(|service| {
                service.project_until(
                    "conversation.bridge.describe",
                    json!({}),
                    deadline,
                    |value| {
                        Ok(crate::session_tools_bridge::metadata(
                            value.clone(),
                            crate::session_tools_bridge::Group::Conversation,
                        ))
                    },
                )
            });
        crate::session_tools_bridge::note_optional_host_outcome(deadline, value.is_ok());
        Ok(value.ok())
    })
    .await
}

/// Local, synchronous half of the child setup. Returns the local read
/// fallback that `issue_child_grant` merges into the Host grant.
pub(crate) fn prepare_child(session_id: &str, command: &mut Command, stamp: (u64, u64)) -> Value {
    // Control already placed these in the child. Retain the local read fallback
    // even when this desktop session is not yet mirrored to the host.
    let mut fallback = json!({});
    for (name, value) in command.get_envs() {
        if let Some(value) = value {
            if name == "BYCODA_APP_ENDPOINT" {
                fallback["appEndpoint"] = json!(value.to_string_lossy());
            }
            if name == "BYCODA_APP_TOKEN" {
                fallback["appToken"] = json!(value.to_string_lossy());
            }
        }
    }
    if fallback["appToken"].is_string() {
        crate::session_tools_bridge::cache_grant(session_id, stamp, grants(), fallback.clone());
    }
    let keys: Vec<String> = std::env::vars()
        .map(|(key, _)| key)
        .chain(
            command
                .get_envs()
                .map(|(key, _)| key.to_string_lossy().into_owned()),
        )
        .filter(|key| key.starts_with("BYCODA_CONVERSATION_"))
        .collect();
    for key in keys {
        command.env_remove(key);
    }
    fallback
}

/// Issues, pins and caches this child's grant within `deadline`, returning
/// the environment the child receives. Runs off the spawn thread.
pub(crate) fn issue_child_grant(
    app: &AppHandle,
    session_id: &str,
    stamp: (u64, u64),
    fallback: &Value,
    deadline: std::time::Instant,
) -> Result<Vec<(&'static str, String)>, String> {
    let primary = session_id
        .rsplit_once('#')
        .filter(|(_, suffix)| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        .map(|(id, _)| id)
        .unwrap_or(session_id);
    let service = crate::remote::NativeServiceChannel::connect_until(app, Some(deadline))?;
    service.project_until(
        "conversation.access.issue",
        json!({"sessionId": primary}),
        deadline,
        |issued| {
            let mut issued = issued.clone();
            issued["endpoint"] = json!(service.endpoint());
            let mut grant = crate::session_tools_bridge::register_pinned(
                app,
                session_id,
                stamp,
                crate::session_tools_bridge::Group::Conversation,
                issued,
                service.clone(),
            )?;
            let (Some(token), Some(endpoint), Some(environment)) = (
                grant.get("token").and_then(Value::as_str),
                grant.get("endpoint").and_then(Value::as_str),
                grant.get("environmentId").and_then(Value::as_str),
            ) else {
                return Err("Conversation tool grant is incomplete".into());
            };
            let env = vec![
                ("BYCODA_CONVERSATION_TOKEN", token.to_owned()),
                ("BYCODA_CONVERSATION_ENDPOINT", endpoint.to_owned()),
                ("BYCODA_CONVERSATION_ENVIRONMENT", environment.to_owned()),
            ];
            for field in ["appEndpoint", "appToken"] {
                if fallback[field].is_string() {
                    grant[field] = fallback[field].clone();
                }
            }
            crate::session_tools_bridge::cache_grant(session_id, stamp, grants(), grant);
            Ok(env)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn desktop_approval_fixture() -> Value {
        json!({"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","action":"desktop.act.authorize","sessionId":"session-one","cwd":"C:\\project","environmentId":"host-one","deadline":1000,
          "input":{"operation":{"requestId":"operation-one","snapshotId":"snapshot-one","app":"Editor","windowId":"window-one","ref":"@snapshot-one:field","action":"set-value","text":"Ayşe: \"tam metin\"\nikinci satır","headed":false},
            "operationHash":"cda2228a143366523aa9ee7b26f5c6fc160dea48fb37689770ae5f6f7efd0682"}})
    }
    fn desktop_thread_approval_fixture() -> Value {
        let mut request = desktop_approval_fixture();
        request.as_object_mut().unwrap().remove("sessionId");
        request["threadId"] = json!("thread-one");
        request["projectId"] = json!("project-one");
        request
    }
    #[test]
    fn desktop_approval_thread_subject_preserves_all_exact_operation_hashes() {
        let request = desktop_thread_approval_fixture();
        let mut inputs = vec![request["input"].clone()];
        inputs.push(
            json!({"operation":{"kind":"launch","requestId":"launch-one","app":"Notepad"},
            "operationHash":"f13425b74660e9303b9f74aa4957d4fdf0d73d52d781814f7994ad9f108259d4"}),
        );
        inputs.push(json!({"operation":{"kind":"clipboard","requestId":"clipboard-read","target":"global-clipboard","action":"get"},
            "operationHash":"832e8caa64b06b39daf6b52d33a41d724604355672aed7828aa0279098792e41"}));
        for input in inputs {
            let mut request = request.clone();
            request["input"] = input;
            let approval = desktop_action_approval(&request, 10).unwrap();
            assert!(approval
                .message
                .contains("Assistant thread: \"thread-one\""));
            assert!(approval.message.contains("Project ID: \"project-one\""));
            assert!(approval.message.contains("C:\\\\project"));
            assert!(approval.message.contains("Host: \"host-one\""));
            assert!(!approval.message.contains("Agent session:"));
            assert_eq!(
                approval.result(false),
                json!({"approved":false,"operationHash":request["input"]["operationHash"]})
            );
            request["input"]["operation"]["requestId"] = json!("changed");
            assert!(desktop_action_approval(&request, 10).is_err());
        }
    }
    #[test]
    fn desktop_approval_thread_subject_rejects_ambiguous_missing_and_nonapproval_routes() {
        let request = desktop_thread_approval_fixture();
        for (field, value) in [
            ("sessionId", json!("session-one")),
            ("sessionId", Value::Null),
            ("threadId", Value::Null),
            ("threadId", json!("")),
            ("threadId", json!("t".repeat(201))),
            ("projectId", Value::Null),
            ("projectId", json!(" ")),
            ("projectId", json!("project\ninjected")),
            ("projectId", json!("p".repeat(201))),
            ("cwd", json!("")),
            ("environmentId", json!("")),
        ] {
            let mut invalid = request.clone();
            invalid[field] = value;
            assert!(
                desktop_action_approval(&invalid, 10).is_err(),
                "Accepted invalid {field}"
            );
        }
        for field in ["threadId", "projectId"] {
            let mut invalid = request.clone();
            invalid.as_object_mut().unwrap().remove(field);
            assert!(desktop_action_approval(&invalid, 10).is_err());
        }
        for action in [
            "servers.list",
            "ui.open",
            "sessions.read",
            "desktop.act",
            "desktop.launch",
            "desktop.clipboard",
            "tasks.write.authorize",
        ] {
            let mut invalid = request.clone();
            invalid["action"] = json!(action);
            // The same parser is called before routing any thread-bearing request.
            assert!(DesktopApprovalSubject::parse(&invalid).is_err());
            assert!(desktop_action_approval(&invalid, 10).is_err());
        }
        assert!(desktop_action_approval(&request, 1000).is_err());
    }
    #[test]
    fn desktop_approval_thread_keeps_native_decision_and_pre_post_revocation_fences() {
        use std::cell::Cell;
        let mut request = desktop_thread_approval_fixture();
        request["threadId"] = json!("thread\u{202e}one");
        let approval = desktop_action_approval(&request, 10).unwrap();
        assert!(approval.message.contains("thread\\u202eone"));
        assert!(!approval.message.contains('\u{202e}'));
        let shown = Cell::new(false);
        let denied = desktop_approval_decision(
            &approval,
            || Err("original thread revoked".into()),
            || {
                shown.set(true);
                true
            },
        );
        assert!(denied.is_err());
        assert!(!shown.get());
        let checks = Cell::new(0);
        let denied = desktop_approval_decision(
            &approval,
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 2 {
                    Err("original thread changed while dialog open".into())
                } else {
                    Ok(())
                }
            },
            || true,
        );
        assert!(denied.is_err());
        assert_eq!(checks.get(), 2);
        assert_eq!(
            desktop_approval_decision(&approval, || Ok(()), || false).unwrap()["approved"],
            false
        );
        assert_eq!(
            desktop_approval_decision(&approval, || Ok(()), || true).unwrap()["approved"],
            true
        );
    }
    #[test]
    fn desktop_approval_shows_exact_context_and_matches_javascript_hash() {
        // Fixed SHA-256 from Node JSON.stringify, not this Rust serializer.
        let request = desktop_approval_fixture();
        let approval = desktop_action_approval(&request, 10).unwrap();
        for text in [
            "session-one",
            "C:\\\\project",
            "host-one",
            "Editor",
            "window-one",
            "snapshot-one",
            "@snapshot-one:field",
            "set-value",
            "Ayşe: \\\"tam metin\\\"\\nikinci satır",
            "operation-one",
            "HEADLESS",
        ] {
            assert!(
                approval.message.contains(text),
                "Missing displayed field: {text}"
            );
        }
        assert_eq!(
            approval.result(false),
            json!({"approved":false,"operationHash":request["input"]["operationHash"]})
        );
        assert!(!approval
            .message
            .contains("Ayşe: \"tam metin\"\nikinci satır"));
    }
    #[test]
    fn desktop_launch_and_clipboard_approval_match_javascript_hash_without_fabricated_refs() {
        for (operation, hash, required) in [
            (
                json!({"kind":"launch","requestId":"launch-one","app":"Notepad"}),
                "f13425b74660e9303b9f74aa4957d4fdf0d73d52d781814f7994ad9f108259d4",
                vec!["Notepad", "LAUNCH OR ATTACH", "headless"],
            ),
            (
                json!({"kind":"clipboard","requestId":"clipboard-one","target":"global-clipboard","action":"set","text":"Ayşe: \"tam metin\"\nikinci satır"}),
                "606539e22b382156f830663a0aedd7b3e08d7c078a6f472f392dbab940c7b423",
                vec![
                    "GLOBAL SYSTEM CLIPBOARD",
                    "Replace the global clipboard",
                    "Ayşe: \\\"tam metin\\\"\\nikinci satır",
                ],
            ),
            (
                json!({"kind":"clipboard","requestId":"clipboard-read","target":"global-clipboard","action":"get"}),
                "832e8caa64b06b39daf6b52d33a41d724604355672aed7828aa0279098792e41",
                vec![
                    "GLOBAL SYSTEM CLIPBOARD",
                    "disclose them to this agent conversation",
                    "sensitive information",
                ],
            ),
        ] {
            let mut request = desktop_approval_fixture();
            request["input"] = json!({"operation":operation,"operationHash":hash});
            let approval = desktop_action_approval(&request, 10).unwrap();
            for value in required {
                assert!(
                    approval.message.contains(value),
                    "Missing displayed consequence: {value}"
                );
            }
            for fake in ["Snapshot:", "Target ref:", "Window:"] {
                assert!(!approval.message.contains(fake));
            }
            assert_eq!(approval.result(false)["approved"], false);
            let mut changed = request.clone();
            changed["input"]["operation"]["requestId"] = json!("changed");
            assert!(desktop_action_approval(&changed, 10).is_err());
        }
    }
    #[test]
    fn desktop_global_approval_rejects_self_grants_alternate_channels_and_invalid_union_shapes() {
        let mut request = desktop_approval_fixture();
        request["input"]["operation"] = json!({"kind":"clipboard","requestId":"clear","target":"global-clipboard","action":"clear"});
        let canonical: DesktopApprovalOperation =
            serde_json::from_value(request["input"]["operation"].clone()).unwrap();
        request["input"]["operationHash"] = json!(format!(
            "{:x}",
            Sha256::digest(serde_json::to_string(&canonical).unwrap().as_bytes())
        ));
        assert!(desktop_action_approval(&request, 10)
            .unwrap()
            .message
            .contains("removing its current contents"));
        for (key, value) in [
            ("approved", json!(true)),
            ("app", json!("Editor")),
            ("snapshotId", json!("fake")),
            ("format", json!("image")),
            ("out", json!("private.png")),
            ("text", json!("unexpected")),
            ("target", json!("per-app")),
            ("kind", json!("act")),
            ("action", json!("read-all")),
        ] {
            let mut invalid = request.clone();
            invalid["input"]["operation"][key] = value;
            assert!(
                desktop_action_approval(&invalid, 10).is_err(),
                "Accepted {key}"
            );
        }
        for operation in [
            json!({"kind":"launch","requestId":"l","app":"-option"}),
            json!({"kind":"launch","requestId":"l","app":"Editor","args":["--cdp"]}),
            json!({"kind":"launch","requestId":"l","app":"Editor","activate":true}),
            json!({"kind":"clipboard","requestId":"s","target":"global-clipboard","action":"set"}),
            json!({"kind":"clipboard","requestId":"s","target":"global-clipboard","action":"set","text":"NUL\0value"}),
        ] {
            let mut invalid = request.clone();
            invalid["input"]["operation"] = operation;
            assert!(desktop_action_approval(&invalid, 10).is_err());
        }
    }
    #[test]
    fn desktop_approval_rejects_forged_booleans_changed_targets_and_expiry() {
        let request = desktop_approval_fixture();
        for field in [
            "app",
            "windowId",
            "snapshotId",
            "ref",
            "action",
            "text",
            "requestId",
        ] {
            let mut changed = request.clone();
            changed["input"]["operation"][field] = json!("changed");
            assert!(
                desktop_action_approval(&changed, 10).is_err(),
                "Accepted changed {field}"
            );
        }
        for field in ["approved", "cwd", "principal", "sessionId"] {
            let mut changed = request.clone();
            changed["input"][field] = json!(true);
            assert!(desktop_action_approval(&changed, 10).is_err());
            let mut changed = request.clone();
            changed["input"]["operation"][field] = json!(true);
            assert!(desktop_action_approval(&changed, 10).is_err());
        }
        let mut invalid = request.clone();
        invalid["input"]["operationHash"] = json!("x".repeat(64));
        assert!(desktop_action_approval(&invalid, 10).is_err());
        assert!(desktop_action_approval(&request, 1000).is_err());
        let mut invalid = request.clone();
        invalid["sessionId"] = json!("");
        assert!(desktop_action_approval(&invalid, 10).is_err());
        let mut invalid = request.clone();
        invalid["input"]["operation"]["text"] = Value::Null;
        assert!(desktop_action_approval(&invalid, 10).is_err());
        let mut invalid = request.clone();
        invalid["input"]["operation"]["action"] = json!("press");
        assert!(desktop_action_approval(&invalid, 10)
            .err()
            .unwrap()
            .contains("physical input"));
    }
    #[test]
    fn desktop_approval_denial_checks_authority_before_and_after_native_decision() {
        use std::cell::Cell;
        let approval = desktop_action_approval(&desktop_approval_fixture(), 10).unwrap();
        let shown = Cell::new(false);
        let denied = desktop_approval_decision(
            &approval,
            || Err("revoked".into()),
            || {
                shown.set(true);
                false
            },
        );
        assert!(denied.is_err());
        assert!(!shown.get());
        let checks = Cell::new(0);
        let expired = desktop_approval_decision(
            &approval,
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 2 {
                    Err("expired".into())
                } else {
                    Ok(())
                }
            },
            || false,
        );
        assert!(expired.is_err());
        assert_eq!(checks.get(), 2);
        let denied = desktop_approval_decision(&approval, || Ok(()), || false).unwrap();
        assert_eq!(denied["approved"], false);
        assert_eq!(
            denied["operationHash"],
            desktop_approval_fixture()["input"]["operationHash"]
        );
    }
    #[test]
    fn desktop_approval_displays_directional_text_as_a_visible_json_escape() {
        let mut request = desktop_approval_fixture();
        request["input"]["operation"]["text"] = json!("review \u{202e}exact\u{202c} text");
        let operation: DesktopApprovalOperation =
            serde_json::from_value(request["input"]["operation"].clone()).unwrap();
        request["input"]["operationHash"] = json!(format!(
            "{:x}",
            Sha256::digest(serde_json::to_string(&operation).unwrap().as_bytes())
        ));
        let approval = desktop_action_approval(&request, 10).unwrap();
        assert!(approval.message.contains("review \\u202eexact\\u202c text"));
        assert!(!approval.message.contains('\u{202e}'));
    }
    #[test]
    fn task_approval_is_exact_and_rejects_unimplemented_actions() {
        let operation = json!({"action":"tasks.transfer", "taskId":"task-1", "title":"Move pending work", "expectedUpdatedAt":42, "targetProjectId":"target", "targetProjectName":"Destination"});
        let message = task_approval_message(&operation).unwrap();
        for required in ["task-1", "Destination", "target", "42"] {
            assert!(message.contains(required));
        }
        let mut unsupported = operation.clone();
        unsupported["action"] = json!("tasks.merge");
        assert!(task_approval_message(&unsupported).is_err());
        let note = json!({"action":"tasks.notes.resolve", "taskId":"task-1", "title":"Review", "expectedUpdatedAt":43, "noteId":"finding", "resolved":false, "note":"Check the fix"});
        assert!(task_approval_message(&note).unwrap().contains("unresolved"));
    }
    #[test]
    fn desktop_relay_polls_quickly_when_active_and_backs_off_when_unreachable() {
        use std::time::Duration;
        assert_eq!(
            next_poll_delay(0, Duration::from_secs(5)),
            Duration::from_secs(1)
        );
        assert_eq!(
            next_poll_delay(0, Duration::from_secs(120)),
            Duration::from_secs(2)
        );
        assert_eq!(next_poll_delay(1, Duration::ZERO), Duration::from_secs(2));
        assert_eq!(next_poll_delay(3, Duration::ZERO), Duration::from_secs(8));
        assert_eq!(next_poll_delay(40, Duration::ZERO), Duration::from_secs(30));
    }

    #[test]
    fn merge_approval_displays_reviewed_head_for_every_mode() {
        for action in ["merge", "squash", "rebase"] {
            let mut operation = json!({"action":"pr-action","cwd":"/project","item":{"provider":"github","kind":"pr","number":7,"repo":"owner/project"},"prAction":action});
            assert!(inbox_approval_message(&operation, "/project").is_err());
            operation["expectedHeadOid"] = json!("a".repeat(40));
            let message = inbox_approval_message(&operation, "/project").unwrap();
            assert!(message.contains(&"a".repeat(40)));
            assert!(message.contains("refresh and review again"));
        }
    }

    #[test]
    fn acp_session_reads_keep_local_grants_when_host_grants_are_unavailable() {
        let raw = json!({"method":"session/new","params":{"mcpServers":[
            {"name":"bycoda-conversation","command":"node","env":[{"name":"BYCODA_APP_TOKEN","value":"forged"}]},
            {"name":"other","command":"node","env":[]}
        ]}}).to_string();
        let decorated: Value = serde_json::from_str(&decorate_frame(
            raw,
            &json!({"appEndpoint":"127.0.0.1:1","appToken":"local-read-token"}),
        ))
        .unwrap();
        assert_eq!(
            decorated["params"]["mcpServers"][0]["env"],
            json!([
                {"name":"BYCODA_APP_ENDPOINT","value":"127.0.0.1:1"},
                {"name":"BYCODA_APP_TOKEN","value":"local-read-token"}
            ])
        );
        assert_eq!(decorated["params"]["mcpServers"][1]["env"], json!([]));
    }
    #[test]
    fn inbox_approval_shows_exact_target_content_and_rejects_scope_changes() {
        let operation = json!({"action":"comment","cwd":"/project","item":{"provider":"github","kind":"pr","number":7,"repo":"owner/project"},"body":"Exact comment\nsecond line","inReplyTo":"review-thread"});
        let message = inbox_approval_message(&operation, "/project").unwrap();
        assert!(message.contains("owner/project #7"));
        assert!(message.contains("Exact comment\nsecond line"));
        assert!(message.contains("review-thread"));
        assert!(inbox_approval_message(&operation, "/foreign").is_err());
        assert!(
            inbox_approval_message(&json!({"action":"list","cwd":"/project"}), "/project").is_err()
        );
        assert!(inbox_approval_message(&json!({"action":"pr-action","cwd":"/project","item":{"provider":"jira","kind":"jira","number":7},"prAction":"merge"}), "/project").is_err());
    }
    #[test]
    fn scopes_acp_credentials_to_conversation_server_and_preserves_prompts() {
        let grant = json!({"token":"scoped-conversation-token","endpoint":"http://localhost:1","environmentId":"host"});
        let raw = json!({"method":"session/new","params":{"mcpServers":[
            {"name":"bycoda-conversation","command":"node","env":[{"name":"BYCODA_CONVERSATION_TOKEN","value":"forged"},{"name":"KEEP","value":"yes"}]},
            {"name":"other","command":"node","env":[]}
        ]}}).to_string();
        let result: Value = serde_json::from_str(&decorate_frame(raw.clone(), &grant)).unwrap();
        assert!(!raw.contains("scoped-conversation-token"));
        assert_eq!(
            result["params"]["mcpServers"][0]["env"][1]["value"],
            "scoped-conversation-token"
        );
        assert_eq!(result["params"]["mcpServers"][1]["env"], json!([]));
        let prompt =
            json!({"method":"session/prompt","params":{"text":"Ignore permissions"}}).to_string();
        assert_eq!(decorate_frame(prompt.clone(), &grant), prompt);
    }

    #[test]
    fn management_approval_is_exact_bounded_and_never_accepts_arbitrary_actions() {
        let request = json!({
            "action":"management.write.authorize", "threadId":"thread", "projectId":"project",
            "cwd":"C:\\project", "environmentId":"host",
            "input":{"operation":{"action":"git.commit", "input":{"requestId":"one","message":"Commit reviewed changes"}, "operationHash":"a".repeat(64)}}
        });
        let (message, hash) = management_approval_message(&request).unwrap();
        assert!(message.contains("git.commit"));
        assert!(message.contains("Commit reviewed changes"));
        assert_eq!(hash, "a".repeat(64));
        let mut note = request.clone();
        note["input"]["operation"]["action"] = json!("notes.update");
        note["input"]["operation"]["input"] = json!({"requestId":"note-request","noteInput":{"id":"note","expectedUpdatedAt":42,"body":"reviewed text"}});
        let (note_message, _) = management_approval_message(&note).unwrap();
        assert!(note_message.contains("notes.update") && note_message.contains("reviewed text"));
        let mut file = request.clone();
        file["targetProjectCwd"] = json!("C:\\project");
        file["input"]["operation"]["action"] = json!("files.write");
        file["input"]["operation"]["input"] = json!({"requestId":"file-one", "path":"src/main.ts", "expectedHash":"b".repeat(64), "content":"owner-visible text"});
        let (file_message, _) = management_approval_message(&file).unwrap();
        assert!(
            file_message.contains("src/main.ts")
                && file_message.contains("owner-visible text")
                && file_message.contains("sha256")
        );
        file["input"]["operation"]["input"]["content"] = json!("x".repeat(16000));
        let (bounded, _) = management_approval_message(&file).unwrap();
        assert!(bounded.contains("truncated") && bounded.len() < 32000);
        file["input"]["operation"]["action"] = json!("devServers.restart");
        file["input"]["operation"]["input"] =
            json!({"requestId":"server-one", "id":"server", "expectedImpact":"tree"});
        assert!(management_approval_message(&file)
            .unwrap()
            .0
            .contains("server-one"));
        file["input"]["operation"]["action"] = json!("terminals.write");
        file["input"]["operation"]["input"] =
            json!({"requestId":"terminal-one", "terminalId":"terminal", "data":"pwd\n"});
        let (terminal_message, _) = management_approval_message(&file).unwrap();
        assert!(
            terminal_message.contains("terminals.write")
                && terminal_message.contains("pwd")
                && terminal_message.contains("not a sandbox")
                && terminal_message.contains("completion is not observed")
        );
        let mut invalid = request.clone();
        invalid["input"]["operation"]["action"] = json!("workspace.run");
        assert!(management_approval_message(&invalid).is_err());
        invalid = request.clone();
        invalid["input"]["operation"]["operationHash"] = json!("invalid");
        assert!(management_approval_message(&invalid).is_err());
        invalid = request.clone();
        invalid.as_object_mut().unwrap().remove("cwd");
        assert!(management_approval_message(&invalid)
            .unwrap()
            .0
            .contains("project"));
        invalid.as_object_mut().unwrap().remove("projectId");
        invalid["input"]["operation"]["action"] = json!("crews.start");
        assert!(management_approval_message(&invalid)
            .unwrap()
            .0
            .contains("Application-wide"));
        invalid = request.clone();
        invalid["input"]["operation"]["input"]["message"] = json!("x".repeat(32001));
        assert!(management_approval_message(&invalid).is_err());
        invalid = request.clone();
        invalid["input"]["operation"]["approved"] = json!(true);
        assert!(management_approval_message(&invalid).is_err());
        invalid = request.clone();
        invalid["sessionId"] = json!("session");
        assert!(management_approval_message(&invalid).is_err());
        invalid = request.clone();
        invalid["input"]["operation"]["input"]["message"] = json!("review \u{202e}exact\u{202c}");
        let (message, _) = management_approval_message(&invalid).unwrap();
        assert!(message.contains("\\u202eexact\\u202c"));
        assert!(!message.contains('\u{202e}'));
    }
}
