//! Manual reviewed SSH runbooks in the existing automation tables.
//! Definitions contain the explicitly saved script; run records contain metadata only.
use crate::{
    session_store::{now_millis, validate_id, SessionStore},
    ssh_execution::{
        self, ClaimResult, ExecutionLimits, ResolvedTarget, RunPersistence, RunStatus,
        RunbookSnapshot, TargetState,
    },
    ssh_group_defaults::RemoteShellKind,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Executor {
    Agent,
    Ssh,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Triggers {
    #[serde(default)]
    pub startup_server_ids: Vec<String>,
    pub interval_minutes: Option<u32>,
    pub next_run_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshRunbook {
    #[serde(default)]
    pub triggers: Option<Triggers>,
    pub revision: u64,
    pub script: String,
    pub shell: RemoteShellKind,
    pub target_ids: Vec<String>,
    pub limits: ExecutionLimits,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Profile {
    #[serde(default)]
    pub triggers: Option<Triggers>,
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub script: String,
    pub shell: RemoteShellKind,
    pub target_ids: Vec<String>,
    pub limits: ExecutionLimits,
}
impl Profile {
    fn metadata(&self) -> SshRunbook {
        SshRunbook {
            triggers: self.triggers.clone(),
            revision: self.revision,
            script: self.script.clone(),
            shell: self.shell,
            target_ids: self.target_ids.clone(),
            limits: self.limits,
        }
    }
    fn snapshot(&self) -> RunbookSnapshot {
        RunbookSnapshot {
            automation_id: self.id.clone(),
            revision: self.revision,
            script: self.script.clone(),
            shell: self.shell,
        }
    }
}
fn validate(profile: &Profile) -> Result<(), String> {
    validate_id(&profile.id, "runbook")?;
    if profile.id.len() > 200
        || profile.name.trim().is_empty()
        || profile.name.len() > 200
        || profile.name.chars().any(char::is_control)
        || profile.revision > i64::MAX as u64
        || profile.script.trim().is_empty()
        || profile.script.len() > 64 * 1024
        || profile
            .script
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        || profile.script.contains("-----BEGIN")
        || profile.script.contains("-----END")
        || !(1..=16).contains(&profile.target_ids.len())
        || !(1..=4).contains(&profile.limits.concurrency)
        || !(1..=86_400).contains(&profile.limits.timeout_seconds)
    {
        return Err("Invalid SSH runbook name, script, targets or limits".into());
    }
    let mut ids = std::collections::HashSet::new();
    for id in &profile.target_ids {
        validate_id(id, "server")?;
        if id.len() > 200 || !ids.insert(id) {
            return Err("Choose unique canonical server identifiers".into());
        }
    }
    if let Some(triggers) = &profile.triggers {
        let unique: std::collections::HashSet<_> = triggers.startup_server_ids.iter().collect();
        if unique.len() != triggers.startup_server_ids.len()
            || unique.iter().any(|id| !ids.contains(id))
            || triggers
                .interval_minutes
                .is_some_and(|minutes| !(1..=525600).contains(&minutes))
        {
            return Err("Invalid SSH startup association or schedule interval".into());
        }
    }
    Ok(())
}
fn definition(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    let raw:Option<Option<String>>=conn.query_row("SELECT CASE WHEN length(CAST(definition_json AS BLOB))<=1048576 THEN definition_json ELSE NULL END FROM automations WHERE id=?1",[id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    raw.map(|raw| {
        serde_json::from_str(&raw.ok_or("Automation definition exceeds its supported size")?)
            .map_err(|_| "Invalid automation definition".into())
    })
    .transpose()
}
fn profile_from(value: &Value) -> Result<Profile, String> {
    if value.get("sshRunbookDeleted").and_then(Value::as_bool) == Some(true) {
        return Err("Runbook was deleted; create a new runbook identifier".into());
    }
    if value.get("executor").and_then(Value::as_str) != Some("ssh") {
        return Err("This automation is not an SSH runbook".into());
    }
    let metadata: SshRunbook = serde_json::from_value(
        value
            .get("sshRunbook")
            .cloned()
            .ok_or("Missing SSH runbook definition")?,
    )
    .map_err(|_| "Invalid SSH runbook definition")?;
    let profile = Profile {
        triggers: metadata.triggers,
        id: value
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Missing runbook ID")?
            .into(),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .ok_or("Missing runbook name")?
            .into(),
        revision: metadata.revision,
        script: metadata.script,
        shell: metadata.shell,
        target_ids: metadata.target_ids,
        limits: metadata.limits,
    };
    validate(&profile)?;
    if profile.revision == 0 {
        return Err("Invalid saved runbook revision".into());
    }
    Ok(profile)
}
fn get(conn: &Connection, id: &str) -> Result<Profile, String> {
    let value = definition(conn, id)?.ok_or("Runbook no longer exists")?;
    let profile = profile_from(&value)?;
    if profile.id != id {
        return Err("Saved runbook identity is inconsistent".into());
    }
    Ok(profile)
}
fn save(conn: &Connection, profile: &Profile, expected: Option<u64>) -> Result<Profile, String> {
    validate(profile)?;
    if profile.revision != expected.unwrap_or(0)
        || expected == Some(0)
        || profile.revision >= i64::MAX as u64
    {
        return Err("Runbook changed; reload before saving".into());
    }
    let old = definition(conn, &profile.id)?;
    if let Some(value) = &old {
        let current = profile_from(value)?;
        if Some(current.revision) != expected {
            return Err("Runbook changed; reload before saving".into());
        }
    } else if expected.is_some() {
        return Err("Runbook no longer exists".into());
    }
    let now = now_millis();
    let mut value=old.unwrap_or_else(||json!({"id":profile.id,"name":"","prompt":"","harness":"","model":"","modelSettings":{},"cwd":"","workspaceMode":"current","worktreeCwd":"","sessionFolderId":"","reuseSession":false,"runtimeMode":"supervised","triggerKind":"time","triggerEvent":"","scheduleKind":"daily","minute":0,"time":"09:00","dayOfWeek":1,"triggers":[],"missedRunGraceMinutes":0,"maxRunMinutes":0,"maxRunsPerDay":0,"enabled":false,"nextRunAt":0,"createdAt":now,"updatedAt":now}));
    let mut saved = profile.clone();
    saved.name = saved.name.trim().into();
    saved.revision += 1;
    if let Some(triggers) = &mut saved.triggers {
        let old_triggers = value
            .get("sshRunbook")
            .and_then(|v| v.get("triggers"))
            .cloned()
            .and_then(|v| serde_json::from_value::<Triggers>(v).ok());
        triggers.next_run_at = triggers.interval_minutes.map(|minutes| {
            old_triggers
                .as_ref()
                .filter(|old| old.interval_minutes == Some(minutes))
                .and_then(|old| old.next_run_at)
                .unwrap_or_else(|| now.saturating_add(i64::from(minutes) * 60_000))
        });
    }
    value["name"] = json!(saved.name);
    value["executor"] = json!("ssh");
    value["sshRunbook"] = serde_json::to_value(saved.metadata()).map_err(|_| "Invalid runbook")?;
    value["enabled"] = json!(false);
    value["nextRunAt"] = json!(0);
    value["triggers"] = json!([]);
    value["updatedAt"] = json!(now);
    let raw = serde_json::to_string(&value).map_err(|_| "Invalid runbook")?;
    let count = if let Some(expected) = expected {
        conn.execute(
            "UPDATE automations SET definition_json=?2,enabled=0,next_run_at=0,updated_at=?3
             WHERE id=?1 AND json_extract(definition_json,'$.executor')='ssh'
               AND json_extract(definition_json,'$.sshRunbook.revision')=?4",
            params![saved.id, raw, now, expected as i64],
        )
    } else {
        conn.execute(
            "INSERT INTO automations(id,definition_json,enabled,next_run_at,updated_at)
             SELECT ?1,?2,0,0,?3 WHERE
             (SELECT count(*) FROM automations WHERE json_extract(definition_json,'$.executor')='ssh')<256
             ON CONFLICT(id) DO NOTHING",
            params![saved.id, raw, now],
        )
    }.map_err(|e|e.to_string())?;
    if count != 1 {
        return Err("Runbook changed; reload before saving".into());
    }
    Ok(saved)
}
pub(crate) fn ensure_not_active(conn: &Connection, id: &str) -> Result<(), String> {
    let count:i64=conn.query_row("SELECT count(*) FROM automation_runs WHERE automation_id=?1 AND json_extract(run_json,'$.executor')='ssh' AND json_extract(run_json,'$.status') IN ('pending','running')",[id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if count > 0 {
        Err(
            "Cancel active SSH executions and wait for them to finish before deleting this runbook"
                .into(),
        )
    } else {
        Ok(())
    }
}
fn remove(conn: &Connection, id: &str, expected: u64) -> Result<(), String> {
    validate_id(id, "runbook")?;
    if expected == 0 || expected > i64::MAX as u64 {
        return Err("Invalid runbook revision".into());
    }
    ensure_not_active(conn, id)?;
    // Keep the FK owner of durable run-ID claims while removing its script.
    // Hidden identity tombstones cannot be reopened or recreated as runbooks.
    let count=conn.execute("UPDATE automations SET definition_json=json_set(json_remove(definition_json,'$.sshRunbook'),'$.sshRunbookDeleted',json('true'),'$.name','','$.enabled',json('false'),'$.triggers',json('[]'),'$.nextRunAt',0),enabled=0,next_run_at=0 WHERE id=?1 AND json_extract(definition_json,'$.executor')='ssh' AND json_extract(definition_json,'$.sshRunbook.revision')=?2",params![id,expected as i64]).map_err(|e|e.to_string())?;
    if count != 1 {
        return Err("Runbook changed; reload before deleting".into());
    }
    Ok(())
}
fn decode_run(raw: &str) -> Result<RunStatus, String> {
    if raw.len() > 128 * 1024 {
        return Err("Invalid SSH run metadata".into());
    }
    let value: Value = serde_json::from_str(raw).map_err(|_| "Invalid SSH run metadata")?;
    if value.get("executor").and_then(Value::as_str) != Some("ssh") {
        return Err("Run identifier belongs to another executor".into());
    }
    let status: RunStatus = serde_json::from_value(
        value
            .get("sshExecution")
            .cloned()
            .ok_or("Missing SSH run metadata")?,
    )
    .map_err(|_| "Invalid SSH run metadata")?;
    if status.run_id != value["id"].as_str().unwrap_or("")
        || status.automation_id != value["automationId"].as_str().unwrap_or("")
    {
        return Err("SSH run identity is inconsistent".into());
    }
    Ok(status)
}
fn read_run(conn: &Connection, id: &str) -> Result<Option<RunStatus>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT run_json FROM automation_runs WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let found = raw.map(|raw| decode_run(&raw)).transpose()?;
    if found.as_ref().is_some_and(|status| status.run_id != id) {
        return Err("Execution belongs to another native window or run".into());
    }
    Ok(found)
}
fn summary(status: &RunStatus) -> &'static str {
    if !status.finished() {
        "running"
    } else if status.targets.iter().any(|t| {
        t.state == TargetState::Unknown
            || t.state == TargetState::Failed
            || (t.state == TargetState::Exited && t.exit_code != Some(0))
    }) {
        "failed"
    } else if status
        .targets
        .iter()
        .any(|t| t.state == TargetState::Cancelled)
    {
        "cancelled"
    } else {
        "succeeded"
    }
}
fn claim(conn: &Connection, status: &RunStatus) -> Result<ClaimResult, String> {
    if let Some(existing) = read_run(conn, &status.run_id)? {
        return Ok(ClaimResult::Existing(existing));
    }
    let book = get(conn, &status.automation_id)?;
    if book.revision != status.revision
        || book.target_ids
            != status
                .targets
                .iter()
                .map(|t| t.server_id.clone())
                .collect::<Vec<_>>()
    {
        return Err("Runbook changed; request a fresh review".into());
    }
    let now = claim_stamp();
    let ledger = format!("ssh-run:{}", status.run_id);
    let claimed=conn.execute("INSERT OR IGNORE INTO automation_event_claims(automation_id,event_key,created_at) VALUES(?1,?2,?3)",params![status.automation_id,ledger,now]).map_err(|e|e.to_string())?;
    if claimed != 1 {
        return Err("Run identifier was already claimed; history is no longer available and execution will not be replayed".into());
    }
    let value = json!({"id":status.run_id,"automationId":status.automation_id,"trigger":"manual","scheduledFor":now,"createdAt":now,"startedAt":now,"status":"running","executor":"ssh","sshExecution":status});
    conn.execute(
        "INSERT INTO automation_runs(id,automation_id,created_at,run_json) VALUES(?1,?2,?3,?4)",
        params![
            status.run_id,
            status.automation_id,
            now,
            serde_json::to_string(&value).map_err(|_| "Invalid run metadata")?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(ClaimResult::Claimed)
}
fn abandon_missing(
    conn: &Connection,
    owner: &str,
    run_id: &str,
    automation_id: &str,
    revision: u64,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let valid = |id: &str| {
        !id.is_empty()
            && id.len() <= 200
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_:/.".contains(&byte))
    };
    if !valid(run_id)
        || !valid(automation_id)
        || owner.is_empty()
        || owner.len() > 200
        || revision == 0
        || revision > i64::MAX as u64
    {
        return Err("Invalid missing execution identity".into());
    }
    let value = definition(conn, automation_id)?.ok_or("Runbook no longer exists")?;
    if value.get("executor").and_then(Value::as_str) != Some("ssh") {
        return Err("This automation is not an SSH runbook".into());
    }
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_runs WHERE id=?1)",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Err(
            "Execution already exists; refresh its status before taking another action".into(),
        );
    }
    let ledger = format!("ssh-run:{run_id}");
    let identity = serde_json::to_vec(&(owner, run_id, automation_id, revision))
        .map_err(|_| "Invalid missing execution identity")?;
    let marker = format!("ssh-abandoned:{:x}", Sha256::digest(identity));
    let claimed=conn.execute("INSERT OR IGNORE INTO automation_event_claims(automation_id,event_key,created_at) VALUES(?1,?2,?3)",params![automation_id,ledger,now_millis()]).map_err(|e|e.to_string())?;
    if claimed == 0 {
        let own:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_event_claims WHERE automation_id=?1 AND event_key=?2)",params![automation_id,marker],|row|row.get(0)).map_err(|e|e.to_string())?;
        return if own {
            Ok(())
        } else {
            Err(
                "Run identifier was already claimed; its execution cannot be abandoned as missing"
                    .into(),
            )
        };
    }
    conn.execute(
        "INSERT INTO automation_event_claims(automation_id,event_key,created_at) VALUES(?1,?2,?3)",
        params![automation_id, marker, now_millis()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn update(conn: &Connection, status: &RunStatus) -> Result<(), String> {
    let raw: String = conn
        .query_row(
            "SELECT run_json FROM automation_runs WHERE id=?1",
            [&status.run_id],
            |r| r.get(0),
        )
        .map_err(|_| "SSH run metadata no longer exists")?;
    let old = decode_run(&raw)?;
    if old.owner != status.owner
        || old.digest != status.digest
        || old.automation_id != status.automation_id
        || old.revision != status.revision
    {
        return Err("SSH run identity changed".into());
    }
    let mut value: Value = serde_json::from_str(&raw).map_err(|_| "Invalid run metadata")?;
    value["sshExecution"] = serde_json::to_value(status).map_err(|_| "Invalid run metadata")?;
    value["status"] = json!(summary(status));
    if status.finished() {
        value["completedAt"] = json!(now_millis());
    }
    conn.execute(
        "UPDATE automation_runs SET run_json=?2 WHERE id=?1",
        params![
            status.run_id,
            serde_json::to_string(&value).map_err(|_| "Invalid run metadata")?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
static PROCESS_EPOCH: OnceLock<i64> = OnceLock::new();
/// Claims stamped no earlier than this process's epoch, so a live run never looks pre-restart.
fn claim_stamp() -> i64 {
    now_millis().max(*PROCESS_EPOCH.get_or_init(now_millis))
}
/// Only a run claimed by an earlier process can be dead; this process's own runs stay live.
fn claimed_before_process(conn: &Connection, id: &str) -> Result<bool, String> {
    let created: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM automation_runs WHERE id=?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(created.is_some_and(|created| created < *PROCESS_EPOCH.get_or_init(now_millis)))
}
pub(crate) fn recover_run(conn: &Connection, id: &str) -> Result<(), String> {
    if let Some(mut status) = read_run(conn, id)? {
        for target in &mut status.targets {
            if matches!(target.state, TargetState::Queued | TargetState::Running) {
                target.state = TargetState::Unknown;
                target.exit_code = None;
                target.reason = Some("interrupted_after_restart".into());
            }
        }
        update(conn, &status)?;
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Intent {
    pub id: String,
    pub automation_id: String,
    pub revision: u64,
    pub trigger: String,
    pub server_id: Option<String>,
    pub created_at: i64,
    pub status: String,
}
fn read_intent(conn: &Connection, id: &str) -> Result<Intent, String> {
    let raw: String = conn
        .query_row(
            "SELECT run_json FROM automation_runs WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|_| "SSH review intent no longer exists")?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Invalid SSH review intent")?;
    serde_json::from_value(
        value
            .get("sshIntent")
            .cloned()
            .ok_or("Not an SSH review intent")?,
    )
    .map_err(|_| "Invalid SSH review intent".into())
}
fn validate_intent(conn: &Connection, id: &str, profile: &Profile) -> Result<Intent, String> {
    let intent = read_intent(conn, id)?;
    if intent.status != "pendingReview"
        || intent.automation_id != profile.id
        || intent.revision != profile.revision
    {
        return Err("SSH review intent changed; dismiss it and request a fresh review".into());
    }
    Ok(intent)
}
fn write_intent(conn: &Connection, intent: &Intent, insert: bool) -> Result<(), String> {
    let value = json!({"id":intent.id,"automationId":intent.automation_id,"createdAt":intent.created_at,
        "trigger":intent.trigger,"scheduledFor":intent.created_at,"executor":"ssh",
        "status":if intent.status == "pendingReview" {"awaiting_review"} else {"cancelled"},"sshIntent":intent});
    let raw = serde_json::to_string(&value).map_err(|_| "Invalid SSH review intent")?;
    if insert {
        conn.execute(
            "INSERT INTO automation_runs(id,automation_id,created_at,run_json) VALUES(?1,?2,?3,?4)",
            params![intent.id, intent.automation_id, intent.created_at, raw],
        )
    } else {
        conn.execute(
            "UPDATE automation_runs SET run_json=?2 WHERE id=?1",
            params![intent.id, raw],
        )
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn create_intent(
    conn: &Connection,
    profile: &Profile,
    trigger: &str,
    server_id: Option<String>,
    now: i64,
) -> Result<Intent, String> {
    let existing:Option<String> = conn.query_row("SELECT id FROM automation_runs WHERE automation_id=?1 AND json_extract(run_json,'$.sshIntent.status')='pendingReview' AND json_extract(run_json,'$.sshIntent.revision')=?2 AND json_extract(run_json,'$.sshIntent.trigger')=?3 AND COALESCE(json_extract(run_json,'$.sshIntent.serverId'),'')=?4 LIMIT 1",
        params![profile.id,profile.revision as i64,trigger,server_id.as_deref().unwrap_or("")], |r|r.get(0)).optional().map_err(|e|e.to_string())?;
    if let Some(id) = existing {
        return read_intent(conn, &id);
    }
    let intent = Intent {
        id: uuid::Uuid::new_v4().to_string(),
        automation_id: profile.id.clone(),
        revision: profile.revision,
        trigger: trigger.into(),
        server_id,
        created_at: now,
        status: "pendingReview".into(),
    };
    write_intent(conn, &intent, true)?;
    Ok(intent)
}
fn pending_intents(conn: &Connection, now: i64) -> Result<Vec<Intent>, String> {
    let profiles = {
        let mut stmt=conn.prepare("SELECT definition_json FROM automations WHERE json_extract(definition_json,'$.executor')='ssh' AND COALESCE(json_extract(definition_json,'$.sshRunbookDeleted'),0)=0 LIMIT 256").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut profiles = Vec::new();
        for row in rows {
            profiles.push(profile_from(
                &serde_json::from_str::<Value>(&row.map_err(|e| e.to_string())?)
                    .map_err(|_| "Invalid runbook")?,
            )?);
        }
        profiles
    };
    for profile in profiles {
        if let Some(triggers) = &profile.triggers {
            if let (Some(minutes), Some(due)) = (triggers.interval_minutes, triggers.next_run_at) {
                if due <= now {
                    create_intent(conn, &profile, "scheduled", None, now)?;
                    let next = now.saturating_add(i64::from(minutes) * 60_000);
                    conn.execute("UPDATE automations SET definition_json=json_set(definition_json,'$.sshRunbook.triggers.nextRunAt',?2) WHERE id=?1 AND json_extract(definition_json,'$.sshRunbook.revision')=?3",
                        params![profile.id,next,profile.revision as i64]).map_err(|e|e.to_string())?;
                }
            }
        }
    }
    let mut stmt=conn.prepare("SELECT id FROM automation_runs WHERE json_extract(run_json,'$.sshIntent.status')='pendingReview' ORDER BY created_at DESC LIMIT 256").map_err(|e|e.to_string())?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    ids.map(|id| read_intent(conn, &id.map_err(|e| e.to_string())?))
        .collect()
}

struct DesktopPersistence {
    app: AppHandle,
    intent_id: Option<String>,
}
fn claim_with_intent(
    conn: &Connection,
    status: &RunStatus,
    intent_id: Option<&str>,
) -> Result<ClaimResult, String> {
    let mut intent = intent_id
        .map(|id| {
            let profile = get(conn, &status.automation_id)?;
            validate_intent(conn, id, &profile)
        })
        .transpose()?;
    let result = claim(conn, status)?;
    if matches!(result, ClaimResult::Claimed) {
        if let Some(intent) = &mut intent {
            intent.status = "consumed".into();
            write_intent(conn, intent, false)?;
        }
    }
    Ok(result)
}
impl RunPersistence for DesktopPersistence {
    fn claim(&self, status: &RunStatus) -> Result<ClaimResult, String> {
        let state = self.app.state::<SessionStore>();
        let mut conn = state.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let result = claim_with_intent(&tx, status, self.intent_id.as_deref())?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        let _ = self.app.emit(crate::automations::CHANGED, ());
        Ok(result)
    }
    fn update(&self, status: &RunStatus) -> Result<(), String> {
        let state = self.app.state::<SessionStore>();
        let conn = state.lock_conn()?;
        update(&conn, status)?;
        drop(conn);
        let _ = self.app.emit(crate::automations::CHANGED, ());
        Ok(())
    }
    fn load(&self, owner: &str, id: &str) -> Result<Option<RunStatus>, String> {
        load_run_with(&self.app.state::<SessionStore>(), owner, id)
    }
}
fn load_run_with(store: &SessionStore, owner: &str, id: &str) -> Result<Option<RunStatus>, String> {
    let conn = store.lock_conn()?;
    let found = read_run(&conn, id)?;
    if found.as_ref().is_some_and(|s| s.owner != owner) {
        return Err("Execution belongs to another native window".into());
    }
    if found.as_ref().is_some_and(|s| !s.finished()) && claimed_before_process(&conn, id)? {
        recover_run(&conn, id)?;
        return read_run(&conn, id);
    }
    Ok(found)
}
fn persistence(app: &AppHandle) -> Arc<dyn RunPersistence> {
    Arc::new(DesktopPersistence {
        app: app.clone(),
        intent_id: None,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetPreview {
    server_id: String,
    endpoint: crate::ssh_security::SshEndpoint,
    configuration: Option<crate::ssh_security::RuntimeConfiguration>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    review: ssh_execution::ExecutionReview,
    profile: Profile,
    targets: Vec<TargetPreview>,
}
fn resolve(
    app: &AppHandle,
    id: &str,
    revision: u64,
) -> Result<(Profile, Vec<ResolvedTarget>), String> {
    validate_id(id, "runbook")?;
    // Release SQLite before taking the canonical connection store: never invert
    // the store -> SQLite order used by group resolution.
    let profile = {
        let state = app.state::<SessionStore>();
        let conn = state.lock_conn()?;
        get(&conn, id)?
    };
    if profile.revision != revision {
        return Err("Runbook changed; reload before reviewing or starting".into());
    }
    let targets = profile
        .target_ids
        .iter()
        .map(|id| {
            Ok(ResolvedTarget {
                server_id: id.clone(),
                proxy_grant: None,
                endpoint: crate::server_inventory::resolve_ssh_endpoint(app, id)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok((profile, targets))
}
#[tauri::command(async)]
pub(crate) fn ssh_runbooks_list(store: State<'_, SessionStore>) -> Result<Vec<Profile>, String> {
    let conn = store.lock_conn()?;
    let mut stmt=conn.prepare("SELECT definition_json FROM automations WHERE json_extract(definition_json,'$.executor')='ssh' AND COALESCE(json_extract(definition_json,'$.sshRunbookDeleted'),0)=0 ORDER BY updated_at DESC,id LIMIT 257").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        let value: Value = serde_json::from_str(&row.map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid runbook")?;
        result.push(profile_from(&value)?);
    }
    if result.len() > 256 {
        return Err("Too many SSH runbooks".into());
    }
    Ok(result)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_save(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    profile: Profile,
    expected_revision: Option<u64>,
) -> Result<Profile, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        ssh_runbook_save_with(&store, profile, expected_revision, || {
            let _ = app.emit(crate::automations::CHANGED, ());
        })
    })
}

fn ssh_runbook_save_with(
    store: &SessionStore,
    profile: Profile,
    expected_revision: Option<u64>,
    notify: impl FnOnce(),
) -> Result<Profile, String> {
    let conn = store.lock_conn()?;
    let saved = save(&conn, &profile, expected_revision)?;
    drop(conn);
    notify();
    Ok(saved)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_remove(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    id: String,
    expected_revision: u64,
) -> Result<(), String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        ssh_runbook_remove_with(&store, id, expected_revision, || {
            let _ = app.emit(crate::automations::CHANGED, ());
        })
    })
}

fn ssh_runbook_remove_with(
    store: &SessionStore,
    id: String,
    expected_revision: u64,
    notify: impl FnOnce(),
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    remove(&tx, &id, expected_revision)?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    notify();
    Ok(())
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_preview(
    app: AppHandle,
    window: tauri::Window,
    reviews: State<'_, ssh_execution::SshExecutionReviews>,
    automation_id: String,
    expected_revision: u64,
    intent_id: Option<String>,
) -> Result<Preview, String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let (profile, targets) = resolve(&app, &automation_id, expected_revision)?;
    if let Some(id) = intent_id.as_deref() {
        validate_intent(&*app.state::<SessionStore>().lock_conn()?, id, &profile)?;
    }
    let review = owner_lease.with_live(|| {
        reviews.preview(
            window.label(),
            &profile.snapshot(),
            &targets,
            profile.limits,
        )
    })?;
    let targets = targets
        .into_iter()
        .map(|target| TargetPreview {
            server_id: target.server_id,
            configuration: target.endpoint.runtime_configuration.as_deref().cloned(),
            endpoint: target.endpoint,
        })
        .collect();
    Ok(Preview {
        review,
        profile,
        targets,
    })
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_start(
    app: AppHandle,
    window: tauri::Window,
    reviews: State<'_, ssh_execution::SshExecutionReviews>,
    executions: State<'_, Arc<ssh_execution::SshExecutions>>,
    credentials: State<'_, crate::ssh_http_proxy_credentials::HttpProxyCredentials>,
    automation_id: String,
    expected_revision: u64,
    review_id: String,
    run_id: String,
    intent_id: Option<String>,
    proxy_approvals: Option<Vec<ProxyApproval>>,
) -> Result<RunStatus, String> {
    let mut admission = Some(crate::native_window_lifecycle::admit_window_persistence(
        &window,
    )?);
    let result = (|| {
        let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
        validate_id(&run_id, "run")?;
        let (profile, mut targets) = resolve(&app, &automation_id, expected_revision)?;
        // Duplicate durable requests return metadata without consuming credentials again.
        let review_digest = ssh_execution::digest(&profile.snapshot(), &targets, profile.limits)?;
        if let Some(status) = existing_run(
            executions.inner().as_ref(),
            window.label(),
            &run_id,
            persistence(&app).as_ref(),
        )? {
            if status.automation_id != automation_id
                || status.revision != expected_revision
                || status.digest != review_digest
            {
                return Err("Run identifier belongs to another execution".into());
            }
            return Ok(status);
        }
        let mut seen = std::collections::HashSet::new();
        for approval in proxy_approvals.unwrap_or_default() {
            if !seen.insert(approval.server_id.clone()) {
                return Err("Duplicate target proxy approval".into());
            }
            let target = targets
                .iter_mut()
                .find(|t| t.server_id == approval.server_id)
                .ok_or("Unknown proxy approval target")?;
            let operation = crate::ssh_http_proxy_credentials::ProxyOperation::Runbook {
                run_id: run_id.clone(),
                automation_id: automation_id.clone(),
                revision: expected_revision,
                review_digest: review_digest.clone(),
                server_id: target.server_id.clone(),
            };
            target.proxy_grant = Some(Arc::new(credentials.consume(
                window.label(),
                &approval.ticket_id,
                Some(&target.server_id),
                &target.endpoint,
                &operation,
            )?));
        }
        if let Some(id) = intent_id.as_deref() {
            validate_intent(&*app.state::<SessionStore>().lock_conn()?, id, &profile)?;
        }
        owner_lease.with_live(|| {
            executions.inner().start(
                &reviews,
                window.label(),
                &review_id,
                run_id,
                profile.snapshot(),
                targets,
                profile.limits,
                Arc::new(DesktopPersistence {
                    app: app.clone(),
                    intent_id,
                }),
                admission
                    .take()
                    .ok_or("SSH persistence admission already transferred")?,
            )
        })
    })();
    match admission {
        Some(admission) => admission.finish(result),
        None => result, // The accepted engine owns the original admission through its workers.
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProxyApproval {
    server_id: String,
    ticket_id: String,
}

#[tauri::command(async)]
pub(crate) fn ssh_runbook_pending_intents(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
) -> Result<Vec<Intent>, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        let _ = app;
        ssh_runbook_pending_intents_with(&store, now_millis)
    })
}

fn ssh_runbook_pending_intents_with(
    store: &SessionStore,
    now: impl FnOnce() -> i64,
) -> Result<Vec<Intent>, String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let result = pending_intents(&tx, now())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    Ok(result)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_trigger_intent(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    automation_id: String,
    expected_revision: u64,
    server_id: String,
) -> Result<Intent, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        ssh_runbook_trigger_intent_with(&store, automation_id, expected_revision, server_id, || {
            let _ = app.emit(crate::automations::CHANGED, ());
        })
    })
}

fn ssh_runbook_trigger_intent_with(
    store: &SessionStore,
    automation_id: String,
    expected_revision: u64,
    server_id: String,
    notify: impl FnOnce(),
) -> Result<Intent, String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let profile = get(&tx, &automation_id)?;
    if profile.revision != expected_revision
        || !profile
            .triggers
            .as_ref()
            .is_some_and(|t| t.startup_server_ids.contains(&server_id))
    {
        return Err("Startup association changed; reload before requesting review".into());
    }
    let intent = create_intent(&tx, &profile, "startup", Some(server_id), now_millis())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    notify();
    Ok(intent)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_dismiss_intent(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    intent_id: String,
) -> Result<(), String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        ssh_runbook_dismiss_intent_with(&store, intent_id, || {
            let _ = app.emit(crate::automations::CHANGED, ());
        })
    })
}

fn ssh_runbook_dismiss_intent_with(
    store: &SessionStore,
    intent_id: String,
    notify: impl FnOnce(),
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut intent = read_intent(&tx, &intent_id)?;
    if intent.status != "pendingReview" {
        return Err("Review intent is no longer pending".into());
    }
    intent.status = "dismissed".into();
    write_intent(&tx, &intent, false)?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    notify();
    Ok(())
}
// Only a successful missing durable lookup can continue a fresh start. Errors
// preserve the original unknown/foreign-owner result before credentials are consumed.
fn existing_run(
    executions: &ssh_execution::SshExecutions,
    owner: &str,
    run_id: &str,
    persistence: &dyn RunPersistence,
) -> Result<Option<RunStatus>, String> {
    match executions.cached_status(owner, run_id)? {
        Some(status) => Ok(Some(status)),
        None => load_existing_run(persistence, owner, run_id),
    }
}

fn load_existing_run(
    persistence: &dyn RunPersistence,
    owner: &str,
    run_id: &str,
) -> Result<Option<RunStatus>, String> {
    let found = persistence.load(owner, run_id)?;
    if found
        .as_ref()
        .is_some_and(|status| status.owner != owner || status.run_id != run_id)
    {
        return Err("Execution belongs to another native window or run".into());
    }
    Ok(found)
}

fn status_with(
    executions: &ssh_execution::SshExecutions,
    owner: &str,
    run_id: &str,
    persistence: &dyn RunPersistence,
    admit: impl FnOnce() -> Result<crate::native_window_lifecycle::NativeWriteAdmission, String>,
) -> Result<RunStatus, String> {
    validate_id(run_id, "run")?;
    if let Some(status) = executions.cached_status(owner, run_id)? {
        return Ok(status); // Pure original-run control remains usable while admission is closed.
    }
    let admission = admit()?;
    admission.finish(
        load_existing_run(persistence, owner, run_id)
            .and_then(|found| found.ok_or_else(|| "Execution not found".into())),
    )
}

#[tauri::command(async)]
pub(crate) fn ssh_runbook_status(
    app: AppHandle,
    window: tauri::Window,
    executions: State<'_, Arc<ssh_execution::SshExecutions>>,
    run_id: String,
) -> Result<RunStatus, String> {
    status_with(
        executions.inner().as_ref(),
        window.label(),
        &run_id,
        persistence(&app).as_ref(),
        || crate::native_window_lifecycle::admit_window_persistence(&window),
    )
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_cancel(
    window: tauri::Window,
    executions: State<'_, Arc<ssh_execution::SshExecutions>>,
    run_id: String,
    server_id: Option<String>,
) -> Result<(), String> {
    validate_id(&run_id, "run")?;
    executions.cancel(window.label(), &run_id, server_id.as_deref())
}

#[tauri::command(async)]
pub(crate) fn ssh_runbook_abandon_missing(
    app: AppHandle,
    window: tauri::Window,
    store: State<'_, SessionStore>,
    run_id: String,
    automation_id: String,
    revision: u64,
) -> Result<(), String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        let lease = crate::ssh_window_lifecycle::capture(window.label())?;
        lease.with_live(|| {
            ssh_runbook_abandon_missing_with(
                &store,
                window.label(),
                &run_id,
                &automation_id,
                revision,
                || {
                    let _ = app.emit(crate::automations::CHANGED, ());
                },
            )
        })
    })
}

fn ssh_runbook_abandon_missing_with(
    store: &SessionStore,
    owner: &str,
    run_id: &str,
    automation_id: &str,
    revision: u64,
    notify: impl FnOnce(),
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    abandon_missing(&tx, owner, run_id, automation_id, revision)?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    notify();
    Ok(())
}

#[cfg(test)]
mod admission_tests;

#[cfg(test)]
pub(crate) fn test_claim_run(conn: &Connection, status: &RunStatus) -> Result<ClaimResult, String> {
    claim(conn, status)
}

#[cfg(test)]
pub(crate) fn test_save_runbook(conn: &Connection, profile: &Profile) -> Result<Profile, String> {
    save(conn, profile, None)
}

#[cfg(test)]
pub(crate) fn test_update_run(conn: &Connection, status: &RunStatus) -> Result<(), String> {
    update(conn, status)
}

#[cfg(test)]
pub(crate) fn test_read_run(conn: &Connection, id: &str) -> Result<Option<RunStatus>, String> {
    read_run(conn, id)
}

#[cfg(test)]
mod tests;
