//! Conversation grants remain in native memory and provider children.
//! The renderer receives executable metadata, never host or session credentials.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub fn start_desktop_relay(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Ok(requests) =
            crate::remote::local_conversation_rpc(&app, "conversation.desktop.take", json!({}))
        {
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
        std::thread::sleep(std::time::Duration::from_secs(1));
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
    if action.starts_with("ui.") || matches!(action, "sessions.list" | "sessions.read") {
        return crate::control::conversation_ui_request(
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
        );
    }
    if action == "inbox.write.authorize" {
        // Native-only acknowledgement: the agent cannot supply an approval boolean.
        let message = inbox_approval_message(
            &input["operation"],
            request["cwd"]
                .as_str()
                .ok_or("Project directory required")?,
        )?;
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
            .message(message)
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
        return crate::remote::conversation_machine_call(app, action, input);
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
        "terminals.write" => ptys.conversation_write(
            &cwd,
            input["terminalId"].as_str().ok_or("Terminal ID required")?,
            input["data"].as_str().ok_or("Terminal data required")?,
        ),
        _ => Err("Unsupported desktop tool".into()),
    }
}

fn inbox_approval_message(operation: &Value, cwd: &str) -> Result<String, String> {
    let action = operation["action"]
        .as_str()
        .ok_or("Invalid inbox approval")?;
    if !matches!(action, "comment" | "pr-action") || operation["cwd"].as_str() != Some(cwd) {
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
        format!("Change pull request state: {change}")
    };
    Ok(format!("An agent requests this external Inbox operation. Approve only if the exact target and content match your request.\n\nProject: {cwd}\nProvider: {provider}\nTarget: {repo} #{number} {key}\nReply to: {}\n\n{content}", operation["inReplyTo"].as_str().unwrap_or("(new comment)")))
}

fn grants() -> &'static Mutex<HashMap<String, Value>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
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

pub fn redact_lines(session_id: &str, lines: Vec<String>) -> Vec<String> {
    let tokens = grants()
        .lock()
        .ok()
        .and_then(|map| map.get(session_id).cloned())
        .map(|grant| {
            ["token", "appToken"]
                .into_iter()
                .filter_map(|field| grant[field].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    lines
        .into_iter()
        .map(|line| {
            tokens.iter().fold(line, |line, token| {
                line.replace(token, "[conversation credential redacted]")
            })
        })
        .collect()
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
    Ok(value.ok())
}

pub fn configure_child(app: &AppHandle, session_id: &str, command: &mut Command) {
    if let Ok(mut map) = grants().lock() {
        map.remove(session_id);
    }
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
        if let Ok(mut map) = grants().lock() {
            map.insert(session_id.to_owned(), fallback.clone());
        }
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
    let Ok(mut grant) = crate::remote::local_conversation_rpc(
        app,
        "conversation.access.issue",
        json!({"sessionId": primary}),
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
    if let Ok(mut map) = grants().lock() {
        map.insert(session_id.to_owned(), grant);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
