//! Finite native Room Inbox owner. Credentials remain in their native owners.
use crate::jira::board::mobile_board;
use crate::remote::{NativeServiceChannel, NativeServiceReply};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

struct Discovery {
    environment: String,
    thread: String,
    project: String,
    cwd: String,
    owner: Arc<crate::control::receipts::WindowIssuer>,
    jira: Option<Arc<crate::jira::room_inbox::RoomJiraAccount>>,
    github: Option<Arc<crate::github_review::RoomGithubAccount>>,
    records: Vec<Value>,
    scope: Value,
    expires: Instant,
}
fn discoveries() -> &'static Mutex<HashMap<String, Discovery>> {
    static DATA: OnceLock<Mutex<HashMap<String, Discovery>>> = OnceLock::new();
    DATA.get_or_init(|| Mutex::new(HashMap::new()))
}
fn listed_record(records: &[Value], item: &Value) -> bool {
    records.iter().any(|record| {
        [
            "provider",
            "kind",
            "number",
            "repo",
            "id",
            "identifier",
            "projectPath",
        ]
        .iter()
        .all(|key| record[*key] == item[*key])
    })
}

fn field<'a>(value: &'a Value, name: &str, max: usize) -> Result<&'a str, String> {
    value[name]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid Room Inbox {name}"))
}

fn parse_operation(input: &Value, cwd: &str) -> Result<(String, String, Value), String> {
    let object = input
        .as_object()
        .filter(|v| {
            (v.len() == 3 || v.len() == 4)
                && v.contains_key("requestId")
                && v.contains_key("provider")
                && v.contains_key("operation")
                && v.keys().all(|key| {
                    ["requestId", "provider", "operation", "accountProof"].contains(&key.as_str())
                })
        })
        .ok_or("Invalid Room Inbox operation")?;
    let id = field(input, "requestId", 200)?.to_owned();
    let provider = field(input, "provider", 20)?;
    let op = &object["operation"];
    let action = field(op, "action", 32)?;
    if !matches!(
        (provider, action),
        ("all", "providers")
            | (
                "jira",
                "list"
                    | "details"
                    | "thread"
                    | "comment"
                    | "source-check"
                    | "jira-boards"
                    | "jira-board-read"
                    | "jira-issue-transitions"
                    | "jira-board-transition"
                    | "jira-board-move"
            )
            | (
                "github",
                "list"
                    | "details"
                    | "thread"
                    | "comment"
                    | "review-context"
                    | "review"
                    | "pr-action"
                    | "source-check"
            )
    ) {
        return Err("Room Inbox operation is unavailable".into());
    }
    if action == "providers" {
        if object.contains_key("accountProof") || op.as_object().is_none_or(|v| v.len() != 1) {
            return Err("Invalid Room Inbox connection read".into());
        }
    } else if action.starts_with("jira-") {
        // Board snapshots, not discovery receipts, pin these to the native account.
        if object.contains_key("accountProof") || op["cwd"].as_str() != Some(cwd) {
            return Err("Room Inbox source project changed".into());
        }
    } else if action == "list" {
        if object.contains_key("accountProof")
            || op["projects"].as_array().is_none_or(|projects| {
                projects.len() != 1 || projects[0]["path"].as_str() != Some(cwd)
            })
        {
            return Err("Room Inbox source project changed".into());
        }
    } else if action == "source-check" {
        if op.as_object().is_none_or(|v| v.len() != 2) || op["cwd"].as_str() != Some(cwd) {
            return Err("Room Inbox source project changed".into());
        }
    } else if op["cwd"].as_str() != Some(cwd)
        || op["item"]["projectPath"].as_str() != Some(cwd)
        || op["item"]["provider"].as_str() != Some(provider)
    {
        return Err("Room Inbox source project or provider changed".into());
    }
    if action == "comment" && op.get("inReplyTo").is_some() {
        return Err("Room threaded replies are unavailable".into());
    }
    if action == "comment"
        && op["body"].as_str().is_none_or(|s| {
            s.trim().is_empty() || s.contains('\0') || s.encode_utf16().count() > 30000
        })
    {
        return Err("Invalid Room Inbox comment".into());
    }
    Ok((id, provider.to_owned(), op.clone()))
}

pub(super) fn execute(
    app: &AppHandle,
    request: &Value,
    channel: &Arc<NativeServiceChannel>,
    taken: &NativeServiceReply,
) -> Result<Value, String> {
    let environment = field(request, "environmentId", 200)?;
    let thread = field(request, "threadId", 200)?;
    let project = field(request, "projectId", 200)?;
    let cwd = field(request, "targetProjectCwd", 4096)?;
    let relay = field(request, "id", 200)?;
    let deadline = request["deadline"]
        .as_u64()
        .ok_or("Room Inbox deadline required")?;
    let (request_id, provider, operation) = parse_operation(&request["input"], cwd)?;
    let action = field(&operation, "action", 32)?;
    let writes = matches!(action, "comment" | "review" | "pr-action");
    let (window_label, owner) =
        crate::control::validate_assistant_source(app, thread, environment)?;
    let window = app
        .get_webview_window(&window_label)
        .ok_or("Room Inbox window unavailable")?;
    let _permit = super::privacy_scope_capture::begin_effect()?;
    let scope = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
    let projection = crate::privacy_projection::scope_projection_metadata(app, &owner, &scope)?;
    if !scope["visibleProjects"]
        .as_array()
        .is_some_and(|projects| projects.iter().any(|p| p["cwd"].as_str() == Some(cwd)))
    {
        return Err("Room Inbox project unavailable or private".into());
    }
    let check = || -> Result<(), String> {
        taken.check()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64;
        if !channel.is_current() || channel.environment_id() != environment || deadline <= now {
            return Err("Room Inbox authority expired".into());
        }
        let authorized = channel.project(
            "conversation.desktop.authorize",
            json!({"id":relay,"action":"inbox.room.execute"}),
            |v| {
                Ok(v.as_object().is_some_and(|o| {
                    o.len() == 1 && o.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        let (current, current_owner) =
            crate::control::validate_assistant_source(app, thread, environment)?;
        if !authorized
            || current != window_label
            || !Arc::ptr_eq(&owner, &current_owner)
            || !owner.is_live()
        {
            return Err("Room Inbox source changed".into());
        }
        let current_scope = crate::control::privacy_scope_admission_pinned(app, &window, &owner)?;
        if current_scope != scope
            || crate::privacy_projection::scope_projection_metadata(app, &owner, &current_scope)?
                != projection
        {
            return Err("Room Inbox privacy scope changed".into());
        }
        taken.check()
    };
    check()?;
    let capture_scope = || -> Result<Value, String> {
        let value = crate::control::assistant_ui_request_pinned(
            app,
            thread,
            environment,
            "inbox.room.scope",
            json!({}),
            Some(project),
            Some(cwd),
            relay,
            deadline,
            channel,
            taken,
        )?;
        let object = value
            .as_object()
            .filter(|o| {
                o.len() == 3
                    && o.contains_key("projectIds")
                    && o.contains_key("revision")
                    && o.contains_key("allowedBoardIds")
            })
            .ok_or("Invalid Room Inbox visibility scope")?;
        if object["allowedBoardIds"].as_array().is_none_or(|ids| {
            ids.len() > 500 || ids.iter().any(|id| id.as_u64().is_none_or(|id| id == 0))
        }) {
            return Err("Invalid Room Inbox board scope".into());
        }
        let revision = object["revision"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 20000)
            .ok_or("Invalid Room Inbox visibility revision")?;
        let _ = revision;
        if !object["projectIds"].is_null()
            && object["projectIds"].as_array().is_none_or(|ids| {
                ids.len() > 1000
                    || ids.iter().any(|id| {
                        id.as_str()
                            .is_none_or(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
                    })
            })
        {
            return Err("Invalid Room Inbox project scope".into());
        }
        Ok(value)
    };
    let capture_revision = || -> Result<String, String> {
        let value = crate::control::assistant_ui_request_pinned(
            app,
            thread,
            environment,
            "inbox.room.scope",
            json!({"revisionOnly":true}),
            Some(project),
            Some(cwd),
            relay,
            deadline,
            channel,
            taken,
        )?;
        value
            .as_object()
            .filter(|object| object.len() == 1)
            .and_then(|object| object.get("revision"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 20000)
            .map(str::to_owned)
            .ok_or("Invalid Room Inbox visibility revision".into())
    };
    if provider == "github" && action == "list" {
        let query = &operation["query"];
        let state = query["state"]
            .as_str()
            .filter(|s| matches!(*s, "open" | "all"))
            .ok_or("Invalid GitHub state")?;
        let assigned = query["assignedToMe"]
            .as_bool()
            .ok_or("Invalid GitHub assignee filter")?;
        let search = query["search"]
            .as_str()
            .filter(|s| s.len() <= 500)
            .ok_or("Invalid GitHub search")?;
        let kinds = match query.get("githubKinds") {
            None => vec!["issue".to_string(), "pr".to_string()],
            Some(value) => value
                .as_array()
                .filter(|values| values.len() <= 2)
                .ok_or("Invalid GitHub kinds")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .filter(|kind| matches!(*kind, "issue" | "pr"))
                        .map(str::to_owned)
                        .ok_or("Invalid GitHub kinds".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?,
        };
        let account = Arc::new(crate::github_review::RoomGithubAccount::capture(cwd)?);
        let guard = || {
            check()?;
            account.current(cwd)?;
            check()
        };
        let records = account.list(cwd, state, assigned, search, &kinds, guard)?;
        guard()?;
        let proof = uuid::Uuid::new_v4().to_string();
        let mut vault = discoveries()
            .lock()
            .map_err(|_| "Room Inbox discovery unavailable")?;
        vault.retain(|_, value| value.expires > Instant::now());
        if vault.len() >= 64 {
            return Err("Room Inbox discovery capacity unavailable".into());
        }
        vault.insert(
            proof.clone(),
            Discovery {
                environment: environment.into(),
                thread: thread.into(),
                project: project.into(),
                cwd: cwd.into(),
                owner: owner.clone(),
                jira: None,
                github: Some(account),
                records: records.clone(),
                scope: Value::Null,
                expires: Instant::now() + Duration::from_secs(600),
            },
        );
        return Ok(json!({"accountProof":proof,"items":records,"errors":{},"limited":true}));
    }
    if provider == "jira" && action == "list" {
        let query = &operation["query"];
        let state = query["state"]
            .as_str()
            .filter(|s| matches!(*s, "open" | "all"))
            .ok_or("Invalid Jira state")?;
        let assigned = query["assignedToMe"]
            .as_bool()
            .ok_or("Invalid Jira assignee filter")?;
        if query["search"].as_str() != Some("") {
            return Err("Jira search is unavailable for Room discovery".into());
        }
        let account = Arc::new(crate::jira::room_inbox::RoomJiraAccount::capture(app)?);
        let jira_scope = capture_scope()?;
        account.current(app)?;
        let project_ids = match jira_scope["projectIds"].as_array() {
            Some(ids) => ids
                .iter()
                .map(|id| id.as_str().unwrap_or_default().to_owned())
                .collect::<Vec<_>>(),
            None => vec![],
        };
        let (site, email) = account.display();
        let approved = crate::control::owner_approval::ask_window_checked(app, &window, crate::control::owner_approval::Prompt { title: "bycoda — Jira read approval", message: &(format!("Allow this Room to read Jira issues available to {email} on {site} within the current Inbox project visibility?\n\nRoom: {thread}\nHost: {environment}\nProject: {cwd}\nFilter: {state}{}", if assigned { ", assigned to me" } else { "" })), confirm: "Allow this read", cancel: "Cancel" }, || { check()?; account.current(app)?; check() });
        check()?;
        account.current(app)?;
        check()?;
        if !approved {
            return Err("Owner declined Jira read".into());
        }
        let guard = || {
            check()?;
            account.current(app)?;
            if capture_scope()? != jira_scope {
                return Err("Jira visibility changed".into());
            }
            check()
        };
        let result = if jira_scope["projectIds"]
            .as_array()
            .is_some_and(|ids| ids.is_empty())
        {
            json!([])
        } else {
            account.execute(
                crate::jira::room_inbox::RoomJiraOperation::List {
                    assigned_to_me: assigned,
                    state: state.into(),
                    project_ids,
                    limit: 40,
                },
                guard,
            )?
        };
        guard()?;
        let mut records = result.as_array().ok_or("Invalid Jira list result")?.clone();
        for item in &mut records {
            item["projectPath"] = json!(cwd);
        }
        let proof = uuid::Uuid::new_v4().to_string();
        let mut vault = discoveries()
            .lock()
            .map_err(|_| "Room Inbox discovery unavailable")?;
        vault.retain(|_, value| value.expires > Instant::now());
        if vault.len() >= 64 {
            return Err("Room Inbox discovery capacity unavailable".into());
        }
        vault.insert(
            proof.clone(),
            Discovery {
                environment: environment.into(),
                thread: thread.into(),
                project: project.into(),
                cwd: cwd.into(),
                owner: owner.clone(),
                jira: Some(account),
                github: None,
                records: records.clone(),
                scope: jira_scope,
                expires: Instant::now() + Duration::from_secs(600),
            },
        );
        return Ok(json!({"accountProof":proof,"items":records,"errors":{},"limited":true}));
    }
    if action == "providers" {
        // Connection state only; account names, sites and tokens stay native.
        let states = [
            (
                "github",
                tauri::async_runtime::block_on(crate::fs::git_github_status()).map(|s| s.connected),
            ),
            (
                "gitlab",
                crate::gitlab::gitlab_status(app.clone()).map(|s| s.connected),
            ),
            (
                "azuredevops",
                crate::azure_devops::azure_devops_status(app.clone()).map(|s| s.connected),
            ),
            (
                "linear",
                crate::linear::linear_status(app.clone()).map(|s| s.connected),
            ),
            (
                "jira",
                crate::jira::jira_status(app.clone()).map(|s| s.connected),
            ),
        ];
        check()?;
        return Ok(Value::Array(
            states
                .into_iter()
                .map(|(provider, state)| match state {
                    Ok(connected) => json!({"provider": provider, "connected": connected}),
                    Err(_) => json!({"provider": provider, "connected": false, "error": "Status unavailable"}),
                })
                .collect(),
        ));
    }
    if action.starts_with("jira-") {
        return room_jira_board(
            app,
            &window,
            cwd,
            &operation,
            deadline,
            &check,
            &capture_scope,
            || {
                crate::control::workspace_effect_receipts::begin(
                    app,
                    relay,
                    environment,
                    thread,
                    project,
                    cwd,
                    "inbox.room.execute",
                    &request["input"],
                )
            },
            relay,
        );
    }
    let mut expected_scope = None;
    let discovery_proof = field(&request["input"], "accountProof", 100)?.to_owned();
    let (jira, github) = {
        let mut vault = discoveries()
            .lock()
            .map_err(|_| "Room Inbox discovery unavailable")?;
        vault.retain(|_, value| value.expires > Instant::now());
        let source = vault
            .get(&discovery_proof)
            .ok_or("Room Inbox discovery expired; list again")?;
        if source.environment != environment
            || source.thread != thread
            || source.project != project
            || source.cwd != cwd
            || !Arc::ptr_eq(&source.owner, &owner)
        {
            return Err("Room Inbox discovery source changed".into());
        }
        let item = &operation["item"];
        if action != "source-check" && !listed_record(&source.records, item) {
            return Err("Room Inbox record was not in this discovery".into());
        }
        if provider == "jira" {
            expected_scope = Some(source.scope.clone());
        }
        if (provider == "jira" && source.jira.is_none())
            || (provider == "github" && source.github.is_none())
        {
            return Err("Room Inbox provider changed".into());
        }
        (source.jira.clone(), source.github.clone())
    };
    let account_check = || -> Result<(), String> {
        check()?;
        if !discoveries()
            .lock()
            .map_err(|_| "Room Inbox discovery unavailable")?
            .get(&discovery_proof)
            .is_some_and(|entry| {
                entry.expires > Instant::now() && Arc::ptr_eq(&entry.owner, &owner)
            })
        {
            return Err("Room Inbox discovery expired; list again".into());
        }
        if let Some(scope) = &expected_scope {
            if action == "source-check" {
                if capture_revision()?
                    != scope["revision"]
                        .as_str()
                        .ok_or("Invalid Room Inbox visibility revision")?
                {
                    return Err("Jira visibility changed; list again".into());
                }
            } else if capture_scope()? != *scope {
                return Err("Jira visibility changed; list again".into());
            }
        }
        if let Some(account) = &jira {
            account.current(app)?;
        }
        if let Some(account) = &github {
            account.current(cwd)?;
        }
        check()
    };
    account_check()?;
    if action == "source-check" {
        return Ok(json!({"current":true}));
    }
    if writes {
        let account = if let Some(account) = &jira {
            let (site, email) = account.display();
            format!("{site} / {email}")
        } else {
            format!(
                "github.com / {}",
                github.as_ref().ok_or("GitHub account unavailable")?.login()
            )
        };
        let message = super::inbox_approval_message(&operation, cwd)?;
        static GATE: Mutex<()> = Mutex::new(());
        let _dialog = GATE.lock().map_err(|_| "Room Inbox approval unavailable")?;
        account_check()?;
        let approved = crate::control::owner_approval::ask_window_checked(app, &window, crate::control::owner_approval::Prompt { title: "bycoda — Inbox operation approval", message: &(format!("{message}\n\nAccount: {account}\nRoom: {thread}\nHost: {environment}\nRequest: {request_id}")), confirm: "Approve this operation", cancel: "Cancel" }, || { account_check() });
        account_check()?;
        if !approved {
            return Err("Owner declined Room Inbox operation".into());
        }
        crate::control::workspace_effect_receipts::begin(
            app,
            relay,
            environment,
            thread,
            project,
            cwd,
            "inbox.room.execute",
            &request["input"],
        )?;
    }
    let result = (|| -> Result<Value, String> {
        if let Some(account) = &jira {
            let key = field(&operation["item"], "identifier", 200)?.to_owned();
            let op = match action {
                "details" => crate::jira::room_inbox::RoomJiraOperation::Details { key },
                "thread" => crate::jira::room_inbox::RoomJiraOperation::Thread { key },
                "comment" => crate::jira::room_inbox::RoomJiraOperation::Comment {
                    key,
                    body: field(&operation, "body", 120000)?.to_owned(),
                },
                _ => return Err("Room Inbox operation unavailable".into()),
            };
            account.execute(op, account_check)
        } else {
            let item = &operation["item"];
            let repo = field(item, "repo", 1000)?;
            let kind = field(item, "kind", 10)?;
            let number = item["number"]
                .as_i64()
                .filter(|n| *n > 0)
                .ok_or("Invalid pull request")?;
            if action == "review-context" {
                if kind != "pr" {
                    return Err("GitHub review context requires a pull request".into());
                }
                return github
                    .as_ref()
                    .ok_or("GitHub account unavailable")?
                    .review_context(cwd, repo, number, account_check);
            }
            if action == "pr-action" {
                if kind != "pr" {
                    return Err("GitHub action requires a pull request".into());
                }
                return github
                    .as_ref()
                    .ok_or("GitHub account unavailable")?
                    .pr_action(
                        cwd,
                        repo,
                        number,
                        field(&operation, "prAction", 20)?,
                        operation["expectedHeadOid"].as_str().unwrap_or(""),
                        account_check,
                    );
            }
            if action != "review" {
                let body = if action == "comment" {
                    field(&operation, "body", 120000)?
                } else {
                    ""
                };
                return github.as_ref().ok_or("GitHub account unavailable")?.item(
                    cwd,
                    repo,
                    kind,
                    number,
                    action,
                    body,
                    account_check,
                );
            }
            if kind != "pr" {
                return Err("GitHub review requires a pull request".into());
            }
            let review = serde_json::from_value(json!({"commitId":operation["commitId"],"event":operation["event"],"body":operation["body"],"comments":operation["comments"]})).map_err(|_| "Invalid review")?;
            github
                .as_ref()
                .ok_or("GitHub account unavailable")?
                .review(cwd, repo, number, &review, account_check)
                .map(Value::String)
        }
    })();
    if writes {
        match &result {
            Ok(value) => crate::control::workspace_effect_receipts::complete(
                relay,
                &json!({"ok":true,"result":value}),
            )?,
            Err(_) => crate::control::workspace_effect_receipts::mark_unknown(relay),
        }
    }
    let result = result?;
    check()?;
    Ok(result)
}

/// Room filters come from the window's saved Inbox visibility, never the model.
fn room_jira_filters(scope: &Value) -> Result<mobile_board::Filters, String> {
    serde_json::from_value(json!({
        "allowedBoardIds": scope["allowedBoardIds"],
        "projectIds": scope["projectIds"],
    }))
    .map_err(|_| "Invalid Room Jira visibility".into())
}

/// Builds the native board mutation; mobile_board validates keys, anchors and sprints.
fn room_jira_mutation(operation: &Value) -> Result<mobile_board::Mutation, String> {
    let key = field(operation, "key", 200)?;
    let value = if operation["action"] == "jira-board-transition" {
        json!({"action": "transition", "key": key, "transitionId": field(operation, "transitionId", 100)?})
    } else {
        json!({
            "action": "move",
            "key": key,
            "target": field(operation, "target", 20)?,
            "sprintId": operation["sprintId"],
            "beforeKey": operation["beforeKey"],
            "afterKey": operation["afterKey"],
        })
    };
    serde_json::from_value(value).map_err(|_| "Invalid Room Jira board change".into())
}

/// Room Jira board reads and owner-approved changes through the existing native board owner.
#[allow(clippy::too_many_arguments)]
fn room_jira_board(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    cwd: &str,
    operation: &Value,
    deadline: u64,
    check: &dyn Fn() -> Result<(), String>,
    capture_scope: &dyn Fn() -> Result<Value, String>,
    begin_receipt: impl FnOnce() -> Result<(), String>,
    relay: &str,
) -> Result<Value, String> {
    use tauri::async_runtime::block_on;
    let scope = capture_scope()?;
    let filters = room_jira_filters(&scope)?;
    check()?;
    let action = field(operation, "action", 32)?;
    let snapshot = || field(operation, "snapshotId", 100).map(str::to_owned);
    let result = match action {
        "jira-boards" => serde_json::to_value(block_on(mobile_board::jira_mobile_boards(
            app.clone(),
            filters,
        ))?)
        .map_err(|_| "Invalid Jira boards".to_string())?,
        "jira-board-read" => {
            let board_scope = serde_json::from_value(json!({
                "scope": operation["scope"],
                "sprintId": operation["sprintId"],
                "pageToken": operation["pageToken"],
            }))
            .map_err(|_| "Invalid Jira board scope")?;
            block_on(mobile_board::jira_mobile_board_read(
                app.clone(),
                window.clone(),
                cwd.into(),
                filters,
                operation["boardId"]
                    .as_u64()
                    .filter(|id| *id > 0)
                    .ok_or("Invalid Jira board")?,
                board_scope,
            ))?
        }
        "jira-issue-transitions" => {
            serde_json::to_value(block_on(mobile_board::jira_mobile_issue_transitions(
                app.clone(),
                window.clone(),
                cwd.into(),
                filters,
                snapshot()?,
                field(operation, "key", 200)?.into(),
            ))?)
            .map_err(|_| "Invalid Jira transitions".to_string())?
        }
        "jira-board-transition" | "jira-board-move" => {
            let at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_millis() as u64;
            // The native board review accepts at most a two-minute approval window.
            let review_deadline = deadline.min(at + 110_000);
            let prepared = block_on(mobile_board::jira_mobile_board_prepare(
                app.clone(),
                window.clone(),
                cwd.into(),
                filters.clone(),
                snapshot()?,
                room_jira_mutation(operation)?,
                review_deadline,
            ))?;
            let Some(approval) = prepared["approvalId"].as_str().map(str::to_owned) else {
                // Declined or refused before submission: nothing was sent to Jira.
                check()?;
                return Ok(prepared);
            };
            let fresh = capture_scope().and_then(|scope| room_jira_filters(&scope));
            if check().is_err() || fresh.as_ref().ok() != Some(&filters) {
                mobile_board::jira_mobile_board_discard_approval(window.clone(), approval)?;
                return Ok(json!({
                    "outcome": "not-submitted",
                    "reason": "Room authority or Jira visibility changed after approval. Read the board again.",
                }));
            }
            begin_receipt()?;
            let committed = block_on(mobile_board::jira_mobile_board_commit(
                app.clone(),
                window.clone(),
                approval,
                filters,
            ));
            match &committed {
                Ok(value) => crate::control::workspace_effect_receipts::complete(
                    relay,
                    &json!({"ok": true, "result": value}),
                )?,
                Err(_) => crate::control::workspace_effect_receipts::mark_unknown(relay),
            }
            committed?
        }
        _ => return Err("Room Inbox operation unavailable".into()),
    };
    check()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finite_target_and_original_project_are_required() {
        let input = json!({"requestId":"r","provider":"jira","operation":{"action":"details","cwd":"/p","item":{"provider":"jira","projectPath":"/p","identifier":"ABC-1"}}});
        assert!(parse_operation(&input, "/p").is_ok());
        assert!(parse_operation(&input, "/other").is_err());
        let mut invalid = input.clone();
        invalid["operation"]["action"] = json!("delete");
        assert!(parse_operation(&invalid, "/p").is_err());
        let mut invalid = input;
        invalid["provider"] = json!("github");
        assert!(parse_operation(&invalid, "/p").is_err());
        let check = json!({"requestId":"r", "provider":"jira", "accountProof":"opaque", "operation":{"action":"source-check", "cwd":"/p"}});
        assert!(parse_operation(&check, "/p").is_ok());
        assert!(parse_operation(&check, "/other").is_err());
    }
    #[test]
    fn connection_and_board_reads_need_no_discovery_but_keep_the_project() {
        let providers =
            json!({"requestId":"r","provider":"all","operation":{"action":"providers"}});
        assert!(parse_operation(&providers, "/p").is_ok());
        let mut invalid = providers.clone();
        invalid["accountProof"] = json!("opaque");
        assert!(parse_operation(&invalid, "/p").is_err());
        let mut invalid = providers;
        invalid["operation"]["cwd"] = json!("/p");
        assert!(parse_operation(&invalid, "/p").is_err());
        let board = json!({"requestId":"r","provider":"jira","operation":{"action":"jira-board-read","cwd":"/p","boardId":7,"scope":"board"}});
        assert!(parse_operation(&board, "/p").is_ok());
        assert!(parse_operation(&board, "/other").is_err());
        let mut invalid = board;
        invalid["provider"] = json!("github");
        assert!(parse_operation(&invalid, "/p").is_err());
    }
    #[test]
    fn board_changes_map_to_the_native_mutation_contract() {
        let transition =
            json!({"action":"jira-board-transition","key":"ENG-1","transitionId":"31"});
        assert!(room_jira_mutation(&transition).is_ok());
        let rank =
            json!({"action":"jira-board-move","key":"ENG-1","target":"rank","beforeKey":"ENG-2"});
        assert!(room_jira_mutation(&rank).is_ok());
        assert!(room_jira_mutation(&json!({"action":"jira-board-move","key":"ENG-1"})).is_err());
        let filters = json!({"allowedBoardIds":[7],"projectIds":null,"revision":"x"});
        assert!(room_jira_filters(&filters).is_ok());
        assert!(room_jira_filters(&json!({"projectIds":null})).is_err());
    }
    #[test]
    fn discovery_matches_full_record_identity() {
        let record = json!({"provider":"jira","kind":"jira","number":4,"repo":"","id":"71","identifier":"ABC-4","projectPath":"/p","title":"Untrusted title"});
        let mut item = record.clone();
        assert!(listed_record(std::slice::from_ref(&record), &item));
        item["identifier"] = json!("ABC-5");
        assert!(!listed_record(std::slice::from_ref(&record), &item));
        item["identifier"] = json!("ABC-4");
        item["projectPath"] = json!("/other");
        assert!(!listed_record(&[record], &item));
    }
}
