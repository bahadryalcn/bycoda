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
#[tauri::command]
pub async fn harness_social_bridge(app: AppHandle, session_id: String) -> Result<Option<Value>, String> {
    crate::harness::run_blocking("harness_social_bridge", move || {
        if session_id.is_empty() {
            return Ok(None);
        }
        // Optional metadata: a slow Host must not hold the send for 30 s.
        let Some(deadline) = crate::session_tools_bridge::optional_host_deadline() else {
            return Ok(None);
        };
        let value = crate::remote::local_social_rpc_until(
            &app,
            "social.bridge.describe",
            json!({}),
            Some(deadline),
        );
        crate::session_tools_bridge::note_optional_host_outcome(deadline, value.is_ok());
        Ok(value.ok().map(|value| {
            crate::session_tools_bridge::metadata(value, crate::session_tools_bridge::Group::Social)
        }))
    })
    .await
}

/// An isolated title/catalog helper must never inherit an agent's grant or
/// host OAuth app secrets from ambient environment variables.
pub(crate) fn strip_child_env(command: &mut Command) {
    for (key, _) in std::env::vars() {
        if key.starts_with("BYCODA_SOCIAL_") {
            command.env_remove(key);
        }
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
        .filter(|(_, suffix)| suffix.chars().all(|c| c.is_ascii_digit()))
        .map(|(id, _)| id)
        .unwrap_or(session_id);
    let issuer = crate::remote::NativeServiceChannel::connect_until(app, Some(deadline))?;
    let reply = issuer.request_until(
        "social.access.issue",
        json!({"sessionId":primary}),
        Some(deadline),
    )?;
    reply.project(|value| {
        let mut grant = value.clone();
        if grant.get("endpoint").is_none() {
            grant["endpoint"] = json!(issuer.endpoint());
        }
        let grant = crate::session_tools_bridge::register_pinned(
            app,
            session_id,
            stamp,
            crate::session_tools_bridge::Group::Social,
            grant,
            issuer.clone(),
        )?;
        let token = grant
            .get("token")
            .and_then(Value::as_str)
            .ok_or("Scoped tool token required")?;
        let endpoint = grant
            .get("endpoint")
            .and_then(Value::as_str)
            .ok_or("Scoped tool endpoint required")?;
        let environment = grant
            .get("environmentId")
            .and_then(Value::as_str)
            .ok_or("Scoped tool environment required")?;
        let env = vec![
            ("BYCODA_SOCIAL_TOKEN", token.to_owned()),
            ("BYCODA_SOCIAL_ENDPOINT", endpoint.to_owned()),
            ("BYCODA_SOCIAL_ENVIRONMENT", environment.to_owned()),
        ];
        crate::session_tools_bridge::cache_grant(session_id, stamp, grants(), grant);
        Ok(env)
    })
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
