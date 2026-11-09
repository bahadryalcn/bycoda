//! Application-owned consent: native retains the request, source window and deadline.
use super::*;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Largest owner-typed secret accepted from the webview (bytes, UTF-8).
pub(crate) const MAX_SECRET_BYTES: usize = 8192;

pub(crate) struct Prompt<'a> {
    pub title: &'a str,
    pub message: &'a str,
    pub confirm: &'a str,
    pub cancel: &'a str,
}

/// What the webview shows: a yes/no approval, or a masked input whose reply is the owner's text.
#[derive(Clone, Copy)]
pub(crate) enum ApprovalChannel<'a> {
    Approval,
    Secret { field: &'a str },
}

pub(crate) fn ask_window(app: &AppHandle, window: &WebviewWindow, prompt: Prompt<'_>) -> bool {
    ask(app, window, None, prompt, || Ok(())).unwrap_or(false)
}
pub(crate) fn ask_window_checked(
    app: &AppHandle,
    window: &WebviewWindow,
    prompt: Prompt<'_>,
    check: impl Fn() -> Result<(), String>,
) -> bool {
    ask(app, window, None, prompt, check).unwrap_or(false)
}

pub(crate) fn ask_focused(app: &AppHandle, prompt: Prompt<'_>) -> bool {
    ask_focused_result(app, prompt).unwrap_or(false)
}
pub(crate) fn ask_focused_result(app: &AppHandle, prompt: Prompt<'_>) -> Result<bool, String> {
    let windows = crate::window::workspace_windows(app);
    let focused = windows.iter().find(|w| w.is_focused().unwrap_or(false));
    let window = focused.or_else(|| (windows.len() == 1).then(|| &windows[0]));
    ask(
        app,
        window.ok_or("Approval source window unavailable")?,
        None,
        prompt,
        || Ok(()),
    )
}

pub(crate) fn ask_conversation(
    app: &AppHandle,
    request: &Value,
    prompt: Prompt<'_>,
    check: impl Fn() -> Result<(), String>,
) -> Result<bool, String> {
    ask_conversation_detailed(app, request, prompt, Value::Null, check)
}

/// Like `ask_conversation`, plus a structured preview of the same content the message states.
pub(crate) fn ask_conversation_detailed(
    app: &AppHandle,
    request: &Value,
    prompt: Prompt<'_>,
    details: Value,
    check: impl Fn() -> Result<(), String>,
) -> Result<bool, String> {
    ask_conversation_as(
        app,
        request,
        ApprovalChannel::Approval,
        prompt,
        details,
        check,
        decision,
    )
}

/// Owner-typed secret for the conversation's source window. `None` means cancelled or expired.
pub(crate) fn ask_conversation_secret(
    app: &AppHandle,
    request: &Value,
    prompt: Prompt<'_>,
    field: &str,
    check: impl Fn() -> Result<(), String>,
) -> Result<Option<String>, String> {
    ask_conversation_as(
        app,
        request,
        ApprovalChannel::Secret { field },
        prompt,
        Value::Null,
        check,
        secret_decision,
    )
}

fn ask_conversation_as<T>(
    app: &AppHandle,
    request: &Value,
    channel: ApprovalChannel<'_>,
    prompt: Prompt<'_>,
    details: Value,
    check: impl Fn() -> Result<(), String>,
    decode: impl Fn(&Value) -> Result<T, String>,
) -> Result<T, String> {
    check()?;
    let environment = request["environmentId"]
        .as_str()
        .ok_or("Approval Host required")?;
    let session = request["sessionId"].as_str();
    let resolve = || -> Result<String, String> {
        if let Some(session) = session {
            let cwd = request["cwd"].as_str().ok_or("Approval project required")?;
            let state = app.state::<ControlHost>();
            let host = state
                .inner
                .lock()
                .map_err(|_| "Control service unavailable")?;
            conversation_ui_window(&host, session, cwd, environment)
        } else {
            let thread = request["threadId"]
                .as_str()
                .ok_or("Approval source required")?;
            validate_assistant_source(app, thread, environment).map(|(window, _)| window)
        }
    };
    let label = resolve()?;
    let window = app
        .get_webview_window(&label)
        .ok_or("Approval window unavailable")?;
    ask_as(
        app,
        &window,
        session,
        channel,
        prompt,
        details,
        || {
            check()?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_millis() as u64;
            if request["deadline"]
                .as_u64()
                .is_none_or(|deadline| deadline <= now)
                || resolve()? != label
            {
                return Err("Approval source expired or changed".into());
            }
            Ok(())
        },
        decode,
    )
}

fn ask(
    app: &AppHandle,
    window: &WebviewWindow,
    session: Option<&str>,
    prompt: Prompt<'_>,
    check: impl Fn() -> Result<(), String>,
) -> Result<bool, String> {
    ask_as(
        app,
        window,
        session,
        ApprovalChannel::Approval,
        prompt,
        Value::Null,
        check,
        decision,
    )
}

fn ask_as<T>(
    app: &AppHandle,
    window: &WebviewWindow,
    session: Option<&str>,
    channel: ApprovalChannel<'_>,
    prompt: Prompt<'_>,
    details: Value,
    check: impl Fn() -> Result<(), String>,
    decode: impl Fn(&Value) -> Result<T, String>,
) -> Result<T, String> {
    let issuer = receipts::capture(window)?;
    let state = app.state::<ControlHost>();
    let id = uuid::Uuid::new_v4().to_string();
    let (reply, receive) = mpsc::channel();
    check()?;
    issuer.with_live(|| {
        let mut host = state
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        if host.pending.len() >= 24 {
            return Err("Too many pending approvals".into());
        }
        host.pending.insert(
            id.clone(),
            Pending {
                window: window.label().to_owned(),
                reply,
                authority: None,
                assistant_source: None,
                window_issuer: Some(issuer.clone()),
                effect_started: false,
            },
        );
        Ok(())
    })?;
    let (namespace, action) = match channel {
        ApprovalChannel::Approval => ("owner-approval", "owner.approval"),
        ApprovalChannel::Secret { .. } => ("owner-secret", "owner.secret"),
    };
    let result = (|| {
        let deadline = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64
            + 240_000;
        let mut input = json!({"title":prompt.title,"message":prompt.message,"confirmLabel":prompt.confirm,"cancelLabel":prompt.cancel,"deadline":deadline});
        if !details.is_null() {
            input["details"] = details;
        }
        if let ApprovalChannel::Secret { field } = channel {
            input["fieldLabel"] = json!(field);
        }
        let event = json!({
            "id":id, "namespace":namespace, "action":action, "sessionId":session, "input":input,
        });
        let last_offer = std::cell::Cell::new(Instant::now() - Duration::from_secs(2));
        wait_for_decision(
            &receive,
            || {
                check()?;
                let current = receipts::capture(window)?;
                if !pending_window_issuer_matches(Some(&issuer), &current) {
                    return Err("Approval window changed".into());
                }
                if last_offer.get().elapsed() >= Duration::from_secs(1) {
                    app.emit_to(window.label(), "bycoda-control-request", &event)
                        .map_err(|_| "Approval window unavailable")?;
                    last_offer.set(Instant::now());
                }
                Ok(())
            },
            Duration::from_secs(240),
            &decode,
        )
    })();
    if let Ok(mut host) = state.inner.lock() {
        host.pending.remove(&id);
    }
    let _ = app.emit_to(window.label(), "bycoda-control-request", json!({"id":id,"namespace":format!("{namespace}-ended"),"action":format!("{action}.ended"),"input":{}}));
    result
}

fn wait_for_decision<T>(
    receive: &mpsc::Receiver<Value>,
    check: impl Fn() -> Result<(), String>,
    timeout: Duration,
    decode: impl Fn(&Value) -> Result<T, String>,
) -> Result<T, String> {
    let start = Instant::now();
    loop {
        check()?;
        if start.elapsed() >= timeout {
            return Err("Approval expired".into());
        }
        match receive
            .recv_timeout(Duration::from_millis(100).min(timeout.saturating_sub(start.elapsed())))
        {
            Ok(value) => {
                check()?;
                if start.elapsed() >= timeout {
                    return Err("Approval expired".into());
                }
                return decode(&value);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return Err("Approval window closed".into()),
        }
    }
}

/// The exact `{ok: true, result}` envelope written by `control_reply`.
fn envelope(value: &Value) -> Result<&Value, String> {
    value
        .as_object()
        .filter(|object| object.len() == 2 && value["ok"] == true)
        .and_then(|object| object.get("result"))
        .ok_or_else(|| "Approval unavailable".to_string())
}

fn decision(value: &Value) -> Result<bool, String> {
    envelope(value)?
        .as_bool()
        .ok_or_else(|| "Invalid approval decision".to_string())
}

/// `null` is the only cancellation; any non-string or oversized reply is refused.
fn secret_decision(value: &Value) -> Result<Option<String>, String> {
    match envelope(value)? {
        Value::Null => Ok(None),
        Value::String(text) if !text.is_empty() && text.len() <= MAX_SECRET_BYTES => {
            Ok(Some(text.clone()))
        }
        _ => Err("Invalid secret input".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_decisions_only_and_revocation_wins_over_a_queued_yes() {
        assert_eq!(decision(&json!({"ok":true,"result":true})), Ok(true));
        assert_eq!(decision(&json!({"ok":true,"result":false})), Ok(false));
        for value in [
            json!({"ok":true,"result":"true"}),
            json!({"ok":true,"result":true,"extra":true}),
            json!({"ok":false,"result":true}),
        ] {
            assert!(decision(&value).is_err());
        }
        let (send, receive) = mpsc::channel();
        send.send(json!({"ok":true,"result":true})).unwrap();
        assert!(wait_for_decision(
            &receive,
            || Err("revoked".into()),
            Duration::from_secs(1),
            decision
        )
        .is_err());
        assert!(wait_for_decision(&receive, || Ok(()), Duration::ZERO, decision).is_err());
        let checks = std::cell::Cell::new(0);
        assert!(wait_for_decision(
            &receive,
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 2 {
                    Err("source retired before decision".into())
                } else {
                    Ok(())
                }
            },
            Duration::from_secs(1),
            decision,
        )
        .is_err());
    }

    #[test]
    fn secret_replies_are_exact_strings_or_null_cancellation() {
        assert_eq!(secret_decision(&json!({"ok":true,"result":null})), Ok(None));
        assert_eq!(
            secret_decision(&json!({"ok":true,"result":"token-value"})),
            Ok(Some("token-value".to_string()))
        );
        let oversized = "x".repeat(MAX_SECRET_BYTES + 1);
        for value in [
            json!({"ok":true}),
            json!({"ok":true,"result":""}),
            json!({"ok":true,"result":true}),
            json!({"ok":true,"result":{"value":"x"}}),
            json!({"ok":true,"result":oversized}),
            json!({"ok":true,"result":"x","extra":1}),
            json!({"ok":false,"result":"x"}),
        ] {
            let error = secret_decision(&value).expect_err("malformed secret reply");
            assert!(!error.contains('x'));
        }
    }
}
