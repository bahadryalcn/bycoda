//! Local native authority. Host profiles are descriptive mirrors, never grants.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Window};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    pub revision: u64,
    pub environment_id: String,
    pub permission_level: String,
    pub project_ids: Vec<String>,
    pub critical_exclusions: Vec<String>,
    issuer: String,
    principal: String,
}

fn database(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db = Connection::open(dir.join("assistant-native-consent.sqlite3"))
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS assistant_consent(environment TEXT PRIMARY KEY, revision INTEGER NOT NULL, grant_json TEXT NOT NULL);").map_err(|e| e.to_string())?;
    Ok(db)
}
fn read(db: &Connection, environment: &str) -> Result<Option<Grant>, String> {
    let row: Option<(i64, String)> = db
        .query_row(
            "SELECT revision, grant_json FROM assistant_consent WHERE environment=?1",
            [environment],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(revision, raw)| {
        let revision =
            u64::try_from(revision).map_err(|_| "Native consent is corrupt".to_owned())?;
        let grant: Grant =
            serde_json::from_str(&raw).map_err(|_| "Native consent is corrupt".to_owned())?;
        if grant.environment_id != environment
            || grant.revision != revision
            || revision == 0
            || revision > 9_007_199_254_740_991
            || !valid_fields(
                &grant.permission_level,
                &grant.project_ids,
                &grant.critical_exclusions,
            )
            || grant.issuer.is_empty()
            || grant.principal.is_empty()
        {
            return Err("Native consent is corrupt".into());
        }
        Ok(grant)
    })
    .transpose()
}
fn valid_fields(level: &str, projects: &[String], exclusions: &[String]) -> bool {
    matches!(level, "watch" | "projects" | "everything")
        && projects.len() <= 100
        && projects.iter().all(|id| !id.is_empty() && id.len() <= 200)
        && exclusions.len() <= 6
        && exclusions.iter().all(|key| {
            [
                "pushMain",
                "deleteProject",
                "deleteSession",
                "sendMessages",
                "computerUse",
                "spend",
            ]
            .contains(&key.as_str())
        })
}
fn selection(
    app: &AppHandle,
    environment: &str,
) -> Result<Arc<crate::remote::NativeServiceChannel>, String> {
    let channel = crate::remote::NativeServiceChannel::connect(app)?;
    if channel.environment_id() != environment {
        return Err("Selected Host changed".into());
    }
    channel.check()?;
    Ok(channel)
}
#[tauri::command]
pub fn assistant_consent_get(
    app: AppHandle,
    window: Window,
    environment_id: String,
) -> Result<Option<Grant>, String> {
    crate::session_store::canonical_store::page(&window)?;
    let channel = selection(&app, &environment_id)?;
    let result = read(&database(&app)?, &environment_id)?;
    channel.check()?;
    Ok(result)
}
#[tauri::command]
pub fn assistant_consent_set(
    app: AppHandle,
    window: Window,
    environment_id: String,
    expected_revision: u64,
    permission_level: String,
    project_ids: Vec<String>,
    critical_exclusions: Vec<String>,
) -> Result<Grant, String> {
    let page = crate::session_store::canonical_store::page(&window)?;
    if !valid_fields(&permission_level, &project_ids, &critical_exclusions) {
        return Err("Invalid assistant consent".into());
    }
    let channel = selection(&app, &environment_id)?;
    let webview = app
        .get_webview_window(window.label())
        .ok_or("Workspace closed")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    let mut db = database(&app)?;
    let transaction = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let revision = read(&transaction, &environment_id)?.map_or(0, |grant| grant.revision);
    if revision != expected_revision || revision >= 9_007_199_254_740_991 {
        return Err("Native consent revision changed".into());
    }
    let grant = Grant {
        revision: revision + 1,
        environment_id,
        permission_level,
        project_ids,
        critical_exclusions,
        issuer: issuer.identity().to_owned(),
        principal: channel.consent_principal(),
    };
    if crate::session_store::canonical_store::page(&window)? != page {
        return Err("Workspace changed".into());
    }
    let stored_revision = i64::try_from(grant.revision)
        .map_err(|_| "Native consent revision exhausted".to_owned())?;
    issuer.with_live(|| channel.admit(|| {
        transaction.execute("INSERT INTO assistant_consent VALUES(?1,?2,?3) ON CONFLICT(environment) DO UPDATE SET revision=excluded.revision, grant_json=excluded.grant_json", params![grant.environment_id, stored_revision, serde_json::to_string(&grant).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
    }))?;
    Ok(grant)
}

/// Only registered Room threads qualify; coding sessions retain exact prompts.
pub(crate) fn decision(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<crate::remote::NativeServiceChannel>,
) -> Result<Option<bool>, String> {
    if request.get("sessionId").is_some() {
        return Ok(None);
    }
    let Some(thread) = request["threadId"].as_str() else {
        return Ok(None);
    };
    let (_, issuer) =
        crate::control::validate_assistant_source(app, thread, channel.environment_id())?;
    let Some(grant) = read(&database(app)?, channel.environment_id())? else {
        return Ok(None);
    };
    // The persisted grant belongs to this native profile, not a transient page.
    // Its issuance issuer remains audit data; every use still needs the current Room issuer.
    if grant.principal != channel.consent_principal() {
        return Ok(None);
    }
    issuer.ensure_live()?;
    channel.check()?;
    if classify(&grant, request) == Some(false) {
        return Ok(Some(false));
    }
    if request["input"]["requireOwnerApproval"] == true {
        return Ok(None);
    }
    Ok(classify(&grant, request))
}

fn classify(grant: &Grant, request: &Value) -> Option<bool> {
    if grant.permission_level == "watch" {
        return Some(false);
    }
    let operation = &request["input"]["operation"];
    let action = operation["action"].as_str()?;
    if grant.permission_level == "projects" {
        let Some(project) = request["projectId"].as_str() else {
            return Some(false);
        };
        if !grant.project_ids.iter().any(|id| id == project) {
            return Some(false);
        }
        if operation["input"]
            .get("projectId")
            .is_some_and(|target| target.as_str() != Some(project))
        {
            return Some(false);
        }
        if matches!(
            action,
            "notebook.create" | "notebook.update" | "notebook.delete"
        ) {
            return Some(false);
        }
    }
    // Arbitrary command/shell execution can conceal excluded effects. Keep exact prompts.
    if matches!(
        action,
        "commands.run" | "commands.dispatch" | "terminals.write" | "terminals.create"
    ) {
        return if grant.permission_level == "projects" {
            Some(false)
        } else {
            None
        };
    }
    let critical = match action {
        "social.send" | "workspace.sessions.submit" => Some("sendMessages"),
        "projects.delete" => Some("deleteProject"),
        "sessions.delete" => Some("deleteSession"),
        "desktop.act" => Some("computerUse"),
        "git.merge" => {
            let branch = operation["input"]["review"]["currentBranch"].as_str()?;
            if matches!(branch, "main" | "master" | "refs/heads/main" | "refs/heads/master") {
                Some("pushMain")
            } else {
                None
            }
        }
        "git.push" => {
            let branch = operation["input"]["review"]["targetRef"].as_str()?;
            if matches!(
                branch,
                "main" | "master" | "refs/heads/main" | "refs/heads/master"
            ) {
                Some("pushMain")
            } else {
                None
            }
        }
        _ => None,
    };
    if critical.is_some_and(|key| grant.critical_exclusions.iter().any(|item| item == key)) {
        return None;
    }
    // Explicit list: newly added actions never silently inherit standing consent.
    if ![
        "files.create",
        "files.write",
        "files.rename",
        "files.move",
        "files.copy",
        "files.delete",
        "notes.create",
        "notes.update",
        "notes.delete",
        "notebook.create",
        "notebook.update",
        "notebook.delete",
        "git.stage",
        "git.unstage",
        "git.commit",
        "git.pull",
        "git.stash",
        "git.merge",
        "git.push",
        "social.send",
        "workspace.sessions.submit",
        "workspace.sessions.create",
        "workspace.sessions.open",
        "workspace.sessions.stop",
        "tasks.create",
        "tasks.update",
        "tasks.start",
        "tasks.stop",
        "tasks.retry",
        "goals.create",
        "goals.update",
        "goals.replan",
        "goals.cancel",
        "goals.delete",
        "automations.create",
        "automations.update",
        "automations.pause",
        "automations.resume",
        "automations.delete",
        "automations.runNow",
        "automations.stopRun",
    ]
    .contains(&action)
    {
        return None;
    }
    Some(true)
}

/// Holds the private consent write lock through the exact Host callback. The caller
/// must invoke the callback on the authenticated Native channel and must bind it
/// to the relay request and currently registered global Room.
pub(crate) fn with_background_effect<T>(
    app: &AppHandle,
    channel: &Arc<crate::remote::NativeServiceChannel>,
    source_json: &str,
    operation_hash: &str,
    execute: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    use sha2::{Digest, Sha256};
    if source_json.len() > 32768 || format!("{:x}", Sha256::digest(source_json.as_bytes())) != operation_hash {
        return Err("Background effect digest changed".into());
    }
    let source: Value = serde_json::from_str(source_json).map_err(|_| "Invalid background effect")?;
    let thread = source["threadId"].as_str().filter(|id| !id.is_empty()).ok_or("Room required")?;
    if source["environmentId"].as_str() != Some(channel.environment_id()) ||
        !matches!(source["action"].as_str(), Some("git.merge" | "social.send")) ||
        !source["input"].is_object() {
        return Err("Invalid background effect source".into());
    }
    let (_, issuer) = crate::control::validate_assistant_source(app, thread, channel.environment_id())?;
    issuer.with_live(|| {
        let mut db = database(app)?;
        let transaction = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let grant = read(&transaction, channel.environment_id())?.ok_or("Native consent unavailable")?;
        if grant.principal != channel.consent_principal() {
            return Err("Native consent belongs to another Host".into());
        }
        let request = serde_json::json!({
            "projectId": source.get("projectId"),
            "input": { "operation": { "action": source["action"], "input": source["input"] } }
        });
        if classify(&grant, &request) != Some(true) {
            return Err("Native consent does not allow this effect".into());
        }
        channel.check()?;
        // Host admission expires after 45 seconds. Retain both revocation locks
        // beyond that bound on an uncertain callback, including a lost reply.
        let retain_until = std::time::Instant::now() + std::time::Duration::from_secs(75);
        let result = execute();
        if result.is_err() {
            if let Some(remaining) = retain_until.checked_duration_since(std::time::Instant::now()) {
                std::thread::sleep(remaining);
            }
        }
        transaction.commit().map_err(|e| e.to_string())?;
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn watch_denies_and_unknown_actions_prompt() {
        let mut grant = Grant {
            revision: 1,
            environment_id: "host".into(),
            permission_level: "watch".into(),
            project_ids: vec!["p".into()],
            critical_exclusions: vec!["sendMessages".into()],
            issuer: "i".into(),
            principal: "p".into(),
        };
        let request = json!({"projectId":"p", "input":{"operation":{"action":"files.write"}}});
        assert_eq!(classify(&grant, &request), Some(false));
        grant.permission_level = "everything".into();
        assert_eq!(classify(&grant, &request), Some(true));
        assert_eq!(
            classify(
                &grant,
                &json!({"input":{"operation":{"action":"social.send"}}})
            ),
            None
        );
        assert_eq!(
            classify(
                &grant,
                &json!({"input":{"operation":{"action":"new.action"}}})
            ),
            None
        );
        grant.permission_level = "projects".into();
        assert_eq!(
            classify(
                &grant,
                &json!({"projectId":"other", "input":{"operation":{"action":"files.write"}}})
            ),
            Some(false)
        );
        assert_eq!(
            classify(
                &grant,
                &json!({"input":{"operation":{"action":"notes.create"}}})
            ),
            Some(false)
        );
        assert_eq!(
            classify(
                &grant,
                &json!({"projectId":"p", "input":{"operation":{"action":"files.write", "input":{"projectId":"other"}}}})
            ),
            Some(false)
        );
    }
    #[test]
    fn push_exclusion_uses_reviewed_destination_not_local_branch() {
        let grant = Grant {
            revision: 1,
            environment_id: "host".into(),
            permission_level: "everything".into(),
            project_ids: vec![],
            critical_exclusions: vec!["pushMain".into()],
            issuer: "i".into(),
            principal: "p".into(),
        };
        assert_eq!(
            classify(
                &grant,
                &json!({"input":{"operation":{"action":"git.push", "input":{"review":{"targetRef":"refs/heads/main", "localBranch":"feature"}}}}})
            ),
            None
        );
        assert_eq!(
            classify(
                &grant,
                &json!({"input":{"operation":{"action":"git.push", "input":{"review":{"targetRef":"refs/heads/feature", "localBranch":"main"}}}}})
            ),
            Some(true)
        );
        assert_eq!(
            classify(
                &grant,
                &json!({"input":{"operation":{"action":"git.push", "input":{"branch":"feature"}}}})
            ),
            None
        );
    }
    #[test]
    fn merge_exclusion_uses_reviewed_destination() {
        let grant = Grant {
            revision: 1, environment_id: "host".into(), permission_level: "everything".into(),
            project_ids: vec![], critical_exclusions: vec!["pushMain".into()],
            issuer: "i".into(), principal: "p".into(),
        };
        assert_eq!(classify(&grant, &json!({"input":{"operation":{"action":"git.merge", "input":{"review":{"currentBranch":"main", "source":"feature"}}}}})), None);
        assert_eq!(classify(&grant, &json!({"input":{"operation":{"action":"git.merge", "input":{"review":{"currentBranch":"feature", "source":"main"}}}}})), Some(true));
        assert_eq!(classify(&grant, &json!({"input":{"operation":{"action":"git.merge", "input":{}}}})), None);
    }
    #[test]
    fn corrupt_native_grants_fail_closed() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE assistant_consent(environment TEXT PRIMARY KEY, revision INTEGER, grant_json TEXT); INSERT INTO assistant_consent VALUES('host', 1, '{broken');").unwrap();
        assert!(read(&db, "host").is_err());
        assert!(read(&db, "other").unwrap().is_none());
    }

    #[test]
    fn sqlite_revisions_reject_negative_mismatched_and_unsafe_integer_values() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE assistant_consent(environment TEXT PRIMARY KEY, revision INTEGER, grant_json TEXT);").unwrap();
        for (stored, serialized) in [
            (-1_i64, 1_u64),
            (0, 0),
            (2, 1),
            (9_007_199_254_740_992, 9_007_199_254_740_992),
        ] {
            let grant = json!({"revision":serialized,"environmentId":"host","permissionLevel":"everything","projectIds":[],"criticalExclusions":[],"issuer":"issuer","principal":"principal"});
            db.execute(
                "INSERT OR REPLACE INTO assistant_consent VALUES('host',?1,?2)",
                params![stored, grant.to_string()],
            )
            .unwrap();
            assert!(read(&db, "host").is_err());
        }
        let maximum = 9_007_199_254_740_991_i64;
        let grant = json!({"revision":maximum,"environmentId":"host","permissionLevel":"watch","projectIds":[],"criticalExclusions":[],"issuer":"issuer","principal":"principal"});
        db.execute(
            "INSERT OR REPLACE INTO assistant_consent VALUES('host',?1,?2)",
            params![maximum, grant.to_string()],
        )
        .unwrap();
        assert_eq!(read(&db, "host").unwrap().unwrap().revision, maximum as u64);
    }
}
