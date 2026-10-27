//! Native process admission shares the execution Host's managed-workspace gate.
//! A lease is released only after confirmed child exit; uncertain exits stay fenced.
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(crate) struct Activity {
    app: AppHandle,
    host: crate::remote::NativeWorkspaceTransport,
    id: String,
    started: bool,
    settlement: ProcessSettlement,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSettlement {
    activity_id: String,
    client_id: Option<String>,
    session_id: Option<String>,
    cwd: String,
    kind: String,
    process_id: Option<u32>,
}

impl Activity {
    pub(crate) fn start(
        app: &AppHandle,
        cwd: &Path,
        kind: &str,
        session_id: Option<&str>,
    ) -> Result<Option<Self>, String> {
        Self::start_for_client(app, cwd, kind, session_id, None)
    }

    pub(crate) fn start_for_client(
        app: &AppHandle,
        cwd: &Path,
        kind: &str,
        session_id: Option<&str>,
        client_id: Option<&str>,
    ) -> Result<Option<Self>, String> {
        if !managed_path(app, cwd)? {
            return Ok(None);
        }
        if kind == "provider" {
            replay_settlements(app, session_id)?;
        }
        let capability = if kind == "provider" {
            "sessions.native-process-recovery.v1"
        } else {
            "workspaces.native-activity.v1"
        };
        let host = crate::remote::NativeWorkspaceTransport::connect(app, capability)?
            .with_client_id(client_id.map(str::to_owned))?;
        let id = uuid::Uuid::new_v4().to_string();
        let lease = host.call("native.activity.start", json!({"activityId":id,"cwd":crate::fs::path_to_js(cwd),"kind":kind,"sessionId":session_id}))?;
        if lease["activityId"] != id
            || !lease["workspaceId"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        {
            return Err("Execution Host did not admit managed workspace activity".into());
        }
        Ok(Some(Self {
            app: app.clone(),
            host,
            settlement: ProcessSettlement {
                activity_id: id.clone(),
                client_id: client_id.map(str::to_owned),
                session_id: session_id.map(str::to_owned),
                cwd: crate::fs::path_to_js(cwd),
                kind: kind.into(),
                process_id: None,
            },
            id,
            started: false,
        }))
    }
    pub(crate) fn started(&mut self) {
        self.started = true;
    }
    pub(crate) fn spawned(&mut self, process_id: u32) -> Result<(), String> {
        // An uncertain registration must not cause Drop to release a child
        // which may already exist. The spawn caller kills/waits it on failure.
        self.started = true;
        self.settlement.process_id = Some(process_id);
        let result = self.host.call(
            "native.activity.spawned",
            json!({"activityId":self.id,"processId":process_id,"desktopProcessId":std::process::id()}),
        )?;
        if result["acknowledged"] != true {
            return Err("Execution Host has not recorded native process identity".into());
        }
        Ok(())
    }
    pub(crate) fn settled(mut self) -> Result<(), String> {
        // Do not retry an unknown release from Drop. The durable Host lease stays
        // fenced unless this exact release receives its acknowledgement.
        self.started = true;
        // This method is called only after child.wait succeeded. Preserve that
        // exact exit proof before attempting a potentially unavailable Host.
        if self.settlement.process_id.is_some() {
            return settle_proved_exit(
                &self.app.state::<crate::session_store::SessionStore>(),
                &self.settlement,
                || {
                    self.host
                        .call("native.activity.end", json!({"activityId":self.id}))
                },
            );
        }
        let result = self
            .host
            .call("native.activity.end", json!({"activityId":self.id}))?;
        if result["acknowledged"] != true {
            return Err("Execution Host has not acknowledged native process exit".into());
        }
        Ok(())
    }
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

fn save_settlement(
    store: &crate::session_store::SessionStore,
    receipt: &ProcessSettlement,
) -> Result<String, String> {
    let raw = serde_json::to_string(receipt).map_err(|e| e.to_string())?;
    let conn = store.lock_conn()?;
    conn.execute("INSERT INTO native_workspace_settlements(activity_id,receipt_json) VALUES(?1,?2) ON CONFLICT(activity_id) DO NOTHING", rusqlite::params![receipt.activity_id,raw]).map_err(|e|e.to_string())?;
    let stored: String = conn
        .query_row(
            "SELECT receipt_json FROM native_workspace_settlements WHERE activity_id=?1",
            [&receipt.activity_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if stored != raw {
        return Err("Native exit settlement identity changed".into());
    }
    Ok(raw)
}

fn remove_settlement(
    store: &crate::session_store::SessionStore,
    id: &str,
    raw: &str,
) -> Result<(), String> {
    store
        .lock_conn()?
        .execute(
            "DELETE FROM native_workspace_settlements WHERE activity_id=?1 AND receipt_json=?2",
            rusqlite::params![id, raw],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn settle_proved_exit(
    store: &crate::session_store::SessionStore,
    receipt: &ProcessSettlement,
    settle: impl FnOnce() -> Result<serde_json::Value, String>,
) -> Result<(), String> {
    let raw = save_settlement(store, receipt)?;
    if settle()?["acknowledged"] != true {
        return Err("Host has not acknowledged the pending native process exit".into());
    }
    remove_settlement(store, &receipt.activity_id, &raw)
}

fn replay_proved_settlements(
    store: &crate::session_store::SessionStore,
    session_id: Option<&str>,
    mut settle: impl FnMut(&ProcessSettlement) -> Result<serde_json::Value, String>,
) -> Result<Vec<String>, String> {
    let receipts = {
        let conn = store.lock_conn()?;
        let mut query = conn.prepare("SELECT activity_id,receipt_json FROM native_workspace_settlements ORDER BY activity_id").map_err(|e|e.to_string())?;
        let rows = query
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    let mut acknowledged = vec![];
    for (id, raw) in receipts {
        let receipt: ProcessSettlement = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if session_id.is_some_and(|id| receipt.session_id.as_deref() != Some(id)) {
            continue;
        }
        if receipt.activity_id != id || receipt.process_id.is_none_or(|pid| pid == 0) {
            return Err("Native exit settlement has no matching process identity".into());
        }
        if settle(&receipt)?["acknowledged"] != true {
            return Err("Host has not acknowledged the pending native process exit".into());
        }
        remove_settlement(store, &id, &raw)?;
        acknowledged.push(id);
    }
    Ok(acknowledged)
}

pub(crate) fn replay_settlements(app: &AppHandle, session_id: Option<&str>) -> Result<(), String> {
    replay_proved_settlements(
        &app.state::<crate::session_store::SessionStore>(),
        session_id,
        |receipt| {
            let host = crate::remote::NativeWorkspaceTransport::connect(
                app,
                "workspaces.native-activity.v1",
            )?
            .with_client_id(receipt.client_id.clone())?;
            let result = host.call(
                "native.activity.end",
                json!({"activityId":receipt.activity_id}),
            )?;
            if result["acknowledged"] == true {
                if let Some(host) = app.try_state::<crate::harness::HarnessHost>() {
                host.acknowledge_managed_settlements(std::slice::from_ref(&receipt.activity_id));
                }
            }
            Ok(result)
        },
    )?;
    Ok(())
}

impl Drop for Activity {
    fn drop(&mut self) {
        if !self.started {
            let _ = self
                .host
                .call("native.activity.end", json!({"activityId":self.id}));
        }
    }
}

fn managed_path(app: &AppHandle, cwd: &Path) -> Result<bool, String> {
    let (managed, legacy) =
        if let Some(store) = app.try_state::<crate::session_store::SessionStore>() {
            (
                store.managed_workspace_paths()?,
                store.legacy_workspace_paths()?,
            )
        } else {
            (vec![], vec![])
        };
    requires_host_activity(cwd, &managed, &legacy)
}

fn requires_host_activity(
    cwd: &Path,
    managed: &[String],
    legacy: &[String],
) -> Result<bool, String> {
    if managed
        .iter()
        .any(|path| crate::worktrees::contains_working_dir(Path::new(path), cwd))
    {
        return Ok(true);
    }
    for ancestor in cwd.ancestors() {
        match std::fs::symlink_metadata(ancestor.join(".git")) {
            Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {
                let reserved = ancestor
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.strip_prefix("wt-").is_some_and(|id| {
                            id.len() == 12 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
                        })
                    });
                if reserved {
                    return Ok(true);
                }
                // An existing explicitly legacy conversation retains its execution mode.
                // A managed branch/persisted identity always tightens that decision.
                if legacy
                    .iter()
                    .any(|path| crate::worktrees::contains_working_dir(ancestor, Path::new(path)))
                {
                    let mut command = std::process::Command::new("git");
                    command
                        .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
                        .current_dir(ancestor);
                    crate::harness::prepare_gui_child(&mut command);
                    if let Ok(output) = command.output() {
                        if output.status.success() {
                            let branch = String::from_utf8_lossy(&output.stdout);
                            return Ok(branch.trim().starts_with("bycoda/s/")
                                || branch.trim().starts_with("bycoda/t/"));
                        }
                    }
                }
                // New, detached or otherwise ambiguous linked checkouts require Host admission.
                return Ok(true);
            }
            Ok(_) => return Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Workspace ownership could not be verified: {error}"
                ))
            }
        }
    }
    Ok(false)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BufferState {
    path: String,
    dirty: bool,
}

static INSTANCE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

static BUFFER_REPORT_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn ensure_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_workspace_buffers (
        owner_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0);
        UPDATE native_workspace_buffers SET confirmed=0;
        CREATE TABLE IF NOT EXISTS native_workspace_settlements (
        activity_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL);",
    )
}

#[tauri::command(async)]
pub fn managed_workspace_buffers(
    app: AppHandle,
    window: tauri::Window,
    store: tauri::State<'_, crate::session_store::SessionStore>,
    buffers: Vec<BufferState>,
) -> Result<(), String> {
    let _gate = BUFFER_REPORT_GATE
        .lock()
        .map_err(|_| "Native buffer report is locked")?;
    if buffers.len() > 10000 {
        return Err("Too many open buffers".into());
    }
    let mut normalized = Vec::with_capacity(buffers.len());
    for buffer in buffers {
        let path = crate::fs::expand_home(&buffer.path);
        if !path.is_absolute() || buffer.path.contains('\0') {
            return Err("Buffer path must be absolute".into());
        }
        normalized.push(BufferState {
            path: crate::fs::path_to_js(&path),
            dirty: buffer.dirty,
        });
    }
    let raw = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
    let now = now_millis();
    store.lock_conn()?.execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES(?1,?2,?3,0)
        ON CONFLICT(owner_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,confirmed=0",
        rusqlite::params![window.label(),raw,now]).map_err(|e|e.to_string())?;
    let host =
        crate::remote::NativeWorkspaceTransport::connect(&app, "workspaces.native-activity.v1")?;
    let owners = {
        let conn = store.lock_conn()?;
        let mut statement = conn.prepare("SELECT owner_id,snapshot_json,updated_at,confirmed FROM native_workspace_buffers ORDER BY owner_id").map_err(|e|e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut owners = Vec::new();
        for row in rows {
            let (owner, snapshot, updated, confirmed) = row.map_err(|e| e.to_string())?;
            let buffers: serde_json::Value =
                serde_json::from_str(&snapshot).map_err(|e| e.to_string())?;
            owners.push(json!({"ownerId":owner,"buffers":buffers,"updatedAt":updated,"unknown":owner != window.label() && (!confirmed || now.saturating_sub(updated)>45000)}));
        }
        owners
    };
    // Authenticated complete snapshot includes every window; no renderer-supplied owner identifier.
    use sha2::{Digest, Sha256};
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let client_id = format!(
        "{:x}",
        Sha256::digest(crate::fs::path_to_js(&profile).as_bytes())
    );
    let instance_id = INSTANCE.get_or_init(|| uuid::Uuid::new_v4().to_string());
    let response = host.call("native.buffers.update", json!({"clientId":client_id,"instanceId":instance_id,"processId":std::process::id(),"owners":owners}))?;
    if response["acknowledged"] != true {
        return Err("Host has not acknowledged native buffer state".into());
    }
    // This bridge selects only the local-sync Host, which independently proves
    // predecessor process death before retiring any clean same-profile report.
    // Dirty/unknown reports keep their explicit recovery fence.
    host.call(
        "native.buffers.reconcile",
        json!({"clientId":client_id,"instanceId":instance_id,"predecessors":[]}),
    )?;
    store
        .lock_conn()?
        .execute(
            "UPDATE native_workspace_buffers SET confirmed=1 WHERE owner_id=?1 AND updated_at=?2",
            rusqlite::params![window.label(), now],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Called before the local transport shuts down. Failure preserves the report;
/// the next instance can reconcile only clean state after OS-proven process exit.
pub(crate) fn retire_buffers(app: &AppHandle) -> Result<(), String> {
    let Some(instance_id) = INSTANCE.get() else {
        return Ok(());
    };
    let _gate = BUFFER_REPORT_GATE
        .lock()
        .map_err(|_| "Native buffer report is locked")?;
    use sha2::{Digest, Sha256};
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let client_id = format!(
        "{:x}",
        Sha256::digest(crate::fs::path_to_js(&profile).as_bytes())
    );
    let host =
        crate::remote::NativeWorkspaceTransport::connect(app, "workspaces.native-activity.v1")?;
    let response = host.call(
        "native.buffers.retire",
        json!({"clientId":client_id,"instanceId":instance_id,"processId":std::process::id()}),
    )?;
    if response["acknowledged"] != true {
        return Err("Host has not acknowledged native buffer retirement".into());
    }
    Ok(())
}

pub(crate) fn assert_buffers_settled(
    store: &crate::session_store::SessionStore,
    root: &Path,
) -> Result<(), String> {
    let conn = store.lock_conn()?;
    let mut statement = conn
        .prepare("SELECT snapshot_json,updated_at,confirmed FROM native_workspace_buffers")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, bool>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut any_owner = false;
    for row in rows {
        any_owner = true;
        let (raw, updated, confirmed) = row.map_err(|e| e.to_string())?;
        if !confirmed || now_millis().saturating_sub(updated) > 45000 {
            return Err(
                "Workspace editor state is unknown; reconnect and wait for a fresh buffer report"
                    .into(),
            );
        }
        let buffers: Vec<BufferState> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        for buffer in buffers {
            if crate::worktrees::contains_working_dir(root, Path::new(&buffer.path)) && buffer.dirty
            {
                return Err(
                    "Save or close workspace buffers and reconnect before changing workspace files"
                        .into(),
                );
            }
        }
    }
    if !any_owner {
        return Err("Workspace editor state is unknown; wait for the first buffer report".into());
    }
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_settlement_replays_proved_exit_after_host_outage_and_desktop_restart() {
        let path =
            std::env::temp_dir().join(format!("native-settlement-{}.db", uuid::Uuid::new_v4()));
        let receipt = ProcessSettlement {
            activity_id: "owned-activity".into(),
            client_id: Some("original-desktop".into()),
            session_id: Some("managed-session".into()),
            cwd: "/isolated/repo".into(),
            kind: "provider".into(),
            process_id: Some(42),
        };
        {
            let store = crate::session_store::SessionStore::open(path.clone()).unwrap();
            // Represents the actual post-child.wait branch: both registration
            // acknowledgement and the first native.activity.end can be lost.
            assert!(settle_proved_exit(&store, &receipt, || Err(
                "Host offline after child exit".into()
            ))
            .is_err());
            assert!(
                replay_proved_settlements(&store, None, |_| Ok(json!({"acknowledged":false})))
                    .is_err()
            );
            let mut changed = receipt.clone();
            changed.process_id = Some(99);
            assert!(save_settlement(&store, &changed)
                .unwrap_err()
                .contains("identity changed"));
        }
        {
            let store = crate::session_store::SessionStore::open(path.clone()).unwrap();
            assert!(
                replay_proved_settlements(&store, Some("another-session"), |_| panic!(
                    "foreign session replayed"
                ))
                .unwrap()
                .is_empty()
            );
            let mut calls = 0;
            let acknowledged =
                replay_proved_settlements(&store, Some("managed-session"), |pending| {
                    calls += 1;
                    assert_eq!(pending.activity_id, receipt.activity_id);
                    assert_eq!(pending.client_id, receipt.client_id);
                    assert_eq!(pending.process_id, receipt.process_id);
                    Ok(json!({"acknowledged":true}))
                })
                .unwrap();
            assert_eq!(calls, 1);
            assert_eq!(acknowledged, ["owned-activity"]);
            assert!(replay_proved_settlements(&store, None, |_| panic!(
                "acknowledged exit replayed twice"
            ))
            .unwrap()
            .is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn worktree_activity_preserves_known_legacy_and_fences_ambiguous_or_managed_paths() {
        let root = std::env::temp_dir().join(format!("native-activity-{}", uuid::Uuid::new_v4()));
        let repo = root.join("repo");
        let linked = root.join("linked");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |cwd: &Path, args: &[&str]| {
            let mut command = std::process::Command::new("git");
            command.args(args).current_dir(cwd);
            crate::harness::prepare_gui_child(&mut command);
            assert!(command.output().unwrap().status.success());
        };
        git(&repo, &["init", "-b", "main"]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "init",
            ],
        );
        git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "legacy",
                &crate::fs::path_to_js(&linked),
            ],
        );
        let legacy = vec![crate::fs::path_to_js(&linked)];
        assert!(!requires_host_activity(&repo, &[], &[]).unwrap());
        assert!(requires_host_activity(&linked, &[], &[]).unwrap());
        assert!(!requires_host_activity(&linked, &[], &legacy).unwrap());
        assert!(requires_host_activity(&linked, &legacy, &legacy).unwrap());
        git(&linked, &["branch", "-m", "bycoda/s/managed"]);
        assert!(requires_host_activity(&linked, &[], &legacy).unwrap());
        git(&linked, &["branch", "-m", "legacy"]);
        git(&linked, &["checkout", "--detach"]);
        assert!(requires_host_activity(&linked, &[], &legacy).unwrap());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn session_workspace_buffers_require_fresh_ack_after_restart() {
        let path =
            std::env::temp_dir().join(format!("native-buffer-restart-{}.db", uuid::Uuid::new_v4()));
        {
            let store = crate::session_store::SessionStore::open(path.clone()).unwrap();
            store.lock_conn().unwrap().execute("INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES('main','[]',?1,1)", [now_millis()]).unwrap();
            assert!(assert_buffers_settled(&store, Path::new("C:/fixture")).is_ok());
        }
        {
            let store = crate::session_store::SessionStore::open(path.clone()).unwrap();
            assert!(assert_buffers_settled(&store, Path::new("C:/fixture")).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn session_workspace_buffers_block_dirty_stale_and_unacknowledged_reports() {
        let store = crate::session_store::SessionStore::open_in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("native-buffers-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("file.ts");
        std::fs::write(&path, "retained").unwrap();
        assert!(assert_buffers_settled(&store, &root).is_err());
        let insert = |dirty: bool, confirmed: bool, age: i64| {
            store.lock_conn().unwrap().execute("INSERT OR REPLACE INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES('main',?1,?2,?3)",
                rusqlite::params![json!([{"path":crate::fs::path_to_js(&path),"dirty":dirty}]).to_string(),now_millis()-age,confirmed]).unwrap();
        };
        insert(false, true, 0);
        assert!(assert_buffers_settled(&store, &root).is_ok());
        insert(true, true, 0);
        assert!(assert_buffers_settled(&store, &root).is_err());
        insert(false, false, 0);
        assert!(assert_buffers_settled(&store, &root).is_err());
        insert(false, true, 60000);
        assert!(assert_buffers_settled(&store, &root).is_err());
        insert(true, true, 0);
        assert!(assert_buffers_settled(&store, &root.join("sibling")).is_ok());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
