use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Probe the same broker route and capability supplied to the provider spawn.
/// Missing, revoked and replaced routes fail closed; readiness never issues grants.
pub(super) fn delegation_bridge_ready(_app: &AppHandle, session: &str) -> bool {
    let Some(grant) = crate::session_tools_bridge::conversation_grant(session) else {
        return false;
    };
    let check = || -> Result<bool, String> {
        let response = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(Duration::from_millis(1_000))
            .build()
            .post(&format!(
                "{}/mcp/conversation",
                grant["endpoint"].as_str().unwrap()
            ))
            .set(
                "Authorization",
                &format!("Bearer {}", grant["token"].as_str().unwrap()),
            )
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
        response
            .into_reader()
            .take(65_536)
            .read_to_string(&mut body)
            .map_err(|_| "Conversation initialize interrupted")?;
        let value: Value =
            serde_json::from_str(&body).map_err(|_| "Invalid initialize response")?;
        Ok(initialized(&value)
            && crate::session_tools_bridge::conversation_grant(session).as_ref() == Some(&grant))
    };
    check().unwrap_or(false)
}

/// A running provider child without a live conversation route (started while the Host
/// did not answer, or the Host restarted since) gains Host tools only when it starts
/// again: a CLI reads its MCP servers at spawn. True only while the Host answers now.
pub(super) fn respawn_restores_tools(app: &AppHandle, session: &str) -> bool {
    if !app
        .state::<crate::harness::HarnessHost>()
        .has_child(session)
        || crate::session_tools_bridge::conversation_grant(session).is_some()
    {
        return false;
    }
    let Some(deadline) = crate::session_tools_bridge::optional_host_deadline() else {
        return false;
    };
    let answered = crate::remote::NativeServiceChannel::connect_until(app, Some(deadline))
        .and_then(|service| {
            service.project_until("conversation.bridge.describe", json!({}), deadline, |_| {
                Ok(())
            })
        })
        .is_ok();
    crate::session_tools_bridge::note_optional_host_outcome(deadline, answered);
    answered
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
