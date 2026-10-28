//! Native process admission shares the execution Host's managed-workspace gate.
//! A lease is released only after confirmed child exit; uncertain exits stay fenced.
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(crate) mod buffer_reports;
pub(crate) mod recovery_bridge;

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
    pub(crate) fn settled(mut self) -> Result<(), String> {
        // Do not retry an unknown release from Drop. The durable Host lease stays
        // fenced unless this exact release receives its acknowledgement.
        self.started = true;
        let result = self
            .host
            .call("native.activity.end", json!({"activityId":self.id}))?;
        if result["acknowledged"] != true {
            return Err("Execution Host has not acknowledged native process exit".into());
        }
        Ok(())
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

static INSTANCE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

static BUFFER_REPORT_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn ensure_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_workspace_buffers (
        owner_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0);",
    )?;
    let has_nonce: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('native_workspace_buffers') WHERE name='report_nonce')",
        [],
        |row| row.get(0),
    )?;
    if !has_nonce {
        tx.execute_batch("ALTER TABLE native_workspace_buffers ADD COLUMN report_nonce TEXT")?;
    }
    buffer_reports::install_schema(&tx)?;
    tx.execute_batch("UPDATE native_workspace_buffers SET confirmed=0;")?;
    tx.commit()
}

/// Local acknowledgement identity, never a renderer-supplied report or a
/// complete-writer proof. Retain legacy rows and their recovery fences.
struct BufferReportReceipt {
    owner_id: String,
    nonce: String,
    raw: String,
    updated_at: i64,
    report_version: i64,
    attributed: bool,
}

impl BufferReportReceipt {
    #[cfg(test)]
    fn record(
        conn: &rusqlite::Connection,
        owner_id: &str,
        raw: String,
        updated_at: i64,
    ) -> Result<Self, String> {
        let nonce = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed,report_nonce) VALUES(?1,?2,?3,0,?4)
             ON CONFLICT(owner_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,confirmed=0,report_nonce=excluded.report_nonce",
            rusqlite::params![owner_id, raw, updated_at, nonce],
        ).map_err(|error| error.to_string())?;
        let report_version = buffer_reports::current_version(conn, owner_id)?;
        Ok(Self {
            owner_id: owner_id.into(),
            nonce,
            raw,
            updated_at,
            report_version,
            attributed: true,
        })
    }

    fn record_owned(
        conn: &rusqlite::Connection,
        stamp: &buffer_reports::OwnerStamp,
        raw: String,
        updated_at: i64,
    ) -> Result<Self, String> {
        let nonce = uuid::Uuid::new_v4().to_string();
        let report_version = buffer_reports::record_owned(conn, stamp, &raw, updated_at, &nonce)?;
        Ok(Self {
            owner_id: stamp.id.clone(),
            nonce,
            raw,
            updated_at,
            report_version,
            attributed: stamp.kind == "physical",
        })
    }

    /// A different process can overwrite a same-label row even in the same
    /// millisecond. An old successful response must never confirm its new data.
    fn confirm(self, conn: &rusqlite::Connection) -> Result<(), String> {
        if !self.attributed {
            // Host delivery does not attribute an unknown physical owner.
            let matches: bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id
              WHERE b.owner_id=?1 AND b.report_nonce=?2 AND b.snapshot_json=?3 AND b.updated_at=?4 AND b.confirmed=0 AND i.current_version=?5)",
              rusqlite::params![self.owner_id,self.nonce,self.raw,self.updated_at,self.report_version],|r|r.get(0)).map_err(|e|e.to_string())?;
            return if matches {
                Ok(())
            } else {
                Err("Native unattributed buffer report changed before acknowledgement".into())
            };
        }
        let changed = conn.execute(
            "UPDATE native_workspace_buffers SET confirmed=1 WHERE owner_id=?1 AND report_nonce=?2 AND snapshot_json=?3 AND updated_at=?4 AND confirmed=0
             AND (SELECT current_version FROM native_workspace_buffer_identity WHERE owner_id=?1)=?5",
            rusqlite::params![self.owner_id, self.nonce, self.raw, self.updated_at,self.report_version],
        ).map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err(
                "Native buffer report changed before acknowledgement; wait for a fresh report"
                    .into(),
            );
        }
        Ok(())
    }
}

fn report_owners(
    conn: &rusqlite::Connection,
    receipt: &BufferReportReceipt,
    now: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let mut statement = conn.prepare(
        "SELECT b.owner_id,b.snapshot_json,b.updated_at,b.confirmed,b.report_nonce,i.current_version,i.kind,i.store_instance,i.incarnation
         FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id ORDER BY b.owner_id",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut owners = Vec::new();
    let source_identity = buffer_reports::identity(conn).ok();
    let mut own_report = false;
    for row in rows {
        let (
            owner,
            snapshot,
            updated,
            confirmed,
            nonce,
            version,
            kind,
            store_instance,
            incarnation,
        ) = row.map_err(|error| error.to_string())?;
        let own = owner == receipt.owner_id;
        if own {
            if nonce.as_deref() != Some(receipt.nonce.as_str())
                || snapshot != receipt.raw
                || updated != receipt.updated_at
                || version != receipt.report_version
            {
                return Err(
                    "Native buffer report changed before delivery; wait for a fresh report".into(),
                );
            }
            own_report = true;
        }
        let buffers: serde_json::Value =
            serde_json::from_str(&snapshot).map_err(|error| error.to_string())?;
        let mut output = json!({"ownerId":owner,"buffers":buffers,"updatedAt":updated,"unknown":(own && !receipt.attributed) || kind=="unattributed" || kind=="retained" || (!own && (!confirmed || now.saturating_sub(updated)>45000))});
        if let Some((store, profile)) = &source_identity {
            use sha2::{Digest, Sha256};
            output["source"] = json!({"version":2,"sourceStoreId":store,"sourceProfileId":profile,"storeInstance":store_instance,"windowIncarnation":incarnation,"kind":kind,
                "reportVersion":version,"reportNonce":nonce,"snapshotDigest":format!("{:x}",Sha256::digest(snapshot.as_bytes()))});
        }
        owners.push(output);
    }
    if !own_report {
        return Err(
            "Native buffer report was removed before delivery; wait for a fresh report".into(),
        );
    }
    Ok(owners)
}

#[tauri::command(async)]
pub fn managed_workspace_buffers(
    app: AppHandle,
    window: tauri::Window,
    store: tauri::State<'_, crate::session_store::SessionStore>,
    buffers: Vec<BufferState>,
) -> Result<(), String> {
    crate::native_window_lifecycle::workspace_buffer_report(&window, &store, |owner| {
        report_buffers(&app, &window, &store, buffers, owner)
    })
}

fn report_buffers(
    app: &AppHandle,
    window: &tauri::Window,
    store: &crate::session_store::SessionStore,
    buffers: Vec<BufferState>,
    owner: Option<&crate::native_window_lifecycle::NativeBufferOwner>,
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
    let receipt = {
        let conn = store.lock_conn()?;
        let stamp = match owner {
            Some(owner) => buffer_reports::OwnerStamp {
                id: format!("physical:v2:{}", owner.key()),
                kind: "physical",
                label: owner.label().into(),
                store_instance: owner.store_instance().to_string(),
                incarnation: Some(owner.incarnation().to_string()),
            },
            None => buffer_reports::OwnerStamp {
                id: format!(
                    "unattributed:v2:{}:{}",
                    store.native_instance_id(),
                    uuid::Uuid::new_v4()
                ),
                kind: "unattributed",
                label: window.label().into(),
                store_instance: store.native_instance_id().to_string(),
                incarnation: None,
            },
        };
        BufferReportReceipt::record_owned(&conn, &stamp, raw, now)?
    };
    let host =
        crate::remote::NativeWorkspaceTransport::connect(app, "workspaces.native-activity.v1")?;
    let owners = {
        let conn = store.lock_conn()?;
        report_owners(&conn, &receipt, now)?
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
    let conn = store.lock_conn()?;
    receipt.confirm(&conn)
}

#[tauri::command(async)]
pub fn managed_workspace_buffer_recovery_list(
    store: tauri::State<'_, crate::session_store::SessionStore>,
    request: buffer_reports::ListRequest,
) -> Result<buffer_reports::ReportPage, String> {
    let conn = store.lock_conn()?;
    buffer_reports::list(&conn, request)
}

#[tauri::command(async)]
pub fn managed_workspace_host_buffer_recovery_list(
    app: AppHandle,
    store: tauri::State<'_, crate::session_store::SessionStore>,
    request: recovery_bridge::ListRequest,
    expected_context: Option<recovery_bridge::RecoveryContext>,
) -> Result<recovery_bridge::RecoveryPage, String> {
    recovery_bridge::list(&app, &store, request, expected_context)
}

#[tauri::command(async)]
pub fn managed_workspace_host_buffer_recovery_read(
    app: AppHandle,
    store: tauri::State<'_, crate::session_store::SessionStore>,
    source: recovery_bridge::RecoverySource,
    expected_context: recovery_bridge::RecoveryContext,
) -> Result<serde_json::Value, String> {
    recovery_bridge::read(&app, &store, source, expected_context)
}

#[tauri::command(async)]
pub fn managed_workspace_host_buffer_recovery_status(
    app: AppHandle,
    store: tauri::State<'_, crate::session_store::SessionStore>,
    source: recovery_bridge::RecoverySource,
    expected_context: recovery_bridge::RecoveryContext,
) -> Result<serde_json::Value, String> {
    recovery_bridge::status(&app, &store, source, expected_context)
}
#[tauri::command(async)]
pub fn managed_workspace_buffer_recovery_read(
    store: tauri::State<'_, crate::session_store::SessionStore>,
    source: buffer_reports::ReportSource,
) -> Result<buffer_reports::RetainedReport, String> {
    let conn = store.lock_conn()?;
    buffer_reports::read(&conn, source)
}
#[tauri::command(async)]
pub fn managed_workspace_buffer_recovery_status(
    store: tauri::State<'_, crate::session_store::SessionStore>,
    source: buffer_reports::ReportSource,
) -> Result<buffer_reports::ReportStatus, String> {
    let conn = store.lock_conn()?;
    buffer_reports::status(&conn, source)
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

    struct BufferTestDirectory(std::path::PathBuf);
    impl BufferTestDirectory {
        fn new() -> Self {
            let root = std::env::temp_dir().canonicalize().unwrap();
            let path = root.join(format!("bycoda-buffer-fixture-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for BufferTestDirectory {
        fn drop(&mut self) {
            assert_eq!(
                self.0.parent(),
                Some(std::env::temp_dir().canonicalize().unwrap().as_path())
            );
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("bycoda-buffer-fixture-"));
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn buffer_ack_cannot_confirm_a_same_millisecond_cross_connection_replacement() {
        let directory = BufferTestDirectory::new();
        let path = directory.path().join("buffers.db");
        let first = rusqlite::Connection::open(&path).unwrap();
        ensure_schema(&first).unwrap();
        let second = rusqlite::Connection::open(&path).unwrap();
        let timestamp = now_millis();
        let old = BufferReportReceipt::record(&first, "main", "[]".into(), timestamp).unwrap();
        assert_eq!(
            report_owners(&first, &old, timestamp).unwrap()[0]["unknown"],
            false
        );
        let dirty = r#"[{"path":"C:/fixture/retained.ts","dirty":true}]"#;
        let current =
            BufferReportReceipt::record(&second, "main", dirty.into(), timestamp).unwrap();
        assert!(report_owners(&first, &old, timestamp).is_err());
        assert_eq!(
            report_owners(&second, &current, timestamp).unwrap()[0]["buffers"][0]["dirty"],
            true
        );
        assert!(old.confirm(&first).is_err());
        let retained: (String, bool) = second.query_row(
            "SELECT snapshot_json,confirmed FROM native_workspace_buffers WHERE owner_id='main'",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(retained, (dirty.into(), false));
        current.confirm(&second).unwrap();
        assert!(first
            .query_row(
                "SELECT confirmed FROM native_workspace_buffers WHERE owner_id='main'",
                [],
                |row| row.get::<_, bool>(0)
            )
            .unwrap());
    }

    #[test]
    fn buffer_ack_cannot_confirm_an_identical_replacement_or_deleted_report() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        let timestamp = now_millis();
        let old = BufferReportReceipt::record(&conn, "main", "[]".into(), timestamp).unwrap();
        let current = BufferReportReceipt::record(&conn, "main", "[]".into(), timestamp).unwrap();
        assert!(report_owners(&conn, &old, timestamp).is_err());
        assert!(old.confirm(&conn).is_err());
        current.confirm(&conn).unwrap();
        let deleted = BufferReportReceipt::record(&conn, "main", "[]".into(), timestamp).unwrap();
        conn.execute(
            "DELETE FROM native_workspace_buffers WHERE owner_id='main'",
            [],
        )
        .unwrap();
        assert!(report_owners(&conn, &deleted, timestamp).is_err());
        assert!(deleted.confirm(&conn).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM native_workspace_buffers WHERE owner_id='main'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM native_workspace_buffers b JOIN native_workspace_buffer_identity i ON i.owner_id=b.owner_id WHERE i.kind='retained' AND b.confirmed=0",[],|row|row.get::<_,i64>(0)).unwrap(),1,
          "deleting the current report must preserve its unknown compatibility guard");
    }

    #[test]
    fn buffer_ack_requires_retained_exact_payload_and_time_without_repair() {
        for changed in [
            "snapshot_json='[{}]'",
            "updated_at=updated_at+1",
            "report_nonce=NULL",
            "confirmed=1",
        ] {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            ensure_schema(&conn).unwrap();
            let receipt =
                BufferReportReceipt::record(&conn, "main", "[]".into(), now_millis()).unwrap();
            conn.execute(
                &format!("UPDATE native_workspace_buffers SET {changed}"),
                [],
            )
            .unwrap();
            let changes = conn.total_changes();
            assert!(receipt.confirm(&conn).is_err(), "{changed}");
            assert_eq!(
                conn.total_changes(),
                changes,
                "failed ACK must not repair {changed}"
            );
        }
    }

    #[test]
    fn buffer_report_upgrade_preserves_legacy_dirty_unknown_and_sibling_rows() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE native_workspace_buffers(owner_id TEXT PRIMARY KEY,snapshot_json TEXT NOT NULL,updated_at INTEGER NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0);
            INSERT INTO native_workspace_buffers VALUES('legacy-dirty','[{\"path\":\"C:/retained\",\"dirty\":true}]',11,0),('legacy-clean','[]',12,1),('other-window','[]',13,0);").unwrap();
        ensure_schema(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT snapshot_json FROM native_workspace_buffers WHERE owner_id='legacy-dirty'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            r#"[{"path":"C:/retained","dirty":true}]"#
        );
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM native_workspace_buffers WHERE report_nonce IS NULL AND confirmed=0", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
        let own = BufferReportReceipt::record(&conn, "fresh", "[]".into(), now_millis()).unwrap();
        own.confirm(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM native_workspace_buffers WHERE report_nonce IS NULL AND confirmed=0", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM native_workspace_buffers", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            4
        );
    }

    #[test]
    fn concurrent_buffer_schema_upgrade_serializes_before_column_inspection() {
        let directory = BufferTestDirectory::new();
        let path = directory.path().join("schema.db");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let conn = rusqlite::Connection::open(path).unwrap();
                    conn.busy_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    barrier.wait();
                    ensure_schema(&conn).unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let conn = rusqlite::Connection::open(path).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_table_info('native_workspace_buffers') WHERE name='report_nonce'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        BufferReportReceipt::record(&conn, "main", "[]".into(), now_millis())
            .unwrap()
            .confirm(&conn)
            .unwrap();
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
        // Each state is independent. Replacing a legacy row now deliberately
        // retains the older unknown snapshot rather than washing its fence.
        for (dirty, confirmed, age, expected) in [
            (false, true, 0, true),
            (true, true, 0, false),
            (false, false, 0, false),
            (false, true, 60000, false),
        ] {
            let store = crate::session_store::SessionStore::open_in_memory().unwrap();
            store.lock_conn().unwrap().execute("INSERT OR REPLACE INTO native_workspace_buffers(owner_id,snapshot_json,updated_at,confirmed) VALUES('main',?1,?2,?3)",
                rusqlite::params![json!([{"path":crate::fs::path_to_js(&path),"dirty":dirty}]).to_string(),now_millis()-age,confirmed]).unwrap();
            assert_eq!(assert_buffers_settled(&store, &root).is_ok(), expected);
            if confirmed && age == 0 {
                assert!(assert_buffers_settled(&store, &root.join("sibling")).is_ok());
            }
        }
        std::fs::remove_dir_all(&root).unwrap();
    }
}
