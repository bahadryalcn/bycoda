//! Native-owned board snapshots. No Jira credential or account fingerprint leaves native memory.
use super::*;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filters {
    allowed_board_ids: Vec<u64>,
    project_ids: Option<Vec<String>>,
}
impl Filters {
    fn validate(&self) -> Result<(), String> {
        if self.allowed_board_ids.len() > 500
            || self.allowed_board_ids.iter().any(|id| *id == 0)
            || self.project_ids.as_ref().is_some_and(|ids| {
                ids.len() > 1000
                    || ids
                        .iter()
                        .any(|id| id.parse::<u64>().ok().is_none_or(|id| id == 0))
            })
        {
            return Err("Invalid desktop Jira visibility filters".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    scope: String,
    sprint_id: Option<u64>,
    page_token: Option<String>,
}
#[derive(Clone, PartialEq, Eq)]
struct Version {
    updated: String,
    status: String,
    rank: Value,
}
#[derive(Clone)]
struct Snapshot {
    window: String,
    cwd: String,
    root: PathBuf,
    filters: Filters,
    account: JiraConfig,
    board_id: u64,
    scope: Scope,
    configuration: Value,
    order: Vec<String>,
    versions: HashMap<String, Version>,
    deadline: u64,
}
fn snapshots() -> &'static Mutex<HashMap<String, Snapshot>> {
    static SNAPSHOTS: OnceLock<Mutex<HashMap<String, Snapshot>>> = OnceLock::new();
    SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn now() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .map_err(|_| "Clock unavailable".into())
}
fn deadline_valid(deadline: u64, at: u64) -> Result<(), String> {
    if deadline <= at || deadline - at > 120_000 {
        return Err("Jira board review expired; refresh before another operation".into());
    }
    Ok(())
}
fn write_outcome(
    result: Result<(), String>,
    attempted: bool,
    token: Option<&str>,
) -> Result<Value, String> {
    match result {
        Ok(()) => Ok(json!({"outcome":"submitted"})),
        Err(reason) if !attempted => {
            let safe = token
                .filter(|value| !value.is_empty())
                .map(|token| reason.replace(token, "[redacted]"))
                .unwrap_or(reason);
            Ok(
                json!({"outcome":"not-submitted","reason":safe.chars().take(500).collect::<String>()}),
            )
        }
        Err(reason) => Err(reason),
    }
}
fn account_matches(before: &JiraConfig, current: &JiraConfig) -> bool {
    before.site == current.site && before.email == current.email && before.token == current.token
}
fn checked_snapshot(
    app: &AppHandle,
    window: &WebviewWindow,
    cwd: &str,
    filters: &Filters,
    id: &str,
) -> Result<Snapshot, String> {
    filters.validate()?;
    let value = snapshots()
        .lock()
        .map_err(|_| "Jira snapshots unavailable")?
        .get(id)
        .cloned()
        .ok_or("Jira board snapshot unavailable; refresh the board")?;
    deadline_valid(value.deadline, now()?)?;
    if value.window != window.label()
        || value.cwd != cwd
        || value.filters != *filters
        || !filters.allowed_board_ids.contains(&value.board_id)
        || crate::fs::expand_home(cwd).canonicalize().ok().as_ref() != Some(&value.root)
        || app.get_webview_window(window.label()).is_none()
        || !account_matches(&value.account, &require_config(app)?)
    {
        return Err(
            "The Jira account, project, window or visibility selection changed; refresh the board"
                .into(),
        );
    }
    Ok(value)
}
fn board_state(
    config: &JiraConfig,
    board_id: u64,
    scope: &Scope,
    filters: &Filters,
) -> Result<(Value, Value, Vec<String>, HashMap<String, Version>), String> {
    let data = jira_get(
        config,
        &format!("/rest/agile/1.0/board/{board_id}/configuration"),
    )?;
    let sprints = if data["type"] == "scrum" {
        fetch_sprints(config, board_id)?
    } else {
        vec![]
    };
    let mut configuration = serde_json::to_value(parse_configuration(&data, sprints)?)
        .map_err(|_| "Invalid Jira board configuration")?;
    configuration["boardKind"] = data["type"].clone();
    if scope.scope == "sprint"
        && !configuration["sprints"].as_array().is_some_and(|values| {
            values
                .iter()
                .any(|value| value["id"].as_u64() == scope.sprint_id)
        })
    {
        return Err("Choose an active or future sprint from this Jira board".into());
    }
    if configuration["columns"]
        .as_array()
        .is_none_or(|v| v.len() > 100)
        || configuration["sprints"]
            .as_array()
            .is_none_or(|v| v.len() > 500)
    {
        return Err("The Jira board configuration exceeds the mobile review limit".into());
    }
    if serde_json::to_vec(&configuration)
        .map_err(|_| "Invalid Jira configuration")?
        .len()
        > 1024 * 1024
    {
        return Err("The Jira board configuration exceeds the mobile review limit".into());
    }
    let field = configuration["rankFieldId"]
        .as_u64()
        .map(|id| format!("customfield_{id}"));
    let path = issue_path(
        board_id,
        &scope.scope,
        scope.sprint_id,
        scope.page_token.as_deref(),
    )?;
    let mut url = url::Url::parse(&format!("https://jira.invalid{path}"))
        .map_err(|_| "Invalid Jira board scope")?;
    let kept = url
        .query_pairs()
        .filter(|(key, _)| key != "fields")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect::<Vec<_>>();
    url.set_query(None);
    let mut fields = ISSUE_FIELDS
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>();
    if let Some(field) = &field {
        fields.push(field.clone());
    }
    url.query_pairs_mut()
        .extend_pairs(kept)
        .append_pair("fields", &fields.join(","));
    if let Some(ids) = &filters.project_ids {
        if ids.is_empty() {
            return Err("No visible Jira project is selected".into());
        }
        url.query_pairs_mut()
            .append_pair("jql", &format!("project in ({})", ids.join(",")));
    }
    let raw = jira_get(
        config,
        &format!("{}?{}", url.path(), url.query().unwrap_or_default()),
    )?;
    if serde_json::to_vec(&raw)
        .map_err(|_| "Invalid Jira board response")?
        .len()
        > 2 * 1024 * 1024
    {
        return Err("The Jira board page exceeds the mobile review limit".into());
    }
    let page = parse_page(&raw, &config.site)?;
    if page.issues.len() > 100 {
        return Err("The Jira board returned an oversized page".into());
    }
    let mut versions = HashMap::new();
    let mut order = Vec::new();
    let mut rank_complete = true;
    let raw_issues = raw["issues"]
        .as_array()
        .ok_or("Invalid Jira board issues")?;
    for (issue, node) in page.issues.iter().zip(raw_issues) {
        if filters
            .project_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(&issue.issue.team_id))
        {
            return Err("Jira returned an issue outside the visible projects".into());
        }
        let key = require_issue_key(&issue.issue.identifier)?.to_owned();
        if issue.issue.updated_at.is_empty()
            || issue.issue.updated_at.len() > 100
            || issue.status_id.is_empty()
            || issue.status_id.len() > 100
        {
            return Err("Jira did not return a usable issue revision".into());
        }
        if field
            .as_ref()
            .is_some_and(|field| node["fields"].get(field).is_none())
        {
            rank_complete = false;
        }
        let rank = field
            .as_ref()
            .map(|field| node["fields"][field].clone())
            .unwrap_or(Value::Null);
        if !rank.is_null() && rank.as_str().is_none_or(|v| v.len() > 1024) {
            return Err("Invalid Jira rank snapshot".into());
        }
        order.push(key.clone());
        if versions
            .insert(
                key,
                Version {
                    updated: issue.issue.updated_at.clone(),
                    status: issue.status_id.clone(),
                    rank,
                },
            )
            .is_some()
        {
            return Err("Duplicate Jira board issue".into());
        }
    }
    configuration["rankSnapshotAvailable"] = json!(field.is_some() && rank_complete);
    Ok((
        configuration,
        serde_json::to_value(page).map_err(|_| "Invalid Jira board page")?,
        order,
        versions,
    ))
}

#[tauri::command]
pub async fn jira_mobile_boards(app: AppHandle, filters: Filters) -> Result<Vec<Board>, String> {
    filters.validate()?;
    if filters.allowed_board_ids.is_empty()
        || filters
            .project_ids
            .as_ref()
            .is_some_and(|ids| ids.is_empty())
    {
        return Ok(vec![]);
    }
    let account = require_config(&app)?;
    let mut boards = jira_list_boards(app.clone(), filters.project_ids).await?;
    if !account_matches(&account, &require_config(&app)?) {
        return Err("The Jira account changed during the board read".into());
    }
    boards.retain(|board| filters.allowed_board_ids.contains(&board.id));
    if boards.len() > 500 {
        return Err("Too many enabled Jira boards".into());
    }
    Ok(boards)
}
#[tauri::command]
pub async fn jira_mobile_board_read(
    app: AppHandle,
    window: WebviewWindow,
    cwd: String,
    filters: Filters,
    board_id: u64,
    scope: Scope,
) -> Result<Value, String> {
    filters.validate()?;
    if scope.scope != "sprint" && scope.sprint_id.is_some()
        || scope
            .page_token
            .as_ref()
            .is_some_and(|v| v.len() > 4000 || v.contains('\0'))
    {
        return Err("Invalid Jira board scope".into());
    }
    let account = require_config(&app)?;
    let boards = jira_mobile_boards(app.clone(), filters.clone()).await?;
    let board = boards
        .into_iter()
        .find(|v| v.id == board_id)
        .ok_or("This Jira board is not enabled in desktop visibility settings")?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::fs::expand_home(&cwd).canonicalize().map_err(|_| "Jira project directory unavailable")?;
        if !root.is_dir() { return Err("Invalid Jira project directory".into()); }
        let config = require_config(&app)?;
        if !account_matches(&account,&config) { return Err("The Jira account changed during review".into()); }
        let (configuration,page,order,versions) = board_state(&config,board_id,&scope,&filters)?;
        if !account_matches(&config,&require_config(&app)?) { return Err("The Jira account changed during review".into()); }
        let id = uuid::Uuid::new_v4().to_string(); let at = now()?;
        let snapshot = Snapshot { window:window.label().into(),cwd,root,filters,account:config,board_id,scope:scope.clone(),configuration:configuration.clone(),order,versions,deadline:at+120_000 };
        let project_cwd=snapshot.cwd.clone();
        let mut store=snapshots().lock().map_err(|_|"Jira snapshots unavailable")?;
        store.retain(|_,value| value.deadline>at);
        if store.len()>=32 { return Err("Too many active Jira board reviews; wait for an older review to expire".into()); }
        store.insert(id.clone(),snapshot);
        Ok(json!({"snapshotId":id,"projectCwd":project_cwd,"board":board,"configuration":configuration,"page":page,"scope":scope}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn jira_mobile_issue_transitions(
    app: AppHandle,
    window: WebviewWindow,
    cwd: String,
    filters: Filters,
    snapshot_id: String,
    key: String,
) -> Result<Vec<Transition>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = checked_snapshot(&app, &window, &cwd, &filters, &snapshot_id)?;
        if !snapshot.versions.contains_key(&key) {
            return Err("Choose a displayed Jira issue".into());
        }
        transitions(&snapshot.account, require_issue_key(&key)?)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Clone, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Mutation {
    Transition {
        key: String,
        #[serde(rename = "transitionId")]
        transition_id: String,
    },
    Move {
        key: String,
        target: String,
        #[serde(rename = "sprintId")]
        sprint_id: Option<u64>,
        #[serde(rename = "beforeKey")]
        before_key: Option<String>,
        #[serde(rename = "afterKey")]
        after_key: Option<String>,
    },
}
impl Mutation {
    fn key(&self) -> &str {
        match self {
            Self::Transition { key, .. } | Self::Move { key, .. } => key,
        }
    }
}
fn check_state(
    snapshot: &Snapshot,
    configuration: &Value,
    order: &[String],
    versions: &HashMap<String, Version>,
    mutation: &Mutation,
) -> Result<(), String> {
    if snapshot.configuration != *configuration || snapshot.order != order {
        return Err(
            "The Jira board configuration or ranking changed; refresh before applying".into(),
        );
    }
    let mut keys = vec![mutation.key()];
    if let Mutation::Move {
        before_key,
        after_key,
        ..
    } = mutation
    {
        if before_key.is_some() && after_key.is_some() {
            return Err("Choose only one displayed Jira rank anchor".into());
        }
        for anchor in [before_key.as_deref(), after_key.as_deref()]
            .into_iter()
            .flatten()
        {
            if anchor == mutation.key() {
                return Err("A Jira issue cannot be ranked against itself".into());
            }
            keys.push(anchor);
        }
    }
    if matches!(mutation,Mutation::Move{target,..} if target=="rank")
        && configuration["rankSnapshotAvailable"] != true
    {
        return Err("Jira did not return rank revisions; refresh or use the desktop board to rank this issue".into());
    }
    for key in keys {
        if snapshot.versions.get(key).is_none() || snapshot.versions.get(key) != versions.get(key) {
            return Err(
                "The Jira issue status, version or rank changed; refresh before applying".into(),
            );
        }
    }
    Ok(())
}
#[derive(Clone)]
struct Approval {
    window: String,
    cwd: String,
    filters: Filters,
    snapshot_id: String,
    mutation: Mutation,
    method: String,
    path: String,
    body: Value,
    transition_proof: Option<Value>,
    deadline: u64,
}
fn approvals() -> &'static Mutex<HashMap<String, Approval>> {
    static APPROVALS: OnceLock<Mutex<HashMap<String, Approval>>> = OnceLock::new();
    APPROVALS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn mutation_queue() -> &'static Mutex<()> {
    static QUEUE: Mutex<()> = Mutex::new(());
    &QUEUE
}
fn take_approval(
    store: &mut HashMap<String, Approval>,
    id: &str,
    window: &str,
) -> Result<Approval, String> {
    if store.get(id).is_none_or(|value| value.window != window) {
        return Err("Jira approval is unavailable or was already consumed; inspect the original action result".into());
    }
    store
        .remove(id)
        .ok_or_else(|| "Jira approval was already consumed".into())
}
fn insert_approval(
    store: &mut HashMap<String, Approval>,
    id: String,
    approval: Approval,
    at: u64,
) -> Result<(), String> {
    store.retain(|_, value| value.deadline > at);
    if store.len() >= 32 {
        return Err("Too many pending native Jira approvals".into());
    }
    store.insert(id, approval);
    Ok(())
}
fn validate_approval(
    approval: &Approval,
    window: &str,
    filters: &Filters,
    at: u64,
) -> Result<(), String> {
    deadline_valid(approval.deadline, at)?;
    if approval.window != window || approval.filters != *filters {
        return Err("Desktop Jira visibility or owner window changed after approval; review the current board before another action".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn jira_mobile_board_prepare(
    app: AppHandle,
    window: WebviewWindow,
    cwd: String,
    filters: Filters,
    snapshot_id: String,
    mutation: Mutation,
    deadline: u64,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move|| {
        let error_account=require_config(&app).ok();
        let result=(|| -> Result<Value,String> {
        let _queue=mutation_queue().lock().map_err(|_|"Jira board operations unavailable")?;
        deadline_valid(deadline,now()?)?;
        let snapshot=checked_snapshot(&app,&window,&cwd,&filters,&snapshot_id)?;
        let (configuration,_,order,versions)=board_state(&snapshot.account,snapshot.board_id,&snapshot.scope,&snapshot.filters)?;
        check_state(&snapshot,&configuration,&order,&versions,&mutation)?;
        let key=require_issue_key(mutation.key())?;
        let mut transition_proof=None;
        let (method,path,body,description)=match &mutation {
            Mutation::Transition{transition_id,..}=> {
                let options=transitions(&snapshot.account,key)?;
                let selected=require_transition(&options,transition_id)?;
                transition_proof=Some(serde_json::to_value(selected).map_err(|_|"Invalid Jira transition proof")?);
                ("POST",format!("/rest/api/3/issue/{key}/transitions"),json!({"transition":{"id":transition_id}}),format!("Transition: {} → {} ({})",selected.name,selected.status_id,transition_id))
            }
            Mutation::Move{target,sprint_id,before_key,after_key,..}=> {
                if target!="rank" && (before_key.is_some()||after_key.is_some()) || target!="sprint" && sprint_id.is_some() { return Err("Review moving and ranking as separate Jira actions".into()); }
                let body=rank_body(key,before_key.as_deref(),after_key.as_deref(),configuration["rankFieldId"].as_u64())?;
                let path=match target.as_str() {
                    "backlog"=>format!("/rest/agile/1.0/backlog/{}/issue",snapshot.board_id),
                    "board" if configuration["boardKind"]=="kanban"=>format!("/rest/agile/1.0/board/{}/issue",snapshot.board_id),
                    "sprint"=> { let id=sprint_id.ok_or("Choose a displayed Jira sprint")?; if !configuration["sprints"].as_array().is_some_and(|values|values.iter().any(|v|v["id"]==id)) { return Err("The Jira sprint is not active or future on this board".into()); } format!("/rest/agile/1.0/sprint/{id}/issue") },
                    "rank" if before_key.is_some()||after_key.is_some()=>"/rest/agile/1.0/issue/rank".into(),
                    _=>return Err("Invalid Jira move target".into()),
                };
                (if target=="rank"{"PUT"}else{"POST"},path,body,format!("Move: {target}\nSprint: {sprint_id:?}\nBefore: {before_key:?}\nAfter: {after_key:?}"))
            }
        };
        deadline_valid(deadline,now()?)?;
        let approved=app.dialog().message(format!("Approve this exact Jira board operation?\n\nProject: {cwd}\nSite: {}\nAccount: {}\nBoard: {}\nIssue: {key}\n{description}",snapshot.account.site,snapshot.account.email,snapshot.board_id))
            .title("bycoda — Inbox operation approval").parent(&window).buttons(MessageDialogButtons::OkCancelCustom("Approve this operation".into(),"Cancel".into())).blocking_show();
        if !approved { return Err("Native owner declined the Jira operation".into()); }
        deadline_valid(deadline,now()?)?;
        checked_snapshot(&app,&window,&cwd,&filters,&snapshot_id)?;
        let id=uuid::Uuid::new_v4().to_string();
        let mut store=approvals().lock().map_err(|_|"Jira approvals unavailable")?;
        insert_approval(&mut store,id.clone(),Approval{window:window.label().into(),cwd,filters,snapshot_id,mutation,method:method.into(),path,body,transition_proof,deadline},now()?)?;
        Ok(json!({"outcome":"approved","approvalId":id}))
        })();
        match result {Ok(value)=>Ok(value),Err(reason)=>write_outcome(Err(reason),false,error_account.as_ref().map(|account|account.token.as_str()))}
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn jira_mobile_board_commit(
    app: AppHandle,
    window: WebviewWindow,
    approval_id: String,
    filters: Filters,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _queue = mutation_queue()
            .lock()
            .map_err(|_| "Jira board operations unavailable")?;
        // A missing permit might already have dispatched a write: never turn it
        // into proof of non-submission. A valid permit is consumed before checks.
        let approval = {
            let mut store = approvals()
                .lock()
                .map_err(|_| "Jira approvals unavailable")?;
            take_approval(&mut store, &approval_id, window.label())?
        };
        let error_account = require_config(&app).ok();
        let mut attempted = false;
        let result = (|| -> Result<(), String> {
            validate_approval(&approval, window.label(), &filters, now()?)?;
            let current = checked_snapshot(
                &app,
                &window,
                &approval.cwd,
                &filters,
                &approval.snapshot_id,
            )?;
            let (configuration, _, order, versions) = board_state(
                &current.account,
                current.board_id,
                &current.scope,
                &current.filters,
            )?;
            check_state(
                &current,
                &configuration,
                &order,
                &versions,
                &approval.mutation,
            )?;
            if let Mutation::Transition { transition_id, .. } = &approval.mutation {
                let options = transitions(&current.account, approval.mutation.key())?;
                let selected = require_transition(&options, transition_id)?;
                if approval.transition_proof
                    != Some(
                        serde_json::to_value(selected)
                            .map_err(|_| "Invalid Jira transition proof")?,
                    )
                {
                    return Err(
                        "The reviewed Jira transition changed; refresh before applying".into(),
                    );
                }
            }
            deadline_valid(approval.deadline, now()?)?;
            checked_snapshot(
                &app,
                &window,
                &approval.cwd,
                &filters,
                &approval.snapshot_id,
            )?;
            // Jira has no external-client CAS here. This immediate recheck is
            // locally serialized; concurrent provider writes remain a race.
            attempted = true;
            let result = write(
                &current.account,
                &approval.method,
                &approval.path,
                approval.body,
            );
            snapshots()
                .lock()
                .map_err(|_| "Jira snapshots unavailable")?
                .remove(&approval.snapshot_id);
            result
        })();
        write_outcome(
            result,
            attempted,
            error_account.as_ref().map(|account| account.token.as_str()),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn jira_mobile_board_discard_approval(
    window: WebviewWindow,
    approval_id: String,
) -> Result<(), String> {
    let mut store = approvals()
        .lock()
        .map_err(|_| "Jira approvals unavailable")?;
    if store
        .get(&approval_id)
        .is_some_and(|value| value.window == window.label())
    {
        store.remove(&approval_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn approval() -> Approval {
        Approval {
            window: "main".into(),
            cwd: "/project".into(),
            filters: Filters {
                allowed_board_ids: vec![7],
                project_ids: Some(vec!["1".into()]),
            },
            snapshot_id: "snapshot".into(),
            mutation: Mutation::Transition {
                key: "ENG-7".into(),
                transition_id: "4".into(),
            },
            method: "POST".into(),
            path: "/synthetic-only".into(),
            body: json!({}),
            transition_proof: None,
            deadline: 2000,
        }
    }
    #[test]
    fn approved_permits_are_one_use_bounded_and_recheck_post_dialog_visibility() {
        let value = approval();
        let mut store = HashMap::new();
        insert_approval(&mut store, "permit".into(), value.clone(), 1000).unwrap();
        assert!(take_approval(&mut store, "permit", "other-window").is_err());
        assert_eq!(store.len(), 1);
        let consumed = take_approval(&mut store, "permit", "main").unwrap();
        assert!(store.is_empty());
        assert!(take_approval(&mut store, "permit", "main").is_err());
        assert!(validate_approval(&consumed, "main", &consumed.filters, 1000).is_ok());
        let mut changed = consumed.filters.clone();
        changed.allowed_board_ids.clear();
        assert!(validate_approval(&consumed, "main", &changed, 1000).is_err());
        changed = consumed.filters.clone();
        changed.project_ids = Some(vec!["2".into()]);
        assert!(validate_approval(&consumed, "main", &changed, 1000).is_err());
        assert!(validate_approval(&consumed, "main", &consumed.filters, 2000).is_err());
        for at in 0..32 {
            insert_approval(&mut store, at.to_string(), value.clone(), 1000).unwrap();
        }
        assert!(insert_approval(&mut store, "overflow".into(), value.clone(), 1000).is_err());
        assert!(insert_approval(
            &mut store,
            "after-expiry".into(),
            Approval {
                deadline: 4000,
                ..value
            },
            2001
        )
        .is_ok());
        assert_eq!(store.len(), 1);
    }
    #[test]
    fn only_proven_pre_dispatch_failures_return_no_write_outcome() {
        assert_eq!(
            write_outcome(Err("Owner declined".into()), false, None).unwrap(),
            json!({"outcome":"not-submitted","reason":"Owner declined"})
        );
        assert!(write_outcome(Err("Provider response lost".into()), true, None).is_err());
        assert_eq!(
            write_outcome(Ok(()), true, None).unwrap(),
            json!({"outcome":"submitted"})
        );
        assert!(!write_outcome(
            Err("synthetic-token echoed".into()),
            false,
            Some("synthetic-token")
        )
        .unwrap()["reason"]
            .as_str()
            .unwrap()
            .contains("synthetic-token"));
    }
    fn snapshot() -> Snapshot {
        Snapshot {
            window: "main".into(),
            cwd: "/project".into(),
            root: PathBuf::from("/project"),
            filters: Filters {
                allowed_board_ids: vec![7],
                project_ids: Some(vec!["1".into()]),
            },
            account: JiraConfig {
                site: "https://example.invalid".into(),
                email: "owner@example.invalid".into(),
                token: "synthetic-only".into(),
            },
            board_id: 7,
            scope: Scope {
                scope: "board".into(),
                sprint_id: None,
                page_token: None,
            },
            configuration: json!({"rankSnapshotAvailable":true}),
            order: vec!["ENG-7".into(), "ENG-8".into()],
            versions: HashMap::from([
                (
                    "ENG-7".into(),
                    Version {
                        updated: "2026-10-22T00:00:00Z".into(),
                        status: "1".into(),
                        rank: json!("a"),
                    },
                ),
                (
                    "ENG-8".into(),
                    Version {
                        updated: "2026-10-22T00:00:00Z".into(),
                        status: "1".into(),
                        rank: json!("b"),
                    },
                ),
            ]),
            deadline: 2000,
        }
    }
    #[test]
    fn source_status_rank_and_displayed_anchor_are_independently_guarded() {
        let source = snapshot();
        let mutation = Mutation::Move {
            key: "ENG-7".into(),
            target: "rank".into(),
            sprint_id: None,
            before_key: Some("ENG-8".into()),
            after_key: None,
        };
        assert!(check_state(
            &source,
            &source.configuration,
            &source.order,
            &source.versions,
            &mutation
        )
        .is_ok());
        for changed in ["updated", "status", "rank"] {
            let mut versions = source.versions.clone();
            let value = versions.get_mut("ENG-7").unwrap();
            match changed {
                "updated" => value.updated = "new".into(),
                "status" => value.status = "2".into(),
                _ => value.rank = json!("c"),
            };
            assert!(check_state(
                &source,
                &source.configuration,
                &source.order,
                &versions,
                &mutation
            )
            .is_err());
        }
        let mut versions = source.versions.clone();
        versions.get_mut("ENG-8").unwrap().rank = json!("anchor-moved");
        assert!(check_state(
            &source,
            &source.configuration,
            &source.order,
            &versions,
            &mutation
        )
        .is_err());
        let mut missing = source.versions.clone();
        missing.remove("ENG-8");
        assert!(check_state(
            &source,
            &source.configuration,
            &source.order,
            &missing,
            &mutation
        )
        .is_err());
        assert!(check_state(
            &source,
            &source.configuration,
            &["ENG-8".into(), "ENG-7".into()],
            &source.versions,
            &mutation
        )
        .is_err());
    }
    #[test]
    fn account_filters_expiry_and_unknown_mutation_fields_fail_closed() {
        let source = snapshot();
        let mut other = source.account.clone();
        other.email = "other@example.invalid".into();
        assert!(!account_matches(&source.account, &other));
        other = source.account.clone();
        other.token = "rotated-synthetic".into();
        assert!(!account_matches(&source.account, &other));
        assert!(deadline_valid(1000, 1000).is_err());
        assert!(deadline_valid(121001, 1000).is_err());
        assert!(deadline_valid(121000, 1000).is_ok());
        assert!(Filters {
            allowed_board_ids: vec![0],
            project_ids: None
        }
        .validate()
        .is_err());
        assert!(Filters {
            allowed_board_ids: vec![7],
            project_ids: Some(vec!["1) OR project=2".into()])
        }
        .validate()
        .is_err());
        assert!(serde_json::from_value::<Mutation>(
            json!({"action":"transition","key":"ENG-7","transitionId":"4","approved":true})
        )
        .is_err());
    }
}
