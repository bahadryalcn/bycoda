use super::*;

/// Agent-supplied secret request text is bounded and control-free before the owner sees it.
fn secret_input_fields(input: &Value) -> Result<(String, String), String> {
    let text = |key: &str, max: usize| -> Result<String, String> {
        let value = input[key].as_str().ok_or("Secret request required")?;
        if value.trim().is_empty()
            || value.chars().count() > max
            || value.chars().any(char::is_control)
        {
            return Err("Invalid secret request".into());
        }
        Ok(value.to_owned())
    };
    Ok((text("name", 80)?, text("purpose", 300)?))
}

pub(super) fn call(
    app: &AppHandle,
    request: &Value,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
    taken: &crate::remote::NativeServiceReply,
    now: u64,
) -> Result<Value, String> {
    let action = request["action"]
        .as_str()
        .ok_or("Approval action required")?;
    let input = &request["input"];
    if action == "desktop.act.authorize" {
        let approval = desktop_action_approval(request, now)?;
        static DESKTOP_APPROVAL_GATE: Mutex<()> = Mutex::new(());
        let _gate = DESKTOP_APPROVAL_GATE
            .lock()
            .map_err(|_| "Desktop approval is unavailable")?;
        let check = || -> Result<(), String> {
            taken.check()?;
            if !issuer.is_current() {
                return Err("Desktop approval issuer changed".into());
            }
            let at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_millis() as u64;
            if approval.deadline <= at {
                return Err("Desktop approval expired; no action was authorized".into());
            }
            let authorized = issuer.project(
                "conversation.desktop.authorize",
                json!({"id": approval.relay_id, "action": "desktop.act.authorize"}),
                |result| {
                    Ok(result.as_object().is_some_and(|value| {
                        value.len() == 1 && value.get("authorized") == Some(&Value::Bool(true))
                    }))
                },
            )?;
            if !authorized {
                return Err("The original desktop action authority was revoked".into());
            }
            taken.check()?;
            Ok(())
        };
        return desktop_approval_decision(&approval, check, || {
            crate::control::owner_approval::ask_conversation(
                app,
                request,
                crate::control::owner_approval::Prompt {
                    title: "bycoda — Desktop action approval",
                    message: &approval.message,
                    confirm: "Approve this exact action",
                    cancel: "Cancel",
                },
                || taken.check(),
            )
            .unwrap_or(false)
        });
    }
    if action == "management.write.authorize" {
        let (message, operation_hash) = management_approval_message(request)?;
        let check = || -> Result<(), String> {
            taken.check()?;
            if !issuer.is_current() {
                return Err("Management approval issuer changed".into());
            }
            let at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_millis() as u64;
            if request["deadline"]
                .as_u64()
                .is_none_or(|deadline| deadline <= at)
            {
                return Err("Management approval expired".into());
            }
            let allowed = issuer.project(
                "conversation.desktop.authorize",
                json!({"id": request["id"], "action": action}),
                |result| Ok(result["authorized"] == true),
            )?;
            if !allowed {
                return Err("Management authority revoked".into());
            }
            taken.check()
        };
        check()?;
        let approved = crate::control::owner_approval::ask_conversation(
            app,
            request,
            crate::control::owner_approval::Prompt {
                title: "bycoda — Application operation approval",
                message: &(message),
                confirm: "Approve this exact operation",
                cancel: "Cancel",
            },
            || taken.check(),
        )?;
        check()?;
        return Ok(json!({ "approved": approved, "operationHash": operation_hash }));
    }
    if action == "secrets.input.authorize" {
        // The owner-typed value returns only as this relay reply; native neither stores nor logs it.
        let (name, purpose) = secret_input_fields(input)?;
        let message = format!(
            "Project: {}\nName: {}\nPurpose: {}",
            escape_approval_direction(
                request["cwd"]
                    .as_str()
                    .ok_or("Project directory required")?
            ),
            escape_approval_direction(&name),
            escape_approval_direction(&purpose),
        );
        let check = || -> Result<(), String> {
            taken.check()?;
            if !issuer.is_current() {
                return Err("Secret approval issuer changed".into());
            }
            let at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_millis() as u64;
            if request["deadline"]
                .as_u64()
                .is_none_or(|deadline| deadline <= at)
            {
                return Err("Secret request expired".into());
            }
            let allowed = issuer.project(
                "conversation.desktop.authorize",
                json!({"id": request["id"], "action": action}),
                |result| Ok(result["authorized"] == true),
            )?;
            if !allowed {
                return Err("Secret request authority revoked".into());
            }
            taken.check()
        };
        check()?;
        let value = crate::control::owner_approval::ask_conversation_secret(
            app,
            request,
            crate::control::owner_approval::Prompt {
                title: "bycoda — Secret request",
                message: &message,
                confirm: "Save secret",
                cancel: "Cancel",
            },
            &name,
            || taken.check(),
        )?;
        // A request revoked while the owner typed drops the value here instead of returning it.
        check()?;
        return Ok(match value {
            Some(value) => json!({ "value": value }),
            None => json!({ "cancelled": true }),
        });
    }
    if action == "tasks.write.authorize" {
        let operation = &input["operation"];
        let message = task_approval_message(operation)?;
        let approved = crate::control::owner_approval::ask_conversation(
            app,
            request,
            crate::control::owner_approval::Prompt {
                title: "bycoda — Task operation approval",
                message: &(message),
                confirm: "Approve this operation",
                cancel: "Cancel",
            },
            || taken.check(),
        )?;
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
        let approved = crate::control::owner_approval::ask_conversation(
            app,
            request,
            crate::control::owner_approval::Prompt {
                title: "bycoda — Inbox operation approval",
                message: &(format!("{message}{thread_context}")),
                confirm: "Approve this operation",
                cancel: "Cancel",
            },
            || taken.check(),
        )?;
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
    Err("Unsupported approval action".into())
}

#[cfg(test)]
mod secret_tests {
    use super::*;

    #[test]
    fn secret_request_fields_are_bounded_and_control_free() {
        assert!(secret_input_fields(&json!({"name":"NPM_TOKEN","purpose":"publish"})).is_ok());
        assert!(secret_input_fields(&json!({"name":"","purpose":"publish"})).is_err());
        assert!(secret_input_fields(&json!({"name":"a\nb","purpose":"publish"})).is_err());
        assert!(secret_input_fields(&json!({"name":"x".repeat(81),"purpose":"publish"})).is_err());
        assert!(secret_input_fields(&json!({"name":"A","purpose":"p".repeat(301)})).is_err());
        assert!(secret_input_fields(&json!({"purpose":"publish"})).is_err());
    }
}
