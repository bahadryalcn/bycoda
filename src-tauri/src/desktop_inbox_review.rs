//! A paired review is approved by its native owner window, never by a renderer flag.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};

fn now_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .map_err(|_| "Clock unavailable".into())
}
fn valid_deadline(deadline: u64, now: u64) -> Result<(), String> {
    if deadline <= now || deadline - now > 120_000 {
        return Err(
            "The review approval deadline is missing or expired; no review was submitted".into(),
        );
    }
    Ok(())
}
fn review_operation(
    operation: &Value,
) -> Result<(String, String, i64, crate::github_review::ReviewInput), String> {
    let row = operation
        .as_object()
        .ok_or("Invalid desktop review operation")?;
    if row.keys().any(|key| {
        ![
            "action", "cwd", "item", "commitId", "event", "body", "comments",
        ]
        .contains(&key.as_str())
    }) || operation["action"] != "review"
    {
        return Err("Only an exact pull request review can use native review approval".into());
    }
    let item = operation["item"]
        .as_object()
        .ok_or("Invalid review target")?;
    if item.keys().any(|key| {
        ![
            "provider",
            "kind",
            "repo",
            "number",
            "projectPath",
            "id",
            "identifier",
        ]
        .contains(&key.as_str())
    }) || operation["item"]["provider"] != "github"
        || operation["item"]["kind"] != "pr"
    {
        return Err("Invalid review provider or target".into());
    }
    let cwd = operation["cwd"]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 16_384 && !value.contains('\0'))
        .ok_or("Review project directory required")?
        .to_owned();
    if operation["item"]["projectPath"].as_str() != Some(cwd.as_str()) {
        return Err("Review project identity changed".into());
    }
    let repo = operation["item"]["repo"]
        .as_str()
        .ok_or("Review repository required")?
        .to_owned();
    let number = operation["item"]["number"]
        .as_i64()
        .ok_or("Review number required")?;
    crate::github_review::pull_endpoint(&repo, number)?;
    let review = serde_json::from_value(json!({ "commitId": operation["commitId"], "event": operation["event"], "body": operation["body"], "comments": operation["comments"] }))
        .map_err(|_| "Invalid review content")?;
    crate::github_review::ReviewInput::approval_content(operation)?;
    Ok((cwd, repo, number, review))
}

/// One-shot grants left by an owner-approved conversation review, keyed by its exact content.
fn review_grants() -> &'static Mutex<Vec<(String, u64)>> {
    static GRANTS: Mutex<Vec<(String, u64)>> = Mutex::new(Vec::new());
    &GRANTS
}
const REVIEW_GRANT_MS: u64 = 120_000;

fn review_grant_key(operation: &Value) -> Result<String, String> {
    let item = &operation["item"];
    Ok(format!(
        "{}\n{}\n{}\n{}",
        operation["cwd"]
            .as_str()
            .ok_or("Review project directory required")?,
        item["repo"].as_str().ok_or("Review repository required")?,
        item["number"].as_i64().ok_or("Review number required")?,
        crate::github_review::ReviewInput::approval_content(operation)?
    ))
}

/// Records that the owner approved this exact review in the conversation approval.
pub(crate) fn grant_approved_review(operation: &Value, now: u64) -> Result<(), String> {
    let key = review_grant_key(operation)?;
    let mut grants = review_grants()
        .lock()
        .map_err(|_| "Review approval unavailable")?;
    grants.retain(|(_, expires)| *expires > now);
    if grants.len() >= 16 {
        grants.remove(0);
    }
    grants.push((key, now + REVIEW_GRANT_MS));
    Ok(())
}

/// Consumes a matching unexpired grant; a different, reused or late review asks again.
fn take_review_grant(operation: &Value, now: u64) -> bool {
    let Ok(key) = review_grant_key(operation) else {
        return false;
    };
    let Ok(mut grants) = review_grants().lock() else {
        return false;
    };
    grants.retain(|(_, expires)| *expires > now);
    match grants.iter().position(|(granted, _)| *granted == key) {
        Some(index) => {
            grants.remove(index);
            true
        }
        None => false,
    }
}

fn approved_review_with<T>(
    operation: &Value,
    deadline: u64,
    now: impl Fn() -> Result<u64, String>,
    window_alive: impl Fn() -> bool,
    approve: impl FnOnce(&str) -> bool,
    submit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    valid_deadline(deadline, now()?)?;
    if !window_alive() {
        return Err("The native review window closed".into());
    }
    let (cwd, _, _, _) = review_operation(operation)?;
    let message = crate::conversation_tools_bridge::inbox_approval_message(operation, &cwd)?;
    if !approve(&message) {
        return Err("Native owner declined the review; no review was submitted".into());
    }
    valid_deadline(deadline, now()?)?;
    if !window_alive() {
        return Err("The native review window closed; no review was submitted".into());
    }
    submit()
}

#[tauri::command]
pub async fn desktop_inbox_review(
    app: AppHandle,
    window: WebviewWindow,
    operation: Value,
    deadline: u64,
) -> Result<String, String> {
    // The operation and original host lease are captured once. There is no
    // caller-supplied approved boolean, window label or arbitrary native command.
    tauri::async_runtime::spawn_blocking(move || {
        static DIALOG_GATE: Mutex<()> = Mutex::new(());
        let _gate = DIALOG_GATE.lock().map_err(|_| "Native review approval unavailable")?;
        let (cwd, repo, number, review) = review_operation(&operation)?;
        let root = crate::fs::expand_home(&cwd).canonicalize().map_err(|_| "Review project directory unavailable")?;
        if !root.is_dir() { return Err("Invalid review project directory".into()); }
        let alive = || app.get_webview_window(window.label()).is_some() && window.is_visible().is_ok();
        approved_review_with(&operation, deadline, now_ms, alive,
            |message| now_ms().is_ok_and(|now| take_review_grant(&operation, now)) || crate::control::owner_approval::ask_window_checked(&app, &window, crate::control::owner_approval::Prompt { title: "bycoda — Inbox operation approval", message, confirm: "Approve this operation", cancel: "Cancel" }, || { valid_deadline(deadline, now_ms()?)?; if !alive() { return Err("Review window closed".into()); } Ok(()) }),
            || crate::github_review::execute_review_guarded(&cwd, &repo, number, &review, || {
                valid_deadline(deadline, now_ms()?)?;
                if !alive() || crate::fs::expand_home(&cwd).canonicalize().ok().as_ref() != Some(&root) {
                    return Err("The native review window or project changed; no further request was submitted".into());
                }
                Ok(())
            }))
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn operation() -> Value {
        json!({"action":"review","cwd":"/project","item":{"provider":"github","kind":"pr","repo":"owner/repo","number":7,"projectPath":"/project"},"commitId":"a".repeat(40),"event":"COMMENT","body":"Exact owner text","comments":[]})
    }
    #[test]
    fn native_approval_binds_exact_content_and_writes_once() {
        let writes = Cell::new(0);
        let result = approved_review_with(
            &operation(),
            121_000,
            || Ok(1000),
            || true,
            |message| {
                assert!(message.contains("Exact owner text"));
                assert!(message.contains(&"a".repeat(40)));
                true
            },
            || {
                writes.set(writes.get() + 1);
                Ok("review-url")
            },
        )
        .unwrap();
        assert_eq!(result, "review-url");
        assert_eq!(writes.get(), 1);
    }
    #[test]
    fn expired_closed_declined_or_forged_requests_never_write() {
        let writes = Cell::new(0);
        for deadline in [999, 121_001] {
            assert!(approved_review_with(
                &operation(),
                deadline,
                || Ok(1000),
                || true,
                |_| panic!("expired dialog"),
                || {
                    writes.set(1);
                    Ok(())
                }
            )
            .is_err());
        }
        assert!(approved_review_with(
            &operation(),
            2000,
            || Ok(1000),
            || true,
            |_| false,
            || {
                writes.set(1);
                Ok(())
            }
        )
        .is_err());
        assert!(approved_review_with(
            &operation(),
            2000,
            || Ok(1000),
            || false,
            |_| panic!("closed dialog"),
            || {
                writes.set(1);
                Ok(())
            }
        )
        .is_err());
        let clock = Cell::new(0);
        assert!(approved_review_with(
            &operation(),
            2000,
            || {
                let now = if clock.replace(1) == 0 { 1000 } else { 2001 };
                Ok(now)
            },
            || true,
            |_| true,
            || {
                writes.set(1);
                Ok(())
            }
        )
        .is_err());
        let mut forged = operation();
        forged["approved"] = json!(true);
        assert!(approved_review_with(
            &forged,
            2000,
            || Ok(1000),
            || true,
            |_| panic!("forged dialog"),
            || {
                writes.set(1);
                Ok(())
            }
        )
        .is_err());
        assert_eq!(writes.get(), 0);
    }
}

#[cfg(test)]
mod grant_tests {
    use super::*;
    #[test]
    fn a_conversation_approval_skips_the_second_prompt_once_for_the_same_review() {
        let review = json!({"action":"review","cwd":"/grant","item":{"provider":"github","kind":"pr","repo":"owner/repo","number":9,"projectPath":"/grant"},"commitId":"b".repeat(40),"event":"COMMENT","body":"Granted text","comments":[]});
        let mut other = review.clone();
        other["body"] = json!("Changed text");
        grant_approved_review(&review, 1000).unwrap();
        assert!(!take_review_grant(&other, 1001));
        assert!(!take_review_grant(&review, 1000 + REVIEW_GRANT_MS));
        grant_approved_review(&review, 1000).unwrap();
        assert!(take_review_grant(&review, 1001));
        assert!(!take_review_grant(&review, 1002));
    }
}
