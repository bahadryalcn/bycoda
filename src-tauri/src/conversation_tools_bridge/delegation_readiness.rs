use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::AppHandle;

// Reuse credentials, never readiness. Initialize still revalidates session authority every turn.
type ProbeGrant = (String, String, Value);
fn probe_grants() -> &'static Mutex<HashMap<String, ProbeGrant>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, ProbeGrant>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fresh scoped initialize, off the UI thread. Metadata cannot prove session authority.
pub(super) fn delegation_bridge_ready(app: &AppHandle, session: &str) -> bool {
    if crate::session_tools_bridge::optional_host_deadline().is_none() {
        return false;
    }
    let deadline = std::time::Instant::now() + Duration::from_millis(1_000);
    let check = || -> Result<bool, String> {
        let service = crate::remote::NativeServiceChannel::connect_until(app, Some(deadline))?;
        let cached = probe_grants()
            .lock()
            .map_err(|_| "Probe credentials unavailable")?
            .get(session)
            .filter(|(endpoint, environment, _)| {
                endpoint == service.endpoint() && environment == service.environment_id()
            })
            .map(|(_, _, grant)| grant.clone());
        let grant = if let Some(grant) = cached {
            grant
        } else {
            service.project_until(
                "conversation.access.issue",
                json!({"sessionId": session}),
                deadline,
                |value| Ok(value.clone()),
            )?
        };
        let token = grant["token"].as_str().ok_or("Missing scoped credential")?;
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Ok(false);
        }
        let response = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(remaining)
            .build()
            .post(&format!(
                "{}/mcp/conversation",
                service.endpoint().trim_end_matches('/')
            ))
            .set("Authorization", &format!("Bearer {token}"))
            .set("Content-Type", "application/json")
            .set("Accept", "application/json, text/event-stream")
            .send_string(
                &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                    "protocolVersion":"2025-11-25","capabilities":{},
                    "clientInfo":{"name":"bycoda-readiness","version":"1"}
                }})
                .to_string(),
            )
            .map_err(|_| "Conversation initialize unavailable")?;
        let mut body = String::new();
        std::io::Read::read_to_string(&mut response.into_reader().take(65_536), &mut body)
            .map_err(|_| "Conversation initialize interrupted")?;
        let value: Value =
            serde_json::from_str(&body).map_err(|_| "Invalid initialize response")?;
        service.check()?;
        let ready = initialized(&value);
        if ready {
            let mut grants = probe_grants()
                .lock()
                .map_err(|_| "Probe credentials unavailable")?;
            if grants.len() >= 256 && !grants.contains_key(session) {
                if let Some(key) = grants.keys().next().cloned() {
                    grants.remove(&key);
                }
            }
            grants.insert(
                session.to_owned(),
                (
                    service.endpoint().to_owned(),
                    service.environment_id().to_owned(),
                    grant,
                ),
            );
        }
        Ok(ready)
    };
    let ready = check().unwrap_or(false);
    if !ready {
        if let Ok(mut grants) = probe_grants().lock() {
            grants.remove(session);
        }
    }
    ready
}

fn initialized(value: &Value) -> bool {
    value["id"] == 1
        && value.get("error").is_none()
        && value["result"]["protocolVersion"].is_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_or_protocol_errors_are_not_initialize_readiness() {
        assert!(!initialized(&json!({"command":"node","args":[]})));
        assert!(!initialized(&json!({"id":1,"error":{"code":-32603}})));
        assert!(!initialized(
            &json!({"id":2,"result":{"protocolVersion":"2025-11-25"}})
        ));
        assert!(!initialized(&json!({"id":1,"result":{}})));
        assert!(initialized(
            &json!({"id":1,"result":{"protocolVersion":"2025-11-25"}})
        ));
    }
}
