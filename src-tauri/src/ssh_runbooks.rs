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
use std::sync::Arc;
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
    raw.map(|raw| decode_run(&raw)).transpose()
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
    let now = now_millis();
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
        let state = self.app.state::<SessionStore>();
        let conn = state.lock_conn()?;
        let found = read_run(&conn, id)?;
        if found.as_ref().is_some_and(|s| s.owner != owner) {
            return Err("Execution belongs to another native window".into());
        }
        if found.as_ref().is_some_and(|s| !s.finished()) {
            recover_run(&conn, id)?;
            return read_run(&conn, id);
        }
        Ok(found)
    }
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
    store: State<'_, SessionStore>,
    profile: Profile,
    expected_revision: Option<u64>,
) -> Result<Profile, String> {
    let conn = store.lock_conn()?;
    let saved = save(&conn, &profile, expected_revision)?;
    drop(conn);
    let _ = app.emit(crate::automations::CHANGED, ());
    Ok(saved)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_remove(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    expected_revision: u64,
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    remove(&tx, &id, expected_revision)?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    let _ = app.emit(crate::automations::CHANGED, ());
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
#[allow(clippy::too_many_arguments)] // Tauri injects state alongside the established command arguments.
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
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    validate_id(&run_id, "run")?;
    let (profile, mut targets) = resolve(&app, &automation_id, expected_revision)?;
    // Duplicate durable requests return metadata without consuming credentials again.
    let review_digest = ssh_execution::digest(&profile.snapshot(), &targets, profile.limits)?;
    if let Ok(status) = executions.status(window.label(), &run_id, persistence(&app).as_ref()) {
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
        )
    })
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
    store: State<'_, SessionStore>,
) -> Result<Vec<Intent>, String> {
    let mut conn = store.lock_conn()?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let result = pending_intents(&tx, now_millis())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    let _ = app;
    Ok(result)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_trigger_intent(
    app: AppHandle,
    store: State<'_, SessionStore>,
    automation_id: String,
    expected_revision: u64,
    server_id: String,
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
    let _ = app.emit(crate::automations::CHANGED, ());
    Ok(intent)
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_dismiss_intent(
    app: AppHandle,
    store: State<'_, SessionStore>,
    intent_id: String,
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
    let _ = app.emit(crate::automations::CHANGED, ());
    Ok(())
}
#[tauri::command(async)]
pub(crate) fn ssh_runbook_status(
    app: AppHandle,
    window: tauri::Window,
    executions: State<'_, Arc<ssh_execution::SshExecutions>>,
    run_id: String,
) -> Result<RunStatus, String> {
    validate_id(&run_id, "run")?;
    executions.status(window.label(), &run_id, persistence(&app).as_ref())
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
    let lease = crate::ssh_window_lifecycle::capture(window.label())?;
    lease.with_live(|| {
        let mut conn = store.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        abandon_missing(&tx, window.label(), &run_id, &automation_id, revision)?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        let _ = app.emit(crate::automations::CHANGED, ());
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::automations::ensure_tables(&conn).unwrap();
        conn
    }
    fn draft() -> Profile {
        Profile {
            triggers: None,
            id: "book-one".into(),
            name: "Owned runbook".into(),
            revision: 0,
            script: "printf 'RUNBOOK_BODY_NEVER_IN_RUN_METADATA'\n".into(),
            shell: RemoteShellKind::Posix,
            target_ids: vec!["server-one".into(), "server-two".into()],
            limits: ExecutionLimits {
                concurrency: 2,
                timeout_seconds: 10,
            },
        }
    }
    fn status(book: &Profile, id: &str) -> RunStatus {
        RunStatus {
            run_id: id.into(),
            automation_id: book.id.clone(),
            revision: book.revision,
            owner: "main".into(),
            digest: "a".repeat(64),
            targets: book
                .target_ids
                .iter()
                .map(|id| ssh_execution::TargetOutcome {
                    server_id: id.clone(),
                    state: TargetState::Queued,
                    exit_code: None,
                    reason: None,
                })
                .collect(),
        }
    }
    fn claim_transaction(conn: &mut Connection, status: &RunStatus) -> Result<ClaimResult, String> {
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        let result = claim(&tx, status)?;
        tx.commit().unwrap();
        Ok(result)
    }
    #[test]
    fn existing_table_cas_preserves_unknown_metadata_and_manual_only_policy() {
        let conn = database();
        let first = save(&conn, &draft(), None).unwrap();
        assert_eq!(first.revision, 1);
        let mut value = definition(&conn, &first.id).unwrap().unwrap();
        value["future"] = json!({"otherSession":"preserved"});
        conn.execute(
            "UPDATE automations SET definition_json=?2 WHERE id=?1",
            params![first.id, serde_json::to_string(&value).unwrap()],
        )
        .unwrap();
        let mut edit = first.clone();
        edit.name = "Changed".into();
        let second = save(&conn, &edit, Some(1)).unwrap();
        assert_eq!(second.revision, 2);
        assert!(save(&conn, &edit, Some(1)).is_err());
        let value = definition(&conn, &first.id).unwrap().unwrap();
        assert_eq!(value["future"]["otherSession"], "preserved");
        assert_eq!(value["enabled"], false);
        assert_eq!(value["nextRunAt"], 0);
        assert_eq!(value["triggers"], json!([]));
        assert!(serde_json::from_value::<crate::automations::Automation>(value).is_ok());
        assert_eq!(get(&conn, &first.id).unwrap(), second);
        conn.execute("INSERT INTO automations VALUES('agent-id','{\"id\":\"agent-id\",\"name\":\"Existing agent\"}',0,0,0)",[]).unwrap();
        let mut agent_collision = draft();
        agent_collision.id = "agent-id".into();
        assert!(save(&conn, &agent_collision, None).is_err());
        assert_eq!(
            definition(&conn, "agent-id").unwrap().unwrap()["name"],
            "Existing agent"
        );
    }
    #[test]
    fn claims_are_atomic_metadata_only_and_duplicate_status_never_replays() {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        let initial = status(&book, "run-one");
        assert!(matches!(
            claim_transaction(&mut conn, &initial).unwrap(),
            ClaimResult::Claimed
        ));
        assert!(
            matches!(claim_transaction(&mut conn,&initial).unwrap(),ClaimResult::Existing(found) if found==initial)
        );
        let raw: String = conn
            .query_row("SELECT run_json FROM automation_runs", [], |r| r.get(0))
            .unwrap();
        assert!(!raw.contains("RUNBOOK_BODY_NEVER_IN_RUN_METADATA"));
        assert!(!raw.contains("prompt"));
        assert!(!raw.contains("stdout"));
        assert!(serde_json::from_str::<crate::automations::AutomationRun>(&raw).is_ok());
        assert!(ensure_not_active(&conn, &book.id).is_err());
        let mut wrong = initial.clone();
        wrong.owner = "another-window".into();
        assert!(update(&conn, &wrong).is_err());
        let mut complete = initial;
        for target in &mut complete.targets {
            target.state = TargetState::Exited;
            target.exit_code = Some(0);
        }
        update(&conn, &complete).unwrap();
        ensure_not_active(&conn, &book.id).unwrap();
        assert_eq!(read_run(&conn, "run-one").unwrap().unwrap(), complete);
    }
    #[test]
    fn stale_revision_or_failed_insert_rolls_back_claim_without_execution_authority() {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        let mut stale = status(&book, "stale-run");
        stale.revision += 1;
        assert!(claim_transaction(&mut conn, &stale).is_err());
        conn.execute_batch("CREATE TRIGGER deny_run BEFORE INSERT ON automation_runs BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;").unwrap();
        assert!(claim_transaction(&mut conn, &status(&book, "failed-run")).is_err());
        let count: i64 = conn
            .query_row("SELECT count(*) FROM automation_event_claims", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
    #[test]
    fn recovery_settles_unknown_and_deletion_keeps_non_replay_identity_without_script() {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        let initial = status(&book, "owned-run");
        claim_transaction(&mut conn, &initial).unwrap();
        assert!(remove(&conn, &book.id, book.revision).is_err());
        recover_run(&conn, "owned-run").unwrap();
        let recovered = read_run(&conn, "owned-run").unwrap().unwrap();
        assert!(recovered.finished());
        assert!(recovered
            .targets
            .iter()
            .all(|t| t.state == TargetState::Unknown
                && t.reason.as_deref() == Some("interrupted_after_restart")));
        assert!(
            matches!(claim_transaction(&mut conn,&initial).unwrap(),ClaimResult::Existing(found) if found==recovered)
        );
        conn.execute("DELETE FROM automation_runs WHERE id='owned-run'", [])
            .unwrap();
        assert!(claim_transaction(&mut conn, &initial).is_err());
        remove(&conn, &book.id, book.revision).unwrap();
        assert!(get(&conn, &book.id).is_err());
        assert!(save(&conn, &draft(), None).is_err());
        let value = definition(&conn, &book.id).unwrap().unwrap();
        assert_eq!(value["sshRunbookDeleted"], true);
        assert!(value.get("sshRunbook").is_none());
        assert!(!serde_json::to_string(&value)
            .unwrap()
            .contains("RUNBOOK_BODY_NEVER_IN_RUN_METADATA"));
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM automation_event_claims WHERE event_key='ssh-run:owned-run'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    #[test]
    fn global_run_claim_survives_trim_and_blocks_reuse_by_another_runbook() {
        let mut conn = database();
        let one = save(&conn, &draft(), None).unwrap();
        claim_transaction(&mut conn, &status(&one, "global-run")).unwrap();
        recover_run(&conn, "global-run").unwrap();
        conn.execute("DELETE FROM automation_runs WHERE id='global-run'", [])
            .unwrap();
        let mut second = draft();
        second.id = "book-two".into();
        let second = save(&conn, &second, None).unwrap();
        assert!(claim_transaction(&mut conn, &status(&second, "global-run")).is_err());
    }
    #[test]
    fn bounded_targets_scripts_and_collection_prevent_ambiguous_or_unbounded_saves() {
        let conn = database();
        let mut invalid = draft();
        invalid.target_ids.push(invalid.target_ids[0].clone());
        assert!(save(&conn, &invalid, None).is_err());
        invalid = draft();
        invalid.script = "-----BEGIN OPENSSH PRIVATE KEY-----".into();
        assert!(save(&conn, &invalid, None).is_err());
        invalid = draft();
        invalid.script = "x".repeat(65537);
        assert!(save(&conn, &invalid, None).is_err());
        invalid = draft();
        invalid.limits.concurrency = 5;
        assert!(save(&conn, &invalid, None).is_err());
        for index in 0..256 {
            let mut book = draft();
            book.id = format!("book-{index}");
            save(&conn, &book, None).unwrap();
        }
        assert!(save(&conn, &draft(), None).is_err());
    }
    #[test]
    fn schedules_materialize_one_metadata_only_review_and_never_claim_execution() {
        let conn = database();
        let mut draft = draft();
        draft.triggers = Some(Triggers {
            startup_server_ids: vec!["server-one".into()],
            interval_minutes: Some(5),
            next_run_at: Some(1),
        });
        let book = save(&conn, &draft, None).unwrap();
        let due = book.triggers.as_ref().unwrap().next_run_at.unwrap();
        assert!(due > 1);
        assert!(pending_intents(&conn, due - 1).unwrap().is_empty());
        let first = pending_intents(&conn, due).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].status, "pendingReview");
        assert_eq!(
            pending_intents(&conn, due + 600_000).unwrap()[0].id,
            first[0].id
        );
        let claims: i64 = conn
            .query_row("SELECT count(*) FROM automation_event_claims", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(claims, 0);
        let raw: String = conn
            .query_row("SELECT run_json FROM automation_runs", [], |r| r.get(0))
            .unwrap();
        assert!(!raw.contains("RUNBOOK_BODY"));
        assert!(!raw.contains("sshExecution"));
        let mut edited = get(&conn, &book.id).unwrap();
        edited.name = "Renamed".into();
        let saved = save(&conn, &edited, Some(book.revision)).unwrap();
        assert_eq!(
            saved.triggers.as_ref().unwrap().next_run_at,
            edited.triggers.as_ref().unwrap().next_run_at
        );
        assert!(validate_intent(&conn, &first[0].id, &saved).is_err());
    }
    #[test]
    fn review_intent_and_durable_run_claim_commit_together_and_cannot_replay() {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        let intent =
            create_intent(&conn, &book, "startup", Some("server-one".into()), 100).unwrap();
        assert_eq!(
            create_intent(&conn, &book, "startup", Some("server-one".into()), 101)
                .unwrap()
                .id,
            intent.id
        );
        let initial = status(&book, "intent-run");
        {
            let tx = conn.transaction().unwrap();
            assert!(matches!(
                claim_with_intent(&tx, &initial, Some(&intent.id)).unwrap(),
                ClaimResult::Claimed
            ));
            // Dropping the transaction must restore pending review and remove the run claim.
        }
        assert_eq!(
            read_intent(&conn, &intent.id).unwrap().status,
            "pendingReview"
        );
        assert!(read_run(&conn, "intent-run").unwrap().is_none());
        let tx = conn.transaction().unwrap();
        claim_with_intent(&tx, &initial, Some(&intent.id)).unwrap();
        tx.commit().unwrap();
        assert_eq!(read_intent(&conn, &intent.id).unwrap().status, "consumed");
        assert!(claim_with_intent(&conn, &status(&book, "second-run"), Some(&intent.id)).is_err());
        assert!(read_run(&conn, "second-run").unwrap().is_none());
    }
    #[test]
    fn trigger_associations_are_explicit_unique_and_cannot_target_other_servers() {
        let conn = database();
        let mut draft = draft();
        draft.triggers = Some(Triggers {
            startup_server_ids: vec!["unrelated".into()],
            ..Default::default()
        });
        assert!(save(&conn, &draft, None).is_err());
        draft.triggers.as_mut().unwrap().startup_server_ids =
            vec!["server-one".into(), "server-one".into()];
        assert!(save(&conn, &draft, None).is_err());
        draft.triggers.as_mut().unwrap().startup_server_ids.clear();
        draft.triggers.as_mut().unwrap().interval_minutes = Some(0);
        assert!(save(&conn, &draft, None).is_err());
    }
    #[test]
    fn explicit_abandon_after_preclaim_rejection_blocks_late_start_and_allows_fresh_review_identity(
    ) {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        let old = status(&book, "rejected-start");
        let mut edited = book.clone();
        edited.name = "Changed concurrently".into();
        let current = save(&conn, &edited, Some(book.revision)).unwrap();
        assert!(claim_transaction(&mut conn, &old).is_err());
        {
            let tx = conn.transaction().unwrap();
            abandon_missing(&tx, "main", &old.run_id, &book.id, book.revision).unwrap();
            tx.commit().unwrap();
        }
        assert!(read_run(&conn, &old.run_id).unwrap().is_none());
        // The late native command cannot acquire the original run ID, even if it
        // has already resolved a now-current profile and a fresh review ticket.
        let late = status(&current, &old.run_id);
        assert!(claim_transaction(&mut conn, &late).is_err());
        assert!(matches!(
            claim_transaction(&mut conn, &status(&current, "explicit-fresh-start")).unwrap(),
            ClaimResult::Claimed
        ));
    }
    #[test]
    fn abandonment_is_owner_and_origin_bound_and_rejects_claimed_or_trimmed_runs() {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        {
            let tx = conn.transaction().unwrap();
            abandon_missing(&tx, "main", "missing-one", &book.id, book.revision).unwrap();
            tx.commit().unwrap();
        }
        assert!(abandon_missing(&conn, "main", "missing-one", &book.id, book.revision).is_ok());
        assert!(abandon_missing(&conn, "foreign", "missing-one", &book.id, book.revision).is_err());
        assert!(
            abandon_missing(&conn, "main", "missing-one", &book.id, book.revision + 1).is_err()
        );
        let mut other = draft();
        other.id = "other-book".into();
        let other = save(&conn, &other, None).unwrap();
        assert!(abandon_missing(&conn, "main", "missing-one", &other.id, other.revision).is_err());
        let run = status(&book, "claimed-one");
        claim_transaction(&mut conn, &run).unwrap();
        assert!(abandon_missing(&conn, "main", &run.run_id, &book.id, book.revision).is_err());
        recover_run(&conn, &run.run_id).unwrap();
        conn.execute("DELETE FROM automation_runs WHERE id=?1", [&run.run_id])
            .unwrap();
        assert!(abandon_missing(&conn, "main", &run.run_id, &book.id, book.revision).is_err());
    }
    #[test]
    fn abandonment_marker_and_no_replay_claim_roll_back_together() {
        let mut conn = database();
        let book = save(&conn, &draft(), None).unwrap();
        {
            let tx = conn.transaction().unwrap();
            abandon_missing(&tx, "main", "rolled-back", &book.id, book.revision).unwrap();
        }
        assert!(matches!(
            claim_transaction(&mut conn, &status(&book, "rolled-back")).unwrap(),
            ClaimResult::Claimed
        ));
    }
}
