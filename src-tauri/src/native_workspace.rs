//! Native process admission shares the execution Host's managed-workspace gate.
//! A lease is released only after confirmed child exit; uncertain exits stay fenced.
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(crate) struct Activity {
    host: crate::remote::NativeWorkspaceTransport,
    id: String,
    started: bool,
}

impl Activity {
    pub(crate) fn start(
        app: &AppHandle,
        cwd: &Path,
        kind: &str,
        session_id: Option<&str>,
    ) -> Result<Option<Self>, String> {
        if !managed_path(app, cwd)? {
            return Ok(None);
        }
        let host =
            crate::remote::NativeWorkspaceTransport::connect(app, "workspaces.native-activity.v1")?;
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
            host,
            id,
            started: false,
        }))
    }
    pub(crate) fn started(&mut self) {
        self.started = true;
    }
    pub(crate) fn settled(mut self) {
        self.started = false;
        // Drop performs the single explicit release. Failure retains Host's durable lease.
    }
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

static BUFFER_REPORT_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn ensure_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_workspace_buffers (
        owner_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0);
        UPDATE native_workspace_buffers SET confirmed=0;",
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
    static INSTANCE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    let instance_id = INSTANCE.get_or_init(|| uuid::Uuid::new_v4().to_string());
    let response = host.call("native.buffers.update", json!({"clientId":client_id,"instanceId":instance_id,"processId":std::process::id(),"owners":owners}))?;
    if response["acknowledged"] != true {
        return Err("Host has not acknowledged native buffer state".into());
    }
    store
        .lock_conn()?
        .execute(
            "UPDATE native_workspace_buffers SET confirmed=1 WHERE owner_id=?1 AND updated_at=?2",
            rusqlite::params![window.label(), now],
        )
        .map_err(|e| e.to_string())?;
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
