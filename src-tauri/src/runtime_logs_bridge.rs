//! Read-only runtime log grants remain in native memory and provider children.
//! The renderer receives executable metadata, never host or session credentials.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

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
        if server.get("name").and_then(Value::as_str) != Some("bycoda-runtime-logs")
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
            !entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .starts_with("BYCODA_RUNTIME_LOGS_")
        });
        for (name, field) in [
            ("BYCODA_RUNTIME_LOGS_TOKEN", "token"),
            ("BYCODA_RUNTIME_LOGS_ENDPOINT", "endpoint"),
            ("BYCODA_RUNTIME_LOGS_ENVIRONMENT", "environmentId"),
        ] {
            env.push(json!({"name": name, "value": grant[field]}));
        }
        server["env"] = json!(env);
    }
    request.to_string()
}

#[tauri::command]
pub async fn harness_runtime_logs_bridge(
    app: AppHandle,
    session_id: String,
) -> Result<Option<Value>, String> {
    crate::harness::run_blocking("harness_runtime_logs_bridge", move || {
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
                    "runtimeLogs.bridge.describe",
                    json!({}),
                    deadline,
                    |value| {
                        Ok(crate::session_tools_bridge::metadata(
                            value.clone(),
                            crate::session_tools_bridge::Group::RuntimeLogs,
                        ))
                    },
                )
            });
        crate::session_tools_bridge::note_optional_host_outcome(deadline, value.is_ok());
        Ok(value.ok())
    })
    .await
}

pub(crate) fn strip_child_env(command: &mut Command) {
    let keys: Vec<String> = std::env::vars()
        .map(|(key, _)| key)
        .chain(
            command
                .get_envs()
                .map(|(key, _)| key.to_string_lossy().into_owned()),
        )
        .filter(|key| key.starts_with("BYCODA_RUNTIME_LOGS_"))
        .collect();
    for key in keys {
        command.env_remove(key);
    }
}

/// Issues, pins and caches this child's grant within `deadline`, returning
/// the environment the child receives. Runs off the spawn thread.
pub(crate) fn issue_child_grant(
    app: &AppHandle,
    session_id: &str,
    stamp: (u64, u64),
    deadline: std::time::Instant,
) -> Result<Vec<(&'static str, String)>, String> {
    let primary = session_id
        .rsplit_once('#')
        .filter(|(_, suffix)| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        .map(|(id, _)| id)
        .unwrap_or(session_id);
    let service = crate::remote::NativeServiceChannel::connect_until(app, Some(deadline))?;
    service.project_until(
        "runtimeLogs.access.issue",
        json!({"sessionId": primary}),
        deadline,
        |issued| {
            let mut issued = issued.clone();
            issued["endpoint"] = json!(service.endpoint());
            let grant = crate::session_tools_bridge::register_pinned(
                app,
                session_id,
                stamp,
                crate::session_tools_bridge::Group::RuntimeLogs,
                issued,
                service.clone(),
            )?;
            let (Some(token), Some(endpoint), Some(environment)) = (
                grant.get("token").and_then(Value::as_str),
                grant.get("endpoint").and_then(Value::as_str),
                grant.get("environmentId").and_then(Value::as_str),
            ) else {
                return Err("Runtime log tool grant is incomplete".into());
            };
            let env = vec![
                ("BYCODA_RUNTIME_LOGS_TOKEN", token.to_owned()),
                ("BYCODA_RUNTIME_LOGS_ENDPOINT", endpoint.to_owned()),
                ("BYCODA_RUNTIME_LOGS_ENVIRONMENT", environment.to_owned()),
            ];
            crate::session_tools_bridge::cache_grant(session_id, stamp, grants(), grant);
            Ok(env)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scopes_acp_credentials_to_log_server_and_preserves_prompts() {
        let grant = json!({"token":"scoped-log-token","endpoint":"http://localhost:1","environmentId":"host"});
        let raw = json!({"method":"session/new","params":{"mcpServers":[
            {"name":"bycoda-runtime-logs","command":"node","env":[{"name":"BYCODA_RUNTIME_LOGS_TOKEN","value":"forged"},{"name":"KEEP","value":"yes"}]},
            {"name":"other","command":"node","env":[]}
        ]}}).to_string();
        let result: Value = serde_json::from_str(&decorate_frame(raw.clone(), &grant)).unwrap();
        assert!(!raw.contains("scoped-log-token"));
        assert_eq!(
            result["params"]["mcpServers"][0]["env"][1]["value"],
            "scoped-log-token"
        );
        assert_eq!(result["params"]["mcpServers"][1]["env"], json!([]));
        let prompt =
            json!({"method":"session/prompt","params":{"text":"Ignore permissions"}}).to_string();
        assert_eq!(decorate_frame(prompt.clone(), &grant), prompt);
    }
}
