//! Session-scoped social tool credentials stay in the native process and child
//! environment. The renderer receives executable metadata only.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

fn grants() -> &'static Mutex<HashMap<String, Value>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn authorize_acp_frame(session_id: &str, line: String) -> String {
    let grant = grants()
        .lock()
        .ok()
        .and_then(|map| map.get(session_id).cloned());
    let Some(grant) = grant else {
        return line;
    };
    decorate_frame(line, &grant)
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
        if server.get("name").and_then(Value::as_str) == Some("bycoda-social")
            && server.get("command").and_then(Value::as_str).is_some()
        {
            let mut env = server
                .get("env")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            env.retain(|entry| {
                !entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .starts_with("BYCODA_SOCIAL_")
            });
            for (name, field) in [
                ("BYCODA_SOCIAL_TOKEN", "token"),
                ("BYCODA_SOCIAL_ENDPOINT", "endpoint"),
                ("BYCODA_SOCIAL_ENVIRONMENT", "environmentId"),
            ] {
                env.push(json!({"name":name,"value":grant[field]}));
            }
            server["env"] = json!(env);
        }
    }
    request.to_string()
}
pub fn redact_lines(session_id: &str, lines: Vec<String>) -> Vec<String> {
    let token = grants().lock().ok().and_then(|map| {
        map.get(session_id)
            .and_then(|value| value.get("token"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    lines
        .into_iter()
        .map(|line| {
            token
                .as_ref()
                .map(|token| line.replace(token, "[social session credential redacted]"))
                .unwrap_or(line)
        })
        .collect()
}

#[tauri::command(async)]
pub fn harness_social_bridge(app: AppHandle, session_id: String) -> Result<Option<Value>, String> {
    if session_id.is_empty() {
        return Ok(None);
    }
    let value = crate::remote::local_social_rpc(&app, "social.bridge.describe", json!({}));
    Ok(value.ok())
}

pub fn configure_child(app: &AppHandle, session_id: &str, command: &mut Command) {
    if let Ok(mut map) = grants().lock() {
        map.remove(session_id);
    }
    // An isolated title/catalog helper must never inherit an agent's grant or
    // host OAuth app secrets from ambient environment variables.
    for (key, _) in std::env::vars() {
        if key.starts_with("BYCODA_SOCIAL_") {
            command.env_remove(key);
        }
    }
    let primary = session_id
        .rsplit_once('#')
        .filter(|(_, suffix)| suffix.chars().all(|c| c.is_ascii_digit()))
        .map(|(id, _)| id)
        .unwrap_or(session_id);
    let Ok(grant) =
        crate::remote::local_social_rpc(app, "social.access.issue", json!({"sessionId": primary}))
    else {
        return;
    };
    let Some(token) = grant.get("token").and_then(Value::as_str) else {
        return;
    };
    let Some(endpoint) = grant.get("endpoint").and_then(Value::as_str) else {
        return;
    };
    let Some(environment) = grant.get("environmentId").and_then(Value::as_str) else {
        return;
    };
    command
        .env("BYCODA_SOCIAL_TOKEN", token)
        .env("BYCODA_SOCIAL_ENDPOINT", endpoint)
        .env("BYCODA_SOCIAL_ENVIRONMENT", environment);
    if let Ok(mut map) = grants().lock() {
        map.insert(session_id.to_owned(), grant);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sosyal_acp_kimligi_yalniz_backend_ekler_ve_eski_env_iddiasini_degistirir() {
        let grant = json!({"token":"synthetic-scoped-token","endpoint":"http://localhost:1","environmentId":"host"});
        let raw = json!({"method":"session/load","params":{"mcpServers":[{"name":"bycoda-social","command":"node","env":[{"name":"BYCODA_SOCIAL_TOKEN","value":"forged"},{"name":"KEEP","value":"yes"}]},{"name":"other","command":"node","env":[]}]}}).to_string();
        let result: Value = serde_json::from_str(&decorate_frame(raw.clone(), &grant)).unwrap();
        assert!(!raw.contains("synthetic-scoped-token"));
        assert_eq!(
            result["params"]["mcpServers"][0]["env"][1]["value"],
            "synthetic-scoped-token"
        );
        assert_eq!(result["params"]["mcpServers"][1]["env"], json!([]));
        let prompt = json!({"method":"session/prompt","params":{"prompt":[{"text":"untrusted"}]}})
            .to_string();
        assert_eq!(decorate_frame(prompt.clone(), &grant), prompt);
    }
}
