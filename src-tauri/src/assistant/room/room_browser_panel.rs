//! Project-scoped Room browser requests from the actual registered window.
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, WebviewWindow};

fn action_allowed(action: &str) -> bool {
    matches!(
        action,
        "browser.status"
            | "browser.claim"
            | "browser.release"
            | "browser.open"
            | "browser.frame"
            | "browser.resize"
            | "browser.input"
            | "browser.close"
            | "browser.operation.status"
    )
}
fn request_id(action: &str, input: &Value) -> Result<String, String> {
    if action == "browser.input" {
        input["requestId"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 200 && !value.contains('\0'))
            .map(str::to_owned)
            .ok_or("Original Room browser input identity required".into())
    } else {
        Ok(uuid::Uuid::new_v4().to_string())
    }
}

#[tauri::command(async)]
pub fn control_room_browser_panel_request(
    app: AppHandle,
    window: WebviewWindow,
    environment_id: String,
    project_id: String,
    thread_id: String,
    project_cwd: String,
    action: String,
    input: Value,
) -> Result<Value, String> {
    if [&environment_id, &project_id, &thread_id]
        .iter()
        .any(|s| s.is_empty() || s.len() > 200 || s.contains('\0'))
        || project_cwd.is_empty()
        || project_cwd.len() > 4096
        || project_cwd.contains('\0')
        || !action_allowed(&action)
        || input.as_object().is_none_or(|object| {
            [
                "environmentId",
                "projectId",
                "threadId",
                "projectCwd",
                "sessionId",
                "deviceHash",
                "ownerPresentationScope",
            ]
            .iter()
            .any(|key| object.contains_key(*key))
        })
        || serde_json::to_vec(&input)
            .map_err(|_| "Invalid Room browser input")?
            .len()
            > 65536
    {
        return Err("Invalid Room browser request".into());
    }
    let owner = crate::control::receipts::capture(&window)?;
    let check = || -> Result<(), String> {
        let (label, current) =
            crate::control::validate_assistant_source(&app, &thread_id, &environment_id)?;
        if label != window.label() || !Arc::ptr_eq(&owner, &current) || !owner.is_live() {
            return Err("Room browser window changed".into());
        }
        Ok(())
    };
    check()?;
    let _permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let snapshot = crate::control::privacy_scope_admission_pinned(&app, &window, &owner)?;
    crate::privacy_projection::scope_projection_metadata(&app, &owner, &snapshot)?;
    if !snapshot["visibleProjects"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["cwd"].as_str() == Some(project_cwd.as_str()))
    }) {
        return Err("Room browser project is unavailable or private".into());
    }
    check()?;
    let channel = crate::remote::NativeServiceChannel::connect(&app)?;
    if channel.environment_id() != environment_id || !channel.is_current() {
        return Err("Room browser Host changed".into());
    }
    let request_id = request_id(&action, &input)?;
    let result = channel.project("assistant.browser.panel", json!({"environmentId":environment_id,"projectId":project_id,"threadId":thread_id,"projectCwd":project_cwd,"action":action,"input":input,"requestId":request_id}), |value| Ok(value.clone()))?;
    check()?;
    if !channel.is_current() {
        return Err("Room browser Host changed".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{action_allowed, request_id};
    use serde_json::json;
    #[test]
    fn browser_panel_allows_only_finite_room_actions() {
        assert!(action_allowed("browser.status"));
        assert!(action_allowed("browser.input"));
        assert!(action_allowed("browser.operation.status"));
        assert!(!action_allowed("browser.setup"));
        assert!(!action_allowed("browser.evaluate"));
        assert!(!action_allowed("browser.download"));
        assert_eq!(
            request_id("browser.input", &json!({"requestId":"original"})).unwrap(),
            "original"
        );
        assert!(request_id("browser.input", &json!({})).is_err());
        assert_ne!(
            request_id("browser.status", &json!({})).unwrap(),
            request_id("browser.status", &json!({})).unwrap()
        );
    }
}
