pub mod host_migration;
use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::session_store::{now_millis, validate_id, SessionStore};

pub(crate) const CHANGED: &str = "bycoda:automations-changed";
static RECOVERY_DONE: Mutex<Option<(String, Vec<DueAutomationRun>)>> = Mutex::new(None);

fn recover_once<T: Clone>(
    guard: &Mutex<Option<(String, Vec<T>)>>,
    owner: &str,
    recover: impl FnOnce() -> Result<Vec<T>, String>,
) -> Result<Vec<T>, String> {
    let mut done = guard
        .lock()
        .map_err(|_| "Automation recovery unavailable".to_string())?;
    if let Some((original_owner, result)) = &*done {
        return Ok(if original_owner == owner {
            result.clone()
        } else {
            Vec::new()
        });
    }
    let result = recover()?;
    *done = Some((owner.to_owned(), result.clone()));
    Ok(result)
}

const MAX_NAME: usize = 200;
const MAX_PROMPT: usize = 1_000_000;
const MAX_TRIGGERS: usize = 20;
const MAX_RUNS_PER_AUTOMATION: i64 = 100;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    executor: Option<crate::ssh_runbooks::Executor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ssh_runbook: Option<crate::ssh_runbooks::SshRunbook>,
    id: String,
    name: String,
    prompt: String,
    harness: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model_choice: Option<serde_json::Value>,
    model: String,
    #[serde(default)]
    model_settings: HashMap<String, String>,
    cwd: String,
    /// None inherits the execution Host's project workspace policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_mode: Option<String>,
    #[serde(default)]
    worktree_cwd: String,
    #[serde(default)]
    session_folder_id: String,
    reuse_session: bool,
    runtime_mode: String,
    #[serde(default = "default_trigger_kind")]
    trigger_kind: String,
    #[serde(default)]
    trigger_event: String,
    schedule_kind: String,
    minute: i64,
    time: String,
    day_of_week: i64,
    #[serde(default)]
    triggers: Option<Vec<AutomationTrigger>>,
    missed_run_grace_minutes: i64,
    /// Zero run time inherits the routing default, applied by the launcher.
    #[serde(default)]
    max_run_minutes: i64,
    #[serde(default)]
    max_runs_per_day: i64,
    enabled: bool,
    next_run_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_run_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_run_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_run_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_session_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationUpsert {
    #[serde(default)]
    executor: Option<crate::ssh_runbooks::Executor>,
    #[serde(default)]
    ssh_runbook: Option<crate::ssh_runbooks::SshRunbook>,
    id: String,
    name: String,
    prompt: String,
    harness: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model_choice: Option<serde_json::Value>,
    model: String,
    #[serde(default)]
    model_settings: HashMap<String, String>,
    cwd: String,
    #[serde(default)]
    workspace_mode: Option<String>,
    #[serde(default)]
    worktree_cwd: String,
    #[serde(default)]
    session_folder_id: String,
    #[serde(default)]
    reuse_session: bool,
    runtime_mode: String,
    #[serde(default = "default_trigger_kind")]
    trigger_kind: String,
    #[serde(default)]
    trigger_event: String,
    schedule_kind: String,
    minute: i64,
    time: String,
    day_of_week: i64,
    #[serde(default)]
    triggers: Option<Vec<AutomationTrigger>>,
    missed_run_grace_minutes: i64,
    #[serde(default)]
    max_run_minutes: i64,
    #[serde(default)]
    max_runs_per_day: i64,
    #[serde(default = "default_true")]
    enabled: bool,
    next_run_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    max_run_minutes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    executor: Option<crate::ssh_runbooks::Executor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ssh_execution: Option<crate::ssh_execution::RunStatus>,
    id: String,
    automation_id: String,
    trigger: String,
    scheduled_for: i64,
    created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<i64>,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    event_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    event_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTrigger {
    #[serde(default)]
    id: String,
    kind: String,
    #[serde(default)]
    event: String,
    #[serde(default = "default_schedule_kind")]
    schedule_kind: String,
    #[serde(default)]
    minute: i64,
    #[serde(default = "default_time")]
    time: String,
    #[serde(default = "default_day_of_week")]
    day_of_week: i64,
    #[serde(default)]
    repos: Vec<String>,
    #[serde(default)]
    repo: String,
    #[serde(default)]
    branch: String,
    #[serde(default = "default_actor")]
    actor: String,
    /// For label-added events: the label to wait for. Empty means any label.
    #[serde(default)]
    label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueAutomationRun {
    automation: Automation,
    run: AutomationRun,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationEventClaim {
    #[serde(default)]
    recovery_token: Option<String>,
    event_key: String,
    event_kind: String,
    event: String,
    scheduled_for: i64,
    prompt: String,
}

fn default_true() -> bool {
    true
}

fn default_trigger_kind() -> String {
    "time".into()
}

fn default_schedule_kind() -> String {
    "weekdays".into()
}

fn default_time() -> String {
    "09:00".into()
}

fn default_day_of_week() -> i64 {
    1
}

fn default_actor() -> String {
    "anyone".into()
}

pub(crate) fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS automations (
           id TEXT PRIMARY KEY,
           definition_json TEXT NOT NULL,
           enabled INTEGER NOT NULL,
           next_run_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS automations_due_idx
           ON automations (enabled, next_run_at);
         CREATE TABLE IF NOT EXISTS automation_host_migrations (automation_id TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS automation_runs (
           id TEXT PRIMARY KEY,
           automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
           created_at INTEGER NOT NULL,
           run_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS automation_runs_history_idx
           ON automation_runs (automation_id, created_at DESC);
         CREATE TABLE IF NOT EXISTS automation_event_claims (
           automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
           event_key TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           PRIMARY KEY (automation_id, event_key)
         );
         CREATE UNIQUE INDEX IF NOT EXISTS automation_ssh_run_claims_idx
           ON automation_event_claims(event_key) WHERE event_key LIKE 'ssh-run:%';",
    )?;

    let has_claim_owner: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('automation_event_claims') WHERE name = 'claim_owner')",
        [], |row| row.get(0),
    )?;
    if !has_claim_owner {
        // Unknown legacy ownership must never acquire retry authority.
        conn.execute(
            "ALTER TABLE automation_event_claims ADD COLUMN claim_owner TEXT",
            [],
        )?;
    }

    // Backfill claims from pre-ledger run history. Invalid legacy rows should not
    // prevent the session store from opening.
    let mut statement =
        conn.prepare("SELECT automation_id, created_at, run_json FROM automation_runs")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut claims = Vec::new();
    for row in rows {
        let (automation_id, created_at, raw) = row?;
        if let Ok(run) = serde_json::from_str::<AutomationRun>(&raw) {
            if let Some(event_key) = run.event_key {
                claims.push((automation_id, event_key, created_at));
            }
        }
    }
    drop(statement);
    for (automation_id, event_key, created_at) in claims {
        conn.execute(
            "INSERT OR IGNORE INTO automation_event_claims
             (automation_id, event_key, created_at) VALUES (?1, ?2, ?3)",
            params![automation_id, event_key, created_at],
        )?;
    }
    Ok(())
}

fn validate_upsert(input: &AutomationUpsert, now: i64) -> Result<(), String> {
    if input.executor == Some(crate::ssh_runbooks::Executor::Ssh) || input.ssh_runbook.is_some() {
        return Err("Use the SSH runbook editor for reviewed remote execution".into());
    }
    validate_id(&input.id, "automation")?;
    if input.name.trim().is_empty() || input.name.len() > MAX_NAME {
        return Err("Automation name is required and must be under 200 characters.".into());
    }
    if input.prompt.trim().is_empty() || input.prompt.len() > MAX_PROMPT {
        return Err("Automation prompt is required.".into());
    }
    if input.cwd.trim().is_empty() {
        return Err("Choose a project for this automation.".into());
    }
    if !matches!(
        input.workspace_mode.as_deref(),
        None | Some("current" | "worktree" | "existing")
    ) {
        return Err("Invalid automation workspace mode.".into());
    }
    if input.workspace_mode.as_deref() == Some("existing") {
        let path = input.worktree_cwd.trim();
        if path.is_empty() || path.len() > 1_000 {
            return Err("Choose an existing worktree for this automation.".into());
        }
    }
    if input.session_folder_id.len() > 80 {
        return Err("Invalid automation session folder.".into());
    }
    if !matches!(
        input.runtime_mode.as_str(),
        "supervised" | "auto-accept-edits" | "auto" | "full-access"
    ) {
        return Err("Invalid automation run mode.".into());
    }
    if !matches!(
        input.trigger_kind.as_str(),
        "time" | "github" | "linear" | "jira" | "gitlab" | "azuredevops" | "tasks" | "social"
    ) {
        return Err("Invalid automation trigger.".into());
    }
    if input.trigger_event.len() > 200 {
        return Err("Invalid automation trigger event.".into());
    }
    if !matches!(
        input.schedule_kind.as_str(),
        "hourly" | "daily" | "weekdays" | "weekly"
    ) {
        return Err("Invalid automation schedule.".into());
    }
    if !(0..=59).contains(&input.minute)
        || !(0..=6).contains(&input.day_of_week)
        || !valid_time(&input.time)
    {
        return Err("Invalid automation time.".into());
    }
    if !(0..=43_200).contains(&input.missed_run_grace_minutes) {
        return Err("Invalid missed-run grace period.".into());
    }
    if !(0..=10_080).contains(&input.max_run_minutes)
        || !(0..=1_000).contains(&input.max_runs_per_day)
    {
        return Err("Invalid automation run limit.".into());
    }
    if input.next_run_at <= now {
        return Err("The next automation run must be in the future.".into());
    }
    if let Some(triggers) = &input.triggers {
        if triggers.len() > MAX_TRIGGERS {
            return Err("Too many automation triggers.".into());
        }
        for trigger in triggers {
            validate_trigger(trigger)?;
        }
    }
    Ok(())
}

fn validate_trigger(trigger: &AutomationTrigger) -> Result<(), String> {
    if !matches!(
        trigger.kind.as_str(),
        "time" | "github" | "linear" | "jira" | "gitlab" | "azuredevops" | "tasks" | "social"
    ) {
        return Err("Invalid automation trigger.".into());
    }
    if trigger.event.len() > 200
        || trigger.repo.len() > 400
        || trigger.branch.len() > 400
        || trigger.actor.len() > 200
        || trigger.label.len() > 200
        || trigger.repos.len() > 50
        || trigger.repos.iter().any(|repo| repo.len() > 400)
    {
        return Err("Invalid automation trigger event.".into());
    }
    if !matches!(
        trigger.schedule_kind.as_str(),
        "hourly" | "daily" | "weekdays" | "weekly"
    ) {
        return Err("Invalid automation schedule.".into());
    }
    if !(0..=59).contains(&trigger.minute)
        || !(0..=6).contains(&trigger.day_of_week)
        || !valid_time(&trigger.time)
    {
        return Err("Invalid automation time.".into());
    }
    Ok(())
}

fn hydrate_triggers(automation: &mut Automation) {
    if automation.triggers.is_some() {
        return;
    }
    automation.triggers = Some(vec![legacy_trigger(automation)]);
}

fn legacy_trigger(automation: &Automation) -> AutomationTrigger {
    trigger_from_fields(
        &automation.id,
        &automation.trigger_kind,
        &automation.trigger_event,
        &automation.schedule_kind,
        automation.minute,
        &automation.time,
        automation.day_of_week,
    )
}

fn has_time_trigger(automation: &Automation) -> bool {
    match &automation.triggers {
        Some(triggers) => triggers.iter().any(|trigger| trigger.kind == "time"),
        None => automation.trigger_kind == "time",
    }
}

fn normalize_triggers(input: &AutomationUpsert) -> Vec<AutomationTrigger> {
    let mut triggers = input.triggers.clone().unwrap_or_else(|| {
        vec![trigger_from_fields(
            &input.id,
            &input.trigger_kind,
            &input.trigger_event,
            &input.schedule_kind,
            input.minute,
            &input.time,
            input.day_of_week,
        )]
    });
    for trigger in &mut triggers {
        if trigger.id.trim().is_empty() {
            trigger.id = Uuid::new_v4().to_string();
        }
        trigger.event = trigger.event.trim().to_string();
        trigger.repo = trigger.repo.trim().to_string();
        trigger.branch = trigger.branch.trim().to_string();
        trigger.actor = trigger.actor.trim().to_string();
        trigger.label = trigger.label.trim().to_string();
        if trigger.actor.is_empty() {
            trigger.actor = default_actor();
        }
        trigger.repos = trigger
            .repos
            .iter()
            .map(|repo| repo.trim().to_string())
            .filter(|repo| !repo.is_empty())
            .collect();
    }
    triggers
}

fn trigger_from_fields(
    id: &str,
    kind: &str,
    event: &str,
    schedule_kind: &str,
    minute: i64,
    time: &str,
    day_of_week: i64,
) -> AutomationTrigger {
    AutomationTrigger {
        id: format!("{id}:legacy"),
        kind: kind.to_string(),
        event: if event.is_empty() {
            schedule_kind.to_string()
        } else {
            event.to_string()
        },
        schedule_kind: schedule_kind.to_string(),
        minute,
        time: time.to_string(),
        day_of_week,
        repos: Vec::new(),
        repo: String::new(),
        branch: String::new(),
        actor: default_actor(),
        label: String::new(),
    }
}

fn parse_automation(value: String) -> Result<Automation, String> {
    let mut automation: Automation =
        serde_json::from_str(&value).map_err(|error| error.to_string())?;
    hydrate_triggers(&mut automation);
    Ok(automation)
}

fn is_ssh(automation: &Automation) -> bool {
    automation.executor == Some(crate::ssh_runbooks::Executor::Ssh)
        || automation.ssh_runbook.is_some()
}

fn require_agent(automation: &Automation) -> Result<(), String> {
    if is_ssh(automation) {
        Err("SSH runbooks require a fresh native execution review; automatic agent launch is disabled".into())
    } else {
        Ok(())
    }
}

fn valid_time(value: &str) -> bool {
    let Some((hour, minute)) = value.split_once(':') else {
        return false;
    };
    hour.len() == 2
        && minute.len() == 2
        && hour.parse::<u8>().is_ok_and(|value| value < 24)
        && minute.parse::<u8>().is_ok_and(|value| value < 60)
}

fn list(conn: &Connection) -> Result<Vec<Automation>, String> {
    let mut statement = conn
        .prepare("SELECT definition_json FROM automations ORDER BY updated_at DESC, id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let value = row.map_err(|error| error.to_string())?;
        parse_automation(value)
    })
    .collect()
}

fn get(conn: &Connection, id: &str) -> Result<Option<Automation>, String> {
    let raw = conn
        .query_row(
            "SELECT definition_json FROM automations WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    raw.map(parse_automation).transpose()
}

fn write_automation(conn: &Connection, automation: &Automation) -> Result<(), String> {
    let raw = serde_json::to_string(automation).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO automations (id, definition_json, enabled, next_run_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           definition_json = excluded.definition_json,
           enabled = excluded.enabled,
           next_run_at = excluded.next_run_at,
           updated_at = excluded.updated_at",
        params![
            automation.id,
            raw,
            automation.enabled,
            automation.next_run_at,
            automation.updated_at
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn write_run(conn: &Connection, run: &AutomationRun) -> Result<(), String> {
    let raw = serde_json::to_string(run).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, created_at, run_json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET run_json = excluded.run_json",
        params![run.id, run.automation_id, run.created_at, raw],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn new_run(
    automation_id: &str,
    trigger: &str,
    scheduled_for: i64,
    now: i64,
    prompt: &str,
) -> AutomationRun {
    AutomationRun {
        execution: None,
        max_run_minutes: None,
        executor: None,
        ssh_execution: None,
        id: Uuid::new_v4().to_string(),
        automation_id: automation_id.to_string(),
        trigger: trigger.to_string(),
        scheduled_for,
        created_at: now,
        started_at: None,
        completed_at: None,
        status: "pending".into(),
        session_id: None,
        error: None,
        event_key: None,
        event_kind: None,
        event: None,
        prompt: Some(prompt.to_string()),
    }
}

fn new_event_run(
    automation_id: &str,
    event_key: &str,
    event_kind: &str,
    event: &str,
    scheduled_for: i64,
    now: i64,
    prompt: &str,
) -> AutomationRun {
    let mut run = new_run(automation_id, "event", scheduled_for, now, prompt);
    run.event_key = Some(event_key.to_string());
    run.event_kind = Some(event_kind.to_string());
    run.event = Some(event.to_string());
    run
}

fn validate_event_key(value: &str) -> Result<(), String> {
    if value.starts_with("ssh-run:") {
        return Err("Reserved native SSH run identifier".into());
    }
    if value.is_empty()
        || value.len() > 400
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'/' | b'.')
        })
    {
        return Err("Invalid automation event key.".into());
    }
    Ok(())
}

fn has_event_trigger(automation: &Automation, kind: &str, event: &str) -> bool {
    match &automation.triggers {
        Some(triggers) => triggers
            .iter()
            .any(|trigger| trigger.kind == kind && trigger.event == event),
        None => automation.trigger_kind == kind && automation.trigger_event == event,
    }
}

fn list_runs(conn: &Connection, automation_id: &str) -> Result<Vec<AutomationRun>, String> {
    let mut statement = conn
        .prepare(
            "SELECT run_json FROM automation_runs WHERE automation_id = ?1
             ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([automation_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let value = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&value).map_err(|error| error.to_string())
    })
    .collect()
}

/// Recover a committed claim whose IPC reply was lost, without replaying a run
/// that already entered execution or reached a terminal state.
fn pending_event_run(
    conn: &Connection,
    automation_id: &str,
    event_key: &str,
    claim_owner: &str,
) -> Result<Option<AutomationRun>, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT run_json FROM automation_runs AS runs
         JOIN automation_event_claims AS claims ON claims.automation_id = runs.automation_id
         AND claims.event_key = json_extract(run_json, '$.eventKey')
         WHERE runs.automation_id = ?1 AND claims.event_key = ?2 AND claims.claim_owner = ?3
         AND json_extract(run_json, '$.status') = 'pending' LIMIT 1",
            params![automation_id, event_key, claim_owner],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    value
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

fn claim_event_key(
    conn: &Connection,
    automation_id: &str,
    event_key: &str,
    now: i64,
    claim_owner: Option<&str>,
) -> Result<bool, String> {
    conn.execute(
        "INSERT OR IGNORE INTO automation_event_claims
         (automation_id, event_key, created_at, claim_owner) VALUES (?1, ?2, ?3, ?4)",
        params![automation_id, event_key, now, claim_owner],
    )
    .map(|count| count != 0)
    .map_err(|error| error.to_string())
}

fn trim_history(conn: &Connection, automation_id: &str) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT id, run_json FROM automation_runs WHERE automation_id = ?1
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([automation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut delete_ids = Vec::new();
    for (index, row) in rows.enumerate() {
        let (id, raw) = row.map_err(|error| error.to_string())?;
        if index < MAX_RUNS_PER_AUTOMATION as usize {
            continue;
        }
        let run: AutomationRun = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        if matches!(
            run.status.as_str(),
            "succeeded" | "failed" | "skipped" | "cancelled"
        ) {
            delete_ids.push(id);
        }
    }
    drop(statement);
    for id in delete_ids {
        conn.execute("DELETE FROM automation_runs WHERE id = ?1", [id])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn apply_run_summary(automation: &mut Automation, run: &AutomationRun) {
    if automation
        .last_run_at
        .is_none_or(|last_run_at| run.created_at >= last_run_at)
    {
        automation.last_run_at = Some(run.created_at);
        automation.last_run_status = Some(run.status.clone());
        automation.last_run_error = run.error.clone();
        if run.session_id.is_some() {
            automation.last_session_id = run.session_id.clone();
        }
    }
}

#[tauri::command(async)]
pub fn automations_list(store: State<'_, SessionStore>) -> Result<Vec<Automation>, String> {
    store.with_read_conn(|conn| {
        Ok(list(conn)?
            .into_iter()
            .filter(|automation| !is_ssh(automation))
            .map(|mut automation| {
                let migration = host_migration::receipt(conn, &automation.id)?;
                if migration
                    .as_ref()
                    .is_some_and(|receipt| receipt.phase == "committed")
                {
                    return Ok(None);
                }
                if migration.is_some() {
                    automation.enabled = false;
                    automation.last_run_error = Some(
                        "Host migration is pending. Reconnect the target Host to resume.".into(),
                    );
                }
                Ok(Some(automation))
            })
            .collect::<Result<Vec<_>, String>>()?
            .into_iter()
            .flatten()
            .collect())
    })
}

#[tauri::command(async)]
pub fn automations_upsert(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    automation: AutomationUpsert,
) -> Result<Automation, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        automations_upsert_with(&store, automation, || {
            let _ = window.app_handle().emit(CHANGED, ());
        })
    })
}

fn automations_upsert_with(
    store: &SessionStore,
    automation: AutomationUpsert,
    notify: impl FnOnce(),
) -> Result<Automation, String> {
    let now = now_millis();
    validate_upsert(&automation, now)?;
    let triggers = Some(normalize_triggers(&automation));
    let conn = store.lock_conn()?;
    host_migration::require_native_owner(&conn, &automation.id)?;
    let previous = get(&conn, &automation.id)?;
    if previous.as_ref().is_some_and(is_ssh) {
        return Err("Use the SSH runbook editor; agent edits cannot convert a runbook".into());
    }
    let created_at = previous
        .as_ref()
        .map(|value| value.created_at)
        .unwrap_or(now);
    let worktree_cwd = if automation.workspace_mode.as_deref() == Some("existing") {
        automation.worktree_cwd.trim().to_string()
    } else {
        String::new()
    };
    let saved = Automation {
        executor: automation.executor,
        ssh_runbook: None,
        id: automation.id,
        name: automation.name.trim().to_string(),
        prompt: automation.prompt,
        harness: automation.harness,
        provider_account_id: automation.provider_account_id,
        model_choice: automation.model_choice,
        model: automation.model,
        model_settings: automation.model_settings,
        cwd: automation.cwd,
        workspace_mode: automation.workspace_mode,
        worktree_cwd,
        session_folder_id: automation.session_folder_id.trim().to_string(),
        reuse_session: automation.reuse_session,
        runtime_mode: automation.runtime_mode,
        trigger_kind: automation.trigger_kind,
        trigger_event: automation.trigger_event.trim().to_string(),
        schedule_kind: automation.schedule_kind,
        minute: automation.minute,
        time: automation.time,
        day_of_week: automation.day_of_week,
        triggers,
        missed_run_grace_minutes: automation.missed_run_grace_minutes,
        max_run_minutes: automation.max_run_minutes,
        max_runs_per_day: automation.max_runs_per_day,
        enabled: automation.enabled,
        next_run_at: automation.next_run_at,
        last_run_at: previous.as_ref().and_then(|value| value.last_run_at),
        last_run_status: previous
            .as_ref()
            .and_then(|value| value.last_run_status.clone()),
        last_run_error: previous
            .as_ref()
            .and_then(|value| value.last_run_error.clone()),
        last_session_id: previous.and_then(|value| value.last_session_id),
        created_at,
        updated_at: now,
    };
    write_automation(&conn, &saved)?;
    drop(conn);
    notify();
    Ok(saved)
}

#[tauri::command(async)]
pub fn automations_delete(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        automations_delete_with(&store, id, || {
            let _ = window.app_handle().emit(CHANGED, ());
        })
    })
}

fn automations_delete_with(
    store: &SessionStore,
    id: String,
    notify: impl FnOnce(),
) -> Result<(), String> {
    validate_id(&id, "automation")?;
    let conn = store.lock_conn()?;
    if get(&conn, &id)?.as_ref().is_some_and(is_ssh) {
        return Err("Use the SSH runbook editor to remove this runbook".into());
    }
    crate::ssh_runbooks::ensure_not_active(&conn, &id)?;
    conn.execute("DELETE FROM automations WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    drop(conn);
    notify();
    Ok(())
}

#[tauri::command(async)]
pub fn automation_runs_list(
    store: State<'_, SessionStore>,
    automation_id: String,
) -> Result<Vec<AutomationRun>, String> {
    validate_id(&automation_id, "automation")?;
    store.with_read_conn(|conn| {
        let mut runs = list_runs(conn, &automation_id)?;
        // Launch prompts can be large and are only needed by restart recovery, not
        // by the run-history surface.
        for run in &mut runs {
            run.prompt = None;
        }
        Ok(runs)
    })
}

#[tauri::command(async)]
pub fn automation_runs_recover(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    started_before: i64,
    now: i64,
) -> Result<Vec<DueAutomationRun>, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        recover_once(&RECOVERY_DONE, window.label(), || {
            automation_runs_recover_with(&store, started_before, now, || {
                let _ = window.app_handle().emit(CHANGED, ());
            })
        })
    })
}

fn automation_runs_recover_with(
    store: &SessionStore,
    started_before: i64,
    now: i64,
    notify: impl FnOnce(),
) -> Result<Vec<DueAutomationRun>, String> {
    let mut conn = store.lock_conn()?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let mut statement = tx
        .prepare(
            "SELECT run_json FROM automation_runs WHERE created_at <= ?1
             ORDER BY created_at, id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([started_before], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut runs = Vec::new();
    for row in rows {
        let raw = row.map_err(|error| error.to_string())?;
        runs.push(serde_json::from_str::<AutomationRun>(&raw).map_err(|error| error.to_string())?);
    }
    drop(statement);

    let mut due = Vec::new();
    let mut changed = false;
    let mut changed_automation_ids = Vec::new();
    for mut run in runs {
        if run.status != "pending" && run.status != "running" {
            continue;
        }
        let Some(mut automation) = get(&tx, &run.automation_id)? else {
            continue;
        };
        if is_ssh(&automation) || run.executor == Some(crate::ssh_runbooks::Executor::Ssh) {
            crate::ssh_runbooks::recover_run(&tx, &run.id)?;
            changed = true;
            continue;
        }
        if run.status == "running" {
            run.status = "cancelled".into();
            run.completed_at = Some(now);
            run.error = Some("Interrupted when bycoda last stopped.".into());
            apply_run_summary(&mut automation, &run);
            write_run(&tx, &run)?;
            write_automation(&tx, &automation)?;
            changed_automation_ids.push(run.automation_id.clone());
            changed = true;
            continue;
        }
        if run.trigger == "event"
            && run
                .prompt
                .as_deref()
                .is_none_or(|prompt| prompt.trim().is_empty())
        {
            run.status = "failed".into();
            run.completed_at = Some(now);
            run.error = Some("The Inbox event prompt was not available after restart.".into());
            apply_run_summary(&mut automation, &run);
            write_run(&tx, &run)?;
            write_automation(&tx, &automation)?;
            changed_automation_ids.push(run.automation_id.clone());
            changed = true;
            continue;
        }
        due.push(DueAutomationRun { automation, run });
    }
    changed_automation_ids.sort();
    changed_automation_ids.dedup();
    for automation_id in changed_automation_ids {
        trim_history(&tx, &automation_id)?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    drop(conn);
    if changed || !due.is_empty() {
        notify();
    }
    Ok(due)
}

#[tauri::command(async)]
pub fn automation_run_now(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    automation_id: String,
    now: i64,
) -> Result<AutomationRun, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        automation_run_now_with(&store, automation_id, now, || {
            let _ = window.app_handle().emit(CHANGED, ());
        })
    })
}

fn automation_run_now_with(
    store: &SessionStore,
    automation_id: String,
    now: i64,
    notify: impl FnOnce(),
) -> Result<AutomationRun, String> {
    validate_id(&automation_id, "automation")?;
    let mut conn = store.lock_conn()?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    host_migration::require_native_owner(&tx, &automation_id)?;
    let mut automation =
        get(&tx, &automation_id)?.ok_or_else(|| "Automation not found.".to_string())?;
    require_agent(&automation)?;
    let run = new_run(&automation_id, "manual", now, now, &automation.prompt);
    automation.last_run_at = Some(now);
    automation.last_run_status = Some(run.status.clone());
    automation.last_run_error = None;
    write_run(&tx, &run)?;
    write_automation(&tx, &automation)?;
    trim_history(&tx, &automation_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    drop(conn);
    notify();
    Ok(run)
}

#[tauri::command(async)]
pub fn automations_claim_due(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    automation_id: String,
    expected_next_run_at: i64,
    scheduled_for: Option<i64>,
    next_run_at: i64,
    now: i64,
) -> Result<Option<DueAutomationRun>, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        automations_claim_due_with(
            &store,
            automation_id,
            expected_next_run_at,
            scheduled_for.unwrap_or(expected_next_run_at),
            next_run_at,
            now,
            || {
                let _ = window.app_handle().emit(CHANGED, ());
            },
        )
    })
}

fn automations_claim_due_with(
    store: &SessionStore,
    automation_id: String,
    expected_next_run_at: i64,
    scheduled_for: i64,
    next_run_at: i64,
    now: i64,
    notify: impl FnOnce(),
) -> Result<Option<DueAutomationRun>, String> {
    validate_id(&automation_id, "automation")?;
    if scheduled_for < expected_next_run_at || scheduled_for > now || next_run_at <= now {
        return Err("The following automation occurrence must advance the schedule.".into());
    }
    let mut conn = store.lock_conn()?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let current = get(&tx, &automation_id)?.ok_or_else(|| "Automation not found.".to_string())?;
    host_migration::require_native_owner(&tx, &automation_id)?;
    require_agent(&current)?;
    if !has_time_trigger(&current) {
        tx.rollback().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    let claimed = tx
        .execute(
            "UPDATE automations SET next_run_at = ?1
             WHERE id = ?2 AND enabled = 1 AND next_run_at = ?3 AND next_run_at <= ?4",
            params![next_run_at, automation_id, expected_next_run_at, now],
        )
        .map_err(|error| error.to_string())?;
    if claimed == 0 {
        tx.rollback().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    let mut automation =
        get(&tx, &automation_id)?.ok_or_else(|| "Automation not found.".to_string())?;
    automation.next_run_at = next_run_at;
    let mut run = new_run(
        &automation_id,
        "scheduled",
        scheduled_for,
        now,
        &automation.prompt,
    );
    let grace_ms = automation.missed_run_grace_minutes.saturating_mul(60_000);
    let missed = now.saturating_sub(scheduled_for);
    let dispatch = missed <= grace_ms;
    if !dispatch {
        run.status = "skipped".into();
        run.completed_at = Some(now);
        run.error = Some("Missed the scheduled run beyond its grace period.".into());
    }
    automation.last_run_at = Some(now);
    automation.last_run_status = Some(run.status.clone());
    automation.last_run_error = run.error.clone();
    write_run(&tx, &run)?;
    write_automation(&tx, &automation)?;
    trim_history(&tx, &automation_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    drop(conn);
    notify();
    Ok(Some(DueAutomationRun { automation, run }))
}

#[tauri::command(async)]
pub fn automations_claim_event(
    window: tauri::WebviewWindow,
    store: State<'_, SessionStore>,
    automation_id: String,
    claim: AutomationEventClaim,
    now: i64,
) -> Result<Option<DueAutomationRun>, String> {
    let native_window = window.as_ref().window();
    crate::native_window_lifecycle::persistence_write(&native_window, || {
        automations_claim_event_with(&store, window.label(), automation_id, claim, now, || {
            let _ = window.app_handle().emit(CHANGED, ());
        })
    })
}

fn automations_claim_event_with(
    store: &SessionStore,
    window_label: &str,
    automation_id: String,
    claim: AutomationEventClaim,
    now: i64,
    notify: impl FnOnce(),
) -> Result<Option<DueAutomationRun>, String> {
    validate_id(&automation_id, "automation")?;
    validate_event_key(&claim.event_key)?;
    if !matches!(
        claim.event_kind.as_str(),
        "github" | "linear" | "jira" | "gitlab" | "azuredevops" | "tasks" | "social"
    ) {
        return Err("Invalid automation trigger.".into());
    }
    if claim.event.is_empty() || claim.event.len() > 200 {
        return Err("Invalid automation trigger event.".into());
    }
    if claim.prompt.trim().is_empty() || claim.prompt.len() > MAX_PROMPT + 10_000 {
        return Err("Invalid automation run prompt.".into());
    }
    let scheduled_for = if claim.scheduled_for > 0 {
        claim.scheduled_for
    } else {
        now
    };
    let mut conn = store.lock_conn()?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    host_migration::require_native_owner(&tx, &automation_id)?;
    let mut automation =
        get(&tx, &automation_id)?.ok_or_else(|| "Automation not found.".to_string())?;
    require_agent(&automation)?;
    if !automation.enabled || !has_event_trigger(&automation, &claim.event_kind, &claim.event) {
        tx.rollback().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    // Bind retry authority to both the native window and this mounted poller.
    // Missing legacy tokens keep the original one-shot claim behavior.
    let claim_owner = claim
        .recovery_token
        .as_deref()
        .map(|token| {
            Uuid::parse_str(token)
                .map(|token| format!("{}:{token}", window_label))
                .map_err(|_| "Invalid automation claim recovery token.".to_string())
        })
        .transpose()?;
    let claimed = claim_event_key(
        &tx,
        &automation_id,
        &claim.event_key,
        now,
        claim_owner.as_deref(),
    )?;
    if !claimed {
        let pending = match claim_owner.as_deref() {
            Some(owner) => pending_event_run(&tx, &automation_id, &claim.event_key, owner)?,
            None => None,
        };
        tx.rollback().map_err(|error| error.to_string())?;
        return Ok(pending.map(|run| DueAutomationRun { automation, run }));
    }
    let run = new_event_run(
        &automation_id,
        &claim.event_key,
        &claim.event_kind,
        &claim.event,
        scheduled_for,
        now,
        &claim.prompt,
    );
    automation.last_run_at = Some(now);
    automation.last_run_status = Some(run.status.clone());
    automation.last_run_error = None;
    write_run(&tx, &run)?;
    write_automation(&tx, &automation)?;
    trim_history(&tx, &automation_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    drop(conn);
    notify();
    Ok(Some(DueAutomationRun { automation, run }))
}

#[tauri::command(async)]
pub fn automation_run_update(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    run_id: String,
    status: String,
    session_id: Option<String>,
    error: Option<String>,
    now: i64,
    execution: Option<serde_json::Value>,
    max_run_minutes: Option<i64>,
) -> Result<AutomationRun, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        automation_run_update_with(
            &store,
            run_id,
            status,
            session_id,
            error,
            now,
            execution,
            max_run_minutes,
            || {
                let _ = window.app_handle().emit(CHANGED, ());
            },
        )
    })
}

fn automation_run_update_with(
    store: &SessionStore,
    run_id: String,
    status: String,
    session_id: Option<String>,
    error: Option<String>,
    now: i64,
    execution: Option<serde_json::Value>,
    max_run_minutes: Option<i64>,
    notify: impl FnOnce(),
) -> Result<AutomationRun, String> {
    validate_id(&run_id, "automation run")?;
    if let Some(session_id) = session_id.as_deref() {
        validate_id(session_id, "session")?;
    }
    if !matches!(
        status.as_str(),
        "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled"
    ) {
        return Err("Invalid automation run status.".into());
    }
    let mut conn = store.lock_conn()?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let raw = tx
        .query_row(
            "SELECT run_json FROM automation_runs WHERE id = ?1",
            [&run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Automation run not found.".to_string())?;
    let mut run: AutomationRun = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    if run.executor == Some(crate::ssh_runbooks::Executor::Ssh) || run.ssh_execution.is_some() {
        return Err("SSH execution outcomes are owned by the native execution engine".into());
    }
    let attach_session = run.status == "running"
        && status == "running"
        && run.session_id.is_none()
        && session_id.is_some();
    if !attach_session
        && !matches!(
            (run.status.as_str(), status.as_str()),
            ("pending", "running" | "failed" | "skipped" | "cancelled")
                | ("running", "succeeded" | "failed" | "skipped" | "cancelled")
        )
    {
        return Err("Invalid automation run status transition.".into());
    }
    if run.session_id.is_none() && run.execution.is_none() {
        run.execution = execution;
        run.max_run_minutes = max_run_minutes;
    }
    run.status = status;
    if run.status == "running" && run.started_at.is_none() {
        run.started_at = Some(now);
    }
    if matches!(
        run.status.as_str(),
        "succeeded" | "failed" | "skipped" | "cancelled"
    ) {
        run.completed_at = Some(now);
    }
    if session_id.is_some() {
        run.session_id = session_id;
    }
    run.error = error.filter(|value| !value.trim().is_empty());
    let mut automation =
        get(&tx, &run.automation_id)?.ok_or_else(|| "Automation not found.".to_string())?;
    require_agent(&automation)?;
    apply_run_summary(&mut automation, &run);
    write_run(&tx, &run)?;
    write_automation(&tx, &automation)?;
    trim_history(&tx, &run.automation_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    drop(conn);
    notify();
    Ok(run)
}

#[cfg(test)]
mod admission_tests;

#[cfg(test)]
mod tests;
