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

/// Structured preview of an operation `inbox_approval_message` already validated; the text stays the record.
fn inbox_approval_details(operation: &Value, cwd: &str, thread: &str) -> Result<Value, String> {
    let item = &operation["item"];
    let key = item["identifier"]
        .as_str()
        .or_else(|| item["id"].as_str())
        .unwrap_or("");
    let target = format!(
        "{} #{} {key}",
        item["repo"].as_str().unwrap_or(""),
        item["number"]
            .as_u64()
            .ok_or("Inbox item number required")?
    );
    let mut details = json!({
        "kind": "inbox",
        "action": operation["action"],
        "project": cwd,
        "provider": item["provider"],
        "target": target.trim(),
        "replyTo": operation["inReplyTo"].as_str().filter(|id| !id.is_empty()),
        "thread": (!thread.is_empty()).then_some(thread),
    });
    match operation["action"].as_str() {
        Some("review") => {
            details["review"] = crate::github_review::ReviewInput::approval_details(operation)?
        }
        Some("comment") => details["body"] = operation["body"].clone(),
        Some("jira-comment-images") => {
            details["action"] = json!("comment");
            details["body"] = operation["body"].clone();
        }
        _ => {
            details["prAction"] = operation["prAction"].clone();
            details["headSha"] = operation["expectedHeadOid"].clone();
        }
    }
    Ok(details)
}

/// Agent-supplied MCP call text is bounded and control-free before the owner sees it.
fn mcp_call_approval_message(request: &Value) -> Result<String, String> {
    let input = &request["input"];
    let text = |key: &str, max: usize| -> Result<String, String> {
        let value = input[key].as_str().ok_or("MCP call details required")?;
        if value.trim().is_empty()
            || value.chars().count() > max
            || value.chars().any(char::is_control)
        {
            return Err("Invalid MCP call details".into());
        }
        Ok(escape_approval_direction(value))
    };
    Ok(format!(
        "Project: {}\nServer: {}\nTool: {}\nArguments: {}\n\nThis MCP tool may change data outside bycoda. Approving allows this tool for the rest of this conversation.",
        escape_approval_direction(
            request["cwd"]
                .as_str()
                .ok_or("Project directory required")?
        ),
        text("server", 100)?,
        text("tool", 200)?,
        text("arguments", 2000)?,
    ))
}

/// Whether a Full access coding session admits this request without a prompt. The Host answers
/// from its own session record and the owner's exclusions, never from tool input; any other
/// reply, an older Host's included, keeps the prompt.
fn session_full_access(
    request: &Value,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
    action: &str,
) -> Result<bool, String> {
    let admitted = issuer.project(
        "conversation.desktop.authorize",
        json!({"id": request["id"], "action": format!("{action}.permission")}),
        |reply| Ok(session_full_access_reply(reply)),
    )?;
    if admitted {
        log::info!("{action} admitted by the session's Full access mode");
    }
    Ok(admitted)
}

fn session_full_access_reply(reply: &Value) -> bool {
    reply.as_object().is_some_and(|reply| {
        reply.len() == 2
            && reply.get("authorized") == Some(&Value::Bool(true))
            && reply.get("fullAccess") == Some(&Value::Bool(true))
    })
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
                    confirm: approval.confirm,
                    cancel: "Cancel",
                },
                || taken.check(),
            )
            .unwrap_or(false)
        });
    }
    if action == "management.write.authorize" {
        let (message, operation_hash) = management_approval_message(request)?;
        let details = management_approval_details(request)?;
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
        let standing = crate::assistant_standing_consent::decision(app, request, issuer)?;
        check()?;
        let approved = match standing {
            Some(approved) => approved,
            None => crate::control::owner_approval::ask_conversation_detailed(
                app,
                request,
                crate::control::owner_approval::Prompt {
                    title: "bycoda — Application operation approval",
                    message: &(message),
                    confirm: "Approve this exact operation",
                    cancel: "Cancel",
                },
                details,
                || taken.check(),
            )?,
        };
        check()?;
        let current_standing = crate::assistant_standing_consent::decision(app, request, issuer)?;
        if (approved && current_standing == Some(false))
            || (standing.is_some() && current_standing != standing)
        {
            return Err("Native assistant consent changed".into());
        }
        // The Host receipt records who admitted the operation.
        return Ok(if approved && standing == Some(true) {
            json!({ "approved": true, "operationHash": operation_hash, "approvedBy": "standingConsent" })
        } else {
            json!({ "approved": approved, "operationHash": operation_hash })
        });
    }
    if action == "mcp.call.authorize" {
        let message = mcp_call_approval_message(request)?;
        let check = || -> Result<(), String> {
            taken.check()?;
            if !issuer.is_current() {
                return Err("MCP approval issuer changed".into());
            }
            let at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_millis() as u64;
            if request["deadline"]
                .as_u64()
                .is_none_or(|deadline| deadline <= at)
            {
                return Err("MCP approval expired; the tool was not called".into());
            }
            let allowed = issuer.project(
                "conversation.desktop.authorize",
                json!({"id": request["id"], "action": action}),
                |result| Ok(result["authorized"] == true),
            )?;
            if !allowed {
                return Err("MCP approval authority revoked".into());
            }
            taken.check()
        };
        check()?;
        let approved = crate::control::owner_approval::ask_conversation(
            app,
            request,
            crate::control::owner_approval::Prompt {
                title: "bycoda — MCP tool approval",
                message: &message,
                confirm: "Approve this tool",
                cancel: "Cancel",
            },
            || taken.check(),
        )?;
        check()?;
        return Ok(json!({ "approved": approved }));
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
        let last_check = std::cell::Cell::new(std::time::Instant::now());
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
            || {
                taken.check()?;
                // The phone can settle the relay while this native prompt is open.
                if last_check.get().elapsed() >= std::time::Duration::from_secs(1) {
                    check()?;
                    last_check.set(std::time::Instant::now());
                }
                Ok(())
            },
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
        let approved = session_full_access(request, issuer, action)?
            || crate::control::owner_approval::ask_conversation(
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
    if action == "inbox.write.authorize"
        && matches!(
            input["operation"]["action"].as_str(),
            Some("jira-board-transition" | "jira-board-move")
        )
    {
        // The desktop board step reviews these changes itself. A Full access coding session
        // gets a one-use permit for this exact change instead; nothing else is approved here.
        if input["operation"]["cwd"].as_str() != request["cwd"].as_str()
            || !session_full_access(request, issuer, action)?
        {
            return Ok(json!({"approved": false}));
        }
        let permit = crate::jira::board::mobile_board::issue_session_permit(&input["operation"])?;
        return Ok(json!({"approved": true, "permit": permit}));
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
        let details = inbox_approval_details(
            &input["operation"],
            request["cwd"].as_str().unwrap_or_default(),
            thread_context.trim(),
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
        let issue_permit = (input["operation"]["action"] == "jira-comment-images")
            .then(|| crate::jira::agent_comment::authorize(app, &input["operation"]))
            .transpose()?;
        let approved = session_full_access(request, issuer, action)?
            || crate::control::owner_approval::ask_conversation_detailed(
                app,
                request,
                crate::control::owner_approval::Prompt {
                    title: "bycoda — Inbox operation approval",
                    message: &(format!("{message}{thread_context}")),
                    confirm: "Approve this operation",
                    cancel: "Cancel",
                },
                details,
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
        if approved {
            if let Some(issue_permit) = issue_permit {
                return Ok(json!({ "approved": true, "permit": issue_permit()? }));
            }
        }
        if approved && input["operation"]["action"] == "review" {
            // The desktop submit step consumes this instead of asking the owner a second time.
            crate::desktop_inbox_review::grant_approved_review(&input["operation"], at)?;
        }
        return Ok(json!({"approved": approved}));
    }
    Err("Unsupported approval action".into())
}

#[cfg(test)]
mod secret_tests {
    use super::*;

    #[test]
    fn only_an_exact_host_reply_skips_a_session_prompt() {
        assert!(session_full_access_reply(
            &json!({"authorized":true,"fullAccess":true})
        ));
        for reply in [
            json!({"authorized":true}),
            json!({"authorized":false}),
            json!({"authorized":true,"fullAccess":false}),
            json!({"authorized":true,"fullAccess":"true"}),
            json!({"authorized":false,"fullAccess":true}),
            json!({"authorized":true,"fullAccess":true,"extra":true}),
            json!(true),
        ] {
            assert!(!session_full_access_reply(&reply), "{reply}");
        }
    }

    #[test]
    fn room_task_and_crew_controls_can_reach_exact_native_review() {
        for action in [
            "sessions.message",
            "sessions.cancel",
            "crews.member.ask",
            "crews.answer",
            "tasks.delete",
            "tasks.transfer",
            "tasks.queue.pause",
            "tasks.review.recheck",
            "tasks.reorder",
        ] {
            let request = json!({"threadId":"room", "environmentId":"host", "input":{"operation":{"action":action,"input":{},"operationHash":"a".repeat(64)}}});
            assert!(management_approval_message(&request).is_ok(), "{action}");
        }
    }

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

#[cfg(test)]
mod inbox_preview_tests {
    use super::*;

    #[test]
    fn review_preview_carries_the_validated_review_and_comments() {
        let operation = json!({
            "action": "review", "cwd": "/repo",
            "item": {"provider": "github", "kind": "pr", "repo": "acme/app", "number": 12},
            "commitId": "a".repeat(40), "event": "COMMENT", "body": "Summary",
            "comments": [{"path": "src/a.ts", "line": 9, "side": "RIGHT", "body": "Nit"}],
        });
        let details = inbox_approval_details(&operation, "/repo", "").unwrap();
        assert_eq!(details["target"], "acme/app #12");
        assert_eq!(details["thread"], Value::Null);
        assert_eq!(details["review"]["comments"][0]["path"], "src/a.ts");
        assert_eq!(details["review"]["comments"][0]["startLine"], Value::Null);
        let mut invalid = operation.clone();
        invalid["comments"][0]["line"] = json!(0);
        assert!(inbox_approval_details(&invalid, "/repo", "").is_err());
    }
}

#[cfg(test)]
mod mcp_approval_tests {
    use super::*;

    fn request(input: Value) -> Value {
        json!({"cwd": "/repo", "input": input})
    }

    #[test]
    fn mcp_message_names_server_tool_and_arguments() {
        let message = mcp_call_approval_message(&request(
            json!({"server": "fs", "tool": "write", "arguments": "{\"path\":\"a\"}"}),
        ))
        .unwrap();
        assert!(message.contains("Server: fs"));
        assert!(message.contains("Tool: write"));
        assert!(message.contains("Arguments: {\"path\":\"a\"}"));
    }

    #[test]
    fn mcp_fields_are_bounded_control_free_and_direction_escaped() {
        let valid = json!({"server": "fs", "tool": "write", "arguments": "{}"});
        for (key, value) in [
            ("server", json!("")),
            ("server", json!("a".repeat(101))),
            ("tool", json!("a\nb")),
            ("tool", json!("a".repeat(201))),
            ("arguments", json!("x".repeat(2001))),
            ("arguments", json!(5)),
        ] {
            let mut input = valid.clone();
            input[key] = value;
            assert!(mcp_call_approval_message(&request(input)).is_err(), "{key}");
        }
        let mut input = valid.clone();
        input["tool"] = json!("a\u{202e}b");
        let message = mcp_call_approval_message(&request(input)).unwrap();
        assert!(!message.contains('\u{202e}'));
        let mut missing = valid;
        missing.as_object_mut().unwrap().remove("arguments");
        assert!(mcp_call_approval_message(&request(missing)).is_err());
        assert!(mcp_call_approval_message(&json!({"input": {}})).is_err());
    }
}
