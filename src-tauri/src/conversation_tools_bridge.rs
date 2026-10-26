//! Conversation grants remain in native memory and provider children.
//! The renderer receives executable metadata, never host or session credentials.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[path = "conversation_servers.rs"]
mod servers;

/// Poll cadence: answers stay quick while agents are using desktop tools, idle
/// polling slows down, and an unreachable or unpaired host backs off to 30 s.
fn next_poll_delay(failures: u32, since_request: std::time::Duration) -> std::time::Duration {
    use std::time::Duration;
    if failures > 0 {
        return Duration::from_secs(1u64 << failures.min(5)).min(Duration::from_secs(30));
    }
    if since_request < Duration::from_secs(60) {
        Duration::from_secs(1)
    } else {
        Duration::from_secs(2)
    }
}

pub fn start_desktop_relay(app: AppHandle) {
    let mut failures = 0u32;
    let mut last_request = std::time::Instant::now();
    std::thread::spawn(move || loop {
        let taken =
            crate::remote::local_conversation_rpc(&app, "conversation.desktop.take", json!({}));
        failures = if taken.is_ok() {
            0
        } else {
            failures.saturating_add(1)
        };
        if let Ok(requests) = taken {
            if requests.as_array().is_some_and(|list| !list.is_empty()) {
                last_request = std::time::Instant::now();
            }
            for request in requests.as_array().into_iter().flatten() {
                let request = request.clone();
                let app = app.clone();
                std::thread::spawn(move || {
                    let result = execute_desktop_request(&app, &request);
                    let reply = match result {
                        Ok(value) => json!({"id": request["id"], "result": value}),
                        Err(error) => json!({"id": request["id"], "error": error}),
                    };
                    let _ = crate::remote::local_conversation_rpc(
                        &app,
                        "conversation.desktop.finish",
                        reply,
                    );
                });
            }
        }
        std::thread::sleep(next_poll_delay(failures, last_request.elapsed()));
    });
}

fn execute_desktop_request(app: &AppHandle, request: &Value) -> Result<Value, String> {
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
    let input = &request["input"];
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
            })
        } else {
            None
        };
        return crate::control::conversation_ui_request_with_authority(
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
        );
    }
    if action == "tasks.write.authorize" {
        let operation = &input["operation"];
        let message = task_approval_message(operation)?;
        let approved = app
            .dialog()
            .message(message)
            .title("bycoda — Task operation approval")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Approve this operation".into(),
                "Cancel".into(),
            ))
            .blocking_show();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64;
        if request["deadline"]
            .as_u64()
            .is_none_or(|deadline| deadline <= now)
        {
            return Err("Task approval expired".into());
        }
        return Ok(json!({ "approved": approved }));
    }
    if action == "inbox.write.authorize" {
        // Native-only acknowledgement: the agent cannot supply an approval boolean.
        let message = inbox_approval_message(
            &input["operation"],
            request["cwd"]
                .as_str()
                .ok_or("Project directory required")?,
        )?;
        let thread_context = inbox_reply_approval_context(&input["operation"])?;
        static APPROVAL_GATE: Mutex<()> = Mutex::new(());
        let _guard = APPROVAL_GATE
            .lock()
            .map_err(|_| "Inbox approval is unavailable")?;
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64;
        if request["deadline"]
            .as_u64()
            .is_none_or(|deadline| deadline <= before)
        {
            return Err("Inbox approval expired; no operation was submitted".into());
        }
        let approved = app
            .dialog()
            .message(format!("{message}{thread_context}"))
            .title("bycoda — Inbox operation approval")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Approve this operation".into(),
                "Cancel".into(),
            ))
            .blocking_show();
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64;
        if request["deadline"]
            .as_u64()
            .is_none_or(|deadline| deadline <= at)
        {
            return Err("Inbox approval expired; no operation was submitted".into());
        }
        return Ok(json!({"approved": approved}));
    }
    if action == "machines.list" || action.starts_with("devices.") {
        let owner = format!(
            "{}:{}",
            request["environmentId"]
                .as_str()
                .ok_or("Host identity required")?,
            request["sessionId"]
                .as_str()
                .ok_or("Session identity required")?
        );
        let mut value = crate::remote::conversation_machine_call(
            app,
            action,
            input,
            &owner,
            &request["deadline"],
        )?;
        if action == "devices.preview" {
            // UI acknowledgement is independent from the asynchronous device job.
            let panel = crate::control::conversation_ui_request(
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
            );
            value["panel"] = match panel {
                Ok(panel) => panel,
                Err(error) => json!({ "open": false, "error": error }),
            };
        }
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

#[tauri::command(async)]
pub fn harness_conversation_tools_bridge(
    app: AppHandle,
    session_id: String,
) -> Result<Option<Value>, String> {
    if session_id.is_empty() {
        return Ok(None);
    }
    let value =
        crate::remote::local_conversation_rpc(&app, "conversation.bridge.describe", json!({}));
    Ok(value.ok().map(|value| {
        crate::session_tools_bridge::metadata(
            value,
            crate::session_tools_bridge::Group::Conversation,
        )
    }))
}

pub fn configure_child(
    app: &AppHandle,
    session_id: &str,
    command: &mut Command,
    stamp: (u64, u64),
) {
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
    let primary = session_id
        .rsplit_once('#')
        .filter(|(_, suffix)| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        .map(|(id, _)| id)
        .unwrap_or(session_id);
    let Ok(grant) = crate::remote::local_conversation_rpc(
        app,
        "conversation.access.issue",
        json!({"sessionId": primary}),
    ) else {
        return;
    };
    let Ok(mut grant) = crate::session_tools_bridge::register(
        app,
        session_id,
        stamp,
        crate::session_tools_bridge::Group::Conversation,
        grant,
    ) else {
        return;
    };
    let (Some(token), Some(endpoint), Some(environment)) = (
        grant.get("token").and_then(Value::as_str),
        grant.get("endpoint").and_then(Value::as_str),
        grant.get("environmentId").and_then(Value::as_str),
    ) else {
        return;
    };
    command
        .env("BYCODA_CONVERSATION_TOKEN", token)
        .env("BYCODA_CONVERSATION_ENDPOINT", endpoint)
        .env("BYCODA_CONVERSATION_ENVIRONMENT", environment);
    for field in ["appEndpoint", "appToken"] {
        if fallback[field].is_string() {
            grant[field] = fallback[field].clone();
        }
    }
    crate::session_tools_bridge::cache_grant(session_id, stamp, grants(), grant);
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
